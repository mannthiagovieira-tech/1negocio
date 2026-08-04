// /api/va-enviar-resposta · Vercel Function
// P4.1 · envia RESPOSTA aprovada (Z-API), grava va_disparos tipo_envio='resposta',
// debita disparo_whatsapp e move lead pra em_conversa. Sem jitter (imediato).
// Auth: JWT admin.

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
  return null;
}

async function enviarZapi(cred, phone, message) {
  if (MOCK_ZAPI) return { ok:true, messageId:'MOCK-'+Math.random().toString(36).slice(2,10) };
  const r = await fetch(`https://api.z-api.io/instances/${cred.instance}/token/${cred.token}/send-text`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'client-token': cred.clientToken },
    body: JSON.stringify({ phone, message }),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch {}
  if (!r.ok) return { ok:false, erro:`zapi_http_${r.status}: ${raw.slice(0,200)}` };
  return { ok:true, messageId: d?.messageId || d?.id || null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { lead_id, corpo } = body || {};
  if (!lead_id || !corpo || String(corpo).trim().length < 3) return json(res, 400, { ok:false, erro:'lead_id + corpo obrigatórios' });

  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}&select=*`, { headers: H_SVC() });
  const [lead] = await lR.json();
  if (!lead) return json(res, 404, { ok:false, erro:'lead não encontrado' });
  const fone = String(lead.whatsapp || lead.telefone || '').replace(/\D/g,'');
  if (!fone) return json(res, 422, { ok:false, erro:'lead sem whatsapp/telefone' });

  const cred = await pegarCred();
  if (!cred && !MOCK_ZAPI) return json(res, 503, { ok:false, erro:'Z-API credenciais indisponíveis' });

  // Insere disparo (agendado → enviado)
  const ins = await fetch(`${SB_URL}/rest/v1/va_disparos`, {
    method:'POST', headers: H_SVC(),
    body: JSON.stringify({
      projeto_id: lead.projeto_id, lead_id: lead.id, arquetipo_id: lead.arquetipo_id,
      toque: 1, // convenção: resposta sempre toque=1 (não conta como cadência)
      tipo_envio: 'resposta',
      corpo_snapshot: corpo, status:'agendado',
      agendado_para: new Date().toISOString(), tentativas: 1,
    }),
  });
  const [disp] = await ins.json();

  const env = await enviarZapi(cred, fone, corpo);
  if (!env.ok) {
    await fetch(`${SB_URL}/rest/v1/va_disparos?id=eq.${disp.id}`, {
      method:'PATCH', headers: H_SVC(), body: JSON.stringify({ status:'erro', erro: env.erro }),
    });
    return json(res, 502, { ok:false, erro: env.erro, disparo_id: disp.id });
  }

  // Debita
  let razaoId = null;
  try {
    const dR = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
      method:'POST', headers: H_SVC(),
      body: JSON.stringify({
        p_projeto: lead.projeto_id, p_tipo:'disparo_whatsapp', p_qtd: 1,
        p_referencia: `resposta:${disp.id.slice(0,8)} · lead:${lead.id.slice(0,8)}`,
        p_ciclo: null, p_excedente_autorizado: false,
      }),
    });
    if (dR.ok) razaoId = await dR.json();
  } catch {}

  // v3 · débito ia_resposta_personalizada (só no envio bem-sucedido · regenerar rascunho é grátis)
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
      method:'POST', headers: H_SVC(),
      body: JSON.stringify({
        p_projeto: lead.projeto_id, p_tipo:'ia_resposta_personalizada', p_qtd: 1,
        p_referencia: `ia_resp:${disp.id.slice(0,8)} · lead:${lead.id.slice(0,8)}`, p_ciclo: null, p_excedente_autorizado: false,
      }),
    });
  } catch (e) { console.error('debit ia_resposta fail:', e); }

  await fetch(`${SB_URL}/rest/v1/va_disparos?id=eq.${disp.id}`, {
    method:'PATCH', headers: H_SVC(),
    body: JSON.stringify({
      status:'enviado', enviado_em: new Date().toISOString(),
      zapi_message_id: env.messageId, razao_id: razaoId,
    }),
  });

  // Move lead → em_conversa
  await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}`, {
    method:'PATCH', headers: H_SVC(),
    body: JSON.stringify({ funil_etapa:'em_conversa' }),
  });

  return json(res, 200, {
    ok: true,
    disparo_id: disp.id,
    message_id: env.messageId,
    razao_id: razaoId,
  });
};
