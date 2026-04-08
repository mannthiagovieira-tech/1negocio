// =====================================================
// SKILL AVALIADORA — 1Negócio
// Lê parâmetros de parametros_1n e calcula:
//   - DRE estruturada
//   - Balanço patrimonial
//   - ISE (10 pilares)
//   - Fator 1N
//   - Valor de venda
//   - Índice de Atratividade
//   - ICD
//   - Oportunidades (upsides)
// Salva resultado em laudos_completos.calc_json
// =====================================================

const AVALIADORA = (() => {

  const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
  const H = { 'apikey': SB_KEY, 'Content-Type': 'application/json' };

  // Cache dos parâmetros (carregado uma vez por sessão)
  let P = null;

  // ── UTILS ──
  const n = v => (v !== undefined && v !== null && !isNaN(parseFloat(v))) ? parseFloat(v) : 0;
  const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '') ?? 0;
  const pct = (a, b) => b && b !== 0 ? (a / b * 100) : 0;
  const hoje = () => new Date().toLocaleDateString('pt-BR');
  const brl = v => {
    v = Math.round(n(v));
    if (Math.abs(v) >= 1e6) return 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + 'M';
    if (Math.abs(v) >= 1e3) return 'R$ ' + Math.round(v / 1e3) + 'k';
    return 'R$ ' + v.toLocaleString('pt-BR');
  };

  // ── 1. CARREGAR PARÂMETROS ──
  async function carregarParametros() {
    if (P) return P;
    try {
      const r = await fetch(SB_URL + '/rest/v1/parametros_1n?select=id,valor', { headers: H });
      const data = await r.json();
      P = {};
      data.forEach(row => { P[row.id] = row.valor; });
      console.log('[AVALIADORA] Parâmetros carregados:', Object.keys(P));
      return P;
    } catch (e) {
      console.error('[AVALIADORA] Erro ao carregar parâmetros:', e);
      P = {};
      return P;
    }
  }

  // ── 2. MAPEAR SETOR ──
  function mapearSetor(setor) {
    if (!setor) return 'outros_servicos';
    const mapa = P['mapeamento_setor'] || {};
    const s = setor.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Busca exata
    if (mapa[s]) return mapa[s];
    // Busca parcial
    for (const k in mapa) {
      if (s.includes(k)) return mapa[k];
    }
    return 'outros_servicos';
  }

  // ── 3. MAPEAR MODELO ──
  function mapearModelo(modelo, setor, raw) {
    if (!modelo && !raw) return 'servico';
    const mapa = P['mapeamento_modelo'] || {};

    // Tenta campo direto
    const fonte = modelo || (raw && (raw.como_atua || raw.modelo_negocio || raw.modelo_atuacao)) || '';
    const m = fonte.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    if (mapa[m]) return mapa[m];
    for (const k in mapa) {
      if (m.includes(k)) return mapa[k];
    }

    // Inferir pelo setor
    const setorCode = mapearSetor(setor);
    if (setorCode === 'alimentacao') return 'producao_direta';
    if (setorCode === 'varejo') return 'revenda';
    if (setorCode === 'industria') return 'fabricacao';
    return 'servico';
  }

  // ── 4. BENCHMARK DO SETOR ──
  function getBench(setorCode) {
    const b = P['benchmarks_dre'] || {};
    return b[setorCode] || b['default'] || {
      imp: 10, tax: 5, com: 4, cmv: 40, fol: 25,
      alu: 8, cf: 8, ro: 15, marg: 10
    };
  }

  function getBenchInd(setorCode) {
    const b = P['benchmarks_indicadores'] || {};
    return b[setorCode] || b['default'] || {
      margem_bruta: 50, margem_op: 15, conc_max: 15,
      folha_pct: 28, aluguel_pct: 8, pmr: 15, pmp: 30
    };
  }

  // ── 5. MAPEAR DADOS (hierarquia) ──
  function mapearDados(dados) {
    const d = dados.dados_json || dados;

    return {
      id: dados.id,
      codigo: dados.codigo_diagnostico || d.codigo_diagnostico || '',
      nome: dados.nome || d.nome_negocio || d.nome || 'Empresa',
      setor: dados.setor || d.setor || 'N/D',
      cidade: dados.cidade || d.cidade || '',
      estado: dados.estado || d.estado || '',
      anos: n(pick(dados.anos_existencia, d.anos_existencia, d.anos_num)),
      regime: dados.regime_tributario || d.regime || d.regime_tributario || 'simples',

      // Faturamento
      fat_mensal: n(pick(d.fat_mensal, dados.faturamento_anual ? dados.faturamento_anual / 12 : null)),

      // CMV — respeitar zero (serviço puro)
      cmv_pct: n(pick(d.cmv_pct, dados.cmv_pct)),
      cmv_valor: n(pick(d.cmv_valor, d.cmv_mensal)),

      // Custos de transação
      custo_recebimento: n(pick(d.custo_recebimento, d.custo_taxas_recebimento, d.custo_cartoes)),
      custo_antecipacao: n(pick(d.custo_antecipacao)),
      custo_plataformas: n(pick(d.custo_plataformas)),
      // Comissões: usar valor absoluto se disponível, senão calcular pelo percentual
      // IMPORTANTE: comissao_pct já engloba royalties e fundo de propaganda em franquias
      // Não deduzir royalties separadamente para evitar dupla contagem
      custo_comissoes: n(
        d.custo_comissoes > 0 ? d.custo_comissoes :
        ((d.pct_comissao || d.comissao_pct || d.taxa_comissao) > 0
          ? (d.fat_mensal || dados.fat_mensal || 0) * (d.pct_comissao || d.comissao_pct || d.taxa_comissao) / 100
          : 0)
      ),

      // Franquia — royalties e fundo já estão embutidos no comissao_pct, zeramos aqui
      tem_royalty: d.franquia === 'sim' || dados.franquia === 'sim',
      royalty_valor: 0,
      mkt_franquia_valor: 0,

      // Folha
      clt_folha: n(pick(d.clt_folha)),
      clt_encargos: n(pick(d.clt_encargos)),
      clt_provisoes: n(pick(d.clt_provisoes)),
      pj_custo: n(pick(d.pj_custo)),
      folha_total: n(pick(d.folha_total)),

      // Custos operacionais
      aluguel: n(pick(d.aluguel, dados.aluguel)),
      facilities: n(pick(d.facilities, d.custo_utilities)),
      terceirizados: n(pick(d.terceirizados, d.custo_terceiros)),
      outros_cf: n(pick(d.outros_cf, d.outros_custos_fixos, d.cf_total, dados.outros_custos_fixos)),
      mkt_valor: n(pick(d.mkt_valor)),

      // Retiradas
      prolabore: n(pick(d.prolabore, d.prolabore_calculado, dados.prolabore)),
      parcelas_mensais: n(pick(d.parcelas_mensais, dados.parcelas_mensais)),

      // Formas de recebimento
      meios_selecionados: d.meios_selecionados || [],
      meios_pct: d.meios_pct || {},
      meios_taxa: d.meios_taxa || {},

      // Impostos já calculados
      impostos_mensal: n(pick(d.impostos_mensal, d.imposto_calculado)),
      aliquota_imposto: n(pick(d.aliquota_imposto, d.regime_aliquota)),

      // Ativos
      caixa: n(pick(d.at_caixa, d.caixa, dados.at_caixa)),
      receber: n(pick(d.at_cr, d.contas_receber, dados.at_cr)),
      estoque: n(pick(d.at_estoque, d.estoque_valor, d.estoque, dados.at_estoque)),
      equip: n(pick(d.at_equip, d.equipamentos, dados.at_equip)),
      imovel: n(pick(d.at_imovel, d.imovel, dados.at_imovel)),
      ativo_franquia: n(pick(d.ativo_franquia, d.taxa_franquia_proporcional)),

      // Passivos
      forn: n(pick(d.fornec_a_pagar, d.pv_forn, d.contas_pagar, dados.fornec_a_pagar)),
      impostos_atrasados: n(pick(d.impostos_atrasados, d.impostos_pagar)),
      folha_pagar: n(pick(d.folha_pagar)),
      emprest: n(pick(d.saldo_devedor, d.emprestimos, dados.saldo_devedor)),

      // Qualitativo ISE
      processos: d.processos || 'parcial',
      dependencia: d.dependencia || 'parcial',
      marca_inpi: d.marca_inpi || 'nao',
      processos_juridicos: d.processos_juridicos || 'nao',
      maior_cliente_pct: n(pick(d.concentracao_pct, d.maior_cliente_pct)),
      recorrencia_pct: n(pick(d.recorrencia_pct, d.pct_recorrencia)),
      comercial_vendas: n(pick(d.comercial_vendas, d.qualidade_vendas)) || 5,
      risco_juridico: n(pick(d.risco_juridico)) || 0,
      historico_crescimento: n(pick(d.historico_crescimento, d.crescimento_score)) || 5,

      // Operacional
      clt_qtd: n(pick(d.clt_qtd, dados.clt_qtd)),
      pj_qtd: n(pick(d.pj_qtd, dados.pj_qtd)),
      clientes_ativos: n(pick(d.cli_1m, d.clientes_ativos)),
      expectativa_val: n(pick(d.expectativa_val, dados.expectativa_val)),
      descricao: dados.descricao || d.descricao_final || d.descricao || '',

      // Modelo de atuação
      modelo_negocio: d.modelo_negocio || d.modelo_atuacao || '',
      modelo_atuacao_multi: d.modelo_atuacao_multi || [],

      // Pré-calculados pelo diagnóstico (se existirem)
      _precalc: {
        impostos: n(d.impostos_mensal),
        ro_mensal: n(pick(d.ro_mensal, d.ebitda_mensal)),
        total_ativos: n(d.total_ativos),
        total_passivos: n(d.total_passivos),
        patrimonio_liquido: n(d.patrimonio_liquido),
      },

      _raw: d
    };
  }

  // ── 6. CALCULAR DRE ──
  function calcDRE(D) {
    const fat = D.fat_mensal;
    if (!fat) return { fat: 0, impostos: 0, taxas: 0, comissoes: 0, royalty: 0, mkt_franq: 0, recLiq: 0, cmv: 0, lb: 0, folha: 0, aluguel: 0, facilities: 0, terceirizados: 0, cf: 0, mkt: 0, ro: 0, prolabore: 0, parcelas: 0, rf: 0 };

    // Impostos — usar pré-calculado ou alíquota
    const impostos = D._precalc.impostos > 0
      ? D._precalc.impostos
      : D.impostos_mensal > 0
        ? D.impostos_mensal
        : fat * (D.aliquota_imposto > 0 ? D.aliquota_imposto / 100 : 0.10);

    // Taxas de recebimento — usar valor absoluto do diagnóstico
    const taxas = D.custo_recebimento > 0 ? D.custo_recebimento : 0;
    const antecipacao = D.custo_antecipacao;
    const plataformas = D.custo_plataformas;
    const comissoes = D.custo_comissoes;
    const royalty = D.royalty_valor;
    const mkt_franq = D.mkt_franquia_valor;

    const recLiq = fat - impostos - taxas - antecipacao - plataformas - comissoes - royalty - mkt_franq;

    // CMV
    const cmv = D.cmv_valor > 0 ? D.cmv_valor : (D.cmv_pct > 0 ? fat * D.cmv_pct / 100 : 0);
    const lb = recLiq - cmv;

    // Folha — usar total já calculado pelo diagnóstico ou somar partes
    const folha = D.folha_total > 0
      ? D.folha_total
      : D.clt_folha + D.clt_encargos + D.clt_provisoes + D.pj_custo;

    const aluguel = D.aluguel;
    const facilities = D.facilities;
    const terceirizados = D.terceirizados;
    const cf = D.outros_cf;
    const mkt = D.mkt_valor;

    // RO — usar pré-calculado se disponível e consistente
    let ro;
    if (D._precalc.ro_mensal > 0) {
      ro = D._precalc.ro_mensal;
    } else {
      ro = lb - folha - aluguel - facilities - terceirizados - cf - mkt;
    }

    const prolabore = D.prolabore;
    const parcelas = D.parcelas_mensais;
    const rf = ro - prolabore - parcelas;

    return { fat, impostos, taxas, antecipacao, plataformas, comissoes, royalty, mkt_franq, recLiq, cmv, lb, folha, aluguel, facilities, terceirizados, cf, mkt, ro, prolabore, parcelas, rf };
  }

  // ── 7. CALCULAR BALANÇO ──
  function calcBalanco(D) {
    const totAtiv = D.caixa + D.receber + D.estoque + D.equip + D.imovel + D.ativo_franquia;
    const totPass = D.forn + D.impostos_atrasados + D.folha_pagar + D.emprest;
    const pl = totAtiv - totPass;
    return { caixa: D.caixa, receber: D.receber, estoque: D.estoque, equip: D.equip, imovel: D.imovel, ativo_franquia: D.ativo_franquia, totAtiv, forn: D.forn, impostos_atrasados: D.impostos_atrasados, folha_pagar: D.folha_pagar, emprest: D.emprest, totPass, pl };
  }

  // ── 8. CALCULAR ISE ──
  function calcISE(D, dre, bal) {
    const fat = dre.fat;
    const ro = dre.ro;
    const roAnual = ro * 12;
    const pl = bal.pl;
    const regras = P['regras_ise'] || {};
    const pesos = P['pesos_ise'] || {};

    // P1 — Dependência dos sócios
    const r1 = regras['p1_dependencia'] || {};
    const p1 = D.dependencia === 'total' ? n(r1.total || 1)
      : D.dependencia === 'nenhuma' ? n(r1.nenhuma || 8)
      : n(r1.parcial || 5);

    // P2 — Comercial / Vendas (informado diretamente)
    const p2 = Math.min(10, D.comercial_vendas || 5);

    // P3 — Financeiro (margem operacional)
    const margemOp = fat > 0 ? pct(ro, fat) : 0;
    const r3 = regras['p3_financeiro'] || {};
    const p3 = margemOp >= 25 ? n(r3.margem_25_mais || 9)
      : margemOp >= 15 ? n(r3.margem_15_24 || 7)
      : margemOp >= 8 ? n(r3.margem_8_14 || 5)
      : n(r3.margem_menor_8 || 3);

    // P4 — Gestão e processos
    const r4 = regras['p4_gestao'] || {};
    const p4 = D.processos === 'documentados' ? n(r4.documentados || 8)
      : D.processos === 'parcial' ? n(r4.parcial || 5)
      : n(r4.nao || 2);

    // P5 — Marca
    const r5 = regras['p5_marca'] || {};
    const p5 = D.marca_inpi === 'sim' ? n(r5.sim || 8)
      : D.marca_inpi === 'processo' ? n(r5.processo || 6)
      : n(r5.nao || 4);

    // P6 — Balanço (calculado automaticamente)
    const r6 = regras['p6_balanco'] || {};
    let p6;
    if (roAnual > 0) {
      if (pl > roAnual * 2) p6 = n(r6.pl_maior_2x_ro || 10);
      else if (pl > roAnual) p6 = n(r6.pl_maior_1x_ro || 8);
      else if (pl > 0) p6 = n(r6.pl_positivo || 6);
      else if (pl > -roAnual) p6 = n(r6.pl_negativo_ate_1x || 4);
      else if (pl > -roAnual * 2) p6 = n(r6.pl_negativo_ate_2x || 2);
      else p6 = n(r6.pl_negativo_mais_2x || 0);
    } else {
      p6 = pl > 0 ? 6 : pl > -50000 ? 3 : 1;
    }

    // P7 — Dívida (calculado automaticamente)
    const r7 = regras['p7_divida'] || {};
    const dividaPct = roAnual > 0 ? (D.parcelas_mensais * 12 / roAnual * 100) : 0;
    let p7;
    if (D.parcelas_mensais === 0) p7 = n(r7.zero || 10);
    else if (dividaPct < 10) p7 = n(r7.ate_10pct || 9);
    else if (dividaPct < 20) p7 = n(r7.ate_20pct || 7);
    else if (dividaPct < 35) p7 = n(r7.ate_35pct || 5);
    else if (dividaPct < 50) p7 = n(r7.ate_50pct || 3);
    else p7 = n(r7.acima_50pct || 1);

    // P8 — Risco jurídico
    const r8 = regras['p8_risco'] || {};
    const temPassivo = D.processos_juridicos === 'sim' || D.risco_juridico > 5;
    const p8 = temPassivo ? n(r8.com_passivo || 3) : n(r8.sem_passivo || 8);

    // P9 — Concentração de clientes
    const r9 = regras['p9_concentracao'] || {};
    const conc = D.maior_cliente_pct > 0 ? D.maior_cliente_pct : n(r9.default || 15); // default 15%
    let p9;
    if (conc <= 5) p9 = n(r9.ate_5pct || 10);
    else if (conc <= 15) p9 = n(r9.ate_15pct || 8);
    else if (conc <= 25) p9 = n(r9.ate_25pct || 6);
    else if (conc <= 40) p9 = n(r9.ate_40pct || 4);
    else if (conc <= 60) p9 = n(r9.ate_60pct || 2);
    else p9 = n(r9.acima_60pct || 0);

    // P10 — Escalabilidade / Recorrência
    const r10 = regras['p10_escalabilidade'] || {};
    const rec = D.recorrencia_pct;
    let p10;
    if (rec === 0 || rec === undefined || rec === null) p10 = n(r10.zero || 5); // base mínima
    else if (rec <= 20) p10 = n(r10.ate_20pct || 6);
    else if (rec <= 40) p10 = n(r10.ate_40pct || 7);
    else if (rec <= 60) p10 = n(r10.ate_60pct || 8);
    else if (rec <= 80) p10 = n(r10.ate_80pct || 9);
    else p10 = n(r10.acima_80pct || 10);

    // Cálculo ponderado
    const pw = pesos;
    const total = Math.round((
      p1 * n(pw.p1_dependencia || 0.09) +
      p2 * n(pw.p2_comercial || 0.22) +
      p3 * n(pw.p3_financeiro || 0.18) +
      p4 * n(pw.p4_gestao || 0.15) +
      p5 * n(pw.p5_marca || 0.05) +
      p6 * n(pw.p6_balanco || 0.08) +
      p7 * n(pw.p7_divida || 0.05) +
      p8 * n(pw.p8_risco || 0.05) +
      p9 * n(pw.p9_concentracao || 0.08) +
      p10 * n(pw.p10_escalabilidade || 0.05)
    ) * 10);

    // Trava: 2+ pilares críticos → limita a 40
    const limites = P['limites_globais'] || {};
    const notaCritica = n(limites.nota_critico_abaixo_de || 3);
    const qtdParaTrava = n(limites.pilares_criticos_para_trava || 2);
    const travaTeto = n(limites.ise_trava_criticos || 40);
    const criticos = [p1, p2, p3, p4, p6].filter(v => v < notaCritica).length;
    const finalTotal = criticos >= qtdParaTrava
      ? Math.min(total, travaTeto)
      : Math.min(100, Math.max(0, total));

    return {
      total: finalTotal,
      dep: p1, com: p2, fin: p3, ges: p4, mar: p5,
      bal: p6, div: p7, ris: p8, conc: p9, esc: p10
    };
  }

  // ── 9. CALCULAR FATOR 1N ──
  function calcFator(D, ise) {
    const mb = P['multiplos_base'] || {};
    const ms = P['modificadores_setor'] || {};
    const fi = P['fator_ise'] || [];
    const limites = P['limites_globais'] || {};

    const setorCode = mapearSetor(D.setor);
    const modeloCode = mapearModelo(D.modelo_negocio, D.setor, D._raw);

    const multiploBase = n(mb[modeloCode] || mb['servico'] || 2.5);
    const modificador = n(ms[setorCode] || 0);

    const faixaISE = fi.find(f => ise >= f.min && ise <= f.max) || { fator: 1.0, nome: 'Operacional' };
    const fatorIse = n(faixaISE.fator);

    const multiplo = (multiploBase + modificador) * fatorIse;

    const fMin = n(limites.fator_min || 1.5);
    const fMax = n(limites.fator_max || 6.0);

    return {
      fator: Math.max(fMin, Math.min(fMax, multiplo)),
      setorCode,
      modeloCode,
      multiploBase,
      modificador,
      fatorIse,
      iseClassificacao: faixaISE.nome
    };
  }

  // ── 10. CALCULAR ATRATIVIDADE ──
  function calcAtratividade(D, dre, ise) {
    const pa = P['pesos_atratividade'] || {};
    const ss = P['score_setor_atratividade'] || {};

    const setorCode = mapearSetor(D.setor);
    const margemOp = dre.fat > 0 ? pct(dre.ro, dre.fat) : 0;
    const bench = getBenchInd(setorCode);

    // P1 — ISE / Solidez
    const p1 = ise.total / 10;

    // P2 — Score do setor (5–8)
    const p2 = n(ss[setorCode] || ss['default'] || 6);

    // P3 — Recorrência
    const rec = D.recorrencia_pct;
    const p3 = rec <= 0 ? 5
      : rec <= 20 ? 6
      : rec <= 40 ? 7
      : rec <= 60 ? 8
      : rec <= 80 ? 9
      : 10;

    // P4 — Independência (usa dep do ISE, já invertido)
    const p4 = ise.dep;

    // P5 — Crescimento histórico
    const cresc = D.historico_crescimento;
    const p5 = cresc >= 8 ? 10 : cresc >= 6 ? 7 : cresc >= 4 ? 4 : 2;

    // P6 — Margem vs benchmark
    const margemBench = bench.margem_op || 15;
    const p6 = Math.min(10, (margemOp / margemBench) * 5);

    const score = Math.round((
      p1 * n(pa.p1_ise_solidez || 0.17) +
      p2 * n(pa.p2_setor || 0.17) +
      p3 * n(pa.p3_recorrencia || 0.17) +
      p4 * n(pa.p4_independencia || 0.17) +
      p5 * n(pa.p5_crescimento || 0.17) +
      p6 * n(pa.p6_margem || 0.15)
    ) * 10) / 10;

    const lbl = score >= 8 ? 'Excelente' : score >= 6.5 ? 'Boa' : score >= 5 ? 'Moderada' : 'Baixa';

    return { score: score || 5, lbl, sol: p1, set: p2, rec: p3, ges: p4, cre: p5, esc: p5, mar: p6 };
  }

  // ── 11. CALCULAR ICD ──
  function calcICD(D, dre) {
    const campos = P['icd_campos'] || {};
    const informados = campos.informados || ['fat_mensal','regime','cmv_pct','clt_folha','aluguel','prolabore','clientes_ativos','recorrencia_pct','processos','saldo_devedor'];

    let ok = 0;
    const respondidos = [];
    const naoRespondidos = [];

    const checks = {
      fat_mensal: D.fat_mensal > 0,
      regime: !!D.regime,
      meios_recebimento: D.meios_selecionados && D.meios_selecionados.length > 0,
      cmv_pct: D.cmv_pct > 0 || D.cmv_valor > 0,
      clt_folha: D.clt_folha > 0 || D.folha_total > 0,
      aluguel: D.aluguel > 0,
      prolabore: D.prolabore > 0,
      clientes_ativos: D.clientes_ativos > 0,
      recorrencia_pct: D.recorrencia_pct > 0,
      processos: !!D.processos && D.processos !== '',
      saldo_devedor: D.emprest >= 0 && D._raw && D._raw.saldo_devedor !== undefined,
    };

    informados.forEach(campo => {
      if (checks[campo]) {
        ok++;
        respondidos.push(campo);
      } else {
        naoRespondidos.push(campo);
      }
    });

    return {
      pct: Math.round((ok / informados.length) * 100),
      respondidos,
      naoRespondidos
    };
  }

  // ── 12. GERAR UPSIDES ──
  function gerarUpsides(D, dre, ise, bench) {
    const fat = dre.fat;
    if (!fat) return { ops: [], total: 0 };

    const ops = [];
    const margemOp = fat > 0 ? pct(dre.ro, fat) : 0;
    const benchInd = bench;

    // 1. Dependência do sócio
    if (ise.dep < 6) {
      ops.push({ titulo: 'Reduzir dependência do sócio-fundador', descricao: 'Designar gestor autônomo para operação. Eleva ISE em 10+ pontos e melhora o Fator 1N.', ganho: 0, ganho_label: '+Fator 1N' });
    }

    // 2. Recorrência
    if ((D.recorrencia_pct || 0) < 30) {
      ops.push({ titulo: 'Aumentar recorrência de receita', descricao: 'Converter clientes avulsos em contratos mensais. Cada 10% de aumento eleva o múltiplo aplicável.', ganho: 0, ganho_label: '+múltiplo' });
    }

    // 3. Processos
    if (D.processos !== 'documentados') {
      ops.push({ titulo: 'Documentar processos operacionais', descricao: 'Criar SOPs para as principais funções. Reduz risco percebido e acelera due diligence.', ganho: 0, ganho_label: '+ISE Gestão' });
    }

    // 4. Margem abaixo do benchmark
    if (margemOp < benchInd.margem_op * 0.8) {
      const ganho = Math.round(fat * (benchInd.margem_op / 100 - margemOp / 100) * 0.3);
      ops.push({ titulo: 'Otimizar estrutura de custos', descricao: `Margem operacional de ${margemOp.toFixed(0)}% vs benchmark de ${benchInd.margem_op}% para o setor. Ajuste de custos pode elevar o resultado.`, ganho, ganho_label: ganho > 0 ? '+' + brl(ganho) + '/mês' : '+resultado' });
    }

    // 5. Folha acima do benchmark
    if (fat > 0 && pct(dre.folha, fat) > benchInd.folha_pct * 1.2) {
      const ganho = Math.round(fat * (pct(dre.folha, fat) - benchInd.folha_pct) / 100 * 0.3);
      ops.push({ titulo: 'Otimizar estrutura de equipe', descricao: `Folha representa ${pct(dre.folha, fat).toFixed(0)}% do faturamento vs benchmark de ${benchInd.folha_pct}%. Revisão de estrutura pode liberar resultado.`, ganho, ganho_label: ganho > 0 ? '+' + brl(ganho) + '/mês' : '+eficiência' });
    }

    // 6. Clientes — expandir base
    if (D.clientes_ativos > 0) {
      const ganho = Math.round(fat * 0.08);
      ops.push({ titulo: 'Expandir base de clientes ativos', descricao: 'Crescer 20% em clientes mantendo ticket médio atual via outreach estruturado.', ganho, ganho_label: '+' + brl(ganho) + '/mês' });
    } else {
      ops.push({ titulo: 'Estruturar base de clientes', descricao: 'Formalizar cadastro e acompanhamento de clientes ativos. Base documentada valoriza o negócio em due diligence.', ganho: 0, ganho_label: '+ICD' });
    }

    // 7. Marca
    if (D.marca_inpi !== 'sim') {
      ops.push({ titulo: 'Registrar marca no INPI', descricao: 'Formalizar o registro da marca junto ao INPI. Eleva pilar de Marca no ISE e protege o ativo intangível.', ganho: 0, ganho_label: '+ISE Marca' });
    }

    // 8. Contabilidade / ICD
    ops.push({ titulo: 'Implantar contabilidade gerencial mensal', descricao: 'DRE mensal formal aumenta o ICD e torna o valuation mais defensável em due diligence.', ganho: 0, ganho_label: '+ICD' });

    // 9. Concentração
    if ((D.maior_cliente_pct || 0) > 20) {
      ops.push({ titulo: 'Diversificar base de clientes', descricao: `Maior cliente representa ${D.maior_cliente_pct}% do faturamento. Reduzir para abaixo de 20% elimina desconto de risco no Fator 1N.`, ganho: 0, ganho_label: '+Fator 1N' });
    }

    // 10. Upsell
    if (D.clientes_ativos > 0) {
      const ganho = Math.round(fat * 0.1);
      ops.push({ titulo: 'Estruturar funil de upsell', descricao: 'Oferecer planos ou serviços superiores à base atual. Crescimento de ticket sem custo de aquisição.', ganho, ganho_label: '+' + brl(ganho) + '/mês' });
    }

    const top10 = ops.slice(0, 10);
    const total = top10.reduce((s, o) => s + (o.ganho || 0), 0);

    return { ops: top10, total };
  }

  // ── 13. MONTAR CALC_JSON ──
  function montarCalcJson(dados, D, dre, bal, ise, fatorObj, atr, icd, upsides) {
    const setorCode = fatorObj.setorCode;
    const bench = getBench(setorCode);
    const numFuncs = D.clt_qtd + D.pj_qtd;
    const ticket = D.clientes_ativos > 0 ? dre.fat / D.clientes_ativos : 0;
    const valorOp = dre.ro * 12 * fatorObj.fator;
    const valorVenda = valorOp + Math.max(0, bal.pl);

    const regimeTxt = {
      simples: 'Simples Nacional', lucro_presumido: 'Lucro Presumido',
      presumido: 'Lucro Presumido', lucro_real: 'Lucro Real', mei: 'MEI'
    }[D.regime] || 'Simples Nacional';

    return {
      // Identidade
      id: D.id,
      nome: D.nome,
      setor: D.setor,
      setor_raw: D.setor,
      setor_code: setorCode,
      modelo_negocio: D.modelo_negocio,
      modelo_atuacao_multi: D.modelo_atuacao_multi,
      cidade: D.cidade,
      estado: D.estado,
      anos: D.anos,
      regime: regimeTxt,
      codigo: D.codigo,
      data_avaliacao: hoje(),

      // DRE
      fat_mensal: dre.fat,
      impostos: dre.impostos,
      taxas: dre.taxas,
      antecipacao: dre.antecipacao,
      plataformas: dre.plataformas,
      comissoes: dre.comissoes,
      royalty: dre.royalty,
      mkt_franq: dre.mkt_franq,
      cmv: dre.cmv,
      folha: dre.folha,
      aluguel: dre.aluguel,
      facilities: dre.facilities,
      terceirizados: dre.terceirizados,
      cf: dre.cf,
      mkt: dre.mkt,
      ro_mensal: dre.ro,
      ro_anual: dre.ro * 12,
      prol: dre.prolabore,
      parc: dre.parcelas,
      rf: dre.rf,
      margem_pct: dre.fat > 0 ? pct(dre.ro, dre.fat) : 0,

      // Balanço
      caixa: bal.caixa,
      receber: bal.receber,
      estoque: bal.estoque,
      equip: bal.equip,
      imovel: bal.imovel,
      totAtiv: bal.totAtiv,
      forn: bal.forn,
      emprest: bal.emprest,
      totPass: bal.totPass,
      pl: bal.pl,

      // ISE
      ise_total: ise.total,
      ise_dep: ise.dep, ise_com: ise.com, ise_fin: ise.fin,
      ise_ges: ise.ges, ise_mar: ise.mar, ise_bal: ise.bal,
      ise_div: ise.div, ise_ris: ise.ris, ise_conc: ise.conc, ise_esc: ise.esc,
      ise_class: fatorObj.iseClassificacao,

      // Valuation
      fator: fatorObj.fator,
      mul_base: fatorObj.multiploBase,
      mul_mod: fatorObj.modificador,
      mul_ise: fatorObj.fatorIse,
      mul_range: bench.mulRange || '2-4x',
      valor_op: valorOp,
      valor_venda: valorVenda,

      // Atratividade
      atr_score: atr.score,
      atr_lbl: atr.lbl,
      atr_sol: atr.sol, atr_set: atr.set, atr_rec: atr.rec,
      atr_ges: atr.ges, atr_cre: atr.cre, atr_esc: atr.esc, atr_mar: atr.mar,

      // Operacional
      num_funcs: numFuncs,
      clientes: D.clientes_ativos,
      ticket,
      recorrencia: D.recorrencia_pct,
      concentracao: D.maior_cliente_pct,
      processos: D.processos,

      // ICD
      icd_pct: icd.pct,
      icd_respondidos: icd.respondidos,
      icd_nao_respondidos: icd.naoRespondidos,

      // Upsides
      ops: upsides.ops,
      total_ops: upsides.total,

      // Expectativa
      expectativa_val: D.expectativa_val,
    };
  }

  // ── 14. SALVAR NO BANCO ──
  async function salvarCalcJson(negocioId, calcJson) {
    if (!negocioId) return;
    try {
      // Tenta PATCH primeiro
      const rPatch = await fetch(SB_URL + '/rest/v1/laudos_completos?slug=eq.' + negocioId, {
        method: 'PATCH',
        headers: { ...H, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ calc_json: calcJson, atualizado_em: new Date().toISOString() })
      });

      // Se não existia ainda, cria
      if (rPatch.status === 404 || rPatch.status === 0) {
        await fetch(SB_URL + '/rest/v1/laudos_completos', {
          method: 'POST',
          headers: { ...H, 'Prefer': 'return=minimal' },
          body: JSON.stringify({ slug: negocioId, calc_json: calcJson, pago: false, atualizado_em: new Date().toISOString() })
        });
      }
      console.log('[AVALIADORA] calc_json salvo para', negocioId);
    } catch (e) {
      console.error('[AVALIADORA] Erro ao salvar calc_json:', e);
    }
  }

  // ── 15. FUNÇÃO PRINCIPAL ──
  async function avaliar(dadosBrutos) {
    // 1. Carregar parâmetros
    await carregarParametros();

    // 2. Mapear dados
    const D = mapearDados(dadosBrutos);
    console.log('[AVALIADORA] Dados mapeados:', D.nome, D.setor, 'fat:', D.fat_mensal);

    // 3. Calcular
    const dre = calcDRE(D);
    const bal = calcBalanco(D);
    const ise = calcISE(D, dre, bal);
    const fatorObj = calcFator(D, ise.total);
    const atr = calcAtratividade(D, dre, ise);
    const icd = calcICD(D, dre);
    const setorCode = fatorObj.setorCode;
    const benchInd = getBenchInd(setorCode);
    const upsides = gerarUpsides(D, dre, ise, benchInd);

    // 4. Montar calc_json
    const calcJson = montarCalcJson(dadosBrutos, D, dre, bal, ise, fatorObj, atr, icd, upsides);

    console.log('[AVALIADORA] Resultado:', {
      ise: ise.total, fator: fatorObj.fator,
      valor: calcJson.valor_venda, atr: atr.score
    });

    // 5. Salvar no banco
    await salvarCalcJson(D.id, calcJson);

    return calcJson;
  }

  // ── API PÚBLICA ──
  return {
    avaliar,
    carregarParametros,
    // Expõe parâmetros carregados para uso externo (laudo-pago, laudo-completo)
    _getParams: () => P || {},
    _getBench: (s) => {
      const norm = P['mapeamento_setor'] || {};
      const b = P['benchmarks_dre'] || {};
      const sl = (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      let code = norm[sl] || 'default';
      if(!norm[sl]){ for(const k in norm){ if(sl.includes(k)){ code = norm[k]; break; } } }
      const row = b[code] || b['default'] || {};
      // Compatibilidade com formato antigo usado pelo laudo-pago
      const mulBase = {
        servicos_b2b:5, educacao:5, saude:5, beleza_estetica:4.5,
        academia:4, alimentacao:3.5, varejo:3.5, hospedagem:3.5,
        outros_servicos:4, logistica:3, industria:3.5, construcao:3, default:4
      }[code] || 4;
      return { ...row, mulBase, mulRange: mulBase+'-'+(mulBase+1.5)+'x' };
    },
    // Expõe funções individuais para debug
    _mapearDados: mapearDados,
    _calcDRE: calcDRE,
    _calcISE: calcISE,
    _calcFator: calcFator,
  };

})();

// Disponível globalmente
window.AVALIADORA = AVALIADORA;

// Auto-carrega parâmetros quando o script é importado
// Assim laudo-pago e laudo-completo já têm os parâmetros ao chamar calcISE/calcFator
(async () => {
  try {
    await AVALIADORA.carregarParametros();
    console.log('[AVALIADORA] Parâmetros pré-carregados com sucesso');
  } catch(e) {
    console.warn('[AVALIADORA] Pré-carregamento falhou (será tentado na primeira chamada):', e);
  }
})();
