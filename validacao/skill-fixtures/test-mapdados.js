const fs = require('fs'); const path = require('path');
global.window = global;
const sql = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/006_seed_parametros_v2026_05.sql'), 'utf8');
const sqlBase = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/002_seed_parametros_v2026_04.sql'), 'utf8');
const baseSnapshot = JSON.parse(sqlBase.match(/'(\{[\s\S]*\})'::jsonb/)[1]);
const blocks = []; const re = /\$json\$([\s\S]*?)\$json\$/g; let m;
while ((m = re.exec(sql)) !== null) blocks.push(JSON.parse(m[1]));
const v05 = JSON.parse(JSON.stringify(baseSnapshot));
v05._meta = blocks[0];
for (let i = 1; i < blocks.length; i++) Object.assign(v05, blocks[i]);
const sql05 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/005_update_parametros_atratividade_deducoes.sql'), 'utf8');
const m005 = sql05.match(/'\[(.*?)\]'::jsonb/); if (m005) v05.faixas_atratividade = JSON.parse('[' + m005[1] + ']');
const benchm005 = sql05.match(/'(\{"servicos_empresas":[\s\S]*?\})'::jsonb/); if (benchm005) v05.benchmarks_dre = JSON.parse(benchm005[1]);
global.fetch = async () => ({ ok:true, json: async ()=>([{id:'v2026.05',ativo:true,snapshot:v05}]) });
global.document = { addEventListener:()=>{} };
require(path.join(process.env.HOME, '1negocio/skill-avaliadora-v2.js'));

// Forste com nomes do diag REAL (não os fantasmas)
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
  // Removidos: passivo_trabalhista (substituído por juridico_tipo), reputacao_online (→ reputacao), presenca_digital (→ online)
  remuneracao_socios:'fixo',  // novo: cobre dre_separacao_pf_pj
  reputacao:'boa',            // novo: domínio real
  online:['site','instagram','gmaps'], // novo: array
  processos_juridicos:'nao', juridico_tipo:[], passivo_juridico:0,
  contabilidade_formal:'sim',
  marca_inpi:'sem_registro', impostos_dia:'sim',
  pmr:30, pmp:15, clientes_ativos:22, cli_1m:22,
  base_clientes:'sim', margem_estavel:'sim',
  anos_existencia:7, expectativa_val:600000,
};

(async () => {
  const D = window.AVALIADORA_V2._mapDados(forste);
  console.log('=== Campos derivados em mapDadosV2 ===');
  console.log('remuneracao_socios:', D.remuneracao_socios, '→ dre_separacao_pf_pj:', D.dre_separacao_pf_pj);
  console.log('reputacao:', D.reputacao, '→ reputacao_online:', D.reputacao_online);
  console.log('online:', JSON.stringify(D.online), '→ presenca_digital:', JSON.stringify(D.presenca_digital));
  console.log('juridico_tipo:', JSON.stringify(D.juridico_tipo));
  console.log('passivo_juridico:', D.passivo_juridico);
  console.log('ativo_juridico:', D.ativo_juridico);
  console.log('contabilidade:', D.contabilidade);
  console.log('gestor_autonomo:', D.gestor_autonomo);
  console.log('tem_gestor:', D.tem_gestor, 'opera_sem_dono:', D.opera_sem_dono);
  console.log();
  console.log('=== inputs_origem (novos campos) ===');
  ['remuneracao_socios','reputacao','online','juridico_tipo','passivo_juridico','contabilidade_formal']
    .forEach(k => console.log(k+':', D._origem_campos[k]));
})();
