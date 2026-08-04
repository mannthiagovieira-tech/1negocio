// /api/va-zapi-webhook · Vercel Function
// P4 · Recebe mensagens Z-API (onReceive) do domínio MANDATO (va_leads).
// Distinto do /api/whatsapp-webhook (legado, casa em va_contatos).
//
// Configuração no painel Z-API (operador): apontar onReceive pra
//   https://www.1negocio.com.br/api/va-zapi-webhook?token=<ZAPI_WEBHOOK_TOKEN>
//
// Fluxo:
//   1. Normaliza telefone (só dígitos)
//   2. Match em va_leads por whatsapp/telefone (normalizado)
//   3. Se match e mensagem NÃO é fromMe: grava va_mensagens_recebidas,
//      cancela disparos 'agendado', marca lead 'respondeu' + respondeu_em
//   4. Detecta opt-out (regex insensitive) → funil_etapa='optout'
//   5. Sem match: grava órfã (lead_id NULL) pra triagem futura
//
// Segurança: token via query ou header x-webhook-token contra ZAPI_WEBHOOK_TOKEN.

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WEBHOOK_TOKEN = process.env.ZAPI_WEBHOOK_TOKEN;

const RE_OPTOUT = /\b(n[ãa]o\s+quero|nao\s+tenho\s+interesse|remover|pare|parar|sair\s+da\s+lista|descadastr(?:ar|e)|stop|unsub)\b/i;

// P5 Slice C · parse do adContext CTWA. Meta preserva o ctwaPayload que
// injetamos no url_tags do creative (base64({campanha_id, criativo_id,
// arquetipo_id})). Cai em raw.adContext.ctwaPayload OU em
// raw.adContext.entryPointConversionSource (fallback URL com query param).
function parseCtwaPayload(raw) {
  try {
    const adCtx = raw?.adContext;
    if (!adCtx) return null;
    // Tentativa 1: ctwaPayload como Buffer (Z-API costuma passar {data:[...]})
    const buf = adCtx.ctwaPayload;
    if (buf?.data && Array.isArray(buf.data) && buf.data.length) {
      const bytes = Buffer.from(buf.data);
      const raw1 = bytes.toString('utf8');
      // Tenta JSON direto · se falhar tenta base64 do bytes
      try { return JSON.parse(raw1); } catch {}
      try { return JSON.parse(Buffer.from(raw1, 'base64').toString('utf8')); } catch {}
    }
    // Tentativa 2: string base64 direta
    if (typeof buf === 'string' && buf.length) {
      try { return JSON.parse(Buffer.from(buf, 'base64').toString('utf8')); } catch {}
    }
    // Tentativa 3: url_tags no entryPointConversionSource (nosso próprio inject)
    const src = adCtx.entryPointConversionSource || '';
    const m = String(src).match(/ctwa_payload=([^&]+)/);
    if (m) {
      const decoded = decodeURIComponent(m[1]);
      try { return JSON.parse(Buffer.from(decoded, 'base64').toString('utf8')); } catch {}
    }
    return null;
  } catch { return null; }
}

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json');
  res.send(JSON.stringify(body));
}
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const c = []; for await (const x of req) c.push(x);
  const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {};
}
function normFone(s) { return String(s||'').replace(/\D/g,''); }

const H = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });

  // Auth por token (Z-API não envia JWT)
  const qToken = new URL(req.url, 'http://x').searchParams.get('token');
  const hToken = req.headers['x-webhook-token'];
  if (!WEBHOOK_TOKEN || (qToken !== WEBHOOK_TOKEN && hToken !== WEBHOOK_TOKEN)) {
    return json(res, 403, { ok:false, erro:'token inválido' });
  }
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  // Ignora mensagens enviadas por nós mesmos
  if (body?.fromMe === true) return json(res, 200, { ok:true, ignored:'from_me' });

  // Extrai telefone + texto do payload Z-API (padrão do whatsapp-webhook legado)
  const rawPhone = body?.phone || body?.chat?.phone || body?.from || body?.sender || '';
  const telefone = normFone(rawPhone);
  const corpo = body?.text?.message || body?.message || body?.body || body?.text || null;
  if (!telefone) return json(res, 400, { ok:false, erro:'telefone ausente no payload' });

  // Match em va_leads (busca por whatsapp OU telefone, ambos normalizados)
  // Estratégia: like sobre versão normalizada · fazemos UMA query SQL via RPC ou match aplicativo
  const rLeads = await fetch(
    `${SB_URL}/rest/v1/va_leads?or=(whatsapp.ilike.*${telefone.slice(-8)}*,telefone.ilike.*${telefone.slice(-8)}*)&funil_etapa=in.(na_fila,contatado,respondeu,em_conversa)&select=id,projeto_id,whatsapp,telefone,funil_etapa`,
    { headers: H() });
  const cand = await rLeads.json();
  const lead = (Array.isArray(cand) ? cand : []).find(l => {
    const wa = normFone(l.whatsapp); const tel = normFone(l.telefone);
    return (wa && wa.endsWith(telefone.slice(-8))) || (tel && tel.endsWith(telefone.slice(-8)));
  });

  if (!lead) {
    // P5 Slice C · Antes de guardar como órfã, tenta desemboque CTWA:
    // se o payload traz referral de campanha nossa, cria lead na antessala.
    const payload = parseCtwaPayload(body);
    if (payload?.campanha_id) {
      const cR = await fetch(`${SB_URL}/rest/v1/va_campanhas?id=eq.${payload.campanha_id}&select=id,projeto_id,arquetipo_id,criativo_id`, { headers: H() });
      const [cmp] = await cR.json();
      if (cmp) {
        // Cria lead na ANTESSALA do projeto da campanha · origem=campanha · whatsapp_verificado=true (veio DO WhatsApp)
        const ins = await fetch(`${SB_URL}/rest/v1/va_leads`, {
          method:'POST', headers: H(),
          body: JSON.stringify({
            projeto_id: cmp.projeto_id,
            arquetipo_id: payload.arquetipo_id || cmp.arquetipo_id,
            campanha_id: cmp.id,
            criativo_id: payload.criativo_id || cmp.criativo_id,
            origem: 'campanha', fonte: 'meta_ctwa',
            razao_social: `Lead inbound · ${telefone.slice(-4)}`,
            whatsapp: telefone, telefone,
            whatsapp_verificado: true, verificado_em: new Date().toISOString(),
            contato_fonte: 'manual',
            status: 'antessala',
            ad_ref: { adContext: body?.adContext || null, ctwa_payload: payload },
          }),
        });
        if (ins.ok) {
          const [novo] = await ins.json();
          // Grava a primeira mensagem já vinculada
          await fetch(`${SB_URL}/rest/v1/va_mensagens_recebidas`, {
            method:'POST', headers: H(),
            body: JSON.stringify({
              projeto_id: cmp.projeto_id, lead_id: novo.id,
              telefone, corpo, raw: body, processada: true,
            }),
          });
          return json(res, 200, { ok:true, match:true, origem:'campanha', lead_id: novo.id, campanha_id: cmp.id, criado:true });
        }
      }
    }
    // órfã · guarda pra triagem
    await fetch(`${SB_URL}/rest/v1/va_mensagens_recebidas`, {
      method:'POST', headers: H(),
      body: JSON.stringify({ telefone, corpo, raw: body }),
    });
    return json(res, 200, { ok:true, match:false, motivo:'sem lead com esse telefone' });
  }

  // Grava mensagem vinculada
  await fetch(`${SB_URL}/rest/v1/va_mensagens_recebidas`, {
    method:'POST', headers: H(),
    body: JSON.stringify({
      projeto_id: lead.projeto_id, lead_id: lead.id,
      telefone, corpo, raw: body, processada: true,
    }),
  });

  // Opt-out?
  const isOptout = corpo && RE_OPTOUT.test(String(corpo));
  const novaEtapa = isOptout ? 'optout' : 'respondeu';
  const patch = { funil_etapa: novaEtapa };
  if (!isOptout) patch.respondeu_em = new Date().toISOString();

  const uR = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}`, {
    method:'PATCH', headers: H(), body: JSON.stringify(patch),
  });
  const updated = uR.ok;

  // Cancela disparos ainda 'agendado' do lead (regra de ouro: pausa automática)
  await fetch(`${SB_URL}/rest/v1/va_disparos?lead_id=eq.${lead.id}&status=eq.agendado`, {
    method:'PATCH', headers: H(),
    body: JSON.stringify({ status:'cancelado', erro:'cancelado_por_resposta' }),
  });

  return json(res, 200, { ok:true, match:true, lead_id: lead.id, etapa: novaEtapa, updated });
};
