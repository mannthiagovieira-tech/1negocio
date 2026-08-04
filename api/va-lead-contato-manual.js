// /api/va-lead-contato-manual · Slice 4.6
// Registra que o operador iniciou contato manual pelo botão wa.me OU tel:
// no card do funil/antessala. Grava em va_leads_log e move lead na_fila →
// contatado (opcional · body flag mover_para_contatado). Auth: JWT admin.

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
const H_SVC = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { lead_id, acao, detalhe, mover_para_contatado } = body || {};
  if (!lead_id) return json(res, 400, { ok:false, erro:'lead_id obrigatório' });
  const acaoOk = ['contato_manual_iniciado','contato_manual_desfeito','tentativa_ligacao'];
  const acaoFinal = acaoOk.includes(acao) ? acao : 'contato_manual_iniciado';

  // 1 · lê lead pra saber etapa atual (pra permitir desfazer)
  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}&select=id,projeto_id,funil_etapa,toque1_em`, { headers: H_SVC() });
  const [lead] = await lR.json();
  if (!lead) return json(res, 404, { ok:false, erro:'lead não encontrado' });

  // 2 · log (sempre)
  await fetch(`${SB_URL}/rest/v1/va_leads_log`, {
    method:'POST', headers: H_SVC(),
    body: JSON.stringify({ lead_id, acao: acaoFinal, detalhe: (detalhe || '').slice(0, 500) }),
  });

  // 3 · move etapa se solicitado
  let etapaAntes = lead.funil_etapa;
  let etapaDepois = lead.funil_etapa;
  if (mover_para_contatado && lead.funil_etapa === 'na_fila') {
    const patch = { funil_etapa: 'contatado', toque1_em: lead.toque1_em || new Date().toISOString() };
    await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}`, {
      method:'PATCH', headers: H_SVC(), body: JSON.stringify(patch),
    });
    etapaDepois = 'contatado';
  }
  if (acaoFinal === 'contato_manual_desfeito' && lead.funil_etapa === 'contatado') {
    // undo: volta pra na_fila, limpa toque1_em (só se veio do próprio manual · sem cadência)
    await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}`, {
      method:'PATCH', headers: H_SVC(),
      body: JSON.stringify({ funil_etapa: 'na_fila', toque1_em: null }),
    });
    etapaDepois = 'na_fila';
  }

  return json(res, 200, { ok:true, lead_id, acao: acaoFinal, etapa_antes: etapaAntes, etapa_depois: etapaDepois });
};
