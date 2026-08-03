// /api/va-gerar-arquetipos · MANDATO · Zona ATIVO
// Regras de calibração (Prompt 2.1):
// - "angulo" do arquétipo é texto que sai pro mundo → sujeita à mesma regra
//   de faixas do teaser: sem cidade exata, sem valores exatos, sem cálculos
//   novos (aritmética já vem pronta do servidor).
// - "filtro" é query interna de extração de leads → MANTÉM cidades e valores
//   exatos (é o que o Kipflow/Apify vão consumir).
// - "tese" e "objecao_provavel" também são internos (assessor lê pra decidir
//   se aprova o arquétipo) → aceitam contexto detalhado, MAS ainda proibidos
//   de citar razão social/sócio/CNPJ.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';
const { montarContextoQualitativo, extrairTermosProibidos, detectarSituacaoSensivel, derivarSetorTermos, detectarTriangulacao, ehRegiaoMacro } = require('./_va_fontes.js');

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

// ─── faixas / região (idêntico ao teaser) ─────────────────────────────
function faixaMonetaria(v) {
  if (v == null || v <= 0) return '—';
  const n = Number(v);
  if (n >= 1_000_000) {
    const lo = Math.floor(n / 1_000_000);
    const hi = Math.ceil(n / 1_000_000);
    return lo === hi ? `R$ ${lo}–${lo + 1}M` : `R$ ${lo}–${hi}M`;
  }
  if (n >= 100_000) {
    const lo = Math.floor(n / 100_000) * 100;
    return `R$ ${lo}–${lo + 100}k`;
  }
  const lo = Math.floor(n / 10_000) * 10;
  return `R$ ${lo}–${lo + 10}k`;
}
function faixaFuncionarios(n) {
  if (n == null || n <= 0) return '—';
  const v = Number(n);
  if (v < 10) return `<10`;
  const lo = Math.floor(v / 10) * 10;
  return `${lo}–${lo + 10}`;
}
function faixaIdade(anos) {
  if (anos == null || anos <= 0) return '—';
  const v = Math.floor(Number(anos) / 10) * 10;
  return `${v}+ anos`;
}
const REGIOES = {
  'florianopolis-sc': 'Grande Florianópolis',
  'joinville-sc': 'norte de SC',
  'blumenau-sc': 'Vale do Itajaí',
  'chapeco-sc': 'oeste de SC',
  'sao paulo-sp': 'capital paulista',
  'campinas-sp': 'região de Campinas',
  'rio de janeiro-rj': 'Grande Rio',
  'belo horizonte-mg': 'Grande BH',
  'porto alegre-rs': 'Grande Porto Alegre',
  'caxias do sul-rs': 'serra gaúcha',
  'santa cruz do sul-rs': 'Vale do Rio Pardo',
  'lajeado-rs': 'Vale do Taquari',
  'teutonia-rs': 'Vale do Taquari',
  'estrela-rs': 'Vale do Taquari',
  'canoas-rs': 'Grande Porto Alegre',
  'curitiba-pr': 'Grande Curitiba',
  'salvador-ba': 'Grande Salvador',
  'recife-pe': 'Grande Recife',
  'fortaleza-ce': 'Grande Fortaleza',
  'brasilia-df': 'Distrito Federal',
  'goiania-go': 'Grande Goiânia',
};
function normSemAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function derivarRegiao(cidade, uf) {
  const ufSafe = (uf || '').toUpperCase();
  if (!cidade) return ufSafe ? `interior de ${ufSafe}` : '—';
  const key = `${normSemAcento(cidade)}-${ufSafe.toLowerCase()}`;
  return REGIOES[key] || (ufSafe ? `interior de ${ufSafe}` : '—');
}

// ─── aritmética ───────────────────────────────────────────────────────
function fmtMult(x) { return x == null ? null : x.toFixed(2).replace('.', ',') + '×'; }
function fmtPct(x) { return x == null ? null : x.toFixed(1).replace('.', ',') + '%'; }
function calcularAritmetica(fat, ebitda, valorVenda) {
  const out = { multiplo_fat: null, multiplo_ebitda: null, margem_ebitda: null,
                multiplo_fat_str: null, multiplo_ebitda_str: null, margem_ebitda_str: null };
  const _fat = Number(fat) || 0;
  const _ebitda = Number(ebitda) || 0;
  const _vv = Number(valorVenda) || 0;
  if (_fat > 0 && _ebitda > 0) { out.margem_ebitda = (_ebitda / _fat) * 100; out.margem_ebitda_str = fmtPct(out.margem_ebitda); }
  if (_vv > 0 && _fat > 0) { out.multiplo_fat = _vv / _fat; out.multiplo_fat_str = fmtMult(out.multiplo_fat); }
  if (_vv > 0 && _ebitda > 0) { out.multiplo_ebitda = _vv / _ebitda; out.multiplo_ebitda_str = fmtMult(out.multiplo_ebitda); }
  return out;
}

// ─── validações do ANGULO (material externo · primeira mensagem a lead frio)
// Regra do operador: angulo NÃO revela preço nem múltiplo. Só apresenta ativo
// em faixas (região, fat, tempo, funcionários) + convite à conversa. Preço
// vem em conversa avançada. Tese e objeção (internas) continuam podendo.
//
// Regras (sobre o angulo):
//  1) cidade exata do projeto → rejeita
//  2) valores exatos do laudo (fat, ebitda, valor_venda) → rejeita
//  3) QUALQUER menção a preço próximo do valor_venda (exato OU em faixa) → rejeita
//     · faixas de fat/EBITDA são OK (não sobrepõem valor_venda)
//  4) QUALQUER padrão N,Nx (múltiplo · nenhum tolerado no angulo) → rejeita
//  5) percentuais fora dos permitidos → rejeita
function _parseMonetarioParaReais(hit) {
  // Extrai centro numérico do match. Ex.: "R$ 4-5M" → 4500000
  // "R$ 700k" → 700000. "R$ 4,5 milhões" → 4500000. "R$ 4.5M" → 4500000.
  const s = hit.toLowerCase().replace(/r\$/, '').trim();
  const numRe = /(\d+(?:[,.]\d+)?)/g;
  const nums = [];
  let n; while ((n = numRe.exec(s)) !== null) nums.push(parseFloat(n[1].replace(',', '.')));
  if (!nums.length) return null;
  const centro = nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
  const mult = /(milh(?:ão|ões)|\bmm?\b|\bmi\b|^m$)/i.test(s.replace(/\d|[,.\-–\s]/g,'')) ? 1_000_000
             : /\bk\b|mil\b/i.test(s.replace(/\d|[,.\-–\s]/g,'')) ? 1_000
             : /m$/i.test(s.replace(/\s/g,'')) ? 1_000_000
             : /k$/i.test(s.replace(/\s/g,'')) ? 1_000
             : 1;
  return Math.round(centro * mult);
}
function detectarVazamentoAngulo(texto, cidadeExata, valoresExatos, permitidosArit, valorVenda) {
  const problemas = [];
  if (cidadeExata) {
    const cNorm = normSemAcento(cidadeExata);
    const tNorm = normSemAcento(texto);
    const re = new RegExp('\\b' + cNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(tNorm)) problemas.push(`angulo cita cidade exata "${cidadeExata}"`);
  }
  // (1) valores exatos do laudo em compact/BR-fmt
  for (const raw of valoresExatos) {
    if (!raw || raw < 10000) continue;
    const n = Math.round(raw);
    const compact = String(n);
    if (compact.length >= 5 && texto.includes(compact)) problemas.push(`angulo cita valor exato ${compact}`);
    const brFmt = n.toLocaleString('pt-BR');
    if (brFmt !== compact && texto.includes(brFmt)) problemas.push(`angulo cita valor exato BR ${brFmt}`);
  }
  // (2) preço · rejeita SÓ menções próximas do valor_venda (fat/EBITDA em faixa continuam OK)
  if (valorVenda && valorVenda > 0) {
    const reMonet = /R\$?\s*\d+(?:[.,]\d+)?\s*(?:[–\-]\s*\d+(?:[.,]\d+)?)?\s*(?:M|MM|mm|MI|mi|milh(?:ão|ões)|k|K|mil)?\b/gi;
    const matches = texto.match(reMonet) || [];
    for (const hit of matches) {
      const v = _parseMonetarioParaReais(hit);
      if (v == null) continue;
      // proximidade: sobreposição com valor_venda ± 30% (mesma ordem de grandeza)
      if (v >= valorVenda * 0.5 && v <= valorVenda * 1.5) {
        problemas.push(`angulo cita valor próximo do valor_venda "${hit.trim()}" (~R$${v}) · preço não pode aparecer no angulo`);
      }
    }
    // Também rejeita padrões de convite a preço tipo "vendido por", "pedido de", "ticket"
    if (/\b(vendido|pedid[oa]|ticket|valor de venda|R\$\s*\d)/i.test(texto)
        && /\b(por|de|em)\s*R?\$?\s*\d/i.test(texto)) {
      // heurística branda · só marca se claramente introduz preço
      const ret = texto.match(/\b(?:vendido por|pedido de|valor de venda|ticket de|preço de)[^.\n]{0,60}\d[^.\n]{0,40}/i);
      if (ret) problemas.push(`angulo introduz preço com "${ret[0].slice(0,80)}"`);
    }
  }
  // (3) múltiplos N,Nx · PROIBIDO no angulo (independente de permitidos)
  const reMult = /(\d+(?:[,.]\d+)?)\s*[xX×]/g;
  let m;
  while ((m = reMult.exec(texto)) !== null) {
    problemas.push(`angulo cita múltiplo "${m[0].trim()}" · múltiplo não pode aparecer no angulo`);
  }
  // (4) percentuais: só passam se estão nos permitidos
  const permPct = permitidosArit.filter((x) => x.tipo === 'pct').map((x) => x.valor);
  const fmtBRPct = (n) => n.toFixed(1).replace('.', ',') + '%';
  const rePct = /(\d+(?:[,.]\d+)?)\s*%/g;
  while ((m = rePct.exec(texto)) !== null) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (!isFinite(v)) continue;
    if (permPct.length === 0) { problemas.push(`angulo cita "${m[0]}" · REMOVA "%" (nenhum percentual foi liberado)`); continue; }
    const ok = permPct.some((p) => Math.abs(v - p) <= 0.5);
    if (!ok) problemas.push(`angulo · percentual "${m[0]}" INVENTADO · use EXATAMENTE ${permPct.map(fmtBRPct).join(' ou ')}`);
  }
  return problemas;
}
// Nomes/CNPJ (proibido em qualquer campo · interno ou externo)
function detectarNomesEmQualquerLugar(obj, proibidos) {
  const texto = JSON.stringify(obj).toLowerCase();
  const found = [];
  for (const p of proibidos) {
    if (!p) continue;
    const n = String(p).trim().toLowerCase();
    if (n.length < 4) continue;
    if (texto.includes(n)) found.push(p);
  }
  return found;
}

// ─── validação estrutural ─────────────────────────────────────────────
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

// ─── PROMPT ───────────────────────────────────────────────────────────
function promptLista(fatos, desc, contextoQuali, sensivel, corrigir) {
  const cor = corrigir ? '\nCORREÇÃO NECESSÁRIA · o retorno anterior falhou: ' + corrigir + '\nRefaça respeitando o schema e as regras.' : '';
  const d = desc ? desc.slice(0, 800) : '—';
  const bMult = [];
  if (fatos.multiplo_fat_str) bMult.push(`${fatos.multiplo_fat_str} sobre faturamento`);
  if (fatos.multiplo_ebitda_str) bMult.push(`${fatos.multiplo_ebitda_str} sobre EBITDA`);
  const multStr = bMult.length ? bMult.join(' · ') : '(sem valor de venda · não cite múltiplo)';

  return `Você é um analista sênior de M&A de PME brasileiro. Gere 3 a 4 arquétipos EXECUTÁVEIS de comprador pro negócio abaixo.

REGRA CENTRAL:
Arquétipo executável = perfil que compila em query de extração (filtro) E abordagem específica (angulo). Nada de persona vazia com "sonhos".

FATOS DO NEGÓCIO (use apenas isto · faixas e aritmética já prontas):
- Setor: ${fatos.setor}
- Região (uso EXTERNO): ${fatos.regiao}
- Cidade real (uso INTERNO no filtro): ${fatos.cidade_interna || '—'}
- UF: ${fatos.uf || '—'}
- Idade do negócio: ${fatos.idade_faixa}
- Faturamento anual: ${fatos.fat_faixa}
- EBITDA anual: ${fatos.ebitda_faixa}
- Margem EBITDA: ${fatos.margem_ebitda_str || '(não calculável)'}
- Funcionários: ${fatos.func_faixa}
- Concentração de clientes: ${fatos.concentracao}
- Valor de venda: ${fatos.valor_venda_faixa}
- Múltiplos (já calculados): ${multStr}

DESCRIÇÃO ADICIONAL DO ASSESSOR: ${d}

DIRECIONAMENTO:
Teses típicas de M&A de PME BR: (a) concorrente local/regional consolidando; (b) player adjacente entrando; (c) empresário do mesmo CNAE em cidade vizinha; (d) investidor/search fund calibrado à faixa. Ancorar nos FATOS acima.

HIERARQUIA DE INFORMAÇÃO (regra SOBERANA):
- DADOS QUANTITATIVOS (fat, EBITDA, margem, múltiplos, valor de venda, dívidas)
  vêm EXCLUSIVAMENTE dos FATOS acima (laudo + valor de venda do sistema).
- As FONTES fornecem APENAS contexto qualitativo (diferenciais operacionais,
  processos, base de clientes, motivação, restrições de sigilo, teses sugeridas).
- Se o sistema NÃO tem um número, OMITA-O · nunca preencher com valor da fonte.
- Em conflito entre fonte e sistema, o SISTEMA vence silenciosamente
  (não mencionar divergência no output).

REGRAS ABSOLUTAS (violação → rejeição):

1) FILTRO (query interna · pode ter cidade e valores exatos):
   - Use cidades reais (pode incluir a cidade do negócio + vizinhas), CNAEs específicos, faixas de fat.
   - Isto NÃO sai pro mercado — é pra buscar leads no Kipflow/Apify.

2) ANGULO (primeira mensagem a lead FRIO · MATERIAL EXTERNO):
   Objetivo: apresentar o ATIVO em FAIXAS (setor, região, faturamento, tempo de
   operação) e o CONVITE à conversa. Preço vem depois, em conversa avançada.
   - NUNCA cite cidade exata. Use SOMENTE "${fatos.regiao}".
   - Pode citar em FAIXA: ${fatos.fat_faixa} · ${fatos.ebitda_faixa} · ${fatos.idade_faixa} · ${fatos.func_faixa}.
   - PROIBIDO no angulo: valor de venda (nem exato nem em faixa · zero R$ ${fatos.valor_venda_faixa.replace('R$ ','').replace(/[^0-9\-–kMm]/g,'')} tipo de coisa),
     múltiplo (0×, 6,5×, etc.), qualquer padrão "R$ N-NM/k/mi/milhões".
   - PROIBIDO razão social, sócio, CNPJ, marca, domínio.
   - NÃO-TRIANGULAÇÃO: setor específico + mesorregião juntos identifica o
     ativo. Escolha um: OU cita mesorregião "${fatos.regiao}" mantendo setor
     genérico ("indústria", "operação industrial") · OU cita setor específico
     (cosméticos, insumos, farmacêutico etc.) embaçando a geografia pra macro
     ("Sul do Brasil", "interior de ${(fatos.uf||'UF')}", "capital paulista",
     "Grande {qualquer}"). A combinação é PROIBIDA.

3) TESE e OBJECAO_PROVAVEL (internos · assessor lê pra decidir):
   - PODEM ter valor de venda, múltiplos, margem — texto interno pra julgamento.
   - Múltiplos permitidos: ${bMult.join(' ou ') || '(sem múltiplo calculável)'}.
   - Margem permitida: ${fatos.margem_ebitda_str || '(não calculável)'}.
   - Proibido razão social/sócio/CNPJ mesmo no interno.

FORMATO (JSON estrito · SEM markdown · SEM preâmbulo):
[
  {
    "nome": "curto e concreto",
    "tese": "1-3 frases · por que este perfil paga",
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
      "angulo": "gancho da 1ª mensagem · CEGO (região + faixas) · 2-3 linhas",
      "objecao_provavel": "principal objeção + como responder",
      "segmentacao_meta": "quando houver anúncio, públicos/interesses"
    }
  }
]

REGRAS INEGOCIÁVEIS:
- Filtro precisa ter PELO MENOS UM critério.
- 3 ou 4 arquétipos com teses distintas.
- SÓ o JSON. Zero texto fora.
${contextoQuali ? `
CONTEXTO QUALITATIVO (reuniões e anotações do consultor · uso INTERNO):
${contextoQuali}

Como usar este contexto:
- REFINA teses e abordagem (motivação real do dono, restrições, compradores sugeridos, clientes-âncora).
- NUNCA aparece literalmente em material EXTERNO (angulo). Nomes de pessoas/empresas mencionados nas fontes são PROIBIDOS em QUALQUER campo do JSON.${sensivel && sensivel.length ? `
- Situações sensíveis detectadas: ${sensivel.join(', ')}. Isto orienta a tese/objeção INTERNAMENTE; NUNCA aparece em angulo/teaser.` : ''}` : ''}${cor}`;
}
function promptAbordagem(arq, fatos) {
  const bMult = [];
  if (fatos.multiplo_fat_str) bMult.push(`${fatos.multiplo_fat_str} sobre faturamento`);
  if (fatos.multiplo_ebitda_str) bMult.push(`${fatos.multiplo_ebitda_str} sobre EBITDA`);
  return `Regere APENAS o bloco 'abordagem' do arquétipo abaixo. Contexto do negócio (faixas + aritmética prontas):

- Setor: ${fatos.setor}
- Região (uso EXTERNO): ${fatos.regiao}
- Idade: ${fatos.idade_faixa} · Funcionários: ${fatos.func_faixa}
- Faturamento: ${fatos.fat_faixa} · EBITDA: ${fatos.ebitda_faixa} · Margem: ${fatos.margem_ebitda_str || '—'}
- Valor de venda: ${fatos.valor_venda_faixa} · ${bMult.join(' · ') || '(sem múltiplo calculável)'}

ARQUÉTIPO ATUAL:
nome: ${arq.nome}
tese: ${arq.tese}
filtro: ${JSON.stringify(arq.filtro)}

REGRAS ABSOLUTAS PRO CAMPO 'angulo' (primeira mensagem a lead FRIO):
- Nunca cite cidade exata (use SOMENTE "${fatos.regiao}").
- Pode citar em faixa: fat, EBITDA, idade, funcionários.
- PROIBIDO no angulo: valor de venda (nem exato nem em faixa),
  múltiplos (0,5×, 6×, etc.), padrões "R$ N-NM/k/mi/milhões".
  Preço vem em conversa avançada, não no primeiro contato.
- Sem razão social/sócio/CNPJ.
- NÃO-TRIANGULAÇÃO: setor específico + mesorregião "${fatos.regiao}" juntos
  identifica o ativo. Escolha um: ou mesorregião + setor genérico, ou setor
  específico + geografia macro ("Sul do Brasil", "interior de {UF}").

RETORNO · JSON estrito (só o objeto, sem markdown):
{ "angulo": "...", "objecao_provavel": "...", "segmentacao_meta": "..." }`;
}

// ═══ HANDLER ═══════════════════════════════════════════════════════════
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
  const pR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=id,valor_venda,descricao_negocio,cliente_nome,negocio_titulo,laudo_v2_id,cnpj`, { headers: H });
  const [p] = await pR.json();
  if (!p) return json(res, 404, { ok: false, erro: 'projeto não encontrado' });
  let calc = {};
  if (p.laudo_v2_id) {
    const lR = await fetch(`${SB_URL}/rest/v1/laudos_v2?id=eq.${p.laudo_v2_id}&select=calc_json`, { headers: H });
    const [l] = await lR.json();
    if (l?.calc_json) calc = l.calc_json;
  }
  if (!calc.valuation) return json(res, 422, { ok: false, erro: 'sem laudo vinculado · vincule antes de gerar arquétipos' });

  const val = calc.valuation || {}, op = calc.operacional || {}, idn = calc.identificacao || {};
  const cidade = idn.localizacao?.cidade || null;
  const uf = idn.localizacao?.estado || null;
  const fat = Number(op.fat_anual) || 0;
  const ebitda = Number(val.ro_anual) || 0;
  const valorVenda = p.valor_venda ? Number(p.valor_venda) : (Number(val.valor_venda) || 0);
  const anos = idn.tempo_operacao_anos || 0;
  const funcionarios = op.num_funcionarios || 0;
  const arit = calcularAritmetica(fat, ebitda, valorVenda);

  const fatos = {
    setor: idn.setor?.label || '—',
    regiao: derivarRegiao(cidade, uf),
    cidade_interna: cidade || null,
    uf: uf || null,
    idade_faixa: faixaIdade(anos),
    fat_faixa: faixaMonetaria(fat),
    ebitda_faixa: faixaMonetaria(ebitda),
    margem_ebitda_str: arit.margem_ebitda_str,
    func_faixa: faixaFuncionarios(funcionarios),
    concentracao: op.concentracao_status || '—',
    valor_venda_faixa: valorVenda > 0 ? faixaMonetaria(valorVenda) : 'faixa a discutir',
    multiplo_fat_str: arit.multiplo_fat_str,
    multiplo_ebitda_str: arit.multiplo_ebitda_str,
  };
  const proibidosGlobais = [
    p.cliente_nome, p.negocio_titulo, idn.nome, idn.razao_social, p.cnpj,
  ].filter(Boolean);
  if (p.cnpj) {
    const eR = await fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${p.cnpj}&select=razao_social,nome_fantasia,socios`, { headers: H });
    const [emp] = await eR.json();
    if (emp) {
      if (emp.razao_social) proibidosGlobais.push(emp.razao_social);
      if (emp.nome_fantasia) proibidosGlobais.push(emp.nome_fantasia);
      if (Array.isArray(emp.socios)) for (const s of emp.socios) if (typeof s === 'object' && s?.nome) proibidosGlobais.push(String(s.nome));
    }
  }
  const valoresExatos = [fat, ebitda, valorVenda].filter((v) => v > 0);
  const permitidosArit = [
    ...(arit.multiplo_fat != null ? [{ tipo: 'mult', valor: arit.multiplo_fat }] : []),
    ...(arit.multiplo_ebitda != null ? [{ tipo: 'mult', valor: arit.multiplo_ebitda }] : []),
    ...(arit.margem_ebitda != null ? [{ tipo: 'pct', valor: arit.margem_ebitda }] : []),
  ];

  // Fontes qualitativas · reuniões/anotações do consultor
  const fR = await fetch(`${SB_URL}/rest/v1/va_projeto_fontes?projeto_id=eq.${projeto_id}&select=id,tipo,titulo,conteudo,conteudo_destilado,formato_detectado,criado_em&order=criado_em.desc`, { headers: H });
  const fontes = (await fR.json()) || [];
  const contextoQuali = montarContextoQualitativo(fontes);
  const sensivel = detectarSituacaoSensivel(fontes);
  const termosFonte = extrairTermosProibidos(fontes);
  for (const t of termosFonte) proibidosGlobais.push(t);
  // Termos setoriais específicos (pra regra de não-triangulação no angulo)
  const setorTermos = derivarSetorTermos(calc, p.descricao_negocio);

  // ── MODO PARCIAL · regenerar abordagem
  if (arquetipo_id && blocoParcial === 'abordagem') {
    const aR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${arquetipo_id}&select=id,projeto_id,status,nome,tese,filtro,abordagem`, { headers: H });
    const [arq] = await aR.json();
    if (!arq || arq.projeto_id !== projeto_id) return json(res, 404, { ok: false, erro: 'arquétipo não pertence a este projeto' });
    if (arq.status !== 'rascunho') return json(res, 409, { ok: false, erro: 'regeneração só em rascunho' });
    let corrigir = null;
    for (let t = 0; t < 2; t++) {
      try {
        const raw = await chamarSonnet(promptAbordagem(arq, fatos) + (corrigir ? '\n\nCORREÇÃO: ' + corrigir : ''), 1500);
        const parsed = parseJsonEstrito(raw);
        const ok = parsed && typeof parsed === 'object'
          && typeof parsed.angulo === 'string'
          && typeof parsed.objecao_provavel === 'string'
          && typeof parsed.segmentacao_meta === 'string';
        if (!ok) { corrigir = 'JSON de abordagem inválido'; continue; }
        // Validação SÓ do angulo
        const nomes = detectarNomesEmQualquerLugar(parsed, proibidosGlobais);
        const vazam = detectarVazamentoAngulo(parsed.angulo, cidade, valoresExatos, permitidosArit, valorVenda);
        const tri = detectarTriangulacao(parsed.angulo, fatos.regiao, setorTermos);
        if (nomes.length || vazam.length || tri.length) {
          corrigir = [...nomes.map(n=>'nome proibido: '+n), ...vazam, ...tri].join(' · ');
          continue;
        }
        const upR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${arq.id}`, {
          method: 'PATCH', headers: H, body: JSON.stringify({ abordagem: parsed }),
        });
        if (!upR.ok) return json(res, 500, { ok: false, erro: 'update: ' + upR.status });
        return json(res, 200, { ok: true, modo: 'abordagem', arquetipo_id: arq.id, abordagem: parsed, tentativas: t + 1 });
      } catch (e) {
        return json(res, 502, { ok: false, erro: 'anthropic_fail', detalhe: String(e.message).slice(0, 300) });
      }
    }
    return json(res, 502, { ok: false, erro: 'violacao_persistente', detalhe: corrigir });
  }

  // ── MODO COMPLETO · lista
  const cR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${projeto_id}&status=neq.arquivado&select=id`, { headers: H });
  const nAtivos = (await cR.json()).length;
  if (nAtivos >= 5) return json(res, 409, { ok: false, erro: 'teto atingido · 5 arquétipos ativos · arquive antes de gerar novos' });
  const espaco = 5 - nAtivos;

  let corrigir = null;
  for (let t = 0; t < 2; t++) {
    try {
      const raw = await chamarSonnet(promptLista(fatos, p.descricao_negocio, contextoQuali, sensivel, corrigir));
      const parsed = parseJsonEstrito(raw);
      if (!Array.isArray(parsed)) { corrigir = 'esperava array JSON no topo'; continue; }
      if (parsed.length < 3 || parsed.length > 4) { corrigir = `esperava 3-4 arquétipos, recebi ${parsed.length}`; continue; }
      const problemas = [];
      for (let i = 0; i < parsed.length; i++) {
        const p2 = validarArquetipo(parsed[i]);
        if (p2) problemas.push(`[${i}] ${p2}`);
      }
      if (problemas.length) { corrigir = problemas.join('; '); continue; }
      // Validação de calibração · SÓ nos ângulos + nomes em qualquer lugar
      const calibProblems = [];
      for (let i = 0; i < parsed.length; i++) {
        const nomes = detectarNomesEmQualquerLugar(parsed[i], proibidosGlobais);
        if (nomes.length) calibProblems.push(`[${i}] nomes proibidos: ${nomes.join(', ')}`);
        const vaz = detectarVazamentoAngulo(parsed[i].abordagem.angulo, cidade, valoresExatos, permitidosArit, valorVenda);
        if (vaz.length) calibProblems.push(`[${i}] ${vaz.join(' · ')}`);
        const tri = detectarTriangulacao(parsed[i].abordagem.angulo, fatos.regiao, setorTermos);
        if (tri.length) calibProblems.push(`[${i}] ${tri.join(' · ')}`);
      }
      if (calibProblems.length) { corrigir = calibProblems.join(' · '); continue; }

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
      return json(res, 200, { ok: true, quantidade: inseridos.length, arquetipos: inseridos, tentativas: t + 1, fatos_usados: fatos });
    } catch (e) {
      return json(res, 502, { ok: false, erro: 'anthropic_fail', detalhe: String(e.message).slice(0, 300) });
    }
  }
  return json(res, 502, { ok: false, erro: 'violacao_persistente', detalhe: corrigir });
};
