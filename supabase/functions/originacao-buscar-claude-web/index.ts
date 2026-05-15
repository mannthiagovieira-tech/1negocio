// originacao-buscar-claude-web · v9.34.2 · Sprint 3 · canal próprio (sem workaround _canal_origem)
// 5 sub-canais via Claude Sonnet + web_search nativo (tool web_search_20250305).
// Atualiza projetos_originacao.gasto_anthropic_mes a cada chamada.
//
// POST body: { originacao_id: uuid, canal: 'web_compradores'|'web_influenciadores'|'web_eventos'|'web_corretores'|'web_profissionais', arquetipo_id?: uuid }
// Output: { ok, canal, por_arquetipo[], total_inseridos, custo_anthropic_brl_estimado }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MAX_TOKENS = 2000;
const CUSTO_POR_ARQ_BRL = 0.08;

const CANAIS_VALIDOS = [
  "web_compradores",
  "web_influenciadores",
  "web_eventos",
  "web_corretores",
  "web_profissionais",
] as const;

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

function promptSistema(canal: string, briefing: any, arq: any): string {
  const negocio = briefing?.negocio || {};
  const cidade = negocio.cidade || "";
  const estado = negocio.estado || "";
  const setor = negocio.setor || "";
  const subSetor = negocio.sub_setor || "";
  const arqNome = arq.nome || "(sem nome)";
  const arqPerfil = arq.perfil || "";

  switch (canal) {
    case "web_compradores":
      return `Você é um analista de M&A especializado em PMEs brasileiras. Dado o perfil de comprador ideal abaixo, encontre EMPRESAS REAIS (com presença online verificável) que se encaixam.

NEGÓCIO À VENDA · contexto:
- Setor: ${setor} / ${subSetor}
- Cidade: ${cidade}/${estado}

ARQUÉTIPO COMPRADOR:
- Nome: ${arqNome}
- Perfil: ${arqPerfil}
- Capacidade financeira: ${arq.capacidade_financeira || "n/d"}

INSTRUÇÕES:
- Use web_search pra buscar empresas reais (não conceitos)
- Só inclua leads com URL verificável (site oficial · LinkedIn · perfil corporativo)
- Máximo 8 leads
- Foque em empresas que tenham capacidade e perfil pra adquirir negócio do setor

Retorne EXCLUSIVAMENTE este JSON · sem texto extra:
{ "leads": [{ "nome": "...", "cidade": "...", "descricao": "...", "url": "...", "categoria_setorial": "...", "tags": ["..."] }] }`;

    case "web_influenciadores":
      return `Você é especialista em marketing digital. Encontre MICRO-INFLUENCIADORES (5k–200k seguidores) relevantes para este nicho e cidade.

NICHO: ${setor} / ${subSetor}
CIDADE: ${cidade}/${estado}
ARQUÉTIPO: ${arqNome}

INSTRUÇÕES:
- Use web_search · busca em Instagram · LinkedIn · YouTube
- Priorize ENGAJAMENTO sobre alcance (5k-50k é melhor que mega-influencer)
- Máximo 6 leads
- Só inclua com URL verificável

Retorne EXCLUSIVAMENTE este JSON · sem texto extra:
{ "leads": [{ "nome": "...", "username_instagram": "...", "cidade": "...", "seguidores_estimados": 0, "descricao": "...", "url": "...", "tags": ["..."] }] }`;

    case "web_eventos":
      return `Você é especialista em eventos do setor. Encontre EVENTOS · FEIRAS · ENCONTROS dos próximos 90 dias relevantes pro setor.

SETOR: ${setor} / ${subSetor}
CIDADE: ${cidade}/${estado} (eventos locais E nacionais relevantes)

INSTRUÇÕES:
- Use web_search · busca em Sympla · Eventbrite · sites de associações setoriais
- Próximos 90 dias (após data atual)
- Máximo 6 eventos
- Indique quem deve ir: "admin" (M&A · networking) · "vendedor" (cliente do negócio) · "ambos"

Retorne EXCLUSIVAMENTE este JSON · sem texto extra:
{ "leads": [{ "nome_evento": "...", "data": "AAAA-MM-DD ou faixa", "cidade": "...", "local": "...", "url": "...", "relevancia": "alta|media|baixa", "quem_deve_ir": "admin|vendedor|ambos" }] }`;

    case "web_corretores":
      return `Você é especialista em M&A. Encontre CORRETORES DE NEGÓCIOS e CONSULTORES DE M&A em ${cidade} com presença online verificável (LinkedIn · site · Instagram).

INSTRUÇÕES:
- Use web_search · foco em ${cidade}/${estado}
- Inclua nome da empresa quando disponível
- Telefone público OK se aparecer · não invente
- Máximo 8 leads

Retorne EXCLUSIVAMENTE este JSON · sem texto extra:
{ "leads": [{ "nome": "...", "empresa": "...", "cidade": "...", "url": "...", "telefone_publico": "...", "instagram": "...", "descricao": "...", "tags": ["..."] }] }`;

    case "web_profissionais":
      return `Você é um headhunter especializado. Encontre PROFISSIONAIS DO SETOR em ${cidade} com PERFIL EMPREENDEDOR · pessoas que trabalham no setor e podem ter interesse em abrir ou adquirir um negócio.

SETOR: ${setor} / ${subSetor}
CIDADE: ${cidade}
ARQUÉTIPO ALVO: ${arqNome} · ${arqPerfil}

INSTRUÇÕES:
- Use web_search · LinkedIn é a fonte principal
- Cargos como Gerente · Diretor · Sócio · Chef · Consultor do setor
- Máximo 6 leads
- Só inclua com URL LinkedIn verificável

Retorne EXCLUSIVAMENTE este JSON · sem texto extra:
{ "leads": [{ "nome": "...", "cargo_atual": "...", "cidade": "...", "url_linkedin": "...", "descricao": "...", "tags": ["..."] }] }`;
  }
  return "";
}

async function chamarClaudeWeb(systemPrompt: string, queries: string[]): Promise<{ ok: boolean; texto?: string; tokensIn?: number; tokensOut?: number; erro?: string }> {
  const userMsg = `Queries de partida (use como inspiração no web_search): ${queries.join(" · ")}\n\nFaça a busca agora e retorne o JSON.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: MAX_TOKENS,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text();
      return { ok: false, erro: `claude_status_${r.status} · ${errTxt.slice(0, 200)}` };
    }
    const data = await r.json();
    // Coleta todos os blocos text (web_search pode gerar múltiplos)
    const textos = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    const tokensIn = data?.usage?.input_tokens ?? 0;
    const tokensOut = data?.usage?.output_tokens ?? 0;
    return { ok: true, texto: textos, tokensIn, tokensOut };
  } catch (e: any) {
    return { ok: false, erro: `exception · ${e.message}` };
  }
}

function extrairJson(texto: string): any | null {
  // Tenta JSON limpo primeiro
  try {
    const clean = texto.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch {}
  // Recupera via regex (greedy · pega o último objeto/array)
  try {
    const m = texto.match(/\{[\s\S]*"leads"[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
  } catch {}
  return null;
}

function pickIdentificador(lead: any, canal: string): string {
  return String(
    lead.url || lead.url_linkedin || lead.instagram || lead.username_instagram || lead.nome_evento || lead.nome || canal,
  ).slice(0, 200);
}

function montarPayloadPool(lead: any, canal: string, cfgFonte: string, cidadeBriefing: string): any {
  const tagsBrutas = Array.isArray(lead.tags) ? lead.tags.map((t: any) => String(t).slice(0, 30)).slice(0, 6) : [];
  // Categoria_setorial por canal
  const categoriaPorCanal: Record<string, string> = {
    web_compradores: "comprador_potencial",
    web_influenciadores: "influenciador",
    web_eventos: "evento_setor",
    web_corretores: "corretor_local",
    web_profissionais: "profissional_setor",
  };
  return {
    identificador: pickIdentificador(lead, canal),
    nome: lead.nome || lead.nome_evento || "(sem nome)",
    cidade: lead.cidade || cidadeBriefing || null,
    website: lead.url || lead.url_linkedin || null,
    telefone: lead.telefone_publico || null,
    categoria_setorial: categoriaPorCanal[canal] || "outros",
    tags: [canal, ...(tagsBrutas.length ? tagsBrutas : [])],
    bruto: { ...lead, _canal_origem: canal, _fonte: cfgFonte },
  };
}

async function upsertGlobalEUso(
  adminClient: any,
  originacao_id: string,
  arquetipo_id: string | null,
  canal: string,
  payload: any,
): Promise<"ins" | "dup" | "err"> {
  if (!payload.identificador) return "err";
  // v9.34.2 · canal direto · CHECK agora aceita web_* (fix_canal_web migration)
  const { data: upserted, error: errUp } = await adminClient
    .from("pool_contatos_global")
    .upsert({
      identificador_canonico: payload.identificador,
      fonte_origem: "manual_admin",
      nome: payload.nome,
      telefone: payload.telefone || null,
      website: payload.website || null,
      cidade: payload.cidade,
      categoria_setorial: payload.categoria_setorial,
      tags_consolidadas: payload.tags || null,
      dados_brutos: payload.bruto,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "identificador_canonico,fonte_origem" })
    .select("id")
    .maybeSingle();
  if (errUp || !upserted) {
    console.error("[claude-web] upsert err", errUp?.message);
    return "err";
  }
  const { error: errUso } = await adminClient
    .from("pool_contatos_uso")
    .insert({
      contato_id: upserted.id,
      originacao_id,
      arquetipo_id,
      canal: canal, // v9.34.2 · salva direto (web_compradores, web_eventos, etc)
      status: "novo",
    });
  if (errUso) {
    if (errUso.code === "23505") return "dup";
    console.error("[claude-web] uso err", errUso.message);
    return "err";
  }
  return "ins";
}

async function processarArquetipo(
  adminClient: any,
  originacao_id: string,
  canal: string,
  arq: any,
  briefing: any,
): Promise<any> {
  const base: any = { arquetipo_id: arq.id, nome: arq.nome, queries: 0, inseridos: 0, duplicados: 0, total_retornado: 0, tokens_in: 0, tokens_out: 0 };
  try {
    const queries: string[] = arq.queries_busca?.[canal] || [];
    if (!Array.isArray(queries) || queries.length === 0) {
      return { ...base, erro: `sem_${canal}_queries` };
    }
    base.queries = queries.length;
    const systemPrompt = promptSistema(canal, briefing, arq);
    const r = await chamarClaudeWeb(systemPrompt, queries);
    base.tokens_in = r.tokensIn || 0;
    base.tokens_out = r.tokensOut || 0;
    if (!r.ok) return { ...base, erro: r.erro };

    const parsed = extrairJson(r.texto || "");
    if (!parsed || !Array.isArray(parsed.leads)) {
      return { ...base, erro: "json_parse_falhou", raw: (r.texto || "").slice(0, 200) };
    }
    base.total_retornado = parsed.leads.length;

    const cidadeBriefing = briefing?.negocio?.cidade || "";
    for (const lead of parsed.leads) {
      const payload = montarPayloadPool(lead, canal, "claude_web", cidadeBriefing);
      const status = await upsertGlobalEUso(adminClient, originacao_id, arq.id, canal, payload);
      if (status === "ins") base.inseridos++;
      else if (status === "dup") base.duplicados++;
    }
    return base;
  } catch (e: any) {
    return { ...base, erro: `exception · ${e?.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { originacao_id, canal, arquetipo_id } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });
  if (!canal || !CANAIS_VALIDOS.includes(canal)) {
    return resp(400, { ok: false, erro: "canal_invalido", canais_validos: CANAIS_VALIDOS });
  }

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao").select("id, fase_atual, briefing_jsonb, gasto_anthropic_mes")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });
    if (orig.fase_atual !== "leads") {
      return resp(400, { ok: false, erro: "fase_invalida", detalhe: `fase: ${orig.fase_atual}` });
    }

    let arqQuery = adminClient
      .from("arquetipos_compradores")
      .select("id, nome, perfil, capacidade_financeira, queries_busca")
      .eq("originacao_id", originacao_id)
      .eq("status", "aprovado")
      .not("queries_busca", "is", null)
      .order("ordem", { ascending: true });
    if (arquetipo_id) arqQuery = arqQuery.eq("id", arquetipo_id);
    const { data: arquetipos, error: errArq } = await arqQuery;
    if (errArq) return resp(500, { ok: false, erro: "fetch_arquetipos_falhou", detalhe: errArq.message });
    if (!arquetipos || arquetipos.length === 0) return resp(400, { ok: false, erro: "nenhum_arquetipo_com_queries" });

    // v9.34.4 Sprint 5 b2 · queries_override (Passo B do painel) tem prioridade pro canal
    const queriesOverride = Array.isArray(body?.queries_override)
      ? body.queries_override.map((q: any) => String(q).trim()).filter(Boolean)
      : [];

    // Sequencial (Claude web pode demorar 30-60s · paralelo arriscaria rate limit)
    const porArquetipo: any[] = [];
    for (const arq of arquetipos) {
      const arqEfetivo = queriesOverride.length > 0
        ? { ...arq, queries_busca: { ...(arq.queries_busca || {}), [canal]: queriesOverride } }
        : arq;
      const r = await processarArquetipo(adminClient, originacao_id, canal, arqEfetivo, orig.briefing_jsonb);
      porArquetipo.push(r);
    }

    const totalInseridos = porArquetipo.reduce((acc: number, x: any) => acc + (x.inseridos || 0), 0);
    const custoEstimado = +(arquetipos.length * CUSTO_POR_ARQ_BRL).toFixed(2);

    // Atualiza gasto_anthropic_mes
    await adminClient
      .from("projetos_originacao")
      .update({
        gasto_anthropic_mes: Number(orig.gasto_anthropic_mes || 0) + custoEstimado,
        updated_at: new Date().toISOString(),
      })
      .eq("id", originacao_id);

    return resp(200, {
      ok: true,
      canal,
      por_arquetipo: porArquetipo,
      total_inseridos: totalInseridos,
      custo_anthropic_brl_estimado: custoEstimado,
    });
  } catch (e: any) {
    console.error("[claude-web] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
