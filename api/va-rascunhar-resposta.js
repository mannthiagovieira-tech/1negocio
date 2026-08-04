// /api/va-rascunhar-resposta · Vercel Function
// P4.1 · IA rascunha resposta a um lead que respondeu.
// Reusa pipeline de validação de sigilo do _va_fontes.js.
// Auth: JWT admin. NÃO envia. Só devolve rascunho + validação.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';
const {
  extrairTermosProibidos, detectarAfirmacaoRegulatoria,
  detectarSituacaoSensivel, detectarTriangulacao, derivarSetorTermos,
  ehRegiaoMacro, derivarRegiao, normSemAcento,
} = require('./_va_fontes.js');

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json');
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
    method:'POST', headers:{ apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' }, body:'{}',
  });
  return r.ok && (await r.json()) === true;
}

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
  // qualquer padrão monetário R$ · rascunho de resposta NÃO menciona preço/valor
  if (/R\$\s*\d/i.test(texto)) found.push('valor em R$');
  if (/\d+(?:[,.]\d+)?\s*[xX×]\b/.test(texto)) found.push('múltiplo N×');
  return found;
}

async function chamarClaude({ prompt }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type':'application/json',
    },
    body: JSON.stringify({
      model: MODEL, max_tokens: 400,
      system: 'Você é assessor sênior de M&A do 1Negócio. Escreve respostas WhatsApp em português BR direto, sem enfeite. 2-4 frases. Nada de emoji.',
      messages: [{ role:'user', content: prompt }],
    }),
  });
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw); } catch {}
  if (!r.ok) return { ok:false, erro:`anthropic_http_${r.status}`, detalhe: raw.slice(0,300) };
  const texto = d?.content?.[0]?.text || '';
  return { ok:true, texto: String(texto).trim() };
}

function montarPrompt({ lead, arq, msgs, ctxQualitativo, regiao, cidade }) {
  const cargoRegistrado = lead.contato_cargo || null;
  const contatoNome = lead.contato_nome ? `${lead.contato_nome}${cargoRegistrado?` (${cargoRegistrado})`:''}` : '(não identificado)';
  const historico = msgs.map(m => `[${new Date(m.recebida_em).toISOString().slice(11,16)}] ${m.corpo || '(vazio)'}`).join('\n') || '(sem mensagens registradas — última tentativa registrada foi seu toque)';
  const nomeFmt = (lead.nome_fantasia || lead.razao_social || '')
    .split(/\s+/).map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ') || 'Prezado(a)';
  // Dica de classificação · o operador pode ter registrado cargo no drawer
  const dicaCargo = cargoRegistrado === 'dono_socio' ? 'DONO_OU_SOCIO (confirmado pelo operador)'
                  : cargoRegistrado ? `TERCEIRO (cargo="${cargoRegistrado}" registrado pelo operador)`
                  : 'DESCONHECIDO (classifique pelas mensagens abaixo)';
  return `
Você recebeu uma resposta a um toque frio de WhatsApp e vai rascunhar UMA resposta curta.

Antes de escrever, CLASSIFIQUE quem está do outro lado em 1 de 2 caminhos:

CAMINHO (a) DONO OU SÓCIO — sinais: "sim sou o dono", "aqui é o [nome], sócio", pergunta sobre valor/oportunidade em 1ª pessoa, decisão própria ("me interessa", "quanto?"). Nesse caminho, escreva:
- Apresentação curta: "Sou Thiago Mann, do 1Negócio · assessoria de M&A pra PMEs."
- Tese do arquétipo em UMA frase (por que faria sentido pra ESSE PERFIL de comprador conversar sobre um caso do setor · derivar da tese/ângulo abaixo).
- Pergunta de permissão pra avançar (ex: "posso te contar em 5 min o formato do caso, sob confidencialidade?" ou "faz sentido a gente marcar 15 min?").
- NADA de preço, cidade exata, razão social, sócios, CNPJ, marca proibida.

CAMINHO (b) FUNCIONÁRIO OU TERCEIRO — sinais: "aqui é a atendente/recepção", "o dono não está", cargo operacional. Nesse caminho, escreva:
- Cordial e breve, pedindo o contato direto do proprietário (nome/WhatsApp/melhor horário).
- NÃO revele o assunto ("venda", "aquisição", "oportunidade de negócio", "assessoria de M&A"). Trate como "um assunto pra alinhar diretamente com o dono/sócio".
- Sem urgência, sem enfeite, sem detalhes.

CLASSIFICAÇÃO SUGERIDA (pode divergir se as mensagens apontarem outra coisa): ${dicaCargo}

CONTEXTO INTERNO (uso próprio · não vaze):
- Setor: ${arq?.filtro?.cnaes?.length ? 'derivado do CNAE' : '—'}
- Região macro: ${regiao || '—'}
- Cidade real (INTERNA · nunca cite): ${cidade || '—'}

ARQUÉTIPO deste lead (base pra tese em caminho A):
- Nome: ${arq?.nome || '—'}
- Tese: ${arq?.tese || '—'}
- Ângulo (só como MUNIÇÃO · não copie literal): ${arq?.abordagem?.angulo || '—'}
- Objeção provável: ${arq?.abordagem?.objecao_provavel || '—'}

LEAD:
- Empresa: ${nomeFmt}
- Contato: ${contatoNome}
- Última(s) mensagem(ns) recebida(s):
${historico}

${ctxQualitativo ? `INFORMAÇÕES QUALITATIVAS DAS FONTES (não copiar literal):\n${ctxQualitativo}\n` : ''}
REGRAS ABSOLUTAS (violação → rejeição · valem pros dois caminhos):
- SEM preço, valor de venda, faturamento, múltiplos ou percentuais numéricos.
- SEM cidade exata (${cidade || '(sem cidade)'}).
- SEM razão social, sócio, CNPJ, marca proibida da fonte.
- SEM afirmação regulatória (licenças, alvará, "em dia com", "sem passivos" etc).
- SE setor específico for citado, geografia embaça pra macro (regra 2.3).
- Tom: consultor sênior brasileiro. 2 a 4 frases. Sem emoji.
- Sem prometer nada absoluto. Sem urgência falsa.
- Se a resposta é apenas confirmação ("Recebido", "Vi"), agradece brevemente e propõe 15 min sob NDA — trate como caminho A.

RETORNO: só o texto da mensagem (sem preâmbulo, sem "Caminho A/B", sem markdown, sem aspas).
`.trim();
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return json(res, 405, { ok:false });
  const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!ANTHROPIC_KEY) return json(res, 503, { ok:false, erro:'ANTHROPIC_API_KEY ausente' });
  if (!SB_SERVICE)    return json(res, 503, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false }); }
  const { lead_id } = body || {};
  if (!lead_id) return json(res, 400, { ok:false, erro:'lead_id obrigatório' });

  const H = { apikey: SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };
  const lR = await fetch(`${SB_URL}/rest/v1/va_leads?id=eq.${lead_id}&select=*`, { headers: H });
  const [lead] = await lR.json();
  if (!lead) return json(res, 404, { ok:false, erro:'lead não encontrado' });

  const [arqR, msgR, projR, fontesR] = await Promise.all([
    lead.arquetipo_id ? fetch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${lead.arquetipo_id}&select=nome,tese,abordagem,filtro`, { headers: H }) : Promise.resolve({ json:async()=>[] }),
    fetch(`${SB_URL}/rest/v1/va_mensagens_recebidas?lead_id=eq.${lead_id}&order=recebida_em.asc&limit=20&select=corpo,recebida_em`, { headers: H }),
    fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${lead.projeto_id}&select=cidade,uf`, { headers: H }),
    fetch(`${SB_URL}/rest/v1/va_projeto_fontes?projeto_id=eq.${lead.projeto_id}&select=conteudo_destilado,conteudo,formato_detectado,tipo`, { headers: H }),
  ]);
  const [arq] = await arqR.json();
  const msgs = await msgR.json();
  const [proj] = await projR.json();
  const fontes = await fontesR.json();

  const cidade = proj?.cidade || null;
  const regiao = derivarRegiao(cidade, proj?.uf);
  const proibidos = extrairTermosProibidos(fontes || []);
  const ctxQualitativo = null; // pipeline poderia agregar destilados; deixamos leve pra manter tokens baixos

  const prompt = montarPrompt({ lead, arq, msgs, ctxQualitativo, regiao, cidade });

  // Chama + valida + 1 retry se violação
  let out = null;
  let violacoes = [];
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const r = await chamarClaude({ prompt: tentativa === 1 ? prompt : (prompt + `\n\nAJUSTE NECESSÁRIO na tentativa anterior: ${violacoes.join(' · ')}. Regenere respeitando 100% as regras.`) });
    if (!r.ok) return json(res, 502, { ok:false, erro: r.erro, detalhe: r.detalhe });
    const texto = r.texto;
    const vaz = detectarVazamento(texto, proibidos, cidade);
    const reg = detectarAfirmacaoRegulatoria(texto);
    // Triangulação: só faz sentido se região é meso · reusa helper
    const setorTermos = derivarSetorTermos(null, arq?.abordagem?.angulo || '');
    const tri = detectarTriangulacao(texto, regiao, setorTermos);
    violacoes = [...vaz, ...reg, ...tri];
    if (!violacoes.length) { out = texto; break; }
    if (tentativa === 2) return json(res, 422, {
      ok:false, erro:'violacao_persistente', detalhe: violacoes.join(' · '),
      texto_rascunho: texto, // pra debug/ajuste manual
    });
  }

  return json(res, 200, {
    ok: true,
    rascunho: out,
    contexto: {
      lead_nome: lead.nome_fantasia || lead.razao_social,
      arquetipo: arq?.nome || null,
      regiao,
      msgs_count: msgs.length,
      contato: lead.contato_nome ? { nome: lead.contato_nome, cargo: lead.contato_cargo } : null,
    },
  });
};
