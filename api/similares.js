// /api/similares · Vercel Function
// Busca empresas similares a partir do CNPJ da empresa à venda.
// 2 ações: preview (sondagem, não cobra além do custo da consulta Kipflow)
// e importar (cria contatos com origem=prospeccao e debita lead_scrapper
// por empresa efetivamente importada).
//
// Auth: JWT admin (validado via va_is_admin). Chave Kipflow: env var.

const SB_URL = process.env.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

function json(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(body));
}

async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

async function ehAdmin(userToken) {
  if (!userToken) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + userToken, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!r.ok) return false;
  return (await r.json()) === true;
}

// Faixas por arquétipo (multiplicador sobre faturamento da empresa à venda)
const FAIXA_POR_ARQUETIPO = {
  A1: { min: 3,   max: 15,  uf_diferente: false, aviso: null },
  A2: { min: 0.8, max: 3,   uf_diferente: false, aviso: 'A2 = concorrente direto · confirme blacklist antes de importar' },
  A5: { min: 2,   max: 10,  uf_diferente: true,  aviso: 'A5 = expansão geográfica · exige UF diferente' },
};
function faixaPadrao(arq) {
  return FAIXA_POR_ARQUETIPO[arq] || { min: 0.5, max: 5, uf_diferente: false, aviso: null };
}

// Extrai fields da empresa Kipflow com fallback (mesma lógica de enriquecer)
function extraiSemente(data) {
  const g = (obj, ...keys) => {
    for (const k of keys) {
      const parts = k.split('.'); let cur = obj;
      for (const p of parts) { if (cur == null) break; cur = cur[p]; }
      if (cur != null && cur !== '') return cur;
    }
    return null;
  };
  return {
    cnae:              g(data, 'cnae_codigo', 'cnae.codigo', 'main_cnae.code', 'atividade_principal.codigo'),
    faturamento:       g(data, 'faturamento_estimado', 'porte_faturamento', 'revenue_estimated', 'porte'),
    uf:                g(data, 'estado', 'uf', 'address.state', 'endereco.uf'),
    cidade:            g(data, 'cidade', 'city', 'address.city', 'endereco.cidade'),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'method not allowed' });

  // Auth ANTES de tudo
  const auth = req.headers.authorization || '';
  const userToken = auth.replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return json(res, 401, { ok: false, erro: 'não autorizado' });
  if (!(await ehAdmin(userToken))) return json(res, 403, { ok: false, erro: 'não autorizado' });

  const KEY = process.env.KIPFLOW_API_KEY;
  if (!KEY) return json(res, 503, { ok: false, erro: 'KIPFLOW_API_KEY não configurada' });
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY não configurada' });

  let body;
  try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  const { action, projeto_id, arquetipo_codigo, filtros, cnpjs_importar } = body || {};
  if (!projeto_id) return json(res, 400, { ok: false, erro: 'projeto_id obrigatório' });

  const sbHeaders = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };

  // 1. Lê o projeto e sua empresa semente
  const rP = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=cnpj,setor,cidade`, { headers: sbHeaders });
  const [proj] = await rP.json();
  if (!proj) return json(res, 404, { ok: false, erro: 'projeto não encontrado' });
  if (!proj.cnpj) return json(res, 400, { ok: false, erro: 'projeto sem CNPJ · preencha em va_projetos.cnpj primeiro' });

  const cnpjSemente = String(proj.cnpj).replace(/\D/g, '');
  if (cnpjSemente.length !== 14) return json(res, 400, { ok: false, erro: 'CNPJ do projeto inválido' });

  // Enriquecimento da semente (se já existir em va_empresas)
  const rE = await fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${cnpjSemente}&select=enriquecimento_bruto,porte_faturamento,cnae_codigo,estado,cidade`, { headers: sbHeaders });
  const [emp] = await rE.json();

  let sementeInfo;
  if (emp && emp.enriquecimento_bruto) {
    const data = emp.enriquecimento_bruto.data || emp.enriquecimento_bruto;
    sementeInfo = { ...extraiSemente(data), fromCache: true };
    // fallback: usa coluna se extraiSemente devolveu null
    sementeInfo.cnae ||= emp.cnae_codigo || null;
    sementeInfo.uf   ||= emp.estado || null;
    sementeInfo.cidade ||= emp.cidade || null;
    sementeInfo.faturamento ||= emp.porte_faturamento || null;
  } else {
    return json(res, 400, {
      ok: false,
      erro: 'empresa semente ainda não enriquecida · rode /api/enriquecer com o CNPJ do projeto primeiro',
      cnpj_semente: cnpjSemente,
    });
  }

  // 2. Constrói filtros aplicados
  const faixa = faixaPadrao(arquetipo_codigo);
  const fatEmp = Number(sementeInfo.faturamento) || 0;
  const filtrosFinais = {
    cnae: filtros?.cnae ?? sementeInfo.cnae,
    faturamento_min: filtros?.faturamento_min ?? (fatEmp > 0 ? fatEmp * faixa.min : null),
    faturamento_max: filtros?.faturamento_max ?? (fatEmp > 0 ? fatEmp * faixa.max : null),
    uf: filtros?.uf ?? sementeInfo.uf,
    uf_diferente: filtros?.uf_diferente ?? faixa.uf_diferente,
    distancia_minima_km: filtros?.distancia_minima_km ?? 0,
    limit: filtros?.limit ?? 50,
  };

  // Se A2 e distância < 30km, exigir confirmação explícita
  const requerConfirmA2 = arquetipo_codigo === 'A2' && (filtrosFinais.distancia_minima_km || 0) < 30 && !filtros?.confirmar_a2_mesma_praca;

  // ── AÇÃO: preview (sonda Kipflow) ────────────────────────────
  if (action !== 'importar') {
    if (requerConfirmA2) {
      return json(res, 400, {
        ok: false,
        erro: 'a2_mesma_praca_requer_confirmacao',
        detalhe: 'A2 é concorrente direto. Passe filtros.confirmar_a2_mesma_praca=true ou aumente distancia_minima_km ≥ 30',
        filtros_aplicados: filtrosFinais,
      });
    }

    // Body Kipflow · defensivo com chaves prováveis
    const kipBody = {
      cnae: filtrosFinais.cnae,
      cnae_codigo: filtrosFinais.cnae,
      main_cnae: filtrosFinais.cnae,
      uf: filtrosFinais.uf_diferente ? undefined : filtrosFinais.uf,
      estado: filtrosFinais.uf_diferente ? undefined : filtrosFinais.uf,
      uf_diferente_de: filtrosFinais.uf_diferente ? filtrosFinais.uf : undefined,
      faturamento_min: filtrosFinais.faturamento_min,
      faturamento_max: filtrosFinais.faturamento_max,
      revenue_min: filtrosFinais.faturamento_min,
      revenue_max: filtrosFinais.faturamento_max,
      excluir_cnpj: [cnpjSemente],
      exclude_cnpj: [cnpjSemente],
      limit: filtrosFinais.limit,
      page_size: filtrosFinais.limit,
      datasets: ['basic', 'address'],
    };

    let kip;
    try {
      const r = await fetch('https://api.kipflow.io/companies/v1/search', {
        method: 'POST',
        headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(kipBody),
      });
      const raw = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch {}
      if (!r.ok) {
        return json(res, 502, { ok: false, erro: `kipflow_http_${r.status}`, resposta_amostra: raw.slice(0, 2000), body_enviado: filtros?.debug ? kipBody : undefined });
      }
      kip = parsed || {};
    } catch (e) {
      return json(res, 502, { ok: false, erro: 'kipflow_erro_rede', detalhe: String(e.message || e).slice(0, 200) });
    }

    // Extrai lista com fallback
    const lista = Array.isArray(kip.data) ? kip.data
      : Array.isArray(kip.results) ? kip.results
      : Array.isArray(kip.companies) ? kip.companies
      : Array.isArray(kip.empresas) ? kip.empresas
      : Array.isArray(kip.data?.results) ? kip.data.results
      : Array.isArray(kip.data?.companies) ? kip.data.companies
      : [];

    // Normaliza mínimo pra amostra
    const amostra = lista.slice(0, 10).map(e => ({
      cnpj: (e.cnpj || e.document || '').toString().replace(/\D/g, ''),
      razao_social: e.razao_social || e.legal_name || e.nome || null,
      nome_fantasia: e.nome_fantasia || e.trade_name || null,
      cidade: e.cidade || e.city || e.address?.city || null,
      estado: e.estado || e.uf || e.address?.state || null,
      faturamento: e.faturamento_estimado || e.porte_faturamento || e.revenue_estimated || e.porte || null,
      cnae: e.cnae_codigo || e.cnae?.codigo || e.main_cnae?.code || null,
    })).filter(e => e.cnpj && e.cnpj !== cnpjSemente); // dupla proteção anti-self

    return json(res, 200, {
      ok: true,
      cnpj_semente: cnpjSemente,
      arquetipo_codigo,
      filtros_aplicados: filtrosFinais,
      cost: kip.cost != null ? kip.cost : null,
      costFormatted: kip.costFormatted || null,
      contagem: lista.length,
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

    // Já existe contato pra este CNPJ neste projeto?
    const rDup = await fetch(`${SB_URL}/rest/v1/va_contatos?projeto_id=eq.${projeto_id}&cnpj=eq.${cnpj}&select=id`, { headers: sbHeaders });
    const dupArr = await rDup.json();
    if (Array.isArray(dupArr) && dupArr.length > 0) {
      resultados.push({ cnpj, status: 'ja_no_projeto', contato_id: dupArr[0].id });
      continue;
    }

    // Cria via va_registrar_contato · usa CNPJ como telefone_normalizado seria estranho.
    // Como va_registrar_contato precisa de telefone, e ainda não temos, criamos direto
    // em va_contatos e depois vinculamos empresa por CNPJ (upsert).
    // Passo 1: garante empresa
    let empresaId;
    const rEmp = await fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${cnpj}&select=id,enriquecido_em`, { headers: sbHeaders });
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

    // Passo 2: cria contato (sem telefone, mas com cnpj + empresa_id)
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

    // Passo 3: debita lead_scrapper por contato importado
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
      resultados.push({ cnpj, status: 'erro_ao_criar_contato' });
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
