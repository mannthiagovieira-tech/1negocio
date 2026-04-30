#!/usr/bin/env node

// Maquininha completa — cria fluxo fim-a-fim:
//   1. INSERT em negocios (com vendedor_id = Thiago admin)
//   2. Roda skill v2 (modo commit) → grava laudos_v2 ativo
//   3. Dispara 9 fetches paralelos da Edge Function gerar_textos_laudo
//   4. INSERT em termos_adesao (assinatura_em = NOW)
//   5. INSERT em anuncios_v2 com status='publicado' + origem='maquininha_teste'
//
// Uso:
//   node scripts/criar-anuncio-completo.js scripts/perfis-teste/05-...json
//   node scripts/criar-anuncio-completo.js --batch  # roda 05..10 em sequência

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

const VENDEDOR_ID_THIAGO = '5a97b1c4-3ceb-4fe1-811e-36185131ba73';

const TEXTOS = [
  'texto_resumo_executivo_completo',
  'texto_contexto_negocio',
  'texto_parecer_tecnico',
  'texto_riscos_atencao',
  'texto_diferenciais',
  'texto_publico_alvo_comprador',
  'descricoes_polidas_upsides',
  'sugestoes_titulo_anuncio',
  'texto_consideracoes_valor',
];

const PALAVRAS_PROIBIDAS = ['vendo','vende-se','à venda','a venda','oportunidade','passo ponto','passa-se ponto','negócio em venda','empresa para venda'];

function H() { return { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' }; }

// ─── MAPEAMENTO schema novo → dados_json flat (formato esperado pela skill v2) ───
function mapPerfilParaDadosJson(perfil) {
  const id = perfil.identificacao || {};
  const dre = perfil.dre || {};
  const bal = perfil.balanco_patrimonial || {};
  const com = perfil.comercial || {};
  const ges = perfil.gestao || {};
  const leg = perfil.legal || {};

  const fatMensal = Math.round((dre.faturamento_anual || 0) / 12);
  const fatAnterior = Math.round((dre.faturamento_anterior || 0) / 12);
  const cmvValor = Math.round(fatMensal * (dre.cmv_pct || 0) / 100);
  const cresc = dre.faturamento_anterior > 0
    ? ((dre.faturamento_anual - dre.faturamento_anterior) / dre.faturamento_anterior) * 100
    : 0;

  // Mapeamentos categóricos
  const operaSemDono = ges.opera_sem_dono_15dias === true ? 'sim' : 'nao';
  const temGestor = ges.tem_gerente === true ? 'sim' : 'nao';
  const equipePerm = ges.equipe_permanece_apos_venda === 'provavelmente' ? 'parcial'
    : (ges.equipe_permanece_apos_venda || 'parcial');
  const marcaInpi = leg.marca_registrada === true ? 'registrada' : 'sem_registro';
  const concentracaoPct = com.concentracao_cliente === true ? 35 : 0;

  // Setor map: 'servicos' → 'servicos_locais' (se b2c) ou 'servicos_empresas' (se b2b)
  let setorMap = id.setor;
  if (id.setor === 'servicos') {
    setorMap = id.modelo_negocio === 'b2b' ? 'servicos_empresas' : 'servicos_locais';
  }

  return {
    nome_responsavel: 'Thiago Mann',
    fat_mensal: fatMensal,
    fat_anterior: fatAnterior,
    crescimento_pct: Number(cresc.toFixed(1)),
    regime: id.regime_tributario || 'simples',
    anexo_simples: 'I',
    setor: setorMap,
    setor_code: setorMap,
    modelo_atuacao_multi: ['produto_proprio'],
    modelo_code: 'produto_proprio',
    pct_produto: 100,

    cmv_valor: cmvValor,
    cmv_fonte: 'informado',

    custo_recebimento_total: Math.round(fatMensal * 0.018),
    custo_comissoes: 0,

    franquia: 'nao',

    clt_folha: Math.round((id.funcionarios_clt || 0) * 4500),
    clt_qtd: id.funcionarios_clt || 0,
    pj_custo: Math.round((id.funcionarios_pj || 0) * 8000),
    pj_qtd: id.funcionarios_pj || 0,

    aluguel: dre.aluguel_mensal || 0,
    local_tipo: 'comercial',
    custo_utilities: Math.round((dre.outros_custos_fixos || 0) * 0.2),
    custo_terceiros: 0,

    custo_sistemas: Math.round((dre.outros_custos_fixos || 0) * 0.1),
    custo_outros: Math.round((dre.outros_custos_fixos || 0) * 0.5),
    mkt_valor: Math.round((dre.outros_custos_fixos || 0) * 0.2),

    prolabore: dre.prolabore_mensal || 0,
    parcelas_mensais: Math.round((bal.passivo_dividas || 0) / 36),
    custo_antecipacao: 0,
    investimentos_mensais: 0,

    at_caixa: bal.ativo_caixa || 0,
    at_cr: Math.round(fatMensal * 0.5),
    at_estoque: bal.ativo_estoque || 0,
    at_equip: bal.ativo_imobilizado || 0,
    at_imovel: 0,
    ativo_franquia: 0,
    at_outros: 0,

    fornec_a_vencer: bal.passivo_fornecedores || 0,
    fornec_atrasadas: 0,
    impostos_atrasados: 0,
    folha_pagar: 0,
    saldo_devedor: bal.passivo_dividas || 0,
    outro_passivo_val: 0,

    pmr: 15,
    pmp: 25,

    processos: ges.processos_documentados || 'parcial',
    dependencia: operaSemDono === 'sim' ? 'parcial' : 'total',
    marca_inpi: marcaInpi,
    processos_juridicos: leg.acao_judicial === true ? 'sim' : 'nao',
    juridico_tipo: [],
    passivo_juridico: 0,
    ativo_juridico: 0,

    tem_gestor: temGestor,
    opera_sem_dono: operaSemDono,
    equipe_permanece: equipePerm,
    passivo_trabalhista: leg.passivo_trabalhista === true,
    tem_processo: leg.acao_judicial === true,
    impostos_dia: leg.impostos_dia || 'sim',
    contabilidade_formal: leg.contabilidade_formal !== false,
    reputacao_online: 'boa',

    recorrencia_pct: com.recorrencia_pct || 0,
    concentracao_pct: concentracaoPct,
    clientes: com.num_clientes_ativos || 0,
    ticket_medio: com.ticket_medio || 0,

    expectativa_val: Math.round((dre.faturamento_anual || 0) * 1.5),
  };
}

// Limita string a max chars sem cortar palavra
function trunc(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  return s.substring(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// Sanitiza descrição: troca palavras proibidas por neutras + valida tamanho
function montarDescricaoCard(calc, perfil) {
  const id = perfil.identificacao || {};
  const dre = perfil.dre || {};
  const setorLabel = (calc.identificacao && calc.identificacao.setor && calc.identificacao.setor.label) || id.setor;
  const cap = setorLabel ? setorLabel.charAt(0).toUpperCase() + setorLabel.slice(1) : 'Negócio';
  const anos = id.tempo_operacao_anos || 0;
  const cidade = id.cidade || '';
  const estado = id.estado || '';
  const fatTxt = dre.faturamento_anual >= 1000000
    ? 'R$ ' + (dre.faturamento_anual / 1000000).toFixed(1).replace('.', ',') + 'M/ano'
    : 'R$ ' + Math.round((dre.faturamento_anual || 0) / 1000) + 'k/ano';
  const desc = `${cap} com ${anos} anos de operação em ${cidade}/${estado}. Faturamento ${fatTxt}.`;
  // Validação proibidas (já não tem por construção, mas safety net)
  const lower = desc.toLowerCase();
  for (const p of PALAVRAS_PROIBIDAS) {
    if (lower.includes(p)) return desc.replace(new RegExp(p, 'gi'), '');
  }
  return trunc(desc, 280);
}

// Monta título: prioriza IA, fallback "Setor em Cidade"
function montarTitulo(calc, perfil) {
  const sugIA = calc.textos_anuncio
    && calc.textos_anuncio.sugestoes_titulo_anuncio
    && calc.textos_anuncio.sugestoes_titulo_anuncio.conteudo;
  if (Array.isArray(sugIA) && sugIA.length > 0) {
    let t = String(sugIA[0]).trim();
    // Filtra proibidas
    const lower = t.toLowerCase();
    for (const p of PALAVRAS_PROIBIDAS) {
      if (lower.includes(p)) { t = t.replace(new RegExp(p, 'gi'), '').replace(/\s+/g, ' ').trim(); }
    }
    if (t.length >= 5) return trunc(t, 60);
  }
  const id = perfil.identificacao || {};
  const setorLabel = (calc.identificacao && calc.identificacao.setor && calc.identificacao.setor.label) || id.setor;
  const cap = setorLabel ? setorLabel.charAt(0).toUpperCase() + setorLabel.slice(1) : 'Negócio';
  return trunc(`${cap} em ${id.cidade}`, 60);
}

async function processarPerfil(perfilPath) {
  const perfil = JSON.parse(fs.readFileSync(perfilPath, 'utf-8'));
  const id = perfil.identificacao;
  console.log(`\n┌─ ${path.basename(perfilPath)}`);
  console.log(`│  ${id.nome} · ${id.cidade}/${id.estado}`);

  const dadosJson = mapPerfilParaDadosJson(perfil);

  // ── 1. INSERT em negocios ──
  const codigo = '1N-T' + Date.now().toString(36).slice(-5).toUpperCase();
  const negocioPayload = {
    nome: id.nome,
    setor: dadosJson.setor,
    categoria: id.subcategoria || null,
    cidade: id.cidade,
    estado: id.estado,
    tempo_operacao_anos: id.tempo_operacao_anos,
    modelo_negocio: id.modelo_negocio,
    slug: codigo,
    codigo_diagnostico: codigo,
    faturamento_anual: (dadosJson.fat_mensal || 0) * 12,
    fat_mensal: dadosJson.fat_mensal,
    fat_anual: (dadosJson.fat_mensal || 0) * 12,
    status: 'em_avaliacao',
    plano: 'gratuito',
    origem: 'maquininha_teste',
    vendedor_id: VENDEDOR_ID_THIAGO,
    dados_json: dadosJson,
  };
  const negResp = await fetch(`${SUPABASE_URL}/rest/v1/negocios`, {
    method: 'POST',
    headers: { ...H(), 'Prefer': 'return=representation' },
    body: JSON.stringify(negocioPayload),
  });
  if (!negResp.ok) throw new Error(`negocios INSERT (${negResp.status}): ${await negResp.text()}`);
  const negocioId = (await negResp.json())[0].id;
  console.log(`│  ✓ negócio: ${negocioId} (${codigo})`);

  // ── 2. Carregar e rodar skill v2 ──
  const skillCode = fs.readFileSync(path.join(__dirname, '..', 'skill-avaliadora-v2.js'), 'utf-8');
  const sandbox = { window: {}, fetch, setTimeout, clearTimeout, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(skillCode, sandbox);
  const AVALIADORA_V2 = sandbox.window.AVALIADORA_V2;

  const rowResp = await fetch(`${SUPABASE_URL}/rest/v1/negocios?id=eq.${negocioId}&select=*`, { headers: H() });
  const rowData = (await rowResp.json())[0];
  const calcJson = await AVALIADORA_V2.avaliar(rowData, 'commit');
  console.log(`│  ✓ skill v2: RO=${Math.round(calcJson.dre.ro_mensal)}/mês, ISE=${calcJson.ise.ise_total}, valor=${Math.round(calcJson.valuation.valor_venda)}`);

  // ── 3. Pega laudo_v2_id ──
  const lauResp = await fetch(`${SUPABASE_URL}/rest/v1/laudos_v2?negocio_id=eq.${negocioId}&ativo=eq.true&select=id`, { headers: H() });
  const laudoV2Id = (await lauResp.json())[0].id;

  // ── 4. Dispara 9 textos IA ──
  const inicio = Date.now();
  const promessas = TEXTOS.map(textoKey =>
    fetch(`${SUPABASE_URL}/functions/v1/gerar_textos_laudo`, {
      method: 'POST', headers: H(),
      body: JSON.stringify({ negocio_id: negocioId, texto_a_gerar: textoKey }),
    }).then(r => r.json()).then(j => ({ ok: j.ok === true, erro: j.erro }))
      .catch(e => ({ ok: false, erro: e.message }))
  );
  const resultados = await Promise.all(promessas);
  const ok = resultados.filter(r => r.ok).length;
  console.log(`│  ✓ textos IA: ${ok}/9 em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

  // ── 5. Recarrega calc_json com textos IA salvos ──
  const lauResp2 = await fetch(`${SUPABASE_URL}/rest/v1/laudos_v2?negocio_id=eq.${negocioId}&ativo=eq.true&select=calc_json`, { headers: H() });
  const calcAtualizado = (await lauResp2.json())[0].calc_json;

  // ── 6. INSERT termos_adesao ──
  const valorPedido = Math.round(calcJson.valuation.valor_venda || 0);
  const termoPayload = {
    negocio_id: negocioId,
    plano: 'gratuito',
    comissao_pct: 10,
    exige_nda: false,
    razao_social: id.nome + ' LTDA',
    representante_nome: 'Thiago Mann',
    representante_cpf: '00000000000',
    cnpj: '00000000000000',
    endereco: id.cidade + '/' + id.estado,
    whatsapp: '5511952136406',
    email: 'thiago@1negocio.com.br',
    valor_pretendido: valorPedido,
    assinatura_em: new Date().toISOString(),
    status: 'assinado',
  };
  const termoResp = await fetch(`${SUPABASE_URL}/rest/v1/termos_adesao`, {
    method: 'POST', headers: { ...H(), 'Prefer': 'return=representation' },
    body: JSON.stringify(termoPayload),
  });
  if (!termoResp.ok) throw new Error(`termos_adesao INSERT (${termoResp.status}): ${await termoResp.text()}`);
  const termoId = (await termoResp.json())[0].id;
  console.log(`│  ✓ termo: ${termoId}`);

  // ── 7. INSERT anuncios_v2 ──
  const titulo = montarTitulo(calcAtualizado, perfil);
  const descricao = montarDescricaoCard(calcAtualizado, perfil);
  const anuncioPayload = {
    negocio_id: negocioId,
    laudo_v2_id: laudoV2Id,
    vendedor_id: VENDEDOR_ID_THIAGO,
    titulo,
    descricao_card: descricao,
    valor_pedido: valorPedido,
    termo_adesao_id: termoId,
    termo_assinado_em: new Date().toISOString(),
    status: 'publicado',
    publicado_em: new Date().toISOString(),
    origem: 'maquininha_teste',
  };
  const anuResp = await fetch(`${SUPABASE_URL}/rest/v1/anuncios_v2`, {
    method: 'POST', headers: { ...H(), 'Prefer': 'return=representation' },
    body: JSON.stringify(anuncioPayload),
  });
  if (!anuResp.ok) throw new Error(`anuncios_v2 INSERT (${anuResp.status}): ${await anuResp.text()}`);
  const anuncio = (await anuResp.json())[0];
  console.log(`│  ✓ anúncio: ${anuncio.codigo} ('${titulo}')`);
  console.log(`└─ publicado · valor R$ ${valorPedido.toLocaleString('pt-BR')}`);

  return {
    nome: id.nome,
    codigo_diag: codigo,
    codigo_anu: anuncio.codigo,
    valor: valorPedido,
    ise: calcJson.ise.ise_total,
    negocio_id: negocioId,
    anuncio_id: anuncio.id,
    titulo,
  };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: node scripts/criar-anuncio-completo.js <perfil.json>  OR  --batch');
    process.exit(1);
  }

  let perfis = [];
  if (arg === '--batch') {
    const dir = path.join(__dirname, 'perfis-teste');
    perfis = fs.readdirSync(dir)
      .filter(f => /^(0[5-9]|10)-.*\.json$/.test(f))
      .sort()
      .map(f => path.join(dir, f));
  } else {
    perfis = [arg];
  }

  console.log(`🔧 Processando ${perfis.length} perfil(is)...`);
  const resultados = [];
  for (const p of perfis) {
    try {
      const r = await processarPerfil(p);
      resultados.push(r);
      // Delay 2s entre cada (rate limit Anthropic)
      if (perfis.length > 1 && p !== perfis[perfis.length - 1]) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error(`❌ Falha em ${path.basename(p)}: ${e.message}`);
      resultados.push({ erro: e.message, perfil: path.basename(p) });
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('RESUMO FINAL');
  console.log('═══════════════════════════════════════════════');
  resultados.forEach((r, i) => {
    if (r.erro) {
      console.log(`${i+1}. ❌ ${r.perfil}: ${r.erro}`);
    } else {
      console.log(`${i+1}. ${r.nome}`);
      console.log(`   Diag: ${r.codigo_diag}  |  Anúncio: ${r.codigo_anu}  |  Valor: R$ ${r.valor.toLocaleString('pt-BR')}  |  ISE: ${r.ise}`);
      console.log(`   Título: "${r.titulo}"`);
      console.log(`   URL: https://1negocio.com.br/laudo-pago.html?id=${r.negocio_id}`);
    }
  });
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
