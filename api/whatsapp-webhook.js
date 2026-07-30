// /api/whatsapp-webhook · Vercel Function
// Recebe eventos de mensagem recebida da Z-API (webhook onReceive).
// Ao detectar RESPOSTA de lead abordado (toque 1 enviado, estagio='abordado'):
//   1. va_registrar_resposta_toque1 (marca elegivel_toque2)
//   2. grava interação tipo 'resposta' em va_contato_interacoes
//   3. move contato pra 'interesse_inicial'
//   4. dispara notificação IMEDIATA ao operador
// Se não achou contato → guarda em va_nao_identificados para vinculação manual.
// SEMPRE responde 200 — webhook que devolve erro faz Z-API reenviar em loop.
//
// Segurança: exige ZAPI_WEBHOOK_TOKEN no header 'x-webhook-token' OU query ?token=
// comparado com env var. Sem token ou token errado → 200 mas descarta.

const SB_URL = process.env.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';

async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
function json200(res, body) { res.status(200).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }

async function safeCall(url, opts) {
  try { const r = await fetch(url, opts); return r; } catch { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return json200(res, { ok:true, ping:true });
  if (req.method !== 'POST') return json200(res, { ok:false, erro:'ignored_method' });

  // Validação de origem — sempre responde 200 pra não gerar retry
  const expected = process.env.ZAPI_WEBHOOK_TOKEN;
  const got = req.headers['x-webhook-token'] || (new URL(req.url, 'http://x').searchParams.get('token')) || '';
  if (!expected || got !== expected) {
    return json200(res, { ok:true, ignored:'auth_falha' }); // não vaza detalhe
  }

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json200(res, { ok:true, ignored:'service_role_ausente' });
  const sbHeaders = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  let body; try { body = await lerBody(req); } catch { return json200(res, { ok:true, ignored:'body_invalido' }); }

  // Z-API onReceive: { phone, senderName, text: { message }, messageId, type, fromMe, ... }
  // Filtramos só mensagens de entrada (fromMe=false) e do tipo texto simples
  if (body?.fromMe === true) return json200(res, { ok:true, ignored:'from_me' });
  const foneRaw = body?.phone || body?.from || body?.author || '';
  const texto = body?.text?.message || body?.message?.text || body?.body || body?.text || '';
  const zapiId = body?.messageId || body?.message_id || body?.id || null;
  const senderName = body?.senderName || body?.pushName || body?.notifyName || null;
  if (!foneRaw || !texto) return json200(res, { ok:true, ignored:'sem_conteudo' });

  // Normaliza telefone via RPC
  let foneNorm = String(foneRaw).replace(/\D/g,'');
  try {
    const rN = await safeCall(`${SB_URL}/rest/v1/rpc/va_normalizar_telefone`, {
      method:'POST', headers: sbHeaders, body: JSON.stringify({ p_input: foneRaw }),
    });
    if (rN && rN.ok) {
      const n = await rN.json();
      if (typeof n === 'string' && n.length > 0) foneNorm = n;
    }
  } catch (_) {}

  // Busca contato em projetos ativos (mais recente primeiro)
  const rCt = await safeCall(
    `${SB_URL}/rest/v1/va_contatos?telefone_normalizado=eq.${foneNorm}&order=atualizado_em.desc&limit=1&select=id,projeto_id,estagio,nome,empresa,va_projetos!inner(status)`,
    { headers: sbHeaders }
  );
  const arr = rCt ? await rCt.json().catch(()=>[]) : [];
  const contato = Array.isArray(arr) ? arr.find(c => c.va_projetos?.status === 'ativo') || arr[0] : null;

  if (!contato) {
    // Grava em não identificados (upsert por zapi_message_id se disponível)
    await safeCall(`${SB_URL}/rest/v1/va_nao_identificados${zapiId?'?on_conflict=zapi_message_id':''}`, {
      method:'POST', headers: { ...sbHeaders, Prefer: zapiId?'resolution=merge-duplicates':'return=minimal' },
      body: JSON.stringify({ telefone_normalizado: foneNorm, telefone_bruto: foneRaw, nome: senderName, mensagem: texto, zapi_message_id: zapiId }),
    });
    return json200(res, { ok:true, status:'nao_identificado', telefone_normalizado: foneNorm });
  }

  // Grava interação tipo 'resposta'
  await safeCall(`${SB_URL}/rest/v1/va_contato_interacoes`, {
    method:'POST', headers: sbHeaders,
    body: JSON.stringify({
      contato_id: contato.id, projeto_id: contato.projeto_id,
      tipo: 'resposta', conteudo: texto.slice(0, 2000),
      autor: 'lead', estagio_de: contato.estagio, estagio_para: 'interesse_inicial',
    }),
  });

  // Se estava em 'abordado' com toque 1 enviado, registra resposta ao toque 1
  const emAbordado = contato.estagio === 'abordado';
  if (emAbordado) {
    await safeCall(`${SB_URL}/rest/v1/rpc/va_registrar_resposta_toque1`, {
      method:'POST', headers: sbHeaders,
      body: JSON.stringify({ p_contato_id: contato.id }),
    });
  }

  // Move contato pra 'interesse_inicial' (se já estava adiante, deixa como está)
  const avancados = ['interesse_inicial','apresentado','nda_assinado','em_negociacao','proposta','fechado'];
  if (!avancados.includes(contato.estagio)) {
    await safeCall(`${SB_URL}/rest/v1/va_contatos?id=eq.${contato.id}`, {
      method:'PATCH', headers: sbHeaders,
      body: JSON.stringify({ estagio: 'interesse_inicial', atualizado_em: new Date().toISOString() }),
    });
  }

  // Notificação imediata ao operador (fora do teto)
  const nome = contato.nome || senderName || 'lead';
  await safeCall(`${SB_URL}/rest/v1/rpc/va_notificar`, {
    method:'POST', headers: sbHeaders,
    body: JSON.stringify({
      p_projeto_id: contato.projeto_id, p_tipo: 'imediata', p_subtipo: 'resposta_lead',
      p_corpo: nome + ' respondeu à abordagem: "' + texto.slice(0, 200).replace(/"/g,"'") + '"',
      p_meta: { contato_id: contato.id, zapi_message_id: zapiId },
    }),
  });

  return json200(res, { ok:true, status:'resposta_registrada', contato_id: contato.id, elegivel_toque2: emAbordado });
};
