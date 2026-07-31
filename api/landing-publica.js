const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return json(res, 405, { ok:false });
  const slug = new URL(req.url,'http://x').searchParams.get('s');
  if (!slug) return json(res, 400, { ok:false, erro:'slug obrigatório' });
  const r = await fetch(`${SB_URL}/rest/v1/rpc/va_landing_publica`, {
    method:'POST', headers:{apikey:SB_ANON,Authorization:'Bearer '+SB_ANON,'Content-Type':'application/json'},
    body: JSON.stringify({ p_slug: slug }),
  });
  const d = await r.json();
  if (d?.erro) return json(res, 404, { ok:false, erro: d.erro });
  return json(res, 200, { ok:true, lp: d });
};
