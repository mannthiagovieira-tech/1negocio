// /api/parceiro-publico · sem auth (token único)
// GET ?t=<token> · POST { token, dados } (indicação)
const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8'); return raw ? JSON.parse(raw) : {};
}
module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const headers = { apikey: SB_ANON, Authorization: 'Bearer '+SB_ANON, 'Content-Type':'application/json' };

  if (req.method === 'GET') {
    const token = new URL(req.url,'http://x').searchParams.get('t');
    if (!token) return json(res, 400, { ok:false, erro:'token obrigatório' });
    const r = await fetch(`${SB_URL}/rest/v1/rpc/va_parceiro_envio_publico`, { method:'POST', headers, body: JSON.stringify({ p_token: token }) });
    const d = await r.json();
    if (d?.erro) return json(res, 404, { ok:false, erro: d.erro });
    return json(res, 200, { ok:true, envio: d });
  }
  if (req.method === 'POST') {
    let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
    const { token, dados } = body || {};
    if (!token || !dados) return json(res, 400, { ok:false, erro:'token e dados obrigatórios' });
    const r = await fetch(`${SB_URL}/rest/v1/rpc/va_parceiro_indicar`, { method:'POST', headers, body: JSON.stringify({ p_token: token, p_dados: dados }) });
    const d = await r.json();
    if (d?.erro) return json(res, 400, { ok:false, erro: d.erro });
    return json(res, 200, d);
  }
  return json(res, 405, { ok:false });
};
