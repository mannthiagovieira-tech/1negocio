// admin-aprovar-doc-socio · V8 BLOCO 7 FASE 1 · 1negocio.com.br
// Admin aprova/nega/suspende/cancela/reativa sócio · gera código S-XXXX no aprovar
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

// V8 B8.12 OPÇÃO C · helper pra registrar evento server-side · falha silenciosa
async function dispararEvento(tipo: string, socioId: string, meta: Record<string, unknown>) {
  try {
    await adminClient.from("eventos_usuario").insert({
      usuario_id: null,
      sessao_id: "admin-edge",
      tipo,
      entidade_tipo: "socio",
      entidade_id: socioId,
      duracao_ms: null,
      meta: meta || {},
      ip: null,
      user_agent: null,
    });
  } catch (e) {
    console.warn("[evento server]", tipo, (e as Error).message || e);
  }
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, erro: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, erro: "admin_required" }, 403);

  const body = await req.json().catch(() => ({}));
  const socio_id = String(body?.socio_id || "").trim();
  const acao = String(body?.acao || "").trim();
  const notas = (body?.notas != null ? String(body.notas) : null) || null;
  if (!socio_id || !["aprovar", "negar", "suspender", "cancelar", "reativar", "signed_url"].includes(acao)) {
    return json({ ok: false, erro: "params_invalidos" }, 400);
  }

  const { data: socio, error: errFetch } = await adminClient.from("socios").select("*").eq("id", socio_id).single();
  if (errFetch || !socio) return json({ ok: false, erro: "socio_nao_encontrado" }, 404);

  // V8 B8 P3 · gera signed URL pro admin visualizar documento privado
  if (acao === "signed_url") {
    if (!socio.documento_url) return json({ ok: false, erro: "sem_documento" }, 404);
    const { data: signed, error: errSign } = await adminClient.storage
      .from("documentos-socios")
      .createSignedUrl(socio.documento_url, 600);
    if (errSign || !signed?.signedUrl) return json({ ok: false, erro: "signed_url_falhou: " + (errSign?.message || "?") }, 500);
    return json({ ok: true, signed_url: signed.signedUrl, path: socio.documento_url, tipo: socio.documento_tipo });
  }

  const updates: any = { updated_at: new Date().toISOString() };
  if (notas) updates.notas_admin = notas;

  if (acao === "aprovar") {
    if (socio.status !== "aguardando_aprovacao_doc" && socio.status !== "suspenso") {
      return json({ ok: false, erro: "status_atual_nao_permite_aprovar: " + socio.status }, 400);
    }
    updates.status = "aprovado";
    updates.documento_aprovado_em = new Date().toISOString();
    updates.documento_aprovado_por = gate.admin_id || null;
    if (!socio.codigo) {
      const { data: codeRow } = await adminClient.rpc("gerar_codigo_socio");
      updates.codigo = codeRow as unknown as string;
    }
  } else if (acao === "negar") {
    if (socio.status !== "aguardando_aprovacao_doc") {
      return json({ ok: false, erro: "status_atual_nao_permite_negar: " + socio.status }, 400);
    }
    updates.status = "pendente_termo";
    updates.documento_url = null;
    updates.documento_tipo = null;
    updates.termo_assinado_em = null;
    updates.termo_versao = null;
  } else if (acao === "suspender") {
    if (socio.status !== "aprovado") return json({ ok: false, erro: "so_aprovados_podem_suspender" }, 400);
    updates.status = "suspenso";
  } else if (acao === "cancelar") {
    updates.status = "cancelado";
  } else if (acao === "reativar") {
    if (socio.status !== "suspenso") return json({ ok: false, erro: "so_suspensos_podem_reativar" }, 400);
    updates.status = "aprovado";
  }

  const { data: updated, error: errUp } = await adminClient
    .from("socios").update(updates).eq("id", socio_id).select().single();
  if (errUp) return json({ ok: false, erro: "update_falhou: " + errUp.message }, 500);

  // V8 B8.12 OPÇÃO C · eventos 4/5 e 5/5 · server-side · falha silenciosa
  if (acao === "aprovar") {
    await dispararEvento("admin_aprovou_socio", socio_id, {
      codigo: updated?.codigo || null,
      admin_id: gate.admin_id || null,
    });
  } else if (acao === "negar") {
    await dispararEvento("admin_rejeitou_documento", socio_id, {
      motivo: notas,
      admin_id: gate.admin_id || null,
    });
  }

  return json({ ok: true, socio: updated });
});
