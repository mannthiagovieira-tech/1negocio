// Validação Forste completa: rodar contra v2026.07 (snapshot ativo), comparar com pré-refactor
const fs = require('fs'); const path = require('path');
global.window = global;
const sqlBase = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/002_seed_parametros_v2026_04.sql'), 'utf8');
const baseSnapshot = JSON.parse(sqlBase.match(/'(\{[\s\S]*\})'::jsonb/)[1]);
const sql05 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/005_update_parametros_atratividade_deducoes.sql'), 'utf8');
const m005a = sql05.match(/'\[(.*?)\]'::jsonb/); if (m005a) baseSnapshot.faixas_atratividade = JSON.parse('[' + m005a[1] + ']');
const m005b = sql05.match(/'(\{"servicos_empresas":[\s\S]*?\})'::jsonb/); if (m005b) baseSnapshot.benchmarks_dre = JSON.parse(m005b[1]);
const sql06 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/006_seed_parametros_v2026_05.sql'), 'utf8');
const blocks06 = []; let m6; const re6 = /\$json\$([\s\S]*?)\$json\$/g;
while ((m6 = re6.exec(sql06)) !== null) blocks06.push(JSON.parse(m6[1]));
const v05 = JSON.parse(JSON.stringify(baseSnapshot));
v05._meta = blocks06[0];
for (let i = 1; i < blocks06.length; i++) Object.assign(v05, blocks06[i]);
const sql07 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/007_seed_parametros_v2026_06.sql'), 'utf8');
const blocks07 = []; let m7; const re7 = /\$json\$([\s\S]*?)\$json\$/g;
while ((m7 = re7.exec(sql07)) !== null) blocks07.push(JSON.parse(m7[1]));
const v06 = JSON.parse(JSON.stringify(v05));
v06._meta = blocks07[0];
for (let i = 1; i < blocks07.length; i++) Object.assign(v06, blocks07[i]);
// 008: P2 reduzido a 2 sub-métricas (margem_estavel removida)
const sql08 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/008_seed_parametros_v2026_07.sql'), 'utf8');
const blocks08 = []; let m8; const re8 = /\$json\$([\s\S]*?)\$json\$/g;
while ((m8 = re8.exec(sql08)) !== null) blocks08.push(JSON.parse(m8[1]));
const v07 = JSON.parse(JSON.stringify(v06));
v07._meta = blocks08[0];
v07.pesos_sub_metricas_ise.p2_resultado = blocks08[1];

global.fetch = async () => ({ ok:true, json: async ()=>([{id:'v2026.07',ativo:true,snapshot:v07}]) });
global.document = { addEventListener:()=>{} };
require(path.join(process.env.HOME, '1negocio/skill-avaliadora-v2.js'));

const forste = {
  nome:'Forste', nome_responsavel:'Mariah', setor:'servicos_empresas',
  modelo_atuacao_multi:['presta_servico'], regime_tributario:'simples', anexo:'III',
  fat_mensal:65000, cmv_mensal:0, crescimento_pct:8,
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
  const calc = await window.AVALIADORA_V2.avaliar(forste, 'preview');
  const ise = calc.ise;
  const v = calc.valuation;
  const p12 = calc.potencial_12m;
  const a = p12.agregacao;

  console.log('=== ISE — pós-refactor (snapshot v2026.07) ===');
  console.log(`ISE total: ${ise.ise_total} (classe: ${ise.classe}, fator: ${ise.fator_classe})`);
  console.log('\nBreakdown por pilar:');
  ise.pilares.forEach(p => {
    console.log(`  ${p.id.padEnd(22)} score=${p.score_0_10.toFixed(2).padStart(5)} peso=${p.peso_pct.toFixed(0).padStart(3)}% contrib=${p.contribuicao_no_total.toFixed(2)}`);
  });

  console.log('\n=== ISE — comparação ===');
  console.log(`Pré-refactor (commit 629359b — fantasmas ativos): ISE 82.4`);
  console.log(`Pós-refactor (commit 6faabdb — pesos parametrizados + 6 fantasmas tratados): ISE ${ise.ise_total}`);
  console.log(`Diferença: ${(ise.ise_total - 82.4).toFixed(1)} pontos`);

  console.log('\n=== Cap ISE — comparação ===');
  console.log(`Pré: faixa 75-89 → cap 0.65`);
  console.log(`Pós: faixa ${a.cap_ise.faixa} → cap ${a.cap_ise.cap_aplicavel}`);

  console.log('\n=== Potencial 12m — comparação ===');
  console.log(`Pré-refactor: alavancas_pre_ise=25.234%, pos_ise=25.234% (cap não acionou), final.brl=R$ 159.466, valor_projetado=R$ 791.441`);
  console.log(`Pós-refactor: alavancas_pre_ise=${(a.potencial_alavancas_pre_ise_pct*100).toFixed(3)}%, pos_ise=${(a.cap_ise.potencial_pos_ise_pct*100).toFixed(3)}%, final.brl=R$ ${p12.potencial_final.brl}, valor_projetado=R$ ${p12.potencial_final.valor_projetado_brl}`);
  console.log(`tributario_dominante: ${a.tributario_dominante}`);
})();
