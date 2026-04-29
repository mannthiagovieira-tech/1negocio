/**
 * skill-avaliadora-v2.js
 * Versão 2.0.0 — Fase 2 do Passo 3 implementada
 *
 * Implementa: mapDados, DRE 5 blocos, Balanço com provisão CLT,
 * ISE 8 pilares, Valuation Bloco 1 corrigido, Atratividade,
 * Análise Tributária 3 regimes (Simples 5 anexos + Fator R + ISS/ICMS),
 * Upsides em 5 categorias, Schema calc_json v2 aninhado.
 *
 * Substituirá skill-avaliadora.js (v1) na Fase 3 (Decisão #21).
 *
 * Próximas fases:
 *   Fase 3: integrar com laudo-gratuito.html, laudo-pago.html, etc.
 *   Fase 4: Edge Functions (textos IA, commit via Edge Function pra refinar RLS)
 *   Fase 5: integrar T44 do diagnóstico
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

  // ISS municipal × ICMS estadual (Etapa 2.8.B).
  // Default conservador: ISS quando não há forma/setor de comércio/indústria.
  function determinarRegimeMunicipalEstadual(setor_code, forma_principal) {
    // Forma comércio/indústria → ICMS
    if (['revenda', 'distribuicao', 'fabricacao', 'produz_revende'].includes(forma_principal)) {
      return { aplica_iss: false, aplica_icms: true, aliq_iss: 5, aliq_icms: 18 };
    }
    // Forma serviço → ISS
    if (['presta_servico', 'saas', 'assinatura'].includes(forma_principal)) {
      return { aplica_iss: true, aplica_icms: false, aliq_iss: 5, aliq_icms: 18 };
    }
    // Setor sem forma específica
    if (['varejo', 'industria'].includes(setor_code)) {
      return { aplica_iss: false, aplica_icms: true, aliq_iss: 5, aliq_icms: 18 };
    }
    if (setor_code === 'construcao') {
      // Construção depende: com material = ICMS, sem material = ISS. Default ISS.
      return { aplica_iss: true, aplica_icms: false, aliq_iss: 5, aliq_icms: 18 };
    }
    const setoresServico = ['servicos_empresas', 'educacao', 'saude', 'bem_estar',
                            'beleza_estetica', 'hospedagem', 'servicos_locais', 'logistica'];
    if (setoresServico.includes(setor_code)) {
      return { aplica_iss: true, aplica_icms: false, aliq_iss: 5, aliq_icms: 18 };
    }
    return { aplica_iss: true, aplica_icms: false, aliq_iss: 5, aliq_icms: 18 };
  }

  // Presunções IRPJ/CSLL no Lucro Presumido (Etapa 2.8.B).
  // Comércio/indústria/transporte cargas: 8/12. Serviços em geral: 32/32.
  function determinarPresuncoesPresumido(setor_code, forma_principal) {
    if (['revenda', 'distribuicao', 'fabricacao', 'produz_revende'].includes(forma_principal)) {
      return { irpj: 0.08, csll: 0.12 };
    }
    if (['varejo', 'industria'].includes(setor_code)) {
      return { irpj: 0.08, csll: 0.12 };
    }
    // Transporte de cargas (logística + presta_servico) — IRPJ 8% / CSLL 12%
    if (setor_code === 'logistica' && forma_principal === 'presta_servico') {
      return { irpj: 0.08, csll: 0.12 };
    }
    // Serviços em geral
    return { irpj: 0.32, csll: 0.32 };
  }

  // ============================================================
  // HELPERS TRIBUTÁRIOS
  // (Decisão #14 — cálculo pela regra real; #17 — 3 bases por regime)
  //
  // Etapas 2.8.A e 2.8.B entregues:
  //  - 5 anexos completos do Simples + Fator R (2.8.A)
  //  - Anexo IV: INSS por fora (afeta calcEncargosCLT)
  //  - ISS municipal e ICMS estadual em Presumido/Real (2.8.B)
  //  - IRPJ + CSLL em Presumido (presunção) e Real (RO proxy)
  //
  // TODO Backlog Futuro:
  //  - ISS específico por município (varia 2-5%) — hoje usa 5% (teto do médio)
  //  - ICMS específico por estado/produto (varia 7-25%) — hoje usa 18%
  //  - Créditos PIS/Cofins não-cumulativo no Lucro Real
  //  - Lucro Arbitrado (4º regime, raro)
  // ============================================================

  function calcImpostoSobreFaturamento(fat_anual, regime, anexo, P, contexto) {
    const fat_mensal = fat_anual / 12;
    const ctx = contexto || {};
    const iss_icms = determinarRegimeMunicipalEstadual(ctx.setor_code, ctx.forma_principal);

    if (regime === 'mei') {
      if (fat_anual > 81000) {
        return {
          mensal: 0, anual: 0, pct: 0,
          regime: 'MEI', anexo: null,
          detalhes: 'Faturamento acima do limite MEI (R$ 81k/ano)',
          fator_r_calculado: null, fator_r_aplicado: false,
          migracao_anexo: null, observacao_fator_r: null,
          viabilidade: 'inviavel',
          razao_inviabilidade: 'fat_acima_limite_mei',
          decomposicao: {
            pis_anual: 0, cofins_anual: 0, iss_anual: 0, icms_anual: 0,
            irpj_anual: 0, csll_anual: 0,
            fat_total_anual: 0, lucro_total_anual: 0, imposto_total_anual: 0,
          },
        };
      }
      const fixoMensal = (anexo === 'I' || anexo === 'II') ? 75.90 : 80.90;
      const anual = fixoMensal * 12;
      return {
        mensal: fixoMensal, anual,
        pct: fat_mensal > 0 ? (fixoMensal / fat_mensal) * 100 : 0,
        regime: 'MEI', anexo: null,
        detalhes: 'Valor fixo mensal',
        fator_r_calculado: null, fator_r_aplicado: false,
        migracao_anexo: null, observacao_fator_r: null,
        viabilidade: 'viavel',
        decomposicao: {
          pis_anual: 0, cofins_anual: 0, iss_anual: 0, icms_anual: 0,
          irpj_anual: 0, csll_anual: 0,
          das_anual: anual,
          fat_total_anual: anual,
          lucro_total_anual: 0,
          imposto_total_anual: anual,
        },
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
      const anual = mensal * 12;

      return {
        mensal,
        anual,
        pct: aliq_efetiva * 100,
        regime: 'Simples Nacional',
        anexo: anexo_para_calc,
        detalhes: 'Anexo ' + anexo_para_calc + ' — alíquota efetiva ' + (aliq_efetiva * 100).toFixed(2) + '%',
        fator_r_calculado,
        fator_r_aplicado,
        migracao_anexo,
        observacao_fator_r,
        viabilidade: 'viavel',
        decomposicao: {
          // No Simples, todos os tributos federais e ISS estão embutidos no DAS.
          pis_anual: 0, cofins_anual: 0, iss_anual: 0, icms_anual: 0,
          irpj_anual: 0, csll_anual: 0,
          das_anual: anual,
          fat_total_anual: anual,
          lucro_total_anual: 0,
          imposto_total_anual: anual,
        },
      };
    }

    if (regime === 'presumido') {
      const presuncoes = determinarPresuncoesPresumido(ctx.setor_code, ctx.forma_principal);

      // IRPJ trimestral com adicional de 10% sobre o que excede R$ 60k/trimestre
      const base_irpj = fat_anual * presuncoes.irpj;
      const base_csll = fat_anual * presuncoes.csll;
      const base_irpj_trim = base_irpj / 4;
      let irpj_trim = base_irpj_trim * 0.15;
      if (base_irpj_trim > 60000) {
        irpj_trim += (base_irpj_trim - 60000) * 0.10;
      }
      const irpj_anual = irpj_trim * 4;
      const csll_anual = base_csll * 0.09;

      const pis_anual = fat_anual * 0.0065;     // cumulativo
      const cofins_anual = fat_anual * 0.03;    // cumulativo
      const iss_anual = iss_icms.aplica_iss ? fat_anual * (iss_icms.aliq_iss / 100) : 0;
      const icms_anual = iss_icms.aplica_icms ? fat_anual * (iss_icms.aliq_icms / 100) : 0;

      const fat_total_anual = pis_anual + cofins_anual + iss_anual + icms_anual;
      const lucro_total_anual = irpj_anual + csll_anual;
      const imposto_total_anual = fat_total_anual + lucro_total_anual;

      const anual = imposto_total_anual;
      const mensal = anual / 12;

      return {
        mensal, anual,
        pct: fat_anual > 0 ? (anual / fat_anual) * 100 : 0,
        regime: 'Lucro Presumido', anexo: null,
        detalhes: 'PIS 0,65% + COFINS 3% + ISS/ICMS aplicáveis + IRPJ presunção '
          + (presuncoes.irpj * 100).toFixed(0) + '% + CSLL presunção '
          + (presuncoes.csll * 100).toFixed(0) + '%',
        fator_r_calculado: null, fator_r_aplicado: false,
        migracao_anexo: null, observacao_fator_r: null,
        viabilidade: 'viavel',
        decomposicao: {
          pis_anual, cofins_anual, iss_anual, icms_anual,
          irpj_anual, csll_anual,
          fat_total_anual, lucro_total_anual, imposto_total_anual,
          presuncao_irpj_aplicada: presuncoes.irpj,
          presuncao_csll_aplicada: presuncoes.csll,
          iss_icms_regra: iss_icms,
        },
      };
    }

    if (regime === 'real') {
      // Base = lucro real, aproximada por RO anual (Decisão #17). Documentada como proxy.
      const ro_anual = n(ctx.ro_anual);
      let irpj_anual = 0;
      if (ro_anual > 0) {
        const ro_trim = ro_anual / 4;
        let irpj_trim = ro_trim * 0.15;
        if (ro_trim > 60000) {
          irpj_trim += (ro_trim - 60000) * 0.10;
        }
        irpj_anual = irpj_trim * 4;
      }
      const csll_anual = Math.max(0, ro_anual * 0.09);

      const pis_anual = fat_anual * 0.0165;     // não-cumulativo (TODO: créditos)
      const cofins_anual = fat_anual * 0.076;   // não-cumulativo (TODO: créditos)
      const iss_anual = iss_icms.aplica_iss ? fat_anual * (iss_icms.aliq_iss / 100) : 0;
      const icms_anual = iss_icms.aplica_icms ? fat_anual * (iss_icms.aliq_icms / 100) : 0;

      const fat_total_anual = pis_anual + cofins_anual + iss_anual + icms_anual;
      const lucro_total_anual = irpj_anual + csll_anual;
      const imposto_total_anual = fat_total_anual + lucro_total_anual;

      const anual = imposto_total_anual;
      const mensal = anual / 12;

      return {
        mensal, anual,
        pct: fat_anual > 0 ? (anual / fat_anual) * 100 : 0,
        regime: 'Lucro Real', anexo: null,
        detalhes: 'PIS 1,65% + COFINS 7,6% (não-cumulativo, sem créditos) + ISS/ICMS aplicáveis + IRPJ/CSLL sobre RO',
        fator_r_calculado: null, fator_r_aplicado: false,
        migracao_anexo: null, observacao_fator_r: null,
        viabilidade: 'viavel',
        decomposicao: {
          pis_anual, cofins_anual, iss_anual, icms_anual,
          irpj_anual, csll_anual,
          fat_total_anual, lucro_total_anual, imposto_total_anual,
          ro_proxy_aplicado: ro_anual,
          iss_icms_regra: iss_icms,
        },
      };
    }

    const mensal = fat_mensal * 0.10;
    const anual = mensal * 12;
    return {
      mensal, anual, pct: 10,
      regime: 'Estimativa', anexo: 'III',
      detalhes: 'Fallback 10% — regime não reconhecido',
      fator_r_calculado: null, fator_r_aplicado: false,
      migracao_anexo: null, observacao_fator_r: null,
      viabilidade: 'viavel',
      decomposicao: {
        pis_anual: 0, cofins_anual: 0, iss_anual: 0, icms_anual: 0,
        irpj_anual: 0, csll_anual: 0,
        fat_total_anual: anual, lucro_total_anual: 0, imposto_total_anual: anual,
      },
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
        // 37,5% (FGTS+INSS+Terceiros+outros) + RAT — fórmula do spec 2.8.A
        pct_total = 37.5 + rat_pct;
        inss = folha * (inss_patronal_pct / 100);
        rat = folha * (rat_pct / 100);
        terc = folha * (terceiros_pct / 100);
      } else {
        pct_total = fgts_pct;
      }
    } else {
      // Presumido / Real — encargos completos (37,5% + RAT)
      pct_total = 37.5 + rat_pct;
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
    // crescimento_pct — vendedor responde slider em t16 do diagnóstico.
    // Distingue 0 deliberado ("Estável") de 0 ausente (não respondeu).
    // Bug B documentado em b174152 + investigação pós-0c67dab: o ramo de
    // fallback via fat_anterior era código fantasma (diag não coleta esse
    // campo) — removido nesta correção.
    const crescimento_respondido = (
      d.crescimento_pct !== undefined
      && d.crescimento_pct !== null
      && d.crescimento_pct !== ''
    );
    const crescimento_pct = n(d.crescimento_pct);
    origem.crescimento_pct = crescimento_respondido ? 'informado' : 'fallback_zero';

    // crescimento_proj_pct = projeção declarada pelo vendedor (otimista).
    // Usado por calcAtratividadeV2 como fallback com penalidade -2 quando
    // crescimento_pct histórico não está disponível.
    const crescimento_proj_pct = n(d.crescimento_proj_pct);
    origem.crescimento_proj_pct = crescimento_proj_pct !== 0 ? 'informado' : 'fallback_zero';

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

    // ── % produto (T28a — usado pra marcar CMV neutro em serviço puro) ──
    const pct_produto = n(d.pct_produto);
    origem.pct_produto = pct_produto > 0 ? 'informado' : 'fallback_zero';

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
    origem.clt_folha = clt_folha > 0 ? 'informado' : 'fallback_zero';
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
    origem.custo_outros = custo_outros > 0 ? 'informado' : 'fallback_zero';
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
    // outros_ativos — diag salva como d.at_outros. p1 pega primeiro positivo.
    const outros_ativos = tag('outros_ativos', n(p1(d.outros_ativos, d.at_outros, dados.outros_ativos)));

    // ── Balanço ── passivos (naming v2 + split fornecedores)
    const fornec_a_vencer = tag('fornec_a_vencer',
      p1(d.fornec_a_vencer, d.pv_forn_a_vencer, d.fornec_a_pagar, d.pv_forn, d.contas_pagar));
    const fornec_atrasadas = tag('fornec_atrasadas',
      p1(d.fornec_atrasadas, d.fornec_atrasados, d.pv_forn_atrasadas));
    const impostos_atrasados = tag('impostos_atrasados', n(d.impostos_atrasados));
    const folha_pagar = tag('folha_pagar', n(d.folha_pagar));
    const saldo_devedor = tag('saldo_devedor', p1(d.saldo_devedor, d.emprestimos, dados.saldo_devedor));
    // outros_passivos — diag salva como d.outro_passivo_val (singular). Alias.
    const outros_passivos = tag('outros_passivos', n(p1(d.outros_passivos, d.outro_passivo_val, dados.outros_passivos)));

    // ── Ciclo financeiro (PMR / PMP em dias) ──
    const pmr = n(p1(d.pmr, d.prazo_medio_recebimento));
    const pmp = n(p1(d.pmp, d.prazo_medio_pagamento));

    // ── Qualitativo ISE ──
    const processos = d.processos || 'parcial';
    const dependencia = d.dependencia || 'parcial';
    const marca_inpi = d.marca_inpi || 'nao';
    const processos_juridicos = String(d.processos_juridicos || 'nao').toLowerCase();
    // Detalhamento dos processos jurídicos (diag t40, sub-bloco c-juridico):
    // - juridico_tipo: array multi-select com 'trabalhista'/'fiscal'/'civil'/'outro'
    // - passivo_juridico: número (R$, "como réu — valor em risco")
    // - ativo_juridico:  número (R$, "como autor — valor a receber")
    // Consumidos em calcPilar6.passivos_juridicos (combinação dos 3).
    const juridico_tipo = Array.isArray(d.juridico_tipo) ? d.juridico_tipo
      : Array.isArray(dados.juridico_tipo) ? dados.juridico_tipo
      : [];
    const passivo_juridico = n(p1(d.passivo_juridico, dados.passivo_juridico));
    const ativo_juridico = n(p1(d.ativo_juridico, dados.ativo_juridico));

    // ── Qualitativo ISE v2 (8 pilares — Decisão #13) ──
    // dre_separacao_pf_pj — diag salva remuneracao_socios (t31) com domínio
    // 'fixo' (pró-labore formalizado) / 'sobra' (retira o que sobra) / 'nao'
    // (ainda não retiram). mapDadosV2 deriva pro nome legado pra downstream.
    // Aproximação consciente: pró-labore formal = separação contábil PF/PJ;
    // "retira o que sobra" = mistura informal.
    const remuneracao_socios = d.remuneracao_socios || dados.remuneracao_socios || null;
    const dre_separacao_pf_pj = remuneracao_socios
      || d.dre_separacao_pf_pj || dados.dre_separacao_pf_pj || null;
    // contabilidade — diag salva como contabilidade_formal (t34) com domínio
    // 'sim' (contador externo) / 'interno' / 'nao'. mapDadosV2 deriva pro
    // nome legado D.contabilidade pra downstream da skill ler.
    const contabilidade = d.contabilidade_formal || d.contabilidade
      || dados.contabilidade_formal || dados.contabilidade || null;
    const margem_estavel = d.margem_estavel || dados.margem_estavel || null;
    const base_clientes = d.base_clientes || dados.base_clientes || null;
    // gestor_autonomo é a pergunta única do diagnóstico (t33: "Tem alguém na equipe
    // que tocaria o negócio sem você?") que cobre conceitualmente os DOIS campos
    // que a skill consome separadamente (tem_gestor e opera_sem_dono). Mapeamos
    // ambos a partir da mesma resposta — aproximação consciente: quem tem gestor
    // autônomo, por definição, opera sem o dono.
    const gestor_autonomo = d.gestor_autonomo || dados.gestor_autonomo
      || d.tem_gestor || dados.tem_gestor || null;
    const tem_gestor = gestor_autonomo;
    const opera_sem_dono = gestor_autonomo;
    const equipe_permanece = d.equipe_permanece || dados.equipe_permanece || null;
    const passivo_trabalhista = d.passivo_trabalhista || dados.passivo_trabalhista || null;
    const impostos_dia = d.impostos_dia || dados.impostos_dia || null;
    // reputacao — diag salva D.reputacao (t13b, sub-bloco c-reputacao) com domínio
    // 'excelente' / 'boa' / 'neutra' / 'problemas' (default 'boa'). Skill v2 lia
    // o nome fantasma D.reputacao_online com domínio 'positiva/neutra/negativa'.
    // mapDadosV2 deriva pro nome legado pra downstream.
    const reputacao = d.reputacao || dados.reputacao || null;
    const reputacao_online = reputacao
      || d.reputacao_online || dados.reputacao_online || null;

    // online — diag salva D.online (t14, multi-select array) com valores
    // 'site'/'ecommerce'/'instagram'/'gmaps'/'marketplace'/'nenhum'. Substitui
    // o fantasma D.presenca_digital. P8.presenca_digital reativada via contagem
    // de canais (commit calcPilar8).
    const online = Array.isArray(d.online) ? d.online
      : Array.isArray(dados.online) ? dados.online
      : null;
    const presenca_digital = online; // mantém nome legado pra downstream (uso muda em calcPilar8)

    // Origens dos campos qualitativos / comerciais (consumidos por calcICDv2).
    // Tag presence-based: se o campo veio explícito do diagnóstico = informado,
    // senão fallback_zero (mesmo que o default seja 'parcial'/'nao' por convenção).
    ['recorrencia_pct','concentracao_pct','processos','gestor_autonomo','tem_gestor','opera_sem_dono',
     'passivo_trabalhista','impostos_dia','marca_inpi','reputacao','online',
     'contabilidade_formal','remuneracao_socios','juridico_tipo','passivo_juridico'].forEach(k => {
      const v = d[k];
      origem[k] = (v !== undefined && v !== null && v !== '') ? 'informado' : 'fallback_zero';
    });

    let recorrencia_pct;
    const rv = d.recorrencia_pct !== undefined ? d.recorrencia_pct : dados.recorrencia_pct;
    if (rv === 'nao' || rv === false || rv === 'false') recorrencia_pct = 0;
    else if (rv === 'sim' || rv === true || rv === 'true') recorrencia_pct = 100;
    else recorrencia_pct = n(rv);

    const concentracao_pct = n(p1(d.concentracao_pct, d.maior_cliente_pct));

    // ── Operacional ──
    const num_funcs = n(p1(dados.num_funcionarios, d.num_funcs, d.num_funcionarios, d.clt_qtd));
    const clientes = n(p1(d.cli_1m, d.clientes_ativos));
    const ticket = n(p1(d.ticket_medio));

    // ── Hooks Rede de Parceiros (Decisão #21 — nullable) ──
    const parceiro_origem_id = dados.parceiro_origem_id || d.parceiro_origem_id || null;
    const parceiro_destino_id = dados.parceiro_destino_id || d.parceiro_destino_id || null;
    const tese_id = dados.tese_id || d.tese_id || null;

    // nome_responsavel — capturado na primeira tela do diagnóstico (junto com telefone + OTP).
    // Vai pra calc_json.identificacao e é exibido na folha de rosto do laudo.
    const nome_responsavel = tag(
      'nome_responsavel',
      dados.nome_responsavel || d.nome_responsavel || dados.responsavel || d.responsavel || ''
    );

    return {
      id: dados.id,
      codigo: d.codigo_diagnostico || dados.codigo_diagnostico || dados.slug || '',
      nome: dados.nome || d.nome_negocio || d.nome || 'Empresa',
      nome_responsavel,
      setor_raw, setor_code,
      cidade: dados.cidade || d.cidade || '',
      estado: dados.estado || d.estado || '',
      anos: n(p1(dados.anos_existencia, d.anos_existencia, d.cnpj_anos, dados.cnpj_anos)),

      regime, anexo,

      fat_mensal, fat_anual,
      crescimento_pct, crescimento_proj_pct,

      // Pré-calculados (overrides do diagnóstico)
      impostos_precalc: n(p1(d.impostos_mensal, d.imposto_calculado)),
      aliquota_precalc: n(d.aliquota_imposto),

      // Custos de transação
      taxas_recebimento, comissoes,

      // Franquia
      franquia,
      royalty_pct, royalty_fixo, mkt_franquia_pct, mkt_franquia_fixo,

      // CMV
      cmv_mensal, cmv_pct: cmv_pct_input, pct_produto,

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

      // Detalhamento jurídico (diag t40)
      juridico_tipo, passivo_juridico, ativo_juridico,

      // Qualitativo v2 (8 pilares ISE)
      dre_separacao_pf_pj, contabilidade, margem_estavel, base_clientes,
      tem_gestor, opera_sem_dono, equipe_permanece, passivo_trabalhista,
      impostos_dia, reputacao, reputacao_online,
      online, presenca_digital,
      remuneracao_socios,

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
    // BLOCO 1 só inclui impostos sobre FATURAMENTO (PIS/COFINS/ISS/ICMS).
    // IRPJ/CSLL ficam no BLOCO 4 (calcImpostosSobreLucro) — evita duplo-count.
    const fat_total_anual_calc = calcReal.decomposicao
      ? calcReal.decomposicao.fat_total_anual
      : calcReal.anual;
    const impostos_mensal = fat_total_anual_calc / 12;
    const impostos_pct = fat_anual > 0 ? (fat_total_anual_calc / fat_anual) * 100 : 0;
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

    const antecipacao_recebiveis = n(D.antecipacao_caixa);
    const total_deducoes = impostos_mensal + taxas_recebimento + comissoes + royalty_pct_aplicado + mkt_franquia_pct_aplicado + antecipacao_recebiveis;
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

    // ── Shapes flat reutilizadas tanto em bloco_X_* quanto no atalho topo ──
    // Renderers (laudo-pago, laudo-admin, negocio.html) leem dre.pessoal/ocupacao/etc
    // diretamente — manter esses caminhos planos é parte do contrato com consumidores.
    const flatPessoal = {
      clt_folha_bruta, clt_encargos,
      clt_encargos_detalhes: enc,
      pj_custo,
      royalty_fixo, mkt_franquia_fixo,
      folha_total,
      folha_total_mensal: folha_total,
    };
    const flatOcupacao = {
      aluguel, facilities, terceirizados,
      total: ocupacao_total,
      total_mensal: ocupacao_total,
    };
    const flatOpOutros = {
      sistemas, outros_cf, mkt_pago,
      total: operacional_outros_total,
      total_mensal: operacional_outros_total,
    };
    const flatDeducoes = {
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
      impostos_calculados_mensal: impostos_mensal,
      impostos_declarados_pelo_vendedor_mensal: impostos_declarado,
      diferenca_potencial_passivo_mensal: diferenca_potencial_passivo,
      taxas_recebimento, comissoes,
      royalty_pct_aplicado, mkt_franquia_pct_aplicado,
      antecipacao_recebiveis,
      total_deducoes,
      total_mensal: total_deducoes,
    };

    return {
      bloco_1_receita: { fat_mensal, fat_anual, ...flatDeducoes, rec_liquida },
      bloco_2_lucro_bruto: {
        cmv,
        lucro_bruto,
        margem_bruta_pct,
      },
      bloco_3_operacional: {
        pessoal: flatPessoal,
        ocupacao: flatOcupacao,
        operacional_outros: flatOpOutros,
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
        parcelas_dividas,
        investimentos,
        potencial_caixa_mensal,
      },

      // Flags "linha do DRE estimada" — true quando vendedor não declarou o valor.
      // Critério: D._origem_campos[campo] === 'fallback_zero'.
      // Usado pelo laudo pra rotular linhas como "estimado" em laranja.
      dre_estimados: {
        cmv: (D._origem_campos && D._origem_campos.cmv_mensal) === 'fallback_zero',
        folha: (D._origem_campos && D._origem_campos.clt_folha) === 'fallback_zero',
        aluguel: (D._origem_campos && D._origem_campos.aluguel) === 'fallback_zero',
        outros_cf: (D._origem_campos && D._origem_campos.custo_outros) === 'fallback_zero',
      },

      // Atalhos topo (compatibilidade com consumidores planos: laudo-pago,
      // laudo-admin e negocio.html leem destes caminhos diretos)
      fat_mensal, fat_anual,
      rec_liquida,
      rec_liquida_mensal: rec_liquida,
      cmv,
      lucro_bruto,
      lucro_bruto_mensal: lucro_bruto,
      folha_total,
      ro_mensal, ro_anual,
      margem_operacional_pct,
      lucro_liquido_mensal,
      potencial_caixa_mensal,
      deducoes_receita: flatDeducoes,
      pessoal: flatPessoal,
      ocupacao: flatOcupacao,
      operacional_outros: flatOpOutros,
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

  // ============================================================
  // Helpers de leitura de pesos do snapshot (Fase 3 — fim dos hardcodes)
  //
  // pesoPilar(P, 'p1_financeiro')           → 0.20 × 100 = 20
  // pesoSubMetrica(P, 'p8_marca', 'reputacao') → 0.333333
  //
  // Falha-loud (throw) se chave ausente. Snapshot esperado: v2026.06+.
  // ============================================================
  function pesoPilar(P, pilarKey) {
    const peso = P && P.pesos_ise && P.pesos_ise[pilarKey];
    if (peso == null) {
      throw new Error('[skill-v2] P.pesos_ise.' + pilarKey + ' ausente no snapshot. '
        + 'Snapshot esperado: v2026.05+. Rode migração SQL no Supabase.');
    }
    return peso * 100;
  }
  function pesoSubMetrica(P, pilarKey, subKey) {
    const peso = P && P.pesos_sub_metricas_ise
      && P.pesos_sub_metricas_ise[pilarKey]
      && P.pesos_sub_metricas_ise[pilarKey][subKey];
    if (peso == null) {
      throw new Error('[skill-v2] P.pesos_sub_metricas_ise.' + pilarKey + '.' + subKey
        + ' ausente. Snapshot esperado: v2026.06+. Rode migração SQL.');
    }
    return peso;
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
    const peso_pct = pesoPilar(P, 'p1_financeiro');

    const bench = getBenchmarkAjustado(D.setor_code, 'margem_op', D.modelo_code, P);
    const margem = dre.margem_operacional_pct;
    let s1;
    if (margem < 0) s1 = 0;
    else if (bench > 0 && margem >= bench) s1 = 10;
    else if (bench > 0 && margem >= bench * 0.7) s1 = 7;
    else if (bench > 0 && margem >= bench * 0.5) s1 = 5;
    else s1 = 2;

    // dre_separacao_pf_pj — derivado de D.remuneracao_socios em mapDadosV2.
    // Domínio real do diag (t31): 'fixo' (pró-labore formalizado, separação clara)
    //                              / 'sobra' (retira o que sobra, mistura informal)
    //                              / 'nao' (sócios ainda não retiram — neutro)
    const sep = D.dre_separacao_pf_pj;
    const s2 = sep === 'fixo' ? 10 : sep === 'nao' ? 5 : sep === 'sobra' ? 0 : 0;

    const s3 = dre.ro_mensal > 0 ? 10 : 0;

    const ct = D.contabilidade;
    // Domínio real do diagnóstico (t34): 'sim' (contador externo) / 'interno' / 'nao'.
    // 'sim' = formal terceirizado (10), 'interno' = formal porém in-house (7), 'nao' = 0.
    const s4 = ct === 'sim' ? 10 : ct === 'interno' ? 7 : 0;

    return pilarFromSubs('p1_financeiro', 'Financeiro', peso_pct, [
      { id: 'margem_op_pct', label: 'Margem operacional vs benchmark setorial', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p1_financeiro','margem_op_pct'), valor: margem, benchmark: bench },
      { id: 'dre_separacao', label: 'Separação PF/PJ no DRE', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p1_financeiro','dre_separacao'), valor: sep || null },
      { id: 'fluxo_caixa_positivo', label: 'Fluxo de caixa operacional positivo', score_0_10: s3, peso_decimal: pesoSubMetrica(P,'p1_financeiro','fluxo_caixa_positivo'), valor: dre.ro_mensal },
      { id: 'contabilidade_formal', label: 'Contabilidade formal', score_0_10: s4, peso_decimal: pesoSubMetrica(P,'p1_financeiro','contabilidade_formal'), valor: ct || null },
    ]);
  }

  // ── P2 — Resultado (peso 15%) ──
  // Sub-métrica margem_estavel removida (Frente 2.2): D.margem_estavel é fantasma,
  // proxy via crescimento_pct era fraco demais (faturamento != margem). P2 fica
  // com 2 sub-métricas: ebitda_real (RO anual positivo) + rentabilidade_imobilizado.
  // Snapshot v2026.07+ tem pesos 0.50 / 0.50.
  function calcPilar2Resultado(D, dre, balanco, P) {
    const peso_pct = pesoPilar(P, 'p2_resultado');

    const s1 = dre.ro_anual > 0 ? 10 : 0;

    const imob = balanco.ativos.imobilizado_total;
    const selic = n(P.selic_anual) || 14.0;
    let s2;
    let roi_pct = null;
    if (imob > 0) {
      roi_pct = (dre.ro_anual / imob) * 100;
      if (roi_pct < 0) s2 = 0;
      else if (roi_pct >= selic * 2) s2 = 10;
      else if (roi_pct >= selic) s2 = 7;
      else if (roi_pct >= selic / 2) s2 = 5;
      else s2 = 3;
    } else {
      s2 = 5; // neutro: sem imobilizado relevante
    }

    return pilarFromSubs('p2_resultado', 'Resultado', peso_pct, [
      { id: 'ebitda_real', label: 'Resultado anual positivo', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p2_resultado','ebitda_real'), valor: dre.ro_anual },
      { id: 'rentabilidade_imobilizado', label: 'Rentabilidade do imobilizado vs Selic', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p2_resultado','rentabilidade_imobilizado'), valor: roi_pct, selic_referencia: selic },
    ]);
  }

  // ── P3 — Comercial (peso 15%) ──
  function calcPilar3Comercial(D, dre, balanco, P) {
    const peso_pct = pesoPilar(P, 'p3_comercial');

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
      { id: 'num_clientes', label: 'Número de clientes ativos', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p3_comercial','num_clientes'), valor: cli },
      { id: 'recorrencia_pct', label: 'Recorrência vs benchmark', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p3_comercial','recorrencia_pct'), valor: rec, benchmark: benchRec },
      { id: 'concentracao_pct', label: 'Concentração de clientes vs limite', score_0_10: s3, peso_decimal: pesoSubMetrica(P,'p3_comercial','concentracao_pct'), valor: conc, benchmark_max: benchConc },
      { id: 'base_clientes_documentada', label: 'Base de clientes documentada', score_0_10: s4, peso_decimal: pesoSubMetrica(P,'p3_comercial','base_clientes_documentada'), valor: bc || null },
    ]);
  }

  // ── P4 — Gestão (peso 15%) ──
  function calcPilar4Gestao(D, dre, balanco, P) {
    const peso_pct = pesoPilar(P, 'p4_gestao');

    const proc = D.processos;
    // aceita 'sim' (v2) e 'documentados' (legado v1)
    const s1 = (proc === 'sim' || proc === 'documentados') ? 10 : proc === 'parcial' ? 6 : 0;

    const tg = D.tem_gestor;
    const s2 = tg === 'sim' ? 10 : 0;

    const sis = n(D.custo_sistemas);
    const s3 = sis > 0 ? 7 : 0;

    return pilarFromSubs('p4_gestao', 'Gestão', peso_pct, [
      { id: 'processos_documentados', label: 'Processos documentados', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p4_gestao','processos_documentados'), valor: proc || null },
      { id: 'tem_gestor', label: 'Possui gestor dedicado', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p4_gestao','tem_gestor'), valor: tg || null },
      { id: 'sistemas_implantados', label: 'Investe em sistemas/ERP', score_0_10: s3, peso_decimal: pesoSubMetrica(P,'p4_gestao','sistemas_implantados'), valor: sis },
    ]);
  }

  // ── P5 — Sócio / Dependência (peso 10%) ──
  function calcPilar5SocioDependencia(D, dre, balanco, P) {
    const peso_pct = pesoPilar(P, 'p5_socio_dependencia');

    const od = D.opera_sem_dono;
    const s1 = od === 'sim' ? 10 : 0;

    const ep = D.equipe_permanece;
    // Domínio do diagnóstico (t33b): 'sim' / 'parcial' / 'nao'.
    // Calibração linear 10/5/0 — substitui 'provavelmente'→6 que nunca era atingido
    // (mismatch com domínio do diagnóstico).
    const s2 = ep === 'sim' ? 10 : ep === 'parcial' ? 5 : 0;

    const s3 = n(D.prolabore) > 0 ? 8 : 5;

    return pilarFromSubs('p5_socio_dependencia', 'Sócio / Dependência', peso_pct, [
      { id: 'opera_sem_dono', label: 'Opera sem o dono', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p5_socio_dependencia','opera_sem_dono'), valor: od || null },
      { id: 'equipe_permanece', label: 'Equipe permanece pós-venda', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p5_socio_dependencia','equipe_permanece'), valor: ep || null },
      { id: 'prolabore_documentado', label: 'Pró-labore documentado', score_0_10: s3, peso_decimal: pesoSubMetrica(P,'p5_socio_dependencia','prolabore_documentado'), valor: D.prolabore },
    ]);
  }

  // ── P6 — Risco Legal (peso 10%) ──
  function calcPilar6RiscoLegal(D, dre, balanco, P) {
    const peso_pct = pesoPilar(P, 'p6_risco_legal');

    const fat_mensal = n(dre.fat_mensal);

    // ── s1: passivos_juridicos (substitui sem_passivo_trabalhista fantasma) ──
    // Combina os 3 campos reais do diag t40:
    //   D.processos_juridicos ('sim'/'nao')
    //   D.juridico_tipo (array, inclui 'trabalhista' se houver)
    //   D.passivo_juridico (R$, "como réu — valor em risco")
    const tem_processo = D.processos_juridicos === 'sim';
    const tem_trabalhista = Array.isArray(D.juridico_tipo)
      && D.juridico_tipo.indexOf('trabalhista') >= 0;
    const passivo_jur = n(D.passivo_juridico);
    let s1;
    if (!tem_processo) s1 = 10;
    else if (tem_processo && !tem_trabalhista) s1 = 7;
    else if (tem_processo && tem_trabalhista && passivo_jur < fat_mensal) s1 = 4;
    else s1 = 0; // tem_processo && tem_trabalhista && passivo_jur >= fat_mensal

    // ── s2: sem_acao_judicial (mantida — usa só processos_juridicos) ──
    const pj = D.processos_juridicos;
    const s2 = pj === 'nao' ? 10 : pj === 'sim' ? 0 : 5;

    // ── s3: impostos_atrasados_volume (substitui impostos_em_dia fantasma) ──
    // D.impostos_dia era fantasma; D.impostos_atrasados (R$) é numérico real.
    const imp = n(D.impostos_atrasados);
    let s3;
    if (imp === 0) s3 = 10;
    else if (fat_mensal > 0 && imp < fat_mensal * 0.5) s3 = 7;
    else if (fat_mensal > 0 && imp < fat_mensal * 2) s3 = 4;
    else s3 = 0;

    // ── s4: sem_impostos_atrasados (mantida — mesma fonte, escala diferente) ──
    // (Mantida pra compatibilidade com snapshot que tem peso 0.25 nesta chave;
    // calcula igual ao s3 mas o snapshot trata como sub-métrica separada.)
    const s4 = s3;

    return pilarFromSubs('p6_risco_legal', 'Risco Legal', peso_pct, [
      { id: 'passivos_juridicos', label: 'Passivos jurídicos (trabalhista + risco)', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p6_risco_legal','passivos_juridicos'), valor: { tem_processo, tem_trabalhista, passivo_juridico: passivo_jur } },
      { id: 'sem_acao_judicial', label: 'Sem ações judiciais em geral', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p6_risco_legal','sem_acao_judicial'), valor: pj || null },
      { id: 'impostos_atrasados_volume', label: 'Volume de impostos atrasados vs faturamento', score_0_10: s3, peso_decimal: pesoSubMetrica(P,'p6_risco_legal','impostos_atrasados_volume'), valor: imp },
      { id: 'sem_impostos_atrasados', label: 'Sem impostos atrasados (mesma fonte)', score_0_10: s4, peso_decimal: pesoSubMetrica(P,'p6_risco_legal','sem_impostos_atrasados'), valor: imp },
    ]);
  }

  // ── P7 — Balanço (peso 8%) ──
  function calcPilar7Balanco(D, dre, balanco, P) {
    const peso_pct = pesoPilar(P, 'p7_balanco');

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
      { id: 'patrimonio_positivo', label: 'Patrimônio líquido positivo', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p7_balanco','patrimonio_positivo'), valor: balanco.patrimonio_liquido },
      { id: 'liquidez', label: 'Liquidez (ativos / passivos)', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p7_balanco','liquidez'), valor: liquidez_ratio },
      { id: 'ncg_saudavel', label: 'NCG vs faturamento mensal', score_0_10: s3, peso_decimal: pesoSubMetrica(P,'p7_balanco','ncg_saudavel'), valor: ncg },
    ]);
  }

  // ── P8 — Marca / Reputação (peso 7%) ──
  function calcPilar8Marca(D, dre, balanco, P) {
    const peso_pct = pesoPilar(P, 'p8_marca');

    const m = D.marca_inpi;
    // aceita 'registrada'/'em_processo' (v2) e 'sim'/'processo' (legado v1)
    const s1 = (m === 'registrada' || m === 'sim') ? 10
      : (m === 'em_processo' || m === 'processo') ? 6
      : 0;

    // reputacao — D.reputacao_online é alias derivado de D.reputacao em mapDadosV2.
    // Domínio real do diag (t13b): 'excelente' / 'boa' / 'neutra' / 'problemas'.
    const r = D.reputacao_online; // já aliasado de D.reputacao em mapDadosV2
    const s2 = r === 'excelente' ? 10
      : r === 'boa' ? 7
      : r === 'neutra' ? 4
      : r === 'problemas' ? 0
      : 0; // fail-closed se ausente

    // presenca_digital — D.presenca_digital agora é array (alias de D.online em
    // mapDadosV2). Diag salva em t14 multi-select com valores: 'site', 'ecommerce',
    // 'instagram', 'gmaps', 'marketplace', 'nenhum' (excludente).
    // Calibração baseada em quantidade de canais ativos (excluindo 'nenhum').
    const pd = D.presenca_digital;
    const canais_ativos = Array.isArray(pd)
      ? pd.filter(c => c !== 'nenhum').length
      : 0;
    let s3;
    if (canais_ativos === 0) s3 = 0;
    else if (canais_ativos === 1) s3 = 4;
    else if (canais_ativos === 2) s3 = 7;
    else s3 = 10; // 3+ canais

    return pilarFromSubs('p8_marca', 'Marca / Reputação', peso_pct, [
      { id: 'marca_inpi', label: 'Marca registrada no INPI', score_0_10: s1, peso_decimal: pesoSubMetrica(P,'p8_marca','marca_inpi'), valor: m || null },
      { id: 'reputacao', label: 'Reputação no mercado', score_0_10: s2, peso_decimal: pesoSubMetrica(P,'p8_marca','reputacao'), valor: r || null },
      { id: 'presenca_digital', label: 'Presença digital (canais ativos)', score_0_10: s3, peso_decimal: pesoSubMetrica(P,'p8_marca','presenca_digital'), valor: { canais: pd || [], total_ativos: canais_ativos } },
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

    // Classe via P.fator_ise (com fallback hardcoded). Math.round antes do lookup
    // pra evitar gaps entre faixas (ex: ISE 84.1 caía entre Consolidado.max=84 e
    // Estruturado.min=85). Mesmo padrão usado no cap_ise (ise_int).
    const ise_int = Math.round(ise_total);
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
      if (ise_int >= f.min && ise_int <= f.max) {
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
    // Frente 2.5 — Regra 2 (Coisa A não informa Coisa B):
    // D.crescimento_proj_pct é projeção do vendedor (opinião não-validada) e
    // não pode entrar em score. Removido o ramo de fallback que caía nele.
    // O campo continua exposto em D para exibição contextual no laudo.
    //
    // Lógica:
    //   - origem.crescimento_pct === 'informado': usa D.crescimento_pct +
    //     P.faixas_crescimento → score (calibração inalterada)
    //   - origem.crescimento_pct === 'fallback_zero': score 3 (entre "Em queda"=2
    //     e "Estável"=4), metadata { motivo: 'sem_resposta', score: 3 }
    //     Razão: pular pergunta é descaso, mas não é queda real. Score 3
    //     comunica "você deveria ter respondido" sem premiar ausência.
    const origemCresc = (D._origem_campos && D._origem_campos.crescimento_pct) || 'fallback_zero';
    const respondido = (origemCresc === 'informado');
    const crescimento_pct = respondido ? n(D.crescimento_pct) : 0;
    const fonte_crescimento = respondido ? 'historico_real' : 'sem_resposta';

    let score_crescimento;
    let metadata_crescimento = null;
    if (respondido) {
      const faixas_cresc = P.faixas_crescimento || [];
      score_crescimento = 4; // default neutro caso nenhuma faixa encaixe
      for (const f of faixas_cresc) {
        if (crescimento_pct >= f.min && crescimento_pct <= f.max) {
          score_crescimento = f.score;
          break;
        }
      }
    } else {
      score_crescimento = 3; // levemente penalizado: descaso < Estável (4), > Em queda (2)
      metadata_crescimento = { componente: 'crescimento', motivo: 'sem_resposta', score: 3 };
    }
    const penalidade_aplicada = 0;

    // ── Contribuições (score × peso_pct / 10) ──
    const round2 = v => Math.round(v * 100) / 100;
    const contrib_ise = round2(componente_ise_score * 50 / 10);
    const contrib_setor = round2(componente_setor_score * 25 / 10);
    const contrib_cresc = round2(score_crescimento * 25 / 10);

    const total = Math.round(contrib_ise + contrib_setor + contrib_cresc);

    // ── Faixa label via P.faixas_atratividade (com fallback hardcoded) ──
    const faixas_atr = (P.faixas_atratividade && P.faixas_atratividade.length > 0)
      ? P.faixas_atratividade
      : [
          { min: 90, max: 100, label: 'Alta' },
          { min: 75, max: 89,  label: 'Atrativa' },
          { min: 60, max: 74,  label: 'Padrão' },
          { min: 45, max: 59,  label: 'Limitada' },
          { min: 0,  max: 44,  label: 'Baixa' },
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
          metadata: metadata_crescimento,
        },
      ],
    };
  }

  // ============================================================
  // calcAnaliseTributariaV2 — comparativo entre regimes (Etapa 2.8.B)
  // (Decisões #14 cálculo real + #17 três bases por regime)
  //
  // Compara o regime DECLARADO contra Simples / Presumido / Real / MEI.
  // Para Simples comparado consigo mesmo (declarado === 'simples'),
  // respeita o anexo declarado; nos demais casos usa determinarAnexoSimples.
  // ============================================================

  function calcImpostoCompleto(fat_anual, ro_anual, regime, anexo, P, contexto, D) {
    const ctx = Object.assign({}, contexto || {}, { ro_anual });
    const calcImposto = calcImpostoSobreFaturamento(fat_anual, regime, anexo, P, ctx);

    if (calcImposto.viabilidade === 'inviavel') {
      return {
        ...calcImposto,
        imposto_anual: 0,
        encargo_folha_anual: 0,
      };
    }

    const folha_mensal = D ? n(D.clt_folha) : 0;
    const setor_code = (contexto && contexto.setor_code) || (D && D.setor_code);
    const anexo_aplicado = calcImposto.anexo || anexo;
    const encargo = calcEncargosCLT(folha_mensal, regime, anexo_aplicado, setor_code, P);

    return {
      ...calcImposto,
      imposto_anual: calcImposto.anual,
      encargo_folha_anual: encargo.encargos * 12,
      detalhes_encargo: encargo,
    };
  }

  function calcAnaliseTributariaV2(D, dre, P) {
    const setor_code = D.setor_code;
    const formas_lista = D.modelo_atuacao_multi || D.modelo_multi || [];
    const forma_principal = D.modelo_atuacao_principal || D.modelo_code || formas_lista[0];
    const fat_anual = dre.fat_anual;
    const ro_anual = dre.ro_anual;
    const folha_anual = (n(D.clt_folha) + n(D.prolabore)) * 12;

    const contexto_base = {
      folha_anual_total: folha_anual,
      setor_code,
      forma_principal,
    };

    const regime_declarado = D.regime;
    const anexo_declarado = D.anexo;

    // 1. Calcula pelo regime declarado (com anexo declarado, se Simples)
    const calc_declarado = calcImpostoCompleto(
      fat_anual, ro_anual, regime_declarado, anexo_declarado, P, contexto_base, D
    );

    // 2. Itera os 4 regimes (MEI sempre incluído) com flag de elegibilidade
    const regimes_para_testar = ['mei', 'simples', 'presumido', 'real'];

    // Helper: elegibilidade por regime (limites 2026)
    function checkElegibilidade(regime) {
      if (regime === 'mei') {
        if (fat_anual > 81000) return { elegivel: false,
          motivo: 'Faturamento anual de R$ ' + Math.round(fat_anual).toLocaleString('pt-BR') + ' excede o limite MEI de R$ 81.000/ano' };
        return { elegivel: true, motivo: null };
      }
      if (regime === 'simples') {
        if (fat_anual > 4800000) return { elegivel: false,
          motivo: 'Faturamento anual de R$ ' + Math.round(fat_anual).toLocaleString('pt-BR') + ' excede o limite do Simples Nacional de R$ 4,8M/ano' };
        return { elegivel: true, motivo: null };
      }
      if (regime === 'presumido') {
        if (fat_anual > 78000000) return { elegivel: false,
          motivo: 'Faturamento anual de R$ ' + Math.round(fat_anual).toLocaleString('pt-BR') + ' excede o limite do Lucro Presumido de R$ 78M/ano' };
        return { elegivel: true, motivo: null };
      }
      // Real: sem limite superior
      return { elegivel: true, motivo: null };
    }

    const comparativo = [];
    for (const regime of regimes_para_testar) {
      let anexo_test = null;
      if (regime === 'simples') {
        if (regime === regime_declarado && anexo_declarado) {
          anexo_test = anexo_declarado;
        } else {
          const fator_r = fat_anual > 0 ? folha_anual / fat_anual : 0;
          anexo_test = determinarAnexoSimples(setor_code, forma_principal, fator_r);
        }
      }

      const eleg = checkElegibilidade(regime);

      const resultado = calcImpostoCompleto(
        fat_anual, ro_anual, regime, anexo_test, P, contexto_base, D
      );

      comparativo.push({
        regime,
        anexo: anexo_test,
        elegivel: eleg.elegivel,
        motivo_inelegibilidade: eleg.motivo,
        imposto_anual: resultado.imposto_anual || 0,
        encargo_folha_anual: resultado.encargo_folha_anual || 0,
        total_anual: (resultado.imposto_anual || 0) + (resultado.encargo_folha_anual || 0),
        aliquota_efetiva_pct: fat_anual > 0
          ? ((resultado.imposto_anual || 0) / fat_anual) * 100
          : 0,
        viabilidade: resultado.viabilidade || 'viavel',
        razao_inviabilidade: resultado.razao_inviabilidade || null,
        observacao: regime === regime_declarado ? 'Regime atual' : null,
        detalhes: resultado.detalhes,
        decomposicao: resultado.decomposicao || null,
      });
    }

    // 3. Identificar regime ótimo APENAS entre elegíveis e viáveis.
    // Se nenhum, default = regime declarado (mesmo que inelegível).
    const elegiveis_viaveis = comparativo.filter(r => r.elegivel && r.viabilidade === 'viavel');
    let regime_otimo = elegiveis_viaveis.length > 0
      ? elegiveis_viaveis.reduce(
          (min, r) => r.total_anual < min.total_anual ? r : min,
          elegiveis_viaveis[0]
        )
      : null;
    if (!regime_otimo) {
      regime_otimo = comparativo.find(r => r.regime === regime_declarado) || null;
    }

    // 4. Economia (compara o entry do declarado vs o ótimo)
    const declarado_entry = comparativo.find(r => r.regime === regime_declarado);
    const total_declarado = declarado_entry ? declarado_entry.total_anual : 0;

    // 4b. Alerta de inelegibilidade (regime declarado é inelegível)
    const alerta_inelegibilidade = (declarado_entry && !declarado_entry.elegivel)
      ? { regime: regime_declarado, motivo: declarado_entry.motivo_inelegibilidade }
      : null;
    const economia_anual = regime_otimo ? total_declarado - regime_otimo.total_anual : 0;
    const economia_pct_do_ro = ro_anual > 0 ? (economia_anual / ro_anual) * 100 : 0;

    // 5. Upside obrigatório se a economia for material
    const gera_obrigatorio = !!(
      regime_otimo &&
      regime_otimo.regime !== regime_declarado &&
      economia_anual > 10000 &&
      ro_anual > 0 &&
      economia_anual > ro_anual * 0.05
    );

    const observacao_economia = !regime_otimo
      ? 'Sem regime viável calculado'
      : (regime_otimo.regime === regime_declarado
          ? 'Negócio já está no regime ótimo'
          : 'Migração para ' + regime_otimo.regime + ' pode economizar R$ '
            + Math.max(0, economia_anual).toFixed(2) + '/ano');

    return {
      regime_declarado,
      anexo_simples: anexo_declarado,
      fator_r_calculado: calc_declarado.fator_r_calculado || null,
      fator_r_observacao: calc_declarado.observacao_fator_r || null,

      regime_otimo_calculado: regime_otimo ? regime_otimo.regime : null,
      regime_otimo_anexo: regime_otimo ? regime_otimo.anexo : null,

      comparativo_regimes: comparativo,

      economia_potencial: {
        comparado_a: regime_declarado,
        regime_recomendado: regime_otimo ? regime_otimo.regime : null,
        economia_anual,
        economia_pct_do_ro,
        observacao: observacao_economia,
      },

      gera_upside_obrigatorio: gera_obrigatorio,
      alerta_inelegibilidade,
      regra_obrigatorio: 'economia anual > R$ 10.000 E > 5% do RO anual',
    };
  }

  // ============================================================
  // calcStatusIndicador — helper compartilhado pelos indicadores
  // 'maior_melhor' → no_alvo se ≥ benchmark; atencao se 0,9·b ≤ v < b; abaixo se < 0,9·b
  // 'menor_melhor' → no_alvo se ≤ benchmark; atencao se b < v ≤ 1,1·b; abaixo se > 1,1·b
  // 'neutro' → não compara (ex: cmv quando pct_produto = 0)
  // ============================================================

  function calcStatusIndicador(valor, benchmark, sentido) {
    const v = n(valor);
    const b = n(benchmark);
    if (sentido === 'neutro' || b === 0) return 'neutro';
    if (sentido === 'maior_melhor') {
      if (v >= b) return 'no_alvo';
      if (v >= b * 0.9) return 'atencao';
      return 'abaixo';
    }
    if (sentido === 'menor_melhor') {
      if (v <= b) return 'no_alvo';
      if (v <= b * 1.1) return 'atencao';
      return 'abaixo';
    }
    return 'neutro';
  }

  // ============================================================
  // calcIndicadoresV2 — 18 indicadores consolidados
  // Schema: { id, label, valor, unidade, benchmark, delta_pp, status, sentido, regra_aplicada, observacao }
  // benchmark/delta_pp/status = null quando não há benchmark setorial.
  // ============================================================

  function calcIndicadoresV2(D, dre, balanco, P) {
    const setor = D.setor_code || 'servicos_locais';
    const benchDre = (P.benchmarks_dre && P.benchmarks_dre[setor]) || {};
    const benchInd = (P.benchmarks_indicadores && P.benchmarks_indicadores[setor]) || {};
    const fat = n(dre.fat_mensal);

    // Bug B fix — benchmarks DRE são ajustados pela forma de atuação principal.
    // P.modificadores_forma_atuacao_dre[forma][indicador] em pp (ex: presta_servico
    // adiciona +3pp no benchmark de margem_op, +5pp em folha, -1pp em aluguel...).
    // benchInd (concentracao/recorrencia/pmr/pmp/margem_bruta) NÃO leva modificador.
    const formaPrincipal = D.modelo_atuacao_principal || D.modelo_code || 'presta_servico';
    function benchAjustado(indicadorBench) {
      const baseB = (benchDre && benchDre[indicadorBench] != null) ? benchDre[indicadorBench] : null;
      if (baseB == null) return null;
      const mod = (P.modificadores_forma_atuacao_dre
        && P.modificadores_forma_atuacao_dre[formaPrincipal]
        && P.modificadores_forma_atuacao_dre[formaPrincipal][indicadorBench]) || 0;
      return baseB + mod;
    }

    const round2 = x => Math.round(n(x) * 100) / 100;
    const REGRA_AJUSTADA_SUFFIX = ' · benchmark já ajustado pela forma de atuação (' + formaPrincipal + ')';
    const REGRAS = {
      maior_melhor: 'valor ≥ benchmark → no_alvo · 90-99% bench → atencao · <90% → abaixo',
      menor_melhor: 'valor ≤ benchmark → no_alvo · 100-110% bench → atencao · >110% → abaixo',
      neutro: 'comparação não aplica (neutro)',
    };

    function ind(id, label, unidade, valor, benchmark, sentido, observacao, ajustado) {
      const v = round2(valor);
      const hasBench = benchmark != null && benchmark !== '' && !isNaN(n(benchmark));
      const b = hasBench ? round2(benchmark) : null;
      const delta_pp = hasBench ? round2(n(valor) - n(benchmark)) : null;
      const status = hasBench ? calcStatusIndicador(valor, benchmark, sentido) : null;
      let regra_aplicada;
      if (!hasBench) regra_aplicada = 'sem benchmark';
      else regra_aplicada = (REGRAS[sentido] || 'sem regra') + (ajustado ? REGRA_AJUSTADA_SUFFIX : '');
      return {
        id, label, valor: v, unidade,
        benchmark: b, delta_pp, status,
        sentido: sentido || null,
        regra_aplicada,
        observacao: observacao || null,
      };
    }

    // ── Margens ──
    const margem_operacional = ind('margem_operacional', 'Margem operacional', '%',
      dre.margem_operacional_pct, benchAjustado('margem_op'), 'maior_melhor', null, true);
    const margemBrutaVal = dre.bloco_2_lucro_bruto && dre.bloco_2_lucro_bruto.margem_bruta_pct;
    const margem_bruta = ind('margem_bruta', 'Margem bruta', '%',
      margemBrutaVal, benchInd.margem_bruta, 'maior_melhor');
    const lucro_liq_mensal = n(dre.lucro_liquido_mensal);
    const margemLiqVal = fat > 0 ? (lucro_liq_mensal / fat) * 100 : 0;
    const margem_liquida = ind('margem_liquida', 'Margem líquida', '%',
      margemLiqVal, null, 'maior_melhor');

    // ── Custos como % do faturamento (denominador SEMPRE fat_mensal bruto) ──
    const cmvPctVal = fat > 0 ? (n(dre.cmv) / fat) * 100 : 0;
    const isServicoPuro = n(D.pct_produto) === 0;
    const cmv_pct = ind('cmv_pct', 'CMV / Custo direto', '%',
      cmvPctVal, benchAjustado('cmv'),
      isServicoPuro ? 'neutro' : 'menor_melhor',
      isServicoPuro ? 'Serviço puro — CMV não aplicável (pct_produto = 0)' : null,
      true);

    // Folha total: lê do flat shortcut OU do bloco_3 (compat).
    const folhaTotal = n(
      (dre.pessoal && dre.pessoal.folha_total)
      || (dre.bloco_3_operacional && dre.bloco_3_operacional.pessoal && dre.bloco_3_operacional.pessoal.folha_total)
      || dre.folha_total
    );
    const folhaPctVal = fat > 0 ? (folhaTotal / fat) * 100 : 0;
    const folha_pct = ind('folha_pct', 'Folha (% fat)', '%',
      folhaPctVal, benchAjustado('folha'), 'menor_melhor', null, true);

    const aluguelVal = n(
      (dre.ocupacao && dre.ocupacao.aluguel)
      || (dre.bloco_3_operacional && dre.bloco_3_operacional.ocupacao && dre.bloco_3_operacional.ocupacao.aluguel)
    );
    const aluguelPctVal = fat > 0 ? (aluguelVal / fat) * 100 : 0;
    const aluguel_pct = ind('aluguel_pct', 'Aluguel (% fat)', '%',
      aluguelPctVal, benchAjustado('aluguel'), 'menor_melhor', null, true);

    const mktVal = n(
      (dre.operacional_outros && dre.operacional_outros.mkt_pago)
      || (dre.bloco_3_operacional && dre.bloco_3_operacional.operacional_outros && dre.bloco_3_operacional.operacional_outros.mkt_pago)
    );
    const mktPctVal = fat > 0 ? (mktVal / fat) * 100 : 0;
    const mkt_pct = ind('mkt_pct', 'Marketing (% fat)', '%',
      mktPctVal, benchAjustado('mkt'), 'menor_melhor', null, true);

    const outrosCfVal = n(
      (dre.operacional_outros && dre.operacional_outros.outros_cf)
      || (dre.bloco_3_operacional && dre.bloco_3_operacional.operacional_outros && dre.bloco_3_operacional.operacional_outros.outros_cf)
    );
    const outrosCfPctVal = fat > 0 ? (outrosCfVal / fat) * 100 : 0;
    const outros_cf_pct = ind('outros_cf_pct', 'Outros custos fixos (% fat)', '%',
      outrosCfPctVal, benchAjustado('outros_cf'), 'menor_melhor', null, true);

    const deducoesVal = n(
      (dre.deducoes_receita && (dre.deducoes_receita.total_deducoes != null ? dre.deducoes_receita.total_deducoes : dre.deducoes_receita.total_mensal))
      || (dre.bloco_1_receita && dre.bloco_1_receita.total_deducoes)
    );
    const deducoesPctVal = fat > 0 ? (deducoesVal / fat) * 100 : 0;
    const deducoes_pct = ind('deducoes_pct', 'Total de deduções (% fat)', '%',
      deducoesPctVal, benchAjustado('deducoes'), 'menor_melhor', null, true);

    // ── Comerciais ──
    const concentracao = ind('concentracao', 'Concentração de cliente', '%',
      D.concentracao_pct, benchInd.concentracao_max, 'menor_melhor');
    const recorrencia = ind('recorrencia', 'Recorrência da receita', '%',
      D.recorrencia_pct, benchInd.recorrencia_tipica, 'maior_melhor');
    const num_clientes = ind('num_clientes', 'Clientes ativos', 'unid',
      n(D.clientes), null, 'maior_melhor');
    const numClientes = n(D.clientes);
    const ticketVal = numClientes > 0 ? fat / numClientes : 0;
    const ticket_medio = ind('ticket_medio', 'Ticket médio', 'R$',
      ticketVal, null, 'maior_melhor');

    // ── Capital de giro ──
    const pmr_dias = ind('pmr_dias', 'PMR (prazo médio recebimento)', 'dias',
      n(D.pmr), benchInd.pmr, 'menor_melhor');
    const pmp_dias = ind('pmp_dias', 'PMP (prazo médio pagamento)', 'dias',
      n(D.pmp), benchInd.pmp, 'maior_melhor');
    const ciclo_financeiro_dias = ind('ciclo_financeiro_dias', 'Ciclo financeiro', 'dias',
      n(balanco && balanco.ciclo_financeiro && balanco.ciclo_financeiro.ciclo_dias),
      null, 'menor_melhor');
    const ncgVal = n(balanco && balanco.ncg && balanco.ncg.valor);
    const ncg_valor = ind('ncg_valor', 'Necessidade de capital de giro (NCG)', 'R$',
      ncgVal, null, 'menor_melhor');

    // ── Produtividade ──
    const numFuncs = n(D.clt_qtd) + n(D.pj_qtd);
    const roPorFunc = numFuncs > 0 ? n(dre.ro_mensal) / numFuncs : 0;
    const ro_por_funcionario_mensal = ind('ro_por_funcionario_mensal', 'RO por funcionário (mensal)', 'R$',
      roPorFunc, null, 'maior_melhor');

    // ── Endividamento (S2.4 — saldo devedor sobre RO anual) ──
    // Regra customizada: <100% no_alvo · 100-200% atencao · >200% abaixo.
    // Não usa o helper ind() porque os thresholds 100/200 diferem do padrão menor_melhor (100/110).
    const saldoDevedorEnd = n(balanco && balanco.passivos && balanco.passivos.saldo_devedor_emprestimos);
    const roAnualEnd = n(dre.ro_anual);
    const endividamentoVal = roAnualEnd > 0 ? (saldoDevedorEnd / roAnualEnd) * 100 : 0;
    const endividamento_vs_ro = {
      id: 'endividamento_vs_ro',
      label: 'Endividamento vs RO Anual',
      valor: round2(endividamentoVal),
      unidade: '%',
      benchmark: 100,
      delta_pp: round2(endividamentoVal - 100),
      status: endividamentoVal < 100 ? 'no_alvo' : endividamentoVal < 200 ? 'atencao' : 'abaixo',
      sentido: 'menor_melhor',
      regra_aplicada: '<100% → no_alvo · 100-200% → atencao · >200% → abaixo',
      observacao: roAnualEnd <= 0 ? 'RO anual ≤ 0: indicador não aplicável' : null,
    };

    return {
      margem_operacional, margem_bruta, margem_liquida,
      cmv_pct, folha_pct, aluguel_pct, mkt_pct, outros_cf_pct, deducoes_pct,
      concentracao, recorrencia, num_clientes, ticket_medio,
      pmr_dias, pmp_dias, ciclo_financeiro_dias, ncg_valor,
      ro_por_funcionario_mensal,
      endividamento_vs_ro,
    };
  }

  // ============================================================
  // calcICDv2 — Índice de Completude do Diagnóstico
  // Lê D._origem_campos (populado por mapDadosV2) e classifica os 22
  // campos canônicos em respondidos / nao_respondidos / benchmarks.
  // Críticos sobem ao topo dos não-respondidos.
  // ============================================================

  function calcICDv2(D, P) {
    const CAMPOS_ICD = [
      { id: 'fat_mensal',          label: 'Faturamento mensal',         critico: true },
      { id: 'cmv_mensal',          label: 'CMV / Custo direto',         critico: false },
      { id: 'clt_folha',           label: 'Folha CLT',                  critico: true },
      { id: 'pj_custo',            label: 'Custos PJ',                  critico: false },
      { id: 'aluguel',             label: 'Aluguel',                    critico: false },
      { id: 'caixa',               label: 'Caixa',                      critico: false },
      { id: 'contas_receber',      label: 'Contas a receber',           critico: false },
      { id: 'estoque',             label: 'Estoque',                    critico: false },
      { id: 'equipamentos',        label: 'Equipamentos',               critico: false },
      { id: 'imovel',              label: 'Imóvel',                     critico: false },
      { id: 'fornec_a_vencer',     label: 'Fornecedores a vencer',      critico: false },
      { id: 'saldo_devedor',       label: 'Empréstimos',                critico: false },
      { id: 'recorrencia_pct',     label: 'Recorrência da receita',     critico: false },
      { id: 'concentracao_pct',    label: 'Concentração de cliente',    critico: false },
      { id: 'processos',           label: 'Processos documentados',     critico: false },
      { id: 'tem_gestor',          label: 'Tem gestor',                 critico: false },
      { id: 'opera_sem_dono',      label: 'Opera sem o dono',           critico: false },
      { id: 'passivo_trabalhista', label: 'Passivo trabalhista',        critico: true },
      { id: 'impostos_dia',        label: 'Impostos em dia',            critico: true },
      { id: 'marca_inpi',          label: 'Marca registrada INPI',      critico: false },
      { id: 'reputacao_online',    label: 'Reputação online',           critico: false },
    ];

    const origens = D._origem_campos || {};
    const respondidos = [];
    const nao_respondidos = [];
    const benchmarks = [];

    CAMPOS_ICD.forEach(c => {
      const o = origens[c.id];
      if (o === 'informado' || o === 'informado_zero' || o === 'calculado') respondidos.push(c);
      else if (o === 'usou_benchmark') benchmarks.push(c);
      else nao_respondidos.push(c);
    });

    nao_respondidos.sort((a, b) => (b.critico ? 1 : 0) - (a.critico ? 1 : 0));

    const total = CAMPOS_ICD.length;
    const pct = total > 0 ? Math.round((respondidos.length / total) * 100) : 0;

    return { pct, total, respondidos, nao_respondidos, benchmarks };
  }

  // ============================================================
  // gerarUpsidesV2 — upsides em 5 categorias (Etapa 2.9)
  // ============================================================

  // ============================================================
  // lerCaminho(path, ctx) — utilitário dot-walk
  // Resolve "balanco.passivos.fornecedores_atrasados" no contexto.
  // Retorna null se qualquer trecho do caminho for null/undefined.
  // ============================================================
  function lerCaminho(path, ctx) {
    if (typeof path !== 'string' || !path) return null;
    return path.split('.').reduce((o, k) => (o == null ? null : o[k]), ctx);
  }

  // ============================================================
  // agregarPotencial12mV2 — agregação determinística do potencial 12m
  // (Fase 3.2.5 — substitui calcPotencial12mV2 antigo)
  //
  // Lê:
  //   - upsides_ativos (do catálogo, já filtrados pelo gate)
  //   - ise, valuation, dre, balanco, analise_tributaria
  //   - P (snapshot v2026.05+ com caps_categoria, caps_ise, cap_absoluto, etc)
  //
  // Calcula contribuicao_brl por upside conforme formula_calculo.tipo,
  // aplica caps por categoria → cap ISE (sobre alavancas) → cap absoluto.
  // Tributário entra direto na soma final SEM caps.
  //
  // RIGOR DE PONTO FLUTUANTE:
  //   - cálculos intermediários em float pleno (sem round prematuro)
  //   - Math.round APENAS em campos *_brl da saída final
  //   - campos *_pct mantêm float pleno (auditabilidade)
  //
  // Saída:
  //   { potencial_12m: {...}, recomendacoes_pre_venda: [...] }
  // ============================================================
  function agregarPotencial12mV2(upsidesAtivos, ise, valuation, dre, balanco, analise_tributaria, P, setor) {
    const valor_venda    = n(valuation && valuation.valor_venda);
    const valor_operacao = n(valuation && valuation.valor_operacao);
    const ro_anual       = n(valuation && valuation.ro_anual) || n(dre && dre.ro_anual);
    const fat_anual      = n(dre && dre.fat_anual);
    const folha_mensal   = n(dre && dre.pessoal && dre.pessoal.folha_total_mensal);
    const multiplo_setor = n((P && P.multiplos_setor || {})[setor]);
    const ise_score      = n(ise && ise.ise_total);
    const ise_int        = Math.round(ise_score);
    const economia_trib_brl = n(analise_tributaria
      && analise_tributaria.economia_potencial
      && analise_tributaria.economia_potencial.economia_anual);

    // Fail-closed se valor_venda inválido (ex: RO≤0 e PL≤0)
    if (valor_venda <= 0) {
      return {
        potencial_12m: {
          _versao: 'v2.1',
          _motivo: 'valor_venda_invalido_ou_zero',
          upsides_ativos: [],
          agregacao: null,
          potencial_final: { pct: 0, brl: 0, valor_projetado_brl: Math.round(valor_venda) },
          ordenacao_exibicao: [],
        },
        recomendacoes_pre_venda: [],
      };
    }

    // Contexto pra resolver fórmulas e gates
    const ctx = { D: null, dre, balanco, ise, indicadores: null, valuation, analise_tributaria, P, setor };

    // ── PASSO 1 — Calcular contribuição bruta por upside ────────────────
    function resolverBaseAnual(baseLabel) {
      switch (baseLabel) {
        case 'fat_anual': return fat_anual;
        case 'ro_anual':  return ro_anual;
        case 'custos_fixos_nao_ocupacao_total_anual': {
          const oc = n(dre && dre.operacional_outros && dre.operacional_outros.outros_cf);
          const sis = n(dre && dre.operacional_outros && dre.operacional_outros.sistemas);
          return (oc + sis) * 12;
        }
        case 'gap_margem_op': {
          const bench_pct = n((P.benchmarks_dre[setor] || {}).margem_op);
          const atual_pct = n(dre && dre.margem_operacional_pct);
          const gap_pct = Math.max(0, bench_pct - atual_pct);
          return (gap_pct / 100) * fat_anual;
        }
        case 'gap_folha_pct': {
          const bench_pct = n((P.benchmarks_dre[setor] || {}).folha);
          const atual_pct = n(dre && dre.pessoal && dre.pessoal.folha_total_mensal && fat_anual > 0
            ? (dre.pessoal.folha_total_mensal * 12 / fat_anual) * 100
            : 0);
          const excedente_pct = Math.max(0, atual_pct - bench_pct);
          return (excedente_pct / 100) * fat_anual;
        }
        case 'saldo_devedor_emprestimos':
          return n(balanco && balanco.passivos && balanco.passivos.saldo_devedor_emprestimos);
        case 'folha_mensal':
          return folha_mensal;
        default:
          return 0;
      }
    }

    function calcularContribuicaoBruta(u) {
      const tipo = u.formula_calculo && u.formula_calculo.tipo;
      const params = (u.formula_calculo && u.formula_calculo.parametros) || {};
      switch (tipo) {
        case 'ro_direto': {
          const base = resolverBaseAnual(params.base);
          const pct = n(params.economia_estimada_pct != null ? params.economia_estimada_pct : params.recuperacao_pct_gap);
          return base * pct * multiplo_setor; // float pleno
        }
        case 'ro_via_margem': {
          const base = resolverBaseAnual(params.base);
          const pct = n(params.recuperacao_pct_gap != null ? params.recuperacao_pct_gap : params.recuperacao_pct_fat);
          return base * pct * multiplo_setor;
        }
        case 'multiplo_aumento': {
          const bonus = n(params.bonus_multiplo);
          return bonus * ro_anual;
        }
        case 'passivo_direto': {
          const passivo = n(lerCaminho(params.fonte_passivo, ctx));
          return passivo; // 1:1
        }
        case 'passivo_estimado': {
          // UP-08: reestruturar dívidas (saldo × red_passivo + saldo × juros × multiplo)
          // UP-09: passivo trabalhista (folha_mensal × meses)
          if (params.reducao_passivo_pct != null || params.juros_economizados_anual_pct != null) {
            const saldo = resolverBaseAnual(params.base || 'saldo_devedor_emprestimos');
            const red = n(params.reducao_passivo_pct);
            const juros = n(params.juros_economizados_anual_pct);
            return (saldo * red) + (saldo * juros * multiplo_setor);
          }
          if (params.meses_estimados_folha != null) {
            const meses = n(params.meses_estimados_folha);
            return folha_mensal * meses;
          }
          return 0;
        }
        case 'tributario_calculado':
          return economia_trib_brl;
        case 'qualitativo_sem_calculo':
        case 'paywall_display':
          return null; // sentinel — não soma
        default:
          return 0;
      }
    }

    // Processa cada upside. Float pleno: contrib_brl é float; contrib_pct
    // é divisão direta brl_float / valor_venda_float (sem usar round).
    const upsides_processados = (upsidesAtivos || []).map(u => {
      const contrib_brl = calcularContribuicaoBruta(u);
      const contrib_pct = (contrib_brl != null && valor_venda > 0)
        ? contrib_brl / valor_venda
        : null;
      return {
        ref: u,
        contrib_brl, // float ou null (qualitativo/paywall)
        contrib_pct,
      };
    });

    // ── PASSO 2 — Agrupar por categoria (tributário fora dos caps) ──────
    const grupos = { ro: [], passivo: [], multiplo: [] };
    const qualitativos = [];
    let tributario = { brl: 0, pct: 0, ref: null };

    upsides_processados.forEach(p => {
      const cat = p.ref && p.ref.categoria;
      if (cat === 'tributario') {
        tributario = {
          brl: p.contrib_brl != null ? p.contrib_brl : 0,
          pct: p.contrib_pct != null ? p.contrib_pct : 0,
          ref: p.ref,
        };
      } else if (cat === 'ro' || cat === 'passivo' || cat === 'multiplo') {
        grupos[cat].push(p);
      } else if (cat === 'qualitativo') {
        qualitativos.push(p);
      }
      // paywall: ignora aqui (não chega via upsidesAtivos)
    });

    // ── PASSO 3 — Cap por categoria (proporcional dentro do grupo) ──────
    const por_categoria = {};
    const contrib_pos_cap_pct = new Map(); // upside_id → pct pós-cap

    ['ro', 'passivo', 'multiplo'].forEach(cat => {
      const itens = grupos[cat];
      const bruto_pct = itens.reduce((s, p) => s + (p.contrib_pct || 0), 0); // float
      const cap = n((P.caps_categoria || {})[cat]);
      const cap_aplicado = (bruto_pct > cap);
      const capped_pct = cap_aplicado ? cap : bruto_pct;

      // Distribuição proporcional do capped entre os upsides do grupo
      const fator = bruto_pct > 0 ? (capped_pct / bruto_pct) : 0;
      itens.forEach(p => {
        contrib_pos_cap_pct.set(p.ref.id, (p.contrib_pct || 0) * fator);
      });

      por_categoria[cat] = { bruto_pct, cap_aplicado, capped_pct };
    });

    // ── PASSO 4 — Soma alavancas pré-ISE ────────────────────────────────
    const potencial_alavancas_pre_ise_pct =
        por_categoria.ro.capped_pct
      + por_categoria.passivo.capped_pct
      + por_categoria.multiplo.capped_pct;

    // ── PASSO 5 — Cap ISE (Math.round antes do lookup pra evitar gaps) ──
    const faixas = (P.caps_ise || []);
    const faixa = faixas.find(f => ise_int >= n(f.ise_min) && ise_int <= n(f.ise_max));
    const cap_ise_aplicavel = faixa ? n(faixa.cap) : n(P.cap_absoluto);
    const cap_ise_aplicado = (potencial_alavancas_pre_ise_pct > cap_ise_aplicavel);
    const potencial_alavancas_pos_ise_pct = cap_ise_aplicado
      ? cap_ise_aplicavel
      : potencial_alavancas_pre_ise_pct;

    // ── PASSO 6 — Soma tributário + alavancas pós-ISE ───────────────────
    const potencial_total_bruto_pct = tributario.pct + potencial_alavancas_pos_ise_pct;

    // ── PASSO 7 — Cap absoluto (defesa final) ───────────────────────────
    const cap_abs = n(P.cap_absoluto);
    const cap_abs_aplicado = (potencial_total_bruto_pct > cap_abs);
    const potencial_pos_absoluto_pct = cap_abs_aplicado
      ? cap_abs
      : potencial_total_bruto_pct;

    // ── PASSO 8 — Flag tributario_dominante ─────────────────────────────
    const trib_threshold = n(P.tributario_dominante_threshold);
    const tributario_dominante = (potencial_pos_absoluto_pct > 0)
      && (tributario.pct / potencial_pos_absoluto_pct >= trib_threshold);

    // ── Saída final ─────────────────────────────────────────────────────
    // upsides_ativos: só os que somam (tributário + ro + passivo + multiplo).
    // Round APENAS em contribuicao_brl (output) — pcts em float pleno.
    //
    // Campos derivados por upside (S2.5 — Bug 2):
    //  - ganho_mensal_caixa_brl: caixa novo mensal (só categorias ro/passivo/tributario)
    //  - impacto_valuation_brl: incremento no valor de venda
    //      • multiplo:               igual a contribuicao_brl (já é incremento de valuation)
    //      • ro/passivo/tributario:  contribuicao_brl × fator_final (caixa × múltiplo)
    const fator_final_v = n(valuation && valuation.fator_final) || 1;
    const upsides_ativos_out = [];
    if (tributario.ref) {
      const contribTributario = Math.round(tributario.brl);
      upsides_ativos_out.push({
        id: tributario.ref.id,
        categoria: 'tributario',
        label: tributario.ref.label || null,
        descricao: tributario.ref.descricao || null,
        contribuicao_bruta_pct: tributario.pct,
        contribuicao_pos_cap_categoria_pct: tributario.pct, // tributário sem cap
        contribuicao_brl: contribTributario,
        ganho_mensal_caixa_brl: Math.round(contribTributario / 12),
        impacto_valuation_brl: Math.round(contribTributario * fator_final_v),
      });
    }
    ['ro', 'passivo', 'multiplo'].forEach(cat => {
      grupos[cat].forEach(p => {
        const pos_cap_pct = contrib_pos_cap_pct.get(p.ref.id) || 0;
        const contribBrl = Math.round(pos_cap_pct * valor_venda);
        const isMultiplo = cat === 'multiplo';
        upsides_ativos_out.push({
          id: p.ref.id,
          categoria: cat,
          label: p.ref.label || null,
          descricao: p.ref.descricao || null,
          contribuicao_bruta_pct: p.contrib_pct || 0,
          contribuicao_pos_cap_categoria_pct: pos_cap_pct,
          contribuicao_brl: contribBrl,
          ganho_mensal_caixa_brl: isMultiplo ? 0 : Math.round(contribBrl / 12),
          impacto_valuation_brl: isMultiplo ? contribBrl : Math.round(contribBrl * fator_final_v),
        });
      });
    });

    // Ganho anual de CAIXA (não-valuation): soma de upsides operacionais
    const ganho_anual_caixa_brl = upsides_ativos_out
      .filter(u => u.categoria === 'ro' || u.categoria === 'passivo' || u.categoria === 'tributario')
      .reduce((acc, u) => acc + n(u.contribuicao_brl), 0);

    const potencial_final_brl     = Math.round(potencial_pos_absoluto_pct * valor_venda);
    const valor_projetado_brl     = Math.round(valor_venda + (potencial_pos_absoluto_pct * valor_venda));

    // recomendacoes_pre_venda — campo "mensagem" mapeia de catalogo.descricao
    const recomendacoes_pre_venda = qualitativos.map(p => ({
      id: p.ref.id,
      label: p.ref.label || null,
      mensagem: p.ref.descricao || null,
    }));

    return {
      potencial_12m: {
        _versao: 'v2.1',
        upsides_ativos: upsides_ativos_out,
        agregacao: {
          tributario: {
            brl: Math.round(tributario.brl),
            pct: tributario.pct,
            sem_cap: true,
            fonte: 'analise_tributaria.economia_potencial.economia_anual',
          },
          por_categoria,
          potencial_alavancas_pre_ise_pct,
          cap_ise: {
            ise_score,
            ise_score_arredondado: ise_int,
            faixa: faixa ? (faixa.ise_min + '-' + faixa.ise_max) : 'fora_de_faixa_fallback_absoluto',
            cap_aplicavel: cap_ise_aplicavel,
            cap_aplicado: cap_ise_aplicado,
            potencial_pos_ise_pct: potencial_alavancas_pos_ise_pct,
          },
          cap_absoluto: {
            threshold: cap_abs,
            aplicado: cap_abs_aplicado,
            potencial_pos_absoluto_pct,
          },
          tributario_dominante,
        },
        potencial_final: {
          pct: potencial_pos_absoluto_pct,
          brl: potencial_final_brl,
          valor_projetado_brl,
        },
        ganho_anual_caixa_brl: ganho_anual_caixa_brl,
        ganho_mensal_caixa_brl: Math.round(ganho_anual_caixa_brl / 12),
        ordenacao_exibicao: [], // commit 5 implementa
      },
      recomendacoes_pre_venda,
    };
  }

  // ============================================================
  // gerarUpsidesV2 — refatorado pra consumir P.upsides_catalogo
  //
  // PRÉ-REQUISITO: parametros_versoes versão v2026.05+ com upsides_catalogo
  // Esta função consome P.upsides_catalogo. Snapshot v2026.04 ou anterior NÃO funciona.
  // Antes de promover este código para main, rodar a migração SQL 006 no Supabase.
  //
  // Cada entry do catálogo tem:
  //   { id, categoria, label, descricao, gate.expressao, formula_calculo, fonte_de_calculo }
  //
  // gate.expressao é uma string JS avaliada via `new Function` no escopo abaixo:
  //   D, dre, balanco, ise, indicadores, valuation, analise_tributaria, P, setor, n
  // Falha de avaliação (sintaxe / TypeError) é capturada → upside não dispara.
  //
  // Retorno separa entradas em dois arrays para evitar que paywalls vazem em
  // somatórios monetários (Fase 3.2.5):
  //   { ativos:   [...]  // upsides com gate verdadeiro (categorias: tributario|ro|passivo|multiplo|qualitativo)
  //     paywalls: [...]  // categoria === 'paywall' — sempre presentes, sem cálculo monetário
  //   }
  //
  // Cálculo de contribuicao_brl por upside é responsabilidade da função
  // agregarPotencial12mV2 (commit 3, ainda não implementada).
  // ============================================================
  function avaliarGateUpside(expressao, ctx) {
    // new Function é mais seguro que eval e dá contrato explícito sobre
    // o que está disponível no escopo do gate.
    const fn = new Function(
      'D', 'dre', 'balanco', 'ise', 'indicadores',
      'valuation', 'analise_tributaria', 'P', 'setor', 'n',
      'return (' + expressao + ');'
    );
    return Boolean(fn(
      ctx.D, ctx.dre, ctx.balanco, ctx.ise, ctx.indicadores,
      ctx.valuation, ctx.analise_tributaria, ctx.P, ctx.setor, ctx.n
    ));
  }

  function gerarUpsidesV2(D, dre, balanco, ise, valuation, indicadores, analise_tributaria, P) {
    // PRÉ-REQUISITO: parametros_versoes versão v2026.05+ com upsides_catalogo
    // Falha explícita se snapshot for v2026.04 ou anterior — fail-loud é mais
    // seguro do que rodar com fallback silencioso.
    if (!Array.isArray(P && P.upsides_catalogo)) {
      throw new Error(
        '[skill-v2] gerarUpsidesV2: parametros_versoes não tem upsides_catalogo. '
        + 'Snapshot esperado: v2026.05+. Rode a migração SQL 006 no Supabase antes de promover.'
      );
    }

    const setor = D.setor_code;
    const ctx = {
      D, dre, balanco, ise, indicadores,
      valuation, analise_tributaria, P, setor, n,
    };

    const ativos = [];
    const paywalls = [];

    P.upsides_catalogo.forEach(entry => {
      if (!entry || !entry.id || !entry.categoria) return; // entrada malformada — skip silencioso
      // paywall: sempre presente, sem avaliar gate (gate é "true" no snapshot)
      if (entry.categoria === 'paywall') {
        paywalls.push(entry);
        return;
      }
      // ativos: avaliar gate; falha → não ativa + warning (sem quebrar o laudo)
      let passa = false;
      try {
        const exp = entry.gate && entry.gate.expressao;
        if (typeof exp !== 'string' || exp.trim() === '') {
          console.warn('[skill-v2] upside', entry.id, 'sem gate.expressao — não ativa');
        } else {
          passa = avaliarGateUpside(exp, ctx);
        }
      } catch (e) {
        console.warn('[skill-v2] erro avaliando gate de', entry.id, '—', e && e.message);
        passa = false;
      }
      if (passa) ativos.push(entry);
    });

    return { ativos, paywalls };
  }


  // ============================================================
  // montarCalcJsonV2 — schema final (Spec Seção 3)
  // ============================================================

  function nomeRegime(regime) {
    const map = {
      mei: 'MEI',
      simples: 'Simples Nacional',
      simples_nacional: 'Simples Nacional',
      presumido: 'Lucro Presumido',
      lucro_presumido: 'Lucro Presumido',
      real: 'Lucro Real',
      lucro_real: 'Lucro Real',
    };
    return map[regime] || regime;
  }

  function montarCalcJsonV2(D, dre, balanco, ise, valuation, atratividade, operacional, icd, indicadores, analise_tributaria, upsides, P_versao_id) {
    return {
      _versao_calc_json: '2.0',
      _versao_parametros: P_versao_id,
      _data_avaliacao: hoje(),
      _skill_versao: '2.0.0-etapa2.9',

      identificacao: {
        id: D.id || null,
        codigo_diagnostico: D.codigo_diagnostico || D.codigo || null,
        slug: D.slug || null,
        nome: D.nome || null,
        nome_responsavel: D.nome_responsavel || null,
        tipo_negocio_breve: D.tipo_negocio_breve || null,
        setor: { code: D.setor_code, label: D.setor_label || D.setor_raw || D.setor_code },
        modelo_atuacao: {
          selecionados: D.modelo_atuacao_multi || D.modelo_multi || [],
          principal: D.modelo_atuacao_principal || D.modelo_code || null,
        },
        regime_tributario_declarado: {
          code: D.regime,
          label: nomeRegime(D.regime),
          anexo_simples: D.anexo,
          fator_r_calculado: analise_tributaria ? analise_tributaria.fator_r_calculado : null,
          observacao_fator_r: analise_tributaria ? analise_tributaria.fator_r_observacao : null,
        },
        localizacao: { cidade: D.cidade || null, estado: D.estado || null },
        tempo_operacao_anos: D.tempo_operacao_anos || D.anos || null,
        expectativa_valor_dono: D.expectativa_valor_dono || D.expectativa_val || null,
        pct_produto: D.pct_produto || 0,
      },

      inputs_origem: D._origem_campos || {},

      dre,
      balanco,
      ise,
      valuation,
      atratividade,
      operacional: operacional || {},
      icd: icd || {},
      indicadores_vs_benchmark: indicadores || {},
      analise_tributaria,
      upsides,

      textos_ia: {
        _gerados_em: null,
        _modelos_usados: null,
        status: 'pendente_geracao',
        texto_resumo_executivo_completo: { modelo: 'haiku', conteudo: null },
        texto_contexto_negocio: { modelo: 'haiku', conteudo: null },
        texto_parecer_tecnico: { modelo: 'sonnet', conteudo: null },
        texto_riscos_atencao: { modelo: 'sonnet', conteudo: null },
        texto_diferenciais: { modelo: 'haiku', conteudo: null },
        texto_publico_alvo_comprador: { modelo: 'sonnet', conteudo: null },
        descricoes_polidas_upsides: [],
      },

      textos_anuncio: {
        _gerados_em: null,
        _status: 'nao_gerado',
        texto_resumo_executivo_anonimo: {
          modelo: 'haiku', conteudo: null,
          _pendente_geracao: true, _aguarda: 'criacao_anuncio',
        },
        sugestoes_titulo_anuncio: {
          modelo: 'haiku', conteudo: [], _pendente_geracao: true,
        },
        texto_consideracoes_valor: {
          modelo: 'sonnet', conteudo: null,
          _pendente_geracao: true, _input_necessario: 'negocios.preco_pedido',
        },
      },
    };
  }

  // ============================================================
  // salvarCalcJsonV2 — persiste em laudos_v2 (Migration 003)
  // 1. Próxima versão = max(versao) + 1
  // 2. Marca laudos anteriores como ativo=false
  // 3. INSERT com ativo=true
  // ============================================================

  async function salvarCalcJsonV2(negocio_id, calcJson, parametros_versao_id) {
    const headers = {
      apikey: SUPABASE_ANON,
      Authorization: 'Bearer ' + SUPABASE_ANON,
      'Content-Type': 'application/json',
    };

    // 1. Buscar última versão do negocio
    let proxima_versao = 1;
    try {
      const urlMax = SUPABASE_URL + '/rest/v1/laudos_v2?negocio_id=eq.' + negocio_id
        + '&select=versao&order=versao.desc&limit=1';
      const resMax = await fetch(urlMax, { headers });
      if (resMax.ok) {
        const data = await resMax.json();
        if (data && data.length > 0) {
          proxima_versao = (n(data[0].versao) || 0) + 1;
        }
      }
    } catch (e) {
      console.warn('[skill-v2] Erro ao buscar versão atual:', e);
    }

    // 2. Desativar laudos anteriores ativos
    if (proxima_versao > 1) {
      try {
        const urlUpd = SUPABASE_URL + '/rest/v1/laudos_v2?negocio_id=eq.' + negocio_id + '&ativo=eq.true';
        await fetch(urlUpd, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ ativo: false }),
        });
      } catch (e) {
        console.warn('[skill-v2] Erro ao desativar laudos anteriores:', e);
      }
    }

    // 3. Inserir novo laudo
    const payload = {
      negocio_id,
      versao: proxima_versao,
      ativo: true,
      calc_json: calcJson,
      parametros_versao_id,
    };
    const resIns = await fetch(SUPABASE_URL + '/rest/v1/laudos_v2', {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    if (!resIns.ok) {
      const err = await resIns.text();
      throw new Error('Erro ao salvar laudo_v2: ' + resIns.status + ' ' + err);
    }
    const inserted = await resIns.json();
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return {
      id: row && row.id,
      versao: (row && row.versao) || proxima_versao,
      ativo: true,
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
    const analise_tributaria = calcAnaliseTributariaV2(D, dre, P);

    // Indicadores vs benchmark + ICD (substitui placeholders da Etapa 2.9)
    const indicadores = calcIndicadoresV2(D, dre, balanco, P);
    const icd = calcICDv2(D, P);

    // Operacional: APENAS dados crus (não derivados).
    // Indicadores derivados (ticket_medio, ro_por_funcionario, etc.) estão em
    // calcJson.indicadores_vs_benchmark. Mantém concentracao_status porque é
    // status (não valor) e é referência rápida no header da seção.
    const num_total = n(D.clt_qtd) + n(D.pj_qtd);
    const operacional = {
      num_funcionarios: num_total,
      num_clientes: n(D.clientes) || null,
      tempo_operacao_anos: n(D.anos) || null,
      fat_mensal: n(dre.fat_mensal),
      fat_anual: n(dre.fat_anual),
      num_socios: n(D.num_socios) || 1,
      prolabore_mensal_total: n(D.prolabore),
      concentracao_status: indicadores.concentracao && indicadores.concentracao.status,
    };

    // gerarUpsidesV2 retorna { ativos, paywalls } (Fase 3.2.5 — catálogo).
    const upsidesObj = gerarUpsidesV2(D, dre, balanco, ise, valuation, indicadores, analise_tributaria, P);

    // Potencial 12m — agregação determinística com 3 caps + tributário sem cap.
    // (Fase 3.2.6 — substitui calcPotencial12mV2 antigo, removido nesta versão.)
    const agregado = agregarPotencial12mV2(
      upsidesObj.ativos, ise, valuation, dre, balanco, analise_tributaria, P, D.setor_code
    );

    const calcJson = montarCalcJsonV2(
      D, dre, balanco, ise, valuation, atratividade,
      operacional, icd, indicadores, analise_tributaria, upsidesObj,
      _parametrosVersaoId
    );

    // Anexa potencial_12m e recomendacoes_pre_venda ao calc_json final.
    calcJson.potencial_12m = agregado.potencial_12m;
    calcJson.recomendacoes_pre_venda = agregado.recomendacoes_pre_venda;
    calcJson._modo = modo;

    if (modo === 'commit' && D.id) {
      try {
        const resultado_save = await salvarCalcJsonV2(D.id, calcJson, _parametrosVersaoId);
        calcJson._laudo_v2_id = resultado_save.id;
        calcJson._versao_laudo = resultado_save.versao;
      } catch (e) {
        console.error('[skill-v2] Erro ao persistir laudo:', e);
        calcJson._erro_persistencia = e.message;
      }
    }

    return calcJson;
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
    _calcAnaliseTributaria: calcAnaliseTributariaV2,
    _calcImpostoCompleto: calcImpostoCompleto,
    _determinarRegimeMunicipalEstadual: determinarRegimeMunicipalEstadual,
    _determinarPresuncoesPresumido: determinarPresuncoesPresumido,
    _calcStatusIndicador: calcStatusIndicador,
    _calcIndicadores: calcIndicadoresV2,
    _calcICD: calcICDv2,
    _gerarUpsides: gerarUpsidesV2,
    _agregarPotencial12m: agregarPotencial12mV2,
    _lerCaminho: lerCaminho,
    _montarCalcJson: montarCalcJsonV2,
    _salvarCalcJson: salvarCalcJsonV2,
    _nomeRegime: nomeRegime,
  };

  console.log('[skill-v2] Carregada — versão', '2.0.0', '— pronta');
})();
