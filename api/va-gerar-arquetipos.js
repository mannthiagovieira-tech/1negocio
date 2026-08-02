// /api/va-gerar-arquetipos · MANDATO · Zona ATIVO · Vercel Function (Node CJS).
// Bloqueio conhecido: edges Deno do Supabase estão no teto do plano (402).
// Portada pra Vercel Function seguindo padrão de api/gerar-descricao.js.
// Auth: Bearer JWT do admin (RPC va_is_admin no PostgREST).
//
// MODO COMPLETO:  POST { projeto_id }
// MODO PARCIAL:   POST { projeto_id, arquetipo_id, bloco: "abordagem" }
//
// Valida output do Sonnet (schema + tipos + pelo menos 1 critério no filtro).
// 1 retry com correção; falha limpa se o retry também não vier válido.
// Nunca insere lixo.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

function json(res, code, body) { res.status(code).setHeader('Content-Type', 'application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const c = []; for await (const x of req) c.push(x);
  const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method: 'POST', headers: { apikey: SB_ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}',
  });
  return r.ok && (await r.json()) === true;
}

const CAMPOS_FILTRO = [
  'cnaes', 'porte', 'faturamento_min', 'faturamento_max',
  'uf', 'cidades', 'raio_km',
  'socio_idade_min', 'socio_idade_max',
  'com_divida', 'fonte_preferida',
];
function validarArquetipo(a) {
  if (!a || typeof a !== 'object') return 'não é objeto';
  if (typeof a.nome !== 'string' || a.nome.trim().length < 4) return 'nome inválido';
  if (typeof a.tese !== 'string' || a.tese.trim().length < 20) return 'tese muito curta';
  if (!a.filtro || typeof a.filtro !== 'object') return 'filtro ausente';
  const f = a.filtro;
  const temCriterio = Object.keys(f).some((k) => CAMPOS_FILTRO.includes(k) && f[k] != null &&
    (Array.isArray(f[k]) ? f[k].length > 0 : true));
  if (!temCriterio) return 'filtro sem nenhum critério preenchido';
  if (!a.abordagem || typeof a.abordagem !== 'object') return 'abordagem ausente';
  const b = a.abordagem;
  if (typeof b.angulo !== 'string' || b.angulo.trim().length < 10) return 'abordagem.angulo curto';
  if (typeof b.objecao_provavel !== 'string' || b.objecao_provavel.trim().length < 10) return 'abordagem.objecao_provavel curto';
  if (typeof b.segmentacao_meta !== 'string' || b.segmentacao_meta.trim().length < 10) return 'abordagem.segmentacao_meta curto';
  return null;
}
function parseJsonEstrito(raw) {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s); } catch { return null; }
}
async function chamarSonnet(prompt, maxTokens = 4000) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  });
  const raw = await r.text();
  if (!r.ok) throw new Error('Anthropic HTTP ' + r.status + ': ' + raw.slice(0, 300));
  const d = JSON.parse(raw);
  return d?.content?.[0]?.text || '';
}

function bloco(cj) {
  const val = cj.valuation || {}, op = cj.operacional || {}, idn = cj.identificacao || {}, dre = cj.dre || {}, ise = cj.ise || {};
  const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR');
  return `IDENTIFICAÇÃO:
- Setor: ${idn.setor?.label || '—'}
- Localização: ${idn.localizacao?.cidade || '—'} / ${idn.localizacao?.estado || '—'}
- Regime: ${idn.regime_tributario_declarado?.label || '—'}
- Tempo de operação: ${idn.tempo_operacao_anos || '—'} anos

NÚMEROS:
- Faturamento anual: ${brl(op.fat_anual)}
- EBITDA anual: ${brl(val.ro_anual)}
- Margem operacional: ${dre.margem_op_pct != null ? dre.margem_op_pct + '%' : '—'}
- Valor de venda sugerido: ${brl(val.valor_venda)}
- Múltiplo aplicado: ${Number(val.fator_final || 0).toFixed(2)}×
- Funcionários: ${op.num_funcionarios || '—'}
- Sócios: ${op.num_socios || '—'}
- Concentração de clientes: ${op.concentracao_status || '—'}

ISE (saúde 0-100): ${ise.ise_total || '—'} · ${ise.classe || ''}`;
}

function promptLista(cj, valorVenda, desc, corrigir) {
  const vv = valorVenda ? 'R$ ' + valorVenda.toLocaleString('pt-BR') : 'não definido';
  const d = desc ? desc.slice(0, 800) : '—';
  const cor = corrigir ? '\nCORREÇÃO NECESSÁRIA · o retorno anterior falhou: ' + corrigir + '\nRefaça respeitando o schema.' : '';
  return `Você é um analista sênior de M&A de PME brasileiro. Gere 3 a 4 arquétipos EXECUTÁVEIS de comprador pro negócio abaixo.

REGRA CENTRAL:
Arquétipo executável = perfil que compila em query de extração (CNAE, porte, região, tamanho) E em abordagem específica (ângulo, objeção, segmentação). Nada de persona vazia com "sonhos".

DADOS DO NEGÓCIO
${bloco(cj)}

VALOR DE VENDA DEFINIDO: ${vv}
DESCRIÇÃO ADICIONAL DO ASSESSOR: ${d}

DIRECIONAMENTO:
Considere teses típicas de M&A de PME BR: (a) concorrente local/regional consolidando; (b) player adjacente entrando; (c) empresário do mesmo CNAE em cidade vizinha; (d) investidor/search fund calibrado à faixa. Ancorar SEMPRE nos números reais acima.

FORMATO (JSON estrito · SEM markdown · SEM preâmbulo):
[
  {
    "nome": "curto e concreto",
    "tese": "1-3 frases · por que esse perfil paga por este ativo",
    "filtro": {
      "cnaes": ["4711-3/02"],
      "porte": ["ME","EPP","DEMAIS"],
      "faturamento_min": 500000, "faturamento_max": 5000000,
      "uf": ["SC"], "cidades": ["Florianópolis"], "raio_km": 100,
      "socio_idade_min": 30, "socio_idade_max": 55,
      "com_divida": null,
      "fonte_preferida": "kipflow"
    },
    "abordagem": {
      "angulo": "gancho da 1ª mensagem · específico · 2-3 linhas",
      "objecao_provavel": "principal objeção + como responder",
      "segmentacao_meta": "quando houver anúncio, quais públicos/interesses"
    }
  }
]

REGRAS INEGOCIÁVEIS:
- Filtro precisa ter PELO MENOS UM critério preenchido de fato.
- Nada de persona romântica. Só o que compila em ação.
- 3 ou 4 arquétipos com teses distintas.
- SÓ o JSON. Zero texto fora.${cor}`;
}
function promptAbordagem(arq, cj) {
  return `Regere APENAS o bloco 'abordagem' do arquétipo abaixo, mantendo o resto intacto. Contexto do negócio:

${bloco(cj)}

ARQUÉTIPO ATUAL:
nome: ${arq.nome}
tese: ${arq.tese}
filtro: ${JSON.stringify(arq.filtro)}

RETORNO · JSON estrito (só o objeto, sem markdown):
{ "angulo": "...", "objecao_provavel": "...", "segmentacao_meta": "..." }`;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok: false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok: false, erro: 'não autorizado' });
  if (!ANTHROPIC_KEY) return json(res, 503, { ok: false, erro: 'ANTHROPIC_API_KEY ausente' });
  if (!SB_SERVICE) return json(res, 503, { ok: false, erro: 'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok: false, erro: 'json inválido' }); }
  const { projeto_id, arquetipo_id, bloco: blocoParcial } = body || {};
  if (!projeto_id) return json(res, 400, { ok: false, erro: 'projeto_id obrigatório' });

  const H = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };
  const pR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=id,valor_venda,descricao_negocio,cliente_nome,negocio_titulo,laudo_v2_id`, { headers: H });
  const [p] = await pR.json();
  if (!p) return json(res, 404, { ok: false, erro: 'projeto não encontrado' });
  let calc = {};
  if (p.laudo_v2_id) {
    const lR = await fetch(`${SB_URL}/rest/v1/laudos_v2?id=eq.${p.laudo_v2_id}&select=calc_json`, { headers: H });
    const [l] = await lR.json();
    if (l?.calc_json) calc = l.calc_json;
  }
  if (!calc.valuation) return json(res, 422, { ok: false, erro: 'sem laudo vinculado · vincule antes de gerar arquétipos' });

  // MODO PARCIAL
  if (arquetipo_id && blocoParcial === 'abordagem') {
    const aR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${arquetipo_id}&select=id,projeto_id,status,nome,tese,filtro,abordagem`, { headers: H });
    const [arq] = await aR.json();
    if (!arq || arq.projeto_id !== projeto_id) return json(res, 404, { ok: false, erro: 'arquétipo não pertence a este projeto' });
    if (arq.status !== 'rascunho') return json(res, 409, { ok: false, erro: 'regeneração só em rascunho' });
    try {
      const raw = await chamarSonnet(promptAbordagem(arq, calc), 1500);
      const parsed = parseJsonEstrito(raw);
      const ok = parsed && typeof parsed === 'object'
        && typeof parsed.angulo === 'string'
        && typeof parsed.objecao_provavel === 'string'
        && typeof parsed.segmentacao_meta === 'string';
      if (!ok) return json(res, 502, { ok: false, erro: 'resposta_invalida', raw: raw.slice(0, 400) });
      const upR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${arq.id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ abordagem: parsed }),
      });
      if (!upR.ok) return json(res, 500, { ok: false, erro: 'update: ' + upR.status });
      return json(res, 200, { ok: true, modo: 'abordagem', arquetipo_id: arq.id, abordagem: parsed });
    } catch (e) {
      return json(res, 502, { ok: false, erro: 'anthropic_fail', detalhe: String(e.message).slice(0, 300) });
    }
  }

  // MODO COMPLETO · teto
  const cR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${projeto_id}&status=neq.arquivado&select=id`, { headers: H });
  const nAtivos = (await cR.json()).length;
  if (nAtivos >= 5) return json(res, 409, { ok: false, erro: 'teto atingido · 5 arquétipos ativos · arquive antes de gerar novos' });
  const espaco = 5 - nAtivos;

  let corrigir = null;
  for (let t = 0; t < 2; t++) {
    try {
      const raw = await chamarSonnet(promptLista(calc, p.valor_venda ? Number(p.valor_venda) : null, p.descricao_negocio, corrigir));
      const parsed = parseJsonEstrito(raw);
      if (!Array.isArray(parsed)) { corrigir = 'esperava array JSON no topo, recebi outra coisa'; continue; }
      if (parsed.length < 3 || parsed.length > 4) { corrigir = `esperava 3-4 arquétipos, recebi ${parsed.length}`; continue; }
      const problemas = [];
      for (let i = 0; i < parsed.length; i++) {
        const p2 = validarArquetipo(parsed[i]);
        if (p2) problemas.push(`[${i}] ${p2}`);
      }
      if (problemas.length) { corrigir = problemas.join('; '); continue; }
      const paraInserir = parsed.slice(0, espaco).map((a) => ({
        projeto_id, nome: a.nome, tese: a.tese, filtro: a.filtro, abordagem: a.abordagem,
        status: 'rascunho', origem: 'ia',
      }));
      const insR = await fetch(`${SB_URL}/rest/v1/va_arquetipos`, {
        method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify(paraInserir),
      });
      const inseridos = await insR.json();
      if (!insR.ok) return json(res, 500, { ok: false, erro: 'insert: ' + JSON.stringify(inseridos).slice(0, 300) });
      return json(res, 200, { ok: true, quantidade: inseridos.length, arquetipos: inseridos, tentativas: t + 1 });
    } catch (e) {
      return json(res, 502, { ok: false, erro: 'anthropic_fail', detalhe: String(e.message).slice(0, 300) });
    }
  }
  return json(res, 502, { ok: false, erro: 'modelo_nao_produziu_json_valido', ultima_correcao: corrigir });
};
