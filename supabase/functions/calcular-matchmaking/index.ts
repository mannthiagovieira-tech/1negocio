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
  setores: string[] | null; formas_atuacao: string[] | null;
  localizacao_tipo: string | null; estado: string | null; cidade: string | null;
  valor_alvo: number | null; usuario_id: string | null; status: string;
};
type Negocio = {
  id: string; codigo?: string | null; nome?: string | null;
  setor: string | null; formas_atuacao: string[] | null;
  estado: string | null; cidade: string | null;
  status: string; avaliacao_min: number | null; avaliacao_max: number | null;
  score_saude: number | null; publicado_em: string | null; vendedor_id: string | null;
};

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

async function analisarPerfilOculto(userId: string | null, setor: string | null, estado: string | null): Promise<number> {
  if (!userId || !setor || !estado) return 0;
  try {
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await adminClient
      .from("eventos_usuario")
      .select("*", { count: "exact", head: true })
      .eq("usuario_id", userId)
      .eq("entidade_tipo", "negocio")
      .gte("created_at", desde);
    if (!count || count < 5) return 0;
    const { data } = await adminClient.rpc("contar_eventos_negocios_similares", {
      p_user_id: userId, p_setor: setor, p_estado: estado, p_dias: 30,
    });
    const views = Number(data?.[0]?.views ?? 0);
    if (views >= 20) return 1.5;
    if (views >= 10) return 1;
    if (views >= 5) return 0.5;
    return 0;
  } catch { return 0; }
}

export async function calcularMatchPar(tese: Tese, negocio: Negocio, tagsAdmin: string[] | null): Promise<ResultadoMatch> {
  const fatores: Fator[] = [];

  // ───── Eliminatórios ─────
  if (negocio.status && !STATUSES_ELEGIVEIS.has(negocio.status)) {
    return elim(`status:${negocio.status}`, fatores);
  }
  const setores = tese.setores || [];
  const aceitaIndiferente = setores.includes("indiferente");
  if (negocio.setor && !aceitaIndiferente && setores.length > 0 && !setores.includes(negocio.setor)) {
    return elim(`setor:${negocio.setor}_nao_em_${setores.join("/")}`, fatores);
  }
  if (tese.localizacao_tipo && tese.localizacao_tipo !== "brasil_todo") {
    if (tese.estado && negocio.estado && tese.estado !== negocio.estado) {
      return elim(`estado:${negocio.estado}_vs_${tese.estado}`, fatores);
    }
    if (tese.localizacao_tipo === "cidade" && tese.cidade && negocio.cidade && tese.cidade !== negocio.cidade) {
      return elim(`cidade:${negocio.cidade}_vs_${tese.cidade}`, fatores);
    }
  }
  if (tese.valor_alvo != null && negocio.avaliacao_max != null) {
    const piso = tese.valor_alvo * 0.7;
    const teto = tese.valor_alvo * 1.3;
    if (negocio.avaliacao_max < piso) return elim(`ticket_baixo:${negocio.avaliacao_max}_vs_${tese.valor_alvo}`, fatores);
    if (negocio.avaliacao_max > teto) return elim(`ticket_alto:${negocio.avaliacao_max}_vs_${tese.valor_alvo}`, fatores);
  }

  // ───── Pontuação positiva (0-100 base) ─────

  // SETOR (25pts)
  if (aceitaIndiferente) {
    fatores.push({ codigo: `setor:indiferente`, pontos: 25 });
  } else if (negocio.setor && setores.includes(negocio.setor)) {
    fatores.push({ codigo: `setor:${negocio.setor}`, pontos: 25 });
  }

  // LOCALIZAÇÃO (até 25pts)
  if (tese.localizacao_tipo === "brasil_todo" || !tese.localizacao_tipo) {
    fatores.push({ codigo: `localizacao:brasil_todo`, pontos: 10 });
  } else if (tese.estado && negocio.estado && tese.estado === negocio.estado) {
    let p = 15;
    fatores.push({ codigo: `estado:${negocio.estado}`, pontos: 15 });
    if (tese.cidade && negocio.cidade && tese.cidade === negocio.cidade) {
      p = 25;
      fatores.push({ codigo: `cidade:${negocio.cidade}`, pontos: 10 });
    }
  }

  // TICKET (até 20pts) · proximidade ao valor_alvo
  if (tese.valor_alvo != null && negocio.avaliacao_max != null) {
    const distRel = Math.abs(negocio.avaliacao_max - tese.valor_alvo) / tese.valor_alvo;
    const tol = 0.30;
    const p = Math.round(20 * (1 - Math.min(distRel / tol, 1)));
    if (p > 0) {
      const prox = Math.round((1 - Math.min(distRel / tol, 1)) * 100);
      fatores.push({ codigo: `ticket_proximidade:${prox}%`, pontos: p });
    }
  }

  // MODELO (10pts) · interseção formas_atuacao tese × negócio
  if (tese.formas_atuacao && Array.isArray(tese.formas_atuacao) && tese.formas_atuacao.length > 0
      && negocio.formas_atuacao && Array.isArray(negocio.formas_atuacao) && negocio.formas_atuacao.length > 0) {
    const interseccao = tese.formas_atuacao.filter((f) => negocio.formas_atuacao!.includes(f));
    if (interseccao.length > 0) {
      fatores.push({ codigo: `modelo:${interseccao.join(",")}`, pontos: 10 });
    }
  }

  // ISE (até 10pts) · alinhado com 5 faixas nomeadas (skill v2)
  if (typeof negocio.score_saude === "number") {
    if (negocio.score_saude >= 85) fatores.push({ codigo: `ise_estruturado:${negocio.score_saude}`, pontos: 10 });
    else if (negocio.score_saude >= 70) fatores.push({ codigo: `ise_consolidado:${negocio.score_saude}`, pontos: 7 });
    else if (negocio.score_saude >= 50) fatores.push({ codigo: `ise_operacional:${negocio.score_saude}`, pontos: 4 });
  }

  // PERFIL OCULTO (até 5pts)
  const perfilPts = await analisarPerfilOculto(tese.usuario_id, negocio.setor, negocio.estado);
  if (perfilPts > 0) {
    const niv = perfilPts >= 1.5 ? 5 : perfilPts >= 1 ? 3 : 1;
    fatores.push({ codigo: `perfil_compatibilidade:${niv}`, pontos: Math.round(perfilPts) });
  }

  const scoreBase = fatores.reduce((s, f) => s + f.pontos, 0);
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

async function processarParaTese(tese: Tese, salvar: boolean, origem: string, cronExecId?: string | null) {
  // Pré-filtro SQL · reduz pares
  let query = adminClient.from("negocios")
    .select("id,codigo,nome,setor,formas_atuacao,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id");
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
    const rows = top.map(({ negocio, res }) => ({
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
    }));
    // Upsert por (tese_id, negocio_id)
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
    const { data: neg } = await adminClient.from("negocios").select("id,codigo,nome,setor,formas_atuacao,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id").eq("id", body.negocio_id).single();
    if (!tese || !neg) return json({ ok: false, error: "tese ou negocio nao encontrado" }, 404);
    const tagsAdmin = await getTagsAdmin(tese.usuario_id);
    const res = await calcularMatchPar(tese as Tese, neg as Negocio, tagsAdmin);
    if (salvar && !res.eliminado && res.score_final >= 30) {
      await adminClient.from("matchmaking_resultados").upsert({
        tese_id: tese.id, negocio_id: neg.id, comprador_id: tese.usuario_id, vendedor_id: neg.vendedor_id,
        score_100: res.score_final, score_5_10: res.score_5_10,
        fatores_casados: res.fatores, tags_aplicadas: res.tags_aplicadas,
        origem, status: "pendente",
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
    const { data: neg } = await adminClient.from("negocios").select("id,codigo,nome,setor,formas_atuacao,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id").eq("id", body.negocio_id).single();
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
      const rows = top.map(({ tese, res }) => ({
        tese_id: tese.id, negocio_id: (neg as any).id, comprador_id: tese.usuario_id, vendedor_id: (neg as any).vendedor_id,
        score_100: res.score_final, score_5_10: res.score_5_10,
        fatores_casados: res.fatores, tags_aplicadas: res.tags_aplicadas,
        origem: origem || "manual_negocio", status: "pendente",
      }));
      await adminClient.from("matchmaking_resultados").upsert(rows, { onConflict: "tese_id,negocio_id" });
    }
    return json({ ok: true, modo, avaliados: (teses || []).length, gerados: top.length, top });
  }

  return json({ ok: false, error: "modo invalido (par|tese|negocio)" }, 400);
});
