// enriquecer-lead-lusha · v9.34.2 · Sprint 3 · Motor V3
// Enriquece um lead específico via Claude + MCP Lusha (busca contato decisor).
// Atualiza pool_contatos_global (tel/email · só se vazios) + pool_contatos_uso (lusha_enriquecido · créditos).
//
// POST body: { uso_id: uuid, nome: string, empresa?: string, site?: string, cidade?: string }
// Output: { ok, found, nome?, cargo?, telefone?, email?, linkedin?, creditos_usados, motivo? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

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

async function chamarLusha(nome: string, empresa: string, site: string, cidade: string): Promise<{ ok: boolean; data?: any; erro?: string }> {
  const systemPrompt = `Você é um assistente de enriquecimento de dados B2B.
Siga SEMPRE este fluxo em ordem:

1. Se tiver site/domínio: use prospecting_contact_search com companyDomains
   Se não tiver: use prospecting_contact_search com companyNames
   Sempre filtrar: jobTitles ["Owner","Founder","CEO","Sócio","Proprietário"] · countries ["BR"] · page_size 10

2. Dos resultados retornados, liste os que têm hasPhones: true OU hasEmails: true

3. Se algum tiver dados disponíveis:
   - Enriqueça SOMENTE o de maior hierarquia (Owner > Founder > CEO)
   - Use prospecting_contact_enrich com o id do contato

4. Se nenhum tiver dados: retorne { found: false, motivo: "sem dados disponíveis" }

Retorne EXCLUSIVAMENTE este JSON estruturado (sem texto extra):
{
  "found": true,
  "nome": "...",
  "cargo": "...",
  "telefone": "...",
  "email": "...",
  "linkedin": "...",
  "creditos_usados": N
}
OU se nada encontrado:
{ "found": false, "motivo": "...", "creditos_usados": N }`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1500,
        mcp_servers: [{
          type: "url",
          url: "https://mcp.lusha.com/mcp/claude",
          name: "lusha",
        }],
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Enriqueça este lead:
Nome: ${nome}
Empresa: ${empresa || nome}
Site: ${site || "não disponível"}
Cidade: ${cidade || "Brasil"}`,
        }],
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text();
      return { ok: false, erro: `claude_status_${r.status} · ${errTxt.slice(0, 300)}` };
    }
    const data = await r.json();
    const textos = (data.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    // Extrai JSON
    let parsed: any = null;
    try {
      const clean = textos.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      const m = textos.match(/\{[\s\S]*"found"[\s\S]*\}/);
      if (m) {
        try { parsed = JSON.parse(m[0]); } catch {}
      }
    }
    if (!parsed) {
      return { ok: false, erro: `json_parse_falhou · raw: ${textos.slice(0, 300)}` };
    }
    return { ok: true, data: parsed };
  } catch (e: any) {
    return { ok: false, erro: `exception · ${e.message}` };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "metodo" });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

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
  const { uso_id, nome, empresa, site, cidade } = body || {};
  if (!uso_id) return resp(400, { ok: false, erro: "uso_id_obrigatorio" });
  if (!nome) return resp(400, { ok: false, erro: "nome_obrigatorio" });

  try {
    // Busca o uso + global atual
    const { data: uso, error: errUso } = await adminClient
      .from("pool_contatos_uso")
      .select("id, contato_id, originacao_id, lusha_enriquecido, lusha_creditos_usados")
      .eq("id", uso_id).maybeSingle();
    if (errUso || !uso) return resp(404, { ok: false, erro: "uso_nao_encontrado" });

    const { data: global } = await adminClient
      .from("pool_contatos_global")
      .select("id, nome, telefone, email, website, cidade")
      .eq("id", uso.contato_id).maybeSingle();
    if (!global) return resp(404, { ok: false, erro: "contato_global_nao_encontrado" });

    // Chama Lusha via MCP
    const r = await chamarLusha(
      nome || global.nome,
      empresa || global.nome,
      site || global.website || "",
      cidade || global.cidade || "",
    );
    if (!r.ok) {
      return resp(503, { ok: false, erro: r.erro || "lusha_indisponivel", motivo: "mcp_lusha_falhou" });
    }

    const result = r.data || {};
    const creditos = Number(result.creditos_usados || 0);

    // Marca lusha_enriquecido independente · evita gasto duplo
    await adminClient
      .from("pool_contatos_uso")
      .update({
        lusha_enriquecido: true,
        lusha_creditos_usados: (uso.lusha_creditos_usados || 0) + creditos,
        ultima_atividade: new Date().toISOString(),
      })
      .eq("id", uso_id);

    // Atualiza projetos_originacao.gasto_lusha_creditos_mes
    if (creditos > 0) {
      const { data: orig } = await adminClient
        .from("projetos_originacao").select("gasto_lusha_creditos_mes").eq("id", uso.originacao_id).maybeSingle();
      if (orig) {
        await adminClient
          .from("projetos_originacao")
          .update({ gasto_lusha_creditos_mes: (orig.gasto_lusha_creditos_mes || 0) + creditos })
          .eq("id", uso.originacao_id);
      }
    }

    if (!result.found) {
      return resp(200, {
        ok: true,
        found: false,
        motivo: result.motivo || "sem_dados_disponiveis",
        creditos_usados: creditos,
      });
    }

    // Atualiza global · só preenche campos vazios
    const patch: any = {};
    if (result.telefone && !global.telefone) patch.telefone = String(result.telefone).slice(0, 60);
    if (result.email && !global.email) patch.email = String(result.email).slice(0, 200);
    if (Object.keys(patch).length > 0) {
      patch.updated_at = new Date().toISOString();
      await adminClient.from("pool_contatos_global").update(patch).eq("id", global.id);
    }

    return resp(200, {
      ok: true,
      found: true,
      nome: result.nome || nome,
      cargo: result.cargo || null,
      telefone: result.telefone || null,
      email: result.email || null,
      linkedin: result.linkedin || null,
      creditos_usados: creditos,
      atualizado_no_global: Object.keys(patch).filter((k) => k !== "updated_at"),
    });
  } catch (e: any) {
    console.error("[lusha] exception raiz", e);
    return resp(500, { ok: false, erro: "exception_raiz", erro_debug: e?.message, stack: e?.stack?.slice(0, 1000) });
  }
});
