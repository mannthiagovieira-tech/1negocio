// socio-pedir-vinculo · V8 B8.13 SUB-BLOCO C FASE 3 · 1Negócio
// Sócio aprovado pede vínculo a uma tese ou negócio existente.
// Cria vínculo status=aguardando_aceite_proprietario + dispara WhatsApp via edge centralizada.
//
// POST { codigo }
// → 200 { ok, vinculo_id, vinculo_codigo, tipo, entidade_id }
// → 400 invalid_format · 404 nao_encontrado · 409 ja_tem_socio | ja_pediu | 403 sem_gate

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

function detectarTipo(codigo: string): { tipo: "tese" | "negocio" | "vinculo" | null; coluna?: string; erro?: string } {
  const c = codigo.toUpperCase().trim();
  if (/^T-\d{4}$/.test(c)) return { tipo: "tese" };
  if (/^T-\d{1,3}$/.test(c)) return { tipo: null, erro: "T- precisa 4 dígitos · ex T-0053" };
  if (/^1N-\d{4}$/.test(c)) return { tipo: "negocio", coluna: "codigo" };
  if (/^1N-T[A-Z0-9]{6}$/.test(c)) return { tipo: "negocio", coluna: "codigo_diagnostico" };
  if (/^1N-\d{1,3}$/.test(c)) return { tipo: null, erro: "1N- precisa 4 dígitos · ex 1N-1149" };
  if (/^V-\d+$/.test(c)) return { tipo: "vinculo", erro: "isso é um código de vínculo · use o código da tese (T-XXXX) ou negócio (1N-XXXX)" };
  if (/^S-\d+$/.test(c)) return { tipo: null, erro: "isso é um código de sócio · use o código da tese (T-XXXX) ou negócio (1N-XXXX)" };
  return { tipo: null, erro: "formato inválido · use T-XXXX (tese) ou 1N-XXXX (negócio)" };
}

async function dispararEvento(tipo: string, vinculoId: string, meta: Record<string, unknown>) {
  try {
    await adminClient.from("eventos_usuario").insert({
      tipo,
      entidade_tipo: "vinculo_socio",
      entidade_id: vinculoId,
      usuario_id: null,
      sessao_id: "socio-pedir-vinculo-edge",
      meta,
    });
  } catch (e) {
    console.warn("[evento]", (e as Error).message);
  }
}

async function nomePhoneProprietario(userId: string): Promise<{ nome: string | null; phone: string | null }> {
  let nome: string | null = null;
  let phone: string | null = null;
  try {
    const { data } = await adminClient.from("usuarios").select("nome, whatsapp").eq("id", userId).maybeSingle();
    if (data) { nome = data.nome || null; phone = data.whatsapp || null; }
  } catch {}
  if (!phone) {
    try {
      const { data } = await adminClient.auth.admin.getUserById(userId);
      phone = data.user?.phone || null;
      if (!nome) {
        const m: any = data.user?.user_metadata || {};
        nome = m.nome || m.full_name || m.name || null;
      }
    } catch {}
  }
  return { nome, phone };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateSocio(req);
  if (!gate.ok || !gate.socio_id) return json({ ok: false, error: "socio_required" }, 403);

  let body: { codigo?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }
  const codigoIn = String(body?.codigo || "").trim().toUpperCase();
  if (!codigoIn) return json({ ok: false, error: "codigo_obrigatorio" }, 400);

  const det = detectarTipo(codigoIn);
  if (!det.tipo || det.tipo === "vinculo") {
    return json({ ok: false, error: det.erro || "formato_invalido" }, 400);
  }

  // Resolve entidade + proprietario
  let entidadeId: string;
  let proprietarioUserId: string | null = null;
  let teseId: string | null = null;
  let diagnosticoId: string | null = null;

  if (det.tipo === "tese") {
    const { data: tese } = await adminClient.from("teses_investimento")
      .select("id, usuario_id").eq("codigo", codigoIn).maybeSingle();
    if (!tese) return json({ ok: false, error: "tese_nao_encontrada" }, 404);
    entidadeId = tese.id;
    proprietarioUserId = tese.usuario_id || null;
    teseId = tese.id;
  } else {
    const coluna = det.coluna!;
    const { data: neg } = await adminClient.from("negocios")
      .select("id, vendedor_id").eq(coluna, codigoIn).maybeSingle();
    if (!neg) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);
    entidadeId = neg.id;
    proprietarioUserId = neg.vendedor_id || null;
    diagnosticoId = neg.id;
  }

  if (!proprietarioUserId) {
    return json({ ok: false, error: "proprietario_indisponivel" }, 500);
  }

  // Validação UNIQUE (double-check amigável · UNIQUE partial garante a baixo nível)
  const colVin = teseId ? "tese_id" : "diagnostico_id";
  const valVin = teseId || diagnosticoId!;

  const { count: ativoCount } = await adminClient.from("vinculos_socio")
    .select("id", { count: "exact", head: true })
    .eq(colVin, valVin).eq("status", "ativo");
  if ((ativoCount ?? 0) > 0) {
    return json({ ok: false, error: "ja_tem_socio_ativo" }, 409);
  }

  const { count: meuPendCount } = await adminClient.from("vinculos_socio")
    .select("id", { count: "exact", head: true })
    .eq(colVin, valVin)
    .eq("socio_id", gate.socio_id)
    .in("status", ["ativo", "aguardando_aceite_proprietario"]);
  if ((meuPendCount ?? 0) > 0) {
    return json({ ok: false, error: "ja_pediu_vinculo" }, 409);
  }

  // Gera código vínculo
  let vinculoCodigo: string | null = null;
  try {
    const { data: codeRow } = await adminClient.rpc("gerar_codigo_vinculo");
    vinculoCodigo = (codeRow as unknown as string) || null;
  } catch (e) {
    console.warn("[gerar_codigo_vinculo]", (e as Error).message);
  }

  // INSERT vínculo
  const { data: vinculo, error: errVinc } = await adminClient.from("vinculos_socio").insert({
    socio_id: gate.socio_id,
    tese_id: teseId,
    diagnostico_id: diagnosticoId,
    origem: "pedido_socio",
    status: "aguardando_aceite_proprietario",
    codigo: vinculoCodigo,
  }).select("id, codigo").single();
  if (errVinc || !vinculo) return json({ ok: false, error: "vinculo_insert_falhou", detalhe: errVinc?.message }, 500);

  // Busca phone do proprietário pra WhatsApp
  const { phone } = await nomePhoneProprietario(proprietarioUserId);
  if (phone) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/criar-notificacao-proprietario`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({
          vinculo_id: vinculo.id,
          proprietario_id: proprietarioUserId,
          proprietario_phone: phone,
          acao: "aceitar_pedido_vinculo",
        }),
      });
    } catch (e) {
      console.warn("[criar-notif call]", (e as Error).message);
    }
  } else {
    console.warn("[socio-pedir-vinculo] proprietario sem phone · WhatsApp não enviado · vinculo_id:", vinculo.id);
  }

  await dispararEvento("socio_pediu_vinculo", vinculo.id, {
    socio_id: gate.socio_id,
    socio_codigo: gate.socio_codigo,
    tipo: det.tipo,
    codigo_alvo: codigoIn,
    entidade_id: entidadeId,
    whatsapp_disparado: !!phone,
  });

  return json({
    ok: true,
    vinculo_id: vinculo.id,
    vinculo_codigo: vinculo.codigo,
    tipo: det.tipo,
    entidade_id: entidadeId,
  });
});
