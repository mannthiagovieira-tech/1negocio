// /api/va-lead-contato · Vercel Function
// P4.3 · edita contato (telefone/whatsapp) de 1 lead manualmente OU escolhendo
// candidato Apify. Grava contato_fonte apropriado.
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const c = []; for await (const x of req) c.push(x);
  const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method:'POST', headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' }, body:'{}',
  });
  return r.ok && (await r.json()) === true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { lead_id, telefone, whatsapp, fonte } = body || {};
  if (!lead_id) return json(res, 400, { ok:false, erro:'lead_id obrigatório' });
  const fonteFinal = fonte && ['kipflow','gmaps','manual'].includes(fonte) ? fonte : 'manual';

  const norm = (t) => t ? String(t).replace(/\D/g,'') : null;
  const patch = { contato_fonte: fonteFinal };
  const tel = norm(telefone);
  const wa  = norm(whatsapp);
  if (tel !== undefined) patch.telefone = tel;
  if (wa !== undefined) patch.whatsapp = wa;

  const H = { apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' };
  const r = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}`, {
    method:'PATCH', headers: H, body: JSON.stringify(patch),
  });
  if (!r.ok) return json(res, 500, { ok:false, erro:'update falhou', detalhe: (await r.text()).slice(0,200) });
  const [row] = await r.json();
  return json(res, 200, { ok:true, lead: { id: row.id, telefone: row.telefone, whatsapp: row.whatsapp, contato_fonte: row.contato_fonte } });
};
