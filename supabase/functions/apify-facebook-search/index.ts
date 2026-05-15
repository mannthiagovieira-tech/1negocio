// apify-facebook-search · v9.22.1
// Roda buscas no Facebook (posts públicos · grupos) via actors Apify ·
// salva posts encontrados em oportunidades_fb (UNIQUE post_url · dedup automático).
//
// HISTÓRICO: v31 anterior teve bundle corrompido no Edge Functions storage.
// Recriada do zero a partir do template apify-facebook-pages (v9.22) ·
// trocando actor (posts-search em vez de pages-scraper) e destino
// (oportunidades_fb em vez de leads_google).
//
// Input (compat com plFbSearchRun do painel-v3):
// {
//   apify_token: string,             // do localStorage 1n_apify
//   queries: [{ query, frase, cidade }],
//   group_urls?: string[],           // posts dentro de grupos específicos
//   max_posts?: number               // default 30 por query
// }
//
// Output:
// { total_scraped, total_inserted, errors?, samples? }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function pickStr(...vals: any[]): string | null {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}
function pickInt(...vals: any[]): number {
  for (const v of vals) {
    const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
    if (!isNaN(n) && n >= 0) return n;
  }
  return 0;
}
function pickDate(...vals: any[]): string | null {
  for (const v of vals) {
    if (!v) continue;
    const d = new Date(typeof v === 'number' ? v * 1000 : v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
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
    const { apify_token, queries, group_urls = [], max_posts = 30, campanha } = await req.json();

    if (!apify_token) {
      return new Response(JSON.stringify({ error: "apify_token required" }), { status: 400, headers });
    }
    if (!queries || !queries.length) {
      return new Response(JSON.stringify({ error: "queries required" }), { status: 400, headers });
    }

    const results: any[] = [];
    const errors: string[] = [];
    const samples: any[] = [];

    // ───── Loop nas queries (posts públicos via search) ─────
    for (const q of queries) {
      const fullQuery = q.query || (q.cidade ? `${q.frase} ${q.cidade}` : q.frase);
      console.log(`[fb-search] Searching posts: '${fullQuery}'`);

      let items: any[] = [];
      let usedActor = '';

      // Chain de actors · primeiro o que dá certo ganha
      const actors = [
        { id: 'apify~facebook-posts-search-scraper', input: { searchQueries: [fullQuery], maxItems: max_posts, resultsLimit: max_posts } },
        { id: 'scrapium~facebook-search-scraper',    input: { searchQueries: [fullQuery], maxResults: max_posts, searchType: 'posts' } },
        { id: 'apify~facebook-search-scraper',       input: { searchQueries: [fullQuery], maxResults: max_posts } },
      ];

      for (const a of actors) {
        if (items.length > 0) break;
        try {
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
              console.log(`[fb-search] ${a.id}: ${items.length} items`);
            } else {
              console.log(`[fb-search] ${a.id}: empty or error`);
            }
          } else {
            console.log(`[fb-search] ${a.id} failed: ${runRes.status}`);
          }
        } catch (e: any) {
          console.log(`[fb-search] ${a.id} exception: ${e.message}`);
        }
      }

      if (items.length > 0 && samples.length < 2) {
        samples.push({ actor: usedActor, query: fullQuery, raw_item: items[0] });
      }

      // ───── Mapeia post → oportunidades_fb ─────
      for (const item of items) {
        const post_url = pickStr(item.url, item.postUrl, item.facebookUrl, item.link);
        if (!post_url) continue;

        results.push({
          post_url,
          post_id: pickStr(item.postId, item.id, item.legacy_id),
          post_texto: pickStr(item.text, item.title, item.message, item.description),
          post_data: pickDate(item.time, item.publishedAt, item.postedTime, item.date, item.timestamp),
          autor_nome: pickStr(item.user?.name, item.author?.name, item.pageName, item.authorName, item.owner?.name),
          autor_url: pickStr(item.user?.url, item.author?.url, item.pageUrl, item.ownerUrl),
          autor_id:  pickStr(item.user?.id, item.author?.id, item.pageId, item.ownerId),
          origem: 'search',
          origem_ref: fullQuery,
          frase_matched: q.frase || null,
          cidade: q.cidade || null,
          likes:    pickInt(item.likes, item.likesCount, item.reactionsCount, item.reactions),
          comments: pickInt(item.comments, item.commentsCount),
          shares:   pickInt(item.shares, item.sharesCount),
          status: 'novo',
          campanha: campanha || `fb-search-${(q.frase || 'manual').slice(0, 30)}`,
        });
      }
    }

    // ───── Loop nos grupos (se fornecidos) ─────
    for (const groupUrl of (group_urls as string[])) {
      if (!groupUrl || !groupUrl.startsWith('http')) continue;
      console.log(`[fb-search] Scraping group: ${groupUrl}`);

      let items: any[] = [];
      let usedActor = '';

      const actors = [
        { id: 'apify~facebook-groups-scraper', input: { startUrls: [{ url: groupUrl }], maxItems: max_posts } },
        { id: 'apify~facebook-pages-scraper',  input: { startUrls: [{ url: groupUrl }], maxPosts: max_posts } },
      ];

      for (const a of actors) {
        if (items.length > 0) break;
        try {
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
              console.log(`[fb-search] group ${a.id}: ${items.length} items`);
            }
          }
        } catch (e: any) {
          console.log(`[fb-search] group ${a.id} exception: ${e.message}`);
        }
      }

      if (items.length > 0 && samples.length < 2) {
        samples.push({ actor: usedActor, group_url: groupUrl, raw_item: items[0] });
      }

      for (const item of items) {
        const post_url = pickStr(item.url, item.postUrl, item.facebookUrl, item.link);
        if (!post_url) continue;

        results.push({
          post_url,
          post_id: pickStr(item.postId, item.id),
          post_texto: pickStr(item.text, item.title, item.message),
          post_data: pickDate(item.time, item.publishedAt, item.postedTime),
          autor_nome: pickStr(item.user?.name, item.author?.name, item.authorName),
          autor_url: pickStr(item.user?.url, item.author?.url),
          autor_id:  pickStr(item.user?.id, item.author?.id),
          origem: 'grupo',
          origem_ref: groupUrl,
          frase_matched: null,
          cidade: null,
          likes:    pickInt(item.likes, item.likesCount, item.reactions),
          comments: pickInt(item.comments, item.commentsCount),
          shares:   pickInt(item.shares, item.sharesCount),
          status: 'novo',
          campanha: campanha || 'fb-search-grupo',
        });
      }
    }

    console.log(`[fb-search] Total mapped: ${results.length}`);

    // ───── INSERT em oportunidades_fb (UNIQUE post_url · dedup automático) ─────
    let inserted = 0;
    if (results.length > 0) {
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/oportunidades_fb`, {
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

  } catch (e: any) {
    console.error('[fb-search] Exception:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
});
