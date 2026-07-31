// /api/lote-semanal · Vercel Function · roda por cron (dom 20h · America/Sao_Paulo)
// Gera lote da semana para cada projeto ativo com gerar_automaticamente:
//   1) calcula breakdown (RPC va_lote_semanal_calcular)
//   2) planeja lote (RPC va_lote_semanal_planejar · rotaciona arquétipos)
//   3) chama Kipflow /companies/v1/search para trazer meta_quantidade CNPJs
//   4) insere em va_contatos c/ sócio decisor, debita similares_import
//   5) NÃO envia nada ao cliente — só monta abertura_semana em va_notificacoes
//
// Segurança: exige header x-cron-secret == process.env.CRON_SECRET.
// Também aceita JWT admin em Authorization.

const SB_URL = process.env.SUPABASE_URL;
const SB_ANON = process.env.SUPABASE_ANON_KEY;

const SIGLA_UF = {
  AC:'ACRE', AL:'ALAGOAS', AP:'AMAPA', AM:'AMAZONAS', BA:'BAHIA', CE:'CEARA',
  DF:'DISTRITO FEDERAL', ES:'ESPIRITO SANTO', GO:'GOIAS', MA:'MARANHAO',
  MT:'MATO GROSSO', MS:'MATO GROSSO DO SUL', MG:'MINAS GERAIS', PA:'PARA',
  PB:'PARAIBA', PR:'PARANA', PE:'PERNAMBUCO', PI:'PIAUI', RJ:'RIO DE JANEIRO',
  RN:'RIO GRANDE DO NORTE', RS:'RIO GRANDE DO SUL', RO:'RONDONIA', RR:'RORAIMA',
  SC:'SANTA CATARINA', SP:'SAO PAULO', SE:'SERGIPE', TO:'TOCANTINS',
};
const ufExtenso = v => { if (!v) return null; const s=String(v).trim().toUpperCase(); return s.length===2&&SIGLA_UF[s]?SIGLA_UF[s]:s; };

function json(res, code, body) { res.status(code).setHeader('Content-Type','application/json'); res.send(JSON.stringify(body)); }
async function lerBody(req) { if (req.body) return typeof req.body==='string'?JSON.parse(req.body):req.body; const c=[]; for await (const x of req) c.push(x); const r=Buffer.concat(c).toString('utf8'); return r?JSON.parse(r):{}; }
async function ehAdmin(tok) {
  if (!tok) return false;
  const r = await fetch(SB_URL+'/rest/v1/rpc/va_is_admin', { method:'POST', headers:{apikey:SB_ANON,Authorization:'Bearer '+tok,'Content-Type':'application/json'}, body:'{}' });
  return r.ok && (await r.json())===true;
}

function segundaDaSemana(d = new Date()) {
  const dt = new Date(d); const dow = dt.getUTCDay(); // 0=dom
  const diff = dow === 0 ? 1 : (1 - dow); // se domingo, +1 (segunda seguinte); senão volta pra segunda
  dt.setUTCDate(dt.getUTCDate() + diff);
  return dt.toISOString().slice(0,10);
}

function escolherDecisor(socios) {
  if (!Array.isArray(socios) || socios.length===0) return { decisor:null, extras:null };
  const admins = socios.filter(s => (s.qualificacao_socio||'').toUpperCase().includes('ADMINISTRADOR'));
  const pool = admins.length>0 ? admins : socios;
  const ord = [...pool].sort((a,b)=>{
    const da=a.data_entrada_sociedade?new Date(a.data_entrada_sociedade).getTime():Infinity;
    const db=b.data_entrada_sociedade?new Date(b.data_entrada_sociedade).getTime():Infinity;
    return da-db;
  });
  const dec = ord[0] || socios[0];
  const ex = socios.filter(s=>s!==dec);
  return { decisor: dec, extras: ex.length>0?ex:null };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { ok:false, erro:'method not allowed' });

  // Vercel Cron manda Authorization: Bearer <CRON_SECRET>. Também aceitamos x-cron-secret.
  const cronSecret = process.env.CRON_SECRET;
  const authRaw = req.headers.authorization || '';
  const tok = authRaw.replace(/^Bearer\s+/i,'').trim();
  const headerSecret = req.headers['x-cron-secret'] || '';
  const okCron = cronSecret && (tok === cronSecret || headerSecret === cronSecret);
  const okAdmin = !okCron && tok && (await ehAdmin(tok));
  if (!okCron && !okAdmin) return json(res, 403, { ok:false, erro:'não autorizado' });

  const KEY = process.env.KIPFLOW_API_KEY;
  if (!KEY) return json(res, 503, { ok:false, erro:'KIPFLOW_API_KEY não configurada' });
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_SERVICE) return json(res, 500, { ok:false, erro:'SUPABASE_SERVICE_ROLE_KEY não configurada' });

  const body = req.method === 'POST' ? await lerBody(req).catch(()=>({})) : {};
  const forcaProjetoId = body?.projeto_id || null;
  const semanaAlvo = body?.semana_inicio || segundaDaSemana();

  const sbHeaders = { apikey:SB_SERVICE, Authorization:'Bearer '+SB_SERVICE, 'Content-Type':'application/json' };

  // 1) Lista projetos ativos com gerar_automaticamente
  const filtro = forcaProjetoId ? `id=eq.${forcaProjetoId}` : `status=eq.ativo`;
  const rP = await fetch(`${SB_URL}/rest/v1/va_projetos?${filtro}&select=id,cnpj,cidade,uf,setor`, { headers: sbHeaders });
  const projetos = await rP.json();

  const resultado = [];
  for (const p of (Array.isArray(projetos)?projetos:[])) {
    // GATE ONDA · pula projetos não operacionais
    const rGate = await fetch(SB_URL+'/rest/v1/rpc/va_onda_operacional', {
      method:'POST', headers: sbHeaders, body: JSON.stringify({ p_projeto_id: p.id }),
    });
    const gate = await rGate.json();
    if (!gate?.operacional) { resultado.push({projeto_id:p.id, status:'skipped_onda_'+(gate?.status||'?'), mensagem: gate?.mensagem}); continue; }
    // GATE MODALIDADE
    const rMod = await fetch(SB_URL+'/rest/v1/rpc/va_etapa_ativa', {
      method:'POST', headers: sbHeaders, body: JSON.stringify({ p_projeto_id: p.id, p_etapa_chave: 'operacao' }),
    });
    if (!(await rMod.json())) { resultado.push({projeto_id:p.id, status:'skipped_modalidade_nao_libera'}); continue; }

    // 1a. cadência do projeto (skip se gerar_automaticamente=false, salvo em modo força)
    if (!forcaProjetoId) {
      const rC = await fetch(`${SB_URL}/rest/v1/va_disparo_cadencia?projeto_id=eq.${p.id}&select=gerar_automaticamente`, { headers: sbHeaders });
      const [cad] = await rC.json();
      if (cad && cad.gerar_automaticamente === false) { resultado.push({projeto_id:p.id, status:'skipped_auto_off'}); continue; }
    }
    // 1b. semente enriquecida?
    if (!p.cnpj) { resultado.push({projeto_id:p.id, status:'skipped_sem_cnpj'}); continue; }
    const rE = await fetch(`${SB_URL}/rest/v1/va_empresas?cnpj=eq.${p.cnpj}&select=enriquecimento_bruto`, { headers: sbHeaders });
    const [emp] = await rE.json();
    if (!emp?.enriquecimento_bruto) { resultado.push({projeto_id:p.id, status:'skipped_semente_nao_enriquecida'}); continue; }
    const sement = emp.enriquecimento_bruto.data || emp.enriquecimento_bruto;
    const semCnae = sement.cnae_principal_classe;
    const semSubclasse = sement.cnae_principal_subclasse;
    const semUf = ufExtenso(sement.uf || p.uf);
    const semFat = Number(sement.faturamento) || 0;

    // 2) planejar lote (RPC) — cria/atualiza va_projeto_lote_semanal
    const rPlan = await fetch(`${SB_URL}/rest/v1/rpc/va_lote_semanal_planejar`, {
      method:'POST', headers: sbHeaders,
      body: JSON.stringify({ p_projeto_id: p.id, p_semana_inicio: semanaAlvo, p_arquetipo: null }),
    });
    const loteId = await rPlan.json();
    const rL = await fetch(`${SB_URL}/rest/v1/va_projeto_lote_semanal?id=eq.${loteId}&select=*`, { headers: sbHeaders });
    const [lote] = await rL.json();
    if (!lote || lote.meta_quantidade === 0 || lote.status === 'sem_saldo') {
      resultado.push({projeto_id:p.id, lote_id:loteId, status:lote?.status||'sem_lote', importados:0});
      continue;
    }
    if (lote.status === 'importado') { // idempotente
      resultado.push({projeto_id:p.id, lote_id:loteId, status:'ja_importado_pulado', importados:lote.importados});
      continue;
    }

    // 3) Kipflow · busca similares
    // GATE 1: sem faturamento na semente → sem âncora de porte
    if (semFat <= 0) {
      resultado.push({projeto_id:p.id, lote_id:loteId, status:'skipped_semente_sem_faturamento'});
      continue;
    }
    // GATE 2 (novo): queries_busca do arquétipo é obrigatório · não deduzimos CNAE da semente
    const rArq = await fetch(`${SB_URL}/rest/v1/va_projeto_arquetipos?projeto_id=eq.${p.id}&codigo=eq.${lote.arquetipo_codigo}&select=queries_busca`, { headers: sbHeaders });
    const [arqRow] = await rArq.json();
    const queries = Array.isArray(arqRow?.queries_busca) ? arqRow.queries_busca.filter(Boolean) : [];
    if (queries.length === 0) {
      // arquétipo não calibrado — grava audit + notifica admin (imediata)
      await fetch(`${SB_URL}/rest/v1/rpc/va_notificar`, {
        method:'POST', headers: sbHeaders,
        body: JSON.stringify({
          p_projeto_id: p.id, p_tipo: 'imediata', p_subtipo: 'arquetipo_nao_calibrado',
          p_corpo: `Arquétipo ${lote.arquetipo_codigo} sem queries_busca — lote da semana ${semanaAlvo} não foi gerado. Calibre o arquétipo com CNAEs (número) ou palavras-chave (texto) na tela de arquétipos.`,
          p_meta: { projeto_id: p.id, lote_id: lote.id, arquetipo: lote.arquetipo_codigo },
        }),
      });
      await fetch(`${SB_URL}/rest/v1/va_projeto_lote_semanal?id=eq.${lote.id}`, {
        method:'PATCH', headers: sbHeaders,
        body: JSON.stringify({ status:'cancelado', observacao:'arquetipo_nao_calibrado_queries_busca_vazio' }),
      });
      resultado.push({projeto_id:p.id, lote_id:lote.id, status:'arquetipo_nao_calibrado'});
      continue;
    }

    const FX = { A1:{min:3,max:15,uf_diff:false}, A2:{min:0.8,max:3,uf_diff:false}, A5:{min:2,max:10,uf_diff:true}, A6:{min:1,max:5,uf_diff:false} };
    const fx = FX[lote.arquetipo_codigo] || { min:0.5, max:5, uf_diff:false };

    // Monta $or com queries do arquétipo: número vira CNAE (classe/subclasse),
    // string vira $fuzzy em razao_social.
    const orQueries = [];
    for (const q of queries) {
      const s = String(q).trim();
      if (/^\d{4,7}$/.test(s)) {
        // CNAE — 4-5 dígitos = classe; 7 dígitos = subclasse
        const chave = s.length >= 7 ? 'cnae_principal_subclasse' : 'cnae_principal_classe';
        orQueries.push({ [chave]: Number(s) });
      } else if (s.length > 0) {
        orQueries.push({ razao_social: { $fuzzy: s } });
      }
    }
    if (orQueries.length === 0) {
      resultado.push({projeto_id:p.id, lote_id:lote.id, status:'arquetipo_queries_invalidas'});
      continue;
    }

    const andBlocks = [
      { $or: [{ situacao_cadastral: 'ATIVA' }] },
      { $or: [{ matriz: true }] },
      { $or: orQueries }, // ← queries do arquétipo (CNAE numérico ou keyword fuzzy)
      { $or: [{ faturamento: { $gte: Math.round(semFat*fx.min) } }] },
      { $or: [{ faturamento: { $lte: Math.round(semFat*fx.max) } }] },
      { $or: [{ cnpj: { $nin: [String(p.cnpj).replace(/\D/g,'')] } }] },
    ];
    if (semUf) andBlocks.push({ $or: [{ uf: fx.uf_diff ? { $nin:[semUf] } : semUf }] });

    const size = Math.min(1000, Math.max(5, lote.meta_quantidade * 3));
    const filtrosSnapshot = {
      queries_do_arquetipo: queries,
      fat_min: Math.round(semFat*fx.min), fat_max: Math.round(semFat*fx.max),
      uf: semUf, uf_diferente: fx.uf_diff, arquetipo: lote.arquetipo_codigo, size,
    };
    const rK = await fetch('https://api.kipflow.io/companies/v1/search', {
      method:'POST',
      headers: { 'X-API-Key':KEY, 'Content-Type':'application/json', Accept:'application/json' },
      body: JSON.stringify({ $filter:{$and:andBlocks}, $page:0, $size:size, datasets:['basic','complete','address','partners'] }),
    });
    if (!rK.ok) {
      resultado.push({projeto_id:p.id, lote_id:loteId, status:'kipflow_erro', http:rK.status, detalhe:(await rK.text()).slice(0,200)});
      continue;
    }
    const kip = await rK.json();
    // Ordena por faturamento desc (aproximação de "maiores primeiro")
    const lista = (Array.isArray(kip.data) ? kip.data : [])
      .slice()
      .sort((a,b) => (Number(b.faturamento)||0) - (Number(a.faturamento)||0));

    // 4) INSERE EM va_prospeccao_bruta (antessala) — NÃO cria contato, NÃO debita.
    // Enriquecimento e promoção passam pela tela de TRIAGEM.
    let inseridosAntessala = 0; let dupAntessala = 0; const cnpjsIns = [];
    const refFiltros = `lote ${semanaAlvo} · ${lote.arquetipo_codigo} · queries=[${queries.join('|')}] · fat[${filtrosSnapshot.fat_min}-${filtrosSnapshot.fat_max}] · uf=${semUf||''}${fx.uf_diff?'(diff)':''}`;
    for (const e of lista) {
      if (inseridosAntessala >= lote.meta_quantidade) break;
      const cnpj = String(e.cnpj||'').replace(/\D/g,'');
      if (cnpj.length !== 14 || cnpj === String(p.cnpj).replace(/\D/g,'')) continue;

      // Dedup na antessala + kanban
      const rDupAnt = await fetch(`${SB_URL}/rest/v1/va_prospeccao_bruta?projeto_id=eq.${p.id}&cnpj=eq.${cnpj}&select=id`, { headers: sbHeaders });
      if (((await rDupAnt.json())||[]).length>0) { dupAntessala++; continue; }
      const rDupKb = await fetch(`${SB_URL}/rest/v1/va_contatos?projeto_id=eq.${p.id}&cnpj=eq.${cnpj}&select=id`, { headers: sbHeaders });
      if (((await rDupKb.json())||[]).length>0) { dupAntessala++; continue; }

      // Extrai telefone se veio (Kipflow /companies/v1/search hoje não expõe — mas guardamos se aparecer)
      const telefones = Array.isArray(e.telefones) ? e.telefones : [];
      const telWpp = telefones.find(t => t.whatsapp === true && t.pertence_contador === false)
                 || telefones.find(t => t.whatsapp === true)
                 || telefones[0] || null;
      const decisorPre = escolherDecisor(Array.isArray(e.socios) ? e.socios : null);

      const insBody = {
        projeto_id: p.id, arquetipo_codigo: lote.arquetipo_codigo,
        fonte:'kipflow', fonte_detalhe: refFiltros, lote_id: lote.id,
        razao_social: e.razao_social || null,
        cnpj,
        telefone: telWpp?.telefone_completo || null,
        telefone_normalizado: telWpp ? (telWpp.telefone_completo||'').replace(/\D/g,'') : null,
        cidade: e.municipio || null, estado: e.uf || null,
        cnae: String(e.cnae_principal_classe||'')||null,
        porte_faturamento: typeof e.faturamento === 'number' ? e.faturamento : null,
        socios: Array.isArray(e.socios) ? e.socios : null,
        nome: decisorPre?.decisor?.nome_socio || null,
        payload_bruto: {
          fonte:'kipflow', filtros: filtrosSnapshot,
          cnae_principal_desc_classe: e.cnae_principal_desc_classe || null,
          faixa_faturamento_grupo: e.faixa_faturamento_grupo || null,
          porte: e.porte || null,
          whatsapp: telWpp?.whatsapp === true,
        },
      };
      const rIns = await fetch(`${SB_URL}/rest/v1/va_prospeccao_bruta`, {
        method:'POST', headers:{...sbHeaders, Prefer:'return=representation'},
        body: JSON.stringify(insBody),
      });
      const arrIns = await rIns.json();
      const prospId = Array.isArray(arrIns) ? arrIns[0]?.id : null;
      if (prospId) {
        inseridosAntessala++; cnpjsIns.push(cnpj);
        // Qualifica imediatamente (marca sem_telefone etc)
        await fetch(`${SB_URL}/rest/v1/rpc/va_qualificar_prospeccao`, {
          method:'POST', headers: sbHeaders, body: JSON.stringify({ p_id: prospId }),
        });
      }
    }

    // 5) atualiza lote + grava AUDIT imutável (sem FK)
    // Nada foi debitado aqui — apenas raspagem Kipflow gerou custo (não medimos aqui);
    // enriquecimento/promoção ficam pra triagem e cobram na hora certa.
    await fetch(`${SB_URL}/rest/v1/va_projeto_lote_semanal?id=eq.${lote.id}`, {
      method:'PATCH', headers: sbHeaders,
      body: JSON.stringify({
        importados: 0, gerados: lista.length, custo_total: 0, cnpjs_importados: cnpjsIns,
        status: inseridosAntessala>0 ? 'gerado' : 'sem_match',
        observacao: `antessala · inseridos=${inseridosAntessala} dup=${dupAntessala}`,
      }),
    });
    await fetch(`${SB_URL}/rest/v1/va_lote_audit`, {
      method:'POST', headers: sbHeaders,
      body: JSON.stringify({
        projeto_id: p.id, semana_inicio: semanaAlvo, arquetipo_codigo: lote.arquetipo_codigo,
        cnpj_semente: String(p.cnpj).replace(/\D/g,''),
        filtros_aplicados: filtrosSnapshot, breakdown: lote.breakdown,
        meta_quantidade: lote.meta_quantidade, gerados: lista.length,
        importados: inseridosAntessala, skip_sem_telefone: 0, custo_total: 0,
        cnpjs_importados: cnpjsIns,
        kipflow_response_amostra: lista.slice(0,3).map(e => ({ cnpj:e.cnpj, razao:e.razao_social, fat:e.faturamento, municipio:e.municipio, uf:e.uf })),
        status: inseridosAntessala>0 ? 'inserido_antessala' : 'sem_match',
      }),
    });

    // Aviso de segunda: menciona que N leads brutos foram pra triagem (não importados)
    const setor = sement.ramo_de_atividade || sement.segmento || p.setor || 'segmento compatível';
    const corpo = inseridosAntessala > 0
      ? `Bom dia. Semana começando com ${inseridosAntessala} lead(s) brutos identificados na base — ${setor.toLowerCase()}, dentro da faixa de porte compatível.\n\nVou triar essa lista, enriquecer os que fizerem sentido e te aviso qualquer retorno relevante.`
      : `Bom dia. Esta semana não abrimos novo lote de prospecção (${lote.status === 'sem_saldo' ? 'saldo insuficiente' : 'sem match no filtro'}).\n\nVou seguir com os contatos que já estão em andamento e retomo a captação assim que possível.`;

    await fetch(`${SB_URL}/rest/v1/rpc/va_notificar`, {
      method:'POST', headers: sbHeaders,
      body: JSON.stringify({ p_projeto_id:p.id, p_tipo:'programada', p_subtipo:'abertura_semana', p_corpo:corpo, p_meta:{ lote_id: lote.id, brutos: inseridosAntessala } }),
    });
    resultado.push({ projeto_id:p.id, lote_id:lote.id, status:'ok', brutos_antessala: inseridosAntessala, duplicados: dupAntessala });
  }

  return json(res, 200, { ok:true, semana_inicio:semanaAlvo, projetos:resultado });
};
