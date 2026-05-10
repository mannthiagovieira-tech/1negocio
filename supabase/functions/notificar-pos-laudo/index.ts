// supabase/functions/notificar-pos-laudo/index.ts
// v9.2 · WhatsApp pós-laudo unificado · substitui enviar-whatsapp-laudo
//
// Comportamento:
// - Vendedor (proprietário) sempre recebe mensagem do laudo.
// - Se há vínculo sócio-assessor pendente (caminho V9), a mensagem do
//   vendedor INCLUI o link de aceite do vínculo (mensagem unificada · UM
//   só WhatsApp). Token de aceite é criado por INSERT direto em
//   notificacoes_proprietario · sem chamar criar-notificacao-proprietario
//   (que dispararia segundo WhatsApp).
// - Sócio também recebe mensagem do laudo (sem link de aceite) no V9.
// - Fluxo comum (sem vínculo): apenas vendedor recebe.
//
// POST { negocio_id, nome?, nome_negocio?, artigo?, slug?, dados? }
// → 200 { ok, negocio_id, tem_vinculo_socio, enviados[] }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Body {
  negocio_id: string;
  nome?: string;
  nome_negocio?: string;
  artigo?: string;
  slug?: string;
  dados?: {
    dependencia?: string;
    crescimento_pct?: number;
    fat_mensal?: number;
    regime_tributario?: string;
    imposto_vendas_mes?: number;
  };
}

function montarMensagemLaudo(args: {
  nome: string;
  nome_negocio: string;
  artigo: string;
  negocio_id: string;
  dados: any;
  is_proprietario_com_socio: boolean;
  socio_codigo?: string | null;
  vinculo_token?: string | null;
}): string {
  const { nome, nome_negocio, artigo, negocio_id, dados, is_proprietario_com_socio, socio_codigo, vinculo_token } = args;

  const linkLaudo = `https://1negocio.com.br/laudo-completo.html?id=${negocio_id}`;

  // Frase 1 dinâmica
  let frase1 = "";
  if (dados?.dependencia === "alta") {
    frase1 = "Identificamos alta dependência operacional · ponto de atenção pra avaliação.";
  } else if (dados?.crescimento_pct && dados.crescimento_pct >= 10) {
    frase1 = `Crescimento de ${dados.crescimento_pct}% · sinal positivo no diagnóstico.`;
  } else {
    frase1 = "Diagnóstico técnico pronto · vale ler com atenção.";
  }

  // Frase 2 dinâmica
  let frase2 = "";
  if (dados?.fat_mensal) {
    frase2 = `Análise considerou faturamento de R$${Math.round(dados.fat_mensal).toLocaleString("pt-BR")}/mês.`;
  } else {
    frase2 = "Considere solicitar relatório completo pra análise mais profunda.";
  }

  if (is_proprietario_com_socio && socio_codigo && vinculo_token) {
    const linkAceite = `https://1negocio.com.br/aceite-vinculo.html?token=${vinculo_token}`;
    return (
      `Oi, ${nome}! Aqui é da 1Negócio.\n\n` +
      `O sócio ${socio_codigo} cadastrou ${artigo} ${nome_negocio} em seu nome e o diagnóstico técnico foi gerado:\n\n` +
      `${frase1}\n${frase2}\n\n` +
      `Veja o laudo: ${linkLaudo}\n\n` +
      `Pra autorizar a continuidade do trabalho com este sócio (vendas · negociações), confirme aqui: ${linkAceite}\n\n` +
      `Sem confirmação, o sócio só vê dados públicos.`
    );
  }

  // Mensagem padrão (vendedor sem vínculo · ou sócio recebendo cópia)
  return (
    `Oi, ${nome}! Aqui é da 1Negócio.\n\n` +
    `Acabamos de gerar o diagnóstico d${artigo} ${nome_negocio}.\n\n` +
    `${frase1}\n${frase2}\n\n` +
    `Use este link para acessar: ${linkLaudo}\n\n` +
    `Conhece outro empresário? Compartilha: https://1negocio.com.br/diagnostico`
  );
}

async function dispararWhatsApp(
  SUPABASE_URL: string,
  SERVICE_KEY: string,
  phone: string,
  mensagem: string,
): Promise<{ ok: boolean; messageId?: string; erro?: string }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/zapi-relay`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ phone, message: mensagem }),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, erro: `zapi-relay ${r.status}: ${t}` };
    }
    const j = await r.json().catch(() => ({}));
    return { ok: true, messageId: j.messageId || j.id || j.zaapId };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Body;
  try { body = await req.json(); } catch {
    return resp(400, { ok: false, erro: "json_invalido" });
  }

  const { negocio_id } = body;
  if (!negocio_id) return resp(400, { ok: false, erro: "negocio_id_ausente" });

  // 1) Busca dados do negócio
  const { data: negocio, error: negErr } = await adminClient
    .from("negocios")
    .select("id, vendedor_id, nome_negocio, codigo_diagnostico")
    .eq("id", negocio_id)
    .maybeSingle();
  if (negErr || !negocio) {
    return resp(404, { ok: false, erro: "negocio_nao_encontrado" });
  }

  // 2) Resolve telefone do vendedor (proprietário do negócio)
  let vendedorPhone: string | null = null;
  let vendedorNome: string = body.nome || "Empresário";
  if (negocio.vendedor_id) {
    const { data: vendedorUsuario } = await adminClient
      .from("usuarios")
      .select("nome, whatsapp")
      .eq("id", negocio.vendedor_id)
      .maybeSingle();
    vendedorPhone = vendedorUsuario?.whatsapp || null;
    vendedorNome = body.nome || vendedorUsuario?.nome || "Empresário";
  }

  // 3) Detecta vínculo sócio→este negócio (caminho V9)
  const { data: vinculo } = await adminClient
    .from("vinculos_socio")
    .select("id, socio_id, status")
    .eq("diagnostico_id", negocio_id)
    .in("status", ["aguardando_aceite_proprietario", "aguardando_admin", "ativo"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let socioPhone: string | null = null;
  let socioCodigo: string | null = null;
  let vinculoTokenAceite: string | null = null;

  if (vinculo) {
    // Dados do sócio
    const { data: socio } = await adminClient
      .from("socios")
      .select("id, codigo, usuario_id")
      .eq("id", vinculo.socio_id)
      .maybeSingle();
    socioCodigo = socio?.codigo || null;

    if (socio?.usuario_id) {
      const { data: socioUsuario } = await adminClient
        .from("usuarios")
        .select("whatsapp")
        .eq("id", socio.usuario_id)
        .maybeSingle();
      socioPhone = socioUsuario?.whatsapp || null;
    }

    // Cria notificação de aceite POR INSERT DIRETO (sem chamar
    // criar-notificacao-proprietario, que dispararia segundo WhatsApp).
    // Mensagem combinada vai ser disparada UMA vez pelo zapi-relay abaixo.
    if (vinculo.status === "aguardando_aceite_proprietario" && vendedorPhone) {
      const newToken = crypto.randomUUID().replace(/-/g, "");
      const expiraEm = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: notifNova, error: notifErr } = await adminClient
        .from("notificacoes_proprietario")
        .insert({
          vinculo_id: vinculo.id,
          proprietario_id: negocio.vendedor_id,
          proprietario_phone: vendedorPhone,
          acao: "aceitar_diagnostico",
          status: "pendente",
          deep_link_token: newToken,
          expira_em: expiraEm,
        })
        .select("deep_link_token")
        .single();
      if (!notifErr && notifNova) {
        vinculoTokenAceite = notifNova.deep_link_token;
      } else {
        console.error("[notificar-pos-laudo] falha insert notif aceite:", notifErr);
      }
    }
  }

  // 4) Monta e dispara mensagens
  const baseArgs = {
    nome_negocio: body.nome_negocio || negocio.nome_negocio || "seu negócio",
    artigo: body.artigo || "o",
    negocio_id,
    dados: body.dados || {},
  };

  const resultados: any[] = [];

  // 4a) Vendedor (sempre)
  if (vendedorPhone) {
    const msgVendedor = montarMensagemLaudo({
      ...baseArgs,
      nome: vendedorNome,
      is_proprietario_com_socio: !!(vinculo && vinculoTokenAceite),
      socio_codigo: socioCodigo,
      vinculo_token: vinculoTokenAceite,
    });
    const r1 = await dispararWhatsApp(SUPABASE_URL, SERVICE_KEY, vendedorPhone, msgVendedor);
    resultados.push({ destino: "vendedor", phone_last4: vendedorPhone.slice(-4), ...r1 });

    // Marca whatsapp_enviado_em na notif (se foi criada)
    if (vinculoTokenAceite && r1.ok) {
      try {
        await adminClient
          .from("notificacoes_proprietario")
          .update({
            whatsapp_enviado_em: new Date().toISOString(),
            whatsapp_message_id: r1.messageId || null,
          })
          .eq("deep_link_token", vinculoTokenAceite);
      } catch (e) {
        console.warn("[notificar-pos-laudo] falha update notif:", e);
      }
    }
  } else {
    resultados.push({ destino: "vendedor", erro: "phone_ausente" });
  }

  // 4b) Sócio (só no caminho V9 · sem link de aceite na mensagem)
  if (socioPhone && socioPhone !== vendedorPhone) {
    const msgSocio = montarMensagemLaudo({
      ...baseArgs,
      nome: "sócio",
      is_proprietario_com_socio: false,
      socio_codigo: null,
      vinculo_token: null,
    });
    const r2 = await dispararWhatsApp(SUPABASE_URL, SERVICE_KEY, socioPhone, msgSocio);
    resultados.push({ destino: "socio", phone_last4: socioPhone.slice(-4), ...r2 });
  }

  return resp(200, {
    ok: true,
    negocio_id,
    tem_vinculo_socio: !!vinculo,
    enviados: resultados,
  });
});
