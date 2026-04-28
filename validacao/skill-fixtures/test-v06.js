const fs = require('fs'); const path = require('path');
global.window = global;

// Stack: 002 → 005 (atratividade/deducoes) → 006 (catálogo/caps) → 007 (pesos sub-métricas)
const sqlBase = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/002_seed_parametros_v2026_04.sql'), 'utf8');
const baseSnapshot = JSON.parse(sqlBase.match(/'(\{[\s\S]*\})'::jsonb/)[1]);

// 005: atratividade + benchmarks_dre.deducoes
const sql05 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/005_update_parametros_atratividade_deducoes.sql'), 'utf8');
const m005a = sql05.match(/'\[(.*?)\]'::jsonb/); if (m005a) baseSnapshot.faixas_atratividade = JSON.parse('[' + m005a[1] + ']');
const m005b = sql05.match(/'(\{"servicos_empresas":[\s\S]*?\})'::jsonb/); if (m005b) baseSnapshot.benchmarks_dre = JSON.parse(m005b[1]);

// 006: catalog + caps + pesos_sub_metricas (estrutura inicial v2026.05)
const sql06 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/006_seed_parametros_v2026_05.sql'), 'utf8');
const blocks06 = []; const re6 = /\$json\$([\s\S]*?)\$json\$/g; let m6;
while ((m6 = re6.exec(sql06)) !== null) blocks06.push(JSON.parse(m6[1]));
const v05 = JSON.parse(JSON.stringify(baseSnapshot));
v05._meta = blocks06[0];
for (let i = 1; i < blocks06.length; i++) Object.assign(v05, blocks06[i]);

// 007: pesos_sub_metricas atualizados (P6 renomeado, P8 com presenca_digital reativada)
const sql07 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/007_seed_parametros_v2026_06.sql'), 'utf8');
const blocks07 = []; const re7 = /\$json\$([\s\S]*?)\$json\$/g; let m7;
while ((m7 = re7.exec(sql07)) !== null) blocks07.push(JSON.parse(m7[1]));
const v06 = JSON.parse(JSON.stringify(v05));
v06._meta = blocks07[0];
for (let i = 1; i < blocks07.length; i++) Object.assign(v06, blocks07[i]);

global.fetch = async () => ({ ok:true, json: async ()=>([{id:'v2026.06',ativo:true,snapshot:v06}]) });
global.document = { addEventListener:()=>{} };
require(path.join(process.env.HOME, '1negocio/skill-avaliadora-v2.js'));

const forste = {
  nome:'Forste', nome_responsavel:'Mariah', setor:'servicos_empresas',
  modelo_atuacao_multi:['presta_servico'], regime_tributario:'simples', anexo:'III',
  fat_mensal:65000, fat_anterior:0, cmv_mensal:0,
  clt_folha:17000, clt_qtd:2, pj_custo:0, pj_qtd:1,
  prolabore:0, num_socios:1,
  aluguel:4500, custo_sistemas:1200, custo_outros:7000, mkt_valor:5000,
  caixa:25000, contas_receber:8000, estoque:0, equipamentos:12000, imovel:0,
  fornec_a_vencer:6000, saldo_devedor:22000,
  recorrencia_pct:90, concentracao_pct:45,
  processos:'parcial', gestor_autonomo:'sim', equipe_permanece:'sim',
  remuneracao_socios:'fixo', reputacao:'boa',
  online:['site','instagram','gmaps'],
  processos_juridicos:'nao', juridico_tipo:[], passivo_juridico:0,
  contabilidade_formal:'sim',
  marca_inpi:'sem_registro', impostos_dia:'sim',
  pmr:30, pmp:15, clientes_ativos:22, cli_1m:22,
  base_clientes:'sim', margem_estavel:'sim',
  anos_existencia:7, expectativa_val:600000,
};

(async () => {
  try {
    const calc = await window.AVALIADORA_V2.avaliar(forste, 'preview');
    console.log('ISE total:', calc.ise.ise_total);
    console.log('classe:', calc.ise.classe, 'fator_classe:', calc.ise.fator_classe);
    console.log('\nBreakdown por pilar:');
    calc.ise.pilares.forEach(p => {
      console.log(`  ${p.id.padEnd(22)} score=${p.score_0_10.toFixed(2)}  peso=${p.peso_pct.toFixed(0)}%  contrib=${p.contribuicao_no_total.toFixed(2)}`);
      p.sub_metricas.forEach(sm => {
        console.log(`    · ${sm.id.padEnd(30)} ${sm.score_0_10.toFixed(1)}/10  peso=${(sm.peso_decimal*100).toFixed(2)}%`);
      });
    });
    console.log('\nvalor_venda:', calc.valuation.valor_venda);
    console.log('potencial_final.brl:', calc.potencial_12m.potencial_final.brl);
    console.log('valor_projetado_brl:', calc.potencial_12m.potencial_final.valor_projetado_brl);
    console.log('cap_ise.faixa:', calc.potencial_12m.agregacao.cap_ise.faixa);
    console.log('cap_ise.aplicavel:', calc.potencial_12m.agregacao.cap_ise.cap_aplicavel);
  } catch (e) { console.error('THROW:', e.message); process.exit(1); }
})();
