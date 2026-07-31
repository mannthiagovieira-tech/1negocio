// /api/enriquecer · Vercel Function
// ESTRATÉGIA · BrasilAPI primeiro (gratuita, sem chave).
// Kipflow é OPT-IN (body.com_kipflow=true) porque cobra R$ 0,39/consulta.
//
// Fluxo:
//   1. Auth admin (via va_is_admin)
//   2. BrasilAPI: razão, fantasia, endereço, CNAE, situação cadastral, capital,
//      porte (id/descricao), quadro societário (nome+faixa_etaria+data_entrada),
//      data_inicio_atividade
//   3. Se com_kipflow=true: chama Kipflow para faturamento numérico, funcionários,
//      dívida, presença online — merge no que BrasilAPI já trouxe.
//   4. Upsert va_empresas · marca `fonte` no retorno pra UI mostrar procedência.
//
// Segurança: KIPFLOW_API_KEY vive só em env do Vercel. NUNCA é retornada.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;

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
  const d = await r.json();
  return d === true;
}

// UF codes mapping — BrasilAPI devolve `uf` já como sigla (SC, SP…).
// Kipflow devolve extenso ("SANTA CATARINA") ou sigla.
const UF_MAP = {
  'ACRE':'AC','ALAGOAS':'AL','AMAPA':'AP','AMAZONAS':'AM','BAHIA':'BA','CEARA':'CE',
  'DISTRITO FEDERAL':'DF','ESPIRITO SANTO':'ES','GOIAS':'GO','MARANHAO':'MA','MATO GROSSO':'MT',
  'MATO GROSSO DO SUL':'MS','MINAS GERAIS':'MG','PARA':'PA','PARAIBA':'PB','PARANA':'PR',
  'PERNAMBUCO':'PE','PIAUI':'PI','RIO DE JANEIRO':'RJ','RIO GRANDE DO NORTE':'RN',
  'RIO GRANDE DO SUL':'RS','RONDONIA':'RO','RORAIMA':'RR','SANTA CATARINA':'SC','SAO PAULO':'SP',
  'SERGIPE':'SE','TOCANTINS':'TO',
};
function normalizarUF(uf) {
  if (!uf || typeof uf !== 'string') return null;
  const t = uf.trim().toUpperCase();
  if (t.length === 2) return t;
  return UF_MAP[t] || t.slice(0, 2);
}

// ── BrasilAPI ───────────────────────────────────────────────────
async function buscarBrasilAPI(cnpj) {
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) return { ok: false, status: r.status };
    const d = await r.json();
    // Situação cadastral · BrasilAPI devolve numérico (2=ATIVA, 3=SUSPENSA, 4=INAPTA, 8=BAIXADA)
    const sitMap = { 1: 'NULA', 2: 'ATIVA', 3: 'SUSPENSA', 4: 'INAPTA', 8: 'BAIXADA' };
    const situacao = sitMap[d.situacao_cadastral] || (d.descricao_situacao_cadastral || String(d.situacao_cadastral || ''));
    const socios = Array.isArray(d.qsa) ? d.qsa.map(s => ({
      nome: s.nome_socio,
      qualificacao: s.qualificacao_socio,
      faixa_etaria: s.faixa_etaria,
      data_entrada: s.data_entrada_sociedade,
      cnpj_cpf: s.cnpj_cpf_do_socio,
      pais: s.pais,
    })) : null;
    return {
      ok: true,
      campos: {
        razao_social: d.razao_social || null,
        nome_fantasia: d.nome_fantasia || null,
        cidade: d.municipio || null,
        estado: normalizarUF(d.uf),
        cnae_codigo: d.cnae_fiscal ? String(d.cnae_fiscal) : null,
        cnae_descricao: d.cnae_fiscal_descricao || null,
        situacao_cadastral: situacao,
        porte_categoria: (d.porte && typeof d.porte === 'object' ? d.porte.descricao : d.porte) || null,
        capital_social: typeof d.capital_social === 'number' ? d.capital_social : null,
        data_abertura: d.data_inicio_atividade || null,
        socios,
        // BrasilAPI não tem: faturamento numérico, funcionários, dívida, presença online
      },
      bruto: d,
    };
  } catch (e) {
    return { ok: false, erro: String(e.message || e).slice(0, 200) };
  }
}

// ── Kipflow ─────────────────────────────────────────────────────
async function buscarKipflow(cnpj, KEY) {
  try {
    const r = await fetch(`https://api.kipflow.io/companies/v1/search?cnpj=${cnpj}&datasets=complete,partners,address,online_presence,debts`, {
      headers: { 'X-API-Key': KEY, Accept: 'application/json' },
    });
    const status = r.status;
    const raw = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* keep raw */ }
    if (!r.ok) return { ok: false, status, amostra: raw.slice(0, 300) };
    const data = (parsed && parsed.data) || parsed || {};
    const divida = data.divida;
    const capRaw = data.capital_social;
    const funcRaw = data.funcionarios;
    const faturamentoRaw = data.faturamento;
    const porteRaw = data.porte;
    const socios = data.socios || data.partners || data.quadro_societario;
    return {
      ok: true,
      cost: parsed?.cost != null ? parsed.cost : null,
      costFormatted: parsed?.costFormatted || null,
      campos: {
        // Enriquecimentos DE VERDADE do Kipflow (o que BrasilAPI não tem):
        porte_faturamento: (typeof faturamentoRaw === 'number' && faturamentoRaw > 0) ? faturamentoRaw
          : (typeof faturamentoRaw === 'string' && faturamentoRaw.trim() !== '')
            ? (Number(String(faturamentoRaw).replace(/[^\d.,-]/g, '').replace(',', '.')) || null)
            : null,
        porte_categoria: typeof porteRaw === 'string' ? porteRaw : null,
        faixa_faturamento: typeof data.faixa_faturamento_grupo === 'string' ? data.faixa_faturamento_grupo : null,
        faixa_funcionarios: typeof data.faixa_funcionarios_grupo === 'string' ? data.faixa_funcionarios_grupo : null,
        funcionarios: Number.isInteger(funcRaw) ? funcRaw
          : (typeof funcRaw === 'string' && /^\d+$/.test(funcRaw)) ? parseInt(funcRaw, 10) : null,
        segmento: typeof data.segmento === 'string' ? data.segmento : null,
        ramo_atividade: typeof data.ramo_de_atividade === 'string' ? data.ramo_de_atividade : null,
        site: (data.sites && data.sites[0]) || data.site || data.website || null,
        instagram: data.instagram || data.social?.instagram || null,
        linkedin: data.linkedin_url || data.linkedin || null,
        // Dívida
        divida_total:              (divida && typeof divida === 'object' && isFinite(Number(divida.total))) ? Number(divida.total) : null,
        divida_previdenciaria:     (divida && typeof divida === 'object' && isFinite(Number(divida.total_previdenciaria))) ? Number(divida.total_previdenciaria) : null,
        divida_nao_previdenciaria: (divida && typeof divida === 'object' && isFinite(Number(divida.total_nao_previdenciaria))) ? Number(divida.total_nao_previdenciaria) : null,
        divida_fgts:               (divida && typeof divida === 'object' && isFinite(Number(divida.total_fgts))) ? Number(divida.total_fgts) : null,
        divida_bruto: divida && typeof divida === 'object' ? divida : null,
        divida_consultada_em: new Date().toISOString(),
        // Capital social · pode diferir da BrasilAPI (Kipflow mais recente às vezes)
        capital_social_kipflow: (typeof capRaw === 'number' && isFinite(capRaw)) ? capRaw
          : (typeof capRaw === 'string' && !isNaN(Number(capRaw))) ? Number(capRaw) : null,
        // Sócios do Kipflow · fallback só se BrasilAPI falhou
        socios_kipflow: Array.isArray(socios) ? socios : null,
      },
      bruto: parsed || {},
    };
  } catch (e) {
    return { ok: false, erro: String(e.message || e).slice(0, 200) };
  }
}

// ── Handler ─────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'method not allowed' });

  const auth = req.headers.authorization || '';
  const userToken = auth.replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return json(res, 401, { ok: false, erro: 'não autorizado' });
  const admin = await ehAdmin(userToken);
  if (!admin) return json(res, 403, { ok: false, erro: 'não autorizado' });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel' });

  let body;
  try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  let { empresa_id, cnpj, projeto_id, com_kipflow } = body || {};
  cnpj = (cnpj || '').replace(/\D/g, '');

  const sbHeaders = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };
  if (empresa_id && !cnpj) {
    const r = await fetch(`${SB_URL}/rest/v1/va_empresas?id=eq.${empresa_id}&select=cnpj,enriquecido_em,enriquecido_por`, { headers: sbHeaders });
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return json(res, 404, { ok: false, erro: 'empresa não encontrada' });
    cnpj = (arr[0].cnpj || '').replace(/\D/g, '');
    // Só bloqueia se JÁ tem Kipflow (caro) · ou se BrasilAPI e user não pediu Kipflow
    const jaTemKipflow = String(arr[0].enriquecido_por || '').includes('kipflow');
    if (arr[0].enriquecido_em && !com_kipflow) return json(res, 200, { ok: true, ja_enriquecida: true, empresa_id, fonte_previa: arr[0].enriquecido_por });
    if (arr[0].enriquecido_em && com_kipflow && jaTemKipflow) return json(res, 200, { ok: true, ja_enriquecida: true, empresa_id, fonte_previa: arr[0].enriquecido_por });
  }
  if (!cnpj || cnpj.length !== 14) return json(res, 400, { ok: false, erro: 'cnpj inválido (14 dígitos)' });

  // ETAPA 1 · BrasilAPI (sempre roda, é grátis e rápido)
  const ba = await buscarBrasilAPI(cnpj);
  if (!ba.ok) return json(res, 502, { ok: false, erro: 'brasilapi_falhou', status: ba.status, detalhe: ba.erro });

  let campos = { ...ba.campos };
  const fontes = { brasilapi: Object.keys(ba.campos).filter(k => ba.campos[k] != null) };
  let brutos = { brasilapi: ba.bruto };
  let costKip = null, costFormattedKip = null, kipErr = null;

  // ETAPA 2 · Kipflow (só se explicitamente pedido)
  if (com_kipflow) {
    const KEY = process.env.KIPFLOW_API_KEY;
    if (!KEY) {
      kipErr = { erro: 'kipflow_key_ausente', detalhe: 'Configure KIPFLOW_API_KEY em Vercel' };
    } else {
      const kip = await buscarKipflow(cnpj, KEY);
      if (kip.ok) {
        // Merge: Kipflow enche o que BrasilAPI não tem, sem sobrescrever
        for (const [k, v] of Object.entries(kip.campos)) {
          if (v != null && (campos[k] == null || (typeof campos[k] === 'string' && !campos[k].trim()))) {
            campos[k] = v;
            fontes.kipflow = fontes.kipflow || [];
            fontes.kipflow.push(k);
          }
        }
        // Sócios: se BrasilAPI vazio, usa Kipflow
        if ((!campos.socios || (Array.isArray(campos.socios) && campos.socios.length === 0)) && Array.isArray(campos.socios_kipflow)) {
          campos.socios = campos.socios_kipflow;
          fontes.kipflow = fontes.kipflow || [];
          fontes.kipflow.push('socios');
        }
        delete campos.socios_kipflow;
        costKip = kip.cost; costFormattedKip = kip.costFormatted;
        brutos.kipflow = kip.bruto;
      } else {
        kipErr = { erro: 'kipflow_http_' + kip.status, amostra: kip.amostra };
      }
    }
  }

  // Upsert va_empresas
  const patch = {
    ...campos,
    cnpj,
    enriquecido_em: new Date().toISOString(),
    enriquecido_por: com_kipflow ? (kipErr ? 'brasilapi (kipflow_falhou)' : 'brasilapi+kipflow') : 'brasilapi',
    enriquecimento_bruto: brutos,
    atualizado_em: new Date().toISOString(),
  };
  // Remove chaves internas que não são colunas da tabela
  delete patch.socios_kipflow;
  delete patch.capital_social_kipflow;

  let empresa = null, upErrText = null, upStatus = null;
  if (empresa_id) {
    const up = await fetch(`${SB_URL}/rest/v1/va_empresas?id=eq.${empresa_id}`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    upStatus = up.status;
    if (!up.ok) upErrText = (await up.text()).slice(0, 300);
    else { const arr = await up.json(); empresa = Array.isArray(arr) ? arr[0] : arr; }
  } else {
    const up = await fetch(`${SB_URL}/rest/v1/va_empresas?on_conflict=cnpj`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(patch),
    });
    upStatus = up.status;
    if (!up.ok) upErrText = (await up.text()).slice(0, 300);
    else { const arr = await up.json(); empresa = Array.isArray(arr) ? arr[0] : arr; }
  }
  if (upErrText) {
    return json(res, 500, { ok: false, erro: 'upsert_falhou', http: upStatus, detalhe: upErrText, campos_extraidos: campos, fontes });
  }

  // Debita crédito só se Kipflow rodou de verdade
  if (com_kipflow && !kipErr && projeto_id && empresa?.id) {
    try {
      await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          p_projeto: projeto_id, p_tipo: 'lead_scrapper', p_qtd: 1,
          p_referencia: `Enriquecimento Kipflow CNPJ ${cnpj}`, p_ciclo: null,
        }),
      });
    } catch (_) { /* não bloqueia */ }
  }

  return json(res, 200, {
    ok: true,
    empresa_id: empresa?.id,
    fonte: patch.enriquecido_por,
    fontes,
    kipflow: com_kipflow ? { cost: costKip, costFormatted: costFormattedKip, erro: kipErr } : null,
    campos_extraidos: campos,
  });
};
