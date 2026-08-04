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
const MOCK_ZAPI = process.env.VA_CADENCIA_MOCK === 'true';

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

// P4.5 · Z-API credencial (cachêada · 1 fetch por invocação da function).
// Mesma fonte do va-cadencia-tick: zapi_telefones (legado) primeiro,
// depois va_zapi_telefones (novo), depois env. Sem credencial → check pulado
// (whatsapp_verificado fica null · disparador filtra).
let _credCache = undefined;
async function pegarCredZapi() {
  if (_credCache !== undefined) return _credCache;
  const H = { apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/zapi_telefones?ativo=eq.true&limit=1&select=zapi_instance,zapi_token,zapi_client_token`, { headers: H });
    const [row] = await r.json();
    if (row?.zapi_instance && row?.zapi_token && row?.zapi_client_token) {
      _credCache = { instance: row.zapi_instance, token: row.zapi_token, clientToken: row.zapi_client_token };
      return _credCache;
    }
  } catch {}
  try {
    const r = await fetch(`${SB_URL}/rest/v1/va_zapi_telefones?tipo=eq.prospeccao&ativo=eq.true&limit=1&select=instancia,token,client_token`, { headers: H });
    const [row] = await r.json();
    if (row?.instancia && row?.token && row?.client_token) {
      _credCache = { instance: row.instancia, token: row.token, clientToken: row.client_token };
      return _credCache;
    }
  } catch {}
  _credCache = null;
  return null;
}

// P4.5 · phone-exists (SINGLE · GET). A Z-API não tem endpoint batch operacional
// (a doc menciona get-iswhatsapp-batch, mas retorna 405). Solução: N chamadas
// single com espaçamento de 2s. IMPORTANTE: Z-API adiciona o 9 do celular novo
// quando o input é fixo mas o número corresponde a um celular (ex: 551136215702
// input → 5511936215702 no WhatsApp). O outputPhone retornado é o número REAL.
// Em MOCK: número TERMINA em 9 → true, senão false.
async function checarWhatsAppUm(cred, phone) {
  const p = String(phone).replace(/\D/g,'');
  if (!p || p.length < 10) return { exists: false, outputPhone: null, lid: null };
  if (MOCK_ZAPI) return { exists: p.endsWith('9'), outputPhone: p, lid: null, mock: true };
  if (!cred) return { erro: 'sem_cred_zapi', exists: false };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const url = `https://api.z-api.io/instances/${cred.instance}/token/${cred.token}/phone-exists/${p}`;
    const r = await fetch(url, {
      method:'GET', signal: controller.signal,
      headers:{ 'client-token': cred.clientToken },
    });
    clearTimeout(t);
    const raw = await r.text();
    if (!r.ok) return { erro:`zapi_http_${r.status}: ${raw.slice(0,120)}`, exists: false };
    let d = {}; try { d = JSON.parse(raw); } catch {}
    return { exists: !!d.exists, outputPhone: d.phone || null, lid: d.lid || null };
  } catch (e) {
    return { erro:'zapi_rede: ' + String(e?.message||e).slice(0,100), exists: false };
  }
}

// Wrapper serial · espaça 2s entre chamadas pra não estressar a instância.
async function checarWhatsAppLote(cred, phones) {
  const uniq = [...new Set((phones || []).map(p => String(p).replace(/\D/g,'')).filter(x => x && x.length >= 10))];
  if (!uniq.length) return { ok:true, resultados: {} };
  if (!cred && !MOCK_ZAPI) return { ok:false, erro:'sem_cred_zapi', resultados: {} };
  const out = {};
  let anyErr = null;
  for (let i = 0; i < uniq.length; i++) {
    const p = uniq[i];
    const r = await checarWhatsAppUm(cred, p);
    if (r.erro) anyErr = r.erro;
    out[p] = { exists: r.exists, outputPhone: r.outputPhone, lid: r.lid };
    if (i < uniq.length - 1 && !MOCK_ZAPI) await new Promise(rs => setTimeout(rs, 2000));
  }
  return { ok: !anyErr || Object.values(out).some(x => x.exists), erro: anyErr, resultados: out, mock: MOCK_ZAPI || undefined };
}

// P4.4 Camada 0 · BrasilAPI · telefone cadastral da Receita Federal (custo zero).
// Endpoint público, sem auth, agrega Receita + Sintegra + CEP. Rate-limit ~3 req/s.
// Retorna { ok, telefone_cadastral, telefone_cadastral_2, email_cadastral, erro }.
// Timeout 6s (o endpoint pode demorar 1-3s por CNPJ novo).
async function buscarCadastral(cnpj) {
  const c = String(cnpj || '').replace(/\D/g,'');
  if (c.length !== 14) return { ok:false, erro:'cnpj_invalido' };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${c}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(t);
    if (r.status === 404) return { ok:false, erro:'cnpj_nao_encontrado' };
    if (r.status === 429) return { ok:false, erro:'brasilapi_rate_limit' };
    if (!r.ok) return { ok:false, erro:`brasilapi_http_${r.status}` };
    const d = await r.json();
    return {
      ok: true,
      telefone_cadastral:   String(d.ddd_telefone_1 || '').trim() || null,
      telefone_cadastral_2: String(d.ddd_telefone_2 || '').trim() || null,
      email_cadastral:      String(d.email || '').trim() || null,
    };
  } catch (e) {
    return { ok:false, erro: 'brasilapi_rede: ' + String(e?.message||e).slice(0,150) };
  }
}

// P4.4 Camada 0 · normaliza telefone BR cadastral e classifica celular vs fixo.
// Regras (2º dígito após DDD = 9 · pós-2012 celular tem 9 dígitos):
//   14 dig · começa "55" · length 13 = 55+DDD+9 → CELULAR (novo padrão)
//   11 dig · DDD(2)+9dig · 3º dígito '9' → CELULAR → retorna 55+11=13 dig
//   10 dig · DDD(2)+8dig → FIXO → retorna 55+10=12 dig (não whatsapp)
//   9 dig · começa "9" (algumas Receitas gravam sem DDD) → não usa (ambíguo)
//   qualquer outro comprimento → retorna raw como fixo (não whatsapp)
function normalizarFoneCadastral(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g,'');
  if (d.startsWith('0')) d = d.replace(/^0+/, ''); // remove código operadora antigo
  if (d.startsWith('55') && d.length >= 12) d = d.slice(2); // remove 55 se veio duplicado
  if (d.length === 11 && d[2] === '9') return { dig: '55'+d, tipo: 'celular' };
  if (d.length === 10) return { dig: '55'+d, tipo: 'fixo' };
  if (d.length >= 10 && d.length <= 13) return { dig: d.length < 12 ? '55'+d : d, tipo: 'fixo' };
  return null;
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

// P4.4 · nome comercial a partir do domínio (adoradoces.com.br → "adora doces")
// Serve como query alternativa no Apify · nome fantasia real bate melhor que razão jurídica.
function nomeComercialDoDominio(site) {
  const d = extrairDominio(site);
  if (!d) return null;
  const raiz = d.split('.')[0];
  // Quebra em palavras usando CamelCase, hifens, underscore, ou heurística de vogais
  if (!raiz || raiz.length < 3) return null;
  // Se já vem com separador (hyphen/underscore)
  if (/[-_]/.test(raiz)) return raiz.replace(/[-_]/g, ' ');
  // Se tem CamelCase, split lá
  if (/[a-z][A-Z]/.test(raiz)) return raiz.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  // Nada mais · devolve como está (ex: "adoradoces" · Apify aceita, provavelmente separa)
  return raiz;
}

// P4.4 · fetch de página com timeout curto + regex de telefone BR
// Aceita http/https · segue 1 redirect · timeout 5s por página · retorna string ou null
async function fetchPagina(url, timeoutMs = 5000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: controller.signal, redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; 1NegocioBot/1.0)', 'Accept': 'text/html,*/*;q=0.5' },
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(ct)) return null;
    const html = await r.text();
    return html.length > 500 ? html : null;
  } catch { return null; }
}

// Extrai (telefone, whatsapp) do HTML.
// wa.me/554899… ou api.whatsapp.com/send?phone=554899… ou padrões BR (XX) 9XXXX-XXXX
function extrairContatoDoHtml(html) {
  if (!html) return { telefone: null, whatsapp: null };
  const dedigit = s => String(s).replace(/\D/g,'');
  let whatsapp = null;
  let telefone = null;

  // 1) wa.me / api.whatsapp.com · quase sempre = celular BR
  const reWa = /(?:wa\.me\/|api\.whatsapp\.com\/send[^"'\s]*?phone=)(\+?55?\d{10,13})/gi;
  const mWa = reWa.exec(html);
  if (mWa) {
    const d = dedigit(mWa[1]);
    if (d.length >= 10 && d.length <= 13) whatsapp = d.length === 10 || d.length === 11 ? '55'+d : d;
  }

  // 2) tel: / callto:
  const reTel = /(?:href=["'](?:tel|callto):|<\s*a[^>]*(?:tel|callto):)([+\d\s\-().]{10,})/gi;
  const mTel = reTel.exec(html);
  if (mTel) {
    const d = dedigit(mTel[1]);
    if (d.length >= 10 && d.length <= 13) telefone = d.length < 12 ? '55'+d : d;
  }

  // 3) Padrão BR visível no texto: (XX) XXXXX-XXXX ou +55 XX XXXXX-XXXX
  if (!telefone) {
    const reBR = /(?:\+?55\s*)?\(?([1-9]{2})\)?\s*(9?\d{4})[\s\-]?(\d{4})/g;
    // Extrai só do texto visível (sem tags) pra reduzir falso positivo
    const texto = html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ');
    const m = reBR.exec(texto);
    if (m) {
      const d = m[1] + m[2] + m[3];
      if (d.length === 10 || d.length === 11) telefone = '55'+d;
    }
  }
  // Se whatsapp e telefone forem o mesmo número, mantém só whatsapp
  if (whatsapp && telefone && dedigit(whatsapp) === dedigit(telefone)) telefone = null;
  return { telefone, whatsapp };
}

// P4.4 · orquestra fetch: home → /contato → /fale-conosco. Primeira que trouxer, ganha.
async function buscarContatoNoSite(siteUrl) {
  const dominio = extrairDominio(siteUrl);
  if (!dominio) return { ok:false, motivo:'sem_dominio' };
  const bases = [`https://${dominio}`, `http://${dominio}`];
  const paths = ['', '/contato', '/fale-conosco'];
  for (const b of bases) {
    for (const p of paths) {
      const html = await fetchPagina(b + p, 5000);
      if (!html) continue;
      const r = extrairContatoDoHtml(html);
      if (r.telefone || r.whatsapp) return { ok:true, telefone: r.telefone, whatsapp: r.whatsapp, url_matched: b+p };
    }
    // Se a home falhou de vez, tenta próxima base (http)
  }
  return { ok:false, motivo:'sem_padrao_contato' };
}

// P4.4 · casar places · limiar auto 0,72 · dedupe por telefone reverso · bonus por endereço
function casarPlacesComLead(lead, places, siteKipflow) {
  const nomeLead = lead.nome_fantasia || lead.razao_social || '';
  const cidadeLead = normNome(lead.cidade || '');
  // Endereço vindo do Kipflow (dados_brutos.endereco/bairro/cep) pra bonus de match
  const endKipflow = normNome([lead.dados_brutos?.endereco, lead.dados_brutos?.bairro].filter(Boolean).join(' '));
  const cepKip = String(lead.dados_brutos?.cep || '').replace(/\D/g,'').slice(0,5); // 5 primeiros dígitos (região)

  let scored = places.map(p => {
    const nomeP = p.title || p.name || '';
    let s = diceSim(nomeLead, nomeP);
    if (siteKipflow && mesmoDominio(siteKipflow, p.website)) s += 0.20;
    // Bonus endereço · +0.15 se cidade bate E logradouro/CEP aproxima
    const addrP = normNome(p.formattedAddress || p.address || '');
    const cidadeP = normNome(p.city || '');
    if (cidadeLead && cidadeP && (cidadeLead === cidadeP || cidadeLead.includes(cidadeP) || cidadeP.includes(cidadeLead))) {
      if (endKipflow && addrP && endKipflow.split(' ').some(w => w.length >= 4 && addrP.includes(w))) s += 0.15;
      else if (cepKip && String(p.postalCode||'').replace(/\D/g,'').startsWith(cepKip)) s += 0.15;
      else s += 0.05; // cidade bate mas sem detalhe · pequeno bonus
    }
    // Penalidade se cidade diverge fortemente
    if (cidadeLead && cidadeP && !cidadeP.includes(cidadeLead) && !cidadeLead.includes(cidadeP)) s -= 0.05;
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
  }).filter(x => x.phone);

  // DEDUPE por telefone reverso · se 2 candidatos têm mesmo número, mantém só o de maior score
  const porFone = new Map();
  for (const c of scored) {
    const f = String(c.phone).replace(/\D/g,'');
    if (!f) continue;
    const prev = porFone.get(f);
    if (!prev || c.score > prev.score) porFone.set(f, c);
  }
  scored = [...porFone.values()].sort((a,b) => b.score - a.score);
  if (!scored.length) return { escolhido:null, candidatos:[], motivo:'sem_places_com_fone' };
  const top = scored[0];
  if (top.score >= 0.72) return { escolhido: top, candidatos: scored.slice(0,5), motivo:'auto_high_score' };
  if (top.score >= 0.50) return { escolhido: null, candidatos: scored.slice(0,5), motivo:'ambiguo' };
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
  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=in.${inList}&projeto_id=eq.${projeto_id}&select=id,cnpj,razao_social,nome_fantasia,cidade,dados_brutos,enriquecido_em,telefone,whatsapp,email,status,funil_etapa,whatsapp_verificado`, { headers: H });
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

    // ─── CASCATA (P4.4) · Kipflow → CADASTRAL(BrasilAPI) → SITE → Gmaps → sem_contato
    let campoTel = r.campos.telefone;
    let campoWa  = r.campos.whatsapp;
    let campoEmail = r.campos.email || null;
    let contatoFonte = (campoTel || campoWa) ? 'kipflow' : null;
    let gmapsEscolhido = null;
    let gmapsCandidatos = null;
    let gmapsMotivo = null;
    let siteFetchResultado = null;
    let cadastralResultado = null;

    // Descobre site vindo do Kipflow (online_presence)
    const siteK = (r.campos.site && typeof r.campos.site === 'object') ? r.campos.site.site
                : (typeof r.campos.site === 'string' ? r.campos.site : null);

    // CAMADA 0 · BrasilAPI · telefone cadastral (Receita Federal · custo zero)
    // Roda quando Kipflow não trouxe WhatsApp confirmado. Se cadastral trouxer celular,
    // salva como whatsapp e para. Se trouxer só fixo, salva telefone e SEGUE cascata
    // pra tentar achar celular via site/gmaps.
    if (!campoWa) {
      const bc = await buscarCadastral(cnpjLimpo);
      cadastralResultado = bc;
      if (bc.ok && (bc.telefone_cadastral || bc.telefone_cadastral_2)) {
        const t1 = normalizarFoneCadastral(bc.telefone_cadastral);
        const t2 = normalizarFoneCadastral(bc.telefone_cadastral_2);
        const celular = [t1, t2].find(x => x && x.tipo === 'celular');
        const fixo    = [t1, t2].find(x => x && x.tipo === 'fixo');
        if (celular) {
          campoWa  = celular.dig;
          if (!campoTel) campoTel = celular.dig;
          contatoFonte = 'cadastral';
        } else if (fixo && !campoTel) {
          campoTel = fixo.dig;
          contatoFonte = 'cadastral';
        }
      }
      if (bc.ok && bc.email_cadastral && !campoEmail) campoEmail = bc.email_cadastral;
    }

    // CAMADA 2 · fetch do site direto ANTES do Gmaps (só se ainda vazio e Kipflow trouxe site)
    if (!campoTel && !campoWa && siteK) {
      const s = await buscarContatoNoSite(siteK);
      siteFetchResultado = s;
      if (s.ok && (s.telefone || s.whatsapp)) {
        if (s.telefone) campoTel = s.telefone;
        if (s.whatsapp) {
          campoWa = s.whatsapp;
          if (!campoTel) campoTel = s.whatsapp; // pra ter sempre um telefone
        }
        contatoFonte = 'site';
      }
    }

    // Gmaps roda se ainda não tem WhatsApp (celular). Ter só fixo (cadastral) não
    // basta pra dispensar Gmaps · cascata deve tentar achar celular real.
    const precisaGmaps = !campoWa;
    if (precisaGmaps) {
      const nomeQ = l.nome_fantasia || l.razao_social || '';
      const cidQ  = l.cidade || '';
      // Query 1: nome jurídico + cidade
      // Query 2 (se site disponível): nome comercial do domínio + cidade
      const q1 = `${nomeQ} ${cidQ}`.trim();
      const nomeComercial = nomeComercialDoDominio(siteK);
      const q2 = nomeComercial ? `${nomeComercial} ${cidQ}`.trim() : null;
      const queries = [q1, q2].filter(q => q && q.length >= 4);
      // Roda queries em série · para na primeira que trouxer escolhido auto
      let totalPlaces = [];
      for (const q of queries) {
        const g = await buscarGmaps(q, 6);
        if (!g.ok) { gmapsMotivo = g.erro; continue; }
        placesApifyTotal += g.count || 0;
        custoApifyTotal += (g.count || 0) * 0.005;
        totalPlaces = totalPlaces.concat(g.places || []);
        // Roda match parcial pra ver se já achou · se sim, para de gastar
        const parcial = casarPlacesComLead(l, totalPlaces, siteK);
        if (parcial.escolhido) break;
      }
      const m = casarPlacesComLead(l, totalPlaces, siteK);
      gmapsCandidatos = m.candidatos;
      gmapsMotivo = m.motivo;
      if (m.escolhido && m.escolhido.phone) {
        gmapsEscolhido = m.escolhido;
        const foneNorm = String(m.escolhido.phone).replace(/\D/g,'');
        if (foneNorm.length >= 10) {
          campoTel = foneNorm;
          if (foneNorm.length === 11 || foneNorm.length === 13) campoWa = foneNorm;
          contatoFonte = 'gmaps';
        }
      }
    }

    // P4.5 · CHECK WhatsApp na cascata · roda em TODOS os telefones descobertos
    // (não só os promovidos a campoTel/campoWa · fixos cadastrais também vão).
    // Se check confirma WhatsApp num FIXO, ele vira o whatsapp final (PME com
    // WhatsApp Business no fixo é comum). Preferência: celular verificado >
    // fixo verificado > qualquer não verificado.
    const candidatosFone = [
      campoWa, campoTel,
      cadastralResultado?.ok ? cadastralResultado.telefone_cadastral : null,
      cadastralResultado?.ok ? cadastralResultado.telefone_cadastral_2 : null,
    ].filter(Boolean).map(x => String(x).replace(/\D/g,'')).filter(x => x.length >= 10);
    const cred = await pegarCredZapi();
    const chk = await checarWhatsAppLote(cred, candidatosFone);
    let whatsappVerificado = null;
    let verificadoEm = null;
    let numeroVerificado = null; // qual dos candidatos ficou verified
    if (chk.ok) {
      verificadoEm = new Date().toISOString();
      // Ordena candidatos por preferência: celular (11 dig com 3º='9') primeiro, depois fixos
      const ordenados = [...new Set(candidatosFone)].sort((a,b) => {
        const aCel = a.length === 11 && a[2] === '9'   ? 0 : a.length === 13 && a[4] === '9' ? 0 : 1;
        const bCel = b.length === 11 && b[2] === '9'   ? 0 : b.length === 13 && b[4] === '9' ? 0 : 1;
        return aCel - bCel;
      });
      for (const p of ordenados) {
        const rC = chk.resultados[p];
        if (rC?.exists) { whatsappVerificado = true; numeroVerificado = rC.outputPhone || p; break; }
      }
      // Se nenhum retornou true e teve resposta pra pelo menos 1 → false
      if (whatsappVerificado === null && Object.keys(chk.resultados).length > 0) whatsappVerificado = false;
      // Se check confirmou WhatsApp num número (mesmo fixo cadastral) → promove
      if (whatsappVerificado === true && numeroVerificado) {
        campoWa = numeroVerificado;
        if (!campoTel) campoTel = numeroVerificado;
      }
    }

    // funde dados_brutos existente com o enriquecimento + gmaps
    const brutoOut = Object.assign({}, l.dados_brutos || {}, {
      partners: r.campos.socios,
      divida: r.campos.divida_bruto,
    });
    // Enriquecimento inclui Kipflow + cadastral + site fetch + Gmaps + check WhatsApp
    const enrOut = Object.assign({}, r.campos, {
      cadastral: cadastralResultado,
      site_fetch: siteFetchResultado,
      gmaps: {
        escolhido: gmapsEscolhido,
        candidatos: gmapsCandidatos,
        motivo: gmapsMotivo,
        buscado: !!precisaGmaps,
      },
      whatsapp_check: {
        candidatos: candidatosFone,
        resultados: chk.resultados,
        erro: chk.erro || null,
        mock: chk.mock || false,
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
    if (!l.email && campoEmail)  patch.email = campoEmail;
    if (contatoFonte && !l.telefone && !l.whatsapp) patch.contato_fonte = contatoFonte;
    // P4.5 · check WhatsApp · null se check pulou (sem cred), true/false se rodou
    if (whatsappVerificado !== null) {
      patch.whatsapp_verificado = whatsappVerificado;
      patch.verificado_em = verificadoEm;
    }
    // Sem_contato final considera P4.5: telefone existe mas WhatsApp NÃO
    // confirmado → também vira sem_contato (não é elegível pra cadência).
    // Só marca automático se o check RODOU (whatsappVerificado !== null).
    const semContatoFinal = (!campoTel && !campoWa && !l.telefone && !l.whatsapp)
      || (whatsappVerificado === false && !l.whatsapp);
    if (semContatoFinal && l.status === 'aprovado' && (l.funil_etapa === 'na_fila' || !l.funil_etapa)) {
      patch.funil_etapa = 'sem_contato';
    }
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
      cadastral_ok: !!(cadastralResultado?.ok && (cadastralResultado.telefone_cadastral || cadastralResultado.telefone_cadastral_2)),
      gmaps_motivo: gmapsMotivo,
      gmaps_candidatos_n: gmapsCandidatos?.length || 0,
      whatsapp_verificado: whatsappVerificado,
      whatsapp_check_erro: chk.erro || null,
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
