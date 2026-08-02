// /api/gerar-descricao · gera descrição analítica do negócio via Claude
// Recebe todo o contexto do projeto: laudo + reuniões + notas + anexos + enriquecimento.
// PESO MAIOR no que foi escrito à mão (reuniões, notas) — números não capturam nuance.

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
  const { projeto_id } = body || {};
  if (!projeto_id) return json(res, 400, { ok:false, erro:'projeto_id obrigatório' });

  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const H = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  // Contexto do projeto · laudo + reuniões + transcrições + enriquecimento
  const [projR, avalR, ctxR, transR, empR] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=*`,{headers:H}),
    fetch(`${SB_URL}/rest/v1/va_projeto_avaliacao?projeto_id=eq.${projeto_id}&select=calc_json_snapshot,codigo_diagnostico`,{headers:H}),
    fetch(`${SB_URL}/rest/v1/va_projeto_contexto?projeto_id=eq.${projeto_id}&order=criado_em.desc`,{headers:H}),
    fetch(`${SB_URL}/rest/v1/va_projeto_transcricoes?projeto_id=eq.${projeto_id}&order=criado_em.desc`,{headers:H}),
    fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${(await (await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}&select=cnpj`,{headers:H})).json())[0]?.cnpj||''}&select=*&limit=1`,{headers:H}),
  ]);
  const [p] = await projR.json();
  const [av] = (await avalR.json()) || [];
  const ctx = await ctxR.json();
  const trans = await transR.json();
  const [emp] = (await empR.json()) || [];
  if (!p) return json(res, 404, { ok:false, erro:'projeto não encontrado' });

  // Prompt · números primeiro, palavras do operador com peso alto
  const calc = av?.calc_json_snapshot || {};
  const val = calc.valuation || {};
  const ise = calc.ise || {};
  const op = calc.operacional || {};
  const idn = calc.identificacao || {};

  const ctxTxt = (ctx||[]).slice(0,20).map(c =>
    `[${c.tipo}${c.categoria?' · '+c.categoria:''}] ${c.titulo||''} (${c.data_referencia||c.criado_em?.slice(0,10)})\n${(c.conteudo||'').slice(0,2000)}`
  ).join('\n\n---\n\n') || '(sem reuniões ou notas registradas)';
  const transTxt = (trans||[]).slice(0,10).map(t =>
    `[transcrição] ${t.titulo||''} (${t.data_reuniao||t.criado_em?.slice(0,10)})\n${(t.conteudo||'').slice(0,3000)}`
  ).join('\n\n---\n\n') || '(sem transcrições)';

  const prompt = `Você é analista de M&A escrevendo a descrição analítica de um negócio em processo de venda assessorada.

DADOS DO NEGÓCIO (marketplace 1negocio):
- Código diagnóstico: ${av?.codigo_diagnostico || '—'}
- Setor: ${idn.setor?.label || p.avaliacao_setor || p.setor || '—'}
- Cidade/UF: ${idn.localizacao?.cidade || p.cidade || '—'} / ${idn.localizacao?.estado || p.uf || '—'}
- CNPJ: ${p.cnpj || '—'}
- Tempo de operação: ${idn.tempo_operacao_anos || emp?.data_abertura ? Math.floor((Date.now()-new Date(emp?.data_abertura||'2000').getTime())/31536000000)+' anos' : '—'}
- Regime tributário: ${idn.regime_tributario_declarado?.label || '—'}

NÚMEROS (avaliação v${calc._versao_calc_json||'—'}):
- Faturamento anual: R$ ${(op.fat_anual||0).toLocaleString('pt-BR')}
- Faturamento mensal: R$ ${(op.fat_mensal||0).toLocaleString('pt-BR')}
- EBITDA anual: R$ ${(val.ro_anual||0).toLocaleString('pt-BR')}
- Valor de venda (avaliação): R$ ${(val.valor_venda||0).toLocaleString('pt-BR')}
- Valor de venda (definido pelo operador): ${p.valor_venda ? 'R$ '+Number(p.valor_venda).toLocaleString('pt-BR') : '—'}
- ISE (saúde do negócio, 0-100): ${ise.ise_total || '—'} · ${ise.classe || ''}
- Patrimônio líquido: R$ ${(val.patrimonio_liquido||0).toLocaleString('pt-BR')}
- Funcionários: ${op.num_funcionarios||'—'}
- Sócios: ${op.num_socios||'—'}
- Concentração de clientes: ${op.concentracao_status||'—'}

ENRIQUECIMENTO EXTERNO:
${emp ? `- Razão social: ${emp.razao_social||'—'}
- Fantasia: ${emp.nome_fantasia||'—'}
- CNAE: ${emp.cnae_codigo||'—'} · ${emp.cnae_descricao||''}
- Situação: ${emp.situacao_cadastral||'—'}
- Porte: ${emp.porte_categoria||'—'}
- Capital social: ${emp.capital_social ? 'R$ '+Number(emp.capital_social).toLocaleString('pt-BR') : '—'}
- Sócios: ${(emp.socios||[]).length} registrado(s)` : '(sem enriquecimento externo)'}

REUNIÕES E NOTAS DO OPERADOR (peso alto — nuance que os números não capturam):
${ctxTxt}

TRANSCRIÇÕES:
${transTxt}

TAREFA:
Escreva uma DESCRIÇÃO ANALÍTICA do negócio em 4-6 parágrafos densos:
1. O que a empresa faz, há quanto tempo, como opera
2. Onde está a FORÇA (dados + observações)
3. Onde está o RISCO (dados + observações)
4. O que a torna COMPRÁVEL (perfil de comprador que faz sentido)
5. Contexto de mercado ou região quando relevante
6. Motivo da venda quando explícito

REGRAS:
- Números primeiro, narrativa depois. Sem adjetivo vazio.
- Nunca invente. Se algo não apareceu na conversa, dizer "não mencionado" ou omitir.
- Priorize o que o OPERADOR escreveu nas reuniões — é onde estão as informações qualitativas.
- Português analítico, tom neutro. Sem "excelente", "único", "oportunidade imperdível".
- Não use nome do negócio ou CNPJ na descrição (é uso interno, mas pratique o sigilo).

Retorne APENAS o texto da descrição, sem cabeçalhos.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':ANTHROPIC_KEY, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role:'user', content: prompt }] }),
    });
    if (!r.ok) return json(res, 502, { ok:false, erro:'anthropic_http_'+r.status, detalhe:(await r.text()).slice(0,300) });
    const d = await r.json();
    const texto = d?.content?.[0]?.text || '';
    if (!texto) return json(res, 502, { ok:false, erro:'resposta_vazia' });
    // Grava histórico + atualiza projeto
    const novaVersao = Number(p.descricao_negocio_versao||0) + 1;
    await fetch(`${SB_URL}/rest/v1/va_projeto_descricao_hist`, {
      method:'POST', headers:H,
      body: JSON.stringify({ projeto_id, versao: novaVersao, texto, gerado_por:'claude/'+MODEL }),
    });
    await fetch(`${SB_URL}/rest/v1/va_projetos?id=eq.${projeto_id}`, {
      method:'PATCH', headers:H,
      body: JSON.stringify({ descricao_negocio: texto, descricao_negocio_versao: novaVersao, descricao_negocio_gerado_em: new Date().toISOString() }),
    });
    return json(res, 200, { ok:true, versao: novaVersao, texto, tokens_prompt: d?.usage?.input_tokens, tokens_resposta: d?.usage?.output_tokens });
  } catch (e) {
    return json(res, 502, { ok:false, erro:'rede', detalhe:String(e.message||e).slice(0,200) });
  }
};
