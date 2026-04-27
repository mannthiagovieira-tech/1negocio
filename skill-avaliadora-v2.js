/**
 * skill-avaliadora-v2.js
 * Skill de avaliação 1Negócio - versão 2.0
 * Implementa spec calc_json v2 (rev2) com 21 decisões arquiteturais.
 * Substituirá skill-avaliadora.js após validação em produção (Decisão #21).
 *
 * Estrutura de cálculo:
 *  1. Carregamento de parâmetros versionados (tabela parametros_versoes)
 *  2. mapDadosV2(D) - normaliza inputs do diagnóstico
 *  3. calcDREv2(D, P) - DRE em 5 blocos (Decisão #14, #17)
 *  4. calcBalancoV2(D, P) - inclui provisão CLT 13% × 6 (Decisão #20)
 *  5. calcISEv2(D, dre, bal, P) - 8 pilares (Decisão #13)
 *  6. calcValuationV2(D, dre, bal, ise, P) - Bloco 1 corrigido (Decisão #19)
 *  7. calcAtratividadeV2(D, dre, ise, P) - 3 componentes (50/25/25)
 *  8. calcAnaliseTributariaV2(D, dre, P) - 3 regimes comparados
 *  9. gerarUpsidesV2(D, dre, bal, ise, valuation, P)
 * 10. montarCalcJsonV2(...) - schema aninhado v2
 * 11. salvarCalcJsonV2(negocio_id, calcJson, parametros_versao_id)
 *      - INSERT em laudos_v2, marca anterior como ativo=false
 * 12. avaliarV2(dadosBrutos, modo) - pipeline principal
 *      - modo='preview' retorna sem persistir
 *      - modo='commit' persiste em laudos_v2
 */

(function () {
  if (window.AVALIADORA_V2) return;

  const SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

  // Cache da versão ativa de parâmetros
  let _parametros = null;
  let _parametrosVersaoId = null;

  // ============================================================
  // HELPERS
  // ============================================================

  const n = (v) => {
    if (v === null || v === undefined || v === '') return 0;
    const num = Number(v);
    return isNaN(num) ? 0 : num;
  };

  const p1 = (v) => Math.round(n(v) * 10) / 10;

  const pct = (v, total) => {
    if (!total || total === 0) return 0;
    return (n(v) / n(total)) * 100;
  };

  const hoje = () => new Date().toISOString();

  const brl = (v) => {
    const num = n(v);
    return num.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0
    });
  };

  // ============================================================
  // CARREGAR PARÂMETROS VERSIONADOS
  // ============================================================

  async function carregarParametrosV2() {
    if (_parametros) return _parametros;

    try {
      const url = `${SUPABASE_URL}/rest/v1/parametros_versoes?ativo=eq.true&select=id,snapshot`;
      const res = await fetch(url, {
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`
        }
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ao carregar parametros_versoes`);
      }

      const data = await res.json();
      if (!data || data.length === 0) {
        throw new Error('Nenhuma versão ativa de parâmetros encontrada');
      }

      _parametros = data[0].snapshot;
      _parametrosVersaoId = data[0].id;

      console.log('[skill-v2] Parâmetros carregados:', _parametrosVersaoId);
      return _parametros;
    } catch (err) {
      console.error('[skill-v2] Erro ao carregar parâmetros:', err);
      throw err;
    }
  }

  // ============================================================
  // PIPELINE PRINCIPAL (esqueleto)
  // ============================================================

  async function avaliarV2(dadosBrutos, modo = 'preview') {
    if (!['preview', 'commit'].includes(modo)) {
      throw new Error(`Modo inválido: ${modo}. Use 'preview' ou 'commit'.`);
    }

    const P = await carregarParametrosV2();

    // TODO Fase 2.3: implementar mapDadosV2, calcDREv2, calcBalancoV2,
    // calcISEv2, calcValuationV2, calcAtratividadeV2,
    // calcAnaliseTributariaV2, gerarUpsidesV2, montarCalcJsonV2

    return {
      _versao_calc_json: '2.0',
      _versao_parametros: _parametrosVersaoId,
      _data_avaliacao: hoje(),
      _skill_versao: '2.0.0-skeleton',
      _modo: modo,
      _status: 'esqueleto - cálculos não implementados ainda'
    };
  }

  // ============================================================
  // EXPORTAÇÃO GLOBAL
  // ============================================================

  window.AVALIADORA_V2 = {
    avaliar: avaliarV2,
    carregarParametros: carregarParametrosV2,
    _getParams: () => _parametros,
    _getVersaoParametros: () => _parametrosVersaoId
  };

  console.log('[skill-v2] Esqueleto carregado. Aguardando implementação dos cálculos.');
})();
