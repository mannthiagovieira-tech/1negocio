// /api/va-upload-criativo · Slice P5.1 · upload de arte própria (PNG/JPG)
// Cria criativo rascunho com origem='upload' + png_path apontando pro
// arquivo enviado. SEM validação de sigilo automática · UI avisa o operador.
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DIMS = {
  feed_1080:       { w: 1080, h: 1080, tol: 0.1 },
  story_1080x1920: { w: 1080, h: 1920, tol: 0.1 },
  link_1200x628:   { w: 1200, h: 628,  tol: 0.1 },
};

function json(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json')
     .setHeader('Access-Control-Allow-Origin', '*')
     .setHeader('Cache-Control', 'no-store');
  res.send(JSON.stringify(body));
}
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const c = []; for await (const x of req) c.push(x);
  const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.ok && (await r.json()) === true;
}
const H_SVC = () => ({ apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE });

// Detecta dimensões PNG (bytes 16-23 · IHDR chunk)
function pngDims(buf) {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null;
  const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
  const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
  return { w, h };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok: false, erro: 'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok: false }); }
  const { projeto_id, arquetipo_id, formato, png_base64, nome } = body || {};
  if (!projeto_id || !formato || !png_base64) return json(res, 400, { ok: false, erro: 'projeto_id + formato + png_base64 obrigatórios' });
  if (!DIMS[formato]) return json(res, 400, { ok: false, erro: 'formato inválido' });

  let buf;
  try { buf = Buffer.from(png_base64, 'base64'); }
  catch { return json(res, 400, { ok: false, erro: 'png_base64 inválido' }); }
  if (buf.length > 5 * 1024 * 1024) return json(res, 413, { ok: false, erro: 'PNG > 5MB' });

  const dims = pngDims(buf);
  const alvo = DIMS[formato];
  let avisoDims = null;
  if (dims) {
    const dw = Math.abs(dims.w - alvo.w) / alvo.w;
    const dh = Math.abs(dims.h - alvo.h) / alvo.h;
    if (dw > alvo.tol || dh > alvo.tol) {
      avisoDims = `dimensões ${dims.w}×${dims.h} fora do alvo ${alvo.w}×${alvo.h} (tol 10%)`;
    }
  } else {
    avisoDims = 'não foi possível ler dimensões do PNG (bytes assinatura ausente)';
  }

  // Cria criativo primeiro (pra ter o id no path)
  const ins = await fetch(`${SB_URL}/rest/v1/va_criativos`, {
    method: 'POST',
    headers: { ...H_SVC(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      projeto_id, arquetipo_id: arquetipo_id || null,
      nome: (nome || `Upload · ${formato}`).slice(0, 100),
      tipo: 'estatico', formato, layout: 'upload',
      headline: '(arte própria)', texto: avisoDims || '', cta: '(não aplicável)',
      status: 'rascunho', origem: 'upload', versao: 1,
    }),
  });
  if (!ins.ok) return json(res, 502, { ok: false, erro: 'insert', detalhe: (await ins.text()).slice(0, 250) });
  const [row] = await ins.json();

  // Upload no bucket
  const path = `${projeto_id}/${row.id}-upload.png`;
  const up = await fetch(`${SB_URL}/storage/v1/object/${encodeURIComponent('criativos-png')}/${path}`, {
    method: 'POST',
    headers: { ...H_SVC(), 'Content-Type': 'image/png', 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) {
    // Rollback do criativo (best-effort)
    await fetch(`${SB_URL}/rest/v1/va_criativos?id=eq.${row.id}`, { method: 'DELETE', headers: H_SVC() });
    return json(res, 502, { ok: false, erro: 'upload storage', detalhe: (await up.text()).slice(0, 200) });
  }
  await fetch(`${SB_URL}/rest/v1/va_criativos?id=eq.${row.id}`, {
    method: 'PATCH', headers: { ...H_SVC(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ png_path: path }),
  });
  const pngUrl = `${SB_URL}/storage/v1/object/public/criativos-png/${path}`;

  return json(res, 200, {
    ok: true, criativo_id: row.id, png_path: path, png_url: pngUrl,
    dims_detectadas: dims, aviso_dims: avisoDims,
    aviso_sigilo: 'ARTE PRÓPRIA · valide sigilo manualmente antes de aprovar (sem cidade, razão social, valor exato, afirmação regulatória).',
  });
};
