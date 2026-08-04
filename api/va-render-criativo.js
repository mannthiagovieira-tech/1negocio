// /api/va-render-criativo · Slice P5 · EDGE RUNTIME (obrigatório pro @vercel/og)
// @vercel/og v0.6 usa wasm de resvg que só carrega em Edge · Node runtime quebra
// com FUNCTION_INVOCATION_FAILED na hora do import (antes de entrar no handler).
//
// Renderiza 1 criativo (headline+texto+cta) em PNG no bucket criativos-png.
// 3 formatos · 3 layouts · design system 1Negócio.
// Auth: JWT admin (va_is_admin).

export const config = { runtime: 'edge' };

// @vercel/og carregado LAZY (dynamic import dentro do handler POST). Se
// importado no top-level, o wasm resvg começa a inicializar durante a
// carga do módulo · qualquer OPTIONS de preflight recebe 500
// (FUNCTION_INVOCATION_FAILED) antes do handler rodar. Isso mata o botão
// no browser · o preflight falha, o POST nem sai.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method:'POST',
    headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' },
    body:'{}',
  });
  return r.ok && (await r.json()) === true;
}
const H_SVC = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE });

// ─── Design system 1Negócio ─────────────────────────────────────────────
const T = { ink:'#0A0A0A', ink3:'#4B5563', paper:'#FAFAFA', accent:'#16a34a', logo:'1Negócio' };
function tamanho(f) {
  if (f === 'feed_1080') return { w: 1080, h: 1080 };
  if (f === 'story_1080x1920') return { w: 1080, h: 1920 };
  return { w: 1200, h: 628 };
}

// Fontes fetched em runtime (cache por invocação · Edge reusa entre requests
// dentro do mesmo cold-start)
let _fontesCache = null;
async function carregarFontes() {
  if (_fontesCache) return _fontesCache;
  const buscar = async (url) => {
    try { const r = await fetch(url); if (!r.ok) return null; return await r.arrayBuffer(); }
    catch { return null; }
  };
  const [geist, syne, mono] = await Promise.all([
    buscar('https://cdn.jsdelivr.net/gh/vercel/geist-font@1/fonts/geist-sans/Geist-Regular.otf'),
    buscar('https://cdn.jsdelivr.net/npm/@fontsource/syne@5/files/syne-latin-800-normal.woff'),
    buscar('https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5/files/jetbrains-mono-latin-500-normal.woff'),
  ]);
  const out = [];
  if (geist) out.push({ name: 'Geist',           data: geist, weight: 400, style: 'normal' });
  if (syne)  out.push({ name: 'Syne',            data: syne,  weight: 800, style: 'normal' });
  if (mono)  out.push({ name: 'JetBrains Mono',  data: mono,  weight: 500, style: 'normal' });
  _fontesCache = out;
  return out;
}

function tree(layout, formato, copy) {
  const { w, h } = tamanho(formato);
  const pad = Math.round(w * 0.06);
  const topbar = {
    type: 'div', key: 'top',
    props: {
      style: { display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'JetBrains Mono', fontSize: Math.round(w * 0.018), color: T.ink3, letterSpacing: 2, textTransform: 'uppercase' },
      children: [
        { type: 'div', key: 'bar', props: { style: { width: 24, height: 4, background: T.accent } } },
        { type: 'span', key: 'lg',  props: { children: T.logo } },
        { type: 'span', key: 'sub', props: { style: { opacity: 0.4 }, children: '· venda assessorada de PME' } },
      ],
    },
  };
  const cta = {
    type: 'div', key: 'cta',
    props: {
      style: { display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'Geist', fontSize: Math.round(w * 0.025) },
      children: [
        { type: 'div', key: 'btn', props: { style: { padding: '14px 26px', background: T.accent, color: '#fff', borderRadius: 999, fontWeight: 600 }, children: copy.cta } },
        { type: 'span', key: 'url', props: { style: { color: T.ink3 }, children: '1negocio.com.br' } },
      ],
    },
  };
  let miolo;
  if (layout === 'tipografico_a') {
    miolo = {
      type: 'div', key: 'a',
      props: {
        style: { display: 'flex', flexDirection: 'column', gap: 20, flex: 1, justifyContent: 'center' },
        children: [
          { type: 'div', key: 'hl', props: { style: { fontFamily: 'Syne', fontSize: Math.round(w * 0.078), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }, children: copy.headline } },
          { type: 'div', key: 'tx', props: { style: { fontSize: Math.round(w * 0.028), color: T.ink3, lineHeight: 1.4, maxWidth: w - pad * 2 }, children: copy.texto } },
        ],
      },
    };
  } else if (layout === 'tipografico_b') {
    miolo = {
      type: 'div', key: 'b',
      props: {
        style: { display: 'flex', flexDirection: 'column', gap: 24, flex: 1, justifyContent: 'center' },
        children: [
          { type: 'div', key: 'tx', props: { style: { fontSize: Math.round(w * 0.024), color: T.ink3, lineHeight: 1.4, maxWidth: w - pad * 2, borderLeft: `4px solid ${T.accent}`, paddingLeft: 16 }, children: copy.texto } },
          { type: 'div', key: 'hl', props: { style: { fontFamily: 'Syne', fontSize: Math.round(w * 0.062), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }, children: copy.headline } },
        ],
      },
    };
  } else {
    const m = copy.headline.match(/(R\$\s*[\d.\-–\s]+M?|[\d.]+×|\d+%)/);
    const dado = m?.[0]?.trim() || copy.headline.split(' ').slice(0, 3).join(' ');
    const resto = copy.headline.replace(dado, '').trim();
    const escala = Math.min(w, h * 1.7);
    miolo = {
      type: 'div', key: 'c',
      props: {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1, justifyContent: 'center' },
        children: [
          { type: 'div', key: 'n', props: { style: { fontFamily: 'Syne', fontSize: Math.round(escala * 0.14), fontWeight: 800, lineHeight: 0.95, color: T.accent, letterSpacing: -2, whiteSpace: 'nowrap' }, children: dado } },
          { type: 'div', key: 'l', props: { style: { fontFamily: 'Syne', fontSize: Math.round(escala * 0.036), fontWeight: 800, textAlign: 'center' }, children: resto || copy.headline } },
          { type: 'div', key: 't', props: { style: { fontSize: Math.round(escala * 0.022), color: T.ink3, textAlign: 'center', maxWidth: w * 0.8, marginTop: 8 }, children: copy.texto } },
        ],
      },
    };
  }
  return {
    type: 'div', key: 'root',
    props: {
      style: {
        width: w, height: h,
        display: 'flex', flexDirection: 'column',
        background: T.paper, color: T.ink,
        padding: pad, fontFamily: 'Geist',
        justifyContent: 'space-between',
      },
      children: [topbar, miolo, cta],
    },
  };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const jResp = (code, body) => new Response(JSON.stringify(body), { status: code, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 204, headers: CORS });
  if (req.method !== 'POST') return jResp(405, { ok: false });

  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await ehAdmin(tok))) return jResp(403, { ok: false, erro: 'não autorizado' });
  if (!SB_SERVICE) return jResp(503, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await req.json(); } catch { return jResp(400, { ok: false }); }
  const { criativo_id } = body || {};
  if (!criativo_id) return jResp(400, { ok: false, erro: 'criativo_id obrigatório' });

  const cR = await fetch(`${SB_URL}/rest/v1/va_criativos?id=eq.${criativo_id}&select=*`, { headers: { ...H_SVC(), 'Content-Type':'application/json' } });
  const arr = await cR.json();
  const c = Array.isArray(arr) ? arr[0] : null;
  if (!c) return jResp(404, { ok: false, erro: 'criativo não encontrado' });
  if (c.status === 'aprovado' && c.png_path) {
    return jResp(400, { ok: false, erro: 'aprovado_imutavel · desative pra re-render' });
  }

  try {
    // Dynamic import · wasm resvg inicializa aqui, DEPOIS de auth passar
    const { ImageResponse } = await import('@vercel/og');
    const fonts = await carregarFontes();
    const arv = tree(c.layout || 'tipografico_a', c.formato || 'feed_1080', {
      headline: c.headline || '', texto: c.texto || '', cta: c.cta || 'Saiba mais',
    });
    const { w, h } = tamanho(c.formato || 'feed_1080');
    const img = new ImageResponse(arv, { width: w, height: h, fonts });
    const png = new Uint8Array(await img.arrayBuffer());

    const path = `${c.projeto_id}/${c.id}-v${c.versao || 1}.png`;
    const up = await fetch(`${SB_URL}/storage/v1/object/${encodeURIComponent('criativos-png')}/${path}`, {
      method: 'POST',
      headers: { ...H_SVC(), 'Content-Type': 'image/png', 'x-upsert': 'true' },
      body: png,
    });
    if (!up.ok) {
      const txt = await up.text();
      throw new Error(`upload ${up.status}: ${txt.slice(0, 250)}`);
    }
    const pngUrl = `${SB_URL}/storage/v1/object/public/criativos-png/${path}`;

    await fetch(`${SB_URL}/rest/v1/va_criativos?id=eq.${criativo_id}`, {
      method: 'PATCH',
      headers: { ...H_SVC(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ png_path: path, html_snapshot: JSON.stringify(arv).slice(0, 20000) }),
    });

    return jResp(200, { ok: true, criativo_id, png_path: path, png_url: pngUrl, w, h });
  } catch (e) {
    console.error('[va-render-criativo]', e?.message, e?.stack?.slice(0, 500));
    return jResp(500, { ok: false, erro: 'render_falhou', detalhe: String(e?.message || e).slice(0, 400) });
  }
}
