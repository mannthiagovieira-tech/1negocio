// /api/va-verificar-whatsapp · Vercel Function · Slice 4.5
// Re-verifica um lead individual · usa Z-API get-iswhatsapp-batch com todos
// os telefones conhecidos (whatsapp + telefone + cadastrais). Retorna e persiste
// whatsapp_verificado. Se check achar WhatsApp num fixo, promove pra campo
// whatsapp. Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MOCK_ZAPI = process.env.VA_CADENCIA_MOCK === 'true';

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

async function pegarCred() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/zapi_telefones?ativo=eq.true&limit=1&select=zapi_instance,zapi_token,zapi_client_token`, { headers: H_SVC() });
    const [row] = await r.json();
    if (row?.zapi_instance && row?.zapi_token && row?.zapi_client_token) {
      return { instance: row.zapi_instance, token: row.zapi_token, clientToken: row.zapi_client_token };
    }
  } catch {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/va_zapi_telefones?tipo=eq.prospeccao&ativo=eq.true&limit=1&select=instancia,token,client_token`, { headers: H_SVC() });
    const [row] = await r.json();
    if (row?.instancia && row?.token && row?.client_token) {
      return { instance: row.instancia, token: row.token, clientToken: row.client_token };
    }
  } catch {}
  return null;
}

async function checarWhatsAppLote(cred, phones) {
  const uniq = [...new Set((phones || []).map(p => String(p).replace(/\D/g,'')).filter(x => x && x.length >= 10))];
  if (!uniq.length) return { ok:true, resultados: {} };
  if (MOCK_ZAPI) {
    const r = {};
    for (const p of uniq) r[p] = { exists: p.endsWith('9'), lid: null, outputPhone: p };
    return { ok:true, resultados: r, mock: true };
  }
  if (!cred) return { ok:false, erro:'sem_cred_zapi', resultados: {} };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);
  try {
    const url = `https://api.z-api.io/instances/${cred.instance}/token/${cred.token}/contacts/get-iswhatsapp-batch`;
    const r = await fetch(url, {
      method:'POST', signal: controller.signal,
      headers:{ 'Content-Type':'application/json', 'client-token': cred.clientToken },
      body: JSON.stringify({ phones: uniq }),
    });
    clearTimeout(t);
    const raw = await r.text();
    if (!r.ok) return { ok:false, erro:`zapi_http_${r.status}: ${raw.slice(0,200)}`, resultados: {} };
    let arr = []; try { arr = JSON.parse(raw); } catch {}
    const out = {};
    for (const item of Array.isArray(arr) ? arr : []) {
      const key = String(item.inputPhone || '').replace(/\D/g,'');
      if (key) out[key] = { exists: !!item.exists, lid: item.lid || null, outputPhone: item.outputPhone || null };
    }
    return { ok:true, resultados: out };
  } catch (e) {
    clearTimeout(t);
    return { ok:false, erro:'zapi_rede: ' + String(e?.message||e).slice(0,150), resultados: {} };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { lead_id } = body || {};
  if (!lead_id) return json(res, 400, { ok:false, erro:'lead_id obrigatório' });

  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}&select=id,projeto_id,whatsapp,telefone,dados_enriquecimento,funil_etapa,status`, { headers: H_SVC() });
  const [lead] = await lR.json();
  if (!lead) return json(res, 404, { ok:false, erro:'lead não encontrado' });

  // Junta todos os telefones conhecidos: campo + cadastrais em dados_enriquecimento
  const cad = lead.dados_enriquecimento?.cadastral || {};
  const phones = [lead.whatsapp, lead.telefone, cad.telefone_cadastral, cad.telefone_cadastral_2]
    .filter(Boolean).map(x => String(x).replace(/\D/g,'')).filter(x => x.length >= 10);
  if (!phones.length) return json(res, 422, { ok:false, erro:'sem_telefone_pra_verificar' });

  const cred = await pegarCred();
  const chk = await checarWhatsAppLote(cred, phones);
  if (!chk.ok) return json(res, 502, { ok:false, erro: chk.erro });

  // Preferência: celular verificado > fixo verificado
  const ordenados = [...new Set(phones)].sort((a,b) => {
    const aCel = (a.length === 11 && a[2] === '9') || (a.length === 13 && a[4] === '9') ? 0 : 1;
    const bCel = (b.length === 11 && b[2] === '9') || (b.length === 13 && b[4] === '9') ? 0 : 1;
    return aCel - bCel;
  });
  let verificado = null;
  let numeroVerificado = null;
  for (const p of ordenados) {
    if (chk.resultados[p]?.exists) { verificado = true; numeroVerificado = chk.resultados[p].outputPhone || p; break; }
  }
  if (verificado === null && Object.keys(chk.resultados).length) verificado = false;

  const patch = {
    whatsapp_verificado: verificado,
    verificado_em: new Date().toISOString(),
  };
  if (verificado === true && numeroVerificado && !lead.whatsapp) patch.whatsapp = numeroVerificado;
  // Se check confirmou FALSE e lead estava na_fila sem WhatsApp confirmado → sem_contato
  if (verificado === false && lead.status === 'aprovado' && lead.funil_etapa === 'na_fila' && !lead.whatsapp) {
    patch.funil_etapa = 'sem_contato';
  }
  await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}`, {
    method:'PATCH', headers: H_SVC(), body: JSON.stringify(patch),
  });

  return json(res, 200, {
    ok: true,
    lead_id,
    whatsapp_verificado: verificado,
    numero_verificado: numeroVerificado,
    resultados: chk.resultados,
    mock: chk.mock || false,
  });
};
