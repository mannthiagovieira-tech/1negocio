// aprovar-leads-busca · v9.35.0 · pré-aprovação seletiva de leads de uma busca.
// Recebe contato_ids[] do admin · upsert em pool_contatos_uso (status='novo').
// Atualiza originacao_buscas.leads_aprovados se busca_id informado.
//
// POST body: { busca_id?, contato_ids: uuid[], originacao_id?, arquetipo_id?, canal? }
// Output: { ok, aprovados, inseridos }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await sb.from("admins").select("id, ativo").eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { busca_id, contato_ids, originacao_id: origIdBody, arquetipo_id: arqIdBody, canal: canalBody } = body || {};
  if (!Array.isArray(contato_ids) || contato_ids.length === 0) return resp(400, { ok: false, erro: "nenhum_contato_selecionado" });

  let origId = origIdBody;
  let arqId = arqIdBody;
  let canal = canalBody;
  if (busca_id) {
    const { data: busca } = await sb.from("originacao_buscas").select("originacao_id, arquetipo_id, canal").eq("id", busca_id).maybeSingle();
    if (busca) {
      origId = origId || busca.originacao_id;
      arqId = arqId || busca.arquetipo_id;
      canal = canal || busca.canal;
    }
  }
  if (!origId) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  const agora = new Date().toISOString();
  const rows = contato_ids.map((cid: string) => ({
    contato_id: cid,
    originacao_id: origId,
    arquetipo_id: arqId || null,
    canal: canal || "manual",
    status: "novo",
    marcado_em: agora,
  }));

  const { data: inserted, error } = await sb
    .from("pool_contatos_uso")
    .upsert(rows, { onConflict: "contato_id,originacao_id,arquetipo_id", ignoreDuplicates: true })
    .select("id");
  if (error) return resp(500, { ok: false, erro: error.message });

  if (busca_id) {
    await sb.from("originacao_buscas").update({
      leads_aprovados: contato_ids.length,
      aprovado_em: agora,
      updated_at: agora,
    }).eq("id", busca_id);
  }

  return resp(200, {
    ok: true,
    aprovados: contato_ids.length,
    inseridos: inserted?.length || 0,
  });
});
