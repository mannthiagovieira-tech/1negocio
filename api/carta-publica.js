// /api/carta-publica · Vercel Function · endpoint público (sem auth)
// GET /api/carta-publica?t=<token> → dados da carta pra renderizar página
// POST /api/carta-publica → { token, dados } → registra assinatura
//
// Sem gate de autenticação — validação é pelo token único (uuid encoded).

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const headers = { apikey: SB_ANON, Authorization: 'Bearer '+SB_ANON, 'Content-Type':'application/json' };

  if (req.method === 'GET') {
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('t');
    if (!token) return json(res, 400, { ok:false, erro:'token obrigatório' });
    const r = await fetch(`${SB_URL}/rest/v1/rpc/va_carta_publica`, {
      method:'POST', headers, body: JSON.stringify({ p_token: token }),
    });
    const d = await r.json();
    if (d?.erro) return json(res, 404, { ok:false, erro: d.erro });
    return json(res, 200, { ok:true, carta: d });
  }

  if (req.method === 'POST') {
    let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
    const { token, dados } = body || {};
    if (!token || !dados) return json(res, 400, { ok:false, erro:'token e dados obrigatórios' });
    // Validação mínima
    if (!dados.ofertante_nome || !dados.valor_ofertado) return json(res, 400, { ok:false, erro:'ofertante_nome e valor_ofertado obrigatórios' });
    const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket?.remoteAddress || '';
    const r = await fetch(`${SB_URL}/rest/v1/rpc/va_registrar_assinatura_carta`, {
      method:'POST', headers, body: JSON.stringify({ p_token: token, p_dados: dados, p_ip: ip }),
    });
    const d = await r.json();
    if (d?.erro) return json(res, 400, { ok:false, erro: d.erro });
    return json(res, 200, d);
  }

  return json(res, 405, { ok:false, erro:'method not allowed' });
};
