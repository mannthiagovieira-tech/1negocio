// meta-search-geo · v1
// Resolve termo de cidade BR → top-5 candidatos com key+name+region pro autocomplete

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return resp(405, { ok: false, erro: "method_not_allowed" });
  if (!META_TOKEN) return resp(500, { ok: false, erro: "META_ACCESS_TOKEN_nao_configurado" });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: "json_invalido" }); }

  const q = (body?.q || "").toString().trim();
  const limit = Math.min(10, Math.max(1, parseInt(body?.limit || 5, 10)));
  const country = (body?.country_code || "BR").toString();
  if (!q || q.length < 2) return resp(400, { ok: false, erro: "q_min_2_chars" });

  try {
    const url = `${GRAPH}/search?type=adgeolocation&location_types=${encodeURIComponent('["city"]')}&q=${encodeURIComponent(q)}&country_code=${encodeURIComponent(country)}&limit=${limit}&access_token=${encodeURIComponent(META_TOKEN)}`;
    const r = await fetch(url);
    const txt = await r.text();
    if (!r.ok) throw new Error(`Meta geo ${r.status}: ${txt.slice(0, 300)}`);
    const data = JSON.parse(txt);
    const results = (data?.data || []).map((c: any) => ({
      key: c.key,
      name: c.name,
      region: c.region || null,
      type: c.type || "city",
      country_code: c.country_code || country,
    }));
    return resp(200, { ok: true, q, results });
  } catch (e: any) {
    return resp(500, { ok: false, erro: e?.message || String(e) });
  }
});
