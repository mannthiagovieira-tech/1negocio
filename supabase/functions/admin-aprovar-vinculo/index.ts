// admin-aprovar-vinculo · V8 B8.13 SUB-BLOCO D · 1Negócio
// Admin aprova/rejeita/revoga vínculo · denormaliza socio_codigo em teses/negocios.
//
// POST { vinculo_id, acao: 'aprovar'|'rejeitar'|'revogar', notas? }
// → 200 { ok, status }
// → 403 nao_autorizado · 404 nao_encontrado · 409 estado_invalido

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
    const { count } = await adminClient.from("admins").select("id", { count: "exact", head: true })
      .eq("whatsapp", data.user.phone).eq("ativo", true);
    if ((count ?? 0) > 0) return { ok: true, admin_id: data.user.id };
  } catch {}
  return { ok: false };
}

async function dispararEvento(tipo: string, vinculoId: string, meta: Record<string, unknown>) {
  try {
    await adminClient.from("eventos_usuario").insert({
      tipo,
      entidade_tipo: "vinculo_socio",
      entidade_id: vinculoId,
      usuario_id: null,
      sessao_id: "admin-aprovar-vinculo-edge",
      meta,
    });
  } catch (e) {
    console.warn("[evento]", (e as Error).message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const vinculo_id = String(body?.vinculo_id || "").trim();
  const acao = String(body?.acao || "").trim();
  const notas = body?.notas != null ? String(body.notas).slice(0, 500) : null;

  if (!vinculo_id || !["aprovar", "rejeitar", "revogar"].includes(acao)) {
    return json({ ok: false, error: "params_invalidos" }, 400);
  }

  const { data: vinculo } = await adminClient.from("vinculos_socio").select("*").eq("id", vinculo_id).maybeSingle();
  if (!vinculo) return json({ ok: false, error: "vinculo_nao_encontrado" }, 404);

  const agora = new Date().toISOString();

  if (acao === "aprovar") {
    if (vinculo.status !== "aguardando_admin") {
      return json({ ok: false, error: "estado_invalido", status_atual: vinculo.status }, 409);
    }

    const updates: any = {
      status: "ativo",
      admin_aprovou_em: agora,
      admin_aprovou_por: gate.admin_id || null,
      updated_at: agora,
    };
    if (notas) updates.notas_admin = notas;

    const { error: errUp } = await adminClient.from("vinculos_socio").update(updates).eq("id", vinculo_id);
    if (errUp) return json({ ok: false, error: "update_falhou", detalhe: errUp.message }, 500);

    // Denormaliza socio_codigo
    const { data: socio } = await adminClient.from("socios").select("codigo").eq("id", vinculo.socio_id).maybeSingle();
    if (socio?.codigo) {
      if (vinculo.tese_id) {
        await adminClient.from("teses_investimento").update({ socio_codigo: socio.codigo }).eq("id", vinculo.tese_id);
      } else if (vinculo.diagnostico_id) {
        await adminClient.from("negocios").update({ socio_codigo: socio.codigo }).eq("id", vinculo.diagnostico_id);
      }
    }

    await dispararEvento("admin_aprovou_vinculo", vinculo_id, { admin_id: gate.admin_id || null, notas, socio_codigo: socio?.codigo || null });
    return json({ ok: true, status: "ativo" });
  }

  if (acao === "rejeitar") {
    if (!["aguardando_admin", "aguardando_aceite_proprietario"].includes(vinculo.status)) {
      return json({ ok: false, error: "estado_invalido", status_atual: vinculo.status }, 409);
    }
    const updates: any = {
      status: "removido",
      removido_em: agora,
      removido_por: gate.admin_id || null,
      removido_motivo: notas || "Rejeitado pelo admin",
      updated_at: agora,
    };
    if (notas) updates.notas_admin = notas;

    const { error: errUp } = await adminClient.from("vinculos_socio").update(updates).eq("id", vinculo_id);
    if (errUp) return json({ ok: false, error: "update_falhou", detalhe: errUp.message }, 500);

    await dispararEvento("admin_rejeitou_vinculo", vinculo_id, { admin_id: gate.admin_id || null, notas, status_anterior: vinculo.status });
    return json({ ok: true, status: "removido" });
  }

  // revogar
  if (vinculo.status !== "ativo") {
    return json({ ok: false, error: "estado_invalido", status_atual: vinculo.status }, 409);
  }
  const updates: any = {
    status: "removido",
    removido_em: agora,
    removido_por: gate.admin_id || null,
    removido_motivo: notas || "Revogado pelo admin",
    updated_at: agora,
  };
  if (notas) updates.notas_admin = notas;

  const { error: errUp } = await adminClient.from("vinculos_socio").update(updates).eq("id", vinculo_id);
  if (errUp) return json({ ok: false, error: "update_falhou", detalhe: errUp.message }, 500);

  // Limpa socio_codigo denormalizado
  if (vinculo.tese_id) {
    await adminClient.from("teses_investimento").update({ socio_codigo: null }).eq("id", vinculo.tese_id);
  } else if (vinculo.diagnostico_id) {
    await adminClient.from("negocios").update({ socio_codigo: null }).eq("id", vinculo.diagnostico_id);
  }

  await dispararEvento("admin_revogou_vinculo", vinculo_id, { admin_id: gate.admin_id || null, notas });
  return json({ ok: true, status: "removido" });
});
