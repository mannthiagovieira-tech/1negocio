import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const { apify_token, perfil_alvo, max_followers = 100 } = await req.json();

    if (!apify_token) {
      return new Response(JSON.stringify({ error: "apify_token required" }), { status: 400, headers });
    }
    if (!perfil_alvo) {
      return new Response(JSON.stringify({ error: "perfil_alvo required" }), { status: 400, headers });
    }

    const clean = perfil_alvo.replace(/[@\s]/g, '').trim().toLowerCase();
    console.log(`[ig-find] Getting followers of @${clean}, limit ${max_followers}`);

    const actors = [
      { id: 'instaprism~instagram-followers-scraper', input: { username: clean, resultsLimit: max_followers } },
      { id: 'logical_scrapers~instagram-followers-scraper', input: { username: clean, resultsLimit: max_followers, extract_contacts: false } },
      { id: 'scraper-engine~instagram-followers-and-following-scrapper', input: { usernames: [clean], maxFollowers: max_followers } },
    ];

    const errors: string[] = [];

    for (const actor of actors) {
      try {
        console.log(`[ig-find] Trying ${actor.id}`);
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 90000); // 90s por actor

        const runRes = await fetch(
          `https://api.apify.com/v2/acts/${actor.id}/run-sync-get-dataset-items?token=${apify_token}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(actor.input),
            signal: ctrl.signal,
          }
        );
        clearTimeout(timeout);

        if (runRes.ok) {
          const data = await runRes.json();
          if (Array.isArray(data) && data.length > 0 && !data[0].error) {
            // Extrai usernames
            const usernames = data
              .map(f => f.username || f.handle || f.userName || f.user?.username)
              .filter(Boolean)
              .filter((v, i, a) => a.indexOf(v) === i);

            console.log(`[ig-find] ${actor.id}: ${usernames.length} usernames`);
            return new Response(JSON.stringify({
              success: true,
              perfil_alvo: clean,
              used_actor: actor.id,
              followers_count: usernames.length,
              usernames: usernames,
              sample: data[0],
            }), { status: 200, headers });
          } else {
            errors.push(`${actor.id}: empty/error response`);
          }
        } else {
          const errText = await runRes.text();
          errors.push(`${actor.id}: ${runRes.status} ${errText.substring(0, 100)}`);
        }
      } catch(e: any) {
        errors.push(`${actor.id}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({
      error: "Nenhum actor conseguiu buscar seguidores. Conta pode ser privada.",
      errors,
      perfil: clean,
    }), { status: 200, headers });

  } catch (e: any) {
    console.error('[ig-find] Exception:', e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
});
