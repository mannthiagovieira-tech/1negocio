// calcular-matchmaking-projeto · v9.17.1 · 1Negócio
// Wrapper sobre calcular-matchmaking (modo:'negocio') que processa apenas 1
// negócio · usado pelo botão "Rodar matchmaking agora" dentro do detalhe do
// projeto. Detecta matches NOVOS (INSERT) vs ATUALIZADOS (UPDATE no upsert)
// comparando IDs antes/depois e marca descoberto_em=now() só nos novos.
//
// POST { negocio_id }
// → 200 { ok, matches_processados, matches_novos, novos_ids, duracao_ms }
// → 400/403/404 erros padronizados
//
// Auth · JWT admin (mesmo padrão de gerar-peca/match-para-pool)
// verify_jwt · true

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  const adminAuth = req.headers.get("authorization") || "";

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const negocio_id = String(body?.negocio_id || "").trim();
  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);

  // Confere negócio existe (não exige status publicado · spec diz pra warn no front mas backend é permissivo)
  const { data: negocio } = await adminClient.from("negocios").select("id, status").eq("id", negocio_id).maybeSingle();
  if (!negocio) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);

  const t0 = Date.now();

  // 1. Snapshot IDs ANTES (mapeado por tese_id pra detectar inserts vs updates)
  const { data: antes } = await adminClient
    .from("matchmaking_resultados")
    .select("id, tese_id")
    .eq("negocio_id", negocio_id);
  const idsAntes = new Set((antes || []).map((m: any) => m.tese_id));

  // 2. Invoca calcular-matchmaking global · modo:'negocio' · faz upsert top 10 score>=30
  let respGlobal: any = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/calcular-matchmaking`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": adminAuth,
      },
      body: JSON.stringify({ modo: "negocio", negocio_id, salvar: true, origem: "manual_projeto" }),
    });
    respGlobal = await r.json();
    if (!r.ok || !respGlobal?.ok) {
      return json({ ok: false, error: "edge_global_falhou", detalhe: respGlobal?.error || ("status " + r.status), respGlobal }, 502);
    }
  } catch (e) {
    return json({ ok: false, error: "edge_global_falhou", detalhe: String((e as Error).message || e) }, 502);
  }

  // 3. Snapshot IDs DEPOIS · diff são os novos
  const { data: depois } = await adminClient
    .from("matchmaking_resultados")
    .select("id, tese_id")
    .eq("negocio_id", negocio_id);

  const novosIds: string[] = [];
  for (const m of (depois || []) as any[]) {
    if (!idsAntes.has(m.tese_id)) novosIds.push(m.id);
  }

  // 4. Marca descoberto_em=now() nos novos (default da migration já cobre INSERTs frescos, mas reforça)
  if (novosIds.length) {
    await adminClient
      .from("matchmaking_resultados")
      .update({ descoberto_em: new Date().toISOString() })
      .in("id", novosIds);
  }

  const duracao_ms = Date.now() - t0;
  return json({
    ok: true,
    matches_processados: respGlobal?.avaliados ?? null,
    matches_gerados: respGlobal?.gerados ?? null,
    matches_novos: novosIds.length,
    novos_ids: novosIds,
    negocio_status: negocio.status,
    duracao_ms,
  });
});
