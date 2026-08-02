// /api/enviar-onboarding · dispara N mensagens sequenciais no WhatsApp do cliente
// via Z-API. Prioriza credenciais da tabela zapi_telefones (mesmo padrão
// que disparador-rodar-campanha usa). Fallback pra env vars se tabela vazia.
// Retorna erro detalhado por mensagem pra facilitar diagnóstico.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req){ if (req.body) return typeof req.body==='string'?JSON.parse(req.body):req.body; const c=[]; for await (const x of req) c.push(x); const r=Buffer.concat(c).toString('utf8'); return r?JSON.parse(r):{}; }
async function ehAdmin(tok){
  if (!tok) return false;
  const r = await fetch(SB_URL+'/rest/v1/rpc/va_is_admin',{method:'POST',headers:{apikey:SB_ANON,Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:'{}'});
  return r.ok && (await r.json())===true;
}
function normFone(f){
  const n = String(f||'').replace(/\D/g,'');
  if (!n) return '';
  return n.startsWith('55') ? n : '55' + n;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function carregarZapiCreds(sbHeaders) {
  // Prioridade 1: tabela zapi_telefones (fonte-verdade · gerenciada em runtime)
  const r = await fetch(`${SB_URL}/rest/v1/zapi_telefones?ativo=eq.true&select=zapi_instance,zapi_token,zapi_client_token,numero,apelido&order=updated_at.desc&limit=1`, { headers: sbHeaders });
  if (r.ok) {
    const arr = await r.json();
    if (arr?.[0]?.zapi_instance && arr[0].zapi_token) {
      return { origem: 'zapi_telefones', ...arr[0] };
    }
  }
  // Prioridade 2: env vars
  const inst = process.env.ZAPI_INSTANCE, tok = process.env.ZAPI_TOKEN, ct = process.env.ZAPI_CLIENT_TOKEN;
  if (inst && tok) return { origem: 'env', zapi_instance: inst, zapi_token: tok, zapi_client_token: ct };
  return null;
}

async function enviarZapi(creds, telefone, corpo) {
  const fone = normFone(telefone);
  if (!fone) return { ok:false, erro:'telefone vazio' };
  try {
    const url = `https://api.z-api.io/instances/${creds.zapi_instance}/token/${creds.zapi_token}/send-text`;
    const headers = { 'Content-Type':'application/json' };
    if (creds.zapi_client_token) headers['client-token'] = creds.zapi_client_token;
    const r = await fetch(url, { method:'POST', headers, body: JSON.stringify({ phone: fone, message: corpo }) });
    const raw = await r.text();
    let d = null; try { d = JSON.parse(raw); } catch { /* ignore */ }
    if (!r.ok) return { ok:false, http:r.status, erro:`HTTP ${r.status}: ${raw.slice(0,300)}` };
    return { ok:true, http:r.status, zapi_id: d?.messageId || d?.id || d?.zaapId || null };
  } catch (e) {
    return { ok:false, erro:'exception: '+String(e.message||e).slice(0,200) };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
  const { projeto_id, mensagens, remetente_email, opcoes_horario } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });
  if (!Array.isArray(mensagens) || !mensagens.length) return json(res, 400, { ok:false, erro:'mensagens obrigatórias' });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY não configurado no Vercel' });
  const H = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  const pR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=id,cliente_nome,cliente_whatsapp`, { headers: H });
  const [p] = await pR.json();
  if (!p) return json(res, 404, { ok:false, erro:'projeto não encontrado' });
  if (!p.cliente_whatsapp) return json(res, 400, { ok:false, erro:'projeto sem cliente_whatsapp' });

  const creds = await carregarZapiCreds(H);
  if (!creds) return json(res, 503, { ok:false, erro:'sem credenciais Z-API · configure em zapi_telefones (preferencial) ou env vars ZAPI_INSTANCE/ZAPI_TOKEN/ZAPI_CLIENT_TOKEN no Vercel' });

  const resultados = [];
  for (let i = 0; i < mensagens.length; i++) {
    const m = String(mensagens[i]||'').trim();
    if (!m) { resultados.push({ i, ok:false, erro:'msg vazia' }); continue; }
    const r = await enviarZapi(creds, p.cliente_whatsapp, m);
    resultados.push({ i, ok: !!r.ok, http: r.http, zapi_id: r.zapi_id || null, erro: r.ok?null:(r.erro||('http '+r.http)) });
    if (i < mensagens.length - 1) await sleep(2500);
  }

  const algumOk = resultados.some(r => r.ok);
  if (!algumOk) {
    return json(res, 502, { ok:false, erro:'nenhuma mensagem enviada · veja resultados[].erro', origem_creds: creds.origem, telefone_normalizado: normFone(p.cliente_whatsapp), resultados });
  }

  const patch = {
    onboarding_enviado_em: new Date().toISOString(),
    onboarding_enviado_por: remetente_email || 'admin',
    onboarding_conteudo_snapshot: { mensagens, resultados, opcoes_horario: opcoes_horario||null, enviado_em: new Date().toISOString(), origem_creds: creds.origem },
  };
  if (Array.isArray(opcoes_horario) && opcoes_horario.length) patch.opcoes_horario = opcoes_horario;
  const upR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}`, { method:'PATCH', headers:H, body: JSON.stringify(patch) });
  if (!upR.ok) return json(res, 200, { ok:true, aviso:'enviado mas snapshot falhou '+upR.status, resultados });

  return json(res, 200, { ok:true, quantidade: resultados.filter(r=>r.ok).length, resultados });
};
