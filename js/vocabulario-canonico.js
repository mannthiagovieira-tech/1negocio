// /js/vocabulario-canonico.js · fonte única do vocabulário canônico do 1Negócio
// NÃO duplicar essas listas em outro lugar · sempre importar daqui.
// Banco tem CHECK constraints que espelham essas listas (negocios.setor · negocios.formas_atuacao
// · teses_investimento.setores · teses_investimento.formas_atuacao · negocios.estado · teses_investimento.estado).
// Cidades são normalizadas server-side via trigger BEFORE INSERT/UPDATE (lower + unaccent + trim).

window.VC = (function () {
  const SETORES = [
    { id: 'servicos_empresas', label: 'Serviços B2B' },
    { id: 'varejo',            label: 'Varejo' },
    { id: 'saude',             label: 'Saúde' },
    { id: 'alimentacao',       label: 'Alimentação' },
    { id: 'beleza_estetica',   label: 'Beleza e estética' },
    { id: 'educacao',          label: 'Educação' },
    { id: 'servicos_locais',   label: 'Serviços locais' },
    { id: 'bem_estar',         label: 'Bem-estar' },
    { id: 'industria',         label: 'Indústria' },
    { id: 'construcao',        label: 'Construção' },
    { id: 'hospedagem',        label: 'Hospedagem' },
    { id: 'logistica',         label: 'Logística' },
  ];

  const FORMAS = [
    { id: 'presta_servico',  label: 'Presta serviço' },
    { id: 'produz_revende',  label: 'Produz e revende' },
    { id: 'fabricacao',      label: 'Fabricação' },
    { id: 'revenda',         label: 'Revenda' },
    { id: 'distribuicao',    label: 'Distribuição' },
    { id: 'vende_governo',   label: 'Vende pra governo' },
    { id: 'saas',            label: 'SaaS' },
    { id: 'assinatura',      label: 'Assinatura/recorrência' },
  ];

  const STATUS_TESE = ['ativa', 'pausada', 'rascunho', 'auto_negocio'];

  const UFS = [
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
    'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
  ];

  return {
    SETORES, FORMAS, STATUS_TESE, UFS,
    setoresIds: SETORES.map(s => s.id),
    formasIds: FORMAS.map(f => f.id),
    isSetor: (s) => SETORES.some(x => x.id === s),
    isForma: (f) => FORMAS.some(x => x.id === f),
    isUF: (uf) => UFS.includes(uf),
    labelSetor: (id) => (SETORES.find(x => x.id === id) || {}).label || id,
    labelForma: (id) => (FORMAS.find(x => x.id === id) || {}).label || id,
  };
})();
