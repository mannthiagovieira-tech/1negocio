import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async (req) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers });
  }

  try {
    const url = new URL(req.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "url parameter required" }), { status: 400, headers });
    }

    // Valida que é uma URL do Google Maps
    if (!targetUrl.startsWith("https://maps.googleapis.com/")) {
      return new Response(JSON.stringify({ error: "Only Google Maps API URLs allowed" }), { status: 403, headers });
    }

    console.log(`[google-places-proxy] Fetching: ${targetUrl.substring(0, 80)}...`);

    const res = await fetch(targetUrl);
    const data = await res.json();

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (e) {
    console.error(`[google-places-proxy] Error:`, e.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
  }
});
