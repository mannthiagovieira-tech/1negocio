// /api/va-enriquecer-lead · Vercel Function
// Slice 3.1 · enriquecimento SOB DEMANDA de leads em antessala.
// Busca datasets partners+debts pra 1 CNPJ e preenche sócios/idade/dívida
// no va_leads (custo Kipflow armazenado em custo_enriquecimento_kipflow).
// Aceita { projeto_id, lead_ids: [...] } · processa cada CNPJ e agrega custo.
// Sem débito ao cliente por ora (pricing PDCA).
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIP_KEY = process.env.KIPFLOW_API_KEY;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR = 'compass~crawler-google-places';

const DATASETS = 'partners,debts,online_presence';

// Score de similaridade nome (Dice/bigrama simples · 0..1)
function normNome(s) { return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ').trim(); }
function bigrams(s) { const r=[]; for (let i=0;i<s.length-1;i++) r.push(s.slice(i,i+2)); return r; }
function diceSim(a, b) {
  const A = normNome(a), B = normNome(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const bA = bigrams(A), bB = bigrams(B);
  if (!bA.length || !bB.length) return 0;
  const setB = new Map(); for (const x of bB) setB.set(x, (setB.get(x)||0)+1);
  let inter = 0;
  for (const x of bA) { const c = setB.get(x); if (c) { inter++; setB.set(x, c-1); } }
  return (2 * inter) / (bA.length + bB.length);
}
function extrairDominio(url) {
  if (!url) return null;
  try { return new URL(String(url).startsWith('http') ? url : 'http://'+url).hostname.replace(/^www\./,'').toLowerCase(); } catch { return null; }
}
function mesmoDominio(a, b) {
  const dA = extrairDominio(a), dB = extrairDominio(b);
  return !!(dA && dB && dA === dB);
}

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json');
  res.send(JSON.stringify(body));
}
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method:'POST',
    headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' },
    body:'{}',
  });
  return r.ok && (await r.json()) === true;
}

function idadeAnos(dnasc) {
  if (!dnasc) return null;
  const d = new Date(dnasc); if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// P4.3 · Consulta Apify Google Maps. Retorna { ok, cost_places, places[], erro }.
// Actor 'compass~crawler-google-places' síncrono. Custo debitado como
// 'lead_maps' pós-fato (mesmo padrão do slice12e). Timeout 90s (com jitter).
async function buscarGmaps(query, limite) {
  if (!APIFY_TOKEN) return { ok:false, erro:'APIFY_TOKEN ausente' };
  const controller = new AbortController();
  // Actor Apify run-sync bloqueia até terminar · o Cowork legado usa 120s.
  // Vercel Function suporta até 300s no plano atual · 120s cabe com margem
  // pra caso paralelizar 8 leads simultâneos.
  const t = setTimeout(() => controller.abort(), 120_000);
  try {
    const url = `https://api.apify.com/v2/acts/${APIFY_ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`;
    const r = await fetch(url, {
      method:'POST', signal: controller.signal,
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        searchStringsArray: [query],
        maxCrawledPlacesPerSearch: Math.max(1, Math.min(15, limite || 6)),
        language: 'pt-BR',
        countryCode: 'br',
        exportPlaceUrls: false,
        includeWebResults: false,
        scrapeContacts: true,
      }),
    });
    if (r.status === 401) return { ok:false, erro:'apify_token_invalido' };
    if (r.status === 429) return { ok:false, erro:'apify_rate_limit' };
    if (!r.ok) return { ok:false, erro:`apify_http_${r.status}` };
    const places = await r.json();
    return { ok:true, places: Array.isArray(places) ? places : [], count: Array.isArray(places) ? places.length : 0 };
  } catch (e) {
    return { ok:false, erro: 'apify_rede: ' + String(e?.message||e).slice(0,200) };
  } finally { clearTimeout(t); }
}

// Casa 1 lead contra placespossíveis. Retorna { escolhido, candidatos, motivo }.
// score = diceSim(nome) + bonus 0.20 se domínio bate com site vindo do Kipflow.
// Escolhido: score >= 0.80 (limiar auto) · candidatos: 0.55 <= score < 0.80.
function casarPlacesComLead(lead, places, siteKipflow) {
  const nomeLead = lead.nome_fantasia || lead.razao_social || '';
  const cidadeLead = normNome(lead.cidade || '');
  const scored = places.map(p => {
    const nomeP = p.title || p.name || '';
    let s = diceSim(nomeLead, nomeP);
    if (siteKipflow && mesmoDominio(siteKipflow, p.website)) s += 0.20;
    // penalidade se cidade Apify (address) diverge fortemente
    const addr = normNome(p.city || p.address || '');
    if (cidadeLead && addr && !addr.includes(cidadeLead) && !cidadeLead.includes(addr.split(' ')[0])) s -= 0.05;
    const fone = p.phoneUnformatted || p.phone || p.phoneNumber || null;
    return {
      score: Number(s.toFixed(3)),
      title: nomeP,
      phone: fone,
      website: p.website || null,
      address: p.formattedAddress || p.address || null,
      city: p.city || null,
      placeId: p.placeId || null,
    };
  }).filter(x => x.phone) // sem telefone, place é inútil pro nosso objetivo
    .sort((a,b) => b.score - a.score);
  if (!scored.length) return { escolhido:null, candidatos:[], motivo:'sem_places_com_fone' };
  const top = scored[0];
  if (top.score >= 0.80) return { escolhido: top, candidatos: scored.slice(0,5), motivo:'auto_high_score' };
  if (top.score >= 0.55) return { escolhido: null, candidatos: scored.slice(0,5), motivo:'ambiguo' };
  return { escolhido:null, candidatos: scored.slice(0,3), motivo:'score_baixo' };
}

// Consulta 1 CNPJ no Kipflow com datasets partners+debts+online_presence. Retorna { ok, cost, campos, erro }.
async function enriquecer(cnpj) {
  try {
    const r = await fetch(`https://api.kipflow.io/companies/v1/search?cnpj=${encodeURIComponent(cnpj)}&datasets=${DATASETS}`, {
      headers: { 'X-API-Key': KIP_KEY, Accept: 'application/json' },
    });
    const raw = await r.text();
    let parsed = null; try { parsed = JSON.parse(raw); } catch {}
    if (!r.ok) return { ok:false, erro: `kipflow_http_${r.status}: ${raw.slice(0,200)}` };
    const data = (parsed?.data && (Array.isArray(parsed.data) ? parsed.data[0] : parsed.data)) || parsed || {};
    const socios = Array.isArray(data.partners) ? data.partners
                 : Array.isArray(data.socios) ? data.socios : [];
    const idades = socios.map(s => idadeAnos(s.data_nascimento || s.nascimento)).filter(x => x != null);
    const divida = data.divida || data.debts || data.divida_ativa || null;
    let temDivida = null;
    if (divida && typeof divida === 'object') {
      const vals = [divida.total, divida.divida_ativa, divida.protestos, divida.tributaria].filter(x => typeof x === 'number');
      if (vals.length) temDivida = vals.some(v => v > 0);
    }
    // online_presence · Kipflow expõe telefones/emails/site em campos variados.
    // Aceita: telefone|telefones|phones · email|emails · site|website|sites.
    // Prefere primeiro item de arrays. Normaliza telefone (só dígitos).
    const arr = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);
    const norm = (t) => String(t||'').replace(/\D/g,'') || null;
    const telefones = [...arr(data.telefone), ...arr(data.telefones), ...arr(data.phones), ...arr(data.phone)]
      .map(t => typeof t === 'string' ? t : (t?.numero || t?.number || t?.value))
      .filter(Boolean);
    const emails = [...arr(data.email), ...arr(data.emails)]
      .map(e => typeof e === 'string' ? e : (e?.endereco || e?.address || e?.value))
      .filter(Boolean);
    const sites = [...arr(data.site), ...arr(data.sites), ...arr(data.website), ...arr(data.websites)]
      .filter(Boolean);
    const telefone = norm(telefones.find(t => norm(t)?.length >= 10));
    // Heurística WhatsApp: mesmo telefone (padrão brasileiro celular = 11 dígitos com DDD)
    const whatsapp = norm(telefones.find(t => norm(t)?.length === 11 || norm(t)?.length === 13));
    const email = emails[0] || null;
    const site = sites[0] || null;

    return {
      ok: true,
      cost: parsed?.cost != null ? Number(parsed.cost) : 0,
      costFormatted: parsed?.costFormatted || null,
      campos: {
        socios: socios.length ? socios : null,
        idade_min_socios: idades.length ? Math.min(...idades) : null,
        idade_max_socios: idades.length ? Math.max(...idades) : null,
        com_divida: temDivida,
        divida_bruto: divida || null,
        telefone, whatsapp, email, site,
        telefones_todos: telefones.map(norm).filter(Boolean),
      },
    };
  } catch (e) {
    return { ok:false, erro: 'rede: ' + String(e.message||e).slice(0,200) };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return json(res, 405, { ok:false });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!KIP_KEY)   return json(res, 503, { ok:false, erro:'KIPFLOW_API_KEY ausente' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
  const { projeto_id, lead_ids, force_redebit } = body || {};
  if (!projeto_id || !Array.isArray(lead_ids) || !lead_ids.length) {
    return json(res, 400, { ok:false, erro:'projeto_id + lead_ids[] obrigatórios' });
  }

  const H = { apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' };

  const inList = encodeURIComponent(`(${lead_ids.join(',')})`);
  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=in.${inList}&projeto_id=eq.${projeto_id}&select=id,cnpj,razao_social,dados_brutos,enriquecido_em,telefone,whatsapp,email`, { headers: H });
  const leads = await lR.json();
  if (!Array.isArray(leads) || !leads.length) return json(res, 404, { ok:false, erro:'nenhum lead encontrado no projeto' });

  // Processa leads em PARALELO (Promise.all) pra caber no timeout 5min da Vercel.
  // Cada lead faz 1 chamada Kipflow (~2-5s) + até 1 Apify (~20-60s) · N leads em
  // paralelo terminam em ~max_lead + overhead. 8 leads em ~90s é confortável.
  let custoTotal = 0;      // custo Kipflow acumulado (partners+debts+online_presence)
  let custoApifyTotal = 0; // custo Apify acumulado (lead_maps)
  let placesApifyTotal = 0;
  const okAcc = []; const falhasAcc = [];
  async function processarLead(l) {
    const cnpjLimpo = String(l.cnpj || '').replace(/\D/g,'');
    if (!cnpjLimpo) { falhasAcc.push({ id: l.id, motivo:'sem_cnpj' }); return; }
    // GUARD · lead já enriquecido não é serviço novo · re-execução é retry grátis
    // (a menos que o operador force com body force_redebit=true)
    const jaEnriquecido = !!l.enriquecido_em;
    const deveDebitar   = force_redebit === true || !jaEnriquecido;
    const r = await enriquecer(cnpjLimpo);
    if (!r.ok) { falhasAcc.push({ id: l.id, motivo: r.erro }); return; }
    custoTotal += r.cost || 0;

    // ─── CASCATA APIFY (P4.3) · só se Kipflow deixou telefone/whatsapp vazio
    let campoTel = r.campos.telefone;
    let campoWa  = r.campos.whatsapp;
    let contatoFonte = (campoTel || campoWa) ? 'kipflow' : null;
    let gmapsEscolhido = null;
    let gmapsCandidatos = null;
    let gmapsMotivo = null;
    const precisaGmaps = !l.telefone && !l.whatsapp && !campoTel && !campoWa;
    if (precisaGmaps) {
      const nomeQ = l.nome_fantasia || l.razao_social || '';
      const cidQ  = l.cidade || '';
      const siteK = (r.campos.site && typeof r.campos.site === 'object') ? r.campos.site.site
                  : (typeof r.campos.site === 'string' ? r.campos.site : null);
      const q = `${nomeQ} ${cidQ}`.trim();
      if (q.length >= 4) {
        const g = await buscarGmaps(q, 6);
        if (g.ok) {
          placesApifyTotal += g.count || 0;
          // Custo lead_maps é por PLACE retornado (padrão do slice12e)
          const custoUnit = 0.005;
          custoApifyTotal += (g.count || 0) * custoUnit;
          const m = casarPlacesComLead(l, g.places || [], siteK);
          gmapsCandidatos = m.candidatos;
          gmapsMotivo = m.motivo;
          if (m.escolhido && m.escolhido.phone) {
            gmapsEscolhido = m.escolhido;
            const foneNorm = String(m.escolhido.phone).replace(/\D/g,'');
            if (foneNorm.length >= 10) {
              campoTel = foneNorm;
              // Heurística: 11-13 dígitos = celular BR (whatsapp provável)
              if (foneNorm.length === 11 || foneNorm.length === 13) campoWa = foneNorm;
              contatoFonte = 'gmaps';
            }
          }
        } else {
          gmapsMotivo = g.erro;
        }
      } else {
        gmapsMotivo = 'query_curta';
      }
    }

    // funde dados_brutos existente com o enriquecimento + gmaps
    const brutoOut = Object.assign({}, l.dados_brutos || {}, {
      partners: r.campos.socios,
      divida: r.campos.divida_bruto,
    });
    // Enriquecimento inclui Kipflow + Gmaps (candidatos ou escolhido)
    const enrOut = Object.assign({}, r.campos, {
      gmaps: {
        escolhido: gmapsEscolhido,
        candidatos: gmapsCandidatos,
        motivo: gmapsMotivo,
        buscado: !!precisaGmaps,
      },
    });
    // Não sobrescreve valores prévios
    const patch = {
      enriquecido_em: new Date().toISOString(),
      custo_enriquecimento_kipflow: r.cost || 0,
      socios: r.campos.socios,
      dados_brutos: brutoOut,
      dados_enriquecimento: enrOut,
    };
    if (!l.telefone && campoTel) patch.telefone = campoTel;
    if (!l.whatsapp && campoWa)  patch.whatsapp = campoWa;
    if (!l.email && r.campos.email) patch.email = r.campos.email;
    if (contatoFonte && !l.telefone && !l.whatsapp) patch.contato_fonte = contatoFonte;
    const upd = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${l.id}`, {
      method:'PATCH', headers: H, body: JSON.stringify(patch),
    });
    if (!upd.ok) { falhasAcc.push({ id: l.id, motivo: `update: ${(await upd.text()).slice(0,200)}` }); return; }
    // Débito · 1 unidade de 'lead_enriquecimento' por lead com sucesso
    // Guard: só se ainda não foi enriquecido (ou force_redebit).
    if (deveDebitar) {
      try {
        const shortL = String(l.id).slice(0,8);
        const dR = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
          method:'POST', headers: H,
          body: JSON.stringify({
            p_projeto: projeto_id, p_tipo: 'lead_enriquecimento', p_qtd: 1,
            p_referencia: `enriq:${shortL}${force_redebit?' · FORCED':''}`, p_ciclo: null,
          }),
        });
        if (!dR.ok) console.error('va_debitar enriquecimento falhou:', await dR.text());
      } catch (e) { console.error('va_debitar erro:', e); }
    }
    // v3 · lead_maps foi ABSORVIDO em lead_enriquecimento (decisão operador).
    // O tipo continua na tabela pro Cowork · MANDATO não debita mais separado.
    okAcc.push({
      id: l.id,
      idade_min: r.campos.idade_min_socios, idade_max: r.campos.idade_max_socios,
      com_divida: r.campos.com_divida, cost_kipflow: r.cost,
      telefone_final: campoTel || l.telefone || null,
      whatsapp_final: campoWa  || l.whatsapp || null,
      contato_fonte: contatoFonte,
      gmaps_motivo: gmapsMotivo,
      gmaps_candidatos_n: gmapsCandidatos?.length || 0,
      debitado: deveDebitar,
      retry_sem_debito: !deveDebitar && jaEnriquecido,
    });
  }
  // Batches de 3 leads em paralelo · Apify run-sync não aguenta muita concorrência
  // (empíricamente 8 concurrent → 6 timeouts). 3 concurrent × ~90s por batch ≈ 90-180s total.
  const BATCH = 3;
  for (let i = 0; i < leads.length; i += BATCH) {
    await Promise.all(leads.slice(i, i + BATCH).map(processarLead));
  }
  const ok = okAcc; const falhas = falhasAcc;

  return json(res, 200, {
    ok: true,
    enriquecidos: ok.length,
    falhas: falhas.length ? falhas : undefined,
    custo_kipflow_total: custoTotal,
    custo_kipflow_por_lead: ok.length ? Number((custoTotal / ok.length).toFixed(3)) : null,
    custo_apify_total: Number(custoApifyTotal.toFixed(3)),
    custo_apify_por_lead: ok.length ? Number((custoApifyTotal / ok.length).toFixed(4)) : null,
    places_apify_total: placesApifyTotal,
    custo_total_sessao: Number((custoTotal + custoApifyTotal).toFixed(3)),
    resultados: ok,
  });
};
