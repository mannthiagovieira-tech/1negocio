// /api/va-gerar-do-template · Slice P5.1 · Vercel Node runtime
// Cria criativo rascunho a partir de um template GLOBAL, resolvendo os
// slots COM DADOS DO MANDATO em código puro (sem IA). Débito ZERO -
// só a geração via IA cobra (endpoint separado). Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, code, body) {
  res.status(code).setHeader('Content-Type', 'application/json')
     .setHeader('Access-Control-Allow-Origin', '*')
     .setHeader('Cache-Control', 'no-store');
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
    method: 'POST',
    headers: { apikey: SB_ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.ok && (await r.json()) === true;
}
const H_SVC = () => ({ apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE });

// ─── MAPA setor → tipo_negocio (uppercase pra o classificado)
// Puro código · nunca IA · fallback pro próprio setor uppercase.
const SETOR_MAP = {
  alimentacao: 'INDÚSTRIA DE ALIMENTOS',
  industria: 'INDÚSTRIA',
  servicos: 'EMPRESA DE SERVIÇOS',
  servicos_empresas: 'EMPRESA DE SERVIÇOS B2B',
  servicos_locais: 'EMPRESA DE SERVIÇOS',
  comercio: 'COMÉRCIO',
  varejo: 'VAREJO',
  saude: 'NEGÓCIO DE SAÚDE',
  bem_estar: 'NEGÓCIO DE BEM-ESTAR',
  beleza_estetica: 'CLÍNICA / SALÃO',
  educacao: 'INSTITUIÇÃO DE ENSINO',
  hospedagem: 'NEGÓCIO DE HOSPEDAGEM',
  logistica: 'OPERAÇÃO LOGÍSTICA',
  construcao: 'EMPRESA DE CONSTRUÇÃO',
};

function derivarTipoNegocio(setor) {
  if (!setor) return null;
  const k = String(setor).toLowerCase().trim().replace(/\s+/g, '_');
  return SETOR_MAP[k] || String(setor).toUpperCase();
}
function faixaValor(v) {
  if (!v || v <= 0) return null;
  const inf = Math.round(Number(v) * 0.8 / 1_000_000);
  const sup = Math.round(Number(v) * 1.2 / 1_000_000);
  return inf === sup ? `R$ ${inf}M` : `R$ ${inf}-${sup}M`;
}
function regiaoMacro(cidade, uf) {
  if (!uf) return null;
  // Mesmo cidade sendo interna, só devolvemos UF · regra 2.3
  return uf;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok: false, erro: 'não autorizado' });
  if (!SB_SERVICE) return json(res, 503, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok: false }); }
  const { projeto_id, template_id, arquetipo_id, overrides } = body || {};
  if (!projeto_id || !template_id) return json(res, 400, { ok: false, erro: 'projeto_id + template_id obrigatórios' });

  // Carrega template + projeto
  const [tR, pR] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/va_criativo_templates?id=eq.${template_id}&status=eq.ativo&select=*`, { headers: { ...H_SVC(), 'Content-Type': 'application/json' } }),
    fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=setor,avaliacao_setor,cidade,uf,valor_venda,valor_avaliacao`, { headers: { ...H_SVC(), 'Content-Type': 'application/json' } }),
  ]);
  const [tpl] = await tR.json();
  const [proj] = await pR.json();
  if (!tpl) return json(res, 404, { ok: false, erro: 'template não encontrado ou arquivado' });
  if (!proj) return json(res, 404, { ok: false, erro: 'projeto não encontrado' });

  // Resolve slots do mandato
  const setor = proj.setor || proj.avaliacao_setor || null;
  const tipoNegocio = derivarTipoNegocio(setor);
  const regiao = regiaoMacro(proj.cidade, proj.uf);
  const valor = proj.valor_venda || proj.valor_avaliacao || null;
  const faixa = faixaValor(valor);

  const slots = {
    titulo_vende_se: tipoNegocio ? 'VENDE-SE · ' + tipoNegocio : null,
    tipo_negocio: tipoNegocio,
    regiao_macro: regiao,
    faixa_valor: faixa,
    faixa_faturamento: null,   // futuro: derivar do laudo_v2
    ebitda_pct: null,          // futuro
    destaque_1: null, destaque_2: null,
    dado_principal: faixa,
    dado_label: 'valor de venda',
    contexto: (tipoNegocio && regiao) ? `${tipoNegocio.toLowerCase()} no ${regiao} · à venda com assessoria` : null,
    cta: tpl.cta_default || 'Saiba mais',
    ...(overrides || {}),
  };

  // Checa obrigatórios
  const obrigatorios = Array.isArray(tpl.campos_obrigatorios) ? tpl.campos_obrigatorios : [];
  const faltando = obrigatorios.filter(k => !slots[k]);
  if (faltando.length) {
    return json(res, 422, { ok: false, erro: 'slots obrigatórios faltando', faltando, slots_resolvidos: slots });
  }

  // Deriva headline/texto/cta a partir dos slots (SEM IA · puro código)
  // O layout no renderer sabe como pintar cada campo · aqui montamos os 3 principais
  let headline = '', texto = '';
  if (tpl.layout === 'classificado') {
    headline = slots.titulo_vende_se || ('VENDE-SE · ' + (slots.tipo_negocio || ''));
    texto = [slots.regiao_macro && `Localização: ${slots.regiao_macro}`,
             slots.faixa_valor && `Faixa: ${slots.faixa_valor}`,
             slots.faixa_faturamento && `Faturamento: ${slots.faixa_faturamento}`,
             slots.ebitda_pct && `EBITDA: ${slots.ebitda_pct}%`].filter(Boolean).join(' · ');
  } else if (tpl.layout === 'card_financeiro') {
    headline = `${slots.tipo_negocio} · ${slots.regiao_macro}`;
    texto = [slots.faixa_valor && `Valor: ${slots.faixa_valor}`,
             slots.faixa_faturamento && `Faturamento: ${slots.faixa_faturamento}`,
             slots.ebitda_pct && `EBITDA: ${slots.ebitda_pct}%`,
             slots.destaque_1].filter(Boolean).join(' · ');
  } else if (tpl.layout === 'teaser_dado') {
    headline = slots.dado_principal || '';
    texto = slots.contexto || `${slots.dado_label || ''}`;
  } else if (tpl.layout === 'chamada_comprador') {
    headline = `PROCURAMOS COMPRADOR · ${slots.tipo_negocio} · ${slots.regiao_macro}`;
    texto = slots.destaque_1 || 'Ativo em operação · assessoria de M&A · confidencialidade preservada';
  } else {
    return json(res, 400, { ok: false, erro: 'layout desconhecido: ' + tpl.layout });
  }

  // Insere criativo rascunho (SEM débito · gerar do template é grátis)
  const ins = await fetch(`${SB_URL}/rest/v1/va_criativos`, {
    method: 'POST',
    headers: { ...H_SVC(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({
      projeto_id, arquetipo_id: arquetipo_id || null,
      template_id: tpl.id,
      nome: `${tpl.nome} · ${slots.tipo_negocio || ''}`.slice(0, 100),
      tipo: 'estatico', formato: tpl.formato, layout: tpl.layout,
      headline: String(headline).slice(0, 100),
      texto: String(texto).slice(0, 200),
      cta: String(slots.cta).slice(0, 20),
      status: 'rascunho', origem: 'template', versao: 1,
    }),
  });
  if (!ins.ok) return json(res, 502, { ok: false, erro: 'insert', detalhe: (await ins.text()).slice(0, 250) });
  const [row] = await ins.json();

  return json(res, 200, {
    ok: true, criativo_id: row.id, template_slug: tpl.slug,
    slots_resolvidos: slots, formato: tpl.formato, layout: tpl.layout,
  });
};
