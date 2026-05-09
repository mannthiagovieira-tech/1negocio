// socio-cadastrar-tese · V8 B8.13 SUB-BLOCO B FASE 2 · 1Negócio
// Sócio aprovado cadastra TESE em nome de um proprietário (existente ou ghost).
// Cria vínculo aguardando aceite + dispara WhatsApp via criar-notificacao-proprietario.
//
// POST {
//   proprietario_phone, proprietario_user_id?, proprietario_nome?,
//   dados_tese: { titulo?, setores[], formas_atuacao[], localizacao_tipo, estado?, cidade?, valor_alvo, valor_investimento?, observacoes? }
// }
// → 200 { ok, vinculo_id, vinculo_codigo, tese_id, tese_codigo, is_ghost }

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

async function findOrCreateGhost(phone: string, nome: string | null): Promise<{ user_id: string | null; is_ghost: boolean; erro?: string }> {
  const phoneCom55 = phone.startsWith("55") ? phone : "55" + phone;
  const phoneRaw = phone.replace(/^55/, "");

  // Busca paginada robusta · normalização agressiva (ignora formato + · espaços)
  async function buscar(): Promise<any | null> {
    for (let page = 1; page <= 5; page++) {
      try {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
        if (error || !data?.users?.length) return null;
        const found = data.users.find((u: any) => {
          const p = String(u.phone || "").replace(/\D/g, "");
          const meta = String(u.user_metadata?.phone || "").replace(/\D/g, "");
          return p === phoneCom55 || p === phoneRaw || meta === phoneCom55 || meta === phoneRaw;
        });
        if (found) return found;
        if (data.users.length < 1000) return null;
      } catch (e) { console.warn("[ghost listUsers page", page, "]", (e as Error).message); return null; }
    }
    return null;
  }

  const existing = await buscar();
  if (existing) return { user_id: existing.id, is_ghost: false };

  try {
    const { data: created, error } = await adminClient.auth.admin.createUser({
      phone: phoneCom55,
      phone_confirm: false,
      user_metadata: { nome: nome || "Proprietário", ghost: true },
    });
    if (!error && created.user?.id) return { user_id: created.user.id, is_ghost: true };
    // Qualquer erro · re-busca (cobre todas variantes de "phone exists" sem depender de includes)
    console.warn("[ghost createUser err]", error?.message);
    const retry = await buscar();
    if (retry) return { user_id: retry.id, is_ghost: false };
    return { user_id: null, is_ghost: false, erro: error?.message || "createUser falhou sem detalhe" };
  } catch (e) {
    return { user_id: null, is_ghost: false, erro: (e as Error).message };
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
      sessao_id: "socio-cadastrar-tese-edge",
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

  const dt = body?.dados_tese || {};
  const setores: string[] = Array.isArray(dt.setores) ? dt.setores.filter((s: any) => typeof s === "string") : [];
  const formas_atuacao: string[] = Array.isArray(dt.formas_atuacao) ? dt.formas_atuacao.filter((s: any) => typeof s === "string") : [];
  const localizacao_tipo = String(dt.localizacao_tipo || "brasil_todo");
  const valor_alvo = Number(dt.valor_alvo);

  if (setores.length === 0) return json({ ok: false, error: "setores_obrigatorio" }, 400);
  if (formas_atuacao.length === 0) return json({ ok: false, error: "formas_atuacao_obrigatorio" }, 400);
  if (!["brasil_todo", "estado", "cidade"].includes(localizacao_tipo)) {
    return json({ ok: false, error: "localizacao_tipo_invalido" }, 400);
  }
  if (!Number.isFinite(valor_alvo) || valor_alvo < 50000 || valor_alvo > 10000000) {
    return json({ ok: false, error: "valor_alvo_fora_da_faixa" }, 400);
  }

  // 1. Resolve user_id do proprietário (existente ou cria ghost)
  let userId = proprietario_user_id_in;
  let isGhost = false;
  let ghostErro: string | null = null;
  if (!userId) {
    const r = await findOrCreateGhost(proprietario_phone_raw, proprietario_nome);
    userId = r.user_id;
    isGhost = r.is_ghost;
    ghostErro = (r as any).erro || null;
  }
  if (!userId) return json({ ok: false, error: "user_id_indisponivel", detalhe: ghostErro }, 500);

  // 2. Sincroniza public.usuarios com tipo='buy' (tese = comprador)
  await ensureUsuarioRow(userId, proprietario_nome, phoneCom55, "buy");

  // 3. INSERT na tese
  const teseRow: any = {
    usuario_id: userId,
    status: "ativa",
    setores,
    formas_atuacao,
    localizacao_tipo,
    estado: dt.estado ? String(dt.estado) : null,
    cidade: dt.cidade ? String(dt.cidade) : null,
    valor_alvo,
    titulo: dt.titulo ? String(dt.titulo).slice(0, 200) : null,
    valor_investimento: dt.valor_investimento ? String(dt.valor_investimento).slice(0, 100) : null,
    observacoes: dt.observacoes ? String(dt.observacoes).slice(0, 500) : null,
    socio_codigo: gate.socio_codigo || null,
    origem: "socio_cadastro_terceiro",
  };
  const { data: tese, error: errTese } = await adminClient.from("teses_investimento")
    .insert(teseRow).select("id, codigo").single();
  if (errTese || !tese) return json({ ok: false, error: "tese_insert_falhou", detalhe: errTese?.message }, 500);

  // 4. Gera código de vínculo
  let vinculoCodigo: string | null = null;
  try {
    const { data: codeRow } = await adminClient.rpc("gerar_codigo_vinculo");
    vinculoCodigo = (codeRow as unknown as string) || null;
  } catch (e) {
    console.warn("[gerar_codigo_vinculo]", (e as Error).message);
  }

  // 5. INSERT vinculo_socio
  const { data: vinculo, error: errVinc } = await adminClient.from("vinculos_socio").insert({
    socio_id: gate.socio_id,
    tese_id: tese.id,
    diagnostico_id: null,
    origem: "cadastrado_pelo_socio",
    status: "aguardando_aceite_proprietario",
    codigo: vinculoCodigo,
  }).select("id, codigo").single();
  if (errVinc || !vinculo) return json({ ok: false, error: "vinculo_insert_falhou", detalhe: errVinc?.message }, 500);

  // 6. Dispara notificação WhatsApp via edge centralizada
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/criar-notificacao-proprietario`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        vinculo_id: vinculo.id,
        proprietario_id: userId,
        proprietario_phone: phoneCom55,
        acao: "aceitar_tese",
      }),
    });
  } catch (e) {
    console.warn("[criar-notif call]", (e as Error).message);
  }

  // 7. Tracking
  await dispararEvento("socio_cadastrou_tese_terceiro", vinculo.id, {
    socio_id: gate.socio_id,
    socio_codigo: gate.socio_codigo,
    tese_id: tese.id,
    tese_codigo: tese.codigo,
    is_ghost: isGhost,
    proprietario_phone_last4: phoneCom55.slice(-4),
  });

  return json({
    ok: true,
    vinculo_id: vinculo.id,
    vinculo_codigo: vinculo.codigo,
    tese_id: tese.id,
    tese_codigo: tese.codigo,
    is_ghost: isGhost,
  });
});
