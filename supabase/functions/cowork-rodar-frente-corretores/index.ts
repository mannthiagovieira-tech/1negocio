// Edge Function: cowork-rodar-frente-corretores
// Etapa F2 · Cowork · ATIVO
//
// Roda 1 cidade rotativa (rotação · ORDER BY ultima_rodada NULLS FIRST · ordem ASC).
// Pra cada cidade · 2 queries Google Places via google-places-proxy:
//   · "corretor de imóveis comerciais {cidade}"
//   · "consultoria empresarial {cidade}"
// Insere resultados em leads_google com origem='gmaps_corretores' · dedup por place_id.
// Classifica em batch com Claude Haiku 4.5 em 4 categorias.
// Atualiza cowork_cidades_alvo.ultima_rodada=NOW().
//
// Custo estimado/execução:
//   · Google Places · ~40 calls × $0.01 ≈ $0.40/dia
//   · Anthropic Haiku · ~20 leads × $0.0007 ≈ $0.014/dia
//
// Cron · GitHub Actions · '30 6 * * *' (06:30 UTC = 03:30 BRT)
//
// Endpoint:
//   POST /functions/v1/cowork-rodar-frente-corretores
//   Body: { gkey?: string, force_cidade?: string }
//   Default · usa GOOGLE_API_KEY do secret · pega próxima cidade da rotação

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertLeadGoogle, normalizarTelefone, ehCelular } from "../_shared/dedup.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-haiku-4-5-20251001";
const QUERIES_BASE = ["corretor de imóveis comerciais", "consultoria empresarial"];
const MAX_RESULTS_POR_QUERY = 10;
const VALID_CATEGORIES = ["corretor_qualificado", "consultor_empresarial", "imobiliaria_residencial", "ambiguo"];

const SYSTEM_PROMPT = `Você é classificador de leads do Google Maps pra plataforma 1Negócio (compra e venda de empresas).

Tarefa · ler nome do estabelecimento + endereço + categoria Google e classificar em UMA das 4 categorias:

1. corretor_qualificado · corretor que atua com PONTOS COMERCIAIS / EMPRESAS
   Sinais · "imóveis comerciais", "ponto comercial", "fundo de comércio", "empresarial"

2. consultor_empresarial · consultoria/advocacia/contabilidade pra PMEs
   Sinais · "consultoria empresarial", "BPO", "advocacia empresarial"

3. imobiliaria_residencial · imobiliária PURA residencial
   Sinais · só "imóveis", "casa", "apartamento", sem comercial

4. ambiguo · não dá pra determinar

REGRAS:
- Saída JSON estrito: {"categoria":"...","motivo_breve":"..."}
- Em dúvida · prefere ambiguo
- "Imobiliária X" sem indicação comercial = imobiliaria_residencial`;

interface Cidade { id: string; cidade: string; uf: string; }
interface Lead {
  id?: string;
  nome: string;
  telefone?: string | null;
  cidade: string;
  estado?: string;
  endereco?: string;
  categoria?: string;
  place_id?: string;
}

async function callPlaces(query: string, gkey: string): Promise<any[]> {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${gkey}&language=pt-BR`;
  const proxyUrl = `${SUPABASE_URL}/functions/v1/google-places-proxy?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).slice(0, MAX_RESULTS_POR_QUERY);
  } catch (e) { console.warn("[places]", query, e); return []; }
}

async function callPlaceDetails(place_id: string, gkey: string): Promise<{ phone?: string; website?: string }> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=formatted_phone_number,international_phone_number,website&key=${gkey}&language=pt-BR`;
  const proxyUrl = `${SUPABASE_URL}/functions/v1/google-places-proxy?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) return {};
    const data = await res.json();
    return {
      phone: data.result?.international_phone_number || data.result?.formatted_phone_number || "",
      website: data.result?.website || "",
    };
  } catch (e) { return {}; }
}

function fmtTelBR(tel: string): string {
  const n = String(tel || "").replace(/\D/g, "");
  if (!n) return "";
  if (n.startsWith("55") && n.length >= 12) return n;
  if (n.length === 11 || n.length === 10) return "55" + n;
  return n;
}

async function classificarCorretor(lead: Lead): Promise<{ categoria: string; motivo: string }> {
  try {
    const prompt = `NOME: ${lead.nome}\nENDEREÇO: ${lead.endereco || "—"}\nCIDADE: ${lead.cidade}\nCATEGORIA GOOGLE: ${lead.categoria || "—"}\n\nClassifique e devolva APENAS o JSON.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return { categoria: "ambiguo", motivo: "Anthropic " + res.status };
    const data = await res.json();
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    let p: any; try { p = JSON.parse(raw); } catch { return { categoria: "ambiguo", motivo: "JSON inválido" }; }
    const cat = String(p.categoria || "").trim();
    if (!VALID_CATEGORIES.includes(cat)) return { categoria: "ambiguo", motivo: "categoria inválida" };
    return { categoria: cat, motivo: String(p.motivo_breve || "").slice(0, 200) };
  } catch (e) { return { categoria: "ambiguo", motivo: String((e as Error).message) }; }
}

async function processarLotes<T, R>(items: T[], batchSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const lote = items.slice(i, i + batchSize);
    out.push(...(await Promise.all(lote.map(fn))));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    const gkey = body?.gkey || GOOGLE_API_KEY;
    if (!gkey) return jsonErr("GOOGLE_API_KEY não configurada · setar como secret OU passar via body.gkey");

    let cidade: Cidade | null = null;
    if (body?.force_cidade) {
      const { data } = await supabase.from("cowork_cidades_alvo")
        .select("id,cidade,uf").eq("cidade", body.force_cidade).maybeSingle();
      cidade = data || null;
    } else {
      const { data } = await supabase.from("cowork_cidades_alvo")
        .select("id,cidade,uf").eq("ativo", true)
        .order("ultima_rodada", { ascending: true, nullsFirst: true })
        .order("ordem", { ascending: true })
        .limit(1).maybeSingle();
      cidade = data || null;
    }
    if (!cidade) return jsonErr("nenhuma cidade ativa em cowork_cidades_alvo", 404);

    const queries = QUERIES_BASE.map(q => `${q} ${cidade!.cidade}`);
    const allResults: any[] = [];
    for (const q of queries) {
      const r = await callPlaces(q, gkey);
      allResults.push(...r);
    }

    const dedup = new Map<string, any>();
    allResults.forEach(p => { if (p.place_id) dedup.set(p.place_id, p); });
    const places = [...dedup.values()];

    const places_com_tel = await processarLotes(places, 5, async (p) => {
      const det = await callPlaceDetails(p.place_id, gkey);
      return { ...p, _phone: det.phone, _website: det.website };
    });

    // Item 3 · dedup global por telefone + Item 4 · filtro celular
    let inseridos: any[] = [];
    let pulados_fixo = 0;
    let pulados_invalido = 0;
    let merged = 0;
    for (const p of places_com_tel) {
      const telBruto = fmtTelBR(p._phone || "");
      // Item 4 · filtro celular global · corretores fixos pulam
      if (telBruto && !ehCelular(telBruto)) { pulados_fixo++; continue; }
      const telNorm = normalizarTelefone(telBruto);
      if (!telNorm) { pulados_invalido++; continue; }

      const r = await upsertLeadGoogle(supabase, {
        nome: p.name,
        telefone: telNorm,
        endereco: p.formatted_address || null,
        cidade: cidade!.cidade,
        estado: cidade!.uf,
        categoria: (p.types || [])[0] || "corretor",
        website: p._website || null,
        place_id: p.place_id,
        origem: "gmaps_corretores",
        status: "novo",
        url_anuncio: p._website || null,
        campanha: `gmaps-corretores-${cidade!.cidade.toLowerCase().replace(/\s+/g, "-")}`,
      });
      if (r.created && r.lead_id) {
        inseridos.push({
          id: r.lead_id,
          nome: p.name,
          telefone: telNorm,
          cidade: cidade!.cidade,
          estado: cidade!.uf,
          endereco: p.formatted_address,
          categoria: (p.types || [])[0] || "corretor",
          place_id: p.place_id,
        });
      } else if (r.lead_id) {
        merged++;
      }
    }

    const classRes = await processarLotes(inseridos, 5, async (l: Lead) => {
      const c = await classificarCorretor(l);
      await supabase.from("leads_google")
        .update({
          classificacao_ia: c.categoria,
          classificado_em: new Date().toISOString(),
          notas: `[IA·corretor] ${c.motivo}`,
        }).eq("id", l.id!);
      return { id: l.id, categoria: c.categoria };
    });

    const porCategoria: Record<string, number> = {};
    classRes.forEach(r => { porCategoria[r.categoria] = (porCategoria[r.categoria] || 0) + 1; });

    await supabase.from("cowork_cidades_alvo")
      .update({ ultima_rodada: new Date().toISOString().slice(0, 10) })
      .eq("id", cidade.id);

    return jsonOk({
      ok: true,
      cidade: `${cidade.cidade}/${cidade.uf}`,
      total_capturados: places.length,
      novos_inseridos: inseridos.length,
      merged_dedup: merged,
      pulados_fixo: pulados_fixo,
      pulados_telefone_invalido: pulados_invalido,
      classificados: classRes.length,
      por_categoria: porCategoria,
    });
  } catch (e) {
    console.error("[cowork-rodar-frente-corretores]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonErr(e: string, s = 400) { return new Response(JSON.stringify({ ok: false, erro: e }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
