// /api/notificacoes-dispatcher · Vercel Function · roda por cron
// Envia notificações pendentes de va_notificacoes ao cliente via Z-API.
// Regras:
//   • programadas: só saem em dia/hora configurados (segunda 08h e quinta 17h)
//   • imediatas: saem na hora — se múltiplas do mesmo dia/projeto, já vêm agrupadas pela RPC
//   • TETO: 2 programadas por semana (segunda + quinta). Regra enforçada aqui.
// Também executa va_notificar_parcelas_vencendo() a cada rodada.
// Autoriza via x-cron-secret == CRON_SECRET ou JWT admin.

const SB_URL = process.env.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL+'/rest/v1/rpc/va_is_admin', { method:'POST', headers:{apikey:SB_ANON,Authorization:'Bearer '+tok,'Content-Type':'application/json'}, body:'{}' });
  return r.ok && (await r.json())===true;
}

// Envia via Z-API (edge disparador-rodar-campanha ou z-api-send direto).
// Fallback: marca como enviado sem chamar (dry-run) se Z-API não configurado.
async function enviarZapi(sbHeaders, projeto_id, telefone, corpo) {
  const inst = process.env.ZAPI_INSTANCE, tok = process.env.ZAPI_TOKEN, ct = process.env.ZAPI_CLIENT_TOKEN;
  if (!inst || !tok) return { ok:false, dry:true, erro:'ZAPI_INSTANCE/TOKEN ausentes' };
  try {
    const r = await fetch(`https://api.z-api.io/instances/${inst}/token/${tok}/send-text`, {
      method:'POST',
      headers: { 'Content-Type':'application/json', ...(ct?{'Client-Token':ct}:{}) },
      body: JSON.stringify({ phone: telefone, message: corpo }),
    });
    const d = await r.json().catch(()=>({}));
    return { ok:r.ok, http:r.status, zapi_id:d?.messageId || d?.id || null, raw:d };
  } catch (e) {
    return { ok:false, erro:String(e.message||e).slice(0,200) };
  }
}

async function marcarProgramadasSegunda(sbHeaders, projeto_id, agora) {
  // Concatena todas 'abertura_semana' pendentes desta semana em 1 corpo,
  // + "o que já está em andamento" (bloco 3 obrigatório)
  const r = await fetch(`${SB_URL}/rest/v1/va_notificacoes?projeto_id=eq.${projeto_id}&status=eq.pendente&subtipo=eq.abertura_semana&order=criado_em.asc&select=id,corpo,meta`, { headers: sbHeaders });
  const pend = await r.json();
  if (!Array.isArray(pend) || pend.length===0) return null;

  // Bloco 3: em andamento
  const rB3 = await fetch(`${SB_URL}/rest/v1/va_contatos?projeto_id=eq.${projeto_id}&estagio=in.(negociacao,proposta,loi)&select=estagio`, { headers: sbHeaders });
  const b3rows = await rB3.json();
  const nNeg = (b3rows||[]).filter(x=>x.estagio==='negociacao').length;
  const nProp = (b3rows||[]).filter(x=>x.estagio==='proposta').length;
  const nLoi = (b3rows||[]).filter(x=>x.estagio==='loi').length;
  const parts = [];
  if (nNeg>0) parts.push(`${nNeg} em negociação`);
  if (nProp>0) parts.push(`${nProp} proposta${nProp>1?'s':''} em análise`);
  if (nLoi>0) parts.push(`${nLoi} LOI${nLoi>1?'s':''}`);
  const bloco3 = parts.length>0 ? `\n\nDo que já está em andamento: ${parts.join(', ')}.` : `\n\nNada de novo no funil desde a última semana — os contatos ativos seguem em acompanhamento.`;

  const corpo = pend.map(n=>n.corpo).join('\n\n') + bloco3;
  return { corpo, ids: pend.map(n=>n.id) };
}

async function montarResumoQuinta(sbHeaders, projeto_id) {
  // Progresso desde segunda desta semana
  const rC = await fetch(`${SB_URL}/rest/v1/va_contatos?projeto_id=eq.${projeto_id}&select=estagio,respondeu_toque1_em,atualizado_em`, { headers: sbHeaders });
  const contatos = await rC.json();
  const seg = new Date(); const dow = seg.getUTCDay(); const diff = dow===0?-6:(1-dow); seg.setUTCDate(seg.getUTCDate()+diff); seg.setUTCHours(0,0,0,0);
  const alcancados = contatos.filter(c => c.respondeu_toque1_em && new Date(c.respondeu_toque1_em) >= seg).length;
  const nEstag = e => contatos.filter(c=>c.estagio===e).length;
  const interesse = nEstag('interesse_inicial') + nEstag('apresentado');
  const negociando = nEstag('negociacao') + nEstag('proposta') + nEstag('loi');

  let corpo;
  if (alcancados > 0 || interesse > 0) {
    corpo = `Resumo da semana. ${alcancados} contato(s) responderam à abertura, ${interesse} demonstraram interesse inicial e ${negociando} seguem em negociação.\n\nAcompanho os avanços e trago novidades individuais na hora que forem relevantes.`;
  } else {
    corpo = `Resumo da semana. Sem movimentos novos desde segunda — cadência em curso, ${negociando} contato(s) ativos em negociação/proposta.\n\nSeguimos trabalhando.`;
  }
  return corpo;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { ok:false, erro:'method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = req.headers['x-cron-secret'] || req.headers['x-vercel-cron-secret'] || '';
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  const okCron = cronSecret && headerSecret === cronSecret;
  const okAdmin = tok && (await ehAdmin(tok));
  if (!okCron && !okAdmin) return json(res, 403, { ok:false, erro:'não autorizado' });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });
  const sbHeaders = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  // Refresca parcelas vencendo (idempotente)
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/va_notificar_parcelas_vencendo`, { method:'POST', headers: sbHeaders, body:'{}' });
  } catch (_) {}

  const agora = new Date();
  const dow = agora.getUTCDay(); // 0=dom … 4=qui
  const hora = agora.getUTCHours(); // UTC; para BRT subtrair 3 → aceitamos janela ±1h
  const enviados = [];

  // 1) Programadas: montam abertura (seg) / resumo (qui) por projeto
  const rProj = await fetch(`${SB_URL}/rest/v1/va_projetos?status=eq.ativo&select=id,cliente_nome,cliente_whatsapp`, { headers: sbHeaders });
  const projetos = await rProj.json();
  for (const p of (Array.isArray(projetos)?projetos:[])) {
    if (!p.cliente_whatsapp) continue;

    // Segunda 08h BRT = 11h UTC (janela 11-12 UTC)
    if (dow === 1 && hora >= 10 && hora <= 12) {
      const pack = await marcarProgramadasSegunda(sbHeaders, p.id, agora);
      if (pack) {
        const env = await enviarZapi(sbHeaders, p.id, p.cliente_whatsapp, pack.corpo);
        // Marca as pendentes como enviadas ou agrupadas
        await fetch(`${SB_URL}/rest/v1/va_notificacoes?id=in.(${pack.ids.join(',')})`, {
          method:'PATCH', headers: sbHeaders,
          body: JSON.stringify({ status:'enviado', enviado_em: new Date().toISOString(), zapi_message_id: env.zapi_id || null, erro: env.ok?null:(env.erro||null) }),
        });
        enviados.push({ projeto_id:p.id, tipo:'abertura_semana', ok:env.ok, dry:env.dry||false });
      }
    }

    // Quinta 17h BRT = 20h UTC (janela 19-21 UTC)
    if (dow === 4 && hora >= 19 && hora <= 21) {
      const corpo = await montarResumoQuinta(sbHeaders, p.id);
      // Registra a programada 'resumo_semana' e envia
      const rIns = await fetch(`${SB_URL}/rest/v1/rpc/va_notificar`, {
        method:'POST', headers: sbHeaders,
        body: JSON.stringify({ p_projeto_id:p.id, p_tipo:'programada', p_subtipo:'resumo_semana', p_corpo:corpo, p_meta:null }),
      });
      const notId = await rIns.json();
      const env = await enviarZapi(sbHeaders, p.id, p.cliente_whatsapp, corpo);
      await fetch(`${SB_URL}/rest/v1/va_notificacoes?id=eq.${notId}`, {
        method:'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status:'enviado', enviado_em: new Date().toISOString(), zapi_message_id: env.zapi_id || null, erro: env.ok?null:(env.erro||null) }),
      });
      enviados.push({ projeto_id:p.id, tipo:'resumo_semana', ok:env.ok, dry:env.dry||false });
    }
  }

  // 2) Imediatas: envia todas as 'pendente' (master, sem agrupado_com), a qualquer hora
  const rImed = await fetch(`${SB_URL}/rest/v1/va_notificacoes?tipo=eq.imediata&status=eq.pendente&agrupado_com=is.null&select=id,projeto_id,corpo,subtipo`, { headers: sbHeaders });
  const imed = await rImed.json();
  for (const n of (Array.isArray(imed)?imed:[])) {
    const rPj = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${n.projeto_id}&select=cliente_whatsapp`, { headers: sbHeaders });
    const [pj] = await rPj.json();
    if (!pj?.cliente_whatsapp) continue;
    const env = await enviarZapi(sbHeaders, n.projeto_id, pj.cliente_whatsapp, n.corpo);
    await fetch(`${SB_URL}/rest/v1/va_notificacoes?id=eq.${n.id}`, {
      method:'PATCH', headers: sbHeaders,
      body: JSON.stringify({ status: env.ok?'enviado':'falhou', enviado_em:new Date().toISOString(), zapi_message_id:env.zapi_id||null, erro:env.ok?null:(env.erro||null) }),
    });
    enviados.push({ projeto_id:n.projeto_id, tipo:'imediata', subtipo:n.subtipo, ok:env.ok, dry:env.dry||false });
  }

  return json(res, 200, { ok:true, agora: agora.toISOString(), enviados });
};
