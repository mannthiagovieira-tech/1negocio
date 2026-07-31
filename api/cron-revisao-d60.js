const SB_URL = process.env.SUPABASE_URL;
function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  const cronSecret = process.env.CRON_SECRET;
  const tok = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  const hs = req.headers['x-cron-secret'] || '';
  if (!cronSecret || (tok !== cronSecret && hs !== cronSecret)) return json(res, 403, { ok:false });
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok:false });
  const H = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  // Ondas ativas cujo dia 60 é hoje e ainda não têm revisão
  const alvo = new Date(Date.now() - 60*86400000).toISOString().slice(0,10);
  const r = await fetch(`${SB_URL}/rest/v1/va_projeto_ondas?status=eq.ativa&data_inicio=eq.${alvo}&select=id,projeto_id,numero`, { headers: H });
  const ondas = await r.json();
  const geradas = [];
  for (const o of (Array.isArray(ondas)?ondas:[])) {
    const rE = await fetch(`${SB_URL}/rest/v1/va_projeto_revisoes?onda_id=eq.${o.id}&select=id`, { headers: H });
    if (((await rE.json())||[]).length > 0) continue;
    await fetch(`${SB_URL}/rest/v1/rpc/va_gerar_revisao_d60`, { method:'POST', headers: H, body: JSON.stringify({ p_onda_id: o.id }) });
    await fetch(`${SB_URL}/rest/v1/rpc/va_notificar`, { method:'POST', headers: H,
      body: JSON.stringify({ p_projeto_id: o.projeto_id, p_tipo:'imediata', p_subtipo:'revisao_d60',
        p_corpo:'Revisão D+60 da onda '+o.numero+' agendada — 5 eixos aguardando decisão.',
        p_meta: { onda_id: o.id } }) });
    geradas.push(o.id);
  }
  return json(res, 200, { ok:true, alvo, geradas });
};
