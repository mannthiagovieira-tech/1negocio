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

const SB_URL = process.env.SUPABASE_URL || 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

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

    // 3) Kipflow · busca similares com faixas do arquétipo (A1 padrão: 3x-15x)
    // simplificação: usa arquétipo do lote; faixa fixa por código
    const FX = { A1:{min:3,max:15,uf_diff:false}, A2:{min:0.8,max:3,uf_diff:false}, A5:{min:2,max:10,uf_diff:true}, A6:{min:1,max:5,uf_diff:false} };
    const fx = FX[lote.arquetipo_codigo] || { min:0.5, max:5, uf_diff:false };
    const andBlocks = [
      { $or: [{ situacao_cadastral: 'ATIVA' }] },
      { $or: [{ matriz: true }] },
      { $or: [{ cnae_principal_classe: semCnae }] },
      { $or: [{ cnpj: { $nin: [String(p.cnpj).replace(/\D/g,'')] } }] },
    ];
    if (semFat > 0) {
      andBlocks.push({ $or: [{ faturamento: { $gte: Math.round(semFat*fx.min) } }] });
      andBlocks.push({ $or: [{ faturamento: { $lte: Math.round(semFat*fx.max) } }] });
    }
    if (semUf) andBlocks.push({ $or: [{ uf: fx.uf_diff ? { $nin:[semUf] } : semUf }] });

    // Pede sem ao Kipflow: meta_quantidade + 30% de folga (pra descontar duplicados)
    const size = Math.min(1000, Math.max(1, Math.ceil(lote.meta_quantidade * 1.3)));
    const rK = await fetch('https://api.kipflow.io/companies/v1/search', {
      method:'POST',
      headers: { 'X-API-Key':KEY, 'Content-Type':'application/json', Accept:'application/json' },
      body: JSON.stringify({ $filter:{$and:andBlocks}, $page:0, $size:size, datasets:['basic','partners'] }),
    });
    if (!rK.ok) {
      resultado.push({projeto_id:p.id, lote_id:loteId, status:'kipflow_erro', http:rK.status, detalhe:(await rK.text()).slice(0,200)});
      continue;
    }
    const kip = await rK.json();
    const lista = Array.isArray(kip.data) ? kip.data : [];

    // 4) importa até meta_quantidade (dedup: skip se já contato no projeto)
    let importados = 0; const cnpjsImp = [];
    for (const e of lista) {
      if (importados >= lote.meta_quantidade) break;
      const cnpj = String(e.cnpj||'').replace(/\D/g,'');
      if (cnpj.length !== 14 || cnpj === String(p.cnpj).replace(/\D/g,'')) continue;
      const rDup = await fetch(`${SB_URL}/rest/v1/va_contatos?projeto_id=eq.${p.id}&cnpj=eq.${cnpj}&select=id`, { headers: sbHeaders });
      if (((await rDup.json())||[]).length>0) continue;

      // upsert empresa com dados do basic+partners
      const upEmp = {
        cnpj, razao_social: e.razao_social || null, nome_fantasia: e.nome_fantasia || null,
        cidade: e.municipio || null, estado: e.uf || null,
        cnae_codigo: String(e.cnae_principal_classe||'')||null,
        cnae_descricao: e.cnae_principal_desc_classe || null,
        porte_categoria: e.porte || null,
        socios: Array.isArray(e.socios) ? e.socios : null,
        enriquecido_em: new Date().toISOString(), enriquecido_por: 'kipflow',
      };
      const rUp = await fetch(`${SB_URL}/rest/v1/va_empresas?on_conflict=cnpj`, {
        method:'POST', headers:{...sbHeaders, Prefer:'resolution=merge-duplicates,return=representation'},
        body: JSON.stringify(upEmp),
      });
      const [empRow] = await rUp.json();

      const { decisor, extras } = escolherDecisor(empRow?.socios || null);
      const rCt = await fetch(`${SB_URL}/rest/v1/va_contatos`, {
        method:'POST', headers:{...sbHeaders, Prefer:'return=representation'},
        body: JSON.stringify({
          projeto_id: p.id, empresa_id: empRow?.id, cnpj,
          origem:'prospeccao', origem_detalhe:`lote semanal ${semanaAlvo} · ${lote.arquetipo_codigo}`,
          arquetipo_codigo: lote.arquetipo_codigo, trilha:'fria', estagio:'novo',
          empresa: empRow?.razao_social || null, cidade: empRow?.cidade || null, estado: empRow?.estado || null,
          nome: decisor?.nome_socio || null, cargo: decisor?.qualificacao_socio || null,
          socio_faixa_etaria: decisor?.faixa_etaria_socio || null,
          socio_data_entrada: decisor?.data_entrada_sociedade || null,
          socio_identificador: decisor?.nome_com_cnpj_cpf || null,
          socios_extras: extras,
        }),
      });
      if (rCt.ok) {
        importados++; cnpjsImp.push(cnpj);
        await fetch(`${SB_URL}/rest/v1/rpc/va_debitar`, {
          method:'POST', headers: sbHeaders,
          body: JSON.stringify({ p_projeto:p.id, p_tipo:'similares_import', p_qtd:1, p_referencia:`lote ${semanaAlvo} · CNPJ ${cnpj}`, p_ciclo:null }),
        });
      }
    }

    // 5) atualiza lote + monta notificação programada 'abertura_semana'
    const custo = (importados * 0.39).toFixed(2);
    await fetch(`${SB_URL}/rest/v1/va_projeto_lote_semanal?id=eq.${lote.id}`, {
      method:'PATCH', headers: sbHeaders,
      body: JSON.stringify({ importados, gerados: lista.length, custo_total: custo, cnpjs_importados: cnpjsImp, status: importados>0 ? 'importado' : 'gerado' }),
    });

    // Contexto da abertura (sem nomes de empresa; região agregada)
    const regioes = [...new Set(lista.slice(0, importados).map(e=>e.uf).filter(Boolean))].join(' e ');
    const setor = sement.ramo_de_atividade || sement.segmento || p.setor || 'segmento compatível';
    const corpo = importados > 0
      ? `Bom dia. Semana começando com ${importados} nova(s) empresa(s) identificada(s) para abordagem — ${setor.toLowerCase()} em ${regioes || 'diversas regiões'}, todas com porte compatível.\n\nVou trabalhar essas ao longo da semana e te aviso qualquer retorno relevante.`
      : `Bom dia. Esta semana não abrimos novo lote de prospecção (${lote.status === 'sem_saldo' ? 'saldo insuficiente' : 'sem match no filtro'}).\n\nVou seguir com os contatos que já estão em andamento e retomo a captação assim que possível.`;

    await fetch(`${SB_URL}/rest/v1/rpc/va_notificar`, {
      method:'POST', headers: sbHeaders,
      body: JSON.stringify({ p_projeto_id:p.id, p_tipo:'programada', p_subtipo:'abertura_semana', p_corpo:corpo, p_meta:{ lote_id: lote.id, importados } }),
    });
    resultado.push({ projeto_id:p.id, lote_id:lote.id, status:'ok', importados, custo });
  }

  return json(res, 200, { ok:true, semana_inicio:semanaAlvo, projetos:resultado });
};
