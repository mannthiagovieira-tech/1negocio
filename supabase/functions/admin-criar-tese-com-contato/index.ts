// admin-criar-tese-com-contato · v9.19.1 · 1Negócio
// Atalho admin pra criar tese: resolve contato (existing por whatsapp OU novo)
// e cria tese vinculada com estrutura canônica IDÊNTICA aos outros fluxos +
// preenche AMBOS valor_alvo (numeric) e valor_investimento (text "min-max") +
// localizacao_tipo explícito · origem='admin'.
//
// v9.19.1 · try/catch externo + logs detalhados + retorna {detalhe, code, hint, step}
// nos erros 500 pra debug · maybeSingle em vez de single pós-INSERT.
//
// POST {
//   telefone_raw,
//   nome_contato?,                  // obrigatório se contato é novo
//   dados_tese: {
//     titulo, descricao_curta, setores[], formas_atuacao[],
//     localizacao_tipo, estado?, cidade?,
//     valor_min, valor_max,         // ambos numbers (em R$)
//     descricao_adicional?
//   }
// }
// → 200 { ok, contato, tese, novo_contato, whatsapp_ok }
// → 400/403/409 erros padronizados
//
// Auth · JWT admin (gate canônico)
// verify_jwt · true

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const ZAPI_INSTANCE = "3F0B96941C16821DCD449E74568994AE";
const ZAPI_TOKEN = "0BE4998D03035703BC118D92";
const ZAPI_CLIENT = "F547b97b8e03b4e45a4ac018295d569c1S";

const SETORES_VALIDOS = new Set([
  "servicos_empresas","varejo","saude","alimentacao","beleza_estetica",
  "educacao","servicos_locais","bem_estar","industria","construcao","hospedagem","logistica",
]);
const FORMAS_VALIDAS = new Set([
  "presta_servico","produz_revende","fabricacao","revenda",
  "distribuicao","vende_governo","saas","assinatura",
]);
const LOC_TIPOS_VALIDOS = new Set(["brasil_todo","estado","cidade"]);
const UFS_VALIDAS = new Set([
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT","PA",
  "PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO",
]);

const SETOR_LBL: Record<string,string> = {
  servicos_empresas:"Serviços p/ empresas", varejo:"Varejo", saude:"Saúde",
  alimentacao:"Alimentação", beleza_estetica:"Beleza & estética", educacao:"Educação",
  servicos_locais:"Serviços locais", bem_estar:"Bem-estar", industria:"Indústria",
  construcao:"Construção", hospedagem:"Hospedagem", logistica:"Logística",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function decodeJwtPayload(t: string): any | null {
  try {
    const p = t.split(".");
    if (p.length !== 3) return null;
    const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch { return null; }
}

async function gateAdmin(req: Request): Promise<{ ok: boolean; admin_id?: string | null }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true, admin_id: null };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return { ok: false };
    const { data: admin } = await adminClient.from("admins")
      .select("id").eq("whatsapp", data.user.phone).eq("ativo", true).maybeSingle();
    if (admin?.id) return { ok: true, admin_id: admin.id };
  } catch {}
  return { ok: false };
}

function normalizarTelefone(raw: string): string | null {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return null;
  let out = d;
  if (!out.startsWith("55")) out = "55" + out;
  // Aceita 55 + DDD(2) + 8|9 dígitos = 12 ou 13 chars
  if (out.length < 12 || out.length > 13) return null;
  return out;
}

function brl(v: number | null | undefined): string {
  if (v == null) return "—";
  return "R$ " + Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function faixaTexto(min: number, max: number): string {
  return `${brl(min)} – ${brl(max)}`;
}

async function enviarWhatsApp(telefone: string, mensagem: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "client-token": ZAPI_CLIENT },
        body: JSON.stringify({ phone: telefone, message: mensagem }),
      }
    );
    return r.ok;
  } catch (e) {
    console.error("[admin-criar-tese] Z-API erro:", e);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  // v9.19.1 · try/catch externo · captura qualquer exception inesperada e retorna detalhe
  try {
  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const telefone = normalizarTelefone(String(body?.telefone_raw || ""));
  if (!telefone) return json({ ok: false, error: "telefone_invalido", detalhe: "use 10-13 dígitos · ex: 11999999999" }, 400);

  const dt = body?.dados_tese || {};
  const titulo = String(dt?.titulo || "").trim();
  const descricao_curta = String(dt?.descricao_curta || "").trim();
  const setores: string[] = Array.isArray(dt?.setores) ? dt.setores.filter((s: any) => typeof s === "string") : [];
  const formas_atuacao: string[] = Array.isArray(dt?.formas_atuacao) ? dt.formas_atuacao.filter((s: any) => typeof s === "string") : [];
  const localizacao_tipo = String(dt?.localizacao_tipo || "").trim();
  const estado = dt?.estado ? String(dt.estado).toUpperCase().trim() : null;
  const cidade = dt?.cidade ? String(dt.cidade).trim() : null;
  const valor_min = Number(dt?.valor_min || 0);
  const valor_max = Number(dt?.valor_max || 0);
  const descricao_adicional = dt?.descricao_adicional ? String(dt.descricao_adicional).slice(0, 1000) : null;

  if (titulo.length < 3 || titulo.length > 200) return json({ ok: false, error: "titulo_invalido" }, 400);
  if (descricao_curta.length < 3 || descricao_curta.length > 80) return json({ ok: false, error: "descricao_curta_invalido", detalhe: "3-80 caracteres" }, 400);
  if (!setores.length || !setores.every(s => SETORES_VALIDOS.has(s))) return json({ ok: false, error: "setores_invalido", detalhe: "1+ valores canônicos" }, 400);
  if (formas_atuacao.length && !formas_atuacao.every(f => FORMAS_VALIDAS.has(f))) return json({ ok: false, error: "formas_atuacao_invalido" }, 400);
  if (!LOC_TIPOS_VALIDOS.has(localizacao_tipo)) return json({ ok: false, error: "localizacao_tipo_invalido" }, 400);
  if (estado && !UFS_VALIDAS.has(estado)) return json({ ok: false, error: "estado_invalido" }, 400);
  if (localizacao_tipo === "estado" && !estado) return json({ ok: false, error: "estado_obrigatorio_quando_loc_estado" }, 400);
  if (localizacao_tipo === "cidade" && (!estado || !cidade)) return json({ ok: false, error: "cidade_e_estado_obrigatorios_quando_loc_cidade" }, 400);
  if (!Number.isFinite(valor_min) || !Number.isFinite(valor_max) || valor_min <= 0 || valor_max <= 0 || valor_min > valor_max) {
    return json({ ok: false, error: "faixa_valores_invalida", detalhe: "min e max em R$ · min ≤ max" }, 400);
  }
  if (valor_max > 100_000_000) return json({ ok: false, error: "valor_max_excessivo", detalhe: "≤ 100M" }, 400);

  // 1. Resolve contato · busca por whatsapp normalizado
  const { data: existing } = await adminClient
    .from("usuarios")
    .select("id, nome, whatsapp, email")
    .eq("whatsapp", telefone)
    .maybeSingle();

  let contato = existing;
  let novo_contato = false;

  if (!contato) {
    const nome_novo = String(body?.nome_contato || "").trim();
    if (nome_novo.length < 2) return json({ ok: false, error: "nome_contato_obrigatorio", detalhe: "contato não existe · forneça nome_contato" }, 400);
    const { data: novo, error: errU } = await adminClient
      .from("usuarios")
      .insert({ nome: nome_novo, whatsapp: telefone, tipo: "buy" })
      .select("id, nome, whatsapp, email")
      .single();
    if (errU || !novo) {
      console.error("[admin-criar-tese] erro INSERT usuarios:", JSON.stringify(errU));
      return json({ ok: false, error: "erro_criar_contato", detalhe: errU?.message, code: errU?.code, hint: errU?.hint, step: "insert_usuarios" }, 500);
    }
    contato = novo;
    novo_contato = true;
  }

  // 2. Monta payload canônico da tese
  // valor_alvo = média de min/max (numeric · usado pelo motor V8 B8.13)
  const valor_alvo_numeric = Math.round((valor_min + valor_max) / 2);
  const valor_investimento_text = `${valor_min}-${valor_max}`;

  const tesePayload: Record<string, unknown> = {
    usuario_id: contato!.id,
    status: "ativa",
    origem: "admin",
    titulo,
    descricao_curta,
    setores,
    formas_atuacao: formas_atuacao.length ? formas_atuacao : null,
    localizacao_tipo,
    estado: localizacao_tipo === "brasil_todo" ? null : estado,
    cidade: localizacao_tipo === "cidade" ? cidade : null,
    valor_alvo: valor_alvo_numeric,
    valor_investimento: valor_investimento_text,
    descricao_adicional,
    nome: contato!.nome,
    whatsapp: telefone,
    email: contato!.email,
  };

  console.log("[admin-criar-tese] INSERT payload:", JSON.stringify(tesePayload));
  const { data: tese, error: errT } = await adminClient
    .from("teses_investimento")
    .insert(tesePayload)
    .select("id, codigo, titulo, setores, valor_alvo, valor_investimento, estado, cidade, localizacao_tipo, status, origem, created_at")
    .maybeSingle();
  if (errT) {
    console.error("[admin-criar-tese] erro INSERT tese:", JSON.stringify(errT));
    return json({ ok: false, error: "erro_criar_tese", detalhe: errT.message, code: errT.code, hint: errT.hint, step: "insert_tese" }, 500);
  }
  if (!tese) {
    console.error("[admin-criar-tese] INSERT retornou sem dados (RLS bloqueou SELECT pós-INSERT?)");
    return json({ ok: false, error: "erro_criar_tese", detalhe: "insert sucesso mas SELECT pós-INSERT vazio · RLS suspeito", step: "select_pos_insert" }, 500);
  }

  // 3. Z-API · notifica contato (não bloqueia se falhar)
  const setoresTxt = setores.map(s => SETOR_LBL[s] || s).join(", ");
  const locTxt = localizacao_tipo === "brasil_todo" ? "Brasil todo" : (localizacao_tipo === "estado" ? estado! : `${cidade}/${estado}`);
  const msg =
    `Olá ${contato!.nome.split(" ")[0]}!\n\n` +
    `Sua tese de investimento foi cadastrada na 1Negócio.\n\n` +
    `📋 Título: ${titulo}\n` +
    `🎯 Setores: ${setoresTxt}\n` +
    `📍 Local: ${locTxt}\n` +
    `💰 Faixa: ${faixaTexto(valor_min, valor_max)}\n\n` +
    `A partir de agora, sempre que aparecer um negócio compatível com seus critérios, você será o primeiro a saber.\n\n` +
    `Acesse seu portal: https://1negocio.com.br/portal-usuario.html\n\n` +
    `Equipe 1Negócio`;

  const whatsapp_ok = await enviarWhatsApp(telefone, msg);

  return json({ ok: true, contato, tese, novo_contato, whatsapp_ok });
  } catch (e) {
    // v9.19.1 · captura QUALQUER exception não tratada · retorna detalhe pro toast
    const err = e as Error;
    console.error("[admin-criar-tese] exception não tratada:", err.message, err.stack);
    return json({ ok: false, error: "excecao_nao_tratada", detalhe: err.message || String(e), step: "catch_externo" }, 500);
  }
});
