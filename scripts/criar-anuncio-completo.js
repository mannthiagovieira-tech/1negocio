#!/usr/bin/env node

// Maquininha completa — cria fluxo fim-a-fim:
//   1. INSERT em negocios (com vendedor_id = Thiago admin)
//   2. Roda skill v2 (modo commit) → grava laudos_v2 ativo
//   3. Dispara 9 fetches paralelos da Edge Function gerar_textos_laudo
//   4. INSERT em termos_adesao (assinatura_em = NOW)
//   5. INSERT em anuncios_v2 com status='publicado' + origem='maquininha_teste'
//
// Uso:
//   node scripts/criar-anuncio-completo.js scripts/perfis-teste/05-...json
//   node scripts/criar-anuncio-completo.js --batch  # roda 05..10 em sequência

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SUPABASE_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

// User dedicado pros seeds da maquininha (seed@1negocio.com.br).
// Substitui Thiago (5a97b1c4-3ceb-4fe1-811e-36185131ba73) pra separar
// seeds de negócios reais nos painéis admin.
const VENDEDOR_ID_THIAGO = 'aaaaaaaa-0000-0000-0000-000000000001';

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

const PALAVRAS_PROIBIDAS = ['vendo','vende-se','à venda','a venda','oportunidade','passo ponto','passa-se ponto','negócio em venda','empresa para venda'];

// Labels acentuados pra setor (espelha SETOR_LABELS do skill — preenche
// setor_label no payload pra evitar fallback feio "Saude" sem cedilha).
const SETOR_LABELS = {
  alimentacao: 'Alimentação',
  saude: 'Saúde',
  educacao: 'Educação',
  beleza_estetica: 'Beleza e estética',
  bem_estar: 'Bem-estar',
  varejo: 'Varejo',
  hospedagem: 'Hospedagem',
  logistica: 'Logística',
  industria: 'Indústria',
  construcao: 'Construção',
  servicos_empresas: 'Serviços para empresas',
  servicos_locais: 'Serviços locais',
};

// Setor específico legível pra usar nos templates de descrição.
// Vai além do SETOR_LABELS — tenta inferir tipo concreto do negócio.
function setorEspecifico(perfil, dadosJson) {
  const id = perfil.identificacao || {};
  const sub = (id.subcategoria || '').toLowerCase();
  if (sub) {
    // Mapeia algumas subcategorias comuns pra forma legível
    const subMap = {
      odontologia: 'clínica odontológica', medicina: 'clínica médica',
      fisioterapia: 'clínica de fisioterapia', estetica: 'clínica estética',
      veterinaria: 'clínica veterinária', psicologia: 'consultório de psicologia',
      padaria: 'padaria', restaurante: 'restaurante', pizzaria: 'pizzaria',
      lanchonete: 'lanchonete', cafeteria: 'cafeteria', bar: 'bar',
      pet: 'pet shop', pet_shop: 'pet shop',
      academia: 'academia', crossfit: 'box de crossfit', pilates: 'studio de pilates',
      salao: 'salão de beleza', barbearia: 'barbearia',
      moda: 'boutique de moda', loja_roupas: 'loja de roupas', otica: 'ótica',
      contabilidade: 'escritório de contabilidade', advocacia: 'escritório de advocacia',
      consultoria: 'consultoria', tecnologia: 'empresa de tecnologia',
      mecanica: 'oficina mecânica', oficina: 'oficina',
      escola_infantil: 'escola infantil', curso: 'curso livre',
      logistica: 'transportadora', limpeza: 'empresa de limpeza',
    };
    if (subMap[sub]) return subMap[sub];
    // Se subcategoria existe mas não mapeada, usa ela mesma
    return sub.replace(/_/g, ' ');
  }
  return SETOR_LABELS[dadosJson.setor_code] || dadosJson.setor_code || 'negócio';
}

function H() { return { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON, 'Content-Type': 'application/json' }; }

// ─── MAPEAMENTO schema novo → dados_json flat (formato esperado pela skill v2) ───
function mapPerfilParaDadosJson(perfil) {
  const id = perfil.identificacao || {};
  const dre = perfil.dre || {};
  const bal = perfil.balanco_patrimonial || {};
  const com = perfil.comercial || {};
  const ges = perfil.gestao || {};
  const leg = perfil.legal || {};

  const fatMensal = Math.round((dre.faturamento_anual || 0) / 12);
  const fatAnterior = Math.round((dre.faturamento_anterior || 0) / 12);
  const cmvValor = Math.round(fatMensal * (dre.cmv_pct || 0) / 100);
  const cresc = dre.faturamento_anterior > 0
    ? ((dre.faturamento_anual - dre.faturamento_anterior) / dre.faturamento_anterior) * 100
    : 0;

  // Mapeamentos categóricos
  const operaSemDono = ges.opera_sem_dono_15dias === true ? 'sim' : 'nao';
  const temGestor = ges.tem_gerente === true ? 'sim' : 'nao';
  const equipePerm = ges.equipe_permanece_apos_venda === 'provavelmente' ? 'parcial'
    : (ges.equipe_permanece_apos_venda || 'parcial');
  const marcaInpi = leg.marca_registrada === true ? 'registrada' : 'sem_registro';
  const concentracaoPct = com.concentracao_cliente === true ? 35 : 0;

  // Setor map: 'servicos' → 'servicos_locais' (se b2c) ou 'servicos_empresas' (se b2b)
  let setorMap = id.setor;
  if (id.setor === 'servicos') {
    setorMap = id.modelo_negocio === 'b2b' ? 'servicos_empresas' : 'servicos_locais';
  }

  return {
    nome_responsavel: 'Thiago Mann',
    subcategoria: id.subcategoria || null,
    fat_mensal: fatMensal,
    fat_anterior: fatAnterior,
    crescimento_pct: Number(cresc.toFixed(1)),
    regime: id.regime_tributario || 'simples',
    anexo_simples: 'I',
    setor: setorMap,
    setor_code: setorMap,
    setor_label: SETOR_LABELS[setorMap] || setorMap,
    modelo_atuacao_multi: ['produto_proprio'],
    modelo_code: 'produto_proprio',
    pct_produto: 100,

    cmv_valor: cmvValor,
    cmv_fonte: 'informado',

    custo_recebimento_total: Math.round(fatMensal * 0.018),
    custo_comissoes: 0,

    franquia: 'nao',

    clt_folha: Math.round((id.funcionarios_clt || 0) * 4500),
    clt_qtd: id.funcionarios_clt || 0,
    pj_custo: Math.round((id.funcionarios_pj || 0) * 8000),
    pj_qtd: id.funcionarios_pj || 0,

    aluguel: dre.aluguel_mensal || 0,
    local_tipo: 'comercial',
    custo_utilities: Math.round((dre.outros_custos_fixos || 0) * 0.2),
    custo_terceiros: 0,

    custo_sistemas: Math.round((dre.outros_custos_fixos || 0) * 0.1),
    custo_outros: Math.round((dre.outros_custos_fixos || 0) * 0.5),
    mkt_valor: Math.round((dre.outros_custos_fixos || 0) * 0.2),

    prolabore: dre.prolabore_mensal || 0,
    parcelas_mensais: Math.round((bal.passivo_dividas || 0) / 36),
    custo_antecipacao: 0,
    investimentos_mensais: 0,

    at_caixa: bal.ativo_caixa || 0,
    at_cr: Math.round(fatMensal * 0.5),
    at_estoque: bal.ativo_estoque || 0,
    at_equip: bal.ativo_imobilizado || 0,
    at_imovel: 0,
    ativo_franquia: 0,
    at_outros: 0,

    fornec_a_vencer: bal.passivo_fornecedores || 0,
    fornec_atrasadas: 0,
    impostos_atrasados: 0,
    folha_pagar: 0,
    saldo_devedor: bal.passivo_dividas || 0,
    outro_passivo_val: 0,

    pmr: 15,
    pmp: 25,

    processos: ges.processos_documentados || 'parcial',
    dependencia: operaSemDono === 'sim' ? 'parcial' : 'total',
    marca_inpi: marcaInpi,
    processos_juridicos: leg.acao_judicial === true ? 'sim' : 'nao',
    juridico_tipo: [],
    passivo_juridico: 0,
    ativo_juridico: 0,

    tem_gestor: temGestor,
    opera_sem_dono: operaSemDono,
    equipe_permanece: equipePerm,
    passivo_trabalhista: leg.passivo_trabalhista === true,
    tem_processo: leg.acao_judicial === true,
    impostos_dia: leg.impostos_dia || 'sim',
    contabilidade_formal: leg.contabilidade_formal !== false,
    reputacao_online: 'boa',

    recorrencia_pct: com.recorrencia_pct || 0,
    concentracao_pct: concentracaoPct,
    clientes: com.num_clientes_ativos || 0,
    ticket_medio: com.ticket_medio || 0,

    expectativa_val: Math.round((dre.faturamento_anual || 0) * 1.5),
  };
}

// Limita string a max chars sem cortar palavra
function trunc(s, max) {
  s = String(s || '').trim();
  if (s.length <= max) return s;
  return s.substring(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// Helpers pra formatar números brasileiros
function fmtBRL(n) { return Math.round(n).toLocaleString('pt-BR'); }
function fmtFatBRL(fatAnual) {
  if (fatAnual >= 1000000) return (fatAnual / 1000000).toFixed(1).replace('.', ',') + 'M';
  return Math.round(fatAnual / 1000) + 'k';
}

// Limpa palavras proibidas (safety net)
function limparProibidas(s) {
  let out = s;
  const lower = s.toLowerCase();
  for (const p of PALAVRAS_PROIBIDAS) {
    if (lower.includes(p)) out = out.replace(new RegExp(p, 'gi'), '').replace(/\s+/g, ' ').trim();
  }
  return out;
}

// 4 templates rotativos com placeholders dinâmicos. Sorteia 1 por anúncio.
// Garante todos placeholders preenchidos — se algum dado faltar pra um template,
// pula pro próximo da fila.
function montarDescricaoCard(calc, perfil) {
  const id = perfil.identificacao || {};
  const dre = perfil.dre || {};
  const com = perfil.comercial || {};
  const ges = perfil.gestao || {};

  const setorEsp = setorEspecifico(perfil, { setor_code: calc.identificacao && calc.identificacao.setor && calc.identificacao.setor.code });
  const cidade = id.cidade || '';
  const uf = id.estado || '';
  const anos = id.tempo_operacao_anos || 0;
  // Margem: fonte AUTORITATIVA é calc.dre.margem_operacional_pct (calculado pela
  // skill v2 a partir do DRE detalhado). Bate com o título (que também lê do calc
  // via edge function gerar_textos_laudo). Perfil só como fallback.
  const margemCalc = (calc && calc.dre && (calc.dre.margem_operacional_pct ?? calc.dre.margem_op_pct));
  const margem = Math.round((typeof margemCalc === 'number' ? margemCalc : null) ?? dre.margem_operacional_pct ?? 0);
  // Recorrência: calc.comercial não é populado pela skill v2 atualmente — fica
  // só no perfil. Single-source: perfil. (Débito técnico: skill propagar comercial
  // pro calc_json pra unificar.)
  const recorrencia = Math.round(com.recorrencia_pct || 0);
  const funcionarios = (id.funcionarios_clt || 0) + (id.funcionarios_pj || 0);
  const publico = id.modelo_negocio === 'b2b' ? 'clientes corporativos' : 'público local de classe média';
  const clientes = com.num_clientes_ativos || 0;
  const ticket = com.ticket_medio || 0;
  const ticketBRL = ticket > 0 ? fmtBRL(ticket) : null;
  const operaSemDono = ges.opera_sem_dono_15dias === true;
  const fatBRL = fmtFatBRL(dre.faturamento_anual || 0);

  // Diferencial principal (Template 4)
  let diferencial;
  if (recorrencia >= 30)         diferencial = `alta recorrência de receita (${recorrencia}%)`;
  else if (margem >= 22)         diferencial = `margem operacional acima da média (${margem}%)`;
  else if (operaSemDono)         diferencial = `operação independente do sócio`;
  else if (anos >= 10)           diferencial = `${anos} anos de presença consolidada`;
  else                           diferencial = `operação enxuta e lucrativa`;

  // Templates — requisitos REDUZIDOS: cidade + uf + anos é o mínimo.
  // Frases adicionais são CONDICIONAIS aos campos disponíveis (campos opcionais
  // somem em vez de fazer o template falhar). Mínimo 4 frases / 250 chars.
  const templates = [
    {
      key: 'performance',
      requer: () => margem > 0 && cidade && uf && anos > 0,
      texto: () => {
        const partes = [
          `Operação de ${setorEsp} em ${cidade}/${uf} com ${anos} anos no mercado.`,
          recorrencia >= 25
            ? `Margem operacional de ${margem}% e ${recorrencia}% de receita recorrente garantem fluxo de caixa estável.`
            : `Margem operacional de ${margem}% sustenta fluxo de caixa estável.`,
          funcionarios > 0
            ? `Equipe de ${funcionarios} pessoas atende ${publico}.`
            : `Atende ${publico} com fidelização forte.`,
          'Estrutura consolidada com processos documentados.',
          operaSemDono ? 'Negócio opera sem dependência diária do dono.' : 'Operação preparada para transição com novo dono.',
        ];
        return partes.join(' ');
      },
    },
    {
      key: 'equipe',
      requer: () => funcionarios > 0 && cidade && uf && anos > 0,
      texto: () => {
        const partes = [
          `${capitalize(setorEsp)} estabelecido em ${cidade}/${uf} há ${anos} anos.`,
          `Time de ${funcionarios} colaboradores treinado e processos padronizados.`,
          (margem > 0 && fatBRL)
            ? `Faturamento de R$ ${fatBRL}/ano com margem de ${margem}%.`
            : (margem > 0
                ? `Operação com margem de ${margem}%.`
                : (fatBRL ? `Faturamento de R$ ${fatBRL}/ano.` : 'Operação com fluxo de caixa consolidado.')),
          `Atende ${publico} com fidelização forte.`,
          'Carteira de clientes ativa e diversificada.',
          'Ponto comercial estratégico.',
        ];
        return partes.join(' ');
      },
    },
    {
      key: 'recorrencia',
      requer: () => recorrencia >= 25 && cidade && uf && anos > 0,
      texto: () => {
        const partes = [
          `${capitalize(setorEsp)} em ${cidade}/${uf} com ${recorrencia}% de receita recorrente.`,
          margem > 0
            ? `Operação madura há ${anos} anos com margem operacional de ${margem}%.`
            : `Operação madura há ${anos} anos.`,
          (clientes > 0 && ticketBRL)
            ? `Base de ${clientes} clientes ativos e ticket médio de R$ ${ticketBRL}.`
            : (clientes > 0 ? `Base de ${clientes} clientes ativos.` : 'Base de clientes ativa e diversificada.'),
          'Estrutura física consolidada.',
          'Negócio com baixa dependência do dono e forte presença regional.',
        ];
        return partes.join(' ');
      },
    },
    {
      key: 'diferencial',
      requer: () => cidade && uf && anos > 0 && funcionarios > 0 && margem > 0,
      texto: () => `Negócio de ${setorEsp} consolidado em ${cidade}/${uf}. ` +
                   `${anos} anos de operação com ${funcionarios} colaboradores ativos. ` +
                   `Diferencial: ${diferencial}. ` +
                   `Faturamento estável com margem de ${margem}%. ` +
                   `Operação preparada para transição com novo dono.`,
    },
  ];

  // Sorteia ordem aleatória, pega o primeiro válido
  const ordem = [...templates].sort(() => Math.random() - 0.5);
  for (const t of ordem) {
    if (t.requer()) {
      const out = limparProibidas(t.texto());
      // Sem trunc agressivo — templates já miram 280-450 chars
      return out;
    }
  }

  // Fallback se nenhum template tem dados completos: template legado simplificado
  return limparProibidas(
    `${capitalize(setorEsp)} em ${cidade}/${uf}. ${anos} anos de operação. ` +
    `Faturamento R$ ${fatBRL}/ano. Estrutura consolidada e operação organizada.`
  );
}

function capitalize(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

// Monta título: prioriza IA, fallback "Setor em Cidade"
function montarTitulo(calc, perfil) {
  const sugIA = calc.textos_anuncio
    && calc.textos_anuncio.sugestoes_titulo_anuncio
    && calc.textos_anuncio.sugestoes_titulo_anuncio.conteudo;
  if (Array.isArray(sugIA) && sugIA.length > 0) {
    let t = String(sugIA[0]).trim();
    // Filtra proibidas
    const lower = t.toLowerCase();
    for (const p of PALAVRAS_PROIBIDAS) {
      if (lower.includes(p)) { t = t.replace(new RegExp(p, 'gi'), '').replace(/\s+/g, ' ').trim(); }
    }
    if (t.length >= 5) return trunc(t, 60);
  }
  const id = perfil.identificacao || {};
  const setorLabel = (calc.identificacao && calc.identificacao.setor && calc.identificacao.setor.label) || id.setor;
  const cap = setorLabel ? setorLabel.charAt(0).toUpperCase() + setorLabel.slice(1) : 'Negócio';
  return trunc(`${cap} em ${id.cidade}`, 60);
}

async function processarPerfil(perfilPath) {
  const perfil = JSON.parse(fs.readFileSync(perfilPath, 'utf-8'));
  const id = perfil.identificacao;
  console.log(`\n┌─ ${path.basename(perfilPath)}`);
  console.log(`│  ${id.nome} · ${id.cidade}/${id.estado}`);

  const dadosJson = mapPerfilParaDadosJson(perfil);

  // ── 1. INSERT em negocios ──
  const codigo = '1N-T' + Date.now().toString(36).slice(-5).toUpperCase();
  const negocioPayload = {
    nome: id.nome,
    setor: dadosJson.setor,
    categoria: id.subcategoria || null,
    cidade: id.cidade,
    estado: id.estado,
    tempo_operacao_anos: id.tempo_operacao_anos,
    modelo_negocio: id.modelo_negocio,
    slug: codigo,
    codigo_diagnostico: codigo,
    faturamento_anual: (dadosJson.fat_mensal || 0) * 12,
    fat_mensal: dadosJson.fat_mensal,
    fat_anual: (dadosJson.fat_mensal || 0) * 12,
    status: 'em_avaliacao',
    plano: 'gratuito',
    origem: 'maquininha_teste',
    vendedor_id: VENDEDOR_ID_THIAGO,
    dados_json: dadosJson,
  };
  const negResp = await fetch(`${SUPABASE_URL}/rest/v1/negocios`, {
    method: 'POST',
    headers: { ...H(), 'Prefer': 'return=representation' },
    body: JSON.stringify(negocioPayload),
  });
  if (!negResp.ok) throw new Error(`negocios INSERT (${negResp.status}): ${await negResp.text()}`);
  const negocioId = (await negResp.json())[0].id;
  console.log(`│  ✓ negócio: ${negocioId} (${codigo})`);

  // ── 2. Carregar e rodar skill v2 ──
  const skillCode = fs.readFileSync(path.join(__dirname, '..', 'skill-avaliadora-v2.js'), 'utf-8');
  const sandbox = { window: {}, fetch, setTimeout, clearTimeout, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(skillCode, sandbox);
  const AVALIADORA_V2 = sandbox.window.AVALIADORA_V2;

  const rowResp = await fetch(`${SUPABASE_URL}/rest/v1/negocios?id=eq.${negocioId}&select=*`, { headers: H() });
  const rowData = (await rowResp.json())[0];
  const calcJson = await AVALIADORA_V2.avaliar(rowData, 'commit');
  console.log(`│  ✓ skill v2: RO=${Math.round(calcJson.dre.ro_mensal)}/mês, ISE=${calcJson.ise.ise_total}, valor=${Math.round(calcJson.valuation.valor_venda)}`);

  // ── GUARD: regra de negócio — 1Negócio não publica RO anual negativo ──
  // Se RO anual < 0, faz rollback dos artefatos criados (negocio + laudo) e
  // PULA esse perfil. Próximo perfil do batch.
  const roAnual = Number(calcJson.dre.ro_anual) || 0;
  if (roAnual < 0) {
    console.log(`│  ⊘ pulado · resultado anual negativo (R$ ${Math.round(roAnual).toLocaleString('pt-BR')})`);
    // Rollback: deleta laudo + negocio criados (anon não tem permissão de DELETE,
    // mas a service_role da edge function tem. Como o script roda com anon, o
    // rollback pode falhar parcialmente. Ainda assim, marcamos para skip.)
    try {
      // Tenta DELETE laudo + negocio (best-effort, anon pode não ter permissão)
      await fetch(`${SUPABASE_URL}/rest/v1/laudos_v2?negocio_id=eq.${negocioId}`, { method: 'DELETE', headers: H() });
      await fetch(`${SUPABASE_URL}/rest/v1/negocios?id=eq.${negocioId}`, { method: 'DELETE', headers: H() });
    } catch (_) { /* swallow */ }
    return {
      pulado: true,
      motivo: 'ro_anual_negativo',
      ro_anual: roAnual,
      perfil: path.basename(perfilPath),
      negocio_id: negocioId,
    };
  }

  // ── 3. Pega laudo_v2_id ──
  const lauResp = await fetch(`${SUPABASE_URL}/rest/v1/laudos_v2?negocio_id=eq.${negocioId}&ativo=eq.true&select=id`, { headers: H() });
  const laudoV2Id = (await lauResp.json())[0].id;

  // ── 4. Dispara 9 textos IA ──
  const inicio = Date.now();
  const promessas = TEXTOS.map(textoKey =>
    fetch(`${SUPABASE_URL}/functions/v1/gerar_textos_laudo`, {
      method: 'POST', headers: H(),
      body: JSON.stringify({ negocio_id: negocioId, texto_a_gerar: textoKey }),
    }).then(r => r.json()).then(j => ({ ok: j.ok === true, erro: j.erro }))
      .catch(e => ({ ok: false, erro: e.message }))
  );
  const resultados = await Promise.all(promessas);
  const ok = resultados.filter(r => r.ok).length;
  console.log(`│  ✓ textos IA: ${ok}/9 em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

  // ── 5. Recarrega calc_json com textos IA salvos ──
  const lauResp2 = await fetch(`${SUPABASE_URL}/rest/v1/laudos_v2?negocio_id=eq.${negocioId}&ativo=eq.true&select=calc_json`, { headers: H() });
  const calcAtualizado = (await lauResp2.json())[0].calc_json;

  // ── 6. INSERT termos_adesao ──
  // valor_pedido base = valuation calculada pela skill. Se o perfil tem
  // _preco_modificador (ex: 1.15 = sobrepreco, 0.85 = oportunidade), aplica.
  const valorBase = calcJson.valuation.valor_venda || 0;
  const precoMod = (typeof perfil._preco_modificador === 'number') ? perfil._preco_modificador : 1.0;
  const valorPedido = Math.round(valorBase * precoMod);
  const termoPayload = {
    negocio_id: negocioId,
    plano: 'gratuito',
    comissao_pct: 10,
    exige_nda: false,
    razao_social: id.nome + ' LTDA',
    representante_nome: 'Thiago Mann',
    representante_cpf: '00000000000',
    cnpj: '00000000000000',
    endereco: id.cidade + '/' + id.estado,
    whatsapp: '5511952136406',
    email: 'thiago@1negocio.com.br',
    valor_pretendido: valorPedido,
    assinatura_em: new Date().toISOString(),
    status: 'assinado',
  };
  const termoResp = await fetch(`${SUPABASE_URL}/rest/v1/termos_adesao`, {
    method: 'POST', headers: { ...H(), 'Prefer': 'return=representation' },
    body: JSON.stringify(termoPayload),
  });
  if (!termoResp.ok) throw new Error(`termos_adesao INSERT (${termoResp.status}): ${await termoResp.text()}`);
  const termoId = (await termoResp.json())[0].id;
  console.log(`│  ✓ termo: ${termoId}`);

  // ── 7. INSERT anuncios_v2 ──
  const titulo = montarTitulo(calcAtualizado, perfil);
  const descricao = montarDescricaoCard(calcAtualizado, perfil);
  const anuncioPayload = {
    negocio_id: negocioId,
    laudo_v2_id: laudoV2Id,
    vendedor_id: VENDEDOR_ID_THIAGO,
    titulo,
    descricao_card: descricao,
    valor_pedido: valorPedido,
    termo_adesao_id: termoId,
    termo_assinado_em: new Date().toISOString(),
    status: 'rascunho',
    origem: 'maquininha_teste',
  };
  // status='rascunho' → anon NÃO pode SELECT. Logo, return=minimal pra evitar
  // que o pós-insert SELECT do PostgREST bata em RLS. Codigo é gerado por trigger;
  // como não conseguimos lê-lo via anon (rascunho), reportamos só negocio_id e
  // titulo no log — admin lê o codigo via SQL depois (ou após promover pra publicado).
  const anuResp = await fetch(`${SUPABASE_URL}/rest/v1/anuncios_v2`, {
    method: 'POST', headers: { ...H(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(anuncioPayload),
  });
  if (!anuResp.ok) throw new Error(`anuncios_v2 INSERT (${anuResp.status}): ${await anuResp.text()}`);
  console.log(`│  ✓ anúncio criado (rascunho) · titulo: '${titulo}'`);
  console.log(`└─ rascunho · valor R$ ${valorPedido.toLocaleString('pt-BR')} · descrição ${descricao.length} chars`);

  return {
    nome: id.nome,
    codigo_diag: codigo,
    codigo_anu: '(rascunho — codigo via SQL admin)',
    valor: valorPedido,
    ise: calcJson.ise.ise_total,
    negocio_id: negocioId,
    titulo,
    descricao,
  };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: node scripts/criar-anuncio-completo.js <perfil.json>  OR  --batch');
    process.exit(1);
  }

  let perfis = [];
  if (arg === '--batch') {
    const dir = path.join(__dirname, 'perfis-teste');
    perfis = fs.readdirSync(dir)
      .filter(f => /^seed-piloto-\d{2}\.json$/.test(f))
      .sort()
      .map(f => path.join(dir, f));
  } else {
    perfis = [arg];
  }

  console.log(`🔧 Processando ${perfis.length} perfil(is)...`);
  const resultados = [];
  for (const p of perfis) {
    try {
      const r = await processarPerfil(p);
      resultados.push(r);
      // Delay 2s entre cada (rate limit Anthropic)
      if (perfis.length > 1 && p !== perfis[perfis.length - 1]) {
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (e) {
      console.error(`❌ Falha em ${path.basename(p)}: ${e.message}`);
      resultados.push({ erro: e.message, perfil: path.basename(p) });
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('RESUMO FINAL');
  console.log('═══════════════════════════════════════════════');
  const sucessos = resultados.filter(r => !r.erro && !r.pulado);
  const pulados  = resultados.filter(r => r.pulado);
  const falhas   = resultados.filter(r => r.erro);
  console.log(`✓ ${sucessos.length} sucessos · ⊘ ${pulados.length} pulados (RO<0) · ❌ ${falhas.length} falhas`);
  resultados.forEach((r, i) => {
    if (r.erro) {
      console.log(`${i+1}. ❌ ${r.perfil}: ${r.erro}`);
    } else if (r.pulado) {
      console.log(`${i+1}. ⊘ ${r.perfil}: pulado · RO anual R$ ${Math.round(r.ro_anual).toLocaleString('pt-BR')}`);
    } else {
      console.log(`${i+1}. ${r.nome}`);
      console.log(`   Diag: ${r.codigo_diag}  |  Anúncio: ${r.codigo_anu}  |  Valor: R$ ${r.valor.toLocaleString('pt-BR')}  |  ISE: ${r.ise}`);
      console.log(`   Título: "${r.titulo}"`);
      console.log(`   URL: https://1negocio.com.br/laudo-pago.html?id=${r.negocio_id}`);
    }
  });
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
