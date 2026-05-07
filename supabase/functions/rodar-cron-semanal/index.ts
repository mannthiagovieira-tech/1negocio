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

// Pesos V7 BLOCO 5: Setor 40 · Forma 35 · Loc 10 · Ticket 10 · ISE 5 = 100
async function calcularMatchPar(tese: Tese, neg: Negocio, tagsAdmin: string[]) {
  const fatores: Fator[] = [];
  if (neg.status && !STATUSES_ELEGIVEIS.includes(neg.status)) return null;

  // SETOR 40 · eliminatório
  const setores = tese.setores || [];
  const aceitaIndif = setores.includes("indiferente");
  let pontosSetor = 0;
  if (setores.length > 0) {
    if (aceitaIndif) { pontosSetor = 40; fatores.push({ codigo: "setor:indiferente", pontos: 40 }); }
    else if (neg.setor && setores.includes(neg.setor)) { pontosSetor = 40; fatores.push({ codigo: `setor:${neg.setor}`, pontos: 40 }); }
    else return null;
  }

  // FORMA 35 · eliminatório quando declarada (lógica A intersecção)
  let pontosForma = 0;
  const teseTemForma = Array.isArray(tese.formas_atuacao) && tese.formas_atuacao.length > 0;
  const negTemForma = Array.isArray(neg.formas_atuacao) && neg.formas_atuacao.length > 0;
  if (teseTemForma) {
    if (!negTemForma) return null;
    const inter = tese.formas_atuacao.filter((f: string) => neg.formas_atuacao.includes(f));
    if (inter.length === 0) return null;
    pontosForma = 35;
    fatores.push({ codigo: `forma:${inter.join(",")}`, pontos: 35 });
  }

  // LOC até 10 · eliminatório quando estado/cidade declarado
  let pontosLoc = 0;
  if (tese.localizacao_tipo === "brasil_todo" || !tese.localizacao_tipo) {
    pontosLoc = 5; fatores.push({ codigo: "localizacao:brasil_todo", pontos: 5 });
  } else if (tese.localizacao_tipo === "estado") {
    if (tese.estado && neg.estado && tese.estado !== neg.estado) return null;
    pontosLoc = 8; if (neg.estado) fatores.push({ codigo: `estado:${neg.estado}`, pontos: 8 });
  } else if (tese.localizacao_tipo === "cidade") {
    if (tese.estado && neg.estado && tese.estado !== neg.estado) return null;
    if (tese.cidade && neg.cidade && tese.cidade !== neg.cidade) {
      pontosLoc = 7; fatores.push({ codigo: `estado:${neg.estado}`, pontos: 7 });
    } else {
      pontosLoc = 10; if (neg.cidade) fatores.push({ codigo: `cidade:${neg.cidade}`, pontos: 10 });
    }
  }

  // TICKET até 10 · eliminatório ±30%
  let pontosTicket = 0;
  if (tese.valor_alvo != null && neg.avaliacao_max != null) {
    if (neg.avaliacao_max < tese.valor_alvo * 0.7 || neg.avaliacao_max > tese.valor_alvo * 1.3) return null;
    const dist = Math.abs(neg.avaliacao_max - tese.valor_alvo) / tese.valor_alvo;
    const p = Math.round(10 * (1 - Math.min(dist / 0.30, 1)));
    if (p > 0) {
      pontosTicket = p;
      fatores.push({ codigo: `ticket_proximidade:${Math.round((1 - Math.min(dist/0.30,1))*100)}%`, pontos: p });
    }
  }

  // ISE até 5 · 5 faixas
  let pontosISE = 0;
  if (typeof neg.score_saude === "number") {
    if (neg.score_saude >= 85) { pontosISE = 5; fatores.push({ codigo: `ise_estruturado:${neg.score_saude}`, pontos: 5 }); }
    else if (neg.score_saude >= 70) { pontosISE = 3; fatores.push({ codigo: `ise_consolidado:${neg.score_saude}`, pontos: 3 }); }
    else if (neg.score_saude >= 50) { pontosISE = 1; fatores.push({ codigo: `ise_operacional:${neg.score_saude}`, pontos: 1 }); }
  }

  const scoreBase = pontosSetor + pontosForma + pontosLoc + pontosTicket + pontosISE;
  const { score: scoreFinal, aplicadas } = aplicarTags(scoreBase, tagsAdmin);
  if (scoreFinal < 30) return null;
  return { score: scoreFinal, score510: calcularScore510(scoreFinal), fatores, tags: aplicadas };
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
        .select("id,codigo,nome,setor,formas_atuacao,estado,cidade,status,avaliacao_min,avaliacao_max,score_saude,publicado_em,vendedor_id");
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
        const comprador = await getContato(tese.usuario_id);
        const vendedoresCache: Record<string, Contato | null> = {};
        const rows = await Promise.all(top.map(async ({ neg, r }) => {
          const vid = neg.vendedor_id || "";
          if (vid && !(vid in vendedoresCache)) vendedoresCache[vid] = await getContato(vid);
          const vendedor = vid ? vendedoresCache[vid] : null;
          return {
            tese_id: tese.id, negocio_id: neg.id,
            comprador_id: tese.usuario_id, vendedor_id: neg.vendedor_id,
            score_100: r.score, score_5_10: r.score510,
            fatores_casados: r.fatores, tags_aplicadas: r.tags,
            origem: "cron_semanal", cron_execucao_id: execId, status: "pendente",
            comprador_phone: comprador?.phone ?? null,
            comprador_nome: comprador?.nome ?? null,
            vendedor_phone: vendedor?.phone ?? null,
            vendedor_nome: vendedor?.nome ?? null,
            vendedor_eh_seed: vendedor?.eh_seed ?? false,
          };
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
