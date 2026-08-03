// /api/va-gerar-teaser · MANDATO · Zona ATIVO
// Gera teaser CEGO em markdown. Servidor pré-processa TUDO em faixas
// (fat, EBITDA, funcionários, região, idade) e calcula toda aritmética
// (múltiplos, margem). Prompt proíbe modelo de derivar números — só
// reproduzir. Valida saída: rejeita cidade exata, valores exatos e
// múltiplos/percentuais que não batem com os fatos injetados.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';
const { montarContextoQualitativo, extrairTermosProibidos, detectarSituacaoSensivel, derivarSetorTermos, detectarTriangulacao, ehRegiaoMacro, derivarRegiao, detectarAfirmacaoRegulatoria } = require('./_va_fontes.js');

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
async function chamarSonnet(prompt, maxTokens = 2000) {
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

// ═══ SIGILO POR FAIXAS ═══════════════════════════════════════════════
// Regra: banda em torno do valor com granularidade ~10-15%.
// Fat/EBITDA em milhões: step 1M; abaixo de 1M: step 100k. Idade: dezenas.
// Funcionários: banda de 10.
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
    const hi = lo + 100;
    return `R$ ${lo}–${hi}k`;
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
// derivarRegiao vem de _va_fontes.js (mapeamento centralizado + fallback "{UF}")

// ═══ ARITMÉTICA EM CÓDIGO ═══════════════════════════════════════════
// Calcula múltiplos e margem. Retorna string BR já formatada + o número
// pra validação posterior. NULL se não puder calcular com precisão.
function fmtMult(x) { return x == null ? null : x.toFixed(2).replace('.', ',') + '×'; }
function fmtPct(x) { return x == null ? null : x.toFixed(1).replace('.', ',') + '%'; }
function calcularAritmetica(fat, ebitda, valorVenda) {
  const out = { multiplo_fat: null, multiplo_ebitda: null, margem_ebitda: null,
                multiplo_fat_str: null, multiplo_ebitda_str: null, margem_ebitda_str: null };
  const _fat = Number(fat) || 0;
  const _ebitda = Number(ebitda) || 0;
  const _vv = Number(valorVenda) || 0;
  if (_fat > 0 && _ebitda > 0) {
    out.margem_ebitda = (_ebitda / _fat) * 100;
    out.margem_ebitda_str = fmtPct(out.margem_ebitda);
  }
  if (_vv > 0 && _fat > 0) {
    out.multiplo_fat = _vv / _fat;
    out.multiplo_fat_str = fmtMult(out.multiplo_fat);
  }
  if (_vv > 0 && _ebitda > 0) {
    out.multiplo_ebitda = _vv / _ebitda;
    out.multiplo_ebitda_str = fmtMult(out.multiplo_ebitda);
  }
  return out;
}

// ═══ VALIDAÇÃO ANTI-VAZAMENTO E ANTI-INVENÇÃO ═════════════════════════
// 1) Cidade exata do projeto (case + acento insensitive, boundary word)
// 2) Valores exatos do laudo (fat, ebitda, valor_venda) em qualquer
//    formato reconhecível (com ou sem R$, com separador . ou vírgula)
// 3) Nomes/CNPJ (já existia)
// 4) Múltiplos "N,Nx" ou percentuais "N,N%" devem estar entre os
//    permitidos (tolerância 0,15)
function detectarVazamento(texto, proibidosDiretos, cidadeExata, valoresExatos) {
  const found = [];
  const tLower = texto.toLowerCase();

  for (const p of proibidosDiretos) {
    if (!p) continue;
    const norm = String(p).trim().toLowerCase();
    if (norm.length < 4) continue;
    if (tLower.includes(norm)) found.push(`nome/id proibido: "${p}"`);
  }
  // Cidade exata (sem acento, boundary)
  if (cidadeExata) {
    const cNorm = normSemAcento(cidadeExata);
    const tNorm = normSemAcento(texto);
    const re = new RegExp('\\b' + cNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(tNorm)) found.push(`cidade exata: "${cidadeExata}"`);
  }
  // Valores exatos (>= 4 dígitos significativos)
  for (const raw of valoresExatos) {
    if (!raw || raw < 10000) continue;
    const n = Math.round(raw);
    // formas: 7.716.000 · 7716000 · 7.716 (milhares) · 7716k · 7,7M
    const compact = String(n);
    if (compact.length >= 5 && texto.includes(compact)) found.push(`valor exato: ${compact}`);
    // formato BR com pontos: 7.716.000
    const brFmt = n.toLocaleString('pt-BR');
    if (brFmt !== compact && texto.includes(brFmt)) found.push(`valor exato BR: ${brFmt}`);
  }
  // CNPJ formatado
  if (/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b/.test(texto)) found.push('CNPJ formatado');
  return found;
}
function detectarAritmeticaInvalida(texto, permitidos) {
  // Extrai "N,N×" e "N,N%" e checa contra permitidos.
  // Tolerância: pra múltiplos pequenos (< 1×) usar 0.05, pra maiores 0.15.
  const problemas = [];
  const permMult = permitidos.filter((x) => x.tipo === 'mult').map((x) => x.valor);
  const permPct = permitidos.filter((x) => x.tipo === 'pct').map((x) => x.valor);
  const fmtBR = (n) => n.toFixed(2).replace('.', ',') + '×';
  const fmtBRPct = (n) => n.toFixed(1).replace('.', ',') + '%';
  const reMult = /(\d+(?:[,.]\d+)?)\s*[xX×]/g;
  const rePct = /(\d+(?:[,.]\d+)?)\s*%/g;
  let m;
  while ((m = reMult.exec(texto)) !== null) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (!isFinite(v)) continue;
    if (permMult.length === 0) { problemas.push(`múltiplo "${m[0]}" citado mas NÃO EXISTEM múltiplos permitidos · REMOVA qualquer menção a "×" do texto`); continue; }
    const ok = permMult.some((p) => Math.abs(v - p) <= (p < 1 ? 0.05 : 0.15));
    if (!ok) problemas.push(`múltiplo "${m[0]}" INVENTADO · use EXATAMENTE ${permMult.map(fmtBR).join(' ou ')} (não arredonde, não invente outro)`);
  }
  while ((m = rePct.exec(texto)) !== null) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (!isFinite(v)) continue;
    if (permPct.length === 0) { problemas.push(`percentual "${m[0]}" citado mas NÃO EXISTEM percentuais permitidos · REMOVA qualquer "%" do texto`); continue; }
    const ok = permPct.some((p) => Math.abs(v - p) <= 0.5);
    if (!ok) problemas.push(`percentual "${m[0]}" INVENTADO · use EXATAMENTE ${permPct.map(fmtBRPct).join(' ou ')}`);
  }
  return problemas;
}

// ═══ PROMPT ═══════════════════════════════════════════════════════════
function promptTeaser(fatos, arqAprovados, contextoQuali, sensivel, corrigir) {
  const arqBlock = arqAprovados.length
    ? '\nARQUÉTIPOS APROVADOS (calibre o ângulo pra estes perfis):\n' +
      arqAprovados.map((a) => `- ${a.nome}: ${a.tese}`).join('\n')
    : '';
  const cor = corrigir ? '\nCORREÇÃO · a última tentativa violou uma regra: ' + corrigir + '\nRefaça respeitando estritamente o sigilo e a aritmética.' : '';
  const bMult = [];
  if (fatos.multiplo_fat_str) bMult.push(`${fatos.multiplo_fat_str} sobre faturamento`);
  if (fatos.multiplo_ebitda_str) bMult.push(`${fatos.multiplo_ebitda_str} sobre EBITDA`);
  const multStr = bMult.length ? bMult.join(' · ') : '(sem valor de venda definido pra calcular)';

  return `Escreva um teaser CEGO em markdown pra apresentar este negócio a compradores potenciais SEM revelar identidade.

FATOS DO NEGÓCIO (use apenas isto · faixas já pré-calculadas):
- Setor: ${fatos.setor}
- Região: ${fatos.regiao}
- Idade do negócio: ${fatos.idade_faixa}
- Faturamento anual: ${fatos.fat_faixa}
- EBITDA anual: ${fatos.ebitda_faixa}
- Margem EBITDA: ${fatos.margem_ebitda_str || '(não calculável)'}
- Funcionários: ${fatos.func_faixa}
- Concentração de clientes: ${fatos.concentracao}
- Valor de venda indicativo: ${fatos.valor_venda_faixa}
- Múltiplos (já calculados): ${multStr}${arqBlock}

REGRAS DE SIGILO (absolutas · qualquer violação → rejeição):
- NUNCA escrever: razão social, nome fantasia, nome de sócio, CNPJ, endereço, marca, domínio.
- NUNCA escrever cidade exata do negócio. Usar SOMENTE a "Região" acima (${fatos.regiao}).
- NUNCA usar valores exatos (ex.: R$ 7.716.000). Usar SOMENTE as faixas acima (ex.: ${fatos.fat_faixa}).
- A precisão vem pós-NDA. Aqui é banda deliberada.
- NÃO-AFIRMAÇÃO REGULATÓRIA: material externo NUNCA afirma nem nega status
  regulatório, licenças, conformidade fiscal/trabalhista/judicial · nem como
  problema, nem como qualidade. Zero: "licenciada", "regularizada", "sem
  passivos", "em conformidade", "em dia com", "alvará", "licença", "auditoria
  limpa", "compliance". Silêncio total · diligência é pós-NDA. Mesmo se o
  laudo atestar, OMITIR aqui.
- NÃO-TRIANGULAÇÃO: precisão setorial e geográfica são mutuamente exclusivas.
  Se o texto citar setor específico (ex.: cosméticos, insumos, farmacêutico,
  metalúrgico, alimentício etc.), a geografia embaça pra MACRO:
  "Sul/Sudeste/Norte/Nordeste/Centro-Oeste do Brasil", "interior de {UF}",
  "capital paulista", "Grande {qualquer}", "Distrito Federal".
  Combinação "setor específico + ${fatos.regiao}" é PROIBIDA em texto externo.
  Escolha um: ou usa a mesorregião (${fatos.regiao}) e mantém setor genérico,
  ou cita setor específico e embaça a geografia.

REGRAS DE ARITMÉTICA (absolutas):
- PROIBIDO calcular, derivar ou estimar qualquer número novo. Múltiplos e margem já vieram prontos.
- Se citar múltiplo, use exatamente: ${bMult.join(' ou ') || '(nenhum · não cite múltiplos)'}.
- Se citar margem, use exatamente: ${fatos.margem_ebitda_str || '(não calculável · não cite margem)'}.
- Não invente "×2", "cresce X%", "próximo de N". Só o que veio nos FATOS.

ESTRUTURA (markdown · sem H1):
## Resumo
1-2 linhas · setor, região, idade, tese.

## Números
Bullets · faturamento (faixa), EBITDA (faixa), margem, funcionários (faixa), concentração de clientes.

## Diferenciais operacionais
2-4 bullets ancorados nos FATOS.

## Perfil de comprador que faz sentido
1-3 linhas · ancorar nos arquétipos se houver.

## Ticket
1 linha · usar a faixa de valor de venda e os múltiplos exatos acima.

FORMATO: SÓ o markdown, sem preâmbulo, sem cerca de código.

HIERARQUIA DE INFORMAÇÃO (regra SOBERANA):
- Números (faturamento, EBITDA, margem, múltiplos, valor de venda, dívidas)
  vêm EXCLUSIVAMENTE dos FATOS do sistema acima. Nunca da fonte qualitativa.
- Se o sistema não tem um número, OMITA-O · nunca completar com valor da fonte.
- Em conflito entre fonte e sistema, o SISTEMA vence silenciosamente
  (não mencionar divergência no teaser).${contextoQuali ? `

CONTEXTO QUALITATIVO (reuniões e anotações · uso APENAS pra qualificar diferenciais):
${contextoQuali}

Como usar este contexto:
- REFINA "Diferenciais operacionais" e "Perfil de comprador que faz sentido"
  (maturidade, base de clientes, motivação genérica que possa ser dita cegamente).
- NUNCA reproduzir literalmente. Nomes de pessoas/empresas mencionados nas fontes
  são PROIBIDOS no teaser.${sensivel && sensivel.length ? `
- Situações sensíveis detectadas: ${sensivel.join(', ')}. Isto é contexto INTERNO
  · NUNCA aparece no teaser (nem dívida, nem fiscal, nem judicial, nem motivo
  de venda sensível).` : ''}` : ''}${cor}`;
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
  const { projeto_id } = body || {};
  if (!projeto_id) return json(res, 400, { ok: false, erro: 'projeto_id obrigatório' });

  const H = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };
  const pR = await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=id,cliente_nome,negocio_titulo,valor_venda,laudo_v2_id,cnpj`, { headers: H });
  const [p] = await pR.json();
  if (!p) return json(res, 404, { ok: false, erro: 'projeto não encontrado' });

  let calc = {};
  if (p.laudo_v2_id) {
    const lR = await fetch(`${SB_URL}/rest/v1/laudos_v2?id=eq.${p.laudo_v2_id}&select=calc_json`, { headers: H });
    const [l] = await lR.json();
    if (l?.calc_json) calc = l.calc_json;
  }
  if (!calc.valuation) return json(res, 422, { ok: false, erro: 'sem laudo vinculado · vincule antes de gerar teaser' });

  const arqR = await fetch(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${projeto_id}&status=eq.aprovado&select=nome,tese`, { headers: H });
  const arqs = await arqR.json();

  // ── EXTRAI DADOS-FONTE ────────────────────────────────────────────
  const val = calc.valuation || {}, op = calc.operacional || {}, idn = calc.identificacao || {}, dre = calc.dre || {};
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

  // Nomes/id proibidos (enriquecidos com va_empresas)
  const proibidos = [
    p.cliente_nome, p.negocio_titulo, idn.nome, idn.razao_social, p.cnpj,
  ].filter(Boolean);
  if (p.cnpj) {
    const eR = await fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${p.cnpj}&select=razao_social,nome_fantasia,socios`, { headers: H });
    const [emp] = await eR.json();
    if (emp) {
      if (emp.razao_social) proibidos.push(emp.razao_social);
      if (emp.nome_fantasia) proibidos.push(emp.nome_fantasia);
      if (Array.isArray(emp.socios)) {
        for (const s of emp.socios) if (typeof s === 'object' && s?.nome) proibidos.push(String(s.nome));
      }
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
  for (const t of extrairTermosProibidos(fontes)) proibidos.push(t);
  // Termos setoriais específicos (pra regra de não-triangulação)
  const setorTermos = derivarSetorTermos(calc, p.descricao_negocio);

  let corrigir = null, texto = '';
  for (let t = 0; t < 2; t++) {
    try {
      const raw = await chamarSonnet(promptTeaser(fatos, arqs, contextoQuali, sensivel, corrigir));
      texto = raw.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```$/i, '').trim();
      if (texto.length < 300) { corrigir = 'teaser curto demais'; continue; }

      const vazamento = detectarVazamento(texto, proibidos, cidade, valoresExatos);
      const aritmProblemas = detectarAritmeticaInvalida(texto, permitidosArit);
      const triProblemas = detectarTriangulacao(texto, fatos.regiao, setorTermos);
      const regProblemas = detectarAfirmacaoRegulatoria(texto);
      if (vazamento.length || aritmProblemas.length || triProblemas.length || regProblemas.length) {
        corrigir = [...vazamento, ...aritmProblemas, ...triProblemas, ...regProblemas].join(' · ');
        continue;
      }

      // próxima versão
      const uR = await fetch(`${SB_URL}/rest/v1/va_projeto_teaser?projeto_id=eq.${projeto_id}&select=versao&order=versao.desc&limit=1`, { headers: H });
      const arr = await uR.json();
      const vNum = (arr?.[0]?.versao || 0) + 1;
      const insR = await fetch(`${SB_URL}/rest/v1/va_projeto_teaser`, {
        method: 'POST', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify({
          projeto_id, versao: vNum, texto, status: 'rascunho', origem: 'ia',
          gerado_por: 'va-gerar-teaser/' + MODEL, gerado_em: new Date().toISOString(),
        }),
      });
      const inseridos = await insR.json();
      if (!insR.ok) return json(res, 500, { ok: false, erro: 'insert: ' + JSON.stringify(inseridos).slice(0, 300) });
      return json(res, 200, { ok: true, teaser: inseridos[0] || inseridos, tentativas: t + 1, fatos_usados: fatos });
    } catch (e) {
      return json(res, 502, { ok: false, erro: 'anthropic_fail', detalhe: String(e.message).slice(0, 300) });
    }
  }
  return json(res, 502, { ok: false, erro: 'violacao_persistente', detalhe: corrigir });
};
