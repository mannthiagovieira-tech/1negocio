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

  // Picks the first positive numeric in the list (hierarquia: campo direto > calc > fallback)
  const p1 = (...vs) => {
    for (const v of vs) {
      if (v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) > 0) {
        return parseFloat(v);
      }
    }
    return 0;
  };

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
  // MAPEAMENTO DE SETOR / MODELO / ANEXO
  // ============================================================

  function mapSetor(setor) {
    if (!setor) return 'servicos_locais';
    const s = String(setor).toLowerCase().normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
    const mapa = {
      'alimentacao':'alimentacao','restaurante':'alimentacao','bar':'alimentacao',
      'lanchonete':'alimentacao','padaria':'alimentacao','pizzaria':'alimentacao',
      'cafeteria':'alimentacao','food':'alimentacao','delivery':'alimentacao',
      'saude':'saude','clinica':'saude','medic':'saude','odonto':'saude',
      'fisio':'saude','nutri':'saude','psico':'saude','farma':'saude','veterina':'saude',
      'educacao':'educacao','escola':'educacao','curso':'educacao',
      'treinamento':'educacao','idioma':'educacao','creche':'educacao','ead':'educacao',
      'beleza':'beleza_estetica','estetica':'beleza_estetica','salao':'beleza_estetica',
      'barbearia':'beleza_estetica','spa':'beleza_estetica','cabeleir':'beleza_estetica',
      'bem_estar':'bem_estar','academia':'bem_estar','crossfit':'bem_estar',
      'pilates':'bem_estar','fitness':'bem_estar','studio':'bem_estar',
      'varejo':'varejo','loja':'varejo','comercio':'varejo','ecommerce':'varejo',
      'pet':'varejo','otica':'varejo','moda':'varejo','farmacia':'varejo',
      'hotel':'hospedagem','pousada':'hospedagem','hostel':'hospedagem',
      'airbnb':'hospedagem','turismo':'hospedagem',
      'logistica':'logistica','transporte':'logistica','frete':'logistica',
      'industria':'industria','fabrica':'industria','manufat':'industria','confec':'industria',
      'construcao':'construcao','obra':'construcao','engenharia':'construcao','incorpor':'construcao',
      'servicos_empresas':'servicos_empresas','b2b':'servicos_empresas','consultoria':'servicos_empresas',
      'agencia':'servicos_empresas','tecnologia':'servicos_empresas','software':'servicos_empresas',
      'ti':'servicos_empresas','contabilidade':'servicos_empresas','advocacia':'servicos_empresas','saas':'servicos_empresas',
    };
    for (const k in mapa) {
      if (s.includes(k)) return mapa[k];
    }
    return 'servicos_locais';
  }

  function mapModelo(multi) {
    const ordem = ['saas','assinatura','vende_governo','distribuicao','presta_servico','fabricacao','produz_revende','revenda'];
    if (!multi || !Array.isArray(multi) || multi.length === 0) return 'presta_servico';
    for (const m of ordem) {
      if (multi.includes(m)) return m;
    }
    return multi[0] || 'presta_servico';
  }

  function inferirAnexoSimples(setor_code) {
    // Inferência simples (sem Fator R / forma de atuação).
    // Para a regra completa com Fator R use determinarAnexoSimples().
    const anexoMap = {
      'alimentacao':'I','varejo':'I','industria':'II',
      'saude':'III','educacao':'III','beleza_estetica':'III',
      'bem_estar':'III','hospedagem':'III','logistica':'III',
      'construcao':'IV','servicos_empresas':'III','servicos_locais':'III',
    };
    return anexoMap[setor_code] || 'III';
  }

  // Regra completa de enquadramento no Simples (com Fator R).
  function determinarAnexoSimples(setor_code, forma_principal, fator_r) {
    // Logística é caso especial (precede a regra geral)
    if (setor_code === 'logistica') {
      return forma_principal === 'distribuicao' ? 'I' : 'III';
    }

    // Setores que passam pelo teste do Fator R
    const setoresFatorR = ['servicos_empresas', 'educacao', 'saude', 'servicos_locais'];
    const aplicaFatorR = setoresFatorR.includes(setor_code) || forma_principal === 'saas';
    if (aplicaFatorR) {
      return n(fator_r) >= 0.28 ? 'III' : 'V';
    }

    // Serviços que ficam no III sem teste de Fator R
    if (['beleza_estetica', 'bem_estar', 'hospedagem', 'alimentacao'].includes(setor_code)) {
      return 'III';
    }

    if (setor_code === 'construcao') return 'IV';

    if (forma_principal === 'fabricacao' || setor_code === 'industria') return 'II';

    if (forma_principal === 'revenda' || setor_code === 'varejo') return 'I';

    return 'III'; // default conservador
  }

  // ============================================================
  // HELPERS TRIBUTÁRIOS
  // (Decisão #14 — cálculo pela regra real; #17 — 3 bases por regime)
  //
  // Etapa 2.8.A entregue: 5 anexos completos do Simples + regra do Fator R.
  // Anexo IV: INSS patronal POR FORA (não no DAS) — afeta calcEncargosCLT.
  //
  // TODO Etapa 2.8.B — ISS municipal (~5% serviço) e ICMS estadual (~18%
  // comércio/indústria) não estão sendo somados nos regimes Presumido/Real —
  // apenas PIS/COFINS. No Simples já estão embutidos nas alíquotas, mas em
  // Presumido/Real hoje subestimamos a carga tributária total.
  // ============================================================

  function calcImpostoSobreFaturamento(fat_anual, regime, anexo, P, contexto) {
    const fat_mensal = fat_anual / 12;
    const ctx = contexto || {};

    if (regime === 'mei') {
      const fixoMensal = (anexo === 'I' || anexo === 'II') ? 75.90 : 80.90;
      return {
        mensal: fixoMensal,
        anual: fixoMensal * 12,
        pct: fat_mensal > 0 ? (fixoMensal / fat_mensal) * 100 : 0,
        regime: 'MEI',
        anexo: null,
        detalhes: 'Valor fixo mensal',
        fator_r_calculado: null,
        fator_r_aplicado: false,
        migracao_anexo: null,
        observacao_fator_r: null,
      };
    }

    if (regime === 'simples') {
      // Tabelas oficiais 2025 — Anexos I a V (alíquota nominal e parcela a deduzir).
      const tabelas = {
        'I': [
          { ate: 180000,  aliq: 0.04,  ded: 0 },
          { ate: 360000,  aliq: 0.073, ded: 5940 },
          { ate: 720000,  aliq: 0.095, ded: 13860 },
          { ate: 1800000, aliq: 0.107, ded: 22500 },
          { ate: 3600000, aliq: 0.143, ded: 87300 },
          { ate: 4800000, aliq: 0.19,  ded: 378000 },
        ],
        'II': [
          { ate: 180000,  aliq: 0.045, ded: 0 },
          { ate: 360000,  aliq: 0.078, ded: 5940 },
          { ate: 720000,  aliq: 0.10,  ded: 13860 },
          { ate: 1800000, aliq: 0.112, ded: 22500 },
          { ate: 3600000, aliq: 0.147, ded: 85500 },
          { ate: 4800000, aliq: 0.30,  ded: 720000 },
        ],
        'III': [
          { ate: 180000,  aliq: 0.06,  ded: 0 },
          { ate: 360000,  aliq: 0.112, ded: 9360 },
          { ate: 720000,  aliq: 0.135, ded: 17640 },
          { ate: 1800000, aliq: 0.16,  ded: 35640 },
          { ate: 3600000, aliq: 0.21,  ded: 125640 },
          { ate: 4800000, aliq: 0.33,  ded: 648000 },
        ],
        'IV': [
          { ate: 180000,  aliq: 0.045, ded: 0 },
          { ate: 360000,  aliq: 0.09,  ded: 8100 },
          { ate: 720000,  aliq: 0.102, ded: 12420 },
          { ate: 1800000, aliq: 0.14,  ded: 39780 },
          { ate: 3600000, aliq: 0.22,  ded: 183780 },
          { ate: 4800000, aliq: 0.33,  ded: 828000 },
        ],
        'V': [
          { ate: 180000,  aliq: 0.155, ded: 0 },
          { ate: 360000,  aliq: 0.18,  ded: 4500 },
          { ate: 720000,  aliq: 0.195, ded: 9900 },
          { ate: 1800000, aliq: 0.205, ded: 17100 },
          { ate: 3600000, aliq: 0.23,  ded: 62100 },
          { ate: 4800000, aliq: 0.305, ded: 540000 },
        ],
      };

      // ── Fator R (informativo) ──
      let fator_r_calculado = null;
      if (n(ctx.folha_anual_total) > 0 && fat_anual > 0) {
        fator_r_calculado = ctx.folha_anual_total / fat_anual;
      }

      // ── Recomendação da regra completa ──
      let anexo_recomendado = null;
      let fator_r_aplicado = false;
      if (ctx.setor_code) {
        const setoresFatorR = ['servicos_empresas', 'educacao', 'saude', 'servicos_locais'];
        fator_r_aplicado = setoresFatorR.includes(ctx.setor_code) || ctx.forma_principal === 'saas';
        anexo_recomendado = determinarAnexoSimples(
          ctx.setor_code,
          ctx.forma_principal,
          n(fator_r_calculado)
        );
      }

      // Anexo declarado vence; se ausente, usa recomendação; fallback III.
      const anexo_para_calc = anexo || anexo_recomendado || 'III';

      // Discrepância → migracao_anexo + observacao (apenas quando Fator R aplica).
      let migracao_anexo = null;
      let observacao_fator_r = null;
      if (fator_r_aplicado && anexo_recomendado && anexo_recomendado !== anexo_para_calc) {
        migracao_anexo = anexo_para_calc + '_para_' + anexo_recomendado + '_por_fator_r';
        observacao_fator_r = 'Sua atividade pode estar sujeita ao Fator R do Simples Nacional. Confirme com seu contador o anexo correto.';
      }

      const tab = tabelas[anexo_para_calc] || tabelas['III'];
      const faixa = tab.find(f => fat_anual <= f.ate) || tab[tab.length - 1];
      const aliq_efetiva = fat_anual > 0
        ? Math.max(0, (fat_anual * faixa.aliq - faixa.ded) / fat_anual)
        : faixa.aliq;
      const mensal = fat_mensal * aliq_efetiva;

      return {
        mensal,
        anual: mensal * 12,
        pct: aliq_efetiva * 100,
        regime: 'Simples Nacional',
        anexo: anexo_para_calc,
        detalhes: 'Anexo ' + anexo_para_calc + ' — alíquota efetiva ' + (aliq_efetiva * 100).toFixed(2) + '%',
        fator_r_calculado,
        fator_r_aplicado,
        migracao_anexo,
        observacao_fator_r,
      };
    }

    if (regime === 'presumido') {
      // Apenas PIS/COFINS cumulativos sobre faturamento (TODO 2.8.B inclui ISS/ICMS).
      const pct = 3.65;
      const mensal = fat_mensal * (pct / 100);
      return {
        mensal,
        anual: mensal * 12,
        pct,
        regime: 'Lucro Presumido',
        anexo: null,
        detalhes: 'PIS 0,65% + COFINS 3% (cumulativo). IRPJ/CSLL no Bloco 4.',
        fator_r_calculado: null,
        fator_r_aplicado: false,
        migracao_anexo: null,
        observacao_fator_r: null,
      };
    }

    if (regime === 'real') {
      // PIS/COFINS não-cumulativos sobre faturamento (TODO 2.8.B inclui ISS/ICMS).
      const pct = 9.25;
      const mensal = fat_mensal * (pct / 100);
      return {
        mensal,
        anual: mensal * 12,
        pct,
        regime: 'Lucro Real',
        anexo: null,
        detalhes: 'PIS 1,65% + COFINS 7,6% (não-cumulativo, sem créditos). IRPJ/CSLL no Bloco 4 sobre RO.',
        fator_r_calculado: null,
        fator_r_aplicado: false,
        migracao_anexo: null,
        observacao_fator_r: null,
      };
    }

    const mensal = fat_mensal * 0.10;
    return {
      mensal,
      anual: mensal * 12,
      pct: 10,
      regime: 'Estimativa',
      anexo: 'III',
      detalhes: 'Fallback 10% — regime não reconhecido',
      fator_r_calculado: null,
      fator_r_aplicado: false,
      migracao_anexo: null,
      observacao_fator_r: null,
    };
  }

  function calcImpostosSobreLucro(D, ro_mensal) {
    const regime = D.regime;
    const setor_code = D.setor_code;
    const fat_mensal = D.fat_mensal;

    if (regime === 'mei' || regime === 'simples') {
      return { irpj: 0, csll: 0, total: 0, observacao: 'Inclusos no DAS/MEI', detalhes: '' };
    }

    // Tipo de presunção: serviços × comércio/indústria
    const tipo_servico = !['varejo','alimentacao','industria'].includes(setor_code);

    if (regime === 'presumido') {
      const presuncao_irpj = tipo_servico ? 0.32 : 0.08;
      const presuncao_csll = tipo_servico ? 0.32 : 0.12;
      const base_irpj = fat_mensal * presuncao_irpj;
      const base_csll = fat_mensal * presuncao_csll;
      const irpj = base_irpj * 0.15 + Math.max(0, base_irpj - 20000) * 0.10;
      const csll = base_csll * 0.09;
      return {
        irpj, csll, total: irpj + csll,
        observacao: `Presunção ${(presuncao_irpj*100).toFixed(0)}% IRPJ / ${(presuncao_csll*100).toFixed(0)}% CSLL`,
        detalhes: 'IRPJ 15% + adicional 10% sobre excesso de R$ 20k/mês de presunção; CSLL 9%.',
      };
    }

    if (regime === 'real') {
      if (ro_mensal <= 0) {
        return { irpj: 0, csll: 0, total: 0, observacao: 'RO negativo: sem incidência', detalhes: '' };
      }
      const irpj = ro_mensal * 0.15 + Math.max(0, ro_mensal - 20000) * 0.10;
      const csll = ro_mensal * 0.09;
      return {
        irpj, csll, total: irpj + csll,
        observacao: 'IRPJ 15% + adicional 10% / CSLL 9% sobre RO',
        detalhes: 'Decisão #17 — base = RO mensal',
      };
    }

    return { irpj: 0, csll: 0, total: 0, observacao: 'Regime desconhecido', detalhes: '' };
  }

  function calcEncargosCLT(folha, regime, anexo, setor_code, P) {
    if (!folha || folha <= 0) {
      return { encargos: 0, pct_total: 0, fgts: 0, inss_patronal: 0, rat: 0, terceiros: 0 };
    }
    const fgts_pct = 8;
    const inss_patronal_pct = 20;
    const terceiros_pct = 5.8; // INCRA, SESI/SESC, SEBRAE, salário-educação
    const rat_pct = (P && P.rat_por_setor && P.rat_por_setor[setor_code] !== undefined)
      ? P.rat_por_setor[setor_code]
      : 1.0;

    let pct_total;
    let fgts = folha * (fgts_pct / 100);
    let inss = 0, rat = 0, terc = 0;

    if (regime === 'mei') {
      // FGTS 8% + INSS patronal 3% (regra MEI ao contratar 1 empregado)
      pct_total = fgts_pct + 3;
      inss = folha * 0.03;
    } else if (regime === 'simples') {
      // Anexos I, II, III, V: INSS patronal incluso no DAS — só FGTS.
      // Anexo IV: INSS patronal POR FORA — encargos completos como Presumido/Real.
      if (anexo === 'IV') {
        pct_total = fgts_pct + inss_patronal_pct + rat_pct + terceiros_pct;
        inss = folha * (inss_patronal_pct / 100);
        rat = folha * (rat_pct / 100);
        terc = folha * (terceiros_pct / 100);
      } else {
        pct_total = fgts_pct;
      }
    } else {
      // Presumido / Real — encargos completos
      pct_total = fgts_pct + inss_patronal_pct + rat_pct + terceiros_pct;
      inss = folha * (inss_patronal_pct / 100);
      rat = folha * (rat_pct / 100);
      terc = folha * (terceiros_pct / 100);
    }

    const encargos = folha * (pct_total / 100);
    return {
      encargos,
      pct_total,
      fgts,
      inss_patronal: inss,
      rat,
      terceiros: terc,
    };
  }

  // ============================================================
  // mapDadosV2 — normaliza o input do diagnóstico
  // (Decisão #3 — rastreabilidade da origem dos campos)
  // ============================================================

  function mapDadosV2(dados) {
    const d = dados.dados_json || dados;
    const origem = {};

    const tag = (campo, val, override) => {
      if (override) origem[campo] = override;
      else origem[campo] = val > 0 ? 'informado' : 'fallback_zero';
      return val;
    };

    // ── Faturamento e crescimento ──
    const fat_mensal = tag('fat_mensal',
      p1(d.fat_mensal, dados.fat_mensal, dados.faturamento_anual ? dados.faturamento_anual/12 : 0));
    const fat_anual = tag('fat_anual',
      p1(d.fat_anual, dados.faturamento_anual, d.faturamento_anual, fat_mensal * 12));
    const fat_anterior = tag('fat_anterior',
      p1(d.fat_anterior, d.fat_ano_anterior, dados.fat_anterior, dados.fat_ano_anterior));

    // TODO Etapa 2.7 (Atratividade): garantir que crescimento_pct usa o histórico
    // real (fat_anual vs fat_anterior), e não a projeção otimista que o vendedor
    // possa ter declarado em d.crescimento_pct. Se houver os dois, preferir o calculado.
    let crescimento_pct = n(d.crescimento_pct);
    if (crescimento_pct !== 0) {
      origem.crescimento_pct = 'informado';
    } else if (fat_anterior > 0 && fat_anual > 0) {
      crescimento_pct = ((fat_anual - fat_anterior) / fat_anterior) * 100;
      origem.crescimento_pct = 'calculado';
    } else {
      origem.crescimento_pct = 'fallback_zero';
    }

    // ── Regime tributário (normalizado) ──
    const regimeRaw = d.regime || d.regime_tributario || dados.regime_tributario || dados.regime || 'simples';
    const regime = String(regimeRaw).toLowerCase().replace(/ /g, '_')
      .replace('simples_nacional', 'simples')
      .replace('lucro_presumido', 'presumido')
      .replace('lucro_real', 'real');

    // ── Setor e anexo ──
    const setor_raw = dados.setor || d.setor || 'servicos_locais';
    const setor_code = mapSetor(setor_raw);
    // Anexo: respeita declaração do diagnóstico se houver; senão infere por setor.
    // A regra completa com Fator R roda dentro de calcImpostoSobreFaturamento.
    const anexo_declarado = d.anexo_simples || d.anexo || dados.anexo_simples || dados.anexo;
    const anexo = anexo_declarado
      ? String(anexo_declarado).toUpperCase().replace(/^ANEXO\s*/, '').trim()
      : inferirAnexoSimples(setor_code);

    // ── Modelo de atuação ──
    const modelo_multi = Array.isArray(d.modelo_atuacao_multi) ? d.modelo_atuacao_multi : [];
    const modelo_code = mapModelo(modelo_multi);

    // ── CMV ──
    const cmv_pct_input = n(d.cmv_pct);
    let cmv_mensal = n(d.cmv_valor);
    if (cmv_mensal <= 0 && cmv_pct_input > 0) cmv_mensal = fat_mensal * cmv_pct_input / 100;
    if (cmv_mensal > 0 || d.cmv_fonte === 'informado' || d.cmv_fonte === 'informado_pct') {
      origem.cmv_mensal = 'informado';
    } else if (d.cmv_fonte === 'servico_puro') {
      origem.cmv_mensal = 'informado_zero';
    } else {
      origem.cmv_mensal = 'fallback_zero';
    }

    // ── Custos de transação ──
    const taxas_recebimento = tag('taxas_recebimento',
      p1(d.custo_recebimento_total, d.custo_cartoes, d.custo_taxas_recebimento, d.custo_recebimento));
    const comissoes = tag('comissoes', n(d.custo_comissoes));

    // ── Franquia (T07 — gate para royalty/fundo) ──
    const franquia = String(d.franquia || dados.franquia || 'nao').toLowerCase();
    origem.franquia = (franquia === 'sim' || franquia === 'nao') ? 'informado' : 'fallback_zero';
    const royalty_pct = tag('royalty_pct', n(d.royalty_pct));
    const royalty_fixo = tag('royalty_fixo', n(d.royalty_valor));
    const mkt_franquia_pct = tag('mkt_franquia_pct', n(d.mkt_franquia_pct));
    const mkt_franquia_fixo = tag('mkt_franquia_fixo', n(d.mkt_franquia_valor));

    // ── Pessoal ──
    const clt_folha = tag('clt_folha', p1(d.clt_folha, d.custo_pessoal));
    const clt_qtd = n(p1(d.clt_qtd, dados.clt_qtd));
    const pj_custo = tag('pj_custo', n(d.pj_custo));
    const pj_qtd = n(p1(d.pj_qtd, dados.pj_qtd));

    // ── Ocupação ──
    let aluguel_origem = 'fallback_zero';
    const aluguel = p1(d.aluguel, dados.aluguel);
    if (aluguel > 0) {
      aluguel_origem = 'informado';
    } else if (d.aluguel_zero_confirmado || ['home','digital'].includes(d.local_tipo)) {
      aluguel_origem = 'informado_zero';
    }
    origem.aluguel = aluguel_origem;
    const custo_utilities = tag('custo_utilities', p1(d.custo_utilities, d.facilities));
    const custo_terceiros = tag('custo_terceiros', p1(d.custo_terceiros, d.terceirizados));

    // ── Operacional outros ──
    const custo_sistemas = tag('custo_sistemas', n(d.custo_sistemas));
    const custo_outros = tag('custo_outros', n(d.custo_outros));
    const mkt_valor = tag('mkt_valor', n(d.mkt_valor));

    // ── Sócio (abaixo do RO) ──
    const prolabore = tag('prolabore', p1(d.prolabore, d.prolabore_calculado, dados.prolabore));
    const parcelas = tag('parcelas', p1(d.parcelas_mensais, dados.parcelas_mensais));
    const antecipacao_caixa = tag('antecipacao_caixa', n(d.custo_antecipacao));
    const investimentos = tag('investimentos', n(d.investimentos_mensais));

    // ── Balanço ── ativos (naming v2)
    const caixa = tag('caixa', p1(d.at_caixa, d.caixa));
    const contas_receber = tag('contas_receber', p1(d.at_cr, d.contas_receber));
    const estoque = tag('estoque', p1(d.at_estoque, d.estoque_valor, d.estoque));
    const equipamentos = tag('equipamentos', p1(d.at_equip, d.equipamentos));
    const imovel = tag('imovel', p1(d.at_imovel, d.imovel));
    const ativo_franquia = tag('ativo_franquia', p1(d.ativo_franquia, d.taxa_franquia_proporcional));
    const outros_ativos = tag('outros_ativos', n(d.outros_ativos));

    // ── Balanço ── passivos (naming v2 + split fornecedores)
    const fornec_a_vencer = tag('fornec_a_vencer',
      p1(d.fornec_a_vencer, d.pv_forn_a_vencer, d.fornec_a_pagar, d.pv_forn, d.contas_pagar));
    const fornec_atrasadas = tag('fornec_atrasadas',
      p1(d.fornec_atrasadas, d.fornec_atrasados, d.pv_forn_atrasadas));
    const impostos_atrasados = tag('impostos_atrasados', n(d.impostos_atrasados));
    const folha_pagar = tag('folha_pagar', n(d.folha_pagar));
    const saldo_devedor = tag('saldo_devedor', p1(d.saldo_devedor, d.emprestimos, dados.saldo_devedor));
    const outros_passivos = tag('outros_passivos', n(d.outros_passivos));

    // ── Ciclo financeiro (PMR / PMP em dias) ──
    const pmr = n(p1(d.pmr, d.prazo_medio_recebimento));
    const pmp = n(p1(d.pmp, d.prazo_medio_pagamento));

    // ── Qualitativo ISE ──
    const processos = d.processos || 'parcial';
    const dependencia = d.dependencia || 'parcial';
    const marca_inpi = d.marca_inpi || 'nao';
    const processos_juridicos = String(d.processos_juridicos || 'nao').toLowerCase();

    // ── Qualitativo ISE v2 (8 pilares — Decisão #13) ──
    const dre_separacao_pf_pj = d.dre_separacao_pf_pj || dados.dre_separacao_pf_pj || null;
    const contabilidade = d.contabilidade || dados.contabilidade || null;
    const margem_estavel = d.margem_estavel || dados.margem_estavel || null;
    const base_clientes = d.base_clientes || dados.base_clientes || null;
    const tem_gestor = d.tem_gestor || dados.tem_gestor || null;
    const opera_sem_dono = d.opera_sem_dono || dados.opera_sem_dono || null;
    const equipe_permanece = d.equipe_permanece || dados.equipe_permanece || null;
    const passivo_trabalhista = d.passivo_trabalhista || dados.passivo_trabalhista || null;
    const impostos_dia = d.impostos_dia || dados.impostos_dia || null;
    const reputacao_online = d.reputacao_online || dados.reputacao_online || null;
    const presenca_digital = d.presenca_digital || dados.presenca_digital || null;

    let recorrencia_pct;
    const rv = d.recorrencia_pct !== undefined ? d.recorrencia_pct : dados.recorrencia_pct;
    if (rv === 'nao' || rv === false || rv === 'false') recorrencia_pct = 0;
    else if (rv === 'sim' || rv === true || rv === 'true') recorrencia_pct = 100;
    else recorrencia_pct = n(rv);

    const concentracao_pct = n(p1(d.concentracao_pct, d.maior_cliente_pct));

    let crescimento_label = d.crescimento || 'estavel';
    if (crescimento_label === 'declinando') crescimento_label = 'caindo';
    if (!['10a20','ate20','mais20','ate10','caindo','estavel'].includes(crescimento_label)) {
      crescimento_label = 'estavel';
    }

    // ── Operacional ──
    const num_funcs = n(p1(dados.num_funcionarios, d.num_funcs, d.num_funcionarios, d.clt_qtd));
    const clientes = n(p1(d.cli_1m, d.clientes_ativos));
    const ticket = n(p1(d.ticket_medio));

    // ── Hooks Rede de Parceiros (Decisão #21 — nullable) ──
    const parceiro_origem_id = dados.parceiro_origem_id || d.parceiro_origem_id || null;
    const parceiro_destino_id = dados.parceiro_destino_id || d.parceiro_destino_id || null;
    const tese_id = dados.tese_id || d.tese_id || null;

    return {
      id: dados.id,
      codigo: d.codigo_diagnostico || dados.codigo_diagnostico || dados.slug || '',
      nome: dados.nome || d.nome_negocio || d.nome || 'Empresa',
      setor_raw, setor_code,
      cidade: dados.cidade || d.cidade || '',
      estado: dados.estado || d.estado || '',
      anos: n(p1(dados.anos_existencia, d.anos_existencia, d.cnpj_anos, dados.cnpj_anos)),

      regime, anexo,

      fat_mensal, fat_anual, fat_anterior,
      crescimento_pct, crescimento_label,

      // Pré-calculados (overrides do diagnóstico)
      impostos_precalc: n(p1(d.impostos_mensal, d.imposto_calculado)),
      aliquota_precalc: n(d.aliquota_imposto),

      // Custos de transação
      taxas_recebimento, comissoes,

      // Franquia
      franquia,
      royalty_pct, royalty_fixo, mkt_franquia_pct, mkt_franquia_fixo,

      // CMV
      cmv_mensal, cmv_pct: cmv_pct_input,

      // Pessoal
      clt_folha, clt_qtd, pj_custo, pj_qtd,

      // Ocupação
      aluguel, custo_utilities, custo_terceiros,

      // Operacional outros
      custo_sistemas, custo_outros, mkt_valor,

      // Abaixo do RO
      prolabore, parcelas, antecipacao_caixa, investimentos,

      // Balanço (naming v2)
      caixa, contas_receber, estoque, equipamentos, imovel, ativo_franquia, outros_ativos,
      fornec_a_vencer, fornec_atrasadas, impostos_atrasados, folha_pagar, saldo_devedor, outros_passivos,
      pmr, pmp,

      // Qualitativo
      processos, dependencia, marca_inpi, processos_juridicos,
      recorrencia_pct, concentracao_pct,

      // Qualitativo v2 (8 pilares ISE)
      dre_separacao_pf_pj, contabilidade, margem_estavel, base_clientes,
      tem_gestor, opera_sem_dono, equipe_permanece, passivo_trabalhista,
      impostos_dia, reputacao_online, presenca_digital,

      // Operacional
      num_funcs, clientes, ticket,

      // Modelo
      modelo_multi, modelo_code,

      // Hooks Rede (Decisão #21)
      parceiro_origem_id, parceiro_destino_id, tese_id,

      // Extras
      expectativa_val: n(p1(d.expectativa_val, dados.expectativa_val)),
      descricao: dados.descricao || d.descricao_final || d.descricao || '',

      _origem_campos: origem,
      _raw: d,
    };
  }

  // ============================================================
  // calcDREv2 — DRE em 5 blocos (Decisão #14, #17, #18)
  // ============================================================

  function calcDREv2(D, P) {
    const fat_mensal = D.fat_mensal;
    const fat_anual = D.fat_anual || (fat_mensal * 12);

    // ── BLOCO 1: Receita e deduções ──
    // Decisão #14: DRE usa o cálculo OFICIAL (regra real), não o declarado pelo vendedor.
    // O valor declarado fica ao lado como informação; diferença vira passivo potencial.
    const formas_lista = D.modelo_atuacao_multi || D.modelo_multi || [];
    const contexto_imposto = {
      folha_anual_total: (n(D.clt_folha) + n(D.prolabore)) * 12,
      setor_code: D.setor_code,
      forma_principal: D.modelo_atuacao_principal || D.modelo_code || formas_lista[0],
    };
    const calcReal = calcImpostoSobreFaturamento(fat_anual, D.regime, D.anexo, P, contexto_imposto);
    const impostos_mensal = calcReal.mensal;
    const impostos_pct = calcReal.pct;
    const impostos_detalhes = calcReal.detalhes;
    const impostos_anexo = calcReal.anexo;
    const impostos_regime = calcReal.regime;

    const impostos_declarado = D.impostos_precalc > 0
      ? D.impostos_precalc
      : (D.aliquota_precalc > 0 ? D.aliquota_precalc * fat_mensal : null);
    const diferenca_potencial_passivo = impostos_declarado !== null
      ? Math.max(0, impostos_mensal - impostos_declarado)
      : 0;

    const taxas_recebimento = D.taxas_recebimento;
    const comissoes = D.comissoes;

    // Royalty / fundo de marketing só aplicam se for franquia (gate D.franquia === 'sim')
    const is_franquia = D.franquia === 'sim';
    const royalty_pct_aplicado = is_franquia ? fat_mensal * (D.royalty_pct / 100) : 0;
    const mkt_franquia_pct_aplicado = is_franquia ? fat_mensal * (D.mkt_franquia_pct / 100) : 0;

    const total_deducoes = impostos_mensal + taxas_recebimento + comissoes + royalty_pct_aplicado + mkt_franquia_pct_aplicado;
    const rec_liquida = fat_mensal - total_deducoes;

    // ── BLOCO 2: CMV e Lucro Bruto ──
    const cmv = D.cmv_mensal;
    const lucro_bruto = rec_liquida - cmv;
    const margem_bruta_pct = fat_mensal > 0 ? (lucro_bruto / fat_mensal) * 100 : 0;

    // ── BLOCO 3: Despesas Operacionais ──
    const enc = calcEncargosCLT(D.clt_folha, D.regime, D.anexo, D.setor_code, P);
    const clt_folha_bruta = D.clt_folha;
    const clt_encargos = enc.encargos;
    const pj_custo = D.pj_custo;
    // Componentes fixos de franquia: gate is_franquia (mesmo flag do Bloco 1)
    const royalty_fixo = is_franquia ? D.royalty_fixo : 0;
    const mkt_franquia_fixo = is_franquia ? D.mkt_franquia_fixo : 0;
    const folha_total = clt_folha_bruta + clt_encargos + pj_custo + royalty_fixo + mkt_franquia_fixo;

    const aluguel = D.aluguel;
    const facilities = D.custo_utilities;
    const terceirizados = D.custo_terceiros;
    const ocupacao_total = aluguel + facilities + terceirizados;

    const sistemas = D.custo_sistemas;
    const outros_cf = D.custo_outros;
    const mkt_pago = D.mkt_valor;
    const operacional_outros_total = sistemas + outros_cf + mkt_pago;

    const ro_mensal = lucro_bruto - folha_total - ocupacao_total - operacional_outros_total;
    const ro_anual = ro_mensal * 12;
    const margem_operacional_pct = fat_mensal > 0 ? (ro_mensal / fat_mensal) * 100 : 0;

    // ── BLOCO 4: Resultado financeiro + impostos sobre lucro ──
    const resultado_financeiro = {
      despesas_financeiras: 0,
      receitas_financeiras: 0,
      saldo: 0,
    };
    const impostos_sobre_lucro = calcImpostosSobreLucro(D, ro_mensal);
    const lucro_liquido_mensal = ro_mensal - resultado_financeiro.saldo - impostos_sobre_lucro.total;

    // ── BLOCO 5: Desembolsos do sócio ──
    const prolabore = D.prolabore;
    const parcelas_dividas = D.parcelas;
    const investimentos = D.investimentos;
    const potencial_caixa_mensal = lucro_liquido_mensal - prolabore - parcelas_dividas - investimentos;

    return {
      bloco_1_receita: {
        fat_mensal, fat_anual,
        impostos: {
          mensal: impostos_mensal,
          pct: impostos_pct,
          regime: impostos_regime,
          anexo: impostos_anexo,
          detalhes: impostos_detalhes,
          fator_r_calculado: calcReal && calcReal.fator_r_calculado,
          fator_r_aplicado: calcReal ? calcReal.fator_r_aplicado : false,
          migracao_anexo: calcReal && calcReal.migracao_anexo,
          observacao_fator_r: calcReal && calcReal.observacao_fator_r,
        },
        // Decisão #14 — declarado vs calculado, diferença = passivo potencial
        impostos_calculados_mensal: impostos_mensal,
        impostos_declarados_pelo_vendedor_mensal: impostos_declarado,
        diferenca_potencial_passivo_mensal: diferenca_potencial_passivo,
        taxas_recebimento, comissoes,
        royalty_pct_aplicado, mkt_franquia_pct_aplicado,
        total_deducoes,
        rec_liquida,
      },
      bloco_2_lucro_bruto: {
        cmv,
        lucro_bruto,
        margem_bruta_pct,
      },
      bloco_3_operacional: {
        pessoal: {
          clt_folha_bruta, clt_encargos,
          clt_encargos_detalhes: enc,
          pj_custo,
          royalty_fixo, mkt_franquia_fixo,
          folha_total,
        },
        ocupacao: {
          aluguel, facilities, terceirizados,
          total: ocupacao_total,
        },
        operacional_outros: {
          sistemas, outros_cf, mkt_pago,
          total: operacional_outros_total,
        },
        ro_mensal, ro_anual,
        margem_operacional_pct,
      },
      bloco_4_lucro_liquido: {
        resultado_financeiro,
        impostos_sobre_lucro,
        lucro_liquido_mensal,
      },
      bloco_5_caixa: {
        prolabore,
        antecipacao_eventual: 0,
        parcelas_dividas,
        investimentos,
        potencial_caixa_mensal,
      },

      // Atalhos topo (compatibilidade com consumidores planos)
      fat_mensal, fat_anual,
      rec_liquida,
      cmv,
      lucro_bruto,
      folha_total,
      ro_mensal, ro_anual,
      margem_operacional_pct,
      lucro_liquido_mensal,
      potencial_caixa_mensal,
    };
  }

  // ============================================================
  // calcBalancoV2 — Balanço Patrimonial (Decisão #20)
  // Provisão CLT (13º + 1/3 férias) NÃO entra no DRE: vai pro Passivo.
  // ============================================================

  function calcFatorEncargoProvisao(regime, anexo, setor_code, P) {
    if (regime === 'simples' && anexo !== 'IV') {
      return 1.08; // FGTS sobre o que será pago
    }
    // presumido, real, simples_anexo_IV
    const rat = (P && P.rat_por_setor && P.rat_por_setor[setor_code] !== undefined)
      ? P.rat_por_setor[setor_code]
      : 1.0;
    return 1.0 + 0.365 + (rat / 100); // RAT vem em % no parametros, divide por 100
  }

  function calcBalancoV2(D, P) {
    // ── ATIVOS ──
    const caixa = n(D.caixa);
    const contas_receber = n(D.contas_receber);
    const estoque = n(D.estoque);
    const equipamentos = n(D.equipamentos);
    const imovel = n(D.imovel);
    const ativo_franquia = n(D.ativo_franquia);
    const outros_ativos = n(D.outros_ativos);
    const total_ativos = caixa + contas_receber + estoque + equipamentos + imovel + ativo_franquia + outros_ativos;
    const imobilizado_total = equipamentos + imovel + ativo_franquia;

    // ── PROVISÃO CLT (Decisão #20) ──
    const fator_encargo = calcFatorEncargoProvisao(D.regime, D.anexo, D.setor_code, P);
    const provisao_clt_valor = n(D.clt_folha) * 0.13 * 6 * fator_encargo;
    const regime_referencia = (D.regime === 'simples' && D.anexo !== 'IV')
      ? 'simples_nao_iv'
      : 'presumido_real_ou_simples_iv';

    // ── PASSIVOS ──
    const fornec_a_vencer = n(D.fornec_a_vencer);
    const fornec_atrasadas = n(D.fornec_atrasadas);
    const impostos_atrasados_sem_parcelamento = n(D.impostos_atrasados);
    const saldo_devedor_emprestimos = n(D.saldo_devedor);
    const outros_passivos = n(D.outros_passivos);
    const total_passivos = fornec_a_vencer
      + fornec_atrasadas
      + impostos_atrasados_sem_parcelamento
      + saldo_devedor_emprestimos
      + provisao_clt_valor
      + outros_passivos;

    // ── PATRIMÔNIO LÍQUIDO (pode ser negativo — Bloco 1 corrigido) ──
    const patrimonio_liquido = total_ativos - total_passivos;

    // ── NCG ──
    const ncg_valor = contas_receber + estoque - fornec_a_vencer - fornec_atrasadas;

    // ── CICLO FINANCEIRO ──
    const pmr_dias = n(D.pmr);
    const pmp_dias = n(D.pmp);
    const ciclo_dias = pmr_dias - pmp_dias; // pode ser negativo (recebe antes de pagar)

    return {
      ativos: {
        caixa,
        contas_receber,
        estoque,
        equipamentos,
        imovel,
        ativo_franquia,
        outros: outros_ativos,
        total: total_ativos,
        imobilizado_total,
      },
      passivos: {
        fornecedores_a_vencer: fornec_a_vencer,
        fornecedores_atrasados: fornec_atrasadas,
        impostos_atrasados_sem_parcelamento,
        saldo_devedor_emprestimos,
        provisao_clt_calculada: {
          valor: provisao_clt_valor,
          formula: 'clt_folha × 0.13 × 6 × fator_encargo',
          fator_encargo_aplicado: fator_encargo,
          regime_referencia,
        },
        outros_passivos,
        total: total_passivos,
      },
      patrimonio_liquido,
      ncg: {
        valor: ncg_valor,
        calculo: 'contas_receber + estoque - fornecedores_a_vencer - fornecedores_atrasados',
      },
      ciclo_financeiro: {
        pmr_dias,
        pmp_dias,
        ciclo_dias,
      },
    };
  }

  // ============================================================
  // calcISEv2 — Índice de Solidez Empresarial em 8 pilares
  // (Decisão #13 — substitui os 10 pilares da v1)
  //
  // Fórmula: ise_total = sum(pilar.contribuicao_no_total)
  //          contribuicao_no_total = score_0_10 × peso_pct / 10
  //          (score 0-10, peso_pct soma 100, total 0-100)
  // ============================================================

  function getBenchmarkAjustado(setor_code, indicador, forma_principal, P) {
    const benchSetor = (P.benchmarks_dre
      && P.benchmarks_dre[setor_code]
      && P.benchmarks_dre[setor_code][indicador]) || 0;
    const modificador = (P.modificadores_forma_atuacao_dre
      && P.modificadores_forma_atuacao_dre[forma_principal]
      && P.modificadores_forma_atuacao_dre[forma_principal][indicador]) || 0;
    return benchSetor + modificador;
  }

  function pilarFromSubs(id, label, peso_pct, subs) {
    const score_raw = subs.reduce((acc, s) => acc + s.score_0_10 * s.peso_decimal, 0);
    return {
      id,
      label,
      peso_pct,
      score_0_10: Math.round(score_raw * 100) / 100,
      contribuicao_no_total: Math.round((score_raw * peso_pct / 10) * 100) / 100,
      sub_metricas: subs,
    };
  }

  // ── P1 — Financeiro (peso 20%) ──
  function calcPilar1Financeiro(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p1_financeiro !== undefined ? P.pesos_ise.p1_financeiro : 0.20) * 100;

    const bench = getBenchmarkAjustado(D.setor_code, 'margem_op', D.modelo_code, P);
    const margem = dre.margem_operacional_pct;
    let s1;
    if (margem < 0) s1 = 0;
    else if (bench > 0 && margem >= bench) s1 = 10;
    else if (bench > 0 && margem >= bench * 0.7) s1 = 7;
    else if (bench > 0 && margem >= bench * 0.5) s1 = 5;
    else s1 = 2;

    const sep = D.dre_separacao_pf_pj;
    const s2 = sep === 'sim' ? 10 : sep === 'parcial' ? 5 : 0;

    const s3 = dre.ro_mensal > 0 ? 10 : 0;

    const ct = D.contabilidade;
    const s4 = ct === 'sim' ? 10 : ct === 'parcial' ? 6 : 0;

    return pilarFromSubs('p1_financeiro', 'Financeiro', peso_pct, [
      { id: 'margem_op_pct', label: 'Margem operacional vs benchmark setorial', score_0_10: s1, peso_decimal: 0.25, valor: margem, benchmark: bench },
      { id: 'dre_separacao', label: 'Separação PF/PJ no DRE', score_0_10: s2, peso_decimal: 0.25, valor: sep || null },
      { id: 'fluxo_caixa_positivo', label: 'Fluxo de caixa operacional positivo', score_0_10: s3, peso_decimal: 0.25, valor: dre.ro_mensal },
      { id: 'contabilidade_formal', label: 'Contabilidade formal', score_0_10: s4, peso_decimal: 0.25, valor: ct || null },
    ]);
  }

  // ── P2 — Resultado (peso 15%) ──
  function calcPilar2Resultado(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p2_resultado !== undefined ? P.pesos_ise.p2_resultado : 0.15) * 100;

    const s1 = dre.ro_anual > 0 ? 10 : 0;

    const me = D.margem_estavel;
    const s2 = (me === 'sim' || me === 'crescente') ? 10 : me === 'decrescente' ? 3 : 6;

    const imob = balanco.ativos.imobilizado_total;
    const selic = n(P.selic_anual) || 14.0;
    let s3;
    let roi_pct = null;
    if (imob > 0) {
      roi_pct = (dre.ro_anual / imob) * 100;
      if (roi_pct < 0) s3 = 0;
      else if (roi_pct >= selic * 2) s3 = 10;
      else if (roi_pct >= selic) s3 = 7;
      else if (roi_pct >= selic / 2) s3 = 5;
      else s3 = 3;
    } else {
      s3 = 5; // neutro: sem imobilizado relevante
    }

    return pilarFromSubs('p2_resultado', 'Resultado', peso_pct, [
      { id: 'ebitda_real', label: 'Resultado anual positivo', score_0_10: s1, peso_decimal: 0.50, valor: dre.ro_anual },
      { id: 'margem_estavel', label: 'Margem estável ou crescente', score_0_10: s2, peso_decimal: 0.30, valor: me || null },
      { id: 'rentabilidade_imobilizado', label: 'Rentabilidade do imobilizado vs Selic', score_0_10: s3, peso_decimal: 0.20, valor: roi_pct, selic_referencia: selic },
    ]);
  }

  // ── P3 — Comercial (peso 15%) ──
  function calcPilar3Comercial(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p3_comercial !== undefined ? P.pesos_ise.p3_comercial : 0.15) * 100;

    const cli = n(D.clientes);
    let s1;
    if (cli >= 100) s1 = 10;
    else if (cli >= 50) s1 = 7;
    else if (cli >= 20) s1 = 5;
    else if (cli >= 5) s1 = 3;
    else s1 = 0;

    const rec = n(D.recorrencia_pct);
    const benchInd = (P.benchmarks_indicadores && P.benchmarks_indicadores[D.setor_code]) || {};
    const benchRec = n(benchInd.recorrencia_tipica);
    let s2;
    if (rec === 0) s2 = 0;
    else if (benchRec === 0) s2 = 5;
    else if (rec >= benchRec) s2 = 10;
    else if (rec >= benchRec * 0.7) s2 = 7;
    else if (rec >= benchRec * 0.5) s2 = 5;
    else s2 = 2;

    const conc = n(D.concentracao_pct);
    const benchConc = n(benchInd.concentracao_max) || 20;
    let s3;
    if (conc <= benchConc) s3 = 10;
    else if (conc <= benchConc * 1.5) s3 = 7;
    else if (conc <= benchConc * 2) s3 = 4;
    else s3 = 0;

    const bc = D.base_clientes;
    const s4 = bc === 'sim' ? 10 : 0;

    return pilarFromSubs('p3_comercial', 'Comercial', peso_pct, [
      { id: 'num_clientes', label: 'Número de clientes ativos', score_0_10: s1, peso_decimal: 0.25, valor: cli },
      { id: 'recorrencia_pct', label: 'Recorrência vs benchmark', score_0_10: s2, peso_decimal: 0.25, valor: rec, benchmark: benchRec },
      { id: 'concentracao_pct', label: 'Concentração de clientes vs limite', score_0_10: s3, peso_decimal: 0.25, valor: conc, benchmark_max: benchConc },
      { id: 'base_clientes_documentada', label: 'Base de clientes documentada', score_0_10: s4, peso_decimal: 0.25, valor: bc || null },
    ]);
  }

  // ── P4 — Gestão (peso 15%) ──
  function calcPilar4Gestao(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p4_gestao !== undefined ? P.pesos_ise.p4_gestao : 0.15) * 100;

    const proc = D.processos;
    // aceita 'sim' (v2) e 'documentados' (legado v1)
    const s1 = (proc === 'sim' || proc === 'documentados') ? 10 : proc === 'parcial' ? 6 : 0;

    const tg = D.tem_gestor;
    const s2 = tg === 'sim' ? 10 : 0;

    const sis = n(D.custo_sistemas);
    const s3 = sis > 0 ? 7 : 0;

    return pilarFromSubs('p4_gestao', 'Gestão', peso_pct, [
      { id: 'processos_documentados', label: 'Processos documentados', score_0_10: s1, peso_decimal: 1/3, valor: proc || null },
      { id: 'tem_gestor', label: 'Possui gestor dedicado', score_0_10: s2, peso_decimal: 1/3, valor: tg || null },
      { id: 'sistemas_implantados', label: 'Investe em sistemas/ERP', score_0_10: s3, peso_decimal: 1/3, valor: sis },
    ]);
  }

  // ── P5 — Sócio / Dependência (peso 10%) ──
  function calcPilar5SocioDependencia(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p5_socio_dependencia !== undefined ? P.pesos_ise.p5_socio_dependencia : 0.10) * 100;

    const od = D.opera_sem_dono;
    const s1 = od === 'sim' ? 10 : 0;

    const ep = D.equipe_permanece;
    const s2 = ep === 'sim' ? 10 : ep === 'provavelmente' ? 6 : 0;

    const s3 = n(D.prolabore) > 0 ? 8 : 5;

    return pilarFromSubs('p5_socio_dependencia', 'Sócio / Dependência', peso_pct, [
      { id: 'opera_sem_dono', label: 'Opera sem o dono', score_0_10: s1, peso_decimal: 1/3, valor: od || null },
      { id: 'equipe_permanece', label: 'Equipe permanece pós-venda', score_0_10: s2, peso_decimal: 1/3, valor: ep || null },
      { id: 'prolabore_documentado', label: 'Pró-labore documentado', score_0_10: s3, peso_decimal: 1/3, valor: D.prolabore },
    ]);
  }

  // ── P6 — Risco Legal (peso 10%) ──
  function calcPilar6RiscoLegal(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p6_risco_legal !== undefined ? P.pesos_ise.p6_risco_legal : 0.10) * 100;

    const pt = D.passivo_trabalhista;
    const s1 = pt === 'nao' ? 10 : pt === 'sim' ? 0 : 5;

    const pj = D.processos_juridicos;
    const s2 = pj === 'nao' ? 10 : pj === 'sim' ? 0 : 5;

    const idp = D.impostos_dia;
    const s3 = idp === 'sim' ? 10 : idp === 'parcelamento' ? 5 : 0;

    const imp = n(D.impostos_atrasados);
    const fat = n(dre.fat_mensal);
    let s4;
    if (imp === 0) s4 = 10;
    else if (fat > 0 && imp < fat * 0.5) s4 = 7;
    else if (fat > 0 && imp < fat * 2) s4 = 4;
    else s4 = 0;

    return pilarFromSubs('p6_risco_legal', 'Risco Legal', peso_pct, [
      { id: 'sem_passivo_trabalhista', label: 'Sem passivo trabalhista', score_0_10: s1, peso_decimal: 0.25, valor: pt || null },
      { id: 'sem_acao_judicial', label: 'Sem ações judiciais', score_0_10: s2, peso_decimal: 0.25, valor: pj || null },
      { id: 'impostos_em_dia', label: 'Impostos em dia', score_0_10: s3, peso_decimal: 0.25, valor: idp || null },
      { id: 'sem_impostos_atrasados', label: 'Volume de impostos atrasados', score_0_10: s4, peso_decimal: 0.25, valor: imp },
    ]);
  }

  // ── P7 — Balanço (peso 8%) ──
  function calcPilar7Balanco(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p7_balanco !== undefined ? P.pesos_ise.p7_balanco : 0.08) * 100;

    const s1 = balanco.patrimonio_liquido > 0 ? 10 : 0;

    let s2;
    let liquidez_ratio = null;
    if (balanco.passivos.total === 0) {
      s2 = 10;
    } else {
      liquidez_ratio = balanco.ativos.total / balanco.passivos.total;
      if (liquidez_ratio >= 2) s2 = 10;
      else if (liquidez_ratio >= 1.5) s2 = 7;
      else if (liquidez_ratio >= 1) s2 = 5;
      else if (liquidez_ratio >= 0.7) s2 = 3;
      else s2 = 0;
    }

    const ncg = balanco.ncg.valor;
    const fat = n(dre.fat_mensal);
    let s3;
    if (ncg < 0) s3 = 10;
    else if (fat > 0 && ncg < fat) s3 = 7;
    else if (fat > 0 && ncg < fat * 2) s3 = 4;
    else s3 = 0;

    return pilarFromSubs('p7_balanco', 'Balanço', peso_pct, [
      { id: 'patrimonio_positivo', label: 'Patrimônio líquido positivo', score_0_10: s1, peso_decimal: 1/3, valor: balanco.patrimonio_liquido },
      { id: 'liquidez', label: 'Liquidez (ativos / passivos)', score_0_10: s2, peso_decimal: 1/3, valor: liquidez_ratio },
      { id: 'ncg_saudavel', label: 'NCG vs faturamento mensal', score_0_10: s3, peso_decimal: 1/3, valor: ncg },
    ]);
  }

  // ── P8 — Marca / Reputação (peso 7%) ──
  function calcPilar8Marca(D, dre, balanco, P) {
    const peso_pct = (P.pesos_ise && P.pesos_ise.p8_marca !== undefined ? P.pesos_ise.p8_marca : 0.07) * 100;

    const m = D.marca_inpi;
    // aceita 'registrada'/'em_processo' (v2) e 'sim'/'processo' (legado v1)
    const s1 = (m === 'registrada' || m === 'sim') ? 10
      : (m === 'em_processo' || m === 'processo') ? 6
      : 0;

    const r = D.reputacao_online;
    const s2 = r === 'positiva' ? 10 : r === 'neutra' ? 6 : r === 'negativa' ? 0 : 5;

    const pd = D.presenca_digital;
    const s3 = pd === 'forte' ? 10 : pd === 'media' ? 6 : pd === 'fraca' ? 3 : 0;

    return pilarFromSubs('p8_marca', 'Marca / Reputação', peso_pct, [
      { id: 'marca_inpi', label: 'Marca registrada no INPI', score_0_10: s1, peso_decimal: 1/3, valor: m || null },
      { id: 'reputacao_online', label: 'Reputação online', score_0_10: s2, peso_decimal: 1/3, valor: r || null },
      { id: 'presenca_digital', label: 'Presença digital', score_0_10: s3, peso_decimal: 1/3, valor: pd || null },
    ]);
  }

  function calcISEv2(D, dre, balanco, P) {
    const pilares = [
      calcPilar1Financeiro(D, dre, balanco, P),
      calcPilar2Resultado(D, dre, balanco, P),
      calcPilar3Comercial(D, dre, balanco, P),
      calcPilar4Gestao(D, dre, balanco, P),
      calcPilar5SocioDependencia(D, dre, balanco, P),
      calcPilar6RiscoLegal(D, dre, balanco, P),
      calcPilar7Balanco(D, dre, balanco, P),
      calcPilar8Marca(D, dre, balanco, P),
    ];

    const ise_total = Math.round(
      pilares.reduce((acc, p) => acc + p.contribuicao_no_total, 0) * 10
    ) / 10;

    // Classe via P.fator_ise (com fallback hardcoded)
    const faixas = (P.fator_ise && P.fator_ise.length > 0) ? P.fator_ise : [
      { min: 85, max: 100, nome: 'Estruturado',  fator: 1.30 },
      { min: 70, max: 84,  nome: 'Consolidado',  fator: 1.15 },
      { min: 50, max: 69,  nome: 'Operacional',  fator: 1.00 },
      { min: 35, max: 49,  nome: 'Dependente',   fator: 0.85 },
      { min: 0,  max: 34,  nome: 'Embrionario',  fator: 0.70 },
    ];
    let classe = 'Embrionario';
    let fator_classe = 0.70;
    for (const f of faixas) {
      if (ise_total >= f.min && ise_total <= f.max) {
        classe = f.nome;
        fator_classe = f.fator;
        break;
      }
    }

    return {
      ise_total,
      classe,
      fator_classe,
      pilares,
    };
  }

  // ============================================================
  // calcValuationV2 — Múltiplo + valor de venda
  // (Decisão #19 — RO ≤ 0 → valor_op = 0; valor_venda = PL + aviso forte)
  // (Bloco 1 corrigido — valor_venda = valor_op + PL, sem max(0, PL))
  // ============================================================

  function calcAjusteFormaMultiSelect(formas, P_ajustes) {
    if (!formas || formas.length === 0) {
      return {
        principal: { codigo: null, valor: 0 },
        outras: [],
        total_ajuste: 0,
      };
    }

    const ajustes = formas
      .map(f => ({ codigo: f, valor: n((P_ajustes || {})[f]) }))
      .sort((a, b) => b.valor - a.valor);

    const principal = ajustes[0];
    let total = principal.valor;

    const outras = [];
    for (let i = 1; i < ajustes.length; i++) {
      const extra = ajustes[i];
      const diff = extra.valor - principal.valor;
      const contribuicao = 0.30 * diff; // diff ≤ 0 (principal vence), contrib é 0 ou negativa
      total += contribuicao;
      outras.push({
        codigo: extra.codigo,
        valor: extra.valor,
        diferenca_em_relacao_principal: diff,
        contribuicao_no_total: contribuicao,
      });
    }

    return {
      principal: { codigo: principal.codigo, valor: principal.valor },
      outras,
      total_ajuste: total,
    };
  }

  function calcValuationV2(D, dre, balanco, ise, P) {
    const setor_code = D.setor_code;
    const ro_anual = dre.ro_anual;
    const ro_mensal = dre.ro_mensal;
    const patrimonio_liquido = balanco.patrimonio_liquido;

    const multiplo_setor = {
      codigo: setor_code,
      label: D.setor_label || D.setor_raw || setor_code,
      valor: n((P.multiplos_setor || {})[setor_code]),
    };

    // formas: prefere o array v2 (modelo_atuacao_multi); fallback para modelo_multi (v1) ou principal único
    const formas = D.modelo_atuacao_multi
      || D.modelo_multi
      || (D.modelo_atuacao_principal ? [D.modelo_atuacao_principal] : (D.modelo_code ? [D.modelo_code] : []));
    const ajuste_forma = calcAjusteFormaMultiSelect(formas, P.ajuste_forma_atuacao);

    const multiplo_base = multiplo_setor.valor + ajuste_forma.total_ajuste;

    const fator_ise = {
      classe: ise.classe,
      valor: ise.fator_classe,
      faixa: ise.classe + ' (ISE: ' + ise.ise_total + ')',
    };

    const fator_final = multiplo_base * fator_ise.valor;

    // ── RAMO 1: RO ≤ 0 (Decisão #19) ──
    if (ro_mensal <= 0) {
      return {
        multiplo_setor,
        ajuste_forma_atuacao: ajuste_forma,
        multiplo_base,
        fator_ise,
        fator_final,

        ro_anual,
        valor_operacao: 0,
        patrimonio_liquido,
        valor_venda: patrimonio_liquido,

        ro_negativo: true,
        ro_negativo_msg: 'Esta empresa está sendo avaliada apenas pelo valor de seus ativos líquidos. O resultado operacional negativo impede a aplicação da metodologia padrão. Recomendamos uma sessão com especialista para avaliar oportunidades de melhoria antes da venda.',

        cta_especialista: {
          ativo: true,
          label: 'Agendar conversa com especialista',
          url: '/agendar-especialista?codigo=' + (D.codigo_diagnostico || D.codigo || ''),
        },

        alerta_pl_negativo: null,
      };
    }

    // ── RAMO 2: RO > 0 (cálculo padrão) ──
    const valor_operacao = ro_anual * fator_final;
    // Bloco 1 CORRIGIDO: soma direta sem max(0, PL) — PL negativo derruba valor de venda
    const valor_venda = valor_operacao + patrimonio_liquido;

    let alerta_pl_negativo = null;
    if (valor_venda < 0) {
      alerta_pl_negativo = {
        tipo: 'valor_negativo',
        mensagem: 'Dívidas líquidas excedem o valor da operação. O negócio está com valor de venda negativo — significa que comprar a empresa exigiria assumir mais passivos do que o valor que a operação gera. Considere reestruturar dívidas antes de tentar vender.',
      };
    } else if (valor_venda < valor_operacao * 0.30 && patrimonio_liquido < 0) {
      alerta_pl_negativo = {
        tipo: 'divida_engole_valor',
        mensagem: 'Dívidas líquidas reduzem significativamente o valor de venda. A operação vale ' + Math.round(valor_operacao).toLocaleString('pt-BR') + ' mas o patrimônio líquido negativo derruba o valor final. Reestruturar dívidas pode aumentar muito o valor de venda.',
      };
    }

    return {
      multiplo_setor,
      ajuste_forma_atuacao: ajuste_forma,
      multiplo_base,
      fator_ise,
      fator_final,

      ro_anual,
      valor_operacao,
      patrimonio_liquido,
      valor_venda,

      ro_negativo: false,
      ro_negativo_msg: null,
      cta_especialista: null,
      alerta_pl_negativo,
    };
  }

  // ============================================================
  // calcAtratividadeV2 — 3 componentes (ISE 50% / Setor 25% / Crescimento 25%)
  // (Spec Seção 3.8 e 4.7-4.10 — resultado 0-100)
  //
  // Fórmula: contribuicao = (score_0_10 × peso_pct) / 10
  //          total = round(sum(contribuicoes))
  //
  // Crescimento: prefere histórico real (D.crescimento_pct calculado em mapDados);
  // se ausente, cai pra projeção do vendedor com penalidade -2 (otimismo);
  // se nem isso, vira 'sem_dados' (cai na faixa estável).
  // ============================================================

  function calcAtratividadeV2(D, dre, ise, P) {
    const setor_code = D.setor_code;

    // ── Componente 1: ISE (peso 50%) ──
    const componente_ise_score = n(ise.ise_total) / 10;

    // ── Componente 2: Setor (peso 25%) ──
    const componente_setor_score = n((P.score_setor_atratividade || {})[setor_code]);

    // ── Componente 3: Crescimento (peso 25%) ──
    let crescimento_pct;
    let fonte_crescimento;
    let penalidade_aplicada = 0;

    if (D.crescimento_pct !== undefined && D.crescimento_pct !== null && D.crescimento_pct !== 0) {
      crescimento_pct = D.crescimento_pct;
      fonte_crescimento = 'historico_real';
    } else if (D.crescimento_proj_pct) {
      crescimento_pct = D.crescimento_proj_pct;
      fonte_crescimento = 'projecao_vendedor';
    } else {
      crescimento_pct = 0;
      fonte_crescimento = 'sem_dados';
    }

    const faixas_cresc = P.faixas_crescimento || [];
    let score_crescimento = 4; // default neutro (faixa estável)
    for (const f of faixas_cresc) {
      if (crescimento_pct >= f.min && crescimento_pct <= f.max) {
        score_crescimento = f.score;
        break;
      }
    }
    if (fonte_crescimento === 'projecao_vendedor') {
      penalidade_aplicada = -2;
      score_crescimento = Math.max(0, score_crescimento - 2);
    }

    // ── Contribuições (score × peso_pct / 10) ──
    const round2 = v => Math.round(v * 100) / 100;
    const contrib_ise = round2(componente_ise_score * 50 / 10);
    const contrib_setor = round2(componente_setor_score * 25 / 10);
    const contrib_cresc = round2(score_crescimento * 25 / 10);

    const total = Math.round(contrib_ise + contrib_setor + contrib_cresc);

    // ── Faixa label via P.faixas_atratividade (com fallback) ──
    const faixas_atr = (P.faixas_atratividade && P.faixas_atratividade.length > 0)
      ? P.faixas_atratividade
      : [
          { min: 80, max: 100, label: 'Excelente' },
          { min: 65, max: 79,  label: 'Boa' },
          { min: 50, max: 64,  label: 'Moderada' },
          { min: 0,  max: 49,  label: 'Baixa' },
        ];
    let label = '';
    for (const f of faixas_atr) {
      if (total >= f.min && total <= f.max) {
        label = f.label;
        break;
      }
    }

    return {
      total,
      label,
      componentes: [
        {
          id: 'ise',
          label: 'Saúde do negócio',
          peso_pct: 50,
          score_0_10: round2(componente_ise_score),
          contribuicao_no_total: contrib_ise,
          fonte: 'ise.ise_total',
        },
        {
          id: 'setor',
          label: 'Apelo do setor',
          peso_pct: 25,
          score_0_10: componente_setor_score,
          contribuicao_no_total: contrib_setor,
          fonte: 'parametros.score_setor_atratividade[' + setor_code + ']',
        },
        {
          id: 'crescimento',
          label: 'Momentum de crescimento',
          peso_pct: 25,
          score_0_10: score_crescimento,
          contribuicao_no_total: contrib_cresc,
          fonte_crescimento,
          crescimento_pct_aplicado: crescimento_pct,
          penalidade_aplicada,
        },
      ],
    };
  }

  // ============================================================
  // PIPELINE PRINCIPAL (esqueleto)
  // ============================================================

  async function avaliarV2(dadosBrutos, modo = 'preview') {
    if (!['preview', 'commit'].includes(modo)) {
      throw new Error(`Modo inválido: ${modo}. Use 'preview' ou 'commit'.`);
    }

    const P = await carregarParametrosV2();

    const D = mapDadosV2(dadosBrutos);
    const dre = calcDREv2(D, P);
    const balanco = calcBalancoV2(D, P);
    const ise = calcISEv2(D, dre, balanco, P);
    const valuation = calcValuationV2(D, dre, balanco, ise, P);
    const atratividade = calcAtratividadeV2(D, dre, ise, P);

    // TODO Fase 2.8+: calcAnaliseTributariaV2, gerarUpsidesV2,
    // montarCalcJsonV2, salvarCalcJsonV2 (modo='commit')

    return {
      _versao_calc_json: '2.0',
      _versao_parametros: _parametrosVersaoId,
      _data_avaliacao: hoje(),
      _skill_versao: '2.0.0-etapa2.7',
      _modo: modo,
      _status: 'parcial — mapDados + DRE + Balanço + ISE + Valuation + Atratividade',
      D,
      dre,
      balanco,
      ise,
      valuation,
      atratividade,
    };
  }

  // ============================================================
  // EXPORTAÇÃO GLOBAL
  // ============================================================

  window.AVALIADORA_V2 = {
    avaliar: avaliarV2,
    carregarParametros: carregarParametrosV2,
    _getParams: () => _parametros,
    _getVersaoParametros: () => _parametrosVersaoId,
    _mapSetor: mapSetor,
    _mapModelo: mapModelo,
    _inferirAnexoSimples: inferirAnexoSimples,
    _determinarAnexoSimples: determinarAnexoSimples,
    _calcImpostoSobreFaturamento: calcImpostoSobreFaturamento,
    _calcImpostosSobreLucro: calcImpostosSobreLucro,
    _calcEncargosCLT: calcEncargosCLT,
    _mapDados: mapDadosV2,
    _calcDRE: calcDREv2,
    _calcBalanco: calcBalancoV2,
    _calcFatorEncargoProvisao: calcFatorEncargoProvisao,
    _calcISE: calcISEv2,
    _getBenchmarkAjustado: getBenchmarkAjustado,
    _calcValuation: calcValuationV2,
    _calcAjusteFormaMultiSelect: calcAjusteFormaMultiSelect,
    _calcAtratividade: calcAtratividadeV2,
  };

  console.log('[skill-v2] Esqueleto carregado. Aguardando implementação dos cálculos.');
})();
