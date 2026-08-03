// /api/va-extrair-leads · Vercel Function
// Extrai leads do Kipflow a partir do filtro de um arquétipo APROVADO.
// Paginação até 60 leads que passam nos pós-filtros (raio bruto máx 300).
// Antessala custa ZERO — cobrança acontece no /api/va-portao-leads.
// Auth: JWT admin. Chave Kipflow: env var, nunca ecoada ao front.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const KIP_KEY = process.env.KIPFLOW_API_KEY;

const TETO_LIQUIDO = 60;   // teto de leads que entram na antessala por extração
const TETO_BRUTO   = 100;  // teto de registros consultados na fonte (ajuste operador · economia Kipflow)
const PAGE_SIZE    = 100;  // tamanho máximo por página no Kipflow

const SIGLA_UF = {
  AC:'ACRE', AL:'ALAGOAS', AP:'AMAPA', AM:'AMAZONAS', BA:'BAHIA', CE:'CEARA',
  DF:'DISTRITO FEDERAL', ES:'ESPIRITO SANTO', GO:'GOIAS', MA:'MARANHAO',
  MT:'MATO GROSSO', MS:'MATO GROSSO DO SUL', MG:'MINAS GERAIS', PA:'PARA',
  PB:'PARAIBA', PR:'PARANA', PE:'PERNAMBUCO', PI:'PIAUI', RJ:'RIO DE JANEIRO',
  RN:'RIO GRANDE DO NORTE', RS:'RIO GRANDE DO SUL', RO:'RONDONIA', RR:'RORAIMA',
  SC:'SANTA CATARINA', SP:'SAO PAULO', SE:'SERGIPE', TO:'TOCANTINS',
};
function ufExtenso(v) {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  return SIGLA_UF[s] || s;
}

// SEBRAE (Indústria/Comércio) · usado quando arquétipo diz porte mas Kipflow não filtra
// ME até 4.8M, EPP até 300M no comércio (usamos 3M pra ficar conservador PME assessorada)
const PORTE_FAIXA = {
  ME:      { min: 0,       max: 360000 },
  EPP:     { min: 360000,  max: 4800000 },
  DEMAIS:  { min: 4800000, max: null    }, // sem teto
};

function norm(s) {
  return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
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

// Compila o filtro do arquétipo pro schema Kipflow.
// Retorna { andBlocks, filtroSnapshot, motivosPosFiltro } · null se não compilável.
function compilarFiltro(filtro) {
  const cnaes = Array.isArray(filtro?.cnaes) ? filtro.cnaes.filter(Boolean) : [];
  const porte = Array.isArray(filtro?.porte) ? filtro.porte.filter(Boolean) : [];
  const uf    = Array.isArray(filtro?.uf) ? filtro.uf.filter(Boolean).map(ufExtenso) : [];
  const fatMin = filtro?.faturamento_min != null ? Number(filtro.faturamento_min) : null;
  const fatMax = filtro?.faturamento_max != null ? Number(filtro.faturamento_max) : null;

  // Base compilável exige pelo menos 1 gate real (CNAE, UF, faturamento OU porte).
  if (!cnaes.length && !uf.length && fatMin == null && fatMax == null && !porte.length) return null;

  const andBlocks = [
    { $or: [{ situacao_cadastral: 'ATIVA' }] },
    { $or: [{ matriz: true }] },
  ];

  // CNAEs · classe (4-5 díg) ou subclasse (7 díg limpo). Vira $or interno.
  if (cnaes.length) {
    const orCnaes = [];
    for (const raw of cnaes) {
      const clean = String(raw).replace(/\D/g, '');
      if (clean.length >= 7) {
        orCnaes.push({ cnae_principal_subclasse: clean });
      } else if (clean.length >= 4) {
        orCnaes.push({ cnae_principal_classe: Number(clean.slice(0, 5)) });
      } else if (String(raw).match(/^\d+/)) {
        // "4711-3/02" formato · pega os 4 primeiros dígitos como classe
        const d = String(raw).replace(/\D/g,'').slice(0,4);
        if (d) orCnaes.push({ cnae_principal_classe: Number(d) });
      }
    }
    if (orCnaes.length) andBlocks.push({ $or: orCnaes });
  }

  // Faturamento · aplica direto + faixa derivada do porte se veio.
  let fMin = fatMin, fMax = fatMax;
  if (porte.length && (fMin == null && fMax == null)) {
    // pega o intervalo union do array de portes
    const faixas = porte.map(p => PORTE_FAIXA[p]).filter(Boolean);
    if (faixas.length) {
      fMin = Math.min(...faixas.map(f => f.min));
      const maxes = faixas.map(f => f.max).filter(x => x != null);
      fMax = maxes.length ? Math.max(...maxes) : null;
    }
  }
  if (fMin != null) andBlocks.push({ $or: [{ faturamento: { $gte: fMin } }] });
  if (fMax != null) andBlocks.push({ $or: [{ faturamento: { $lte: fMax } }] });

  // UF · lista aceita, converte pra extenso.
  if (uf.length) {
    const orUf = uf.map(u => ({ uf: u }));
    andBlocks.push({ $or: orUf });
  }

  // Pós-filtros aplicativos · slice 3.1: SÓ cidades corta (grátis, address vem
  // no basic). socio_idade e com_divida DEIXAM DE CORTAR — dado caro, aparece
  // "—" na antessala e vira acionável via botão "enriquecer" (sob demanda).
  const motivosPosFiltro = {
    cidades: Array.isArray(filtro?.cidades) ? filtro.cidades.map(norm).filter(Boolean) : [],
    // socio_idade / com_divida INFORMATIVOS (mostrar no filtro snapshot) · não cortam
    socio_idade_min_informativo: filtro?.socio_idade_min ?? null,
    socio_idade_max_informativo: filtro?.socio_idade_max ?? null,
    com_divida_informativo: filtro?.com_divida ?? null,
    raio_km_ignorado: filtro?.raio_km ?? null, // Kipflow não geocodifica · documentar
  };

  return {
    andBlocks,
    filtroSnapshot: { cnaes, porte, uf, fatMin, fMin, fMax, ...motivosPosFiltro },
    motivosPosFiltro,
  };
}

// Idade a partir de data_nascimento ISO
function idadeAnos(dnasc) {
  if (!dnasc) return null;
  const d = new Date(dnasc); if (isNaN(d)) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// Aplica pós-filtros aplicativos em UM registro Kipflow. Retorna true se passa.
// Slice 3.1: SÓ cidades corta (dado grátis vem em address · basic). socio_idade
// e com_divida dependem de datasets caros (partners/debts) que só são buscados
// sob demanda via /api/va-enriquecer-lead. Sem dado ≠ rejeitar.
function passaPosFiltro(reg, pf) {
  if (pf.cidades.length) {
    const cid = norm(reg.municipio || reg.cidade || '');
    if (!cid) return false;
    const bate = pf.cidades.some(c => cid.includes(c) || c.includes(cid));
    if (!bate) return false;
  }
  return true;
}

// Mapeia registro Kipflow → payload va_leads
function mapKipflowParaLead({ reg, projetoId, extracaoId, arqId, mesmaCidade }) {
  const cnpjLimpo = String(reg.cnpj || '').replace(/\D/g, '') || null;
  const socios = Array.isArray(reg.partners) ? reg.partners : (Array.isArray(reg.socios) ? reg.socios : null);
  return {
    projeto_id: projetoId,
    extracao_id: extracaoId,
    arquetipo_id: arqId,
    origem: 'extracao',
    fonte: 'kipflow',
    cnpj: cnpjLimpo,
    razao_social: reg.razao_social || null,
    nome_fantasia: reg.nome_fantasia || null,
    cidade: reg.municipio || reg.cidade || null,
    uf: reg.uf || null,
    cnae: reg.cnae_principal_subclasse || (reg.cnae_principal_classe != null ? String(reg.cnae_principal_classe) : null),
    porte: null, // Kipflow não retorna porte SEBRAE explícito
    faturamento_estimado: reg.faturamento != null ? Number(reg.faturamento) : null,
    socios: socios || null,
    telefone: reg.telefone || (Array.isArray(reg.telefones) && reg.telefones[0]) || null,
    whatsapp: null,
    email: reg.email || (Array.isArray(reg.emails) && reg.emails[0]) || null,
    dados_brutos: reg,
    same_city: !!mesmaCidade,
  };
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
  const { projeto_id, arquetipo_id, teto_bruto: teto_bruto_override, datasets: datasetsOverride } = body || {};
  if (!projeto_id || !arquetipo_id) return json(res, 400, { ok:false, erro:'projeto_id + arquetipo_id obrigatórios' });
  // Override do teto bruto (uso: sonda de custo · valor pequeno consome menos saldo Kipflow)
  const tetoBrutoEff = Math.max(1, Math.min(TETO_BRUTO, Number(teto_bruto_override) || TETO_BRUTO));

  const H = { apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' };

  // 1 · valida arquétipo (aprovado, do projeto)
  const arqR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${arquetipo_id}&select=id,projeto_id,status,nome,filtro`, { headers: H });
  const [arq] = await arqR.json();
  if (!arq || arq.projeto_id !== projeto_id) return json(res, 404, { ok:false, erro:'arquétipo não encontrado no projeto' });
  if (arq.status !== 'aprovado')             return json(res, 422, { ok:false, erro:'arquétipo precisa estar APROVADO pra extrair' });

  const compilado = compilarFiltro(arq.filtro || {});
  if (!compilado) return json(res, 422, { ok:false, erro:'arquétipo não extraível por base CNPJ · canal: campanha' });

  // 2 · pega cidade do ativo pra flag same_city
  const projR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=id,cidade,uf`, { headers: H });
  const [proj] = await projR.json();
  const cidadeAtivo = norm(proj?.cidade || '');

  // 3 · cria extração 'executando' com snapshot do filtro compilado
  const extIns = await fetch(`${SB_URL}/rest/v1/va_extracoes`, {
    method:'POST', headers: H,
    body: JSON.stringify({
      projeto_id, arquetipo_id, fonte:'kipflow', status:'executando',
      query: { compilado: compilado.filtroSnapshot, andBlocks: compilado.andBlocks },
    }),
  });
  const [ext] = await extIns.json();
  if (!ext) return json(res, 500, { ok:false, erro:'falha ao criar extração' });

  // 4 · lê CNPJs já existentes do projeto pra excluir de saída (defesa dupla ao UNIQUE)
  const jaR = await fetch(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${projeto_id}&cnpj=not.is.null&select=cnpj`, { headers: H });
  const jaLidos = await jaR.json();
  const jaCnpjs = new Set(jaLidos.map(x => x.cnpj));

  // 5 · paginação Kipflow · busca até tetoBrutoEff ou até acumular TETO_LIQUIDO
  const passados = []; // registros Kipflow que passaram pós-filtro
  let consultadosBruto = 0;
  let custoKipflowTotal = 0; // soma de parsed.cost por página · rastreabilidade
  let custoFormattedUlt = null;
  let erroKipflow = null;
  let page = 0;
  // Slice 3.1: extração magra · basic + address. Datasets caros (partners,
  // debts, contacts) vêm sob demanda via /api/va-enriquecer-lead.
  // P4.1: body.datasets sobrescreve (uso: sondar custo de datasets alternativos
  // como 'contacts' pra decidir se entra no padrão).
  const datasets = Array.isArray(datasetsOverride) && datasetsOverride.length
    ? datasetsOverride
    : ['basic','address'];

  try {
    while (consultadosBruto < tetoBrutoEff && passados.length < TETO_LIQUIDO) {
      const sizeAgora = Math.min(PAGE_SIZE, tetoBrutoEff - consultadosBruto);
      const kipBody = {
        $filter: { $and: compilado.andBlocks },
        $page: page,
        $size: sizeAgora,
        datasets,
      };
      const r = await fetch('https://api.kipflow.io/companies/v1/search', {
        method:'POST',
        headers:{ 'X-API-Key': KIP_KEY, 'Content-Type':'application/json', Accept:'application/json' },
        body: JSON.stringify(kipBody),
      });
      const raw = await r.text();
      let parsed = null; try { parsed = JSON.parse(raw); } catch {}
      if (!r.ok) { erroKipflow = `kipflow_http_${r.status}: ${raw.slice(0,300)}`; break; }

      const lista = Array.isArray(parsed?.data) ? parsed.data : [];
      consultadosBruto += lista.length;
      if (parsed?.cost != null) custoKipflowTotal += Number(parsed.cost) || 0;
      if (parsed?.costFormatted) custoFormattedUlt = parsed.costFormatted;
      if (lista.length === 0) break;

      for (const reg of lista) {
        if (passados.length >= TETO_LIQUIDO) break;
        if (!passaPosFiltro(reg, compilado.motivosPosFiltro)) continue;
        passados.push(reg);
      }
      // se retornou menos que o pedido, é fim de resultado
      if (lista.length < sizeAgora) break;
      page += 1;
    }
  } catch (e) {
    erroKipflow = 'rede: ' + String(e?.message || e).slice(0, 200);
  }

  if (erroKipflow) {
    await fetch(`${SB_URL}/rest/v1/va_extracoes?id=eq.${ext.id}`, {
      method:'PATCH', headers: H,
      body: JSON.stringify({ status:'erro', erro: erroKipflow, concluido_em: new Date().toISOString(), qtd_consultados_bruto: consultadosBruto }),
    });
    return json(res, 502, { ok:false, erro:'kipflow_falhou', detalhe: erroKipflow, extracao_id: ext.id });
  }

  // 6 · insere no va_leads · conta duplicados (409) e blacklist (row.status='bloqueado')
  let qtdNovos = 0, qtdDuplicados = 0, qtdBlacklist = 0;
  for (const reg of passados) {
    const cnpj = String(reg.cnpj || '').replace(/\D/g,'');
    if (cnpj && jaCnpjs.has(cnpj)) { qtdDuplicados++; continue; }
    const cidReg = norm(reg.municipio || reg.cidade || '');
    const mesmaCidade = !!(cidadeAtivo && cidReg && cidadeAtivo === cidReg);
    const payload = mapKipflowParaLead({ reg, projetoId: projeto_id, extracaoId: ext.id, arqId: arquetipo_id, mesmaCidade });
    const ins = await fetch(`${SB_URL}/rest/v1/va_leads`, {
      method:'POST', headers: H,
      body: JSON.stringify(payload),
    });
    if (ins.status === 409) { qtdDuplicados++; continue; }
    if (!ins.ok) {
      const t = await ins.text();
      // dedupe também pode vir como 400/23505 dependendo de config
      if (t.includes('duplicate') || t.includes('23505')) { qtdDuplicados++; continue; }
      // não interrompe · anota como duplicado defensivamente pra não quebrar leva
      qtdDuplicados++; continue;
    }
    const [row] = await ins.json();
    if (row?.blacklist_hit) qtdBlacklist++;
    else qtdNovos++;
    if (cnpj) jaCnpjs.add(cnpj);
  }

  // 7 · fecha extração · persiste custo + datasets usados
  await fetch(`${SB_URL}/rest/v1/va_extracoes?id=eq.${ext.id}`, {
    method:'PATCH', headers: H,
    body: JSON.stringify({
      status:'concluida',
      qtd_consultados_bruto: consultadosBruto,
      qtd_encontrados: passados.length,
      qtd_novos: qtdNovos,
      qtd_duplicados: qtdDuplicados,
      qtd_blacklist: qtdBlacklist,
      custo_kipflow_total: custoKipflowTotal,
      custo_kipflow_moeda: custoFormattedUlt ? (custoFormattedUlt.startsWith('R$') ? 'BRL' : 'USD') : null,
      datasets_usados: datasets,
      concluido_em: new Date().toISOString(),
    }),
  });

  return json(res, 200, {
    ok: true,
    extracao_id: ext.id,
    arquetipo: { id: arq.id, nome: arq.nome },
    qtd_consultados_bruto: consultadosBruto,
    qtd_encontrados: passados.length,
    qtd_novos: qtdNovos,
    qtd_duplicados: qtdDuplicados,
    qtd_blacklist: qtdBlacklist,
    teto_liquido: TETO_LIQUIDO,
    teto_bruto: tetoBrutoEff,
    // Custo Kipflow medido (soma dos parsed.cost das páginas) — para calibrar pricing
    custo_kipflow_total: custoKipflowTotal,
    custo_kipflow_por_bruto: consultadosBruto ? (custoKipflowTotal / consultadosBruto) : null,
    custo_kipflow_por_liquido: passados.length ? (custoKipflowTotal / passados.length) : null,
    custo_kipflow_formatted_ult: custoFormattedUlt,
    aviso_raio_ignorado: compilado.motivosPosFiltro.raio_km_ignorado
      ? 'raio_km ignorado: Kipflow não geocodifica'
      : null,
  });
};
