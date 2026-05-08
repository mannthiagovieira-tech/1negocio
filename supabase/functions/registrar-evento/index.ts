// registrar-evento · BLOCO 3 v6 · 1negocio.com.br
// Registra evento em public.eventos_usuario (schema legado polimórfico)
// Aceita { tipo, entidade_tipo?, entidade_id?, meta?, duracao_ms? }
// Server-side popula: usuario_id (JWT) · sessao_id (header) · ip · user_agent
// Rate limit: 100 req/min por sessao_id (em memória · TTL janela 60s)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TIPOS_VALIDOS = new Set([
  "termo_sigilo_assinado",
  "view_card_negocio", "click_card_negocio", "view_negocio_detalhe",
  "salvar_negocio", "remover_salvo", "abrir_modal_solicitar", "abrir_modal_salvar",
  "enviar_solicitacao", "cadastrar_tese", "editar_tese",
  "pausar_tese", "ativar_tese", "view_tese_detalhe",
  "login_otp", "logout", "view_perfil_anuncio",
]);

const ENTIDADE_TIPOS_VALIDOS = new Set(["negocio", "tese", "anuncio", "usuario"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-session-id, X-Session-Id",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Rate limit em memória · janela de 60s · 100 req max por sessao_id
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 100;

function checkRate(sessao_id: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(sessao_id);
  if (!entry || entry.resetAt < now) {
    rateMap.set(sessao_id, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

// Limpeza periódica do rate map (impede leak)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateMap.entries()) if (v.resetAt < now) rateMap.delete(k);
}, RATE_WINDOW_MS);

function extractIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || null;
}

async function getUserIdFromJwt(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const { data } = await adminClient.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo nao permitido" }, 405);

  let body: {
    tipo?: string;
    entidade_tipo?: string;
    entidade_id?: string;
    meta?: Record<string, unknown>;
    duracao_ms?: number;
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "JSON invalido" }, 400);
  }

  const { tipo, entidade_tipo, entidade_id, meta, duracao_ms } = body;

  if (!tipo || typeof tipo !== "string") {
    return json({ ok: false, error: "tipo obrigatorio" }, 400);
  }
  if (!TIPOS_VALIDOS.has(tipo)) {
    return json({ ok: false, error: "tipo invalido" }, 400);
  }
  if (entidade_tipo && !ENTIDADE_TIPOS_VALIDOS.has(entidade_tipo)) {
    return json({ ok: false, error: "entidade_tipo invalido" }, 400);
  }
  if (entidade_id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entidade_id)) {
    return json({ ok: false, error: "entidade_id deve ser uuid" }, 400);
  }

  const sessao_id = req.headers.get("x-session-id") || req.headers.get("X-Session-Id") || null;
  if (!sessao_id) {
    return json({ ok: false, error: "X-Session-Id header obrigatorio" }, 400);
  }
  if (!checkRate(sessao_id)) {
    return json({ ok: false, error: "rate limit · 100 req/min por sessao" }, 429);
  }

  const usuario_id = await getUserIdFromJwt(req);
  const ip = extractIp(req);
  const user_agent = req.headers.get("user-agent");

  const row = {
    usuario_id,
    sessao_id,
    tipo,
    entidade_tipo: entidade_tipo ?? null,
    entidade_id: entidade_id ?? null,
    duracao_ms: typeof duracao_ms === "number" ? duracao_ms : null,
    meta: meta && typeof meta === "object" ? meta : {},
    ip,
    user_agent,
  };

  const { error } = await adminClient.from("eventos_usuario").insert(row);
  if (error) {
    console.error("[registrar-evento] insert err:", error.message);
    return json({ ok: false, error: "erro ao registrar" }, 500);
  }

  return json({ ok: true });
});
