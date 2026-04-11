// =====================================================
// SKILL AVALIADORA — 1Negócio
// Versão 2.0 — Reescrita completa
// Fonte da verdade de todos os cálculos
// Salva calc_json em laudos_completos
// =====================================================

if(!window.AVALIADORA){ window.AVALIADORA = (() => {

  const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
  const H = { 'apikey': SB_KEY, 'Content-Type': 'application/json' };

  let P = null; // cache de parâmetros

  // ─── UTILS ───────────────────────────────────────
  const n  = v => (v !== undefined && v !== null && !isNaN(parseFloat(v))) ? parseFloat(v) : 0;
  const p1 = (...vs) => { for (const v of vs) { if (v !== undefined && v !== null && v !== '' && !isNaN(parseFloat(v)) && parseFloat(v) > 0) return parseFloat(v); } return 0; };
  const pct = (a, b) => b && b !== 0 ? (a / b * 100) : 0;
  const hoje = () => new Date().toLocaleDateString('pt-BR');
  const brl = v => {
    v = Math.round(n(v));
    if (Math.abs(v) >= 1e6) return 'R$ ' + (v/1e6).toFixed(1).replace('.',',') + 'M';
    if (Math.abs(v) >= 1e3) return 'R$ ' + (v/1e3).toFixed(0) + 'k';
    return 'R$ ' + v.toLocaleString('pt-BR');
  };

  // ─── 1. CARREGAR PARÂMETROS ──────────────────────
  async function carregarParametros() {
    if (P) return P;
    try {
      const r = await fetch(SB_URL + '/rest/v1/parametros_1n?select=id,valor', { headers: H });
      const data = await r.json();
      P = {};
      data.forEach(row => { P[row.id] = row.valor; });
      return P;
    } catch(e) {
      console.error('[AVALIADORA] Erro ao carregar parâmetros:', e);
      P = {};
      return P;
    }
  }

  // ─── 2. MAPEAR SETOR ─────────────────────────────
  function mapSetor(setor) {
    if (!setor) return 'servicos_locais';
    const s = setor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
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
      'servicos_empresas':'servicos_b2b','b2b':'servicos_b2b','consultoria':'servicos_b2b',
      'agencia':'servicos_b2b','tecnologia':'servicos_b2b','software':'servicos_b2b',
      'ti':'servicos_b2b','contabilidade':'servicos_b2b','advocacia':'servicos_b2b','saas':'servicos_b2b',
    };
    for (const k in mapa) { if (s.includes(k)) return mapa[k]; }
    return 'servicos_locais';
  }

  // ─── 3. MAPEAR MODELO (T04b multi-select) ────────
  function mapModelo(multi) {
    // multi = array de strings do modelo_atuacao_multi
    // Retorna o código principal (maior múltiplo entre os selecionados)
    const ordem = ['saas','assinatura','vende_governo','distribuicao','presta_servico','fabricacao','produz_revende','revenda'];
    if (!multi || !Array.isArray(multi) || multi.length === 0) return 'presta_servico';
    for (const m of ordem) {
      if (multi.includes(m)) return m;
    }
    return multi[0] || 'presta_servico';
  }

  // ─── 4. BENCHMARK DO SETOR ──────────────────────
  function getBench(setorCode) {
    const b = (P['benchmarks_dre'] || {})[setorCode];
    const def = { imp:10,tax:5,com:4,cmv:40,fol:25,alu:8,cf:8,ro:15,marg:10 };
    return b || (P['benchmarks_dre'] || {})['default'] || def;
  }

  function getBenchInd(setorCode) {
    const b = (P['benchmarks_indicadores'] || {})[setorCode];
    const def = { margem_bruta:50,margem_op:15,conc_max:15,folha_pct:28,aluguel_pct:8,pmr:15,pmp:30 };
    return b || (P['benchmarks_indicadores'] || {})['default'] || def;
  }

  // ─── 5. CALCULAR IMPOSTOS ────────────────────────
  function calcImpostos(fatMensal, regime, setorCode, fatAnual, roMensal) {
    const fat = fatMensal || 0;
    const fatAno = fatAnual || fat * 12;
    const ro = roMensal || 0;

    // Inferir anexo Simples pelo setor
    const anexoMap = {
      'alimentacao':'I','varejo':'I','industria':'II',
      'saude':'III','educacao':'III','beleza_estetica':'III',
      'bem_estar':'III','hospedagem':'III','logistica':'III',
      'construcao':'III','servicos_b2b':'III','servicos_locais':'III',
    };
    const anexo = anexoMap[setorCode] || 'III';

    if (regime === 'mei') {
      const fixoMensal = (setorCode === 'varejo' || setorCode === 'alimentacao' || setorCode === 'industria') ? 75.90 : 80.90;
      return { mensal: fixoMensal, pct: fat > 0 ? (fixoMensal/fat*100) : 0, regime: 'MEI', detalhes: 'Valor fixo mensal' };
    }

    if (regime === 'simples' || regime === 'simples_nacional') {
      const tabelas = {
        'I': [
          {ate:180000,  aliq:0.04,  ded:0},
          {ate:360000,  aliq:0.073, ded:5940},
          {ate:720000,  aliq:0.095, ded:13860},
          {ate:1800000, aliq:0.107, ded:22500},
          {ate:3600000, aliq:0.143, ded:87300},
          {ate:4800000, aliq:0.19,  ded:378000},
        ],
        'II': [
          {ate:180000,  aliq:0.045, ded:0},
          {ate:360000,  aliq:0.078, ded:5940},
          {ate:720000,  aliq:0.10,  ded:13860},
          {ate:1800000, aliq:0.112, ded:22500},
          {ate:3600000, aliq:0.147, ded:85500},
          {ate:4800000, aliq:0.30,  ded:720000},
        ],
        'III': [
          {ate:180000,  aliq:0.06,  ded:0},
          {ate:360000,  aliq:0.112, ded:9360},
          {ate:720000,  aliq:0.135, ded:17640},
          {ate:1800000, aliq:0.16,  ded:35640},
          {ate:3600000, aliq:0.21,  ded:125640},
          {ate:4800000, aliq:0.33,  ded:648000},
        ],
      };
      const tab = tabelas[anexo] || tabelas['III'];
      const faixa = tab.find(f => fatAno <= f.ate) || tab[tab.length-1];
      const aliqEfetiva = fatAno > 0 ? Math.max(0, (fatAno * faixa.aliq - faixa.ded) / fatAno) : faixa.aliq;
      return { mensal: fat * aliqEfetiva, pct: aliqEfetiva * 100, regime: 'Simples Nacional', anexo, detalhes: `Anexo ${anexo} — ${(aliqEfetiva*100).toFixed(1)}%` };
    }

    if (regime === 'lucro_presumido' || regime === 'presumido') {
      const tipoServico = !['varejo','alimentacao','industria'].includes(setorCode);
      // Camada 1: PIS + COFINS cumulativo sobre faturamento
      const pisCofins = fat * 0.0365;
      // Camada 2: IRPJ + CSLL sobre base presumida
      const basePresumida = tipoServico ? fat * 0.32 : fat * 0.08;
      // IRPJ: 15% + adicional de 10% sobre o que exceder R$ 20k/mês de base presumida
      const irpj = basePresumida * 0.15 + Math.max(0, basePresumida - 20000) * 0.10;
      // CSLL: 9% sobre base presumida
      const csll = basePresumida * 0.09;
      const total = pisCofins + irpj + csll;
      const pctTotal = fat > 0 ? (total / fat * 100) : 0;
      return {
        mensal: total, pct: pctTotal, regime: 'Lucro Presumido',
        detalhes: tipoServico
          ? `PIS/COFINS 3,65% + IRPJ/CSLL s/ base 32% (${pctTotal.toFixed(1)}% efetivo)`
          : `PIS/COFINS 3,65% + IRPJ/CSLL s/ base 8% (${pctTotal.toFixed(1)}% efetivo)`,
        decomposicao: { pisCofins, basePresumida, irpj, csll }
      };
    }

    if (regime === 'lucro_real') {
      // Camada 1: PIS + COFINS não-cumulativo sobre faturamento
      const pisCofins = fat * 0.0925;
      // Camada 2: IRPJ + CSLL sobre lucro (RO como proxy)
      // IRPJ: 15% + adicional de 10% sobre o que exceder R$ 20k/mês
      const irpj = ro > 0 ? (ro * 0.15 + Math.max(0, ro - 20000) * 0.10) : 0;
      // CSLL: 9% sobre lucro
      const csll = ro > 0 ? ro * 0.09 : 0;
      const total = pisCofins + irpj + csll;
      const pctTotal = fat > 0 ? (total / fat * 100) : 0;
      return {
        mensal: total, pct: pctTotal, regime: 'Lucro Real',
        detalhes: `PIS/COFINS 9,25% s/ fat + IRPJ 15%+10% + CSLL 9% s/ RO (${pctTotal.toFixed(1)}% efetivo)`,
        decomposicao: { pisCofins, irpj, csll, baseLucro: ro }
      };
    }

    // Fallback: Simples Anexo III
    const aliqFallback = 0.10;
    return { mensal: fat * aliqFallback, pct: aliqFallback * 100, regime: 'Simples Nacional', detalhes: 'Estimativa 10%' };
  }

  // ─── 6. CALCULAR ENCARGOS CLT ───────────────────
  function calcEncargosCLT(folhaBruta, regime) {
    if (!folhaBruta || folhaBruta <= 0) return { encargos: 0, provisoes: 0, total: 0 };
    let pctEncargos;
    if (regime === 'mei') {
      pctEncargos = 0.11; // FGTS 8% + INSS patronal 3%
    } else if (regime === 'simples' || regime === 'simples_nacional') {
      pctEncargos = 0.08; // apenas FGTS (INSS patronal isento no DAS)
    } else {
      pctEncargos = 0.358; // FGTS 8% + INSS 20% + RAT 2% + Terceiros 5,8%
    }
    const encargos = folhaBruta * pctEncargos;
    const provisoes = folhaBruta * 0.2314; // férias 11,11% + 1/3 férias 3,70% + 13º 8,33%
    return { encargos, provisoes, total: encargos + provisoes };
  }

  // ─── 7. MAPEAR DADOS (hierarquia de campos) ──────
  function mapDados(dados) {
    const d = dados.dados_json || dados;
    const fat = n(p1(d.fat_mensal, dados.fat_mensal, dados.faturamento_anual ? dados.faturamento_anual/12 : 0));
    const fatAnual = n(p1(d.fat_anual, dados.faturamento_anual, d.faturamento_anual, fat * 12));
    const regimeRaw = d.regime || d.regime_tributario || dados.regime_tributario || dados.regime || 'simples';
    const regimeNorm = regimeRaw.toLowerCase().replace(/ /g,'_').replace('simples_nacional','simples').replace('lucro_presumido','lucro_presumido').replace('lucro_real','lucro_real').replace('presumido','lucro_presumido').replace('real','lucro_real');
    const regime = regimeNorm;

    return {
      id: dados.id,
      codigo: d.codigo_diagnostico || dados.codigo_diagnostico || dados.slug || '',
      nome: dados.nome || d.nome_negocio || d.nome || 'Empresa',
      setor: dados.setor || d.setor || 'servicos_locais',
      cidade: dados.cidade || d.cidade || '',
      estado: dados.estado || d.estado || '',
      anos: n(p1(dados.anos_existencia, d.anos_existencia, d.cnpj_anos, dados.cnpj_anos)),
      regime,
      fat,
      fatAnual,

      // CUSTOS DE TRANSAÇÃO — individuais têm prioridade sobre total agrupado
      impostos_precalc: n(p1(d.impostos_mensal, d.imposto_calculado)),
      aliquota_precalc: n(d.aliquota_imposto),
      taxas: n(p1(d.custo_cartoes, d.custo_taxas_recebimento, d.custo_recebimento)),
      comissoes: n(d.custo_comissoes > 0 ? d.custo_comissoes : 0),
      antecipacao: n(p1(d.custo_antecipacao)),
      plataformas: n(p1(d.custo_plataformas)),

      // FRANQUIA — royalties e fundo (valor absoluto ou % fat)
      royalty: n(d.royalty_valor) > 0 ? n(d.royalty_valor)
        : n(d.royalty_pct) > 0 ? fat * n(d.royalty_pct) / 100 : 0,
      mkt_franq: n(d.mkt_franquia_valor) > 0 ? n(d.mkt_franquia_valor)
        : n(d.mkt_franquia_pct) > 0 ? fat * n(d.mkt_franquia_pct) / 100 : 0,

      // CMV — valor absoluto ou % fat
      // cmv_informado = true se o usuário preencheu (mesmo que zero)
      cmv: n(d.cmv_valor) > 0 ? n(d.cmv_valor)
        : n(d.cmv_pct) > 0 ? fat * n(d.cmv_pct) / 100 : 0,
      cmv_pct: n(d.cmv_pct),
      // Flag: usuário informou CMV explicitamente
      // cmv_fonte='servico_puro' = 100% serviço (zero intencional)
      // cmv_fonte='informado' ou 'informado_pct' = usuário preencheu
      // cmv_fonte='benchmark' ou undefined = não informado, estimamos
      cmv_informado: d.cmv_fonte === 'servico_puro' || d.cmv_fonte === 'informado' || d.cmv_fonte === 'informado_pct',

      // FOLHA — campos individuais
      clt_folha: n(p1(d.clt_folha, d.custo_pessoal)),
      clt_encargos: n(d.clt_encargos),
      clt_provisoes: n(d.clt_provisoes),
      folha_total: n(d.folha_total),
      pj_custo: n(p1(d.pj_custo)),

      // CUSTOS OPERACIONAIS
      aluguel: n(p1(d.aluguel, dados.aluguel)),
      // Flag: usuário informou aluguel explicitamente
      // aluguel_zero_confirmado = home office / digital (zero intencional)
      // local_tipo em ['home','digital'] = zero intencional
      aluguel_informado: !!(d.aluguel_zero_confirmado) || ['home','digital'].includes(d.local_tipo) || n(p1(d.aluguel, dados.aluguel)) > 0,
      // outros_custos_fixos inclui custo_utilities+custo_terceiros — usar campos individuais
      facilities: n(p1(d.facilities, d.custo_utilities)),
      terceirizados: n(p1(d.terceirizados, d.custo_terceiros)),
      sistemas: n(p1(d.custo_sistemas)),
      outros_cf: n(p1(d.custo_outros)),
      mkt: n(p1(d.mkt_valor)),

      // ABAIXO DO RO (não entram no valuation)
      prolabore: n(p1(d.prolabore, d.prolabore_calculado, dados.prolabore)),
      antecipacao_caixa: n(p1(d.custo_antecipacao)),
      parcelas: n(p1(d.parcelas_mensais, dados.parcelas_mensais)),
      investimentos: n(p1(d.investimentos_mensais)),

      // ATIVOS
      caixa: n(p1(d.at_caixa, d.caixa)),
      receber: n(p1(d.at_cr, d.contas_receber)),
      estoque: n(p1(d.at_estoque, d.estoque_valor, d.estoque)),
      equip: n(p1(d.at_equip, d.equipamentos)),
      imovel: n(p1(d.at_imovel, d.imovel)),
      ativo_franquia: n(p1(d.ativo_franquia, d.taxa_franquia_proporcional)),

      // PASSIVOS
      forn: n(p1(d.fornec_a_pagar, d.pv_forn, d.contas_pagar)),
      impostos_atrasados: n(p1(d.impostos_atrasados)),
      folha_pagar: n(p1(d.folha_pagar)),
      emprest: n(p1(d.saldo_devedor, d.emprestimos, dados.saldo_devedor)),

      // QUALITATIVO ISE
      processos: d.processos || 'parcial',
      dependencia: d.dependencia || 'parcial',
      marca_inpi: d.marca_inpi || 'nao',
      processos_juridicos: d.processos_juridicos === 'sim',
      recorrencia_pct: (() => {
        const rv = d.recorrencia_pct !== undefined ? d.recorrencia_pct : dados.recorrencia_pct;
        if (rv === 'nao' || rv === false || rv === 'false') return 0;
        if (rv === 'sim' || rv === true || rv === 'true') return 100;
        return n(rv);
      })(),
      concentracao_pct: n(p1(d.concentracao_pct, d.maior_cliente_pct)),
      crescimento: (() => {
        const c = d.crescimento || 'estavel';
        // Mapear variações do diagnóstico
        if (c === '10a20' || c === 'ate20' || c === 'mais20') return c;
        if (c === 'ate10') return 'ate10';
        if (c === 'caindo' || c === 'declinando') return 'caindo';
        return 'estavel';
      })(),

      // OPERACIONAL
      num_funcs: n(p1(dados.num_funcionarios, d.num_funcs, d.num_funcionarios, d.clt_qtd)),
      clt_qtd: n(p1(d.clt_qtd, dados.clt_qtd)),
      pj_qtd: n(p1(d.pj_qtd, dados.pj_qtd)),
      clientes: n(p1(d.cli_1m, d.clientes_ativos)),
      ticket: n(p1(d.ticket_medio)),

      // MODELO
      modelo_multi: d.modelo_atuacao_multi || [],

      // EXPECTATIVA
      expectativa_val: n(p1(d.expectativa_val, dados.expectativa_val)),
      descricao: dados.descricao || d.descricao_final || d.descricao || '',

      _raw: d,
    };
  }

  // ─── 8. CALCULAR DRE ────────────────────────────
  function calcDRE(D, setorCode) {
    const fat = D.fat;
    if (!fat) return {};
    const bench = getBench(setorCode);

    // IMPOSTOS — usar pré-calculado do diagnóstico se disponível
    let impostos;
    if (D.impostos_precalc > 0) {
      impostos = D.impostos_precalc;
    } else if (D.aliquota_precalc > 0) {
      impostos = fat * D.aliquota_precalc;
    } else {
      const imp = calcImpostos(fat, D.regime, setorCode, D.fatAnual, 0);
      impostos = imp.mensal;
    }

    // CMV — só estima se o usuário NÃO informou (null/undefined)
    // Se informou zero = serviço puro = respeitar o zero
    const cmv_inf = D.cmv_informado || D.cmv > 0;
    const cmv = cmv_inf ? D.cmv : Math.round(fat * bench.cmv / 100);

    // ENCARGOS CLT — recalcular se não vieram do diagnóstico
    const cltFolha = D.clt_folha;
    let encargos = D.clt_encargos;
    let provisoes = D.clt_provisoes;
    if (cltFolha > 0 && encargos === 0) {
      const enc = calcEncargosCLT(cltFolha, D.regime);
      encargos = enc.encargos;
      provisoes = enc.provisoes;
    }

    // FOLHA — usar informada ou estimativa por benchmark
    const folha_inf = D.folha_total > 0 || D.clt_folha > 0;
    const folha = folha_inf
      ? (D.folha_total > 0 ? D.folha_total : cltFolha + encargos + provisoes + D.pj_custo)
      : Math.round(fat * bench.fol / 100);

    // ALUGUEL — só estima se o usuário NÃO informou (null/undefined)  
    // Se informou zero = home office = respeitar o zero
    const aluguel_inf = D.aluguel_informado || D.aluguel > 0;
    const aluguel = aluguel_inf ? D.aluguel : Math.round(fat * bench.alu / 100);

    // OUTROS CUSTOS FIXOS — usar informado ou estimativa
    const cf_inf = D.outros_cf > 0 || D.facilities > 0 || D.terceirizados > 0;
    const facilities = D.facilities;
    const terceirizados = D.terceirizados;
    const outros_cf_inf = D.outros_cf > 0;
    const outros_cf = outros_cf_inf ? D.outros_cf : (cf_inf ? 0 : Math.round(fat * bench.cf / 100));

    // MARKETING — usar informado ou estimativa
    const mkt_inf = D.mkt > 0;
    const mkt = mkt_inf ? D.mkt : 0; // marketing não estimamos — muito variável

    // ROYALTIES E FUNDO — NUNCA estimar, só se informado
    const royalty = D.royalty;
    const mkt_franq = D.mkt_franq;

    // DRE
    const sistemas = D.sistemas || 0;
    const recLiq = fat - impostos - D.taxas - D.comissoes - royalty - mkt_franq;
    const lb = recLiq - cmv;
    const ro = lb - folha - aluguel - facilities - terceirizados - sistemas - outros_cf - mkt;

    // ABAIXO DO RO (informativo)
    const potencial = ro - D.prolabore - D.antecipacao_caixa - D.parcelas - D.investimentos;
    const antecipacao = D.antecipacao_caixa;

    // Mapa de campos estimados (para destaque visual nos laudos)
    const estimados = {
      cmv: !cmv_inf && cmv > 0,
      folha: !folha_inf && folha > 0,
      aluguel: !aluguel_inf && aluguel > 0,
      outros_cf: !cf_inf && !outros_cf_inf && outros_cf > 0,
    };

    return {
      fat, impostos, taxas: D.taxas, comissoes: D.comissoes,
      royalty, mkt_franq,
      recLiq, cmv, lb,
      clt_folha: folha_inf ? cltFolha : 0,
      encargos: folha_inf ? encargos : 0,
      provisoes: folha_inf ? provisoes : 0,
      pj_custo: D.pj_custo,
      folha, aluguel, facilities, terceirizados, sistemas, outros_cf, mkt,
      ro, prol: D.prolabore, antecipacao: D.antecipacao_caixa,
      parcelas: D.parcelas, investimentos: D.investimentos,
      potencial, margem_pct: fat > 0 ? pct(ro, fat) : 0,
      estimados,
    };
  }

  // ─── 9. CALCULAR BALANÇO ────────────────────────
  function calcBalanco(D) {
    const totAtiv = D.caixa + D.receber + D.estoque + D.equip + D.imovel + D.ativo_franquia;
    const totPass = D.forn + D.impostos_atrasados + D.folha_pagar + D.emprest;
    return {
      caixa: D.caixa, receber: D.receber, estoque: D.estoque,
      equip: D.equip, imovel: D.imovel, ativo_franquia: D.ativo_franquia,
      totAtiv, forn: D.forn, emprest: D.emprest, totPass, pl: totAtiv - totPass,
    };
  }

  // ─── 10. CALCULAR ISE ───────────────────────────
  function calcISE(D, dre, bal) {
    const fat = dre.fat;
    const ro = dre.ro;
    const roAnual = ro * 12;
    const regras = P['regras_ise'] || {};
    const pesos = P['pesos_ise'] || {};

    // P1 — Dependência (ISE penaliza dependência)
    const p1 = D.dependencia === 'total' ? 1 : D.dependencia === 'nenhuma' ? 8 : 5;

    // P2 — Comercial (calculado via recorrência)
    const rec = D.recorrencia_pct;
    const cli = D.clientes;
    const p2 = rec >= 80 ? 9 : rec >= 50 ? 8 : rec >= 30 ? 7 : rec >= 10 ? 6 : cli > 20 ? 5 : cli > 0 ? 4 : 5;

    // P3 — Financeiro (margem operacional)
    const marg = fat > 0 ? pct(ro, fat) : 0;
    const p3 = marg >= 25 ? 9 : marg >= 15 ? 7 : marg >= 8 ? 5 : 3;

    // P4 — Gestão / Processos
    const p4 = D.processos === 'documentados' ? 8 : D.processos === 'parcial' ? 5 : 2;

    // P5 — Marca
    const p5 = D.marca_inpi === 'sim' ? 8 : D.marca_inpi === 'processo' ? 6 : 4;

    // P6 — Balanço (PL vs RO anual)
    let p6;
    if (roAnual > 0) {
      p6 = bal.pl > roAnual*2 ? 10 : bal.pl > roAnual ? 8 : bal.pl > 0 ? 6 : bal.pl > -roAnual ? 4 : bal.pl > -roAnual*2 ? 2 : 0;
    } else { p6 = bal.pl > 0 ? 6 : 3; }

    // P7 — Dívida (parcelas vs RO anual)
    const dividaPct = roAnual > 0 ? (D.parcelas * 12 / roAnual * 100) : 0;
    const p7 = D.parcelas === 0 ? 10 : dividaPct < 10 ? 9 : dividaPct < 20 ? 7 : dividaPct < 35 ? 5 : dividaPct < 50 ? 3 : 1;

    // P8 — Risco Jurídico
    const p8 = D.processos_juridicos ? 3 : 8;

    // P9 — Concentração de clientes
    const conc = D.concentracao_pct > 0 ? D.concentracao_pct : 15;
    const p9 = conc <= 5 ? 10 : conc <= 15 ? 8 : conc <= 25 ? 6 : conc <= 40 ? 4 : conc <= 60 ? 2 : 0;

    // P10 — Escalabilidade / Recorrência
    const p10 = rec <= 0 ? 5 : rec <= 20 ? 6 : rec <= 40 ? 7 : rec <= 60 ? 8 : rec <= 80 ? 9 : 10;

    // Ponderação
    const pw = pesos;
    const total = Math.round((
      p1 * n(pw.p1_dependencia  || 0.09) +
      p2 * n(pw.p2_comercial    || 0.22) +
      p3 * n(pw.p3_financeiro   || 0.18) +
      p4 * n(pw.p4_gestao       || 0.15) +
      p5 * n(pw.p5_marca        || 0.05) +
      p6 * n(pw.p6_balanco      || 0.08) +
      p7 * n(pw.p7_divida       || 0.05) +
      p8 * n(pw.p8_risco        || 0.05) +
      p9 * n(pw.p9_concentracao || 0.08) +
      p10* n(pw.p10_escalabilidade||0.05)
    ) * 10);

    // Trava: 2+ pilares críticos (< 3) → limita a 40
    const criticos = [p1,p2,p3,p4,p6].filter(v => v < 3).length;
    const finalTotal = criticos >= 2 ? Math.min(total, 40) : Math.min(100, Math.max(0, total));

    const cls = finalTotal >= 85 ? 'Estruturado' : finalTotal >= 70 ? 'Sólido' : finalTotal >= 50 ? 'Operacional' : finalTotal >= 35 ? 'Dependente' : 'Embrionário';

    return { total: finalTotal, cls, dep:p1, com:p2, fin:p3, ges:p4, mar:p5, bal:p6, div:p7, ris:p8, conc:p9, esc:p10 };
  }

  // ─── 11. CALCULAR FATOR 1N ──────────────────────
  function calcFator(D, ise, setorCode) {
    const mb = P['multiplos_base'] || {};
    const ms = P['modificadores_setor'] || {};
    const fi = P['fator_ise'] || [];
    const lim = P['limites_globais'] || {};

    const modeloCode = mapModelo(D.modelo_multi);

    // Multi-select: modelo principal + ajuste dos adicionais (limitado -0.25 a +1.0)
    const ordemMult = ['saas','assinatura','vende_governo','distribuicao','presta_servico','fabricacao','produz_revende','revenda'];
    let ajusteMulti = 0;
    if (D.modelo_multi.length > 1) {
      const outros = D.modelo_multi.filter(m => m !== modeloCode);
      outros.forEach(m => {
        const diff = n(mb[m] || 2.5) - n(mb[modeloCode] || 2.5);
        ajusteMulti += diff * 0.3;
      });
      ajusteMulti = Math.max(-0.25, Math.min(1.0, ajusteMulti));
    }

    const multiploBase = n(mb[modeloCode] || mb['presta_servico'] || 1.61);
    const modificador = n(ms[setorCode] || 0);

    // Fator ISE
    let fatorIse = 1.0, iseNome = 'Operacional';
    if (fi.length > 0) {
      const f = fi.find(x => ise >= x.min && ise <= x.max);
      if (f) { fatorIse = n(f.fator); iseNome = f.nome; }
    } else {
      if (ise >= 85) { fatorIse = 1.30; iseNome = 'Estruturado'; }
      else if (ise >= 70) { fatorIse = 1.15; iseNome = 'Consolidado'; }
      else if (ise >= 50) { fatorIse = 1.00; iseNome = 'Operacional'; }
      else if (ise >= 35) { fatorIse = 0.85; iseNome = 'Dependente'; }
      else { fatorIse = 0.70; iseNome = 'Embrionário'; }
    }

    const fator = (multiploBase + modificador + ajusteMulti) * fatorIse;
    const fMin = n(lim.fator_min || 1.5);
    const fMax = n(lim.fator_max || 6.0);

    return {
      fator: Math.max(fMin, Math.min(fMax, fator)),
      modeloCode, setorCode, multiploBase, modificador, ajusteMulti,
      fatorIse, iseNome,
      mulRange: `${(multiploBase+modificador-0.5).toFixed(1)}–${(multiploBase+modificador+1.5).toFixed(1)}×`,
    };
  }

  // ─── 12. CALCULAR ATRATIVIDADE ──────────────────
  function calcAtratividade(D, dre, ise, setorCode) {
    const pa = P['pesos_atratividade'] || {};
    const ss = P['score_setor_atratividade'] || {};
    const benchInd = getBenchInd(setorCode);

    // P1 — ISE/Solidez
    const p1 = ise.total / 10;

    // P2 — Score do setor (5–8)
    const p2 = n(ss[setorCode] || ss['default'] || 6);

    // P3 — Recorrência
    const rec = D.recorrencia_pct;
    const p3 = rec <= 0 ? 5 : rec <= 20 ? 6 : rec <= 40 ? 7 : rec <= 60 ? 8 : rec <= 80 ? 9 : 10;

    // P4 — Independência (escala própria, diferente do ISE)
    const p4 = D.dependencia === 'total' ? 2 : D.dependencia === 'nenhuma' ? 9 : 5;

    // P5 — Crescimento histórico
    const crescMap = { 'mais20': 9, 'ate20': 7, '10a20': 7, 'ate10': 5, 'estavel': 4, 'caindo': 2 };
    const p5 = crescMap[D.crescimento] || 4;

    // P6 — Margem vs benchmark (por faixas)
    const margOp = dre.fat > 0 ? pct(dre.ro, dre.fat) : 0;
    const benchMarg = benchInd.margem_op || 15;
    const ratio = benchMarg > 0 ? margOp / benchMarg : 0;
    const p6 = ratio >= 2 ? 10 : ratio >= 1.5 ? 8 : ratio >= 1 ? 6 : ratio >= 0.7 ? 4 : 2;

    const score = Math.round((
      p1 * n(pa.p1_ise_solidez   || 0.17) +
      p2 * n(pa.p2_setor         || 0.17) +
      p3 * n(pa.p3_recorrencia   || 0.17) +
      p4 * n(pa.p4_independencia || 0.17) +
      p5 * n(pa.p5_crescimento   || 0.17) +
      p6 * n(pa.p6_margem        || 0.15)
    ) * 10) / 10;

    const lbl = score >= 8 ? 'Excelente' : score >= 6.5 ? 'Boa' : score >= 5 ? 'Moderada' : 'Baixa';

    return { score: score || 5, lbl, sol:p1, set:p2, rec:p3, ind:p4, cre:p5, mar:p6 };
  }

  // ─── 13. CALCULAR ICD ───────────────────────────
  function calcICD(D, dre) {
    const d = D._raw || {}; // dados_json já está mapeado em _raw

    // ── OBRIGATÓRIAS — sempre preenchidas (bloqueiam avanço no diagnóstico)
    // Contam como respondidas se presentes
    const obrigatorias = {
      fat_mensal:       D.fat > 0,
      regime:           !!D.regime,
      cmv:              D.cmv_pct > 0 || D.cmv > 0,
      meios:            !!(d.meios_selecionados && d.meios_selecionados.length > 0),
      dividas:          d.tem_dividas !== undefined && d.tem_dividas !== null,
    };

    // ── GESTÃO — sempre respondidas (pré-seleção default no diagnóstico)
    // Contam SEMPRE como respondidas — o usuário pode avançar com o default
    const gestao = {
      dependencia:      true, // default 'parcial'
      processos:        true, // default 'parcial'
      gestor_autonomo:  true, // default 'nao'
      erp:              true, // default 'nao'
      equipe_permanece: true, // default 'nao_sei'
      crescimento:      true, // default 'estavel'
    };

    // ── DESEJÁVEIS — penaliza se não preenchidas (usamos benchmark)
    const desejaveis = {
      folha_clt:       D.clt_folha > 0 || n(d.clt_folha) > 0,
      aluguel:         D.aluguel > 0,
      mkt:             n(d.mkt_valor) > 0,
      outros_cf:       n(d.custo_outros) > 0,
      prolabore:       D.prolabore > 0,
      recorrencia:     d.recorrencia_pct !== undefined && d.recorrencia_pct !== 'nao' && d.recorrencia_pct !== null,
      clientes:        D.clientes > 0 || n(d.cli_1m) > 0,
      concentracao:    d.concentracao_pct !== undefined && d.concentracao_pct !== null,
      marca:           d.marca_inpi !== undefined && d.marca_inpi !== null,
      anos:            n(d.anos_existencia) > 0 || n(D._raw && D._raw.anos_existencia) > 0,
    };

    const totalCampos = Object.keys(obrigatorias).length + Object.keys(gestao).length + Object.keys(desejaveis).length;
    const respondidos = [
      ...Object.keys(obrigatorias).filter(k => obrigatorias[k]),
      ...Object.keys(gestao).filter(k => gestao[k]),
      ...Object.keys(desejaveis).filter(k => desejaveis[k]),
    ];
    const naoRespondidos = [
      ...Object.keys(obrigatorias).filter(k => !obrigatorias[k]),
      ...Object.keys(desejaveis).filter(k => !desejaveis[k]),
    ];

    // Label amigável para exibição nos laudos
    const labelMap = {
      fat_mensal:'Faturamento mensal', regime:'Regime tributário',
      cmv:'CMV / Custo de produção', meios:'Meios de recebimento',
      dividas:'Situação de dívidas',
      dependencia:'Dependência do sócio', processos:'Processos documentados',
      gestor_autonomo:'Gestor autônomo', erp:'Sistema ERP',
      equipe_permanece:'Retenção da equipe', crescimento:'Crescimento histórico',
      folha_clt:'Folha CLT', aluguel:'Aluguel', mkt:'Marketing pago',
      outros_cf:'Outros custos fixos', prolabore:'Pró-labore',
      recorrencia:'Recorrência de receita', clientes:'Clientes ativos',
      concentracao:'Concentração de clientes', marca:'Marca INPI',
      anos:'Anos de operação',
    };

    return {
      pct: Math.round(respondidos.length / totalCampos * 100),
      respondidos: respondidos.map(k => labelMap[k] || k),
      nao_respondidos: naoRespondidos.map(k => labelMap[k] || k),
      total: totalCampos,
      total_respondidos: respondidos.length,
    };
  }

  // ─── 14. COMPARATIVO TRIBUTÁRIO ─────────────────
  function calcRegimes(D, dre, setorCode) {
    const fat = dre.fat;
    const fatAnual = D.fatAnual;
    const ro = dre.ro;
    const regimeAtual = D.regime;

    const resultados = [];

    // MEI
    if (fatAnual <= 81000) {
      const fixo = ['varejo','alimentacao','industria'].includes(setorCode) ? 75.90 : 80.90;
      resultados.push({ regime:'MEI', elegivel:true, imposto_mensal:fixo, pct:fat>0?fixo/fat*100:0 });
    } else {
      resultados.push({ regime:'MEI', elegivel:false, motivo:'Faturamento acima de R$ 81k/ano' });
    }

    // Simples Nacional
    if (fatAnual <= 4800000) {
      const imp = calcImpostos(fat, 'simples', setorCode, fatAnual, 0);
      resultados.push({ regime:'Simples Nacional', elegivel:true, imposto_mensal:imp.mensal, pct:imp.pct, detalhes:imp.detalhes });
    } else {
      resultados.push({ regime:'Simples Nacional', elegivel:false, motivo:'Faturamento acima de R$ 4,8M/ano' });
    }

    // Lucro Presumido — precisa do fat para base presumida (não precisa de RO)
    const impPresumido = calcImpostos(fat, 'lucro_presumido', setorCode, fatAnual, 0);
    resultados.push({ regime:'Lucro Presumido', elegivel:true, imposto_mensal:impPresumido.mensal, pct:impPresumido.pct, detalhes:impPresumido.detalhes });

    // Lucro Real — precisa do RO como proxy de lucro tributável
    const impReal = calcImpostos(fat, 'lucro_real', setorCode, fatAnual, ro);
    resultados.push({ regime:'Lucro Real', elegivel:true, imposto_mensal:impReal.mensal, pct:impReal.pct, detalhes:impReal.detalhes });

    // Identificar regime atual e regime ótimo
    const regimeNorm = (regimeAtual || '').replace(/_/g, ' ').toLowerCase();
    const atual = resultados.find(r => r.regime.toLowerCase().includes(regimeNorm)) || resultados.find(r=>r.elegivel);
    const elegiveis = resultados.filter(r => r.elegivel);
    const otimo = elegiveis.reduce((a,b) => a.imposto_mensal < b.imposto_mensal ? a : b);
    const impostoAtual = atual ? atual.imposto_mensal : 0;
    const economia = impostoAtual - otimo.imposto_mensal;

    return {
      regime_atual: regimeAtual,
      imposto_atual_mensal: Math.round(impostoAtual),
      imposto_atual_pct: atual ? Math.round(atual.pct * 10)/10 : 0,
      regimes: resultados,
      regime_otimo: otimo.regime,
      economia_mensal: Math.round(Math.max(0, economia)),
      economia_anual: Math.round(Math.max(0, economia) * 12),
      tem_oportunidade: economia > fat * 0.01,
    };
  }

  // ─── 15. GERAR UPSIDES ──────────────────────────
  function gerarUpsides(D, dre, ise, setorCode, regimes) {
    const fat = dre.fat;
    const bench = getBench(setorCode);
    const benchInd = getBenchInd(setorCode);
    if (!fat) return { ops: [], total: 0 };

    const ops = [];

    // ── 1. TRIBUTÁRIO — sempre primeiro se há oportunidade ──
    if (regimes && regimes.tem_oportunidade && regimes.economia_mensal > 0) {
      ops.push({
        titulo: 'Migrar para regime tributário mais eficiente',
        descricao: `Regime atual: ${regimes.regime_atual}. Migração para ${regimes.regime_otimo} pode reduzir a carga tributária em ${brl(regimes.economia_mensal)}/mês (${brl(regimes.economia_anual)}/ano). Validar com contador.`,
        ganho: regimes.economia_mensal,
        ganho_label: `+${brl(regimes.economia_mensal)}/mês`,
        tipo: 'tributario',
      });
    }

    // ── 2. CALCULADAS com impacto financeiro direto ──

    // CMV acima do benchmark
    const cmvPct = fat > 0 ? pct(dre.cmv, fat) : 0;
    if (cmvPct > bench.cmv + 3) {
      const ganho = Math.round(fat * (cmvPct - bench.cmv) / 100 * 0.4);
      if (ganho > 0) ops.push({
        titulo: 'Reduzir custo de produção para o benchmark setorial',
        descricao: `CMV atual em ${cmvPct.toFixed(0)}% do faturamento vs benchmark de ${bench.cmv}% para o setor. Renegociação de fornecedores ou ajuste de mix pode liberar resultado imediato.`,
        ganho,
        ganho_label: `+${brl(ganho)}/mês`,
        tipo: 'calculada',
      });
    }

    // Folha acima do benchmark
    const folhaPct = fat > 0 ? pct(dre.folha, fat) : 0;
    if (folhaPct > 0 && folhaPct > benchInd.folha_pct * 1.2) {
      const ganho = Math.round(fat * (folhaPct - benchInd.folha_pct) / 100 * 0.3);
      if (ganho > 0) ops.push({
        titulo: 'Otimizar estrutura de equipe',
        descricao: `Folha em ${folhaPct.toFixed(0)}% do faturamento vs benchmark de ${benchInd.folha_pct}%. Revisão de estrutura ou terceirização parcial pode liberar ${brl(ganho)}/mês sem impacto operacional.`,
        ganho,
        ganho_label: `+${brl(ganho)}/mês`,
        tipo: 'calculada',
      });
    }

    // Aluguel acima do benchmark
    const aluPct = fat > 0 ? pct(dre.aluguel, fat) : 0;
    if (dre.aluguel > 0 && aluPct > benchInd.aluguel_pct * 1.3) {
      const ganho = Math.round(fat * (aluPct - benchInd.aluguel_pct) / 100 * 0.5);
      if (ganho > 0) ops.push({
        titulo: 'Renegociar contrato de aluguel',
        descricao: `Aluguel em ${aluPct.toFixed(0)}% do faturamento vs benchmark de ${benchInd.aluguel_pct}%. Com histórico de operação, renegociação ou mudança de ponto pode liberar ${brl(ganho)}/mês.`,
        ganho,
        ganho_label: `+${brl(ganho)}/mês`,
        tipo: 'calculada',
      });
    }

    // Recorrência baixa — impacto direto no faturamento
    const rec = n(D.recorrencia_pct);
    if (rec < 30) {
      const potencial = Math.round(fat * 0.10);
      ops.push({
        titulo: 'Converter clientes avulsos em recorrentes',
        descricao: `Recorrência atual de ${rec}%. Estruturar planos mensais ou contratos fixos para 20% da base pode adicionar ${brl(potencial)}/mês de receita previsível e elevar o múltiplo do valuation.`,
        ganho: potencial,
        ganho_label: `+${brl(potencial)}/mês`,
        tipo: 'calculada',
      });
    }

    // Marketing abaixo do benchmark — oportunidade de crescimento
    const mktPct = fat > 0 ? pct(dre.mkt, fat) : 0;
    const mktBench = benchInd.mkt_pct || 3;
    if (mktPct < mktBench * 0.5 && fat > 50000) {
      const investimento = Math.round(fat * mktBench / 100);
      const retorno = Math.round(investimento * 3);
      ops.push({
        titulo: 'Estruturar canal de marketing digital',
        descricao: `Marketing atual em ${mktPct.toFixed(1)}% do faturamento vs benchmark de ${mktBench}%. Investindo ${brl(investimento)}/mês com ROI 3x típico do setor, potencial de +${brl(retorno)}/mês em receita adicional.`,
        ganho: retorno - investimento,
        ganho_label: `+${brl(retorno - investimento)}/mês líquido`,
        tipo: 'calculada',
      });
    }

    // ── 3. FIXAS POR SETOR com impacto financeiro calculável ──
    const fixasPorSetor = {
      alimentacao: [
        { titulo:'Expandir canal de delivery', descricao:'Estruturar delivery próprio ou ampliar parceria com iFood/Rappi. Canal de baixo custo fixo com alto potencial de escala.', ganho: Math.round(fat*0.10) },
        { titulo:'Criar menu executivo ou happy hour', descricao:'Operação em horários ociosos com equipe existente. Incremento de receita sem custo fixo adicional.', ganho: Math.round(fat*0.06) },
        { titulo:'Eventos privados e locação do espaço', descricao:'Jantares corporativos e celebrações em dias de menor movimento. Receita complementar com margem elevada.', ganho: Math.round(fat*0.05) },
      ],
      saude: [
        { titulo:'Estruturar pacotes e planos de procedimentos', descricao:'Planos com pagamento recorrente aumentam previsibilidade e reduzem ociosidade da agenda.', ganho: Math.round(fat*0.12) },
        { titulo:'Expandir horário de atendimento', descricao:'Turnos adicionais com equipe existente. Aumento de capacidade sem custo fixo relevante.', ganho: Math.round(fat*0.08) },
        { titulo:'Telemedicina e atendimento remoto', descricao:'Canal digital com custo marginal baixo e alcance ampliado.', ganho: Math.round(fat*0.06) },
      ],
      beleza_estetica: [
        { titulo:'Criar pacotes mensais de procedimentos', descricao:'Planos fixos mensais aumentam recorrência e previsibilidade de caixa.', ganho: Math.round(fat*0.10) },
        { titulo:'Ampliar linha de produtos para revenda', descricao:'Receita adicional com alta margem no próprio ponto de atendimento.', ganho: Math.round(fat*0.07) },
      ],
      educacao: [
        { titulo:'Criar turmas online ou híbridas', descricao:'Escala sem crescimento proporcional de custos fixos. Alcance geográfico ampliado.', ganho: Math.round(fat*0.15) },
        { titulo:'Desenvolver material didático para licenciamento', descricao:'Receita passiva a partir de conteúdo já produzido.', ganho: Math.round(fat*0.08) },
      ],
      default: [
        { titulo:'Expandir base de clientes ativos', descricao:'Crescer 20% em clientes mantendo ticket médio atual via outreach estruturado.', ganho: Math.round(fat*0.08) },
        { titulo:'Estruturar funil de upsell para base atual', descricao:'Oferecer produtos ou serviços complementares à base existente. Crescimento de receita sem custo de aquisição.', ganho: Math.round(fat*0.07) },
        { titulo:'Criar programa de indicações com remuneração', descricao:'Canal de aquisição de baixo custo. Clientes indicados têm LTV 20-30% maior.', ganho: Math.round(fat*0.05) },
      ],
    };

    const fixas = [...(fixasPorSetor[setorCode] || []), ...fixasPorSetor.default];
    for (const f of fixas) {
      if (ops.length >= 10) break;
      if (!ops.some(o => o.titulo === f.titulo)) {
        ops.push({ ...f, ganho_label: `+${brl(f.ganho)}/mês`, tipo: 'fixa' });
      }
    }

    // Ordenar: tributário primeiro, depois por ganho financeiro decrescente
    ops.sort((a, b) => {
      if (a.tipo === 'tributario') return -1;
      if (b.tipo === 'tributario') return 1;
      return (b.ganho || 0) - (a.ganho || 0);
    });

    const top10 = ops.slice(0, 10);
    const total = top10.reduce((s, o) => s + (o.ganho || 0), 0);
    return { ops: top10, total };
  }

  // ─── 16. MONTAR calc_json ────────────────────────
  function montarCalcJson(dados, D, dre, bal, ise, fatorObj, atr, icd, upsides, regimes) {
    const setorCode = fatorObj.setorCode;
    const bench = getBench(setorCode);
    const benchInd = getBenchInd(setorCode);
    const numFuncs = D.clt_qtd + D.pj_qtd;
    const ticket = D.clientes > 0 ? dre.fat / D.clientes : D.ticket;
    const valorOp = dre.ro * 12 * fatorObj.fator;
    const valorVenda = valorOp + Math.max(0, bal.pl);

    const regimeTxt = {
      simples:'Simples Nacional', simples_nacional:'Simples Nacional',
      lucro_presumido:'Lucro Presumido', presumido:'Lucro Presumido',
      lucro_real:'Lucro Real', mei:'MEI',
    }[D.regime] || 'Simples Nacional';

    return {
      // ── Identidade
      id: D.id,
      nome: D.nome,
      setor: D.setor,
      setor_raw: D.setor,
      setor_code: setorCode,
      cidade: D.cidade,
      estado: D.estado,
      anos: D.anos,
      regime: regimeTxt,
      codigo: D.codigo,
      data_avaliacao: hoje(),
      modelo_atuacao_multi: D.modelo_multi,
      modelo_code: fatorObj.modeloCode,

      // ── DRE completa
      fat_mensal: dre.fat,
      dre_estimados: dre.estimados || {},
      impostos: dre.impostos,
      taxas: dre.taxas,
      comissoes: dre.comissoes,
      royalty: dre.royalty,
      mkt_franq: dre.mkt_franq,
      rec_liq: dre.recLiq,
      cmv: dre.cmv,
      lb: dre.lb,
      clt_folha: dre.clt_folha,
      clt_encargos: dre.encargos,
      clt_provisoes: dre.provisoes,
      pj_custo: dre.pj_custo,
      folha: dre.folha,
      aluguel: dre.aluguel,
      facilities: dre.facilities,
      terceirizados: dre.terceirizados,
      sistemas: dre.sistemas,
      cf: dre.outros_cf,
      mkt: dre.mkt,
      ro_mensal: dre.ro,
      ro_anual: dre.ro * 12,
      prol: dre.prol,
      antecipacao: dre.antecipacao,
      parcelas: dre.parcelas,
      investimentos: dre.investimentos,
      potencial_caixa: dre.potencial,
      margem_pct: dre.margem_pct,

      // ── Balanço
      caixa: bal.caixa,
      receber: bal.receber,
      estoque: bal.estoque,
      equip: bal.equip,
      imovel: bal.imovel,
      ativo_franquia: bal.ativo_franquia,
      totAtiv: bal.totAtiv,
      forn: bal.forn,
      emprest: bal.emprest,
      totPass: bal.totPass,
      pl: bal.pl,

      // ── ISE
      ise_total: ise.total,
      ise_class: ise.cls,
      ise_dep: ise.dep,
      ise_com: ise.com,
      ise_fin: ise.fin,
      ise_ges: ise.ges,
      ise_mar: ise.mar,
      ise_bal: ise.bal,
      ise_div: ise.div,
      ise_ris: ise.ris,
      ise_conc: ise.conc,
      ise_esc: ise.esc,

      // ── Valuation
      fator: fatorObj.fator,
      mul_base: fatorObj.multiploBase,
      mul_mod: fatorObj.modificador,
      mul_ise: fatorObj.fatorIse,
      mul_range: fatorObj.mulRange,
      mul_ise_nome: fatorObj.iseNome,
      valor_op: valorOp,
      valor_venda: valorVenda,

      // ── Atratividade
      atr_score: atr.score,
      atr_lbl: atr.lbl,
      atr_sol: atr.sol,
      atr_set: atr.set,
      atr_rec: atr.rec,
      atr_ind: atr.ind,
      atr_cre: atr.cre,
      atr_mar: atr.mar,

      // ── Operacional
      num_funcs: numFuncs,
      clientes: D.clientes,
      ticket,
      recorrencia: D.recorrencia_pct,
      concentracao: D.concentracao_pct,
      processos: D.processos,

      // ── ICD
      icd_pct: icd.pct,
      icd_respondidos: icd.respondidos,
      icd_nao_respondidos: icd.nao_respondidos,

      // ── Upsides
      ops: upsides.ops,
      total_ops: upsides.total,

      // ── Tributário
      analise_regimes: regimes,

      // ── Benchmarks (para os laudos usarem)
      bench_dre: bench,
      bench_ind: benchInd,

      // ── Extras
      expectativa_val: D.expectativa_val,
      descricao: D.descricao,
    };
  }

  // ─── 17. SALVAR NO BANCO ────────────────────────
  async function salvarCalcJson(negocioId, calcJson) {
    if (!negocioId || negocioId === 'DEMO') return;
    try {
      const payload = { slug: negocioId, calc_json: calcJson, atualizado_em: new Date().toISOString(), pago: false };

      // Tenta PATCH primeiro (atualiza se existe)
      const rPatch = await fetch(SB_URL + '/rest/v1/laudos_completos?slug=eq.' + negocioId, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ calc_json: calcJson, atualizado_em: new Date().toISOString() }),
      });

      if (rPatch.ok) {
        // Verifica se atualizou algum registro (PATCH retorna 204 mesmo sem match)
        const rCheck = await fetch(SB_URL + '/rest/v1/laudos_completos?slug=eq.' + negocioId + '&select=slug', { headers: H });
        const dataCheck = await rCheck.json();
        if (dataCheck && dataCheck.length > 0) {
          console.log('[AVALIADORA] calc_json atualizado (PATCH) para', negocioId);
          return;
        }
      }

      // Se não existe, cria com POST
      const rPost = await fetch(SB_URL + '/rest/v1/laudos_completos', {
        method: 'POST',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload),
      });
      if (rPost.ok) {
        console.log('[AVALIADORA] calc_json criado (POST) para', negocioId);
      } else {
        const err = await rPost.text();
        console.error('[AVALIADORA] Erro ao criar:', rPost.status, err);
      }
    } catch(e) {
      console.error('[AVALIADORA] Erro ao salvar:', e);
    }
  }

  // ─── 18. FUNÇÃO PRINCIPAL ───────────────────────
  async function avaliar(dadosBrutos) {
    await carregarParametros();

    const D = mapDados(dadosBrutos);
    const setorCode = mapSetor(D.setor);

    console.log('[AVALIADORA] Avaliando:', D.nome, '| setor:', setorCode, '| fat:', D.fat, '| regime:', D.regime);

    const dre     = calcDRE(D, setorCode);
    const bal     = calcBalanco(D);
    const ise     = calcISE(D, dre, bal);
    const fatorObj= calcFator(D, ise.total, setorCode);
    const atr     = calcAtratividade(D, dre, ise, setorCode);
    const icd     = calcICD(D, dre);
    const regimes = calcRegimes(D, dre, setorCode);
    const upsides = gerarUpsides(D, dre, ise, setorCode, regimes);

    const calcJson = montarCalcJson(dadosBrutos, D, dre, bal, ise, fatorObj, atr, icd, upsides, regimes);

    console.log('[AVALIADORA] Resultado:', {
      ise: ise.total, fator: fatorObj.fator,
      ro: dre.ro, valor: calcJson.valor_venda, atr: atr.score,
    });

    await salvarCalcJson(D.id, calcJson);
    return calcJson;
  }

  // ─── API PÚBLICA ────────────────────────────────
  return {
    avaliar,
    carregarParametros,
    _getParams: () => P || {},
    _mapSetor: mapSetor,
    _calcImpostos: calcImpostos,
  };

})(); }

// Auto-carrega parâmetros ao importar
(async () => {
  try {
    await window.AVALIADORA.carregarParametros();
    console.log('[AVALIADORA] Pronto.');
  } catch(e) {
    console.warn('[AVALIADORA] Pré-carregamento falhou:', e);
  }
})();
