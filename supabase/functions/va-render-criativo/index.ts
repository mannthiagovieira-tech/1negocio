// va-render-criativo · Slice P5 · Deno edge (imports via esm.sh · sem npm)
// Renderiza 1 criativo (headline+texto+cta+layout) em PNG no bucket criativos-png.
// 3 formatos: feed_1080 (1080x1080) · story_1080x1920 · link_1200x628.
// 3 layouts: tipografico_a (headline dominante) · tipografico_b (dado destaque com
// texto suporte) · dado_destaque (número grande centrado).
// Usa satori (HTML/JSX-like → SVG) + resvg-wasm (SVG → PNG). Fontes fetched em runtime.
// Auth: JWT admin via checagem va_is_admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import satori from "https://esm.sh/satori@0.10.13";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const resp = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Init wasm 1× por instância
let _wasmInit = false;
async function ensureWasm() {
  if (_wasmInit) return;
  const wasm = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm").then(r => r.arrayBuffer());
  await initWasm(wasm);
  _wasmInit = true;
}

// Fontes · Geist (sans) + Syne (headline) via CDN Google Fonts direct .ttf
async function carregarFontes() {
  const [geist, syne, mono] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/gh/vercel/geist-font@1/fonts/geist-sans/Geist-Regular.otf").then(r => r.arrayBuffer()).catch(() => null),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/syne@5/files/syne-latin-800-normal.woff").then(r => r.arrayBuffer()).catch(() => null),
    fetch("https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5/files/jetbrains-mono-latin-500-normal.woff").then(r => r.arrayBuffer()).catch(() => null),
  ]);
  // Fallback: se qualquer fonte falhar, cai pra sans-serif via satori embutido
  const out: any[] = [];
  if (geist) out.push({ name: 'Geist', data: geist, weight: 400, style: 'normal' });
  if (syne)  out.push({ name: 'Syne',  data: syne,  weight: 800, style: 'normal' });
  if (mono)  out.push({ name: 'JetBrains Mono', data: mono, weight: 500, style: 'normal' });
  return out;
}

// Design system 1Negócio · tokens
const T = {
  ink: '#0A0A0A',
  ink3: '#4B5563',
  paper: '#FAFAFA',
  accent: '#16a34a',    // verde 1N
  divisor: '#E5E7EB',
  logo: '1Negócio',
};

function tamanho(formato: string) {
  if (formato === 'feed_1080')       return { w: 1080, h: 1080 };
  if (formato === 'story_1080x1920') return { w: 1080, h: 1920 };
  return { w: 1200, h: 628 };
}

// ─── LAYOUTS · JSX-like (satori aceita objeto React-like) ──────────────
function layoutHtml(layout: string, formato: string, copy: { headline: string; texto: string; cta: string }) {
  const { w, h } = tamanho(formato);
  const pad = Math.round(w * 0.06);
  const base = {
    type: 'div',
    props: {
      style: {
        width: w, height: h,
        display: 'flex', flexDirection: 'column',
        background: T.paper, color: T.ink,
        padding: pad, fontFamily: 'Geist',
        justifyContent: 'space-between',
      },
      children: [] as any[],
    },
  };
  // Topbar (logo + linha)
  const topbar = {
    type: 'div',
    props: {
      style: { display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'JetBrains Mono', fontSize: Math.round(w * 0.018), color: T.ink3, letterSpacing: 2, textTransform: 'uppercase' },
      children: [
        { type: 'div', props: { style: { width: 24, height: 4, background: T.accent } } },
        { type: 'span', props: { children: T.logo } },
        { type: 'span', props: { style: { opacity: 0.4 }, children: '· venda assessorada de PME' } },
      ],
    },
  };
  // CTA bar (footer)
  const cta = {
    type: 'div',
    props: {
      style: { display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'Geist', fontSize: Math.round(w * 0.025) },
      children: [
        { type: 'div', props: { style: { padding: '14px 26px', background: T.accent, color: '#fff', borderRadius: 999, fontWeight: 600 }, children: copy.cta } },
        { type: 'span', props: { style: { color: T.ink3 }, children: '1negocio.com.br' } },
      ],
    },
  };
  // Layout A · headline dominante
  if (layout === 'tipografico_a') {
    base.props.children = [
      topbar,
      { type: 'div', props: {
        style: { display: 'flex', flexDirection: 'column', gap: 20, flex: 1, justifyContent: 'center' },
        children: [
          { type: 'div', props: { style: { fontFamily: 'Syne', fontSize: Math.round(w * 0.078), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }, children: copy.headline } },
          { type: 'div', props: { style: { fontSize: Math.round(w * 0.028), color: T.ink3, lineHeight: 1.4, maxWidth: w - pad * 2 }, children: copy.texto } },
        ],
      }},
      cta,
    ];
  }
  // Layout B · texto suporte + headline lateral
  else if (layout === 'tipografico_b') {
    base.props.children = [
      topbar,
      { type: 'div', props: {
        style: { display: 'flex', flexDirection: 'column', gap: 24, flex: 1, justifyContent: 'flex-end' },
        children: [
          { type: 'div', props: { style: { fontSize: Math.round(w * 0.024), color: T.ink3, lineHeight: 1.4, maxWidth: w - pad * 2, borderLeft: `4px solid ${T.accent}`, paddingLeft: 16 }, children: copy.texto } },
          { type: 'div', props: { style: { fontFamily: 'Syne', fontSize: Math.round(w * 0.062), fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }, children: copy.headline } },
        ],
      }},
      cta,
    ];
  }
  // Layout C · dado destaque (número grande no meio)
  else {
    const parts = copy.headline.match(/(R\$\s*[\d.\-–\s]+M?|[\d.]+×|\d+%)/);
    const dado = parts?.[0] || copy.headline.split(' ').slice(0, 3).join(' ');
    const resto = copy.headline.replace(dado, '').trim();
    base.props.children = [
      topbar,
      { type: 'div', props: {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, flex: 1, justifyContent: 'center' },
        children: [
          { type: 'div', props: { style: { fontFamily: 'Syne', fontSize: Math.round(w * 0.16), fontWeight: 800, lineHeight: 0.95, color: T.accent, letterSpacing: -3 }, children: dado } },
          { type: 'div', props: { style: { fontFamily: 'Syne', fontSize: Math.round(w * 0.038), fontWeight: 800, textAlign: 'center' }, children: resto || copy.headline } },
          { type: 'div', props: { style: { fontSize: Math.round(w * 0.024), color: T.ink3, textAlign: 'center', maxWidth: w * 0.75, marginTop: 12 }, children: copy.texto } },
        ],
      }},
      cta,
    ];
  }
  return base;
}

async function ehAdmin(tok: string) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method:'POST',
    headers:{ apikey: SB_ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.ok && (await r.json()) === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return resp(405, { ok: false, erro: 'method_not_allowed' });

  const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await ehAdmin(tok))) return resp(403, { ok: false, erro: 'nao_autorizado' });

  let body: any;
  try { body = await req.json(); } catch { return resp(400, { ok: false, erro: 'json_invalido' }); }
  const criativo_id = body?.criativo_id;
  if (!criativo_id) return resp(400, { ok: false, erro: 'criativo_id_obrigatorio' });

  const admin = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });
  const { data: c, error } = await admin.from('va_criativos').select('*').eq('id', criativo_id).single();
  if (error || !c) return resp(404, { ok: false, erro: 'criativo_nao_encontrado' });
  if (c.status === 'aprovado' && c.png_path) return resp(400, { ok: false, erro: 'aprovado_imutavel · desative pra re-render' });

  try {
    await ensureWasm();
    const fonts = await carregarFontes();
    const tree = layoutHtml(c.layout || 'tipografico_a', c.formato || 'feed_1080', {
      headline: c.headline || '', texto: c.texto || '', cta: c.cta || 'Saiba mais',
    });
    const { w, h } = tamanho(c.formato || 'feed_1080');
    const svg = await satori(tree as any, { width: w, height: h, fonts: fonts as any });
    const resvg = new Resvg(svg);
    const png = resvg.render().asPng();

    const path = `${c.projeto_id}/${c.id}-v${c.versao || 1}.png`;
    const up = await admin.storage.from('criativos-png').upload(path, png, {
      contentType: 'image/png', upsert: true,
    });
    if (up.error) throw new Error('upload: ' + up.error.message);
    const { data: pub } = admin.storage.from('criativos-png').getPublicUrl(path);

    await admin.from('va_criativos').update({
      png_path: path, html_snapshot: JSON.stringify(tree).slice(0, 20000),
    }).eq('id', criativo_id);

    return resp(200, { ok: true, criativo_id, png_path: path, png_url: pub?.publicUrl || null, w, h });
  } catch (e: any) {
    console.error('[va-render-criativo]', e?.message, e?.stack?.slice(0, 500));
    return resp(500, { ok: false, erro: 'render_falhou', detalhe: String(e?.message || e).slice(0, 400) });
  }
});
