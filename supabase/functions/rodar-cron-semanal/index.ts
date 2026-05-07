// rodar-cron-semanal · V7 FASE A · 1negocio.com.br
// Itera todas teses ativas · gera/atualiza top 10 matches por tese
// SEM cron pg_cron ativo · invocação manual via UI/curl service_role

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
const STATUSES_ELEGIVEIS = ["publicado", "em_negociacao", "em_avaliacao", "aguardando_aprovacao", "rascunho"];

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
async function gateAdmin(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return true;
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return false;
    const { count } = await adminClient.from("admins").select("id", { count: "exact", head: true })
      .eq("whatsapp", data.user.phone).eq("ativo", true);
    return (count ?? 0) > 0;
  } catch { return false; }
}

function calcularScore510(s: number): number {
  if (s >= 90) return 10; if (s >= 80) return 9; if (s >= 70) return 8;
  if (s >= 60) return 7; if (s >= 50) return 6; return 5;
}

async function analisarPerfilOculto(userId: string | null, setor: string | null, estado: string | null): Promise<number> {
  if (!userId || !setor || !estado) return 0;
  try {
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count } = await adminClient.from("eventos_usuario").select("*", { count: "exact", head: true })
      .eq("usuario_id", userId).eq("entidade_tipo", "negocio").gte("created_at", desde);
    if (!count || count < 5) return 0;
    const { data } = await adminClient.rpc("contar_eventos_negocios_similares", {
      p_user_id: userId, p_setor: setor, p_estado: estado, p_dias: 30,
    });
    const views = Number(data?.[0]?.views ?? 0);
    if (views >= 20) return 1.5; if (views >= 10) return 1; if (views >= 5) return 0.5;
    return 0;
  } catch { return 0; }
}

type Tese = any; type Negocio = any;
type Fator = { codigo: string; pontos: number };

async function calcularMatchPar(tese: Tese, neg: Negocio, tagsAdmin: string[]) {
  const fatores: Fator[] = [];
  if (neg.status && !STATUSES_ELEGIVEIS.includes(neg.status)) return null;
  const setores = tese.setores || [];
  const aceitaIndif = setores.includes("indiferente");
  if (neg.setor && !aceitaIndif && setores.length > 0 && !setores.includes(neg.setor)) return null;
  if (tese.localizacao_tipo && tese.localizacao_tipo !== "brasil_todo") {
    if (tese.estado && neg.estado && tese.estado !== neg.estado) return null;
    if (tese.localizacao_tipo === "cidade" && tese.cidade && neg.cidade && tese.cidade !== neg.cidade) return null;
  }
  if (tese.valor_alvo != null && neg.avaliacao_max != null) {
    if (neg.avaliacao_max < tese.valor_alvo * 0.7 || neg.avaliacao_max > tese.valor_alvo * 1.3) return null;
  }
  // Pontos
  if (aceitaIndif) fatores.push({ codigo: "setor:indiferente", pontos: 25 });
  else if (neg.setor && setores.includes(neg.setor)) fatores.push({ codigo: `setor:${neg.setor}`, pontos: 25 });
  if (tese.localizacao_tipo === "brasil_todo" || !tese.localizacao_tipo) fatores.push({ codigo: "localizacao:brasil_todo", pontos: 10 });
  else if (tese.estado && neg.estado && tese.estado === neg.estado) {
    fatores.push({ codigo: `estado:${neg.estado}`, pontos: 15 });
    if (tese.cidade && neg.cidade && tese.cidade === neg.cidade) fatores.push({ codigo: `cidade:${neg.cidade}`, pontos: 10 });
  }
  if (tese.valor_alvo != null && neg.avaliacao_max != null) {
    const dist = Math.abs(neg.avaliacao_max - tese.valor_alvo) / tese.valor_alvo;
    const p = Math.round(20 * (1 - Math.min(dist / 0.30, 1)));
    if (p > 0) fatores.push({ codigo: `ticket_proximidade:${Math.round((1 - Math.min(dist / 0.30, 1)) * 100)}%`, pontos: p });
  }
  if (typeof neg.score_saude === "number") {
    if (neg.score_saude >= 75) fatores.push({ codigo: `ise_alto:${neg.score_saude}`, pontos: 10 });
    else if (neg.score_saude >= 60) fatores.push({ codigo: `ise_bom:${neg.score_saude}`, pontos: 5 });
  }
  if (neg.publicado_em) {
    const d = (Date.now() - new Date(neg.publicado_em).getTime()) / (24*60*60*1000);
    if (d <= 30) fatores.push({ codigo: "recente:30d", pontos: 5 });
    else if (d <= 90) fatores.push({ codigo: "recente:90d", pontos: 2 });
  }
  const perfilPts = await analisarPerfilOculto(tese.usuario_id, neg.setor, neg.estado);
  if (perfilPts > 0) fatores.push({ codigo: `perfil_compatibilidade:${perfilPts >= 1.5 ? 5 : perfilPts >= 1 ? 3 : 1}`, pontos: Math.round(perfilPts) });

  const scoreBase = fatores.reduce((s, f) => s + f.pontos, 0);
  const { score: scoreFinal, aplicadas } = aplicarTags(scoreBase, tagsAdmin);
  if (scoreFinal < 30) return null;
  return { score: scoreFinal, score510: calcularScore510(scoreFinal), fatores, tags: aplicadas };
}

async function rodarBatch(execId: string, iniciado_por: string | null) {
  const inicio = Date.now();
  const { data: teses } = await adminClient.from("teses_investimento").select("*").eq("status", "ativa").limit(1000);
  if (!teses || !teses.length) {
    await adminClient.from("matchmaking_cron_execucoes").update({
      status: "concluida", concluido_em: new Date().toISOString(), duracao_ms: Date.now() - inicio,
      teses_processadas: 0, matches_gerados: 0,
    }).eq("id", execId);
    return;
  }

  let tesesProc = 0, paresAval = 0, matchesGerados = 0;

  for (let i = 0; i < teses.length; i++) {
    const tese = teses[i] as Tese;
    try {
      // Pré-filtro SQL
      let q = adminClient.from("negocios")
        .select("id,codigo,nome,setor,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id");
      q = q.in("status", STATUSES_ELEGIVEIS);
      const setoresArr = tese.setores || [];
      if (!setoresArr.includes("indiferente") && setoresArr.length > 0) q = q.in("setor", setoresArr);
      if (tese.localizacao_tipo && tese.localizacao_tipo !== "brasil_todo" && tese.estado) q = q.eq("estado", tese.estado);
      if (tese.valor_alvo != null) {
        const piso = tese.valor_alvo * 0.7;
        const teto = tese.valor_alvo * 1.3;
        q = q.or(`avaliacao_max.is.null,and(avaliacao_max.gte.${piso},avaliacao_max.lte.${teto})`);
      }
      const { data: cands } = await q.limit(500);
      if (!cands || !cands.length) { tesesProc++; continue; }

      // Tags admin
      let tagsAdmin: string[] = [];
      if (tese.usuario_id) {
        const { data: cp } = await adminClient.from("compradores_perfil").select("tags_admin").eq("user_id", tese.usuario_id).maybeSingle();
        tagsAdmin = Array.isArray(cp?.tags_admin) ? cp!.tags_admin : [];
      }

      const arr: Array<{ neg: Negocio; r: any }> = [];
      for (const n of cands as Negocio[]) {
        paresAval++;
        const r = await calcularMatchPar(tese, n, tagsAdmin);
        if (r) arr.push({ neg: n, r });
      }
      arr.sort((a, b) => b.r.score - a.r.score);
      const top = arr.slice(0, 10);

      if (top.length) {
        const rows = top.map(({ neg, r }) => ({
          tese_id: tese.id, negocio_id: neg.id,
          comprador_id: tese.usuario_id, vendedor_id: neg.vendedor_id,
          score_100: r.score, score_5_10: r.score510,
          fatores_casados: r.fatores, tags_aplicadas: r.tags,
          origem: "cron_semanal", cron_execucao_id: execId, status: "pendente",
        }));
        const { error: upErr } = await adminClient.from("matchmaking_resultados").upsert(rows, { onConflict: "tese_id,negocio_id" });
        if (!upErr) matchesGerados += top.length;
      }
      tesesProc++;
    } catch (e) {
      console.error(`[cron tese ${tese.id}] err:`, (e as Error).message);
      tesesProc++;
    }

    // Heartbeat a cada 10 teses
    if ((i + 1) % 10 === 0 || i === teses.length - 1) {
      await adminClient.from("matchmaking_cron_execucoes").update({
        teses_processadas: tesesProc,
        pares_avaliados: paresAval,
        matches_gerados: matchesGerados,
      }).eq("id", execId);
    }
  }

  // Final
  await adminClient.from("matchmaking_cron_execucoes").update({
    status: "concluida",
    concluido_em: new Date().toISOString(),
    teses_processadas: tesesProc,
    negocios_processados: 0, // opcional · não rastreamos único
    pares_avaliados: paresAval,
    matches_gerados: matchesGerados,
    duracao_ms: Date.now() - inicio,
  }).eq("id", execId);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo nao permitido" }, 405);
  if (!(await gateAdmin(req))) return json({ ok: false, error: "admin ou service_role required" }, 403);

  let iniciado_por: string | null = null;
  try {
    const auth = (req.headers.get("authorization") || "").slice(7);
    const payload = decodeJwtPayload(auth);
    if (payload?.role !== "service_role") {
      const { data } = await adminClient.auth.getUser(auth);
      iniciado_por = data.user?.id || null;
    }
  } catch {}

  const { data: exec, error: ee } = await adminClient
    .from("matchmaking_cron_execucoes")
    .insert({ tipo: "semanal", status: "rodando", iniciado_por })
    .select("id").single();
  if (ee || !exec?.id) return json({ ok: false, error: "erro criar execucao: " + (ee?.message || "?") }, 500);
  const execId = exec.id;

  // @ts-ignore EdgeRuntime
  const hasWaitUntil = typeof EdgeRuntime !== "undefined" && typeof (EdgeRuntime as any).waitUntil === "function";
  if (hasWaitUntil) {
    // @ts-ignore
    (EdgeRuntime as any).waitUntil(rodarBatch(execId, iniciado_por));
    return json({ ok: true, execucao_id: execId, async: true });
  } else {
    await rodarBatch(execId, iniciado_por);
    return json({ ok: true, execucao_id: execId, async: false });
  }
});
