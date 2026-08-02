// /api/gerar-teaser · gera 2-3 versões de teaser com ângulos diferentes
// Voz: marketing com rigor de analista. Vende, não mente.
// Respeita sigilo: nunca nome/CNPJ/endereço exato/sócio.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-sonnet-4-6';

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req){ if (req.body) return typeof req.body==='string'?JSON.parse(req.body):req.body; const c=[]; for await (const x of req) c.push(x); const r=Buffer.concat(c).toString('utf8'); return r?JSON.parse(r):{}; }
async function ehAdmin(tok){
  if (!tok) return false;
  const r = await fetch(SB_URL+'/rest/v1/rpc/va_is_admin',{method:'POST',headers:{apikey:SB_ANON,Authorization:'Bearer '+tok,'Content-Type':'application/json'},body:'{}'});
  return r.ok && (await r.json())===true;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });
  const tok = (req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if (!(await ehAdmin(tok))) return json(res, 403, { ok:false, erro:'não autorizado' });
  if (!ANTHROPIC_KEY) return json(res, 503, { ok:false, erro:'ANTHROPIC_API_KEY ausente' });

  let body; try { body = await lerBody(req); } catch { return json(res, 400, { ok:false, erro:'json inválido' }); }
  const { projeto_id, nivel_sigilo = 'padrao' } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  const [projR, avalR, ctxR, arqR] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=*`,{headers:H}),
    fetch(`${SB_URL}/rest/v1/va_projeto_avaliacao?projeto_id=eq.${projeto_id}&select=calc_json_snapshot`,{headers:H}),
    fetch(`${SB_URL}/rest/v1/va_projeto_contexto?projeto_id=eq.${projeto_id}&order=criado_em.desc&limit=15`,{headers:H}),
    fetch(`${SB_URL}/rest/v1/va_projeto_arquetipos?projeto_id=eq.${projeto_id}&select=nome,perfil,queries_busca`,{headers:H}),
  ]);
  const [p] = await projR.json();
  const [av] = (await avalR.json()) || [];
  const ctx = await ctxR.json();
  const arqs = await arqR.json();
  if (!p) return json(res, 404, { ok:false, erro:'projeto não encontrado' });

  const calc = av?.calc_json_snapshot || {};
  const val = calc.valuation || {};
  const ise = calc.ise || {};
  const op = calc.operacional || {};
  const idn = calc.identificacao || {};

  const ctxTxt = (ctx||[]).slice(0,10).map(c =>
    `[${c.tipo}] ${c.titulo||''}: ${(c.conteudo||'').slice(0,800)}`
  ).join('\n---\n') || '';
  const arqTxt = (arqs||[]).map(a =>
    `${a.nome}: ${a.perfil||''}`
  ).join('\n') || '(arquétipos não definidos ainda)';

  const sigiloTxt = nivel_sigilo === 'rigoroso'
    ? 'RIGOROSO: NUNCA cidade específica · use "capital do estado" ou "região metropolitana". Nunca região com < 100k habitantes.'
    : 'PADRÃO: cidade OK. Nunca nome do negócio, razão social, CNPJ, endereço exato, ou nome de sócio.';

  const valorVenda = p.valor_venda ? Number(p.valor_venda) : (val.valor_venda || 0);
  const descricao = p.descricao_negocio || '(descrição analítica ainda não gerada · use os números e contexto abaixo)';

  const prompt = `Você é analista escrevendo teaser de venda de negócio (M&A discreto).

VOZ: marketing com rigor de analista. Vende, mas não mente. Números primeiro, narrativa depois. Sem "oportunidade única", "excelente", "imperdível". Português direto e denso.

SIGILO · ${sigiloTxt}

CONTEXTO DO ATIVO:
- Setor: ${idn.setor?.label || p.avaliacao_setor || '—'}
- Região: ${idn.localizacao?.cidade || p.cidade || ''} / ${idn.localizacao?.estado || p.uf || '—'}
- Tempo de operação: ${idn.tempo_operacao_anos || '—'} anos
- Faturamento anual: R$ ${(op.fat_anual||0).toLocaleString('pt-BR')}
- EBITDA anual: R$ ${(val.ro_anual||0).toLocaleString('pt-BR')}
- Valor pedido: R$ ${valorVenda.toLocaleString('pt-BR')}
- ISE (saúde 0-100): ${ise.ise_total || '—'} · ${ise.classe || ''}
- Funcionários: ${op.num_funcionarios||'—'}
- Concentração de clientes: ${op.concentracao_status||'—'}

DESCRIÇÃO ANALÍTICA (base pra escrever):
${descricao}

REUNIÕES/NOTAS DO OPERADOR:
${ctxTxt || '(sem reuniões registradas)'}

ARQUÉTIPOS DE COMPRADOR (adaptar tom pra eles):
${arqTxt}

TAREFA:
Gere EXATAMENTE 3 versões de teaser com ângulos diferentes:

VERSÃO 1 · ângulo NÚMEROS (focado em ROI/retorno)
VERSÃO 2 · ângulo OPERAÇÃO (focado em quem toca, autonomia, gestão)
VERSÃO 3 · ângulo MERCADO (focado no setor/região/timing)

ESTRUTURA CADA VERSÃO (4-7 parágrafos):
- Abertura: posiciona o ativo em 1 frase (ângulo específico)
- O que faz + tempo
- Números que sustentam (fat, ebitda, margem, recorrência quando houver)
- Diferencial competitivo real
- Contexto de mercado/região (por que aqui, por que agora)
- O que o comprador ganha (perfil que faz sentido)
- Motivo da venda quando ajudar
- Transição oferecida

Retorne no formato JSON exato:
{"versoes":[{"angulo":"números","texto":"..."},{"angulo":"operação","texto":"..."},{"angulo":"mercado","texto":"..."}]}
Sem markdown, sem \`\`\`, só o JSON puro.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role:'user', content: prompt }] }),
    });
    if (!r.ok) return json(res, 502, { ok:false, erro:'anthropic_http_'+r.status, detalhe:(await r.text()).slice(0,300) });
    const d = await r.json();
    const raw = d?.content?.[0]?.text || '';
    let parsed = null;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : raw);
    } catch {
      return json(res, 502, { ok:false, erro:'json_parse_falhou', raw: raw.slice(0,500) });
    }
    if (!Array.isArray(parsed?.versoes) || !parsed.versoes.length) {
      return json(res, 502, { ok:false, erro:'formato_invalido' });
    }
    // Descobre próxima versão do projeto
    const nextR = await fetch(`${SB_URL}/rest/v1/va_projeto_teaser?projeto_id=eq.${projeto_id}&select=versao&order=versao.desc&limit=1`,{headers:H});
    const nextArr = await nextR.json();
    let vNum = (nextArr?.[0]?.versao || 0) + 1;
    const inseridos = [];
    for (const v of parsed.versoes) {
      const insR = await fetch(`${SB_URL}/rest/v1/va_projeto_teaser`, {
        method:'POST', headers:{ ...H, Prefer:'return=representation' },
        body: JSON.stringify({ projeto_id, versao: vNum, angulo: v.angulo, texto: v.texto, gerado_por:'claude/'+MODEL }),
      });
      if (insR.ok) { const [row] = await insR.json(); inseridos.push(row.id); }
      vNum++;
    }
    return json(res, 200, { ok:true, quantidade: parsed.versoes.length, ids: inseridos, versoes: parsed.versoes, tokens_prompt: d?.usage?.input_tokens, tokens_resposta: d?.usage?.output_tokens });
  } catch (e) {
    return json(res, 502, { ok:false, erro:'rede', detalhe:String(e.message||e).slice(0,200) });
  }
};
