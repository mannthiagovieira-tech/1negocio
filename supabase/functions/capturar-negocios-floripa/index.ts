// Edge Function: capturar-negocios-floripa
// Item 5 · captura massiva B2B Grande Floripa (500 negócios alvo)
//
// Google Places Nearby Search por categoria · radius 35km lat -27.5949 lng -48.5482
// Filtros: business_status=OPERATIONAL · rating>=4.0 · reviews>=5 · ehCelular()
// Dedup global por telefone (Item 3 · upsertLeadGoogle)
// Classificador Haiku 4.5 · potencial_alto · potencial_medio · potencial_baixo · descartar
// Tag/campanha: campanha_floripa_2026_05 · origem=gmaps_floripa
//
// Endpoint:
//   POST /functions/v1/capturar-negocios-floripa
//   Body: { categoria_only?: string, max_per_categoria?: number }
//   categoria_only · roda só 1 categoria (smoke)
//   max_per_categoria · limita resultados (default 60 = paginação cheia Google)

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

// Florianópolis centro · cobre Floripa + São José + Palhoça (35km radius)
const FLORIPA_LAT = -27.5949;
const FLORIPA_LNG = -48.5482;
const RADIUS_M = 35000;

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const VALID_CATS = ["potencial_alto", "potencial_medio", "potencial_baixo", "descartar"];

const CATEGORIAS = [
  // ALIMENTAÇÃO
  { setor: "alimentacao", keyword: "restaurante" },
  { setor: "alimentacao", keyword: "padaria" },
  { setor: "alimentacao", keyword: "lanchonete" },
  { setor: "alimentacao", keyword: "pizzaria" },
  { setor: "alimentacao", keyword: "cafeteria" },
  // COMÉRCIO
  { setor: "comercio", keyword: "minimercado" },
  { setor: "comercio", keyword: "loja de roupas" },
  { setor: "comercio", keyword: "loja de calcados" },
  { setor: "comercio", keyword: "pet shop" },
  { setor: "comercio", keyword: "papelaria" },
  // BELEZA
  { setor: "beleza", keyword: "salao de beleza" },
  { setor: "beleza", keyword: "barbearia" },
  { setor: "beleza", keyword: "clinica estetica" },
  { setor: "beleza", keyword: "spa" },
  // ATIVIDADE
  { setor: "atividade", keyword: "academia" },
  { setor: "atividade", keyword: "studio pilates" },
  // SAÚDE
  { setor: "saude", keyword: "clinica odontologica" },
  { setor: "saude", keyword: "clinica veterinaria" },
];

const PROMPT_FLORIPA = `Você é classificador de negócios B2B em Grande Florianópolis pra plataforma 1Negócio (compra e venda de empresas/PMEs).

Contexto · scrapou negócios físicos de categorias do Google Maps. Objetivo: estimar potencial de VENDA da empresa (alvo de prospecção).

Tarefa · classifica em 1 das 4:

1. potencial_alto · negócio CONSOLIDADO com sinais de operação madura
   Sinais · rating >=4.5 · reviews >=50 · nome com marca própria (não genérico) · categoria estável (restaurante · padaria · clínica · salão consolidado)

2. potencial_medio · negócio operacional saudável mas não destaque
   Sinais · rating 4.0-4.5 · reviews 10-50 · categoria padrão · sem indicadores fortes de marca

3. potencial_baixo · operacional mas pequeno · talvez microempresário
   Sinais · rating <4.0 ou reviews <10 · categoria nicho fraco · provável MEI sem viés de venda formal

4. descartar · não é alvo da 1Negócio
   Sinais · rede grande/franquia (Subway, Burger King) · cadeia nacional · spam · clínica de plano de saúde popular

REGRAS:
- Saída JSON estrito: {"categoria":"...","motivo":"..."}
- "motivo" max 100 chars em PT-BR
- Em dúvida potencial_medio vs alto · vai medio (conservador)
- Franquias/redes grandes · descartar (não compram empresa)`;

interface Place {
  place_id: string;
  name: string;
  formatted_address?: string;
  vicinity?: string;
  business_status?: string;
  rating?: number;
  user_ratings_total?: number;
  types?: string[];
  geometry?: any;
}

async function googlePlacesNearby(keyword: string): Promise<Place[]> {
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${FLORIPA_LAT},${FLORIPA_LNG}&radius=${RADIUS_M}&keyword=${encodeURIComponent(keyword)}&language=pt-BR&key=${GOOGLE_API_KEY}`;
  const proxyUrl = `${SUPABASE_URL}/functions/v1/google-places-proxy?url=${encodeURIComponent(url)}`;
  const out: Place[] = [];
  let nextToken: string | undefined;
  for (let page = 0; page < 3; page++) {
    const u = nextToken
      ? `${SUPABASE_URL}/functions/v1/google-places-proxy?url=${encodeURIComponent(`https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${nextToken}&key=${GOOGLE_API_KEY}`)}`
      : proxyUrl;
    if (page > 0) await new Promise(r => setTimeout(r, 2000)); // Google exige delay para next_page_token
    const res = await fetch(u);
    if (!res.ok) break;
    const data = await res.json();
    out.push(...(data.results || []));
    nextToken = data.next_page_token;
    if (!nextToken) break;
  }
  return out;
}

async function googlePlaceDetails(place_id: string): Promise<{ phone?: string; website?: string }> {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=international_phone_number,formatted_phone_number,website&language=pt-BR&key=${GOOGLE_API_KEY}`;
  const proxyUrl = `${SUPABASE_URL}/functions/v1/google-places-proxy?url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(proxyUrl);
    if (!res.ok) return {};
    const data = await res.json();
    return {
      phone: data.result?.international_phone_number || data.result?.formatted_phone_number || "",
      website: data.result?.website || "",
    };
  } catch { return {}; }
}

async function classificarFloripa(p: { nome: string; categoria: string; endereco: string; rating: number | null; reviews: number | null }): Promise<{ categoria: string; motivo: string }> {
  try {
    const prompt = `NEGÓCIO: ${p.nome}\nCATEGORIA: ${p.categoria}\nENDEREÇO: ${p.endereco || "—"}\nRATING: ${p.rating ?? "—"}\nREVIEWS: ${p.reviews ?? "—"}\n\nClassifique e devolva só o JSON.`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: HAIKU_MODEL, max_tokens: 150, system: PROMPT_FLORIPA, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return { categoria: "potencial_baixo", motivo: `Anthropic ${res.status}` };
    const data = await res.json();
    const raw = (data.content?.[0]?.text || "").replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(raw);
    const cat = String(parsed.categoria || "").trim();
    return VALID_CATS.includes(cat)
      ? { categoria: cat, motivo: String(parsed.motivo || "").slice(0, 200) }
      : { categoria: "potencial_baixo", motivo: "categoria inválida" };
  } catch (e) { return { categoria: "potencial_baixo", motivo: String((e as Error).message).slice(0, 100) }; }
}

async function processarLotes<T, R>(items: T[], size: number, fn: (i: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const lote = items.slice(i, i + size);
    out.push(...(await Promise.all(lote.map(fn))));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body = await req.json().catch(() => ({}));
    if (!GOOGLE_API_KEY) return jsonErr("GOOGLE_API_KEY não configurada");

    const categoriaOnly = body?.categoria_only;
    const maxPerCat = Math.min(Math.max(parseInt(body?.max_per_categoria) || 60, 1), 60);

    let cats = categoriaOnly
      ? CATEGORIAS.filter(c => c.keyword === categoriaOnly)
      : CATEGORIAS;
    // Suporte a categorias customizadas via body.categorias=[{setor,keyword}|"keyword"]
    if (Array.isArray(body?.categorias) && body.categorias.length) {
      cats = body.categorias.map((c: any) =>
        typeof c === 'string'
          ? { setor: 'custom', keyword: c }
          : { setor: c.setor || 'custom', keyword: String(c.keyword || c) }
      );
    }

    if (!cats.length) return jsonErr("categoria_only não encontrada nas 18 cadastradas");

    const resumo: any[] = [];
    let totalCapturados = 0;
    let totalNovos = 0;
    let totalMerged = 0;
    let totalPuladosFixo = 0;
    let totalPuladosFiltro = 0;
    let totalClassificados = 0;
    const distFinal: Record<string, number> = {};

    for (const cat of cats) {
      const t0 = Date.now();
      const places = await googlePlacesNearby(cat.keyword);
      const placesLimit = places.slice(0, maxPerCat);

      // Filtros: OPERATIONAL + rating >=4 + reviews >=5
      const filtrados = placesLimit.filter(p =>
        (p.business_status || "OPERATIONAL") === "OPERATIONAL" &&
        (p.rating ?? 0) >= 4.0 &&
        (p.user_ratings_total ?? 0) >= 5
      );
      const puladosFiltro = placesLimit.length - filtrados.length;

      // Place details (telefone + website) em paralelo
      const placesComTel = await processarLotes(filtrados, 5, async (p: Place) => {
        const det = await googlePlaceDetails(p.place_id);
        return { ...p, _phone: det.phone, _website: det.website };
      });

      // Filtro celular (Item 4)
      const novos: any[] = [];
      let merged = 0;
      let puladosFixo = 0;
      for (const p of placesComTel) {
        if (!ehCelular(p._phone || "")) { puladosFixo++; continue; }
        const telNorm = normalizarTelefone(p._phone || "");
        if (!telNorm) { puladosFixo++; continue; }

        const r = await upsertLeadGoogle(supabase, {
          nome: p.name,
          telefone: telNorm,
          endereco: p.formatted_address || p.vicinity || null,
          cidade: "Florianópolis", // TODO inferir cidade real do endereço
          estado: "SC",
          setor: cat.setor,
          categoria: cat.keyword,
          website: p._website || null,
          place_id: p.place_id,
          origem: "gmaps_floripa",
          status: "novo",
          campanha: "campanha_floripa_2026_05",
          tags: ["campanha_floripa_2026_05", `floripa_${cat.setor}`],
        });
        if (r.created && r.lead_id) {
          novos.push({
            id: r.lead_id,
            nome: p.name,
            categoria: cat.keyword,
            endereco: p.formatted_address || p.vicinity || "",
            rating: p.rating ?? null,
            reviews: p.user_ratings_total ?? null,
          });
        } else if (r.lead_id) {
          merged++;
        }
      }

      // Classifica os NOVOS via Haiku
      const classRes = await processarLotes(novos, 5, async (n: any) => {
        const c = await classificarFloripa({
          nome: n.nome,
          categoria: n.categoria,
          endereco: n.endereco,
          rating: n.rating,
          reviews: n.reviews,
        });
        await supabase.from("leads_google").update({
          classificacao_ia: c.categoria,
          classificado_em: new Date().toISOString(),
          notas: `[IA·floripa] ${c.motivo}`,
        }).eq("id", n.id);
        return c.categoria;
      });
      classRes.forEach(c => { distFinal[c] = (distFinal[c] || 0) + 1; });

      totalCapturados += places.length;
      totalNovos += novos.length;
      totalMerged += merged;
      totalPuladosFixo += puladosFixo;
      totalPuladosFiltro += puladosFiltro;
      totalClassificados += classRes.length;

      resumo.push({
        keyword: cat.keyword,
        setor: cat.setor,
        capturados_google: places.length,
        passou_filtro_qualidade: filtrados.length,
        com_celular: novos.length + merged,
        novos_inseridos: novos.length,
        merged_dedup: merged,
        pulados_fixo: puladosFixo,
        classificados: classRes.length,
        duracao_ms: Date.now() - t0,
      });
    }

    return jsonOk({
      ok: true,
      categorias_processadas: cats.length,
      total_capturados_google: totalCapturados,
      total_novos_inseridos: totalNovos,
      total_merged_dedup: totalMerged,
      total_pulados_fixo: totalPuladosFixo,
      total_pulados_filtro_qualidade: totalPuladosFiltro,
      total_classificados: totalClassificados,
      distribuicao_classificacao: distFinal,
      detalhe: resumo,
    });
  } catch (e) {
    console.error("[capturar-negocios-floripa]", e);
    return jsonErr(String((e as Error).message || e), 500);
  }
});

function jsonOk(p: unknown) { return new Response(JSON.stringify(p), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function jsonErr(e: string, s = 400) { return new Response(JSON.stringify({ ok: false, erro: e }), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
