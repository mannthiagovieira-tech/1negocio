// socio-cadastrar-diagnostico · V8 B8.13 SUB-BLOCO B FASE 2 · 1Negócio
// Sócio aprovado cadastra DIAGNÓSTICO (negócio) em nome de um proprietário.
// Cria vínculo aguardando aceite + dispara WhatsApp via criar-notificacao-proprietario.
//
// POST {
//   proprietario_phone, proprietario_user_id?, proprietario_nome?,
//   dados_diagnostico: { nome_negocio, setor, categoria?, cidade, estado, faturamento_anual, descricao_curta? }
// }
// → 200 { ok, vinculo_id, vinculo_codigo, negocio_id, negocio_codigo, is_ghost }

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

async function gateSocio(req: Request): Promise<{ ok: boolean; socio_id?: string; socio_codigo?: string }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.id) return { ok: false };
    const { data: socio } = await adminClient.from("socios")
      .select("id, codigo, status").eq("usuario_id", data.user.id).maybeSingle();
    if (!socio || socio.status !== "aprovado") return { ok: false };
    return { ok: true, socio_id: socio.id, socio_codigo: socio.codigo || undefined };
  } catch {
    return { ok: false };
  }
}

async function findOrCreateGhost(phone: string, nome: string | null): Promise<{ user_id: string | null; is_ghost: boolean }> {
  const phoneCom55 = phone.startsWith("55") ? phone : "55" + phone;
  try {
    const { data: page } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
    const users = page?.users || [];
    const existing = users.find((u: any) =>
      u.phone === phoneCom55 ||
      u.phone === phone ||
      u.user_metadata?.phone === phoneCom55 ||
      u.user_metadata?.phone === phone
    );
    if (existing) return { user_id: existing.id, is_ghost: false };
  } catch (e) {
    console.warn("[ghost listUsers]", (e as Error).message);
  }

  try {
    const { data: created, error } = await adminClient.auth.admin.createUser({
      phone: phoneCom55,
      phone_confirm: false,
      user_metadata: { nome: nome || "Proprietário", ghost: true },
    });
    if (error) {
      if (String(error.message || "").toLowerCase().includes("already") || String(error.message || "").toLowerCase().includes("exists")) {
        const { data: page2 } = await adminClient.auth.admin.listUsers({ perPage: 1000 });
        const u = (page2?.users || []).find((x: any) => x.phone === phoneCom55);
        if (u) return { user_id: u.id, is_ghost: false };
      }
      console.warn("[ghost create]", error.message);
      return { user_id: null, is_ghost: false };
    }
    return { user_id: created.user?.id || null, is_ghost: true };
  } catch (e) {
    console.warn("[ghost throw]", (e as Error).message);
    return { user_id: null, is_ghost: false };
  }
}

async function ensureUsuarioRow(userId: string, nome: string | null, phoneCom55: string, tipo: "buy" | "sell"): Promise<void> {
  try {
    const { data: existing } = await adminClient.from("usuarios").select("id").eq("id", userId).maybeSingle();
    if (existing) return;
    await adminClient.from("usuarios").insert({
      id: userId,
      whatsapp: phoneCom55,
      nome: nome || "Proprietário",
      tipo,
    });
  } catch (e) {
    console.warn("[usuarios sync]", (e as Error).message);
  }
}

async function dispararEvento(tipo: string, vinculoId: string, meta: Record<string, unknown>) {
  try {
    await adminClient.from("eventos_usuario").insert({
      tipo,
      entidade_tipo: "vinculo_socio",
      entidade_id: vinculoId,
      usuario_id: null,
      sessao_id: "socio-cadastrar-diag-edge",
      meta,
    });
  } catch (e) {
    console.warn("[evento]", (e as Error).message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateSocio(req);
  if (!gate.ok || !gate.socio_id) return json({ ok: false, error: "socio_required" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const proprietario_phone_raw = String(body?.proprietario_phone || "").replace(/\D/g, "");
  if (!proprietario_phone_raw || proprietario_phone_raw.length < 10) {
    return json({ ok: false, error: "phone_invalido" }, 400);
  }
  const phoneCom55 = proprietario_phone_raw.startsWith("55") ? proprietario_phone_raw : "55" + proprietario_phone_raw;
  const proprietario_user_id_in = body?.proprietario_user_id ? String(body.proprietario_user_id).trim() : null;
  const proprietario_nome = body?.proprietario_nome ? String(body.proprietario_nome).trim() : null;

  const dd = body?.dados_diagnostico || {};
  const nome_negocio = String(dd.nome_negocio || "").trim();
  const setor = String(dd.setor || "").trim();
  const cidade = String(dd.cidade || "").trim();
  const estado = String(dd.estado || "").trim();
  const faturamento_anual = Number(dd.faturamento_anual);

  if (!nome_negocio) return json({ ok: false, error: "nome_negocio_obrigatorio" }, 400);
  if (!setor) return json({ ok: false, error: "setor_obrigatorio" }, 400);
  if (!cidade || !estado) return json({ ok: false, error: "localizacao_obrigatoria" }, 400);
  if (!Number.isFinite(faturamento_anual) || faturamento_anual <= 0) {
    return json({ ok: false, error: "faturamento_anual_invalido" }, 400);
  }

  // 1. Resolve user_id (existente ou ghost)
  let userId = proprietario_user_id_in;
  let isGhost = false;
  if (!userId) {
    const r = await findOrCreateGhost(proprietario_phone_raw, proprietario_nome);
    userId = r.user_id;
    isGhost = r.is_ghost;
  }
  if (!userId) return json({ ok: false, error: "user_id_indisponivel" }, 500);

  // 2. Sincroniza public.usuarios com tipo='sell' (diagnostico = vendedor)
  await ensureUsuarioRow(userId, proprietario_nome, phoneCom55, "sell");

  // 3. INSERT em negocios (mínimo viável)
  const negocioRow: any = {
    vendedor_id: userId,
    nome: nome_negocio,
    setor,
    categoria: dd.categoria ? String(dd.categoria).slice(0, 100) : null,
    cidade,
    estado,
    faturamento_anual,
    descricao_curta: dd.descricao_curta ? String(dd.descricao_curta).slice(0, 200) : null,
    status: "em_avaliacao",
    socio_codigo: gate.socio_codigo || null,
    origem: "socio_cadastro_terceiro",
  };
  const { data: negocio, error: errNeg } = await adminClient.from("negocios")
    .insert(negocioRow).select("id, codigo").single();
  if (errNeg || !negocio) return json({ ok: false, error: "negocio_insert_falhou", detalhe: errNeg?.message }, 500);

  // 4. Gera código de vínculo
  let vinculoCodigo: string | null = null;
  try {
    const { data: codeRow } = await adminClient.rpc("gerar_codigo_vinculo");
    vinculoCodigo = (codeRow as unknown as string) || null;
  } catch (e) {
    console.warn("[gerar_codigo_vinculo]", (e as Error).message);
  }

  // 5. INSERT vinculo_socio (diagnostico_id = negocio.id · nome legacy)
  const { data: vinculo, error: errVinc } = await adminClient.from("vinculos_socio").insert({
    socio_id: gate.socio_id,
    tese_id: null,
    diagnostico_id: negocio.id,
    origem: "cadastrado_pelo_socio",
    status: "aguardando_aceite_proprietario",
    codigo: vinculoCodigo,
  }).select("id, codigo").single();
  if (errVinc || !vinculo) return json({ ok: false, error: "vinculo_insert_falhou", detalhe: errVinc?.message }, 500);

  // 6. Dispara notificação WhatsApp
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/criar-notificacao-proprietario`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        vinculo_id: vinculo.id,
        proprietario_id: userId,
        proprietario_phone: phoneCom55,
        acao: "aceitar_diagnostico",
      }),
    });
  } catch (e) {
    console.warn("[criar-notif call]", (e as Error).message);
  }

  // 7. Tracking
  await dispararEvento("socio_cadastrou_diag_terceiro", vinculo.id, {
    socio_id: gate.socio_id,
    socio_codigo: gate.socio_codigo,
    negocio_id: negocio.id,
    negocio_codigo: negocio.codigo,
    is_ghost: isGhost,
    proprietario_phone_last4: phoneCom55.slice(-4),
  });

  return json({
    ok: true,
    vinculo_id: vinculo.id,
    vinculo_codigo: vinculo.codigo,
    negocio_id: negocio.id,
    negocio_codigo: negocio.codigo,
    is_ghost: isGhost,
  });
});
