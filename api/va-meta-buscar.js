// /api/va-meta-buscar · Slice P5.2 · proxy Meta Targeting/Delivery
// 3 modos:
//   type=adinterest · busca de interesses (q=texto) → sugestões oficiais
//   type=adgeolocation · busca de cidades (q=texto, location_types=city)
//   type=reach_estimate · estimativa de alcance (targeting_spec no body)
// Sem META_ACCESS_TOKEN → 503 com mensagem clara. Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const META_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID || 'act_983335024007752';
const GRAPH = 'https://graph.facebook.com/v23.0';

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json')
     .setHeader('Access-Control-Allow-Origin','*')
     .setHeader('Cache-Control','no-store');
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

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','authorization, x-client-info, apikey, content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!META_TOKEN) return json(res, 503, { ok:false, erro:'META_ACCESS_TOKEN ausente na Vercel · configure a env var pra habilitar busca de interesses/geo/alcance' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { type, q, limit, targeting_spec, optimization_goal } = body || {};
  if (!type) return json(res, 400, { ok:false, erro:'type obrigatório: adinterest | adgeolocation | reach_estimate' });

  try {
    if (type === 'adinterest') {
      if (!q) return json(res, 400, { ok:false, erro:'q obrigatório' });
      const url = `${GRAPH}/search?type=adinterest&q=${encodeURIComponent(q)}&locale=pt_BR&limit=${Math.min(20, Number(limit)||10)}&access_token=${encodeURIComponent(META_TOKEN)}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) return json(res, 502, { ok:false, erro:'meta_erro', detalhe: d?.error?.message || 'sem detalhe' });
      // Retorna [{id, name, audience_size_lower_bound?, path?}]
      return json(res, 200, { ok:true, sugestoes: (d.data || []).map(x => ({
        meta_id: x.id, nome: x.name,
        audience: x.audience_size_lower_bound || x.audience_size || null,
        path: Array.isArray(x.path) ? x.path.join(' > ') : null,
      })) });
    }
    if (type === 'adgeolocation') {
      if (!q) return json(res, 400, { ok:false, erro:'q obrigatório' });
      const url = `${GRAPH}/search?type=adgeolocation&location_types=${encodeURIComponent('["city"]')}&q=${encodeURIComponent(q)}&country_code=BR&limit=${Math.min(20, Number(limit)||10)}&access_token=${encodeURIComponent(META_TOKEN)}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) return json(res, 502, { ok:false, erro:'meta_erro', detalhe: d?.error?.message || 'sem detalhe' });
      return json(res, 200, { ok:true, sugestoes: (d.data || []).map(x => ({
        meta_key: x.key, nome: x.name, tipo: x.type, regiao: x.region, pais: x.country_name,
      })) });
    }
    if (type === 'reach_estimate') {
      if (!targeting_spec) return json(res, 400, { ok:false, erro:'targeting_spec obrigatório' });
      // Meta v23 usa delivery_estimate (reachestimate deprecado)
      const params = new URLSearchParams({
        targeting_spec: JSON.stringify(targeting_spec),
        optimization_goal: optimization_goal || 'REACH',
        access_token: META_TOKEN,
      });
      const url = `${GRAPH}/${META_AD_ACCOUNT_ID}/delivery_estimate?${params.toString()}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) return json(res, 502, { ok:false, erro:'meta_erro', detalhe: d?.error?.message || 'sem detalhe' });
      const est = d.data?.[0] || {};
      return json(res, 200, { ok:true,
        estimate_ready: est.estimate_ready || false,
        users_lower: est.users_lower_bound || est.estimate_mau_lower_bound || null,
        users_upper: est.users_upper_bound || est.estimate_mau_upper_bound || null,
        raw: est,
      });
    }
    return json(res, 400, { ok:false, erro:'type inválido' });
  } catch (e) {
    console.error('[va-meta-buscar]', e?.message);
    return json(res, 502, { ok:false, erro:'meta_rede', detalhe: String(e?.message||e).slice(0,200) });
  }
};
