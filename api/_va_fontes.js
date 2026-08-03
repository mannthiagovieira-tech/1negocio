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
      // (Regra "pistas contextuais" removida · gerava falsos positivos como
      //  "concorrente direta" → "direta". Cobertura via bold no destilado é
      //  suficiente pra marcas · o destilador consistentemente aplica **bold**
      //  em entidades relevantes.)
      // 3) CNPJ
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

// ═══ REGRA DE NÃO-TRIANGULAÇÃO (2.3) ═════════════════════════════════
// Em texto externo (teaser · angulo), precisão setorial e geográfica são
// mutuamente exclusivas. Setor específico + mesorregião = identifica.
// Regra: se setor específico for citado, geografia embaça pra macro.
//
// MACRO (OK com qualquer setor · não identifica sozinha):
//   "capital paulista", "Grande {qualquer}", "Distrito Federal",
//   "interior de {UF}", "Sul/Sudeste/Nordeste/Norte/Centro-Oeste do Brasil"
// MESO (NÃO citar junto com setor específico):
//   "Vale do Taquari", "serra gaúcha", "Vale do Rio Pardo",
//   "norte de SC", "oeste de SC", "Vale do Itajaí", "região de Campinas"

function ehRegiaoMacro(regiao) {
  if (!regiao) return true; // sem geo especificada = OK
  const r = String(regiao).toLowerCase().trim();
  return /^(grande\s|capital\s|distrito federal|interior de\s|sul do brasil|sudeste do brasil|nordeste do brasil|norte do brasil|centro-oeste)/i.test(r);
}

// Dicionário mínimo de setores/subsetores comuns que triangulam.
// Se o texto contiver qualquer destas palavras, considera "setor específico".
const SETORES_ESPECIFICOS = [
  'cosmético','cosméticos','cosmetico','cosmeticos','perfumaria','fragrância','fragrancia','fragrâncias','fragrancias',
  'insumo','insumos','farmacêutico','farmaceutico','têxtil','textil','confecção','confeccao',
  'metalúrgico','metalurgico','metal-mecânico','metal-mecanico','automotivo','autopeças','autopecas',
  'alimentício','alimenticio','alimentícia','alimenticia','bebida','bebidas','sucos','laticínios','laticinios',
  'plástico','plastico','plásticos','plasticos','embalagem','embalagens','madeireiro','moveleiro','movelaria',
  'calçadista','calcadista','couro','couros','eletrônico','eletronico','químico','quimico','química','quimica',
  'agrícola','agricola','pesqueiro','pesca','construção civil','construcao civil','logística','logistica',
];
function extrairSetorTermosDoTexto(txt) {
  if (!txt) return [];
  const t = String(txt).toLowerCase();
  const hits = new Set();
  for (const s of SETORES_ESPECIFICOS) if (t.includes(s)) hits.add(s);
  return Array.from(hits);
}
function derivarSetorTermos(calcJson, descricaoNegocio) {
  const s = new Set();
  const label = calcJson?.identificacao?.setor?.label;
  // Só adiciona label se for específico (não "Indústria"/"Serviços" genéricos)
  if (label && !/^(ind[úu]stria|serviços?|com[ée]rcio|agroneg[óo]cio|energia)$/i.test(label.trim())) {
    s.add(label.toLowerCase());
  }
  for (const t of extrairSetorTermosDoTexto(descricaoNegocio || '')) s.add(t);
  return Array.from(s);
}

// Detecta triangulação · retorna [] se OK, ou lista de conflitos.
// Uso: se o texto EXTERNO contém termo setorial específico E a regiao
// (fatos.regiao) é MESO (não macro), rejeita.
function detectarTriangulacao(textoExterno, regiao, setorTermos) {
  const problemas = [];
  if (!textoExterno || !regiao || ehRegiaoMacro(regiao)) return problemas;
  // Regiao MESO: verifica se aparece no texto
  const t = String(textoExterno).toLowerCase();
  const regNorm = String(regiao).toLowerCase();
  if (!t.includes(regNorm)) return problemas; // mesorregião nem foi citada
  // Achou meso · vê se junto tem setor específico
  const setoresNoTexto = extrairSetorTermosDoTexto(textoExterno);
  const listaSetor = (setorTermos && setorTermos.length ? setorTermos : setoresNoTexto);
  const hitsSetor = setoresNoTexto.filter((s) => listaSetor.some((x) => x.includes(s) || s.includes(x)));
  if (hitsSetor.length) {
    problemas.push(
      `triangulação: mesorregião "${regiao}" + setor específico (${hitsSetor.join(', ')}) · embace a geografia pra macro (ex.: "Sul do Brasil", "interior de ${_extrairUF(regiao) || 'UF'}")`
    );
  }
  return problemas;
}
function _extrairUF(regiao) {
  // Tenta extrair UF do nome ("norte de SC" → SC). Fallback null.
  const m = String(regiao || '').match(/\b([A-Z]{2})\b/);
  return m ? m[1] : null;
}

// ═══ GEOGRAFIA (2.4) ══════════════════════════════════════════════════
// Mapeamento cidade→região metropolitana. Fallback NÃO usa "interior de UF"
// (assume o que não sabe) · devolve só a UF (honesto sobre a incerteza).
const REGIOES_MAP = {
  // SC · Grande Floripa · Vale do Itajaí · norte/oeste
  'florianopolis-sc':'Grande Florianópolis','sao jose-sc':'Grande Florianópolis',
  'palhoca-sc':'Grande Florianópolis','biguacu-sc':'Grande Florianópolis',
  'joinville-sc':'norte de SC',
  'blumenau-sc':'Vale do Itajaí','itajai-sc':'Vale do Itajaí','balneario camboriu-sc':'Vale do Itajaí',
  'chapeco-sc':'oeste de SC',
  // SP · Grande São Paulo · região de Campinas
  'sao paulo-sp':'Grande São Paulo','guarulhos-sp':'Grande São Paulo',
  'sao bernardo do campo-sp':'Grande São Paulo','santo andre-sp':'Grande São Paulo',
  'sao caetano do sul-sp':'Grande São Paulo','diadema-sp':'Grande São Paulo',
  'osasco-sp':'Grande São Paulo','barueri-sp':'Grande São Paulo',
  'maua-sp':'Grande São Paulo','ribeirao pires-sp':'Grande São Paulo',
  'campinas-sp':'região de Campinas',
  // RJ · Grande Rio
  'rio de janeiro-rj':'Grande Rio','niteroi-rj':'Grande Rio','sao goncalo-rj':'Grande Rio',
  'duque de caxias-rj':'Grande Rio','nova iguacu-rj':'Grande Rio',
  'sao joao de meriti-rj':'Grande Rio','belford roxo-rj':'Grande Rio',
  // MG · Grande BH
  'belo horizonte-mg':'Grande BH','contagem-mg':'Grande BH','betim-mg':'Grande BH',
  'ribeirao das neves-mg':'Grande BH',
  // RS · Grande Porto Alegre · serra · vales
  'porto alegre-rs':'Grande Porto Alegre','canoas-rs':'Grande Porto Alegre',
  'gravatai-rs':'Grande Porto Alegre','viamao-rs':'Grande Porto Alegre',
  'novo hamburgo-rs':'Grande Porto Alegre','sao leopoldo-rs':'Grande Porto Alegre',
  'alvorada-rs':'Grande Porto Alegre',
  'caxias do sul-rs':'serra gaúcha','bento goncalves-rs':'serra gaúcha',
  'santa cruz do sul-rs':'Vale do Rio Pardo',
  'lajeado-rs':'Vale do Taquari','teutonia-rs':'Vale do Taquari',
  'estrela-rs':'Vale do Taquari','encantado-rs':'Vale do Taquari',
  // PR · Grande Curitiba
  'curitiba-pr':'Grande Curitiba','sao jose dos pinhais-pr':'Grande Curitiba',
  'colombo-pr':'Grande Curitiba','pinhais-pr':'Grande Curitiba',
  // BA · Grande Salvador
  'salvador-ba':'Grande Salvador','lauro de freitas-ba':'Grande Salvador',
  'camacari-ba':'Grande Salvador','simoes filho-ba':'Grande Salvador',
  // PE · Grande Recife
  'recife-pe':'Grande Recife','jaboatao dos guararapes-pe':'Grande Recife',
  'olinda-pe':'Grande Recife','paulista-pe':'Grande Recife',
  // CE · Grande Fortaleza
  'fortaleza-ce':'Grande Fortaleza','caucaia-ce':'Grande Fortaleza',
  'maracanau-ce':'Grande Fortaleza',
  // DF
  'brasilia-df':'Distrito Federal',
  // GO · Grande Goiânia
  'goiania-go':'Grande Goiânia','aparecida de goiania-go':'Grande Goiânia',
  // Outras
  'manaus-am':'Grande Manaus','belem-pa':'Grande Belém',
  'vitoria-es':'Grande Vitória','vila velha-es':'Grande Vitória','serra-es':'Grande Vitória',
  'natal-rn':'Grande Natal','joao pessoa-pb':'Grande João Pessoa',
  'maceio-al':'Grande Maceió','aracaju-se':'Grande Aracaju',
  'sao luis-ma':'Grande São Luís','teresina-pi':'Grande Teresina',
  'campo grande-ms':'Grande Campo Grande','cuiaba-mt':'Grande Cuiabá',
};
function normSemAcento(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function derivarRegiao(cidade, uf) {
  const ufSafe = (uf || '').toUpperCase();
  if (!cidade) return ufSafe ? `Estado de ${ufSafe}` : '—';
  const key = `${normSemAcento(cidade)}-${ufSafe.toLowerCase()}`;
  return REGIOES_MAP[key] || (ufSafe ? ufSafe : '—');
}

// ═══ NÃO-AFIRMAÇÃO REGULATÓRIA (2.4) ═════════════════════════════════
// Material externo (teaser · angulo) NÃO afirma nem nega status regulatório.
// Diligência é pós-NDA. Mesmo com laudo dizendo "sem passivos", omitir.
// Tese/objecao (internos) PODEM tratar como fator de risco/precificação.
// Regex sem \b em bordas com acento (JS \b só reconhece [a-zA-Z0-9_]).
// Uso [\s.,;:!?)(] ou início/fim de string como delimitador.
const TERMOS_REGULATORIOS = [
  /(?:^|[\s.,;:!?)(])licenciad[oa]s?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])regulariz[aei][a-záàâãéêíóôõúç]*(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])em\s+conformidade(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])em\s+dia\s+com(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])alvar[áa]s?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])licen[çc]as?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])sem\s+passivos?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])sem\s+d[íi]vidas?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])sem\s+processos?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])habilitad[oa]s?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])certificad[oa]s?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])autorizad[oa]s?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])anvisa(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])regulamentad[oa]s?(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])compliance(?=[\s.,;:!?)(]|$)/i,
  /(?:^|[\s.,;:!?)(])audit(?:oria|ada)\s+limpa(?=[\s.,;:!?)(]|$)/i,
];
function detectarAfirmacaoRegulatoria(texto) {
  const problemas = [];
  if (!texto) return problemas;
  for (const re of TERMOS_REGULATORIOS) {
    const m = texto.match(re);
    if (m) problemas.push(`asserção regulatória: "${m[0]}" · diligência é pós-NDA, remova`);
  }
  return problemas;
}

module.exports = {
  TETO_CHARS_CONTEXTO,
  detectarFormatoReuniao,
  limparConteudoGemini,
  sanitizarConteudoParaSalvar,
  montarContextoQualitativo,
  extrairTermosProibidos,
  detectarSituacaoSensivel,
  ehRegiaoMacro,
  derivarSetorTermos,
  detectarTriangulacao,
  derivarRegiao,
  REGIOES_MAP,
  detectarAfirmacaoRegulatoria,
};
