// Validação numérica de agregarPotencial12mV2 contra Forste sintética.
// Esperado (com float pleno):
//   UP-03 contrib_brl = 98400 × 0.15 × 2.06 = 30405.60 (exato)
//   UP-11 contrib_brl = 0.5 × 258120 = 129060.00 (exato)
//   Sum bruto = 159465.60
//   pré-ISE pct = 159465.60 / 631975.76 = 0.25232864...
//   ISE 75.1 → round 75 → faixa 75-89 cap 0.65 → 0.2523 < 0.65 → não trunca
//   (pré-Frente 2.5 era ISE 82; Crescimento sem_resposta agora pontua 3, não 5)
//   pos_absoluto = 0.25232864... (não passa de 0.80)
//   final_brl = round(0.25232864 × 631975.76) = round(159465.60) = 159466
//   valor_projetado = round(631975.76 + 159465.60) = round(791441.36) = 791441

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
// 007: pesos_sub_metricas reestruturados (P6 renomeada, P8 reativa presenca_digital)
const sql07 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/007_seed_parametros_v2026_06.sql'), 'utf8');
const blocks07 = []; const re7 = /\$json\$([\s\S]*?)\$json\$/g; let m7;
while ((m7 = re7.exec(sql07)) !== null) blocks07.push(JSON.parse(m7[1]));
v05._meta = blocks07[0];
for (let i = 1; i < blocks07.length; i++) Object.assign(v05, blocks07[i]);
// 008: p2_resultado reduzido a 2 sub-métricas (margem_estavel removida)
const sql08 = fs.readFileSync(path.join(process.env.HOME, '1negocio/migrations/008_seed_parametros_v2026_07.sql'), 'utf8');
const blocks08 = []; const re8 = /\$json\$([\s\S]*?)\$json\$/g; let m8;
while ((m8 = re8.exec(sql08)) !== null) blocks08.push(JSON.parse(m8[1]));
v05._meta = blocks08[0];
v05.pesos_sub_metricas_ise.p2_resultado = blocks08[1];
global.fetch = async () => ({ ok:true, json: async ()=>([{id:'v2026.07',ativo:true,snapshot:v05}]) });
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
  passivo_trabalhista:'nao', impostos_dia:'sim', marca_inpi:'sem_registro',
  reputacao_online:'positiva', pmr:30, pmp:15, clientes_ativos:22, cli_1m:22,
  contabilidade_formal:'sim', dre_separacao_pf_pj:'sim', base_clientes:'sim',
  margem_estavel:'sim', anos_existencia:7, expectativa_val:600000,
};

(async () => {
  const calc = await window.AVALIADORA_V2.avaliar(forste, 'preview');
  const p = calc.potencial_12m;
  const recs = calc.recomendacoes_pre_venda;

  console.log('=== valor_venda base ===');
  console.log('valor_venda (float):', calc.valuation.valor_venda);

  console.log('\n=== upsides_ativos (que somam — tributario/ro/passivo/multiplo) ===');
  p.upsides_ativos.forEach(u => {
    console.log(`  · [${u.categoria.padEnd(11)}] ${u.id.padEnd(36)} bruto_pct=${(u.contribuicao_bruta_pct*100).toFixed(6)}% pos_cap_pct=${(u.contribuicao_pos_cap_categoria_pct*100).toFixed(6)}% brl=R$ ${u.contribuicao_brl}`);
  });

  console.log('\n=== agregacao ===');
  const a = p.agregacao;
  console.log('tributario:', JSON.stringify(a.tributario));
  console.log('por_categoria.ro:      ', JSON.stringify(a.por_categoria.ro));
  console.log('por_categoria.passivo: ', JSON.stringify(a.por_categoria.passivo));
  console.log('por_categoria.multiplo:', JSON.stringify(a.por_categoria.multiplo));
  console.log('potencial_alavancas_pre_ise_pct (float):', a.potencial_alavancas_pre_ise_pct);
  console.log('cap_ise:', JSON.stringify(a.cap_ise));
  console.log('cap_absoluto:', JSON.stringify(a.cap_absoluto));
  console.log('tributario_dominante:', a.tributario_dominante);

  console.log('\n=== potencial_final ===');
  console.log('pct (float):       ', p.potencial_final.pct);
  console.log('brl (rounded):     ', p.potencial_final.brl);
  console.log('valor_projetado_brl:', p.potencial_final.valor_projetado_brl);

  console.log('\n=== recomendacoes_pre_venda (qualitativos) ===');
  recs.forEach(r => console.log(`  · ${r.id.padEnd(36)} mensagem: "${r.mensagem.slice(0, 60)}..."`));

  // ── ASSERÇÕES NUMÉRICAS ─────────────────────────────────────────
  console.log('\n=== ASSERÇÕES NUMÉRICAS ===');
  let fail = false;
  function assertExact(label, got, expected, tol) {
    const diff = Math.abs(got - expected);
    const ok = (tol == null) ? (got === expected) : (diff <= tol);
    if (ok) console.log(`  ✓ ${label}: ${got} (esperado ${expected}${tol != null ? ' ±' + tol : ''})`);
    else { fail = true; console.error(`  ✗ FAIL ${label}: ${got} vs esperado ${expected} (diff ${diff})`); }
  }

  // UP-03 ro_renegociar_custos_fixos
  const up03 = p.upsides_ativos.find(u => u.id === 'ro_renegociar_custos_fixos');
  assertExact('UP-03 contribuicao_brl', up03.contribuicao_brl, 30406, 1); // round de 30405.60 = 30406
  // pct esperado: 30405.60 / 631975.76 = 0.048111..., × 100 = 4.81119...%
  const exp_up03_pct = 30405.60 / 631975.76;
  assertExact('UP-03 contribuicao_bruta_pct (float)', up03.contribuicao_bruta_pct, exp_up03_pct, 1e-9);

  // UP-11 mu_diversificar_clientes
  const up11 = p.upsides_ativos.find(u => u.id === 'mu_diversificar_clientes');
  assertExact('UP-11 contribuicao_brl', up11.contribuicao_brl, 129060, 0); // 0.5 × 258120 = 129060 exato
  const exp_up11_pct = 129060 / 631975.76;
  assertExact('UP-11 contribuicao_bruta_pct (float)', up11.contribuicao_bruta_pct, exp_up11_pct, 1e-9);

  // Soma pré-ISE
  const exp_pre_ise = (30405.60 + 129060) / 631975.76;
  assertExact('potencial_alavancas_pre_ise_pct (float)', a.potencial_alavancas_pre_ise_pct, exp_pre_ise, 1e-9);

  // ISE 75: pós-Frente 2.5 (Crescimento sem_resposta = 3). Pré-2.5 era 82.
  assertExact('ise_int (round)', a.cap_ise.ise_score_arredondado, 75, 0);
  assertExact('cap_aplicavel', a.cap_ise.cap_aplicavel, 0.65, 0);
  assertExact('cap_aplicado (false)', a.cap_ise.cap_aplicado === false ? 0 : 1, 0, 0);

  // Cap absoluto
  assertExact('cap_absoluto.aplicado (false)', a.cap_absoluto.aplicado === false ? 0 : 1, 0, 0);

  // Final
  // 0.25232864... × 631975.76 = 159465.60 → round = 159466
  const exp_final_brl = Math.round((30405.60 + 129060));
  assertExact('potencial_final.brl', p.potencial_final.brl, exp_final_brl, 1);
  // 631975.76 + 159465.60 = 791441.36 → round = 791441
  assertExact('valor_projetado_brl', p.potencial_final.valor_projetado_brl, 791441, 1);

  // Tributário
  assertExact('tributario.brl', a.tributario.brl, 0, 0);
  assertExact('tributario.pct', a.tributario.pct, 0, 0);
  assertExact('tributario_dominante (false)', a.tributario_dominante === false ? 0 : 1, 0, 0);

  // Counts
  // 2 monetários (UP-03 + UP-11), 0 tributário, 0 passivo
  assertExact('upsides_ativos count (monetários)', p.upsides_ativos.length, 2, 0);
  // 3 qualitativos: rec_documentar_processos, rec_registrar_marca, rec_aumentar_presenca_digital
  assertExact('recomendacoes_pre_venda count', recs.length, 3, 0);

  // Comparação com baseline antigo
  const baseline_old_pct = 1.23; // +123%
  const new_pct = p.potencial_final.pct;
  console.log(`\n  Baseline antigo: +${(baseline_old_pct*100).toFixed(0)}% → R$ ${(631975.76*(1+baseline_old_pct)).toFixed(0)}`);
  console.log(`  Novo (commit 3): +${(new_pct*100).toFixed(2)}% → R$ ${p.potencial_final.valor_projetado_brl}`);
  console.log(`  Redução do potencial: ${((baseline_old_pct - new_pct)*100).toFixed(1)} pp`);

  if (fail) { console.error('\n❌ FAILED — discrepâncias numéricas detectadas'); process.exit(1); }
  console.log('\n✓ TODAS AS ASSERÇÕES PASSARAM');
})();
