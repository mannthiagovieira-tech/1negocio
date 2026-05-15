// registrar-movimentacao · v9.10 Módulo 1 (1/3) · 1Negócio
// Admin registra entrada/saída financeira do projeto em projeto_movimentacoes.
//
// POST {
//   negocio_id,
//   tipo: 'entrada' | 'saida',
//   categoria: <ver lista>,
//   valor: number > 0,
//   data?: string (YYYY-MM-DD · default hoje),
//   descricao?: string,
//   comprovante_url?: string
// }
// → 200 { ok, movimentacao }
// → 401 sem_jwt · 403 nao_autorizado · 400 params_invalidos

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

const TIPOS = new Set(["entrada", "saida"]);
const CATEGORIAS = new Set([
  "mensalidade_assessorada", "venda_empresa",
  "ads_meta", "ads_google", "ads_outro",
  "comissao_socio", "taxa_plataforma", "reembolso", "outro",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const negocio_id = String(body?.negocio_id || "").trim();
  const tipo = String(body?.tipo || "").trim();
  const categoria = String(body?.categoria || "").trim();
  const valor = Number(body?.valor);
  const dataMov = body?.data ? String(body.data).slice(0, 10) : null;
  const descricao = body?.descricao != null ? String(body.descricao).slice(0, 500) : null;
  const comprovante = body?.comprovante_url != null ? String(body.comprovante_url).slice(0, 1000) : null;

  if (!negocio_id) return json({ ok: false, error: "params_invalidos", detalhe: "negocio_id" }, 400);
  if (!TIPOS.has(tipo)) return json({ ok: false, error: "params_invalidos", detalhe: "tipo" }, 400);
  if (!CATEGORIAS.has(categoria)) return json({ ok: false, error: "params_invalidos", detalhe: "categoria" }, 400);
  if (!Number.isFinite(valor) || valor <= 0) return json({ ok: false, error: "params_invalidos", detalhe: "valor" }, 400);

  const payload: Record<string, unknown> = {
    negocio_id, tipo, categoria, valor,
    descricao,
    comprovante_url: comprovante,
    created_by_admin_id: gate.admin_id || null,
  };
  if (dataMov) payload.data = dataMov;

  const { data, error } = await adminClient
    .from("projeto_movimentacoes").insert(payload).select().maybeSingle();
  if (error) return json({ ok: false, error: "erro_insert", detalhe: error.message }, 500);

  return json({ ok: true, movimentacao: data });
});
