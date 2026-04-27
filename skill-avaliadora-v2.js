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
    const anexoMap = {
      'alimentacao':'I','varejo':'I','industria':'II',
      'saude':'III','educacao':'III','beleza_estetica':'III',
      'bem_estar':'III','hospedagem':'III','logistica':'III',
      'construcao':'III','servicos_empresas':'III','servicos_locais':'III',
    };
    return anexoMap[setor_code] || 'III';
  }

  // ============================================================
  // HELPERS TRIBUTÁRIOS
  // (Decisão #14 — cálculo pela regra real; #17 — 3 bases por regime)
  // v2.3: simplificado. Implementação completa virá na Etapa 2.8.
  //
  // TODO Etapa 2.8 — pendências para análise tributária completa:
  //  A) Anexos IV e V do Simples Nacional + Fator R (folha/faturamento ≥ 28%
  //     migra do Anexo V para o III). Hoje só tratamos I, II e III.
  //  B) ISS municipal (~5% serviço) e ICMS estadual (~18% comércio/indústria)
  //     não estão sendo somados nos regimes Presumido/Real — apenas PIS/COFINS.
  //     No Simples já estão embutidos nas alíquotas, mas em Presumido/Real
  //     hoje subestimamos a carga tributária total.
  // ============================================================

  function calcImpostoSobreFaturamento(fat_anual, regime, anexo, P) {
    const fat_mensal = fat_anual / 12;

    if (regime === 'mei') {
      const fixoMensal = (anexo === 'I' || anexo === 'II') ? 75.90 : 80.90;
      return {
        mensal: fixoMensal,
        pct: fat_mensal > 0 ? (fixoMensal / fat_mensal) * 100 : 0,
        regime: 'MEI', anexo: null,
        detalhes: 'Valor fixo mensal',
      };
    }

    if (regime === 'simples') {
      // Tabelas oficiais 2025 — Anexos I, II, III
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
      };
      const tab = tabelas[anexo] || tabelas['III'];
      const faixa = tab.find(f => fat_anual <= f.ate) || tab[tab.length - 1];
      const aliq_efetiva = fat_anual > 0
        ? Math.max(0, (fat_anual * faixa.aliq - faixa.ded) / fat_anual)
        : faixa.aliq;
      return {
        mensal: fat_mensal * aliq_efetiva,
        pct: aliq_efetiva * 100,
        regime: 'Simples Nacional', anexo,
        detalhes: `Anexo ${anexo} — alíquota efetiva ${(aliq_efetiva*100).toFixed(2)}%`,
      };
    }

    if (regime === 'presumido') {
      // Apenas PIS/COFINS cumulativos sobre faturamento (placeholder v2.3).
      // IRPJ/CSLL ficam no Bloco 4 (calcImpostosSobreLucro).
      const pct = 3.65;
      return {
        mensal: fat_mensal * (pct / 100),
        pct,
        regime: 'Lucro Presumido', anexo: null,
        detalhes: 'PIS 0,65% + COFINS 3% (cumulativo). IRPJ/CSLL no Bloco 4.',
      };
    }

    if (regime === 'real') {
      // PIS/COFINS não-cumulativos sobre faturamento (placeholder v2.3 — sem créditos).
      // IRPJ/CSLL ficam no Bloco 4.
      const pct = 9.25;
      return {
        mensal: fat_mensal * (pct / 100),
        pct,
        regime: 'Lucro Real', anexo: null,
        detalhes: 'PIS 1,65% + COFINS 7,6% (não-cumulativo, sem créditos). IRPJ/CSLL no Bloco 4 sobre RO.',
      };
    }

    return {
      mensal: fat_mensal * 0.10,
      pct: 10,
      regime: 'Estimativa', anexo: 'III',
      detalhes: 'Fallback 10% — regime não reconhecido',
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
      // Anexos I/II/III: INSS patronal incluso no DAS — só FGTS
      // Outros anexos (IV, V): INSS patronal por fora
      if (anexo === 'I' || anexo === 'II' || anexo === 'III') {
        pct_total = fgts_pct;
      } else {
        pct_total = fgts_pct + inss_patronal_pct + rat_pct + terceiros_pct;
        inss = folha * (inss_patronal_pct / 100);
        rat = folha * (rat_pct / 100);
        terc = folha * (terceiros_pct / 100);
      }
    } else {
      // Presumido / Real
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
    const anexo = inferirAnexoSimples(setor_code);

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

    // ── Balanço ── ativos
    const caixa = tag('caixa', p1(d.at_caixa, d.caixa));
    const receber = tag('receber', p1(d.at_cr, d.contas_receber));
    const estoque = tag('estoque', p1(d.at_estoque, d.estoque_valor, d.estoque));
    const equip = tag('equip', p1(d.at_equip, d.equipamentos));
    const imovel = tag('imovel', p1(d.at_imovel, d.imovel));
    const ativo_franquia = tag('ativo_franquia', p1(d.ativo_franquia, d.taxa_franquia_proporcional));

    // ── Balanço ── passivos
    const forn = tag('forn', p1(d.fornec_a_pagar, d.pv_forn, d.contas_pagar));
    const impostos_atrasados = tag('impostos_atrasados', n(d.impostos_atrasados));
    const folha_pagar = tag('folha_pagar', n(d.folha_pagar));
    const emprest = tag('emprest', p1(d.saldo_devedor, d.emprestimos, dados.saldo_devedor));

    // ── Qualitativo ISE ──
    const processos = d.processos || 'parcial';
    const dependencia = d.dependencia || 'parcial';
    const marca_inpi = d.marca_inpi || 'nao';
    const processos_juridicos = d.processos_juridicos === 'sim';

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

      // Balanço
      caixa, receber, estoque, equip, imovel, ativo_franquia,
      forn, impostos_atrasados, folha_pagar, emprest,

      // Qualitativo
      processos, dependencia, marca_inpi, processos_juridicos,
      recorrencia_pct, concentracao_pct,

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
    const calcReal = calcImpostoSobreFaturamento(fat_anual, D.regime, D.anexo, P);
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
  // PIPELINE PRINCIPAL (esqueleto)
  // ============================================================

  async function avaliarV2(dadosBrutos, modo = 'preview') {
    if (!['preview', 'commit'].includes(modo)) {
      throw new Error(`Modo inválido: ${modo}. Use 'preview' ou 'commit'.`);
    }

    const P = await carregarParametrosV2();

    const D = mapDadosV2(dadosBrutos);
    const dre = calcDREv2(D, P);

    // TODO Fase 2.4+: calcBalancoV2, calcISEv2, calcValuationV2,
    // calcAtratividadeV2, calcAnaliseTributariaV2, gerarUpsidesV2,
    // montarCalcJsonV2, salvarCalcJsonV2 (modo='commit')

    return {
      _versao_calc_json: '2.0',
      _versao_parametros: _parametrosVersaoId,
      _data_avaliacao: hoje(),
      _skill_versao: '2.0.0-etapa2.3',
      _modo: modo,
      _status: 'parcial — mapDados + DRE implementados',
      D,
      dre,
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
    _calcImpostoSobreFaturamento: calcImpostoSobreFaturamento,
    _calcImpostosSobreLucro: calcImpostosSobreLucro,
    _calcEncargosCLT: calcEncargosCLT,
    _mapDados: mapDadosV2,
    _calcDRE: calcDREv2,
  };

  console.log('[skill-v2] Esqueleto carregado. Aguardando implementação dos cálculos.');
})();
