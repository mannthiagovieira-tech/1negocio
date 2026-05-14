// originacao-buscar-associacoes · v9.34.5 · Sprint 6
// Claude Sonnet + web_search · acha associações empresariais relevantes pro setor+cidade
// UPSERT em pool_contatos_global · categoria='associacao_setorial' · canal='associacoes'
//
// POST { originacao_id }
// Output: { ok, associacoes:[{nome, sigla, cidade, site, relevancia}], total, custo_brl }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CUSTO_BRL = 0.10;

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

function extrairJson(texto: string): any | null {
  try { return JSON.parse(texto); } catch {}
  const m1 = texto.match(/```json\s*([\s\S]*?)\s*```/);
  if (m1) { try { return JSON.parse(m1[1]); } catch {} }
  const m2 = texto.match(/\{[\s\S]*\}/);
  if (m2) { try { return JSON.parse(m2[0]); } catch {} }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth admin canônico
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return resp(401, { ok: false, erro: "sem_jwt" });
  const { data: userData, error: userErr } = await adminClient.auth.getUser(jwt);
  if (userErr || !userData?.user) return resp(401, { ok: false, erro: "jwt_invalido" });
  const { data: admin } = await adminClient
    .from("admins").select("id, ativo")
    .eq("whatsapp", userData.user.phone).eq("ativo", true).maybeSingle();
  if (!admin) return resp(403, { ok: false, erro: "nao_admin" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }
  const { originacao_id } = body || {};
  if (!originacao_id) return resp(400, { ok: false, erro: "originacao_id_obrigatorio" });

  try {
    const { data: orig } = await adminClient
      .from("projetos_originacao")
      .select("id, fase_atual, briefing_jsonb, gasto_anthropic_mes")
      .eq("id", originacao_id).maybeSingle();
    if (!orig) return resp(404, { ok: false, erro: "originacao_nao_encontrada" });

    const negocio = orig.briefing_jsonb?.negocio || {};
    const setor = negocio.setor || "comércio";
    const subSetor = negocio.sub_setor || "";
    const cidade = negocio.cidade || "Brasil";
    const estado = negocio.estado || "";

    const systemPrompt = `Você é especialista em ecossistema empresarial brasileiro.
Encontre associações empresariais, sindicatos e entidades setoriais REAIS e VERIFICÁVEIS para este setor.

EXEMPLOS DO TIPO CERTO:
- ABRASEL (bares e restaurantes · nacional)
- CDL (Câmara de Dirigentes Lojistas · cidade)
- ACIBH (Associação Comercial de Belo Horizonte · cidade)
- SINDBEBIDAS (sindicato bebidas · estadual/nacional)
- ABF (franquias · nacional)

REGRAS:
- Só inclua entidades que realmente existem
- Use web_search pra confirmar site oficial
- Misture nacionais (relevantes pro setor) com locais (cidade do negócio)
- Máximo 8 associações

Retorne SOMENTE JSON válido:
{ "associacoes": [{
  "nome": "Nome completo da entidade",
  "sigla": "...",
  "cidade": "local" | "nacional" | "estadual",
  "site": "https://...",
  "relevancia": "por que relevante pra este setor/contexto"
}]}`;

    const userMsg = `NEGÓCIO À VENDA
Setor: ${setor}${subSetor ? " / " + subSetor : ""}
Localização: ${cidade}${estado ? "/" + estado : ""}

Use web_search e retorne o JSON com até 8 associações relevantes.`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2500,
        system: systemPrompt,
        messages: [{ role: "user", content: userMsg }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      }),
    });

    if (!r.ok) {
      const errTxt = await r.text();
      return resp(500, { ok: false, erro: `anthropic_status_${r.status}`, detalhe: errTxt.slice(0, 300) });
    }

    const data = await r.json();
    const blocosTexto = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const parsed = extrairJson(blocosTexto);
    if (!parsed || !Array.isArray(parsed.associacoes)) {
      return resp(500, { ok: false, erro: "json_parse_falhou", raw: blocosTexto.slice(0, 400) });
    }

    const associacoes = parsed.associacoes.slice(0, 8).map((a: any) => ({
      nome: String(a.nome || "").trim(),
      sigla: String(a.sigla || "").trim(),
      cidade: String(a.cidade || "").trim(),
      site: String(a.site || "").trim(),
      relevancia: String(a.relevancia || "").trim(),
    })).filter((a: any) => a.nome);

    // UPSERT em pool_contatos_global · canal='associacoes' · categoria='associacao_setorial'
    const contatoIds: string[] = [];
    for (const a of associacoes) {
      const identCanon = (a.site || a.nome).toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
      const { data: upserted } = await adminClient
        .from("pool_contatos_global")
        .upsert({
          identificador_canonico: identCanon,
          fonte_origem: "manual_admin",
          nome: a.nome + (a.sigla ? ` (${a.sigla})` : ""),
          email: null,
          telefone: null,
          endereco_completo: null,
          cidade: a.cidade === "local" ? cidade : null,
          estado: a.cidade === "local" ? estado : null,
          categoria_setorial: "associacao_setorial",
          tags_consolidadas: ["associacao", setor, a.cidade],
          dados_brutos: { ...a, _fonte: "claude_web", _setor: setor, _cidade_busca: cidade },
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "identificador_canonico,fonte_origem" })
        .select("id")
        .maybeSingle();
      if (upserted?.id) contatoIds.push(upserted.id);
    }

    // Atualiza gasto + retorna
    await adminClient
      .from("projetos_originacao")
      .update({
        gasto_anthropic_mes: Number(orig.gasto_anthropic_mes || 0) + CUSTO_BRL,
        updated_at: new Date().toISOString(),
      })
      .eq("id", originacao_id);

    return resp(200, {
      ok: true,
      associacoes,
      contato_ids: contatoIds,
      total: associacoes.length,
      custo_brl: CUSTO_BRL,
      tokens_in: data?.usage?.input_tokens ?? 0,
      tokens_out: data?.usage?.output_tokens ?? 0,
    });
  } catch (e: any) {
    console.error("[originacao-buscar-associacoes] exception", e);
    return resp(500, { ok: false, erro: "exception_raiz", detalhe: e?.message?.slice(0, 300) });
  }
});
