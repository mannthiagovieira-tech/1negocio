// calcular-matchmaking · V7 FASE A · 1negocio.com.br
// Score 0-100 entre tese × negócio · com fatores casados + pontuação tags admin
// Auth: service_role (cron) OU admin via JWT phone match

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { aplicarTags, type TagAplicada } from "../_shared/matchmaking-tags.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

function json(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const STATUSES_ELEGIVEIS = new Set(["publicado", "em_negociacao", "em_avaliacao", "aguardando_aprovacao", "rascunho"]);

type Tese = {
  id: string; codigo?: string | null; titulo?: string | null; tese_descricao?: string | null;
  descricao_curta?: string | null;
  setores: string[] | null; formas_atuacao: string[] | null;
  localizacao_tipo: string | null; estado: string | null; cidade: string | null;
  valor_alvo: number | null; usuario_id: string | null; status: string;
};
type Negocio = {
  id: string; codigo?: string | null; nome?: string | null;
  setor: string | null; formas_atuacao: string[] | null;
  descricao_curta?: string | null;
  estado: string | null; cidade: string | null;
  status: string; avaliacao_min: number | null; avaliacao_max: number | null;
  score_saude: number | null; publicado_em: string | null; vendedor_id: string | null;
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function compararSemantico(descNeg: string | null, descTese: string | null): Promise<{ score: 0 | 50 | 100; razao: string }> {
  if (!descNeg || !descTese || descNeg.length < 5 || descTese.length < 5) return { score: 50, razao: "descricao_ausente" };
  const hash = await sha256Hex(descNeg.toLowerCase().trim() + "||" + descTese.toLowerCase().trim());
  // Cache check
  try {
    const { data: cached } = await adminClient.from("matchmaking_semantica_cache").select("score, razao").eq("hash_par", hash).maybeSingle();
    if (cached) return { score: cached.score as 0 | 50 | 100, razao: cached.razao || "cache" };
  } catch {}
  if (!ANTHROPIC_API_KEY) return { score: 50, razao: "sem_api_key" };
  const prompt = `Compare semanticamente as duas descrições abaixo.

NEGÓCIO: "${descNeg}"
TESE (busca do comprador): "${descTese}"

REGRAS:
- Identifique o NÚCLEO SEMÂNTICO de cada um (substantivo + adjetivo principal).
- Palavras AMPLAS (loja · comércio · empresa · negócio · serviço) NÃO contam como match.
- O match real está no que vem DEPOIS dessas palavras.

EXEMPLOS:
"Loja de roupas femininas" vs "Loja de equipamentos de TI" → SEM_RELACAO
"Pet shop" vs "Pet shop com banho e tosa" → MATCH (núcleo: pet shop)
"Distribuidora de alimentos" vs "Distribuidora de eletrônicos" → SEM_RELACAO
"Restaurante mexicano" vs "Restaurante delivery mexicano" → MATCH
"Clínica de fisioterapia" vs "Clínica odontológica" → SEM_RELACAO

Responda APENAS uma destas três strings · sem explicação · sem markdown:
MATCH (núcleos compatíveis)
PARCIAL (mesma família mas especialidade diferente)
SEM_RELACAO (núcleos divergentes)`;
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 20, messages: [{ role: "user", content: prompt }] }),
    });
    if (!resp.ok) return { score: 50, razao: `haiku_${resp.status}` };
    const data = await resp.json();
    const txt = (data.content?.[0]?.text || "").trim().toUpperCase();
    let score: 0 | 50 | 100 = 50; let razao = "haiku_resposta_invalida";
    if (txt.includes("SEM_RELACAO")) { score = 0; razao = "nucleo_divergente"; }
    else if (txt.includes("MATCH")) { score = 100; razao = "nucleo_compativel"; }
    else if (txt.includes("PARCIAL")) { score = 50; razao = "mesma_familia"; }
    try { await adminClient.from("matchmaking_semantica_cache").insert({ hash_par: hash, score, razao }); } catch {}
    return { score, razao };
  } catch (e) {
    return { score: 50, razao: "haiku_erro" };
  }
}

type Fator = { codigo: string; pontos: number; detalhe?: string };

export type ResultadoMatch = {
  eliminado: boolean;
  motivo_eliminado?: string;
  score_base: number;
  score_final: number;
  score_5_10: number;
  fatores: Fator[];
  tags_aplicadas: TagAplicada[];
};

function calcularScore510(s: number): number {
  if (s >= 90) return 10;
  if (s >= 80) return 9;
  if (s >= 70) return 8;
  if (s >= 60) return 7;
  if (s >= 50) return 6;
  return 5;
}

// Pesos V7 BLOCO 5: Setor 40 · Forma 35 · Loc 10 · Ticket 10 · ISE 5 = 100

export async function calcularMatchPar(tese: Tese, negocio: Negocio, tagsAdmin: string[] | null): Promise<ResultadoMatch> {
  const fatores: Fator[] = [];

  // ───── Eliminatórios ─────
  if (negocio.status && !STATUSES_ELEGIVEIS.has(negocio.status)) {
    return elim(`status:${negocio.status}`, fatores);
  }

  // SETOR (40pts · eliminatório quando declarado)
  const setores = tese.setores || [];
  const aceitaIndiferente = setores.includes("indiferente");
  let pontosSetor = 0;
  if (setores.length > 0) {
    if (aceitaIndiferente) {
      pontosSetor = 40;
      fatores.push({ codigo: `setor:indiferente`, pontos: 40 });
    } else if (negocio.setor && setores.includes(negocio.setor)) {
      pontosSetor = 40;
      fatores.push({ codigo: `setor:${negocio.setor}`, pontos: 40 });
    } else {
      return elim(`setor:${negocio.setor}_nao_em_${setores.join("/")}`, fatores);
    }
  }

  // FORMA (35pts · eliminatório quando tese declarou · lógica A: intersecção 1+)
  let pontosForma = 0;
  const teseTemForma = Array.isArray(tese.formas_atuacao) && tese.formas_atuacao.length > 0;
  const negocioTemForma = Array.isArray(negocio.formas_atuacao) && negocio.formas_atuacao.length > 0;
  if (teseTemForma) {
    if (!negocioTemForma) {
      return elim(`forma:tese_exige_negocio_sem`, fatores);
    }
    const interseccao = tese.formas_atuacao!.filter((f) => negocio.formas_atuacao!.includes(f));
    if (interseccao.length === 0) {
      return elim(`forma:sem_interseccao_${tese.formas_atuacao!.join("/")}_vs_${negocio.formas_atuacao!.join("/")}`, fatores);
    }
    pontosForma = 35;
    fatores.push({ codigo: `forma:${interseccao.join(",")}`, pontos: 35 });
  }

  // LOCALIZAÇÃO (até 10pts · eliminatório quando declarado)
  let pontosLoc = 0;
  if (tese.localizacao_tipo === "brasil_todo" || !tese.localizacao_tipo) {
    pontosLoc = 5;
    fatores.push({ codigo: `localizacao:brasil_todo`, pontos: 5 });
  } else if (tese.localizacao_tipo === "estado") {
    if (tese.estado && negocio.estado && tese.estado !== negocio.estado) {
      return elim(`estado:${negocio.estado}_vs_${tese.estado}`, fatores);
    }
    pontosLoc = 8;
    if (negocio.estado) fatores.push({ codigo: `estado:${negocio.estado}`, pontos: 8 });
  } else if (tese.localizacao_tipo === "cidade") {
    if (tese.estado && negocio.estado && tese.estado !== negocio.estado) {
      return elim(`estado:${negocio.estado}_vs_${tese.estado}`, fatores);
    }
    if (tese.cidade && negocio.cidade && tese.cidade !== negocio.cidade) {
      pontosLoc = 7;
      fatores.push({ codigo: `estado:${negocio.estado}`, pontos: 7 });
    } else {
      pontosLoc = 10;
      if (negocio.cidade) fatores.push({ codigo: `cidade:${negocio.cidade}`, pontos: 10 });
    }
  }

  // TICKET (até 10pts · eliminatório ±30%)
  let pontosTicket = 0;
  if (tese.valor_alvo != null && negocio.avaliacao_max != null) {
    const piso = tese.valor_alvo * 0.7;
    const teto = tese.valor_alvo * 1.3;
    if (negocio.avaliacao_max < piso) return elim(`ticket_baixo:${negocio.avaliacao_max}_vs_${tese.valor_alvo}`, fatores);
    if (negocio.avaliacao_max > teto) return elim(`ticket_alto:${negocio.avaliacao_max}_vs_${tese.valor_alvo}`, fatores);
    const distRel = Math.abs(negocio.avaliacao_max - tese.valor_alvo) / tese.valor_alvo;
    const p = Math.round(10 * (1 - Math.min(distRel / 0.30, 1)));
    if (p > 0) {
      const prox = Math.round((1 - Math.min(distRel / 0.30, 1)) * 100);
      pontosTicket = p;
      fatores.push({ codigo: `ticket_proximidade:${prox}%`, pontos: p });
    }
  }

  // ISE (até 5pts · 5 faixas nomeadas · skill v2)
  let pontosISE = 0;
  if (typeof negocio.score_saude === "number") {
    if (negocio.score_saude >= 85) { pontosISE = 5; fatores.push({ codigo: `ise_estruturado:${negocio.score_saude}`, pontos: 5 }); }
    else if (negocio.score_saude >= 70) { pontosISE = 3; fatores.push({ codigo: `ise_consolidado:${negocio.score_saude}`, pontos: 3 }); }
    else if (negocio.score_saude >= 50) { pontosISE = 1; fatores.push({ codigo: `ise_operacional:${negocio.score_saude}`, pontos: 1 }); }
  }

  // SEMÂNTICA (até 10pts bonus · eliminatória suave SEM_RELACAO)
  const semantica = await compararSemantico(negocio.descricao_curta || null, tese.descricao_curta || null);
  if (semantica.score === 0) return elim(`semantica:${semantica.razao}`, fatores);
  let pontosSemantica = 0;
  if (semantica.score === 100) {
    pontosSemantica = 10;
    fatores.push({ codigo: `semantica:${semantica.razao}`, pontos: 10 });
  }

  const scoreBaseRaw = pontosSetor + pontosForma + pontosLoc + pontosTicket + pontosISE + pontosSemantica;
  const scoreBase = Math.min(scoreBaseRaw, 100);
  const { score: scoreFinal, aplicadas } = aplicarTags(scoreBase, tagsAdmin);

  return {
    eliminado: false,
    score_base: scoreBase,
    score_final: scoreFinal,
    score_5_10: calcularScore510(scoreFinal),
    fatores,
    tags_aplicadas: aplicadas,
  };
}

function elim(motivo: string, fatores: Fator[]): ResultadoMatch {
  return {
    eliminado: true,
    motivo_eliminado: motivo,
    score_base: 0,
    score_final: 0,
    score_5_10: 5,
    fatores,
    tags_aplicadas: [],
  };
}

// ─── Auth gate (mesmo padrão maquininha-teses) ───
function decodeJwtPayload(t: string): any | null {
  try {
    const p = t.split(".");
    if (p.length !== 3) return null;
    const b64 = p[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch { return null; }
}
async function gateAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  const payload = decodeJwtPayload(token);
  if (payload?.role === "service_role") return true;
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return false;
    const { count } = await adminClient.from("admins").select("id", { count: "exact", head: true })
      .eq("whatsapp", data.user.phone).eq("ativo", true);
    return (count ?? 0) > 0;
  } catch { return false; }
}

async function getTagsAdmin(userId: string | null): Promise<string[]> {
  if (!userId) return [];
  try {
    const { data } = await adminClient.from("compradores_perfil").select("tags_admin").eq("user_id", userId).maybeSingle();
    return Array.isArray(data?.tags_admin) ? data!.tags_admin : [];
  } catch { return []; }
}

type Contato = { id: string; phone: string | null; nome: string | null; email: string | null; eh_seed: boolean };

async function getContato(userId: string | null): Promise<Contato | null> {
  if (!userId) return null;
  try {
    const { data } = await adminClient.rpc("get_user_contato", { p_user_id: userId });
    if (Array.isArray(data) && data.length > 0) return data[0] as Contato;
    return null;
  } catch { return null; }
}

function contatoFields(comprador: Contato | null, vendedor: Contato | null) {
  return {
    comprador_phone: comprador?.phone ?? null,
    comprador_nome: comprador?.nome ?? null,
    vendedor_phone: vendedor?.phone ?? null,
    vendedor_nome: vendedor?.nome ?? null,
    vendedor_eh_seed: vendedor?.eh_seed ?? false,
  };
}

async function processarParaTese(tese: Tese, salvar: boolean, origem: string, cronExecId?: string | null) {
  // Pré-filtro SQL · reduz pares
  let query = adminClient.from("negocios")
    .select("id,codigo,nome,setor,formas_atuacao,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id,descricao_curta");
  query = query.in("status", Array.from(STATUSES_ELEGIVEIS));
  // Setor
  const setoresArr = tese.setores || [];
  if (!setoresArr.includes("indiferente") && setoresArr.length > 0) {
    query = query.in("setor", setoresArr);
  }
  // Estado
  if (tese.localizacao_tipo && tese.localizacao_tipo !== "brasil_todo" && tese.estado) {
    query = query.eq("estado", tese.estado);
  }
  // Ticket
  if (tese.valor_alvo != null) {
    const piso = tese.valor_alvo * 0.7;
    const teto = tese.valor_alvo * 1.3;
    query = query.or(`avaliacao_max.is.null,and(avaliacao_max.gte.${piso},avaliacao_max.lte.${teto})`);
  }
  const { data: candidatos, error } = await query.limit(500);
  if (error || !candidatos) return { avaliados: 0, gerados: 0, top: [] as any[] };

  const tagsAdmin = await getTagsAdmin(tese.usuario_id);
  const resultados: Array<{ negocio: Negocio; res: ResultadoMatch }> = [];
  for (const n of candidatos as Negocio[]) {
    const res = await calcularMatchPar(tese, n, tagsAdmin);
    if (!res.eliminado && res.score_final >= 30) resultados.push({ negocio: n, res });
  }
  resultados.sort((a, b) => b.res.score_final - a.res.score_final);
  const top = resultados.slice(0, 10);

  if (salvar && top.length) {
    const comprador = await getContato(tese.usuario_id);
    const vendedoresCache: Record<string, Contato | null> = {};
    const rows = await Promise.all(top.map(async ({ negocio, res }) => {
      const vid = negocio.vendedor_id || "";
      if (vid && !(vid in vendedoresCache)) vendedoresCache[vid] = await getContato(vid);
      const vendedor = vid ? vendedoresCache[vid] : null;
      return {
        tese_id: tese.id,
        negocio_id: negocio.id,
        comprador_id: tese.usuario_id,
        vendedor_id: negocio.vendedor_id,
        score_100: res.score_final,
        score_5_10: res.score_5_10,
        fatores_casados: res.fatores,
        tags_aplicadas: res.tags_aplicadas,
        origem,
        cron_execucao_id: cronExecId ?? null,
        status: "pendente",
        ...contatoFields(comprador, vendedor),
      };
    }));
    await adminClient.from("matchmaking_resultados").upsert(rows, { onConflict: "tese_id,negocio_id" });
  }
  return { avaliados: candidatos.length, gerados: top.length, top };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo nao permitido" }, 405);
  if (!(await gateAdmin(req))) return json({ ok: false, error: "admin ou service_role required" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "JSON invalido" }, 400); }

  const modo = body.modo || "par";
  const salvar = body.salvar === true;
  const origem = body.origem || (salvar ? "manual_busca" : "manual_busca");

  if (modo === "par") {
    if (!body.tese_id || !body.negocio_id) return json({ ok: false, error: "tese_id e negocio_id obrigatorios" }, 400);
    const { data: tese } = await adminClient.from("teses_investimento").select("*").eq("id", body.tese_id).single();
    const { data: neg } = await adminClient.from("negocios_com_descricao").select("id,codigo,nome,setor,formas_atuacao,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id,descricao_curta").eq("id", body.negocio_id).single();
    if (!tese || !neg) return json({ ok: false, error: "tese ou negocio nao encontrado" }, 404);
    const tagsAdmin = await getTagsAdmin(tese.usuario_id);
    const res = await calcularMatchPar(tese as Tese, neg as Negocio, tagsAdmin);
    if (salvar && !res.eliminado && res.score_final >= 30) {
      const comprador = await getContato(tese.usuario_id);
      const vendedor = await getContato(neg.vendedor_id);
      await adminClient.from("matchmaking_resultados").upsert({
        tese_id: tese.id, negocio_id: neg.id, comprador_id: tese.usuario_id, vendedor_id: neg.vendedor_id,
        score_100: res.score_final, score_5_10: res.score_5_10,
        fatores_casados: res.fatores, tags_aplicadas: res.tags_aplicadas,
        origem, status: "pendente",
        ...contatoFields(comprador, vendedor),
      }, { onConflict: "tese_id,negocio_id" });
    }
    return json({ ok: true, modo, resultado: res });
  }

  if (modo === "tese") {
    if (!body.tese_id) return json({ ok: false, error: "tese_id obrigatorio" }, 400);
    const { data: tese } = await adminClient.from("teses_investimento").select("*").eq("id", body.tese_id).single();
    if (!tese) return json({ ok: false, error: "tese nao encontrada" }, 404);
    const r = await processarParaTese(tese as Tese, salvar, origem || "manual_perfil");
    return json({ ok: true, modo, ...r });
  }

  if (modo === "negocio") {
    if (!body.negocio_id) return json({ ok: false, error: "negocio_id obrigatorio" }, 400);
    // tese vs negocio: itera teses ativas · usa pré-filtro inverso
    const { data: neg } = await adminClient.from("negocios_com_descricao").select("id,codigo,nome,setor,formas_atuacao,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id,descricao_curta").eq("id", body.negocio_id).single();
    if (!neg) return json({ ok: false, error: "negocio nao encontrado" }, 404);
    const { data: teses } = await adminClient.from("teses_investimento").select("*").eq("status", "ativa").limit(500);
    const arr: Array<{ tese: Tese; res: ResultadoMatch }> = [];
    for (const t of (teses || []) as Tese[]) {
      const tagsAdmin = await getTagsAdmin(t.usuario_id);
      const res = await calcularMatchPar(t, neg as Negocio, tagsAdmin);
      if (!res.eliminado && res.score_final >= 30) arr.push({ tese: t, res });
    }
    arr.sort((a, b) => b.res.score_final - a.res.score_final);
    const top = arr.slice(0, 10);
    if (salvar && top.length) {
      const vendedor = await getContato((neg as any).vendedor_id);
      const compradoresCache: Record<string, Contato | null> = {};
      const rows = await Promise.all(top.map(async ({ tese, res }) => {
        const cid = tese.usuario_id || "";
        if (cid && !(cid in compradoresCache)) compradoresCache[cid] = await getContato(cid);
        const comprador = cid ? compradoresCache[cid] : null;
        return {
          tese_id: tese.id, negocio_id: (neg as any).id, comprador_id: tese.usuario_id, vendedor_id: (neg as any).vendedor_id,
          score_100: res.score_final, score_5_10: res.score_5_10,
          fatores_casados: res.fatores, tags_aplicadas: res.tags_aplicadas,
          origem: origem || "manual_negocio", status: "pendente",
          ...contatoFields(comprador, vendedor),
        };
      }));
      await adminClient.from("matchmaking_resultados").upsert(rows, { onConflict: "tese_id,negocio_id" });
    }
    return json({ ok: true, modo, avaliados: (teses || []).length, gerados: top.length, top });
  }

  return json({ ok: false, error: "modo invalido (par|tese|negocio)" }, 400);
});
