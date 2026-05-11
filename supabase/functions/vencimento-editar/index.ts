// vencimento-editar · v9.10.6 · 1Negócio
// Admin edita campo do vencimento via whitelist.
//
// POST { vencimento_id, campo, valor }
// → 200 { ok, campo, valor_salvo }
// → 400 params_invalidos · 403 nao_autorizado · 404 nao_encontrado
// → 409 estado_invalido (ex: tentar cancelar vencimento já recebido)

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

async function gateAdmin(req: Request): Promise<{ ok: boolean }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.phone) return { ok: false };
    const { data: admin } = await adminClient.from("admins").select("id").eq("whatsapp", data.user.phone).eq("ativo", true).maybeSingle();
    if (admin?.id) return { ok: true };
  } catch {}
  return { ok: false };
}

const CATEGORIAS = new Set([
  "mensalidade_assessorada", "venda_empresa", "ads_meta", "ads_google",
  "ads_outro", "comissao_socio", "taxa_plataforma", "reembolso", "outro",
]);
const STATUS_PERMITIDOS = new Set(["aberto", "cancelado"]);  // não pode setar 'recebido' aqui (usa marcar-recebido)
const CAMPOS = ["valor", "data_prevista", "descricao", "categoria", "status"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const vencimento_id = String(body?.vencimento_id || "").trim();
  const campo = String(body?.campo || "").trim();
  if (!vencimento_id) return json({ ok: false, error: "params_invalidos", detalhe: "vencimento_id" }, 400);
  if (!CAMPOS.includes(campo)) return json({ ok: false, error: "campo_invalido", detalhe: campo }, 400);

  // Busca pra validar transição de estado
  const { data: venc } = await adminClient
    .from("projeto_vencimentos").select("id, status").eq("id", vencimento_id).maybeSingle();
  if (!venc) return json({ ok: false, error: "vencimento_nao_encontrado" }, 404);

  // Validação por campo
  let valorSalvo: any = null;
  const raw = body?.valor;

  if (campo === "valor") {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return json({ ok: false, error: "valor_invalido", detalhe: "valor deve ser > 0" }, 400);
    valorSalvo = n;
  } else if (campo === "data_prevista") {
    const s = String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return json({ ok: false, error: "valor_invalido", detalhe: "YYYY-MM-DD" }, 400);
    valorSalvo = s;
  } else if (campo === "descricao") {
    if (raw === null || raw === undefined || raw === "") valorSalvo = null;
    else if (typeof raw !== "string") return json({ ok: false, error: "valor_invalido", detalhe: "esperava string" }, 400);
    else valorSalvo = raw.trim().slice(0, 1000) || null;
  } else if (campo === "categoria") {
    if (!CATEGORIAS.has(String(raw))) return json({ ok: false, error: "valor_invalido", detalhe: "categoria inválida" }, 400);
    valorSalvo = String(raw);
  } else if (campo === "status") {
    const novoStatus = String(raw);
    if (!STATUS_PERMITIDOS.has(novoStatus)) return json({ ok: false, error: "valor_invalido", detalhe: "use 'aberto' ou 'cancelado' · pra 'recebido' use vencimento-marcar-recebido" }, 400);
    if (venc.status === "recebido") return json({ ok: false, error: "estado_invalido", detalhe: "vencimento já recebido · não pode mudar status" }, 409);
    valorSalvo = novoStatus;
  }

  const { data, error } = await adminClient
    .from("projeto_vencimentos")
    .update({ [campo]: valorSalvo, updated_at: new Date().toISOString() })
    .eq("id", vencimento_id)
    .select(`id, ${campo}`)
    .maybeSingle();
  if (error) return json({ ok: false, error: "erro_update", detalhe: error.message }, 500);
  if (!data) return json({ ok: false, error: "vencimento_nao_encontrado" }, 404);

  return json({ ok: true, campo, valor_salvo: (data as any)[campo] });
});
