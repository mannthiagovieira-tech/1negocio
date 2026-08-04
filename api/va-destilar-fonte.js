// /api/va-destilar-fonte · MANDATO · Zona ATIVO
// Recebe uma fonte tipo='reuniao' em formato transcript bruto (timestamps +
// falas) e produz destilado estruturado ~3-5k chars com 6 seções:
//   FATOS DE NEGÓCIO · MOTIVAÇÃO DE VENDA · RESTRIÇÕES E SIGILO
//   COMPRADORES/TESES SUGERIDOS · EXPECTATIVA DE VALOR · AÇÕES COMBINADAS
//
// Se o transcript > CHUNK_MAX (150k chars), fatia em janelas com overlap
// e mescla os destilados parciais numa passada final de consolidação.
//
// POST { fonte_id }  → atualiza va_projeto_fontes.conteudo_destilado + destilado_em.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';
const CHUNK_MAX = 150_000;
const CHUNK_OVERLAP = 4_000;

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

function chunkarTranscript(texto) {
  if (texto.length <= CHUNK_MAX) return [texto];
  const chunks = [];
  let pos = 0;
  while (pos < texto.length) {
    const fim = Math.min(pos + CHUNK_MAX, texto.length);
    chunks.push(texto.slice(pos, fim));
    if (fim >= texto.length) break;
    pos = fim - CHUNK_OVERLAP;
  }
  return chunks;
}

function promptDestilarParcial(chunk, indice, total) {
  return `Você é analista sênior de M&A destilando trecho ${indice + 1}/${total} de um transcript de reunião entre assessor e dono de PME em venda assessorada.

Sua tarefa: extrair fielmente o que foi dito neste trecho. NÃO inventar, NÃO especular. Se algo não foi dito, ignore.

Produza (Markdown, seções fixas, cada uma com bullets ou parágrafo curto · pode ficar em branco se o trecho não trouxer nada da seção):

## FATOS DE NEGÓCIO
Números citados literalmente pelo dono ou assessor: faturamento, folha, dívidas, base de clientes, ticket médio, ativos, aluguel, contratos, funcionários, sócios.

## MOTIVAÇÃO DE VENDA
Palavras do dono sobre POR QUE vender. 1-2 citações curtas entre aspas quando revelarem motivação real.

## RESTRIÇÕES E SIGILO
Nomes de pessoas ou empresas citados como quem "não pode saber", concorrentes específicos, blacklist. Situação fiscal/judicial/passivos mencionados.

## COMPRADORES OU TESES SUGERIDOS NA CONVERSA
Perfis de comprador que o dono ou o assessor cogitaram (concorrente, investidor, sócio, grupo etc).

## CONTEXTO DE NEGOCIAÇÃO (histórico · não usar em materiais)
Faixa/valor mencionado pelo dono como quanto esperaria. Comparações que fez. Esta seção é âncora do vendedor pro consultor · NUNCA é fonte de número pras gerações IA (elas usam só o valor_venda do sistema).

## AÇÕES COMBINADAS
O que ficou combinado ao final (documentos a enviar, próxima reunião, decisão pendente).

TRECHO:
${chunk}`;
}

function promptConsolidar(destiladosParciais) {
  return `Você é analista sênior consolidando destilados de trechos de UMA MESMA reunião entre assessor de M&A e dono de PME. Os trechos abaixo (em ordem) já foram pré-destilados. Sua tarefa: FUNDIR eles numa única versão final, removendo repetições, mantendo TODOS os fatos únicos.

Regras:
- Não inventar. Se algum destilado parcial diz X e outro diz Y, mantenha AMBOS quando não se contradisserem; se se contradisserem, escreva "assessor/dono disse X em um momento, Y em outro".
- Formato final: mesmas 6 seções (FATOS DE NEGÓCIO · MOTIVAÇÃO DE VENDA · RESTRIÇÕES E SIGILO · COMPRADORES OU TESES SUGERIDOS NA CONVERSA · CONTEXTO DE NEGOCIAÇÃO (histórico · não usar em materiais) · AÇÕES COMBINADAS).
- Alvo: 3-5k caracteres.

DESTILADOS PARCIAIS:
${destiladosParciais.map((d, i) => `--- parcial ${i + 1} ---\n${d}`).join('\n\n')}`;
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
  const { fonte_id } = body || {};
  if (!fonte_id) return json(res, 400, { ok: false, erro: 'fonte_id obrigatório' });

  const H = { apikey: SB_SERVICE, Authorization: 'Bearer ' + SB_SERVICE, 'Content-Type': 'application/json' };
  const fR = await fetch(`${SB_URL}/rest/v1/va_projeto_fontes?id=eq.${fonte_id}&select=id,projeto_id,tipo,conteudo,formato_detectado,conteudo_destilado`, { headers: H });
  const [f] = await fR.json();
  if (!f) return json(res, 404, { ok: false, erro: 'fonte não encontrada' });
  if (f.tipo !== 'reuniao') return json(res, 400, { ok: false, erro: 'destilação só se aplica a tipo=reuniao' });
  if (!f.conteudo || f.conteudo.length < 500) return json(res, 400, { ok: false, erro: 'conteudo curto demais pra destilar' });

  try {
    const chunks = chunkarTranscript(f.conteudo);
    let destilado;
    if (chunks.length === 1) {
      destilado = await chamarSonnet(promptDestilarParcial(chunks[0], 0, 1), 5000);
    } else {
      // 1 chamada por chunk (sequencial pra não estourar rate limit) + consolidação
      const parciais = [];
      for (let i = 0; i < chunks.length; i++) {
        const p = await chamarSonnet(promptDestilarParcial(chunks[i], i, chunks.length), 5000);
        parciais.push(p.trim());
      }
      destilado = await chamarSonnet(promptConsolidar(parciais), 6000);
    }
    destilado = destilado.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```$/i, '').trim();
    if (destilado.length < 200) return json(res, 502, { ok: false, erro: 'destilado curto demais · o modelo pode não ter retornado material útil' });

    const upR = await fetch(`${SB_URL}/rest/v1/va_projeto_fontes?id=eq.${fonte_id}`, {
      method: 'PATCH', headers: H,
      body: JSON.stringify({ conteudo_destilado: destilado, destilado_em: new Date().toISOString() }),
    });
    if (!upR.ok) return json(res, 500, { ok: false, erro: 'update: ' + upR.status });
    // v3 · débito ia_destilacao_fonte
    if (f.projeto_id) {
      try {
        await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
          method:'POST', headers: H,
          body: JSON.stringify({ p_projeto: f.projeto_id, p_tipo:'ia_destilacao_fonte', p_qtd:1, p_referencia:`destilar:${fonte_id.slice(0,8)}`, p_ciclo:null }),
        });
      } catch (e) { console.error('debit destilar fail:', e); }
    }
    return json(res, 200, { ok: true, chars_destilado: destilado.length, chunks: chunks.length, destilado });
  } catch (e) {
    return json(res, 502, { ok: false, erro: 'destilacao_falhou', detalhe: String(e.message).slice(0, 300) });
  }
};
