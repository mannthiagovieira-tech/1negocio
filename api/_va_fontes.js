// _va_fontes.js · helpers compartilhados por va-gerar-arquetipos, va-gerar-teaser,
// va-projeto-fontes e va-destilar-fonte. Node CJS. Sem estado.
//
// FORMATOS DE REUNIÃO DETECTADOS (adendo v2):
//   (a) 'gemini'     → anotações estruturadas (Resumo/Próximas etapas/Detalhes).
//                      Limpeza determinística no salvamento.
//   (b) 'transcript' → transcript bruto (timestamps HH:MM:SS + "Nome: fala").
//                      Precisa destilação por IA (endpoint separado).
//   (c) 'livre'      → texto livre. Salva como está, sem processamento.

const TETO_CHARS_CONTEXTO = 20_000;

// ═══ DETECÇÃO DE FORMATO ══════════════════════════════════════════════
function detectarFormatoReuniao(raw) {
  if (!raw) return 'livre';
  const s = String(raw);
  const temSecoesGemini =
    /^\s*(?:#{1,3}\s*|\*\*)?(?:Resumo|Pr[óo]ximas?\s+etapas?|Detalhes)\b/mi.test(s);
  if (temSecoesGemini) return 'gemini';
  // Transcript: timestamps + falas com nome. Aceita 3 formatos comuns:
  //   "[HH:MM:SS] Nome: fala"
  //   "HH:MM Nome: fala"
  //   "Nome (HH:MM): fala"
  const linhas = s.split(/\r?\n/).slice(0, 400);
  const reFalaComTs = /^(?:\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s+)?[A-Za-zÀ-ÿ][\wÀ-ÿ\s.()]{1,40}:\s+\S/;
  const linhasComTimestamp = linhas.filter((l) => /\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(l)).length;
  const linhasComFala = linhas.filter((l) => reFalaComTs.test(l)).length;
  const parecTranscript = linhasComTimestamp >= 3 && linhasComFala >= 5;
  if (parecTranscript) return 'transcript';
  return 'livre';
}

// ═══ LIMPEZA (formato gemini) ═════════════════════════════════════════
function limparConteudoGemini(raw) {
  if (!raw) return { limpo: '', originalLen: 0, aproveitados: 0 };
  const original = String(raw);
  const originalLen = original.length;
  let s = original;

  // Descarta transcrição crua anexada após as anotações
  const idxTranscricao = s.search(/\n\s*(?:##\s*)?Transcri[çc][ãa]o\b/i);
  if (idxTranscricao > 800) s = s.slice(0, idxTranscricao).trimEnd();

  // Boilerplate final do Gemini
  const padroesBoiler = [
    /\n[^\n]*Revise as anota[çc][õo]es[\s\S]*/i,
    /\n[^\n]*qualtrics\.com[\s\S]*/i,
    /\n[^\n]*(?:Feedback do Gemini|Compartilhe suas opini[õo]es)[^\n]{0,120}$/i,
    /\n[^\n]*Powered by Gemini[\s\S]*/i,
  ];
  for (const re of padroesBoiler) s = s.replace(re, '');

  s = s.trim();
  return { limpo: s, originalLen, aproveitados: s.length };
}

// ═══ SANITIZAÇÃO AO SALVAR ════════════════════════════════════════════
// Chamado pelo endpoint POST /api/va-projeto-fontes.
// Retorna: { limpo, originalLen, aproveitados, formato, precisaDestilacao }
function sanitizarConteudoParaSalvar(tipo, raw) {
  if (tipo !== 'reuniao') {
    const s = String(raw || '').trim();
    return { limpo: s, originalLen: s.length, aproveitados: s.length, formato: null, precisaDestilacao: false };
  }
  const formato = detectarFormatoReuniao(raw);
  if (formato === 'gemini') {
    const c = limparConteudoGemini(raw);
    return { ...c, formato, precisaDestilacao: false };
  }
  if (formato === 'transcript') {
    // Transcript bruto entra como está · destilação IA acontece em endpoint separado
    const s = String(raw || '').trim();
    return { limpo: s, originalLen: s.length, aproveitados: s.length, formato, precisaDestilacao: true };
  }
  const s = String(raw || '').trim();
  return { limpo: s, originalLen: s.length, aproveitados: s.length, formato: 'livre', precisaDestilacao: false };
}

// ═══ MONTA CONTEXTO PRO PROMPT DAS GERAÇÕES ═══════════════════════════
// Consome cada fonte usando conteudo_destilado quando existir (mais denso),
// senão o conteudo (limpo). Ordena por criado_em DESC. Trunca ao teto 20k
// com marcador. Dentro do formato Gemini, prioriza Detalhes > Próximas > Resumo.
function _extrairSecoesGemini(texto) {
  const out = { detalhes: '', proximas: '', resumo: '', outros: '' };
  if (!texto) return out;
  const labels = [
    { key: 'detalhes', re: /^\s*(?:#{1,3}\s*|\*\*)?Detalhes\b\**\s*:?\s*$/im },
    { key: 'proximas', re: /^\s*(?:#{1,3}\s*|\*\*)?Pr[óo]ximas?\s+etapas?\b\**\s*:?\s*$/im },
    { key: 'resumo',   re: /^\s*(?:#{1,3}\s*|\*\*)?Resumo\b\**\s*:?\s*$/im },
  ];
  const linhas = texto.split(/\r?\n/);
  const indices = labels.map(({ key, re }) => {
    const idx = linhas.findIndex((l) => re.test(l));
    return { key, idx };
  }).filter((x) => x.idx >= 0).sort((a, b) => a.idx - b.idx);
  if (indices.length === 0) { out.outros = texto; return out; }
  for (let i = 0; i < indices.length; i++) {
    const { key, idx } = indices[i];
    const fim = i + 1 < indices.length ? indices[i + 1].idx : linhas.length;
    out[key] = linhas.slice(idx + 1, fim).join('\n').trim();
  }
  if (indices[0].idx > 0) out.outros = linhas.slice(0, indices[0].idx).join('\n').trim();
  return out;
}

// Remove do destilado a seção "CONTEXTO DE NEGOCIAÇÃO" antes de injetar
// pras gerações. Regra soberana: números vêm SÓ do sistema, não da fonte.
function _stripSecaoNegociacao(texto) {
  if (!texto) return texto;
  // Aceita "## CONTEXTO DE NEGOCIAÇÃO ..." ou variações (bold, sem markdown)
  const re = /^\s*(?:#{1,3}\s*|\*\*)?CONTEXTO\s+DE\s+NEGOCIA[ÇC][ÃA]O[^\n]*$/im;
  const linhas = texto.split(/\r?\n/);
  const idx = linhas.findIndex((l) => re.test(l));
  if (idx < 0) return texto;
  // Descobre onde termina esta seção: próxima linha "## ..." (mesmo nível)
  const reOutraSecao = /^\s*(?:#{1,3}\s*|\*\*)?[A-ZÁÊÇÕ][A-Z\sÁÊÇÕÔÍÚÂÀÃÉÓÔ]{2,}[^\n]*$/;
  let fim = linhas.length;
  for (let i = idx + 1; i < linhas.length; i++) {
    if (reOutraSecao.test(linhas[i]) && !/^\s*[-*·•]/.test(linhas[i])) { fim = i; break; }
  }
  return [...linhas.slice(0, idx), ...linhas.slice(fim)].join('\n').trim();
}

function montarContextoQualitativo(fontes) {
  const blocos = [];
  let total = 0;
  for (const f of fontes) {
    const usaDestilado = !!f.conteudo_destilado;
    let raw = usaDestilado ? f.conteudo_destilado : (f.conteudo || '');
    // Nunca injetar CONTEXTO DE NEGOCIAÇÃO no material das gerações
    if (usaDestilado) raw = _stripSecaoNegociacao(raw);
    if (!raw.trim()) continue;
    const cabec = `[${f.tipo}${f.titulo ? ' · ' + f.titulo : ''}${f.criado_em ? ' · ' + f.criado_em.slice(0, 10) : ''}${usaDestilado ? ' · destilado' : ''}]`;
    let body;
    if (usaDestilado || f.formato_detectado === 'transcript' || f.tipo !== 'reuniao') {
      body = raw;
    } else if (f.formato_detectado === 'gemini' ||
               /\bDetalhes\b|\bResumo\b|\bPr[óo]ximas etapas\b/i.test(raw)) {
      const secs = _extrairSecoesGemini(raw);
      const partes = [];
      if (secs.detalhes) partes.push('DETALHES:\n' + secs.detalhes);
      if (secs.proximas) partes.push('PRÓXIMAS ETAPAS:\n' + secs.proximas);
      if (secs.resumo) partes.push('RESUMO:\n' + secs.resumo);
      if (secs.outros && !partes.length) partes.push(secs.outros);
      else if (secs.outros) partes.push('CABEÇALHO:\n' + secs.outros);
      body = partes.join('\n\n');
    } else {
      body = raw;
    }
    const bloco = cabec + '\n' + body.trim();
    if (total + bloco.length + 20 > TETO_CHARS_CONTEXTO) {
      const restante = TETO_CHARS_CONTEXTO - total - 30;
      if (restante > 200) {
        blocos.push(bloco.slice(0, restante) + '\n[...truncado por limite de contexto]');
      } else {
        blocos.push('[...truncado · ' + (fontes.length - blocos.length) + ' fonte(s) omitida(s)]');
      }
      break;
    }
    blocos.push(bloco);
    total += bloco.length + 2;
  }
  return blocos.join('\n\n───────────────\n\n');
}

// ═══ TERMOS PROIBIDOS EXTRAÍDOS DA FONTE ══════════════════════════════
// Nomes próprios de pessoas/empresas + CNPJs mencionados. Se houver
// conteudo_destilado (transcript), a seção RESTRIÇÕES é enriquecida.
// Stoplist geográfica · nomes de cidade/estado brasileiros comuns.
// Não bloquear estes como "nome proibido" — são referências geográficas
// necessárias (as gerações citam "Grande Porto Alegre", "capital paulista" etc).
const STOPLIST_GEO = new Set([
  'Porto Alegre','São Paulo','Rio de Janeiro','Belo Horizonte','Curitiba','Salvador',
  'Recife','Fortaleza','Brasília','Goiânia','Manaus','Belém','Florianópolis','Vitória',
  'Natal','João Pessoa','Maceió','Aracaju','São Luís','Teresina','Palmas','Cuiabá',
  'Campo Grande','Rio Branco','Porto Velho','Boa Vista','Macapá','Caxias do Sul',
  'Santa Cruz do Sul','Vale do Taquari','Vale do Itajaí','Grande Florianópolis',
  'Grande Rio','Grande Porto Alegre','Grande BH','Grande Curitiba','Grande Salvador',
  'Grande Recife','Grande Fortaleza','Distrito Federal','Grande Goiânia',
  'Rio Grande','São Paulo','Minas Gerais','Santa Catarina','Rio Grande do Sul',
  'Rio Grande do Norte','Mato Grosso','Mato Grosso do Sul','Espírito Santo',
]);
const STOPLIST_LABEL_DESTILADO = new Set([
  'Detalhes','Resumo','Próximas Etapas','Proximas Etapas','Reunião','Reuniao',
  'Transcrição','Transcricao','Compradores','Contexto','Fontes','Anotações',
  'Anotacoes','Bloco','Capítulo','Documento','Fatos','Motivação','Restrições',
  'Expectativa','Ações Combinadas','Acoes Combinadas','Fatos de Negócio',
  'Fatos de Negocio','Motivação de Venda','Motivacao de Venda',
  'Restrições e Sigilo','Restricoes e Sigilo','Contexto de Negociação',
  'Contexto de Negociacao',
]);
function extrairTermosProibidos(fontes) {
  const proibidos = new Set();
  const add = (raw) => {
    const cand = String(raw || '').trim();
    if (!cand) return;
    if (STOPLIST_LABEL_DESTILADO.has(cand)) return;
    if (STOPLIST_GEO.has(cand)) return;
    if (/^\s+[A-Z]{2}\s+$/.test(cand)) return;
    if (cand.length >= 4 && cand.length <= 60) proibidos.add(cand);
  };
  for (const f of fontes) {
    const textos = [f.conteudo_destilado || '', f.conteudo || ''];
    for (const txt of textos) {
      if (!txt) continue;
      // 1) Palavras isoladas em **negrito** no destilado (ex.: **Quimibras**,
      //    **Natura**). O destilador tende a marcar entidades relevantes.
      const reBoldSingle = /\*\*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÀ-ÿ]{3,30})\*\*/g;
      let m;
      while ((m = reBoldSingle.exec(txt)) !== null) add(m[1]);
      // 2) Nomes próprios de 2-4 palavras (heurística original)
      const reNomes = /\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+(?:d[aeoi]s?|d[oa]s?|von|van|del|la|el|y)?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+){1,3})\b/g;
      while ((m = reNomes.exec(txt)) !== null) {
        const cand = m[1].trim();
        if (cand.length >= 8) add(cand);
      }
      // 3) Nomes/marcas após pistas explícitas ("concorrente X", "empresa X",
      //    "cliente X", "fornecedor X", "blacklist: X"). Pega palavra única.
      const rePistas = /\b(?:concorrente|empresa|cliente|fornecedor|marca|blacklist(?:\s*absoluta)?:?)\s+([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-Za-zÀ-ÿ]{3,30})\b/gi;
      while ((m = rePistas.exec(txt)) !== null) add(m[1]);
      // 4) CNPJ
      const reCnpj = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g;
      while ((m = reCnpj.exec(txt)) !== null) proibidos.add(m[0]);
    }
  }
  return Array.from(proibidos);
}

function detectarSituacaoSensivel(fontes) {
  const flags = new Set();
  const patterns = [
    { key: 'divida',   re: /\b(d[íi]vida|inadimpl|renegocia|serasa|scpc|protesto|passivo trabalhista|passivo fiscal)\b/i },
    { key: 'judicial', re: /\b(processo (judicial|trabalhista)|a[çc][ãa]o judicial|reclama[çc][ãa]o trabalhista|liminar|tj[a-z]{2}\b)/i },
    { key: 'motivo_venda_sensivel', re: /\b(doen[çc]a|separa[çc][ãa]o|sa[íi]da de s[óo]cio|conflito societ[áa]rio|briga|falec)/i },
    { key: 'nao_pode_saber', re: /\b(n[ãa]o pode(?:r|m)? saber|manter em sigilo|blacklist|evitar\s+(?:que|o))/i },
  ];
  for (const f of fontes) {
    const t = (f.conteudo_destilado || '') + '\n' + (f.conteudo || '');
    for (const { key, re } of patterns) if (re.test(t)) flags.add(key);
  }
  return Array.from(flags);
}

module.exports = {
  TETO_CHARS_CONTEXTO,
  detectarFormatoReuniao,
  limparConteudoGemini,
  sanitizarConteudoParaSalvar,
  montarContextoQualitativo,
  extrairTermosProibidos,
  detectarSituacaoSensivel,
};
