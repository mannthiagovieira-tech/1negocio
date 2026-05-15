import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Normaliza telefone brasileiro
function normalizarTel(tel: string): string {
  if (!tel) return '';
  const digits = tel.replace(/\D/g, '');
  if (digits.length < 10) return '';
  // Se começa com 55, mantém. Se não, adiciona
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return '55' + digits;
  return digits;
}

function ehCelular(tel: string): boolean {
  const d = tel.replace(/\D/g, '');
  if (d.length !== 13) return false; // 55 + DDD(2) + 9XXXXXXXX
  return d[4] === '9';
}

serve(async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  try {
    const { apify_token, queries, max_results = 30, campanha } = await req.json();

    if (!apify_token) {
      return new Response(JSON.stringify({ error: "apify_token required" }), { status: 400, headers });
    }
    if (!queries || !queries.length) {
      return new Response(JSON.stringify({ error: "queries required" }), { status: 400, headers });
    }

    const results: any[] = [];
    const errors: string[] = [];
    const samples: any[] = [];

    for (const q of queries) {
      const fullQuery = q.cidade ? `${q.categoria} ${q.cidade}` : q.categoria;
      console.log(`[fb-pages] Searching: '${fullQuery}'`);

      // Tenta actor scrapium (que funciona atualmente)
      let items: any[] = [];
      let usedActor = '';

      const actors = [
        { id: 'scrapium~facebook-search-scraper', input: { searchQueries: [fullQuery], maxResults: max_results } },
        { id: 'apify~facebook-pages-scraper', input: { searchQueries: [fullQuery], maxPages: max_results } },
      ];

      for (const a of actors) {
        if (items.length > 0) break;
        const runRes = await fetch(
          `https://api.apify.com/v2/acts/${a.id}/run-sync-get-dataset-items?token=${apify_token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(a.input),
          }
        );
        if (runRes.ok) {
          const data = await runRes.json();
          if (Array.isArray(data) && data.length > 0 && !data[0].error) {
            items = data;
            usedActor = a.id;
            console.log(`[fb-pages] ${a.id}: ${items.length} items`);
          } else {
            console.log(`[fb-pages] ${a.id}: empty or error`);
          }
        } else {
          console.log(`[fb-pages] ${a.id} failed: ${runRes.status}`);
        }
      }

      if (items.length > 0 && samples.length < 2) {
        samples.push({ actor: usedActor, query: fullQuery, raw_item: items[0] });
      }

      // Mapeia os items para formato do nosso banco (leads_google)
      for (const item of items) {
        const nome = item.name || item.pageName || item.title;
        const telefone = item.phone || item.phoneNumber || item.contactPhone || item.formatted_phone_number;
        const email = item.email || item.contactEmail;
        const endereco = item.address || item.fullAddress || item.location;
        const website = item.website || item.url;
        const pageUrl = item.pageUrl || item.facebookUrl || item.url;

        // Precisa ter nome E telefone para virar lead
        if (!nome) continue;
        if (!telefone) {
          // Mesmo sem telefone, vale salvar o que achamos (pode enriquecer depois)
          // mas pula da inserção automática
          continue;
        }

        const tel = normalizarTel(telefone);
        if (!tel || tel.length < 12) continue;
        if (!ehCelular(tel)) continue; // só celular BR

        results.push({
          nome: nome,
          telefone: telefone,
          telefone_formatado: tel,
          endereco: endereco || null,
          cidade: q.cidade || null,
          categoria: q.categoria || null,
          status: 'novo',
          campanha: campanha || `fb-${q.categoria}`,
          place_id: `fb:${item.pageId || item.id || pageUrl}`,
          origem: 'facebook',
        });
      }
    }

    console.log(`[fb-pages] Total valid: ${results.length}`);

    let inserted = 0;
    if (results.length > 0) {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/leads_google`, {
        method: "POST",
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify(results),
      });
      if (insertRes.ok) {
        const data = await insertRes.json();
        inserted = Array.isArray(data) ? data.length : 0;
      } else {
        const err = await insertRes.text();
        errors.push(`DB: ${err.substring(0, 200)}`);
      }
    }

    return new Response(JSON.stringify({
      total_scraped: results.length,
      total_inserted: inserted,
      errors: errors.length ? errors : undefined,
      samples,
    }), { status: 200, headers });

  } catch (e) {
    console.error('[fb-pages] Exception:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
});
