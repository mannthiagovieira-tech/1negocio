// /api/kip-probe · TEMPORÁRIO · admin-only · deletar depois dos testes.
// Faz POST arbitrário em qualquer path da api.kipflow.io reencaminhando
// o body passado. Nunca ecoa a chave.
const SB_URL = process.env.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || '';

function json(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
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
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'POST only' });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok: false, erro: 'não autorizado' });
  const KEY = process.env.KIPFLOW_API_KEY;
  if (!KEY) return json(res, 503, { ok: false, erro: 'KIPFLOW_API_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  const { path, method = 'POST', payload } = body || {};
  if (!path || !path.startsWith('/')) return json(res, 400, { ok: false, erro: 'path obrigatório (começa com /)' });

  try {
    const r = await fetch('https://api.kipflow.io' + path, {
      method,
      headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: payload != null ? JSON.stringify(payload) : undefined,
    });
    const raw = await r.text();
    let parsed = null; try { parsed = JSON.parse(raw); } catch {}
    return json(res, 200, {
      ok: r.ok,
      status: r.status,
      body_parsed: parsed,
      body_raw: parsed ? undefined : raw.slice(0, 4000),
    });
  } catch (e) {
    return json(res, 502, { ok: false, erro: 'rede', detalhe: String(e.message || e).slice(0, 200) });
  }
};
