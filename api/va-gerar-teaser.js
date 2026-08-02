// /api/va-gerar-teaser · MANDATO · Zona ATIVO · Vercel Function.
// Gera teaser CEGO em markdown. Valida contra identificadores conhecidos
// do projeto (razão social, sócios, CNPJ) e rejeita+regenera se vazar.
// Insere como rascunho em va_projeto_teaser.

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

function detectarIdentificacao(texto, proibidos) {
  const found = [];
  const t = texto.toLowerCase();
  for (const p of proibidos) {
    if (!p) continue;
    const norm = String(p).trim().toLowerCase();
    if (norm.length < 4) continue;
    if (t.includes(norm)) found.push(p);
  }
  if (/\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b/.test(texto)) found.push('CNPJ formatado');
  return found;
}

function promptTeaser(cj, valorVenda, arqAprovados, corrigir) {
  const val = cj.valuation || {}, op = cj.operacional || {}, idn = cj.identificacao || {}, dre = cj.dre || {};
  const brl = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR');
  const arqBlock = arqAprovados.length
    ? '\nARQUÉTIPOS APROVADOS (calibre o ângulo pra estes perfis):\n' +
      arqAprovados.map((a) => `- ${a.nome}: ${a.tese}`).join('\n') : '';
  const vv = valorVenda ? brl(valorVenda) : 'faixa a discutir';
  const cor = corrigir ? '\nCORREÇÃO · a última tentativa incluiu identificadores proibidos: ' + corrigir + '\nRefaça mantendo estritamente o sigilo cego.' : '';
  return `Escreva um teaser CEGO em markdown pra apresentar este negócio a compradores potenciais SEM revelar identidade.

DADOS (só pra orientar o texto — NÃO reproduzir literalmente):
- Setor: ${idn.setor?.label || '—'}
- Cidade/UF: ${idn.localizacao?.cidade || '—'} / ${idn.localizacao?.estado || '—'}
- Tempo de operação: ${idn.tempo_operacao_anos || '—'} anos
- Faturamento anual: ${brl(op.fat_anual)}
- EBITDA anual: ${brl(val.ro_anual)}
- Margem operacional: ${dre.margem_op_pct != null ? dre.margem_op_pct + '%' : '—'}
- Funcionários: ${op.num_funcionarios || '—'}
- Concentração de clientes: ${op.concentracao_status || '—'}
- Valor de venda: ${vv}${arqBlock}

REGRAS DE SIGILO (absolutas):
- NUNCA escreva: razão social, nome fantasia, nome de sócio, CNPJ, endereço específico, marca, domínio.
- Cidade + UF: OK. Bairro: NÃO.
- Números REAIS podem aparecer (faturamento, EBITDA, margem) — são o valor do teaser.

ESTRUTURA (markdown · sem H1):
## Resumo
1-2 linhas · setor, região, tempo, tese.

## Números
Bullets · faturamento anual, EBITDA anual, margem, funcionários, concentração de clientes.

## Diferenciais operacionais
2-4 bullets.

## Perfil de comprador que faz sentido
1-3 linhas · ancorar nos arquétipos se houver.

## Ticket
1 linha · valor de venda ou faixa.

FORMATO: SÓ o markdown, sem preâmbulo, sem cerca de código.${cor}`;
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

  // Enriquece proibidos com dados de va_empresas (se houver)
  const proibidos = [
    p.cliente_nome, p.negocio_titulo, calc.identificacao?.nome, calc.identificacao?.razao_social, p.cnpj,
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

  let corrigir = null, texto = '';
  for (let t = 0; t < 2; t++) {
    try {
      const raw = await chamarSonnet(promptTeaser(calc, p.valor_venda ? Number(p.valor_venda) : null, arqs, corrigir));
      texto = raw.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```$/i, '').trim();
      if (texto.length < 300) { corrigir = 'teaser curto demais'; continue; }
      const vazamento = detectarIdentificacao(texto, proibidos);
      if (vazamento.length) { corrigir = vazamento.join(', '); continue; }

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
      return json(res, 200, { ok: true, teaser: inseridos[0] || inseridos, tentativas: t + 1 });
    } catch (e) {
      return json(res, 502, { ok: false, erro: 'anthropic_fail', detalhe: String(e.message).slice(0, 300) });
    }
  }
  return json(res, 502, { ok: false, erro: 'vazamento_identidade_persistente', proibidos_detectados: corrigir });
};
