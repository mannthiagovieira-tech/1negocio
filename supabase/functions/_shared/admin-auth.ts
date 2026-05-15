// Helper compartilhado · valida JWT + checa se é admin via tabela `admins`
// (mesmo padrão que admin-api/index.ts usa)
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export async function checarAdmin(req: Request): Promise<{ ok: boolean; admin?: { id: string; nome: string }; erro?: string; status?: number }> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, erro: "Missing authorization token", status: 401 };
  }
  const accessToken = authHeader.replace("Bearer ", "").trim();
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await anonClient.auth.getUser(accessToken);
  if (userError || !userData?.user) return { ok: false, erro: "Invalid or expired token", status: 401 };
  const userPhone = userData.user.phone;
  if (!userPhone) return { ok: false, erro: "Token does not contain phone", status: 401 };

  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: adminRow } = await adminClient.from("admins").select("id, nome").eq("whatsapp", userPhone).maybeSingle();
  if (!adminRow) return { ok: false, erro: "Access denied: not an admin", status: 403 };
  return { ok: true, admin: adminRow as any };
}

export function svc(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export function jsonRes(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function gerarTokenHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function renderTemplate(texto: string, vars: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? `{${k}}`);
}

export function dataBR(): string {
  const d = new Date();
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export function formatBRL(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
