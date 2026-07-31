// /api/cron-renovacao-d15 · Vercel Function · cron diário
// Verifica ondas ativas que terminam em 15 dias e dispara notificação
// imediata (única por onda). Autorizado por Authorization Bearer CRON_SECRET
// (Vercel Cron) OU x-cron-secret.

const SB_URL = process.env.SUPABASE_URL;

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function safeCall(url, opts) { try { return await fetch(url, opts); } catch { return null; } }

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { ok:false });

  const cronSecret = process.env.CRON_SECRET;
  const authRaw = req.headers.authorization || '';
  const tok = authRaw.replace(/^Bearer\s+/i,'').trim();
  const headerSecret = req.headers['x-cron-secret'] || '';
  const okCron = cronSecret && (tok === cronSecret || headerSecret === cronSecret);
  if (!okCron) return json(res, 403, { ok:false });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });
  const sbHeaders = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  // Busca ondas ativas com data_fim em ~15 dias e SEM notificação prévia
  const alvo = new Date(Date.now() + 15*86400000).toISOString().slice(0,10);
  const r = await safeCall(`${SB_URL}/rest/v1/va_projeto_ondas?status=eq.ativa&data_fim=eq.${alvo}&select=id,projeto_id,numero,data_fim,valor_mensal`, { headers: sbHeaders });
  const ondas = r ? await r.json() : [];

  const disparadas = [];
  for (const o of (Array.isArray(ondas)?ondas:[])) {
    // Deduplica: só notifica se ainda não houve subtipo 'renovacao_d15' pra essa onda
    const rN = await safeCall(`${SB_URL}/rest/v1/va_notificacoes?projeto_id=eq.${o.projeto_id}&subtipo=eq.renovacao_d15&meta->>onda_id=eq.${o.id}&select=id`, { headers: sbHeaders });
    const jaExiste = rN ? (await rN.json()) : [];
    if (Array.isArray(jaExiste) && jaExiste.length > 0) continue;

    const corpo = `Faltam 15 dias para o fim da onda ${o.numero}. Vamos combinar renovação, repactuação ou encerramento? Chamada de conversa: me responde qual dia funciona.`;
    await fetch(`${SB_URL}/rest/v1/rpc/va_notificar`, {
      method:'POST', headers: sbHeaders,
      body: JSON.stringify({
        p_projeto_id: o.projeto_id, p_tipo:'imediata', p_subtipo:'renovacao_d15',
        p_corpo: corpo,
        p_meta: { onda_id: o.id, numero: o.numero, data_fim: o.data_fim, valor_mensal: o.valor_mensal },
      }),
    });
    disparadas.push({ projeto_id: o.projeto_id, onda_id: o.id, numero: o.numero });
  }

  return json(res, 200, { ok:true, alvo, verificadas: ondas.length, disparadas });
};
