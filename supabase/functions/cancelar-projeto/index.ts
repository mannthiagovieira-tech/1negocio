// cancelar-projeto · v9.10 Módulo 1 (1/3) · 1Negócio
// Admin encerra projeto_metadata · mapeia motivo_encerramento → status · opcionalmente
// reverte negocios.plano.
//
// POST {
//   negocio_id,
//   motivo_encerramento: 'vendido' | 'cliente_desistiu' | 'cancelado' | 'pausado_indefinido',
//   novo_plano_negocio?: 'gratuito' | 'guiado' | 'assessorada',
//   notas?: string
// }
// → 200 { ok, status }
// → 401 sem_jwt · 403 nao_autorizado · 404 projeto_nao_encontrado
// → 400 params_invalidos · 409 estado_invalido

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

const MAPA_STATUS: Record<string, string> = {
  vendido: "concluido",
  cliente_desistiu: "cancelado",
  cancelado: "cancelado",
  pausado_indefinido: "pausado",
};

const PLANOS_VALIDOS = new Set(["gratuito", "guiado", "assessorada"]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const negocio_id = String(body?.negocio_id || "").trim();
  const motivo = String(body?.motivo_encerramento || "").trim();
  const novo_plano = body?.novo_plano_negocio ? String(body.novo_plano_negocio).trim() : null;
  const notas = body?.notas != null ? String(body.notas).slice(0, 1000) : null;

  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);
  const novoStatus = MAPA_STATUS[motivo];
  if (!novoStatus) return json({ ok: false, error: "params_invalidos", detalhe: "motivo_encerramento" }, 400);
  if (novo_plano && !PLANOS_VALIDOS.has(novo_plano)) {
    return json({ ok: false, error: "params_invalidos", detalhe: "novo_plano_negocio" }, 400);
  }

  const { data: meta } = await adminClient
    .from("projeto_metadata").select("id, status, notas_admin").eq("negocio_id", negocio_id).maybeSingle();
  if (!meta) return json({ ok: false, error: "projeto_nao_encontrado" }, 404);

  const linhaNota = notas
    ? `[${new Date().toISOString().slice(0,10)} · ${motivo}] ${notas}`
    : `[${new Date().toISOString().slice(0,10)} · ${motivo}]`;
  const novasNotas = meta.notas_admin
    ? `${meta.notas_admin}\n${linhaNota}`
    : linhaNota;

  const { error: errMeta } = await adminClient.from("projeto_metadata").update({
    status: novoStatus,
    notas_admin: novasNotas,
    updated_at: new Date().toISOString(),
  }).eq("id", meta.id);
  if (errMeta) return json({ ok: false, error: "update_falhou", detalhe: errMeta.message }, 500);

  if (novo_plano) {
    await adminClient.from("negocios").update({ plano: novo_plano }).eq("id", negocio_id);
  }

  return json({ ok: true, status: novoStatus });
});
