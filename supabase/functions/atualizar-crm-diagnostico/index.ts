// atualizar-crm-diagnostico · v9.16 · 1Negócio
// Atualiza campos CRM do diagnóstico em negocios:
//   status_contato_diagnostico · notas_diagnostico · dono_diagnostico
// Quando status muda pra 'contactado' (vindo de 'aguardando_contato'),
// também seta contactado_em=now() e contactado_por=<admin atual>.
//
// POST { negocio_id, status_contato?, notas?, dono_id? }
// → 200 { ok, negocio }
// → 400/403/404 erros padronizados
//
// Auth · Authorization Bearer JWT de admin (mesmo padrão de gerar-peca)
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

const STATUS_VALIDOS = new Set([
  "aguardando_contato", "contactado", "em_negociacao", "perdido", "cliente_convertido", "sem_interesse",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const negocio_id = String(body?.negocio_id || "").trim();
  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);

  const status_contato = body?.status_contato != null ? String(body.status_contato).trim() : null;
  const notas = body?.notas != null ? String(body.notas) : null;
  const dono_id = body?.dono_id != null ? String(body.dono_id).trim() : null;

  if (status_contato && !STATUS_VALIDOS.has(status_contato)) {
    return json({ ok: false, error: "params_invalidos", detalhe: "status_contato inválido" }, 400);
  }

  // Lê estado atual pra detectar transição aguardando_contato → contactado
  const { data: negAtual } = await adminClient
    .from("negocios")
    .select("id, status_contato_diagnostico, contactado_em")
    .eq("id", negocio_id)
    .maybeSingle();
  if (!negAtual) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);

  const updateFields: Record<string, unknown> = {};
  if (status_contato !== null) updateFields.status_contato_diagnostico = status_contato;
  if (notas !== null) updateFields.notas_diagnostico = notas;
  if (dono_id !== null) updateFields.dono_diagnostico = dono_id || null;

  // Auto-set contactado_em + contactado_por na primeira transição pra 'contactado'/'em_negociacao'
  if (
    (status_contato === "contactado" || status_contato === "em_negociacao") &&
    !negAtual.contactado_em
  ) {
    updateFields.contactado_em = new Date().toISOString();
    if (gate.admin_id) updateFields.contactado_por = gate.admin_id;
  }

  if (Object.keys(updateFields).length === 0) {
    return json({ ok: false, error: "sem_alteracoes" }, 400);
  }

  const { data: negocio, error } = await adminClient
    .from("negocios")
    .update(updateFields)
    .eq("id", negocio_id)
    .select("id, codigo, codigo_diagnostico, nome, status, status_contato_diagnostico, notas_diagnostico, dono_diagnostico, contactado_em, contactado_por")
    .maybeSingle();

  if (error) return json({ ok: false, error: "erro_update", detalhe: error.message }, 500);
  if (!negocio) return json({ ok: false, error: "update_sem_retorno" }, 500);

  return json({ ok: true, negocio });
});
