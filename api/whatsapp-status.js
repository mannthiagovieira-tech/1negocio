// /api/whatsapp-status · Vercel Function
// Webhook Z-API para callbacks de status (onSend, onDelivery, onReadReceipt).
// Atualiza va_disparo_fila.status:
//   SENT      -> 'enviado'
//   DELIVERED -> 'entregue'
//   READ      -> 'entregue' (sem coluna 'lido')
//   FAILED    -> 'falhou' + erro
// Casa por zapi_message_id. SEMPRE 200 (evita retry loop Z-API).

const SB_URL = process.env.SUPABASE_URL;

async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
function json200(res, body) { res.status(200).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function safeCall(url, opts) { try { return await fetch(url, opts); } catch { return null; } }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return json200(res, { ok:true, ping:true });
  if (req.method !== 'POST') return json200(res, { ok:false, erro:'ignored_method' });

  const expected = process.env.ZAPI_WEBHOOK_TOKEN;
  const got = req.headers['x-webhook-token'] || (new URL(req.url, 'http://x').searchParams.get('token')) || '';
  if (!expected || got !== expected) return json200(res, { ok:true, ignored:'auth_falha' });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json200(res, { ok:true, ignored:'service_role_ausente' });
  const sbHeaders = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  let body; try { body = await lerBody(req); } catch { return json200(res, { ok:true, ignored:'body_invalido' }); }

  const zapiId = body?.messageId || body?.id || null;
  const rawStatus = String(body?.status || body?.type || '').toUpperCase();
  const erro = body?.error || body?.errorMessage || null;
  if (!zapiId) return json200(res, { ok:true, ignored:'sem_message_id' });

  const map = {
    SENT: 'enviado', DELIVERED: 'entregue', READ: 'entregue',
    FAILED: 'falhou', ERROR: 'falhou', UNDELIVERED: 'falhou',
  };
  const novoStatus = map[rawStatus];
  if (!novoStatus) return json200(res, { ok:true, ignored:'status_desconhecido', status:rawStatus });

  const patch = {
    status: novoStatus,
    ...(novoStatus === 'entregue' || novoStatus === 'enviado' ? { enviado_em: new Date().toISOString() } : {}),
    ...(erro ? { erro: String(erro).slice(0, 500) } : {}),
  };

  const r = await safeCall(`${SB_URL}/rest/v1/va_disparo_fila?zapi_message_id=eq.${zapiId}`, {
    method:'PATCH',
    headers: { ...sbHeaders, Prefer:'return=representation' },
    body: JSON.stringify(patch),
  });
  const arr = r ? await r.json().catch(()=>[]) : [];
  return json200(res, { ok:true, atualizado: Array.isArray(arr) ? arr.length : 0, zapi_message_id: zapiId, novo_status: novoStatus });
};
