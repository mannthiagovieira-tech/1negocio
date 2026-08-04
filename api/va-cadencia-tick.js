// /api/va-cadencia-tick · Vercel Function
// P4 · disparador MANDATO. Chamado a cada 5min pelo GitHub Actions
// (workflow .github/workflows/va-cadencia-cron.yml) OU manualmente
// por admin JWT (botão "Processar agora" na UI).
//
// Autenticação · aceita QUALQUER um:
//   - header x-cron-secret === CRON_SECRET   (chamada máquina)
//   - Authorization: Bearer <JWT admin>       (chamada UI)
//
// Fluxo por projeto com cadencia.ativa=true:
//   1. respeita janela + dias úteis + teto diário (conta enviados hoje)
//   2. elegíveis: funil_etapa='na_fila' (toque 1) OU 'contatado' com
//      proximo_toque_apos<=now (toque 2) · !pausado · tem WhatsApp válido
//      · template do arquétipo aprovado
//   3. FIFO por aprovado_em; toque 2 tem prioridade sobre toque 1
//   4. envia via Z-API (send-text), congela corpo em va_disparos,
//      debita 'disparo_whatsapp', atualiza lead
//   5. erro de envio: status='erro' + tentativas++ · reprocessa próximo tick
//   6. envios espaçados dentro do ciclo (30-90s + jitter)

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

// Flag pra E2E: quando MOCK_ZAPI=true, não chama a API real, gera messageId fake
const MOCK_ZAPI = process.env.VA_CADENCIA_MOCK === 'true';

const MAX_TENTATIVAS_POR_TOQUE = 3;
const JITTER_MIN_MS = 30_000;
const JITTER_MAX_MS = 90_000;
const MAX_ENVIOS_POR_TICK = 5; // hard cap por execução (proteção Vercel timeout)

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json');
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

const H_SVC = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' });

function nomeFmt(l) {
  const raw = l.nome_fantasia || l.razao_social || '';
  return raw.split(/\s+/).map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
// {{saudacao}} resolvida no ENVIO com horário BR (America/Sao_Paulo).
// Vercel roda em UTC · sem Intl.timeZone o horário sai errado. Regra:
// <12 = Bom dia · 12–<18 = Boa tarde · >=18 = Boa noite.
function saudacaoAgoraBR() {
  const h = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false,
  }).format(new Date()));
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}
function resolverCorpo(template, lead) {
  const nome = nomeFmt(lead) || 'Prezado(a)';
  return String(template)
    .replace(/\{\{\s*nome_fantasia\s*\}\}/g, nome)
    .replace(/\{\{\s*saudacao\s*\}\}/gi, saudacaoAgoraBR());
}

function dentroJanela(cfg, now) {
  if (cfg.dias_uteis_apenas) {
    const d = now.getDay(); // 0=dom, 6=sab
    if (d === 0 || d === 6) return false;
  }
  const [hI, mI] = String(cfg.janela_inicio||'09:00').split(':').map(Number);
  const [hF, mF] = String(cfg.janela_fim||'18:00').split(':').map(Number);
  const nowMin = now.getHours()*60 + now.getMinutes();
  return nowMin >= (hI*60+mI) && nowMin <= (hF*60+mF);
}

async function contarEnviadosHoje(projetoId) {
  const inicioDia = new Date(); inicioDia.setHours(0,0,0,0);
  const r = await fetch(
    `${SB_URL}/rest/v1/va_disparos?projeto_id=eq.${projetoId}&status=eq.enviado&enviado_em=gte.${encodeURIComponent(inicioDia.toISOString())}&select=id`,
    { headers: H_SVC() });
  const rows = await r.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function pegarTelefoneInstancia() {
  // Ordem de resolução:
  //   1. zapi_telefones (padrão legado, com client_token real de produção)
  //   2. va_zapi_telefones (schema novo, usado apenas se legado indisponível)
  //   3. env vars ZAPI_INSTANCE / ZAPI_TOKEN / (ZAPI_CLIENT_TOKEN | CLIENT_TOKEN)
  try {
    const r = await fetch(`${SB_URL}/rest/v1/zapi_telefones?ativo=eq.true&order=ultima_atividade.desc.nullsfirst&limit=1&select=apelido,zapi_instance,zapi_token,zapi_client_token`, { headers: H_SVC() });
    if (r.ok) {
      const [row] = await r.json();
      if (row?.zapi_instance && row?.zapi_token && row?.zapi_client_token) {
        return { instance: row.zapi_instance, token: row.zapi_token, clientToken: row.zapi_client_token, origem: 'zapi_telefones' };
      }
    }
  } catch (_) {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/va_zapi_telefones?tipo=eq.prospeccao&ativo=eq.true&limit=1&select=numero,instancia,token,client_token`, { headers: H_SVC() });
    if (r.ok) {
      const [row] = await r.json();
      if (row?.instancia && row?.token && row?.client_token) {
        return { instance: row.instancia, token: row.token, clientToken: row.client_token, origem: 'va_zapi_telefones' };
      }
    }
  } catch (_) {}
  if (process.env.ZAPI_INSTANCE && process.env.ZAPI_TOKEN) {
    return {
      instance: process.env.ZAPI_INSTANCE, token: process.env.ZAPI_TOKEN,
      clientToken: process.env.ZAPI_CLIENT_TOKEN || process.env.CLIENT_TOKEN,
      origem: 'env',
    };
  }
  return null;
}

async function enviarZapi(cred, phone, message) {
  if (MOCK_ZAPI) return { ok:true, messageId: 'MOCK-' + Math.random().toString(36).slice(2,10) };
  try {
    const url = `https://api.z-api.io/instances/${cred.instance}/token/${cred.token}/send-text`;
    const headers = { 'Content-Type':'application/json' };
    if (cred.clientToken) headers['client-token'] = cred.clientToken;
    const r = await fetch(url, { method:'POST', headers, body: JSON.stringify({ phone, message }) });
    const raw = await r.text();
    let d = null; try { d = JSON.parse(raw); } catch {}
    if (!r.ok) return { ok:false, erro: `zapi_http_${r.status}: ${raw.slice(0,200)}` };
    return { ok:true, messageId: d?.messageId || d?.id || null, raw: d };
  } catch (e) {
    return { ok:false, erro: 'rede: ' + String(e?.message||e).slice(0,200) };
  }
}

// Processa 1 lead elegível: envia + registra disparo + debita + atualiza lead.
async function processarUmDisparo(projetoId, lead, template, arq, cred, intervaloTogesDias) {
  const nowIso = new Date().toISOString();
  const corpo = resolverCorpo(template.corpo, lead);
  const toque = lead._toque; // 1 ou 2 (definido na seleção)

  // Insere disparo agendado (para rastreabilidade mesmo se falhar)
  const insR = await fetch(`${SB_URL}/rest/v1/va_disparos`, {
    method:'POST', headers: H_SVC(),
    body: JSON.stringify({
      projeto_id: projetoId, lead_id: lead.id, arquetipo_id: arq?.id || null,
      toque, corpo_snapshot: corpo, status:'agendado',
      agendado_para: nowIso, tentativas: 1,
    }),
  });
  const [disp] = await insR.json();

  // Envia
  const fone = String(lead.whatsapp || lead.telefone).replace(/\D/g,'');
  const env = await enviarZapi(cred, fone, corpo);
  if (!env.ok) {
    await fetch(`${SB_URL}/rest/v1/va_disparos?id=eq.${disp.id}`, {
      method:'PATCH', headers: H_SVC(),
      body: JSON.stringify({ status:'erro', erro: env.erro }),
    });
    return { ok:false, disparo_id: disp.id, erro: env.erro };
  }

  // Debita
  let razaoId = null;
  try {
    const dR = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
      method:'POST', headers: H_SVC(),
      body: JSON.stringify({
        p_projeto: projetoId, p_tipo:'disparo_whatsapp', p_qtd: 1,
        p_referencia: `disparo:${disp.id.slice(0,8)} · lead:${lead.id.slice(0,8)} · t${toque}`,
        p_ciclo: null, p_excedente_autorizado: false,
      }),
    });
    if (dR.ok) razaoId = (await dR.json());
  } catch (_) {}

  // Marca disparo enviado
  await fetch(`${SB_URL}/rest/v1/va_disparos?id=eq.${disp.id}`, {
    method:'PATCH', headers: H_SVC(),
    body: JSON.stringify({
      status:'enviado', enviado_em: new Date().toISOString(),
      zapi_message_id: env.messageId, razao_id: razaoId,
    }),
  });

  // Atualiza lead
  const proxTs = new Date(Date.now() + (intervaloTogesDias * 86400_000)).toISOString();
  const patch = toque === 1
    ? { funil_etapa:'contatado', toque1_em: new Date().toISOString(), proximo_toque_apos: proxTs }
    : { toque2_em: new Date().toISOString(), proximo_toque_apos: null };
  await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}`, {
    method:'PATCH', headers: H_SVC(), body: JSON.stringify(patch),
  });

  return { ok:true, disparo_id: disp.id, message_id: env.messageId, toque };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { ok:false });

  // Auth: cron-secret OU JWT admin
  const secret = req.headers['x-cron-secret'];
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  const okSecret = !!(CRON_SECRET && secret && secret === CRON_SECRET);
  const okJwt = okSecret ? true : await ehAdmin(bearer);
  if (!okSecret && !okJwt) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body = {}; try { if (req.method==='POST') body = await lerBody(req); } catch {}
  const projetoFiltro = body?.projeto_id || null;

  // Busca configs ativas (com filtro opcional de projeto)
  const flt = projetoFiltro ? `projeto_id=eq.${projetoFiltro}&` : '';
  const cfgR = await fetch(`${SB_URL}/rest/v1/va_cadencia_config?${flt}ativa=eq.true&select=*`, { headers: H_SVC() });
  const configs = await cfgR.json();
  if (!Array.isArray(configs) || !configs.length) return json(res, 200, { ok:true, tick:'sem_projetos_ativos' });

  const cred = await pegarTelefoneInstancia();
  if (!cred && !MOCK_ZAPI) return json(res, 503, { ok:false, erro:'Z-API credenciais indisponíveis (nem va_zapi_telefones nem env)' });

  const resultado = { ok:true, projetos: [] };
  const now = new Date();

  for (const cfg of configs) {
    const projeto_id = cfg.projeto_id;
    const rProj = { projeto_id, disparos: [], skipped: null, modo: cfg.modo || 'manual' };
    // P4.6 · em modo manual, tick não envia (default do sistema). Operador dispara
    // via botão wa.me no card. Auto = disparo pela Z-API respeitando janela/teto.
    if ((cfg.modo || 'manual') !== 'auto') { rProj.skipped = 'modo_manual'; resultado.projetos.push(rProj); continue; }
    if (!dentroJanela(cfg, now)) { rProj.skipped = 'fora_da_janela'; resultado.projetos.push(rProj); continue; }
    const jaHoje = await contarEnviadosHoje(projeto_id);
    const orcamento = Math.min(cfg.teto_diario - jaHoje, MAX_ENVIOS_POR_TICK);
    if (orcamento <= 0) { rProj.skipped = 'teto_diario'; resultado.projetos.push(rProj); continue; }

    // Elegíveis · toque 2 tem prioridade (terminar conversa antes de abrir nova)
    // P4.5 · gate whatsapp_verificado=true · null (não checado) e false (não tem
    // WhatsApp) ficam de fora da fila do disparador.
    const nowIso = new Date().toISOString();
    const url2 = `${SB_URL}/rest/v1/va_leads?projeto_id=eq.${projeto_id}&funil_etapa=eq.contatado&pausado=is.false&whatsapp_verificado=is.true&proximo_toque_apos=lte.${encodeURIComponent(nowIso)}&toque2_em=is.null&order=aprovado_em.asc&limit=${orcamento}&select=*`;
    const url1 = `${SB_URL}/rest/v1/va_leads?projeto_id=eq.${projeto_id}&funil_etapa=eq.na_fila&pausado=is.false&whatsapp_verificado=is.true&order=aprovado_em.asc&limit=${orcamento}&select=*`;
    const [r2, r1] = await Promise.all([fetch(url2, { headers: H_SVC() }), fetch(url1, { headers: H_SVC() })]);
    const cand2 = (await r2.json()).map(l => ({ ...l, _toque: 2 }));
    const cand1 = (await r1.json()).map(l => ({ ...l, _toque: 1 }));
    let candidatos = [...cand2, ...cand1].slice(0, orcamento);
    if (!candidatos.length) { rProj.skipped = 'sem_elegivel'; resultado.projetos.push(rProj); continue; }

    // Filtra: precisa de WhatsApp/telefone + template aprovado do arquétipo do toque
    const arqIds = Array.from(new Set(candidatos.map(l => l.arquetipo_id).filter(Boolean)));
    const arqSel = arqIds.length ? `id=in.(${arqIds.join(',')})` : 'id=eq.00000000-0000-0000-0000-000000000000';
    const [arqR, tplR] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/va_arquetipos?${arqSel}&select=id,nome`, { headers: H_SVC() }),
      fetch(`${SB_URL}/rest/v1/va_cadencia_templates?projeto_id=eq.${projeto_id}&aprovado=eq.true&select=arquetipo_id,toque,corpo`, { headers: H_SVC() }),
    ]);
    const arqs = await arqR.json();
    const templates = await tplR.json();
    const arqById = Object.fromEntries(arqs.map(a => [a.id, a]));
    const tplKey = (aid, t) => `${aid}::${t}`;
    const tplByKey = Object.fromEntries(templates.map(t => [tplKey(t.arquetipo_id, t.toque), t]));

    let enviadosCiclo = 0;
    for (const lead of candidatos) {
      if (enviadosCiclo >= orcamento) break;
      const fone = String(lead.whatsapp || lead.telefone || '').replace(/\D/g,'');
      if (!fone) { rProj.disparos.push({ lead_id: lead.id, skipped: 'sem_fone' }); continue; }
      const tpl = tplByKey[tplKey(lead.arquetipo_id, lead._toque)];
      if (!tpl) { rProj.disparos.push({ lead_id: lead.id, skipped: 'sem_template_aprovado' }); continue; }
      const arq = arqById[lead.arquetipo_id];
      const out = await processarUmDisparo(projeto_id, lead, tpl, arq, cred, cfg.intervalo_toques_dias);
      rProj.disparos.push({ lead_id: lead.id, toque: lead._toque, ...out });
      if (out.ok) enviadosCiclo += 1;
      // Jitter entre envios do mesmo tick (proteção número). Pula em MOCK.
      if (!MOCK_ZAPI && enviadosCiclo < orcamento) {
        const jit = JITTER_MIN_MS + Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS));
        await new Promise(r => setTimeout(r, jit));
      }
    }
    rProj.enviados_ciclo = enviadosCiclo;
    rProj.teto_diario = cfg.teto_diario;
    rProj.usados_dia = jaHoje + enviadosCiclo;
    resultado.projetos.push(rProj);
  }

  return json(res, 200, resultado);
};
