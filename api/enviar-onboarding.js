// /api/enviar-onboarding · dispara 3 mensagens sequenciais no WhatsApp do cliente
// via Z-API (mesma stack do notificacoes-dispatcher). Recebe mensagens já editadas
// pelo operador (preview → confirmação → envio).
// Marca onboarding_enviado_em + snapshot, deixando o projeto em estado
// AGUARDANDO CLIENTE até primeira_reuniao_em ser preenchida.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req){ if (req.body) return typeof req.body==='string'?JSON.parse(req.body):req.body; const c=[]; for await (const x of req) c.push(x); const r=Buffer.concat(c).toString('utf8'); return r?JSON.parse(r):{}; }
async function ehAdmin(tok){
  if (!tok) return false;
  const r = await fetch(SB_URL+'/rest/v1/rpc/va_is_admin',{method:'POST',headers:{apikey:SB_ANON,Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:'{}'});
  return r.ok && (await r.json())===true;
}
function normFone(f){ return String(f||'').replace(/\D/g,''); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function enviarZapi(telefone, corpo) {
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

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
  const { projeto_id, mensagens, remetente_email } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });
  if (!Array.isArray(mensagens) || !mensagens.length) return json(res, 400, { ok:false, erro:'mensagens obrigatórias (array de string)' });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  const pR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=id,cliente_nome,cliente_whatsapp`, { headers: H });
  const [p] = await pR.json();
  if (!p) return json(res, 404, { ok:false, erro:'projeto não encontrado' });
  const fone = normFone(p.cliente_whatsapp);
  if (!fone) return json(res, 400, { ok:false, erro:'projeto sem cliente_whatsapp' });

  const resultados = [];
  for (let i = 0; i < mensagens.length; i++) {
    const m = String(mensagens[i]||'').trim();
    if (!m) { resultados.push({ i, ok:false, erro:'vazia' }); continue; }
    const r = await enviarZapi(fone, m);
    resultados.push({ i, ok: !!r.ok, http: r.http, zapi_id: r.zapi_id || null, erro: r.ok?null:(r.erro||('http '+r.http)) });
    if (i < mensagens.length - 1) await sleep(2500);
  }

  const algumSucesso = resultados.some(r => r.ok);
  if (!algumSucesso) {
    return json(res, 502, { ok:false, erro:'todas as mensagens falharam', resultados });
  }

  const patch = {
    onboarding_enviado_em: new Date().toISOString(),
    onboarding_enviado_por: remetente_email || 'admin',
    onboarding_conteudo_snapshot: { mensagens, resultados, enviado_em: new Date().toISOString() },
  };
  const upR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}`, {
    method:'PATCH', headers:H, body: JSON.stringify(patch),
  });
  if (!upR.ok) return json(res, 502, { ok:true, aviso:'enviado mas falhou ao gravar snapshot · '+upR.status, resultados });

  return json(res, 200, { ok:true, quantidade: resultados.filter(r=>r.ok).length, resultados });
};
