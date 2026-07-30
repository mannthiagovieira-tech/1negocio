// /api/similares · Vercel Function
// Busca empresas similares a partir do CNPJ da empresa à venda (Kipflow
// POST /companies/v1/search · schema $filter mongo).
// 2 ações: preview (sonda) e importar (cria contato + debita lead_scrapper).
// Auth: JWT admin. Chave Kipflow: env var, nunca ecoada.
//
// Custo Kipflow ESCALA por resultado + por datasets:
//   basic+complete+address+debts (4)  ~ R$ 0,78 / resultado
//   todos os 7 datasets              ~ R$ 2,03 / resultado
// Preview usa APENAS ["basic"] (barato) — enriquecimento completo só
// acontece via /api/enriquecer no momento do import.

const SB_URL = process.env.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

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
  if (s.length === 2 && SIGLA_UF[s]) return SIGLA_UF[s];
  return s; // já vem extenso da Kipflow
}

function json(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json');
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
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.ok && (await r.json()) === true;
}

// Faixas por arquétipo (multiplicador sobre faturamento da empresa à venda)
const FAIXA_POR_ARQUETIPO = {
  A1: { min: 3,   max: 15,  uf_diferente: false, aviso: null },
  A2: { min: 0.8, max: 3,   uf_diferente: false, aviso: 'A2 = concorrente direto · confirme confirmar_a2_mesma_praca=true ou distancia_minima_km≥30' },
  A5: { min: 2,   max: 10,  uf_diferente: true,  aviso: 'A5 = expansão geográfica · exige UF diferente' },
};
function faixaPadrao(arq) {
  return FAIXA_POR_ARQUETIPO[arq] || { min: 0.5, max: 5, uf_diferente: false, aviso: null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'method not allowed' });

  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!tok) return json(res, 401, { ok: false, erro: 'não autorizado' });
  if (!(await ehAdmin(tok))) return json(res, 403, { ok: false, erro: 'não autorizado' });

  const KEY = process.env.KIPFLOW_API_KEY;
  if (!KEY) return json(res, 503, { ok: false, erro: 'KIPFLOW_API_KEY não configurada' });
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY não configurada' });

  let body;
  try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  const { action, projeto_id, arquetipo_codigo, filtros, cnpjs_importar } = body || {};
  if (!projeto_id) return json(res, 400, { ok: false, erro: 'projeto_id obrigatório' });

  const sbHeaders = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };

  const rP = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=cnpj,setor,cidade`, { headers: sbHeaders });
  const [proj] = await rP.json();
  if (!proj) return json(res, 404, { ok: false, erro: 'projeto não encontrado' });
  if (!proj.cnpj) return json(res, 400, { ok: false, erro: 'projeto sem CNPJ · preencha va_projetos.cnpj primeiro' });

  const cnpjSemente = String(proj.cnpj).replace(/\D/g, '');
  if (cnpjSemente.length !== 14) return json(res, 400, { ok: false, erro: 'CNPJ do projeto inválido' });

  const rE = await fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${cnpjSemente}&select=enriquecimento_bruto,estado`, { headers: sbHeaders });
  const [emp] = await rE.json();
  if (!emp || !emp.enriquecimento_bruto) {
    return json(res, 400, { ok: false, erro: 'empresa semente ainda não enriquecida · rode /api/enriquecer primeiro', cnpj_semente: cnpjSemente });
  }
  const data = emp.enriquecimento_bruto.data || emp.enriquecimento_bruto;
  const semCnae     = data.cnae_principal_classe || null;
  const semUf       = ufExtenso(data.uf || emp.estado);
  const semFat      = Number(data.faturamento) || 0;
  if (!semCnae) return json(res, 400, { ok: false, erro: 'semente sem cnae_principal_classe · enriquecimento incompleto' });

  const faixa = faixaPadrao(arquetipo_codigo);
  const filtrosFinais = {
    cnae_principal_classe: filtros?.cnae ?? semCnae,
    faturamento_min:       filtros?.faturamento_min ?? (semFat > 0 ? Math.round(semFat * faixa.min) : null),
    faturamento_max:       filtros?.faturamento_max ?? (semFat > 0 ? Math.round(semFat * faixa.max) : null),
    uf:                    filtros?.uf ?? semUf,
    uf_diferente:          filtros?.uf_diferente ?? faixa.uf_diferente,
    size:                  Math.min(Math.max(1, filtros?.size ?? 20), 100), // cap defensivo (custo)
  };

  const requerConfirmA2 = arquetipo_codigo === 'A2'
    && (filtros?.distancia_minima_km || 0) < 30
    && !filtros?.confirmar_a2_mesma_praca;

  // ── AÇÃO: preview ────────────────────────────────────────────
  if (action !== 'importar') {
    if (requerConfirmA2) {
      return json(res, 400, {
        ok: false, erro: 'a2_mesma_praca_requer_confirmacao',
        detalhe: 'A2 é concorrente direto. Passe filtros.confirmar_a2_mesma_praca=true ou distancia_minima_km≥30',
        filtros_aplicados: filtrosFinais,
      });
    }

    // Monta $filter mongo. Cada bloco vira um $or dentro do $and (padrão Kipflow).
    const andBlocks = [
      { $or: [{ situacao_cadastral: 'ATIVA' }] },
      { $or: [{ matriz: true }] },
      { $or: [{ cnae_principal_classe: filtrosFinais.cnae_principal_classe }] },
    ];
    if (filtrosFinais.faturamento_min != null) {
      andBlocks.push({ $or: [{ faturamento: { $gte: filtrosFinais.faturamento_min } }] });
    }
    if (filtrosFinais.faturamento_max != null) {
      andBlocks.push({ $or: [{ faturamento: { $lte: filtrosFinais.faturamento_max } }] });
    }
    if (filtrosFinais.uf) {
      if (filtrosFinais.uf_diferente) {
        andBlocks.push({ $or: [{ uf: { $nin: [filtrosFinais.uf] } }] });
      } else {
        andBlocks.push({ $or: [{ uf: filtrosFinais.uf }] });
      }
    }
    // Exclui próprio CNPJ (defesa dupla — filtramos de novo na saída)
    andBlocks.push({ $or: [{ cnpj: { $nin: [cnpjSemente] } }] });

    const kipBody = {
      $filter: { $and: andBlocks },
      $page: 0,
      $size: filtrosFinais.size,
      datasets: ['basic'], // preview mínimo · enriquecimento no import
    };

    let kip;
    try {
      const r = await fetch('https://api.kipflow.io/companies/v1/search', {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(kipBody),
      });
      const raw = await r.text();
      let parsed = null; try { parsed = JSON.parse(raw); } catch {}
      if (!r.ok) return json(res, 502, { ok: false, erro: `kipflow_http_${r.status}`, resposta_amostra: raw.slice(0, 2000), body_enviado: filtros?.debug ? kipBody : undefined });
      kip = parsed || {};
    } catch (e) {
      return json(res, 502, { ok: false, erro: 'kipflow_erro_rede', detalhe: String(e.message || e).slice(0, 200) });
    }

    const lista = Array.isArray(kip.data) ? kip.data : [];
    const amostra = lista
      .map(e => ({
        cnpj: String(e.cnpj || '').replace(/\D/g, ''),
        razao_social: e.razao_social || null,
        cnae_principal_classe: e.cnae_principal_classe || null,
        municipio: e.municipio || null,
        uf: e.uf || null,
        matriz: e.matriz,
      }))
      .filter(e => e.cnpj && e.cnpj !== cnpjSemente);

    return json(res, 200, {
      ok: true,
      cnpj_semente: cnpjSemente,
      arquetipo_codigo,
      filtros_aplicados: filtrosFinais,
      cost: kip.cost != null ? kip.cost : null,
      costFormatted: kip.costFormatted || null,
      pagination: kip.pagination || null,
      contagem_retornada: amostra.length,
      total_universo: kip.pagination?.total || null,
      amostra,
      aviso: faixa.aviso,
      raw_debug: filtros?.debug ? kip : undefined,
    });
  }

  // ── AÇÃO: importar ────────────────────────────────────────────
  if (!Array.isArray(cnpjs_importar) || cnpjs_importar.length === 0) {
    return json(res, 400, { ok: false, erro: 'cnpjs_importar (array) obrigatório na ação importar' });
  }

  const ref = `similares · ${arquetipo_codigo || 'sem_arquetipo'}`;
  const resultados = [];
  for (const cnpjRaw of cnpjs_importar) {
    const cnpj = String(cnpjRaw).replace(/\D/g, '');
    if (cnpj.length !== 14) { resultados.push({ cnpj: cnpjRaw, status: 'invalido' }); continue; }
    if (cnpj === cnpjSemente) { resultados.push({ cnpj, status: 'proprio_cnpj_ignorado' }); continue; }

    const rDup = await fetch(`${SB_URL}/rest/v1/va_contatos?projeto_id=eq.${projeto_id}&cnpj=eq.${cnpj}&select=id`, { headers: sbHeaders });
    const dupArr = await rDup.json();
    if (Array.isArray(dupArr) && dupArr.length > 0) {
      resultados.push({ cnpj, status: 'ja_no_projeto', contato_id: dupArr[0].id });
      continue;
    }

    let empresaId;
    const rEmp = await fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${cnpj}&select=id`, { headers: sbHeaders });
    const [empEx] = await rEmp.json();
    if (empEx) {
      empresaId = empEx.id;
    } else {
      const rIns = await fetch(`${SB_URL}/rest/v1/va_empresas`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ cnpj }),
      });
      const [empIns] = await rIns.json();
      empresaId = empIns?.id;
    }

    const rCt = await fetch(`${SB_URL}/rest/v1/va_contatos`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({
        projeto_id, empresa_id: empresaId, cnpj,
        origem: 'prospeccao', origem_detalhe: ref,
        arquetipo_codigo, trilha: 'fria', estagio: 'novo',
      }),
    });
    const arrCt = await rCt.json();
    const contatoId = Array.isArray(arrCt) ? arrCt[0]?.id : null;

    if (contatoId) {
      await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
        method: 'POST', headers: sbHeaders,
        body: JSON.stringify({
          p_projeto: projeto_id, p_tipo: 'lead_scrapper', p_qtd: 1,
          p_referencia: `${ref} · CNPJ ${cnpj}`, p_ciclo: null,
        }),
      });
      resultados.push({ cnpj, status: 'importado', contato_id: contatoId, empresa_id: empresaId });
    } else {
      resultados.push({ cnpj, status: 'erro_ao_criar_contato', detalhe: JSON.stringify(arrCt).slice(0, 300) });
    }
  }

  const importados = resultados.filter(r => r.status === 'importado').length;
  return json(res, 200, {
    ok: true,
    total_solicitados: cnpjs_importar.length,
    importados,
    ja_no_projeto: resultados.filter(r => r.status === 'ja_no_projeto').length,
    outros: resultados.filter(r => !['importado','ja_no_projeto'].includes(r.status)).length,
    resultados,
    debitados: importados,
  });
};
