// /api/va-orfa-converter · Slice P5 · C · fallback manual do desemboque
// Operador escolhe uma campanha e converte 1 mensagem órfã em lead antessala.
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
const H = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { mensagem_id, campanha_id } = body || {};
  if (!mensagem_id || !campanha_id) return json(res, 400, { ok:false, erro:'mensagem_id + campanha_id obrigatórios' });

  // Carrega mensagem órfã + campanha
  const [mR, cR] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/va_mensagens_recebidas?id=eq.${mensagem_id}&lead_id=is.null&select=*`, { headers: H() }),
    fetch(`${SB_URL}/rest/v1/va_campanhas?id=eq.${campanha_id}&select=id,projeto_id,arquetipo_id,criativo_id`, { headers: H() }),
  ]);
  const [msg] = await mR.json();
  const [cmp] = await cR.json();
  if (!msg) return json(res, 404, { ok:false, erro:'mensagem órfã não encontrada' });
  if (!cmp) return json(res, 404, { ok:false, erro:'campanha não encontrada' });

  const ins = await fetch(`${SB_URL}/rest/v1/va_leads`, {
    method:'POST', headers: H(),
    body: JSON.stringify({
      projeto_id: cmp.projeto_id,
      arquetipo_id: cmp.arquetipo_id,
      campanha_id: cmp.id, criativo_id: cmp.criativo_id,
      origem: 'campanha', fonte: 'meta_ctwa_manual',
      razao_social: `Lead inbound · ${String(msg.telefone||'').slice(-4)}`,
      whatsapp: msg.telefone, telefone: msg.telefone,
      whatsapp_verificado: true, verificado_em: new Date().toISOString(),
      contato_fonte: 'manual', status: 'antessala',
      ad_ref: { convertido_manual: true, mensagem_id: msg.id },
    }),
  });
  if (!ins.ok) return json(res, 502, { ok:false, erro:'insert lead', detalhe: (await ins.text()).slice(0,200) });
  const [lead] = await ins.json();

  // Vincula a mensagem ao lead recém-criado
  await fetch(`${SB_URL}/rest/v1/va_mensagens_recebidas?id=eq.${mensagem_id}`, {
    method:'PATCH', headers: H(),
    body: JSON.stringify({ projeto_id: cmp.projeto_id, lead_id: lead.id, processada: true }),
  });

  return json(res, 200, { ok:true, lead_id: lead.id, campanha_id: cmp.id });
};
