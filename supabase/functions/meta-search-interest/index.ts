// meta-search-interest · v1
// Resolve termo de interesse (string PT-BR) para ID interno do Meta Ads
// Aceita single (q) ou bulk (qs[]). Browser nunca toca no META_ACCESS_TOKEN.

const META_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";
const GRAPH = "https://graph.facebook.com/v23.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function resp(s: number, b: unknown) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

async function searchOne(q: string): Promise<any> {
  const url = `${GRAPH}/search?type=adinterest&q=${encodeURIComponent(q)}&locale=pt_BR&limit=1&access_token=${encodeURIComponent(META_TOKEN)}`;
  const r = await fetch(url);
  const txt = await r.text();
  if (!r.ok) throw new Error(`Meta search ${r.status}: ${txt.slice(0, 300)}`);
  const data = JSON.parse(txt);
  const hit = data?.data?.[0];
  if (!hit?.id) return null;
  return {
    id: hit.id,
    name: hit.name,
    audience_size_lower_bound: hit.audience_size_lower_bound || 0,
    audience_size_upper_bound: hit.audience_size_upper_bound || 0,
    path: hit.path || [],
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "method_not_allowed" });
  if (!META_TOKEN) return resp(500, { ok: false, erro: "META_ACCESS_TOKEN_nao_configurado" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  // Modo bulk: { qs: ["...", "..."] }
  if (Array.isArray(body?.qs)) {
    const qs = body.qs.filter((q: any) => typeof q === "string" && q.trim());
    if (qs.length > 25) return resp(400, { ok: false, erro: "max_25_queries" });
    const results = await Promise.all(qs.map(async (q: string) => {
      try {
        const hit = await searchOne(q);
        return hit ? { q, ok: true, ...hit } : { q, ok: false, erro: "sem_match" };
      } catch (e: any) {
        return { q, ok: false, erro: e?.message || String(e) };
      }
    }));
    return resp(200, { ok: true, results });
  }

  // Modo single: { q: "..." }
  const q = (body?.q || "").toString().trim();
  if (!q) return resp(400, { ok: false, erro: "q_obrigatorio" });
  try {
    const hit = await searchOne(q);
    if (!hit) return resp(200, { ok: false, erro: "sem_match", q });
    return resp(200, { ok: true, q, ...hit });
  } catch (e: any) {
    return resp(500, { ok: false, erro: e?.message || String(e) });
  }
});
