// /api/enriquecer · Vercel Function
// Enriquece va_empresas via Kipflow. Fora do limite de edges Supabase.
// Auth: JWT de admin (validado contra va_admins via va_is_admin RPC).
// Segurança: KIPFLOW_API_KEY vive só como env var do Vercel. NUNCA
//   é retornada no corpo, NUNCA é logada — nem em mensagem de erro.

const SB_URL = process.env.SUPABASE_URL;
// Anon key vem só de env. Autorização real: Bearer <jwt_admin> via RPC.
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
    headers: {
      apikey: SB_ANON,
      Authorization: 'Bearer ' + userToken,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!r.ok) return false;
  const d = await r.json();
  return d === true;
}

function extraiCampos(data) {
  const g = (obj, ...keys) => {
    for (const k of keys) {
      const parts = k.split('.');
      let cur = obj;
      for (const p of parts) { if (cur == null) break; cur = cur[p]; }
      if (cur != null && cur !== '') return cur;
    }
    return null;
  };
  const socios = g(data, 'socios', 'partners', 'quadro_societario', 'qsa');
  // Kipflow devolve porte como categoria ("MICRO EMPRESA", "DEMAIS") e
  // `faturamento` numérico como campo separado. `faixa_faturamento_grupo`
  // é a faixa textual ("81K A 360K").
  const porteRaw = g(data, 'porte', 'faturamento_estimado', 'porte_faturamento', 'revenue_estimated', 'estimated_revenue');
  const faturamentoNum = g(data, 'faturamento', 'faturamento_grupo');
  const faixaFat = g(data, 'faixa_faturamento_grupo');
  const faixaFunc = g(data, 'faixa_funcionarios_grupo');
  const segmento = g(data, 'segmento');
  const ramoAtividade = g(data, 'ramo_de_atividade');
  const divida = g(data, 'divida');
  // Kipflow devolve numeric OU string categórica ("DEMAIS", "ME", "EPP")
  let porte_faturamento = null, porte_categoria = null;
  if (typeof faturamentoNum === 'number' && isFinite(faturamentoNum) && faturamentoNum > 0) {
    porte_faturamento = faturamentoNum;
  } else if (typeof faturamentoNum === 'string' && faturamentoNum.trim() !== '') {
    const asNum = Number(String(faturamentoNum).replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (isFinite(asNum) && asNum > 0) porte_faturamento = asNum;
  }
  if (typeof porteRaw === 'string' && porteRaw.trim() !== '') porte_categoria = porteRaw;
  const capRaw = g(data, 'capital_social', 'capitalSocial', 'share_capital');
  const capital_social = (typeof capRaw === 'number' && isFinite(capRaw)) ? capRaw
    : (typeof capRaw === 'string' && !isNaN(Number(capRaw))) ? Number(capRaw) : null;
  const funcRaw = g(data, 'funcionarios', 'employees', 'employee_count');
  const funcionarios = Number.isInteger(funcRaw) ? funcRaw
    : (typeof funcRaw === 'string' && /^\d+$/.test(funcRaw)) ? parseInt(funcRaw, 10) : null;
  // Dívida (dataset debts). Objeto ausente = sem dívida cadastrada.
  const divTotal = divida && typeof divida === 'object' ? Number(divida.total) : null;
  const divPrev  = divida && typeof divida === 'object' ? Number(divida.total_previdenciaria) : null;
  const divNPrev = divida && typeof divida === 'object' ? Number(divida.total_nao_previdenciaria) : null;
  const divFgts  = divida && typeof divida === 'object' ? Number(divida.total_fgts) : null;
  return {
    razao_social:       g(data, 'razao_social', 'razaoSocial', 'legal_name', 'nome'),
    nome_fantasia:      g(data, 'nome_fantasia', 'nomeFantasia', 'trade_name', 'fantasia'),
    cnpj:               g(data, 'cnpj', 'document', 'documento'),
    cidade:             g(data, 'municipio', 'cidade', 'city', 'address.city', 'endereco.cidade'),
    estado:             g(data, 'uf', 'estado', 'state', 'address.state', 'endereco.uf'),
    cnae_codigo:        g(data, 'cnae_principal_classe', 'cnae_codigo', 'cnae.codigo', 'main_cnae.code'),
    cnae_descricao:     g(data, 'cnae_principal_desc_classe', 'cnae_descricao', 'cnae.descricao', 'main_cnae.description'),
    situacao_cadastral: g(data, 'situacao_cadastral', 'situacaoCadastral', 'registration_status', 'status'),
    porte_faturamento, porte_categoria,
    faixa_faturamento:  typeof faixaFat === 'string' ? faixaFat : null,
    faixa_funcionarios: typeof faixaFunc === 'string' ? faixaFunc : null,
    segmento:           typeof segmento === 'string' ? segmento : null,
    ramo_atividade:     typeof ramoAtividade === 'string' ? ramoAtividade : null,
    funcionarios, capital_social,
    data_abertura:      g(data, 'data_inicio_atividade', 'data_abertura', 'dataAbertura', 'opened_at', 'founded_at'),
    socios: Array.isArray(socios) ? socios : null,
    site:               g(data, 'sites.0', 'site', 'website', 'url'),
    instagram:          g(data, 'instagram', 'social.instagram'),
    linkedin:           g(data, 'linkedin_url', 'linkedin', 'social.linkedin'),
    divida_total:              isFinite(divTotal) ? divTotal : null,
    divida_previdenciaria:     isFinite(divPrev)  ? divPrev  : null,
    divida_nao_previdenciaria: isFinite(divNPrev) ? divNPrev : null,
    divida_fgts:               isFinite(divFgts)  ? divFgts  : null,
    divida_bruto:              divida && typeof divida === 'object' ? divida : null,
    divida_consultada_em:      new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false, erro: 'method not allowed' });

  // 1. AUTH ANTES DE TUDO · anônimo/inválido não pode nem saber quais
  //    env vars estão configuradas (evita enumeração de config).
  const auth = req.headers.authorization || '';
  const userToken = auth.replace(/^Bearer\s+/i, '').trim();
  if (!userToken) return json(res, 401, { ok: false, erro: 'não autorizado' });
  const admin = await ehAdmin(userToken);
  if (!admin) return json(res, 403, { ok: false, erro: 'não autorizado' });

  // 2. Só admin passa daqui em diante · agora sim checa env vars
  const KEY = process.env.KIPFLOW_API_KEY;
  if (!KEY) return json(res, 503, {
    ok: false,
    erro: 'KIPFLOW_API_KEY não configurada · defina em Vercel → Project Settings → Environment Variables',
  });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel' });

  // 3. Body
  let body;
  try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  let { empresa_id, cnpj, projeto_id } = body || {};
  cnpj = (cnpj || '').replace(/\D/g, '');

  // Se empresa_id, buscar cnpj e checar se já está enriquecida
  const sbHeaders = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };
  if (empresa_id && !cnpj) {
    const r = await fetch(`${SB_URL}/rest/v1/va_empresas?id=eq.${empresa_id}&select=cnpj,enriquecido_em`, { headers: sbHeaders });
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return json(res, 404, { ok: false, erro: 'empresa não encontrada' });
    cnpj = (arr[0].cnpj || '').replace(/\D/g, '');
    if (arr[0].enriquecido_em) return json(res, 200, { ok: true, ja_enriquecida: true, empresa_id });
  }
  if (!cnpj || cnpj.length !== 14) return json(res, 400, { ok: false, erro: 'cnpj inválido (14 dígitos)' });

  // 4. Kipflow · GET /companies/v1/search?cnpj=xxx (enriquecimento direto)
  let kip;
  try {
    // Datasets válidos (descobertos empiricamente): basic, complete, address,
    // online_presence, partners, debts, ecommerce. `debts` traz objeto `divida`.
    const r = await fetch(`https://api.kipflow.io/companies/v1/search?cnpj=${cnpj}&datasets=complete,partners,address,online_presence,debts`, {
      headers: { 'X-API-Key': KEY, Accept: 'application/json' },
    });
    const status = r.status;
    const raw = await r.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* deixa raw */ }
    if (!r.ok) {
      // NÃO logar KEY nem eco do body request; só status + amostra da resposta
      return json(res, 502, { ok: false, erro: `kipflow_http_${status}`, resposta_amostra: raw.slice(0, 300) });
    }
    kip = parsed || {};
  } catch (e) {
    // Zero interpolação da chave em mensagem
    return json(res, 502, { ok: false, erro: 'kipflow_erro_rede', detalhe: String(e.message || e).slice(0, 200) });
  }

  const data = kip.data || kip; // fallback se doc muda
  const campos = extraiCampos(data);

  // 5. Grava em va_empresas (upsert por cnpj)
  const patch = {
    ...campos,
    cnpj,
    enriquecido_em: new Date().toISOString(),
    enriquecido_por: 'kipflow',
    enriquecimento_bruto: kip,
    atualizado_em: new Date().toISOString(),
  };

  // Se veio empresa_id, PATCH direto; senão upsert por cnpj.
  let empresa = null; let upErrText = null; let upStatus = null;
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
    return json(res, 500, { ok: false, erro: 'upsert_falhou', http: upStatus, detalhe: upErrText, campos_extraidos: campos });
  }

  // 6. Debita se projeto_id
  if (projeto_id && empresa?.id) {
    try {
      await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          p_projeto: projeto_id, p_tipo: 'lead_scrapper', p_qtd: 1,
          p_referencia: `Enriquecimento CNPJ ${cnpj}`, p_ciclo: null,
        }),
      });
    } catch (_) { /* não bloqueia o retorno principal */ }
  }

  // 7. Retorno: NUNCA inclui KEY. Inclui cost do Kipflow.
  return json(res, 200, {
    ok: true,
    empresa_id: empresa?.id,
    cost: kip.cost != null ? kip.cost : null,
    costFormatted: kip.costFormatted || null,
    datasets: kip.datasets || null,
    campos_extraidos: campos, // porte, funcionarios, socios, cnae, situacao_cadastral etc
  });
};
