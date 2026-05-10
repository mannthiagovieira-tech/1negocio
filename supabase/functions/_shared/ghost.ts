import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Busca um usuário por phone (em auth.users.phone OU em
 * user_metadata.phone, em ambas as variantes com/sem prefixo 55).
 * Se não achar, cria um ghost user com:
 *   - phone canônico em auth.users.phone (formato E.164 +55...)
 *   - phone_confirm: false (ghost ainda não validou OTP)
 *   - user_metadata.ghost: true
 *   - user_metadata.phone: phone com 55 (compat com ghosts antigos)
 *
 * Quando o ghost validar OTP via otp-verify, o branch existingUser
 * detecta `ghost: true` e promove (set phone_confirm + meta.ghost=false).
 *
 * Retorna:
 *   - { user_id, is_ghost: false }       → encontrou existente
 *   - { user_id, is_ghost: true }        → criou novo ghost
 *   - { user_id: null, is_ghost: false, erro } → falha
 */
export async function findOrCreateGhost(
  adminClient: SupabaseClient,
  phone: string,
  nome: string | null,
): Promise<{ user_id: string | null; is_ghost: boolean; erro?: string }> {
  const phoneLimpo = phone.replace(/\D/g, "");
  const phoneCom55 = phoneLimpo.startsWith("55") ? phoneLimpo : "55" + phoneLimpo;
  const phoneRaw = phoneCom55.replace(/^55/, "");
  const phoneE164 = "+" + phoneCom55;

  async function buscar(): Promise<any | null> {
    for (let page = 1; page <= 5; page++) {
      try {
        const { data, error } = await adminClient.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (error || !data?.users?.length) return null;
        const found = data.users.find((u: any) => {
          const p = String(u.phone || "").replace(/\D/g, "");
          const meta = String(u.user_metadata?.phone || "").replace(/\D/g, "");
          return (
            p === phoneCom55 ||
            p === phoneRaw ||
            meta === phoneCom55 ||
            meta === phoneRaw
          );
        });
        if (found) return found;
        if (data.users.length < 1000) return null;
      } catch (_e) {
        return null;
      }
    }
    return null;
  }

  // 1) Tenta achar existente (real ou ghost antigo)
  const existing = await buscar();
  if (existing) return { user_id: existing.id, is_ghost: false };

  // 2) Cria ghost novo · COM phone canônico
  try {
    const { data: created, error } = await adminClient.auth.admin.createUser({
      phone: phoneE164,           // 🆕 phone setado em auth.users.phone
      phone_confirm: false,       // ghost ainda não confirmou
      user_metadata: {
        nome: nome || "Proprietário",
        ghost: true,
        phone: phoneCom55,        // mantém pra compat com ghosts antigos
      },
    });
    if (!error && created.user?.id) {
      return { user_id: created.user.id, is_ghost: true };
    }
    // Erro pode ser "phone already exists" → re-busca
    const retry = await buscar();
    if (retry) return { user_id: retry.id, is_ghost: false };
    return {
      user_id: null,
      is_ghost: false,
      erro: error?.message || "createUser falhou sem detalhe",
    };
  } catch (e) {
    return {
      user_id: null,
      is_ghost: false,
      erro: (e as Error).message,
    };
  }
}

/**
 * Garante que `public.usuarios` tem uma row pra esse user_id.
 * Idempotente · se já existe, não faz nada.
 */
export async function ensureUsuarioRow(
  adminClient: SupabaseClient,
  userId: string,
  phoneCom55: string,
  nome: string | null,
  tipo: "buy" | "sell",
): Promise<void> {
  const { data: existing } = await adminClient
    .from("usuarios")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return;
  await adminClient.from("usuarios").insert({
    id: userId,
    whatsapp: phoneCom55,
    nome: nome || "Proprietário",
    tipo,
  });
}
