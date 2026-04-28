// Forste validation: roda gerarUpsidesV2 contra snapshot v2026.05 + Forste sintética.
// Reporta ativos / paywalls / gap analysis.

const fs = require('fs'); const path = require('path');
global.window = global;

// 1. Carregar snapshot v2026.05 a partir da migração SQL 006
const sql = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/006_seed_parametros_v2026_05.sql'), 'utf8');

// 2. Carregar snapshot v2026.04 base
const sqlBase = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/002_seed_parametros_v2026_04.sql'), 'utf8');
const baseSnapshot = JSON.parse(sqlBase.match(/'(\{[\s\S]*\})'::jsonb/)[1]);

// 3. Reproduzir o jsonb_set + concat do migration 006 em JS
const blocks = [];
const re = /\$json\$([\s\S]*?)\$json\$/g;
let m;
while ((m = re.exec(sql)) !== null) {
  blocks.push(JSON.parse(m[1]));
}
// Block 0 = _meta (vai dentro de snapshot._meta via jsonb_set)
// Blocks 1-7 = top-level merges (caps, fator, pesos, catalogo)
const v05 = JSON.parse(JSON.stringify(baseSnapshot));
v05._meta = blocks[0]; // jsonb_set replace
for (let i = 1; i < blocks.length; i++) {
  Object.assign(v05, blocks[i]);
}

// Aplica também as faixas_atratividade + benchmarks atualizados pela migração 005
const sql05 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/005_update_parametros_atratividade_deducoes.sql'), 'utf8');
// Migration 005 faz jsonb_set em faixas_atratividade e benchmarks_dre — já está em base via 002+005 cumulativo.
// Como nosso baseSnapshot vem só de 002, vamos aplicar 005 também:
const m005 = sql05.match(/'\[(.*?)\]'::jsonb/);
if (m005) {
  v05.faixas_atratividade = JSON.parse('[' + m005[1] + ']');
}
const benchm005 = sql05.match(/'(\{"servicos_empresas":[\s\S]*?\})'::jsonb/);
if (benchm005) {
  v05.benchmarks_dre = JSON.parse(benchm005[1]);
}

// 007: pesos_sub_metricas reestruturados (P6 renomeada, P8 reativa presenca_digital)
const sql07 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/007_seed_parametros_v2026_06.sql'), 'utf8');
const blocks07 = []; const re7 = /\$json\$([\s\S]*?)\$json\$/g; let m7;
while ((m7 = re7.exec(sql07)) !== null) blocks07.push(JSON.parse(m7[1]));
v05._meta = blocks07[0];
for (let i = 1; i < blocks07.length; i++) Object.assign(v05, blocks07[i]);
// 008: p2_resultado reduzido a 2 sub-métricas
const sql08 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/008_seed_parametros_v2026_07.sql'), 'utf8');
const blocks08 = []; const re8 = /\$json\$([\s\S]*?)\$json\$/g; let m8;
while ((m8 = re8.exec(sql08)) !== null) blocks08.push(JSON.parse(m8[1]));
v05._meta = blocks08[0];
v05.pesos_sub_metricas_ise.p2_resultado = blocks08[1];

console.log('snapshot v05+006+007+008 carregado. keys:', Object.keys(v05).length);
console.log('upsides_catalogo:', v05.upsides_catalogo.length, 'entries');
console.log('benchmarks_dre.servicos_empresas:', JSON.stringify(v05.benchmarks_dre.servicos_empresas));

// 4. Mockar fetch pro carregarParametrosV2
global.fetch = async (url) => {
  if (url.includes('parametros_versoes')) {
    return { ok:true, json: async ()=>([{id:'v2026.07',ativo:true,snapshot:v05,criado_em:'2026-04-28T00:00:00Z'}]) };
  }
  return { ok:false, status:404 };
};
global.document = { addEventListener:()=>{} };

// 5. Carregar a skill
require(path.join(process.env.HOME, '1negocio/skill-avaliadora-v2.js'));

// 6. Forste sintética
const forste = {
  nome:'Forste Consultoria (DEMO)',
  nome_responsavel:'Mariah Caroline',
  setor:'servicos_empresas',
  modelo_atuacao_multi:['presta_servico'],
  regime_tributario:'simples', anexo:'III',
  cidade:'Florianópolis', estado:'SC',
  anos_existencia:7, expectativa_valor_dono:600000, pct_produto:0,
  fat_mensal:65000, fat_anterior:0, cmv_mensal:0,
  clt_folha:17000, clt_qtd:2, pj_custo:0, pj_qtd:1,
  prolabore:0, num_socios:1,
  aluguel:4500, custo_sistemas:1200, custo_outros:7000, mkt_valor:5000,
  caixa:25000, contas_receber:8000, estoque:0, equipamentos:12000, imovel:0,
  fornec_a_vencer:6000, saldo_devedor:22000,
  recorrencia_pct:90, concentracao_pct:45,
  processos:'parcial', // domínio real do diagnóstico: 'documentados'/'parcial'/'nao'
  // Tipos de string conforme diagnóstico real ('sim'/'nao'/etc)
  passivo_trabalhista:'nao', impostos_dia:'sim',
  marca_inpi:'sem_registro', reputacao_online:'positiva',
  pmr:30, pmp:15, clientes_ativos:22, cli_1m:22,
  processos_juridicos:'nao', equipe_permanece:'sim',
  // contabilidade_formal — domínio real do diagnóstico ('sim'/'interno'/'nao')
  contabilidade_formal:'sim', dre_separacao_pf_pj:'sim',
  // gestor_autonomo é o nome REAL do diagnóstico (t33). mapDadosV2 deriva
  // tem_gestor + opera_sem_dono dele (mesma resposta).
  gestor_autonomo:'sim',
  base_clientes:'sim',
  margem_estavel:'sim',
};

(async () => {
  try {
    const calc = await window.AVALIADORA_V2.avaliar(forste, 'preview');
    const u = calc.upsides;

    if (!u || typeof u !== 'object' || !Array.isArray(u.ativos) || !Array.isArray(u.paywalls)) {
      console.error('FAIL: shape de upsides incorreta. Got:', typeof u, JSON.stringify(u).slice(0, 200));
      process.exit(1);
    }

    console.log('\n=== ATIVOS (gate disparou) ===');
    if (u.ativos.length === 0) {
      console.log('  (nenhum)');
    } else {
      u.ativos.forEach(a => {
        console.log(`  · [${a.categoria.padEnd(11)}] ${a.id.padEnd(36)} → ${a.formula_calculo.tipo}`);
      });
    }
    console.log(`\nTotal ativos: ${u.ativos.length}`);

    console.log('\n=== PAYWALLS (sempre presentes) ===');
    u.paywalls.forEach(a => {
      console.log(`  · [${a.categoria.padEnd(11)}] ${a.id.padEnd(36)} → ${a.formula_calculo.tipo}`);
    });
    console.log(`\nTotal paywalls: ${u.paywalls.length}`);

    // Análise de cada upside do catálogo: passou ou não?
    console.log('\n=== ANÁLISE POR UPSIDE DO CATÁLOGO ===');
    const ativosIds = new Set(u.ativos.map(a => a.id));
    const paywallsIds = new Set(u.paywalls.map(a => a.id));
    v05.upsides_catalogo.forEach(entry => {
      const inAtivos = ativosIds.has(entry.id);
      const inPaywall = paywallsIds.has(entry.id);
      const symbol = inAtivos ? '✓' : (inPaywall ? '◧' : '·');
      console.log(`  ${symbol} [${entry.categoria.padEnd(11)}] ${entry.id.padEnd(36)} ${inAtivos ? 'ATIVO' : (inPaywall ? 'paywall' : '')}`);
    });

    // analise_tributaria
    const at = calc.analise_tributaria;
    console.log('\n=== ANALISE_TRIBUTARIA (gap p/ tr_otimizar_tributario) ===');
    console.log('  regime_declarado:', at.regime_declarado);
    console.log('  regime_otimo_calculado:', at.regime_otimo_calculado);
    console.log('  economia_anual:', at.economia_potencial && at.economia_potencial.economia_anual);
    console.log('  gera_upside_obrigatorio:', at.gera_upside_obrigatorio);

    // valor_potencial_12m (esperado: zerado nesta fase)
    const p12 = calc.valuation && calc.valuation.valor_potencial_12m;
    console.log('\n=== valor_potencial_12m (esperado zero — agregarPotencial é commit 3) ===');
    console.log('  valor:', p12 && p12.valor);
    console.log('  delta_absoluto:', p12 && p12.delta_absoluto);
    console.log('  n_upsides_contados:', p12 && p12.n_upsides_contados);
  } catch (e) {
    console.error('THROW:', e && e.stack || e);
    process.exit(1);
  }
})();
