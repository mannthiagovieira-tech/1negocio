import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const APIFY_TOKEN_OLX_ENV = Deno.env.get('APIFY_TOKEN_OLX')
  ?? Deno.env.get('APIFY_TOKEN')
  ?? Deno.env.get('APIFY_API_TOKEN')
  ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const IMOVEL_KEYWORDS = [
  'apartamento', 'apto', 'ap. ', 'ap,', 'ap.',
  'terreno', 'lote ', 'lotes ', 'loteamento',
  'casa para vender', 'vendo casa', 'casa à venda', 'casa a venda',
  'sobrado', 'cobertura', 'kitnet', 'studio', 'flat ',
  'sala comercial', 'sala para alugar', 'sala para locação',
  'imóvel', 'imovel', 'imóveis', 'imoveis',
  'aluguel', 'aluga-se', 'aluga se', 'para alugar',
  'condomínio', 'condominio',
  'm² de área', 'm2 de área', 'metros quadrados',
  'escritura', 'financiamento imobiliário',
  'incorporadora', 'construtora',
  'chácara', 'chacara', 'fazenda', 'sítio', 'sitio', 'rural', 'haras', 'granja',
];

function isImovel(item: any): boolean {
  const text = [
    item.title || '',
    item.subject || '',
    item.description || '',
    item.category || '',
    item.subcategory || '',
  ].join(' ').toLowerCase();
  return IMOVEL_KEYWORDS.some(kw => text.includes(kw));
}

// Extrai valor numérico de price (string "R$ 500.000" OU objeto {value/amount} OU "500 mil")
function extrairValor(price: any): number | null {
  if (price == null) return null;
  let raw: string;
  if (typeof price === 'object') {
    raw = String(price.value ?? price.amount ?? '');
  } else {
    raw = String(price);
  }
  if (!raw) return null;
  raw = raw.toLowerCase().replace(/r\$\s*/g, '').trim();
  // "500 mil" / "1,5 milhão" / "2 milhões"
  if (/mil/.test(raw)) {
    const m = raw.match(/([\d.,]+)\s*mil/);
    if (m) return Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 1000);
  }
  if (/milh/.test(raw)) {
    const m = raw.match(/([\d.,]+)\s*milh/);
    if (m) return Math.round(parseFloat(m[1].replace(/\./g, '').replace(',', '.')) * 1_000_000);
  }
  // "500.000" ou "500000,00"
  const norm = raw.replace(/\s/g, '');
  const m = norm.match(/(\d+(?:\.\d{3})*(?:,\d{2})?)/);
  if (m) {
    const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const {
      apify_token: tokenBody,
      queries,
      max_pages = 3,
      sort_by = 'newest',
      campanha = 'olx-negocios',
      auto = false,
      valor_minimo = null,
    } = body;

    const apify_token = tokenBody || APIFY_TOKEN_OLX_ENV;
    if (!apify_token) {
      return new Response(JSON.stringify({ error: 'apify_token required (no body OR APIFY_TOKEN_OLX env var)' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const errors: string[] = [];
    const allItems: any[] = [];

    for (const query of (queries || [])) {
      const runResp = await fetch(
        `https://api.apify.com/v2/acts/daddyapi~olx-brazil-scraper/run-sync-get-dataset-items?token=${apify_token}&timeout=120&memory=256`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            searchQuery: query,
            olxDomain: 'olx.com.br',
            sortBy: sort_by,
            maxPages: max_pages,
            proxyConfiguration: { useApifyProxy: true }
          })
        }
      );
      if (!runResp.ok) {
        errors.push(`Apify error for "${query}": ${runResp.status}`);
        continue;
      }
      const items = await runResp.json();
      if (Array.isArray(items)) allItems.push(...items);
    }

    const totalRaw = allItems.length;
    const filtered = allItems.filter(item => !isImovel(item));
    const filteredImovel = totalRaw - filtered.length;

    const valorMinNum = valor_minimo ? Number(valor_minimo) : null;
    let filteredValor = 0;

    const leads = filtered.map(item => {
      const valorNum = extrairValor(item.price);
      const url = item.url || item.friendlyUrl || null;
      return {
        nome: item.title || item.subject || 'Anúncio OLX',
        telefone: null,
        cidade: (typeof item.location === 'string'
          ? item.location.split(' - ')[0]
          : (item.location?.municipality || item.location?.city || item._city || '')),
        categoria: (item.category || item.subcategory || '').toLowerCase() || 'negocio',
        website: url,
        url_anuncio: url,
        valor_anuncio: valorNum,
        place_id: 'olx_' + (item.listId || item.id || Math.random().toString(36).slice(2)),
        status: 'novo',
        origem: 'olx',
        campanha: auto ? 'olx-auto-diario' : campanha,
        bio: (item.description || '').slice(0, 500) || null,
        notas: [
          valorNum ? 'Valor extraído: R$ ' + valorNum.toLocaleString('pt-BR') : (item.price ? 'Preço bruto: ' + JSON.stringify(item.price) : null),
          item.location ? 'Local: ' + (typeof item.location === 'string' ? item.location : JSON.stringify(item.location)) : null,
        ].filter(Boolean).join(' | '),
        _valor_num: valorNum,
      };
    });

    // Aplica valor_minimo se especificado
    let leadsFiltrados = leads;
    if (valorMinNum) {
      leadsFiltrados = leads.filter((l: any) => (l._valor_num ?? 0) >= valorMinNum);
      filteredValor = leads.length - leadsFiltrados.length;
    }
    // remove campo helper antes de inserir
    leadsFiltrados.forEach((l: any) => { delete l._valor_num; });

    // dedup batch local
    const seen = new Set<string>();
    const uniqueLeads = leadsFiltrados.filter((l: any) => {
      if (seen.has(l.place_id)) return false;
      seen.add(l.place_id);
      return true;
    });

    let totalInserted = 0;
    for (let i = 0; i < uniqueLeads.length; i += 50) {
      const batch = uniqueLeads.slice(i, i + 50);
      const insertResp = await fetch(
        `${SUPABASE_URL}/rest/v1/leads_google?on_conflict=place_id`,
        {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=ignore-duplicates,return=representation'
          },
          body: JSON.stringify(batch)
        }
      );
      if (insertResp.ok) {
        const inserted = await insertResp.json();
        totalInserted += Array.isArray(inserted) ? inserted.length : 0;
      } else {
        const err = await insertResp.text();
        errors.push(`Insert batch error: ${err.slice(0, 200)}`);
      }
    }

    return new Response(
      JSON.stringify({
        analisados: totalRaw,
        filtrados_imoveis: filteredImovel,
        filtrados_valor_minimo: filteredValor,
        passaram_filtros: uniqueLeads.length,
        novos_inseridos: totalInserted,
        errors: errors.length > 0 ? errors : undefined,
        samples: uniqueLeads.slice(0, 3).map((l: any) => ({
          nome: l.nome,
          cidade: l.cidade,
          valor_anuncio: l.valor_anuncio,
          url_anuncio: l.url_anuncio,
        })),
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    );
  }
});
