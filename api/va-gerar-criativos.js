// /api/va-gerar-criativos · Slice P5 · Vercel Function (Node runtime, sem npm)
// Gera 3-4 variações de copy de criativo Meta via Sonnet · rascunhos em va_criativos
// (status='rascunho') · 1 débito ia_geracao_criativo por CHAMADA (não por variação).
// REGRAS: sem cidade exata, sem razão social, sem preço exato (ok faixa),
// sem afirmação regulatória, setor×geografia (regra 2.3), headline≤40, texto≤120, cta≤20.
// Auth: JWT admin.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

const {
  extrairTermosProibidos, detectarAfirmacaoRegulatoria,
  detectarTriangulacao, derivarSetorTermos, derivarRegiao, normSemAcento,
} = require('./_va_fontes.js');

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const c = []; for await (const x of req) c.push(x);
  const s = Buffer.concat(c).toString('utf8'); return s ? JSON.parse(s) : {};
}
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL + '/rest/v1/rpc/va_is_admin', {
    method:'POST', headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' }, body:'{}',
  });
  return r.ok && (await r.json()) === true;
}
const H = () => ({ apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json', Prefer:'return=representation' });

// Detecta vazamento (mesmo padrão do rascunhar-resposta · anúncio é PÚBLICO, régua máxima).
function detectarVazamento(texto, proibidos, cidadeExata) {
  const found = [];
  const t = String(texto || '').toLowerCase();
  for (const p of proibidos) {
    if (!p) continue;
    const n = String(p).trim().toLowerCase();
    if (n.length < 4) continue;
    if (t.includes(n)) found.push(`nome/id proibido: "${p}"`);
  }
  if (cidadeExata) {
    const cN = normSemAcento(cidadeExata);
    const tN = normSemAcento(texto);
    const re = new RegExp('\\b' + cN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (re.test(tN)) found.push(`cidade exata: "${cidadeExata}"`);
  }
  if (/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b/.test(texto)) found.push('CNPJ formatado');
  // R$ é PERMITIDO em criativo (faixa) · mas número absoluto com muitas casas indica valor exato
  // Regra: R$ 2-3M ok · R$ 2.850.000,00 não ok. Detecta valor com mais de 6 dígitos = suspeito.
  if (/R\$\s*[\d.]{7,}/i.test(texto)) found.push('valor absoluto (>6 dig · use faixa)');
  return found;
}

async function chamarClaude(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key': ANTHROPIC_KEY, 'anthropic-version':'2023-06-01', 'Content-Type':'application/json' },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1200,
      system: 'Você é copywriter sênior de anúncios do 1Negócio. Escreve copy curto de Meta Ads em português BR direto, sem enfeite, sem emoji. Tom editorial-tipográfico frio e factual · dado primeiro.',
      messages: [{ role:'user', content: prompt }],
    }),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch {}
  if (!r.ok) return { ok:false, erro:`anthropic_http_${r.status}`, detalhe: raw.slice(0,300) };
  return { ok:true, texto: d?.content?.[0]?.text || '' };
}

function montarPrompt({ arq, faixaValor, regiao, cidade, formato, incluirValor }) {
  return `
Você vai gerar 4 VARIAÇÕES de copy pra 1 anúncio Meta Ads (formato ${formato}).
O anúncio é PÚBLICO · régua máxima de sigilo.

CONTEXTO INTERNO (uso próprio · NÃO vaze):
- Cidade real (INTERNA · nunca cite): ${cidade || '—'}
- Região macro OK: ${regiao || '—'}

ARQUÉTIPO destino do anúncio:
- Nome: ${arq?.nome || '—'}
- Tese: ${arq?.tese || '—'}
- Ângulo (só como MUNIÇÃO · não copie): ${arq?.abordagem?.angulo || '—'}

FAIXA DE VALOR do ativo (${incluirValor ? 'USE em 2 das 4 variações' : 'NÃO cite valor'}):
${faixaValor || '(sem faixa · omita valor)'}

REGRAS ABSOLUTAS (violação → rejeição):
- SEM cidade exata (${cidade || '(sem cidade)'}). Use região macro.
- SEM razão social, sócio, CNPJ, marca proibida da fonte.
- SEM afirmação regulatória ("em dia com fisco", "sem passivos", "todas licenças").
- SE setor específico for citado, geografia embaça pra macro (regra 2.3 · não-triangulação).
- SEM valor absoluto (R$ 2.850.000). Faixa OK (R$ 2-3M).
- Copy frio, factual, DADO PRIMEIRO. Sem emoji. Sem urgência falsa.

LIMITES por formato:
- headline: até 40 caracteres
- texto: até 120 caracteres
- cta: até 20 caracteres (ex: "Quero saber", "Falar agora", "Ver detalhes")

Devolva JSON PURO (sem markdown, sem preâmbulo):
{
  "variacoes": [
    { "headline": "...", "texto": "...", "cta": "..." },
    { "headline": "...", "texto": "...", "cta": "..." },
    { "headline": "...", "texto": "...", "cta": "..." },
    { "headline": "...", "texto": "...", "cta": "..." }
  ]
}
`.trim();
}

function truncar(s, max) {
  s = String(s || '').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trim() + '…';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!ANTHROPIC_KEY) return json(res, 503, { ok:false, erro:'ANTHROPIC_API_KEY ausente' });
  if (!SB_SERVICE) return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { projeto_id, arquetipo_id, formato, layout, incluir_valor } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });
  const fmt = formato || 'feed_1080';
  if (!['feed_1080','story_1080x1920','link_1200x628'].includes(fmt)) {
    return json(res, 400, { ok:false, erro:'formato inválido' });
  }
  const lay = layout || 'tipografico_a';

  // Carrega projeto + arquétipo + fontes
  const [projR, arqR, fontesR] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=cidade,uf,valor_venda`, { headers: H() }),
    arquetipo_id ? fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${arquetipo_id}&select=id,nome,tese,abordagem,filtro`, { headers: H() }) : Promise.resolve({ json: async () => [] }),
    fetch(`${SB_URL}/rest/v1/va_projeto_fontes?projeto_id=eq.${projeto_id}&select=conteudo_destilado,conteudo,formato_detectado,tipo`, { headers: H() }),
  ]);
  const [proj] = await projR.json();
  const [arq]  = await arqR.json();
  const fontes = await fontesR.json();
  if (!proj) return json(res, 404, { ok:false, erro:'projeto não encontrado' });

  const cidade = proj?.cidade || null;
  const regiao = derivarRegiao(cidade, proj?.uf);
  const proibidos = extrairTermosProibidos(fontes || []);
  // Faixa de valor: se valor_venda estiver setado, gera faixa ±20%
  let faixaValor = null;
  if (proj?.valor_venda && Number(proj.valor_venda) > 0) {
    const v = Number(proj.valor_venda);
    const inf = Math.round(v * 0.8 / 1_000_000);
    const sup = Math.round(v * 1.2 / 1_000_000);
    faixaValor = inf === sup ? `R$ ${inf}M` : `R$ ${inf}-${sup}M`;
  }

  const prompt = montarPrompt({ arq, faixaValor, regiao, cidade, formato: fmt, incluirValor: !!incluir_valor });

  // Chama Sonnet + valida + até 1 retry
  let variacoes = null;
  let violGlobal = [];
  for (let tent = 1; tent <= 2; tent++) {
    const r = await chamarClaude(tent === 1 ? prompt : (prompt + `\n\nAJUSTE ANTERIOR: ${violGlobal.join(' · ')}. Regenere respeitando 100% as regras.`));
    if (!r.ok) return json(res, 502, { ok:false, erro: r.erro, detalhe: r.detalhe });
    // Parseia JSON
    let parsed = null;
    try {
      const t = r.texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/,'').trim();
      parsed = JSON.parse(t);
    } catch { }
    if (!parsed?.variacoes?.length) { violGlobal = ['formato inválido · Claude não devolveu JSON']; continue; }
    // Valida cada variação
    const setorTermos = derivarSetorTermos(null, arq?.abordagem?.angulo || '');
    const vlist = [];
    let algumaOk = false;
    for (const v of parsed.variacoes) {
      const texto = [v.headline, v.texto, v.cta].filter(Boolean).join(' · ');
      const vaz = detectarVazamento(texto, proibidos, cidade);
      const reg = detectarAfirmacaoRegulatoria(texto);
      const tri = detectarTriangulacao(texto, regiao, setorTermos);
      const viol = [...vaz, ...reg, ...tri];
      vlist.push({
        headline: truncar(v.headline, 40),
        texto:    truncar(v.texto, 120),
        cta:      truncar(v.cta, 20),
        violacoes: viol,
      });
      if (!viol.length) algumaOk = true;
    }
    if (algumaOk) { variacoes = vlist; break; }
    violGlobal = vlist.flatMap(v => v.violacoes);
    if (tent === 2) return json(res, 422, { ok:false, erro:'todas variações violam', detalhe: violGlobal.join(' · '), variacoes: vlist });
  }
  if (!variacoes) return json(res, 500, { ok:false, erro:'falha inesperada' });

  // Persiste rascunhos (só as sem violação)
  const inseridos = [];
  for (let i = 0; i < variacoes.length; i++) {
    const v = variacoes[i];
    if (v.violacoes.length) continue;
    const nome = `${arq?.nome ? arq.nome.slice(0,30) : 'Criativo'} · ${fmt} · var ${i+1}`;
    const ins = await fetch(`${SB_URL}/rest/v1/va_criativos`, {
      method:'POST', headers: H(),
      body: JSON.stringify({
        projeto_id, arquetipo_id: arq?.id || null,
        nome, tipo: 'estatico', formato: fmt, layout: lay,
        headline: v.headline, texto: v.texto, cta: v.cta,
        status: 'rascunho', origem: 'ia', versao: 1,
      }),
    });
    if (ins.ok) {
      const [row] = await ins.json();
      inseridos.push({ id: row?.id, ...v });
    }
  }

  // Débito ia_geracao_criativo (1 chamada = 1 débito, não por variação)
  let razaoId = null;
  try {
    const dR = await fetch(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
      method:'POST', headers: H(),
      body: JSON.stringify({
        p_projeto: projeto_id, p_tipo: 'ia_geracao_criativo', p_qtd: 1,
        p_referencia: `criativos:${(arq?.nome || 'ativo').slice(0,30)} · ${fmt}`,
        p_ciclo: null, p_excedente_autorizado: false,
      }),
    });
    if (dR.ok) razaoId = await dR.json();
  } catch (e) { console.error('debit ia_geracao_criativo:', e); }

  return json(res, 200, {
    ok: true,
    formato: fmt, layout: lay,
    variacoes: inseridos,
    variacoes_com_violacao: variacoes.filter(v => v.violacoes.length),
    razao_id: razaoId,
  });
};
