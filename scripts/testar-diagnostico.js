#!/usr/bin/env node

// Maquininha de testes — diagnóstico automatizado.
// Uso: node scripts/testar-diagnostico.js scripts/perfis-teste/<arquivo>.json
//
// Fluxo:
//   1. INSERT em negocios (anon key — RLS permite)
//   2. Roda skill v2 localmente em modo 'commit' → grava laudos_v2
//   3. Dispara 9 fetches paralelos pra Edge Function gerar_textos_laudo
//   4. Reporta UUID + URLs + query SQL de validação
//
// Pré-requisitos: Node 18+ (fetch nativo).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

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

async function main() {
  const perfilPath = process.argv[2];
  if (!perfilPath) {
    console.error('Uso: node scripts/testar-diagnostico.js <caminho-perfil.json>');
    process.exit(1);
  }

  const perfil = JSON.parse(fs.readFileSync(perfilPath, 'utf-8'));
  console.log(`\n🔧 Perfil: ${path.basename(perfilPath)}`);
  console.log(`📋 ${perfil._descricao}`);
  console.log(`🎯 Esperado: ${perfil._perfil_esperado}\n`);

  // ── 1. INSERT em negocios ──
  const codigo = '1N-T' + Date.now().toString(36).slice(-5).toUpperCase();
  const negocioPayload = {
    ...perfil.negocio,
    slug: codigo,
    codigo_diagnostico: codigo,
    faturamento_anual: (perfil.dados_json.fat_mensal || 0) * 12,
    fat_mensal: perfil.dados_json.fat_mensal || 0,
    fat_anual: (perfil.dados_json.fat_mensal || 0) * 12,
    status: 'em_avaliacao',
    plano: 'gratuito',
    origem: 'maquininha_teste',
    dados_json: perfil.dados_json,
  };

  const negResp = await fetch(`${SUPABASE_URL}/rest/v1/negocios`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON,
      'Authorization': `Bearer ${SUPABASE_ANON}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(negocioPayload),
  });
  if (!negResp.ok) {
    throw new Error(`Falha ao criar negócio (HTTP ${negResp.status}): ${await negResp.text()}`);
  }
  const negData = await negResp.json();
  const negocioId = negData[0].id;
  console.log(`✓ Negócio criado: ${negocioId} (${codigo})`);

  // ── 2. Carregar skill v2 e rodar ──
  const skillCode = fs.readFileSync(path.join(__dirname, '..', 'skill-avaliadora-v2.js'), 'utf-8');

  const sandbox = {
    window: {},
    fetch,
    setTimeout,
    clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;
  sandbox.window.AVALIADORA_V2 = undefined;
  vm.createContext(sandbox);
  vm.runInContext(skillCode, sandbox);

  const AVALIADORA_V2 = sandbox.window.AVALIADORA_V2;
  if (!AVALIADORA_V2 || typeof AVALIADORA_V2.avaliar !== 'function') {
    throw new Error('AVALIADORA_V2 não foi exportada após carregar a skill v2.');
  }

  // Buscar row completo do negócio (skill v2 lê dados.dados_json || dados)
  const rowResp = await fetch(`${SUPABASE_URL}/rest/v1/negocios?id=eq.${negocioId}&select=*`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` },
  });
  const rowData = await rowResp.json();
  const dadosParaAvaliar = rowData[0];

  console.log(`⚙️  Rodando skill v2 (modo commit)...`);
  const calcJsonV2 = await AVALIADORA_V2.avaliar(dadosParaAvaliar, 'commit');
  console.log(`✓ Skill v2 OK`);
  console.log(`   rec_liquida: R$ ${Math.round(calcJsonV2.dre.rec_liquida).toLocaleString('pt-BR')}`);
  console.log(`   ro_mensal:   R$ ${Math.round(calcJsonV2.dre.ro_mensal).toLocaleString('pt-BR')}`);
  console.log(`   ISE:         ${calcJsonV2.ise.ise_total}/100 (${calcJsonV2.ise.classe})`);
  console.log(`   valor_venda: R$ ${Math.round(calcJsonV2.valuation.valor_venda).toLocaleString('pt-BR')}`);
  console.log(`   atratividade: ${calcJsonV2.atratividade?.total ?? '?'}/10`);

  // ── 3. Validar laudos_v2 persistido ──
  const laudoResp = await fetch(
    `${SUPABASE_URL}/rest/v1/laudos_v2?negocio_id=eq.${negocioId}&ativo=eq.true&select=id,versao`,
    { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
  );
  const laudoData = await laudoResp.json();
  if (!laudoData[0]) throw new Error('laudos_v2 não foi persistido (verificar se modo commit funcionou)');
  console.log(`✓ laudos_v2 persistido: id=${laudoData[0].id}, versão=${laudoData[0].versao}`);

  // ── 4. Disparar 9 fetches paralelos ──
  console.log(`\n⏳ Gerando 9 textos IA em paralelo...`);
  const inicio = Date.now();

  const promessas = TEXTOS.map((textoKey) =>
    fetch(`${SUPABASE_URL}/functions/v1/gerar_textos_laudo`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ negocio_id: negocioId, texto_a_gerar: textoKey }),
    })
      .then((r) => r.json())
      .then((j) => ({ textoKey, ok: j.ok === true, modelo: j.modelo_usado, dur: j.duracao_ms, erro: j.erro }))
      .catch((e) => ({ textoKey, ok: false, erro: e.message }))
  );

  const resultados = await Promise.all(promessas);
  const segs = ((Date.now() - inicio) / 1000).toFixed(1);
  const ok = resultados.filter((r) => r.ok);
  const fail = resultados.filter((r) => !r.ok);
  console.log(`✓ ${ok.length}/9 textos gerados em ${segs}s`);
  if (fail.length > 0) {
    console.log(`⚠️  Falhas:`);
    fail.forEach((f) => console.log(`   ✗ ${f.textoKey}: ${f.erro}`));
  }

  // ── 5. Reportar ──
  console.log('\n═══════════════════════════════════════════════');
  console.log('✓ TESTE CONCLUÍDO');
  console.log('═══════════════════════════════════════════════');
  console.log(`Código: ${codigo}`);
  console.log(`Negócio ID: ${negocioId}\n`);
  console.log('URLs pra validar:');
  console.log(`  Laudo gratuito: https://1negocio.com.br/laudo-completo.html?id=${negocioId}`);
  console.log(`  Laudo admin v2: https://1negocio.com.br/laudo-admin-v2.html?id=${negocioId}\n`);
  console.log('Query SQL de validação (S2.x):');
  console.log(`  supabase db query --linked "SELECT
      calc_json->'dre'->'bloco_1_receita'->>'antecipacao_recebiveis' AS antec,
      calc_json->'dre'->>'rec_liquida' AS rec_liq,
      calc_json->'dre'->'dre_estimados' AS estimados,
      calc_json->'indicadores_vs_benchmark'->'endividamento_vs_ro' AS endivid,
      calc_json->'potencial_12m'->'upsides_ativos'->0->>'descricao' AS desc_upside_top
    FROM laudos_v2 WHERE negocio_id='${negocioId}' AND ativo=true;"`);
}

main().catch((e) => {
  console.error('\n❌ ERRO:', e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
