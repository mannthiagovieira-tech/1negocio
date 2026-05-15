// socio-buscar-codigo · V8 B8.13 SUB-BLOCO C FASE 3 · 1Negócio
// Sócio aprovado busca preview de uma tese ou negócio por código.
// Retorna iniciais do proprietário (sigilo · NUNCA nome completo) + indica se já tem sócio ativo.
//
// POST { codigo }
// → 200 { ok, tipo, codigo, resumo, proprietario_iniciais, tem_socio_ativo, ja_pediu_vinculo }
// → 400 invalid_format · 404 nao_encontrado · 403 sem_gate

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

async function gateSocio(req: Request): Promise<{ ok: boolean; socio_id?: string }> {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return { ok: false };
  const token = auth.slice(7);
  if (decodeJwtPayload(token)?.role === "service_role") return { ok: true };
  try {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user?.id) return { ok: false };
    const { data: socio } = await adminClient.from("socios")
      .select("id, status").eq("usuario_id", data.user.id).maybeSingle();
    if (!socio || socio.status !== "aprovado") return { ok: false };
    return { ok: true, socio_id: socio.id };
  } catch {
    return { ok: false };
  }
}

// Iniciais a partir de um nome · "Thiago Vieira" → "T.V."
function gerarIniciais(nome: string | null | undefined): string {
  if (!nome) return "??";
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "??";
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase() + ".";
  return partes[0].slice(0, 1).toUpperCase() + "." + partes[partes.length - 1].slice(0, 1).toUpperCase() + ".";
}

async function nomeProprietario(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  // Tenta public.usuarios
  try {
    const { data } = await adminClient.from("usuarios").select("nome").eq("id", userId).maybeSingle();
    if (data?.nome) return data.nome;
  } catch {}
  // Fallback auth meta
  try {
    const { data } = await adminClient.auth.admin.getUserById(userId);
    const m: any = data.user?.user_metadata || {};
    return m.nome || m.full_name || m.name || null;
  } catch { return null; }
}

// Detecta tipo a partir do código
//   T-XXXX        → tese (4 dígitos)
//   1N-XXXX       → negocio (numérico · negocios.codigo)
//   1N-TXXXXX     → negocio (alfanumérico · negocios.codigo_diagnostico)
//   V-XXXX        → vínculo (não aceito · usuário colou código errado)
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

  if (det.tipo === "tese") {
    const { data: tese } = await adminClient.from("teses_investimento")
      .select("id, codigo, titulo, descricao_curta, valor_alvo, usuario_id, status")
      .eq("codigo", codigoIn).maybeSingle();
    if (!tese) return json({ ok: false, error: "tese_nao_encontrada" }, 404);

    const nome = await nomeProprietario(tese.usuario_id);
    const iniciais = gerarIniciais(nome);

    // Tem sócio ativo nessa tese?
    const { count: ativoCount } = await adminClient.from("vinculos_socio")
      .select("id", { count: "exact", head: true })
      .eq("tese_id", tese.id).eq("status", "ativo");

    // Esse sócio já pediu/tem vínculo nessa tese?
    const { count: meuCount } = await adminClient.from("vinculos_socio")
      .select("id", { count: "exact", head: true })
      .eq("tese_id", tese.id)
      .eq("socio_id", gate.socio_id)
      .in("status", ["ativo", "aguardando_aceite_proprietario"]);

    return json({
      ok: true,
      tipo: "tese",
      codigo: tese.codigo,
      entidade_id: tese.id,
      resumo: tese.titulo || tese.descricao_curta || "Tese de investimento",
      valor_alvo: tese.valor_alvo,
      proprietario_iniciais: iniciais,
      tem_socio_ativo: (ativoCount ?? 0) > 0,
      ja_pediu_vinculo: (meuCount ?? 0) > 0,
    });
  }

  // negocio
  const coluna = det.coluna!;
  const { data: neg } = await adminClient.from("negocios")
    .select("id, codigo, codigo_diagnostico, nome, descricao_curta, setor, vendedor_id, status")
    .eq(coluna, codigoIn).maybeSingle();
  if (!neg) return json({ ok: false, error: "negocio_nao_encontrado" }, 404);

  const nome = await nomeProprietario(neg.vendedor_id);
  const iniciais = gerarIniciais(nome);

  const { count: ativoCount } = await adminClient.from("vinculos_socio")
    .select("id", { count: "exact", head: true })
    .eq("diagnostico_id", neg.id).eq("status", "ativo");

  const { count: meuCount } = await adminClient.from("vinculos_socio")
    .select("id", { count: "exact", head: true })
    .eq("diagnostico_id", neg.id)
    .eq("socio_id", gate.socio_id)
    .in("status", ["ativo", "aguardando_aceite_proprietario"]);

  return json({
    ok: true,
    tipo: "negocio",
    codigo: codigoIn,
    entidade_id: neg.id,
    resumo: neg.nome || neg.descricao_curta || "Negócio",
    setor: neg.setor,
    proprietario_iniciais: iniciais,
    tem_socio_ativo: (ativoCount ?? 0) > 0,
    ja_pediu_vinculo: (meuCount ?? 0) > 0,
  });
});
