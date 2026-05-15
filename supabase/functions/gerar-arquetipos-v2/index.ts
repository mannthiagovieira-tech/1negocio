// gerar-arquetipos-v2 · v9.29
// Gera 5-7 arquétipos de comprador respeitando faixa de capacidade financeira
// e perfis de comprador selecionados pelo admin (REGRA DURA · filtro de escala).
//
// POST body:
// {
//   originacao_id: uuid,
//   faixa_capacidade_min?: number,    // null = reusar calibracao existente
//   faixa_capacidade_max?: number,
//   perfis_comprador_desejados?: string[],
//   observacao_escala?: string,
//   reusar_calibracao?: boolean       // se true, ignora faixa/perfis/obs do body
// }
//
// Output: { ok, arquetipos_count, arquetipos: [...] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const PERFIS_LABELS: Record<string, string> = {
  pf_primeiro_negocio: "Pessoa física · primeiro negócio próprio",
  pf_investidor: "Pessoa física · investidor experiente",
  pme_local: "PME local · concorrente direto ou adjacente",
  pme_regional: "PME regional · expansionista",
  grupo_regional: "Grupo regional / family office",
  pe_medio: "Private equity médio porte",
  estrategico_nacional: "Empresa estratégica nacional",
  estrangeiro: "Estrangeiro / fundo internacional",
};

const SYSTEM_PROMPT_BASE = `Você é especialista sênior em M&A. Sua tarefa: gerar 5-7 arquétipos de COMPRADORES POTENCIAIS pra um negócio à venda.

REGRA ABSOLUTA · CALIBRAÇÃO DE ESCALA:
O assessor definiu uma FAIXA DE CAPACIDADE FINANCEIRA do comprador desejado.
VOCÊ NÃO PODE SUGERIR compradores fora desta faixa. NUNCA.

Exemplos de aplicação da regra:
- Se faixa é R$ 100k-R$ 2M: NÃO sugira Coca-Cola, Carrefour, AmBev, multinacionais, PE de grande porte. SUGIRA: PF investidor local, PME concorrente adjacente, profissional do setor que queira virar dono.
- Se faixa é R$ 5M-R$ 50M: NÃO sugira PF iniciante. SUGIRA grupos regionais, PE médio porte, estratégicos nacionais menores.

PERFIS PERMITIDOS (apenas estes · o admin selecionou):
{perfis_permitidos}

Tipos NÃO selecionados são PROIBIDOS · não sugira.

OBSERVAÇÃO ADICIONAL DO ASSESSOR:
{observacao_escala}

TESE DO NEGÓCIO (já fechada pelo assessor):
{tese_texto}

DADOS DO NEGÓCIO:
{negocio_block}

FAIXA DE CAPACIDADE (filtro DURO):
- Mínimo: R$ {faixa_min}
- Máximo: R$ {faixa_max}

GERE 5-7 ARQUÉTIPOS no formato JSON estrito (sem markdown, sem texto fora):
{
  "arquetipos": [
    {
      "nome": "string curta · 3-6 palavras",
      "vetor": "horizontal" ou "vertical",
      "perfil": "descrição detalhada do tipo de comprador",
      "motivacao": "por que esse arquétipo compraria este negócio especificamente",
      "capacidade_financeira": "faixa em R$ explícita · sempre dentro da faixa definida",
      "exemplos": "2-4 nomes ou tipos concretos · respeitando a escala"
    }
  ]
}

Regras adicionais:
- Mínimo 5, máximo 7 arquétipos
- Sempre classifique vetor: horizontal (mesmo setor) ou vertical (setor adjacente)
- Capacidade financeira sempre EXPLÍCITA em R$ · dentro da faixa
- Exemplos devem ser CONCRETOS · não genéricos ("uma empresa do setor X" é genérico · "Empresa Y do interior de SP" é concreto)
- Português brasileiro`;

function buildNegocioBlock(negocio: any): string {
  const partes = [
    `Nome: ${negocio.nome_negocio || negocio.nome || "—"}`,
    `Setor: ${negocio.setor || negocio.categoria || "—"}`,
    `Localização: ${negocio.cidade || "?"}/${negocio.estado || "?"}`,
  ];
  const fat = negocio.faturamento_anual ?? negocio.fat_anual;
  if (fat) partes.push(`Faturamento anual: R$ ${fat}`);
  const ebitda = negocio.ebitda ?? negocio.ebitda_anual;
  if (ebitda) partes.push(`EBITDA anual: R$ ${ebitda}`);
  const preco = negocio.preco_pedido ?? negocio.valor_1n;
  if (preco) partes.push(`Preço pedido: R$ ${preco}`);
  const anos = negocio.tempo_operacao_anos ?? negocio.anos_existencia
    ?? (negocio.ano_fundacao ? new Date().getFullYear() - negocio.ano_fundacao : null);
  if (anos) partes.push(`Tempo de operação: ${anos} anos`);
  const func = negocio.funcionarios ?? negocio.num_funcionarios;
  if (func) partes.push(`Funcionários: ${func}`);
  if (negocio.descricao || negocio.descricao_geral) {
    partes.push(`Descrição: ${negocio.descricao || negocio.descricao_geral}`);
  }
  if (negocio.diferenciais || negocio.pontos_positivos) {
    partes.push(`Diferenciais: ${negocio.diferenciais || negocio.pontos_positivos}`);
  }
  return partes.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Gate admin
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin, error: adminErr } = await adminClient
    .from("admins")
    .select("id, ativo")
    .eq("whatsapp", userData.user.phone)
    .eq("ativo", true)
    .maybeSingle();
  if (adminErr || !admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); }
  catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  const { originacao_id, reusar_calibracao, do_briefing } = body;
  let { faixa_capacidade_min, faixa_capacidade_max, perfis_comprador_desejados, observacao_escala } = body;

  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  // Busca originação
  const { data: origRow, error: errOrig } = await adminClient
    .from("projetos_originacao")
    .select("*")
    .eq("id", originacao_id)
    .maybeSingle();
  if (errOrig || !origRow) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
  if (origRow.fase_atual !== "arquetipos") {
    return resp(400, { ok: false, erro: "fase_invalida", detalhe: `Fase atual é '${origRow.fase_atual}' · esperado 'arquetipos'` });
  }

  // v9.32 · novo fluxo: usa briefing_jsonb (vocabulário canônico) · sem calibração manual
  if (do_briefing) {
    if (!origRow.briefing_jsonb || Object.keys(origRow.briefing_jsonb).length === 0) {
      return resp(400, { ok: false, erro: "briefing_vazio", detalhe: "Briefing precisa estar preenchido antes" });
    }
  } else {
    // Modo legado v9.29-v9.31 (tese_texto + faixa manual)
    if (!origRow.tese_texto) {
      return resp(400, { ok: false, erro: "tese_nao_fechada", detalhe: "Tese precisa estar fechada antes de gerar arquétipos · OU passe do_briefing=true" });
    }
    if (reusar_calibracao) {
      faixa_capacidade_min = origRow.faixa_capacidade_min;
      faixa_capacidade_max = origRow.faixa_capacidade_max;
      perfis_comprador_desejados = origRow.perfis_comprador_desejados;
      observacao_escala = origRow.observacao_escala;
    } else {
      if (!faixa_capacidade_min || !faixa_capacidade_max || faixa_capacidade_min >= faixa_capacidade_max) {
        return resp(400, { ok: false, erro: "faixa_invalida" });
      }
      if (!Array.isArray(perfis_comprador_desejados) || !perfis_comprador_desejados.length) {
        return resp(400, { ok: false, erro: "perfis_obrigatorios" });
      }
      await adminClient
        .from("projetos_originacao")
        .update({
          faixa_capacidade_min,
          faixa_capacidade_max,
          perfis_comprador_desejados,
          observacao_escala: observacao_escala || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", originacao_id);
    }
  }

  // Busca negócio
  const { data: pm } = await adminClient
    .from("projeto_metadata")
    .select("negocio_id")
    .eq("id", origRow.projeto_id)
    .maybeSingle();
  let negocio: any = null;
  if (pm?.negocio_id) {
    const { data: n } = await adminClient.from("negocios").select("*").eq("id", pm.negocio_id).maybeSingle();
    negocio = n;
  }
  if (!negocio) return resp(404, { ok: false, erro: "negocio_nao_encontrado" });

  // Próxima ordem (pra apend sequencial)
  const { data: ultimaOrdem } = await adminClient
    .from("arquetipos_compradores")
    .select("ordem")
    .eq("originacao_id", originacao_id)
    .order("ordem", { ascending: false })
    .limit(1)
    .maybeSingle();
  const offsetOrdem = (ultimaOrdem?.ordem ?? -1) + 1;

  // Monta system prompt · 2 caminhos:
  // v9.32 · do_briefing=true → usa briefing_jsonb estruturado (vocabulário canônico)
  // legado · do_briefing=false → usa tese_texto + faixa manual + perfis antigos
  let systemPrompt: string;
  if (do_briefing) {
    const b = origRow.briefing_jsonb;
    const valorVenda = b.tamanho?.valor_venda_pedido;
    const capMin = valorVenda ? Math.round(valorVenda * 0.8) : null;
    const capMax = valorVenda ? Math.round(valorVenda * 3) : null;
    const tipos = Array.isArray(b.tipos_comprador_buscar) ? b.tipos_comprador_buscar : [];
    const tiposLabels = {
      concorrente_direto: "concorrente_direto · mesma cadeia · busca consolidação",
      antes_cadeia: "antes_cadeia · fornecedor/fabricante querendo descer",
      depois_cadeia: "depois_cadeia · cliente/canal querendo subir",
      adjacente: "adjacente · mesmo cliente · produto complementar",
      clientes_atuais: "clientes_atuais · cliente B2B que já compra · integração vertical · conhece operação por dentro",
      investidor_financeiro: "investidor_financeiro · PF ou family office sem operação",
    } as Record<string, string>;
    const tiposBlock = tipos.map((t: string) => `- ${tiposLabels[t] || t}`).join("\n");

    systemPrompt = `Você é especialista sênior em M&A da 1Negócio. Gere 3-7 ARQUÉTIPOS DE COMPRADORES POTENCIAIS para este negócio à venda.

REGRA ABSOLUTA · ESCALA DO COMPRADOR:
O valor de venda pedido é R$ ${valorVenda ?? "não informado"}.
Capacidade financeira esperada do comprador: entre R$ ${capMin ?? "?"} e R$ ${capMax ?? "?"} (0.8x a 3x do valor pedido).
NÃO sugira compradores fora dessa faixa. Multinacionais e fundos grandes NUNCA quando valor pedido é menor que R$ 5M.

TIPOS DE COMPRADOR A BUSCAR (admin selecionou · gere 1-2 arquétipos por tipo):
${tiposBlock}

Tipos não listados acima NÃO podem aparecer nos arquétipos.

BRIEFING DO NEGÓCIO (vocabulário canônico):
${JSON.stringify(b, null, 2)}

GERE 3-7 ARQUÉTIPOS no formato JSON estrito (sem markdown · sem texto fora):
{
  "arquetipos": [
    {
      "nome": "string curta · 3-6 palavras (ex: 'Distribuidora regional do setor X')",
      "vetor": "horizontal" ou "vertical",
      "perfil": "descrição detalhada do tipo de comprador · 1-2 frases",
      "motivacao": "por que esse arquétipo compraria ESTE negócio especificamente · referencie diferenciais ou sinergia do briefing",
      "capacidade_financeira": "faixa em R$ explícita · dentro de 0.8x a 3x do valor pedido",
      "exemplos": "2-4 nomes ou tipos concretos respeitando escala · não 'uma empresa do setor'"
    }
  ]
}

Regras adicionais:
- Mínimo 3 · máximo 7 arquétipos
- Vetor: horizontal = mesmo setor canônico · vertical = setor adjacente/antes/depois na cadeia
- Capacidade financeira sempre EXPLÍCITA em R$ · dentro da faixa
- Exemplos CONCRETOS (ex: 'Alterdata Software', 'Senior Sistemas') · não genéricos
- Português brasileiro
- Use o setor canônico do briefing.negocio.setor sem inventar
- Aproveite briefing.sinergia.ganho_consolidador na motivação quando aplicável
- Se 'clientes_atuais' foi marcado, o arquétipo deve ter motivação DIFERENTE dos outros: já conhece operação · já tem confiança · pode querer eliminar risco de fornecedor único · integração vertical`;
  } else {
    const perfisLabels = (perfis_comprador_desejados || []).map((p: string) => `- ${PERFIS_LABELS[p] || p}`).join("\n");
    systemPrompt = SYSTEM_PROMPT_BASE
      .replace("{perfis_permitidos}", perfisLabels)
      .replace("{observacao_escala}", observacao_escala || "(nenhuma)")
      .replace("{tese_texto}", origRow.tese_texto)
      .replace("{negocio_block}", buildNegocioBlock(negocio))
      .replace("{faixa_min}", String(faixa_capacidade_min))
      .replace("{faixa_max}", String(faixa_capacidade_max));
  }

  // Chama Claude (sem web search · ~R$ 0,30)
  const inicio = Date.now();
  try {
    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: "user", content: "Gere os arquétipos agora · só JSON válido." }],
      }),
    });

    if (!claudeResp.ok) {
      const errTxt = await claudeResp.text();
      return resp(500, { ok: false, erro: "claude_api_falhou", detalhe: errTxt.slice(0, 500) });
    }

    const claudeData = await claudeResp.json();
    const textBlocks = (claudeData.content || []).filter((b: any) => b.type === "text");
    const fullText = textBlocks.map((b: any) => b.text).join("");

    let parsed: any;
    try {
      const cleanText = fullText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleanText);
    } catch (e: any) {
      return resp(500, { ok: false, erro: "json_parse_falhou", detalhe: fullText.slice(0, 500) });
    }

    const arquetipos = parsed?.arquetipos;
    if (!Array.isArray(arquetipos) || arquetipos.length < 3) {
      return resp(500, { ok: false, erro: "arquetipos_insuficientes", detalhe: `Esperado >=3 · recebido ${arquetipos?.length ?? 0}` });
    }

    // INSERT em arquetipos_compradores
    const rows = arquetipos.map((a: any, idx: number) => ({
      originacao_id,
      projeto_id: origRow.projeto_id,
      nome: a.nome || `Arquétipo ${idx + 1}`,
      vetor: ["horizontal", "vertical"].includes(a.vetor) ? a.vetor : null,
      perfil: a.perfil || null,
      motivacao: a.motivacao || null,
      capacidade_financeira: a.capacidade_financeira || null,
      exemplos: a.exemplos || null,
      status: "candidato",
      criado_pela_ia: true,
      ordem: offsetOrdem + idx,
    }));

    const { data: inserted, error: errIns } = await adminClient
      .from("arquetipos_compradores")
      .insert(rows)
      .select();
    if (errIns) return resp(500, { ok: false, erro: "erro_insert", detalhe: errIns.message });

    const duracao = Date.now() - inicio;
    const usage = claudeData.usage || {};

    return resp(200, {
      ok: true,
      arquetipos_count: inserted?.length || 0,
      arquetipos: inserted,
      duracao_ms: duracao,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    });
  } catch (e: any) {
    return resp(500, { ok: false, erro: "exception", detalhe: e.message });
  }
});
