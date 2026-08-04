// /api/va-lancar-gasto-midia · P5.3 · débito midia_meta com auto-pause
// Ao debitar midia_meta com o gate, se saldo pós-débito ≤ 0 → PAUSA a campanha
// no Meta via Marketing API (status='PAUSED' no adset) + PATCH status='pausada'.
// Proteção ATIVA · não só aviso. Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN || '';
const GRAPH = 'https://graph.facebook.com/v23.0';

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json')
     .setHeader('Access-Control-Allow-Origin','*').setHeader('Cache-Control','no-store');
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
    method:'POST', headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' }, body:'{}',
  });
  return r.ok && (await r.json()) === true;
}
const H_SVC = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' });

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','authorization, x-client-info, apikey, content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { campanha_id, gasto_real, excedente_autorizado } = body || {};
  if (!campanha_id || !Number(gasto_real)) return json(res, 400, { ok:false, erro:'campanha_id + gasto_real obrigatórios' });

  const cR = await fetch(`${SB_URL}/rest/v1/va_campanhas?id=eq.${campanha_id}&select=id,projeto_id,nome,gasto_acumulado,meta_adset_id,status`, { headers: H_SVC() });
  const [cmp] = await cR.json();
  if (!cmp) return json(res, 404, { ok:false, erro:'campanha não encontrada' });

  // 1 · debita via wrapper seguro (checa saldo)
  const gasto = Number(gasto_real);
  const dR = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
    method:'POST', headers: H_SVC(),
    body: JSON.stringify({
      p_projeto: cmp.projeto_id, p_tipo: 'midia_meta', p_qtd: gasto,
      p_referencia: `midia:${campanha_id.slice(0,8)} · ${cmp.nome.slice(0,40)}`,
      p_ciclo: null, p_excedente_autorizado: !!excedente_autorizado,
    }),
  });
  if (!dR.ok) {
    const t = await dR.text();
    if (/CREDITO_CICLO_ESGOTADO/.test(t)) {
      return json(res, 402, { ok:false, erro:'credito_ciclo_esgotado', detalhe: t.slice(0,300) });
    }
    return json(res, 502, { ok:false, erro:'debitar', detalhe: t.slice(0,200) });
  }
  const dRes = await dR.json();
  const saldoPos = dRes?.saldo_pos;
  const saldoNum = Number(saldoPos?.saldo || 0);

  // 2 · atualiza gasto_acumulado na campanha
  await fetch(`${SB_URL}/rest/v1/va_campanhas?id=eq.${campanha_id}`, {
    method:'PATCH', headers: H_SVC(),
    body: JSON.stringify({ gasto_acumulado: Number(cmp.gasto_acumulado || 0) + gasto }),
  });

  // 3 · AUTO-PAUSE se saldo ≤ 0 e campanha está publicada/ativa
  let pausada_meta = false;
  let pausada_local = false;
  if (saldoNum <= 0 && cmp.meta_adset_id && META_TOKEN && ['publicada','ativa'].includes(cmp.status)) {
    try {
      const fd = new URLSearchParams();
      fd.append('status', 'PAUSED');
      fd.append('access_token', META_TOKEN);
      const r = await fetch(`${GRAPH}/${cmp.meta_adset_id}`, { method:'POST', body: fd });
      pausada_meta = r.ok;
    } catch {}
    await fetch(`${SB_URL}/rest/v1/va_campanhas?id=eq.${campanha_id}`, {
      method:'PATCH', headers: H_SVC(),
      body: JSON.stringify({ status: 'pausada' }),
    });
    pausada_local = true;
  }

  return json(res, 200, {
    ok:true, campanha_id, gasto_real: gasto, saldo_pos: saldoPos,
    debito: { razao_id: dRes.razao_id, excedente_autorizado: dRes.excedente_autorizado },
    auto_pause: { acionado: saldoNum <= 0, pausada_meta, pausada_local },
  });
};
