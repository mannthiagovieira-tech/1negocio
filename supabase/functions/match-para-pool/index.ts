// match-para-pool · v9.17 · 1Negócio
// Adiciona um match (matchmaking_resultados) ao pool do projeto (projeto_pool_contatos).
// INSERT no pool · UPDATE matchmaking_resultados.projeto_id.
//
// POST { match_id, projeto_id }
// → 200 { ok, pool_contato_id, match }
// → 400/403/404 erros padronizados
//
// Auth · JWT admin (mesmo padrão de gerar-peca/atualizar-crm-diagnostico)
// verify_jwt · true

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

function brl(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function descreverFatores(fatores: any): string {
  if (!Array.isArray(fatores) || !fatores.length) return "";
  return fatores
    .map((f: any) => (typeof f === "object" && f?.codigo ? f.codigo : String(f)))
    .filter(Boolean)
    .slice(0, 8)
    .join(" · ");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "metodo" }, 405);

  const gate = await gateAdmin(req);
  if (!gate.ok) return json({ ok: false, error: "nao_autorizado" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "json_invalido" }, 400); }

  const match_id = String(body?.match_id || "").trim();
  const projeto_id = String(body?.projeto_id || "").trim();
  if (!match_id) return json({ ok: false, error: "params_invalidos", detalhe: "match_id" }, 400);
  if (!projeto_id) return json({ ok: false, error: "params_invalidos", detalhe: "projeto_id" }, 400);

  // 1. Pega o match
  const { data: match } = await adminClient
    .from("matchmaking_resultados")
    .select("id, tese_id, negocio_id, score_100, score_5_10, fatores_casados, status, comprador_nome, comprador_phone, projeto_id, tags_aplicadas, narrativa_ia")
    .eq("id", match_id)
    .maybeSingle();
  if (!match) return json({ ok: false, error: "match_nao_encontrado" }, 404);

  // 2. Confere projeto (existe + bate com o negocio do match)
  const { data: projeto } = await adminClient
    .from("projeto_metadata")
    .select("id, negocio_id, nome_negocio")
    .eq("id", projeto_id)
    .maybeSingle();
  if (!projeto) return json({ ok: false, error: "projeto_nao_encontrado" }, 404);

  if (projeto.negocio_id !== match.negocio_id) {
    return json({ ok: false, error: "match_de_outro_negocio", detalhe: "match.negocio_id ≠ projeto.negocio_id" }, 400);
  }

  // 3. Anti-dup · se já existe contato no pool com origem_detalhe=match_id, retorna o existente
  const { data: existente } = await adminClient
    .from("projeto_pool_contatos")
    .select("id")
    .eq("negocio_id", projeto.negocio_id)
    .eq("origem", "matchmaking_ia")
    .eq("origem_detalhe", match_id)
    .maybeSingle();
  if (existente) {
    return json({ ok: true, pool_contato_id: existente.id, match, ja_existia: true });
  }

  // 4. Monta observação descritiva
  const linhas: string[] = [];
  linhas.push(`Match IA · score ${match.score_100}/100 (${match.score_5_10}/10)`);
  const fatoresDesc = descreverFatores(match.fatores_casados);
  if (fatoresDesc) linhas.push(`Fatores: ${fatoresDesc}`);
  if (match.narrativa_ia) linhas.push(`\n${match.narrativa_ia}`);

  // 5. INSERT no pool · só preenche os campos disponíveis no schema atual
  const insertPayload: Record<string, unknown> = {
    negocio_id: projeto.negocio_id,
    nome: match.comprador_nome || "Comprador (Match IA)",
    telefone: match.comprador_phone || null,
    origem: "matchmaking_ia",
    origem_detalhe: match_id,
    status: "frio",
    observacoes_admin: linhas.join("\n"),
    created_by_admin_id: gate.admin_id || null,
  };
  const { data: novoContato, error: errIns } = await adminClient
    .from("projeto_pool_contatos")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();
  if (errIns) return json({ ok: false, error: "erro_insert_pool", detalhe: errIns.message }, 500);

  // 6. UPDATE matchmaking_resultados.projeto_id (cross-ref · não muda status pra preservar CHECK existente)
  const { error: errUpd } = await adminClient
    .from("matchmaking_resultados")
    .update({ projeto_id, atualizado_em: new Date().toISOString() })
    .eq("id", match_id);
  if (errUpd) console.warn("[match-para-pool] falha UPDATE projeto_id:", errUpd.message);

  return json({ ok: true, pool_contato_id: novoContato?.id, match });
});
