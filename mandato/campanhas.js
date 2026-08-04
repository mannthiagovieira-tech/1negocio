// Zona MÁQUINA · aba CAMPANHAS · Slice P5 A (criativos)
// Galeria de criativos gerados via IA + render server-side em PNG.
// Slice B (campanhas Meta) + C (desemboque) virão em cima disso.

import { sb } from './core/core.js';
import { esc, brl } from './core/format.js';
import { toast } from './core/ui.js';

let MANDATO = null;
let CRIATIVOS = [];
let ARQUETIPOS = [];
let CAMPANHAS = [];
let METRICAS = null;
let PRECO_CRIATIVO = null;
let TEMPLATES = []; // P5.1 · templates globais

export async function mountCampanhas(mandato) {
  MANDATO = mandato;
  const root = document.getElementById('mq-panel-campanhas');
  root.innerHTML = `
    <section class="page" style="padding-top:8px">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0">Criativos</h2>
          <p class="muted mono" style="font-size:11px;margin:2px 0 0">Copy IA + render server-side em 3 formatos Meta · aprovado congela.</p>
        </div>
        <div id="cmp-status" class="mono muted" style="font-size:11px"></div>
      </header>
      <!-- P5.1 · seção CRIAR DO TEMPLATE (biblioteca global · sem IA · sem débito) -->
      <div style="padding:10px 12px;border:1px solid var(--divisor);border-radius:8px;margin-bottom:14px">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>Criar do template</b>
          <span class="muted mono" style="font-size:10.5px">sem IA · sem débito · resolvido dos dados do mandato</span>
        </div>
        <div id="cmp-templates"><div class="muted mono" style="font-size:11px">Carregando templates…</div></div>
      </div>

      <!-- P5.1 · seção SUBIR ARTE PRÓPRIA -->
      <div style="padding:10px 12px;border:1px solid var(--divisor);border-radius:8px;margin-bottom:14px">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">
          <b>Subir arte própria</b>
          <span class="muted mono" style="font-size:10.5px">PNG/JPG até 5MB · validar sigilo manualmente</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
          <label>formato
            <select id="cmp-up-fmt">
              <option value="feed_1080">feed 1080×1080</option>
              <option value="story_1080x1920">story 1080×1920</option>
              <option value="link_1200x628">link 1200×628</option>
            </select>
          </label>
          <label>arquivo
            <input type="file" id="cmp-up-file" accept="image/png,image/jpeg">
          </label>
          <button class="btn btn--sm btn--primary" id="cmp-up-btn" disabled>Subir</button>
        </div>
      </div>

      <!-- Copy livre com IA (opção secundária · continua funcionando) -->
      <details style="padding:10px 12px;border:1px solid var(--divisor);border-radius:8px;margin-bottom:14px">
        <summary style="cursor:pointer"><b>Copy livre com IA</b> <span class="muted mono" style="font-size:10.5px">— gera 4 variações via Sonnet · custa por chamada</span></summary>
        <div class="cad-config-grid" style="margin-top:10px">
        <label>arquétipo
          <select id="cmp-arq"><option value="">— escolha —</option></select>
        </label>
        <label>formato
          <select id="cmp-fmt">
            <option value="feed_1080">feed (1080×1080)</option>
            <option value="story_1080x1920">story (1080×1920)</option>
            <option value="link_1200x628">link (1200×628)</option>
          </select>
        </label>
        <label>layout
          <select id="cmp-lay">
            <option value="tipografico_a">tipográfico A (headline dominante)</option>
            <option value="tipografico_b">tipográfico B (texto de suporte)</option>
            <option value="dado_destaque">dado destaque (número grande)</option>
          </select>
        </label>
        <label>incluir valor
          <select id="cmp-val">
            <option value="false">não</option>
            <option value="true">sim (2 das 4 variações)</option>
          </select>
        </label>
        <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span class="mono muted" style="font-size:11px" id="cmp-custo">custo: —</span>
          <button class="btn btn--sm btn--primary" id="cmp-gerar">Gerar com IA</button>
        </div>
        </div>
      </details>
      <div id="cmp-galeria"><div class="muted">Carregando…</div></div>

      <hr style="border:none;border-top:1px solid var(--divisor);margin:28px 0">

      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0">Campanhas</h2>
          <p class="muted mono" style="font-size:11px;margin:2px 0 0">CTWA no Meta · nasce PAUSADA · operador ativa no Ads Manager. Débito de mídia = gasto real × 1,5.</p>
        </div>
        <div id="cmp-metricas" class="mono muted" style="font-size:11px"></div>
      </header>
      <div style="padding:10px 12px;border:1px solid var(--divisor);border-radius:8px;margin-bottom:14px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <b>Nova campanha</b>
          <button class="btn btn--sm btn--primary" id="cmp-nova">+ Criar rascunho</button>
        </div>
        <p class="muted mono" style="font-size:11px;margin:6px 0 0">Escolha 1 criativo aprovado · público pré-preenche do arquétipo · orçamento e datas editáveis antes de aprovar.</p>
      </div>
      <div id="cmp-campanhas"><div class="muted">Carregando…</div></div>
    </section>
  `;
  await recarregar();
  bindGerador();
  document.getElementById('cmp-nova').addEventListener('click', criarCampanha);
}

async function recarregar() {
  const [arqR, criR, cmpR, metR, projR, tplR] = await Promise.all([
    sb.from('va_arquetipos').select('id, nome, abordagem').eq('projeto_id', MANDATO.id).in('status', ['aprovado','arquivado']).order('criado_em', { ascending: false }),
    sb.from('va_criativos').select('*').eq('projeto_id', MANDATO.id).order('criado_em', { ascending: false }),
    sb.from('va_campanhas').select('*').eq('projeto_id', MANDATO.id).order('criado_em', { ascending: false }),
    sb.from('va_projetos_metricas_campanhas').select('*').eq('projeto_id', MANDATO.id).maybeSingle(),
    sb.from('va_projetos').select('precos_versao_id').eq('id', MANDATO.id).maybeSingle(),
    sb.from('va_criativo_templates').select('*').eq('status', 'ativo').order('nome'),
  ]);
  ARQUETIPOS = arqR.data || [];
  CRIATIVOS = criR.data || [];
  CAMPANHAS = cmpR.data || [];
  METRICAS = metR.data || null;
  TEMPLATES = tplR.data || [];
  let versaoId = projR.data?.precos_versao_id || null;
  if (!versaoId) {
    const v = await sb.from('va_precos_versao').select('id').eq('vigente', true).limit(1).maybeSingle();
    versaoId = v.data?.id || null;
  }
  if (versaoId) {
    const p = await sb.from('va_precos').select('preco').eq('tipo', 'ia_geracao_criativo').eq('ativo', true).eq('versao_id', versaoId).maybeSingle();
    PRECO_CRIATIVO = p.data?.preco != null ? Number(p.data.preco) : null;
  }
  renderGerador();
  renderGaleria();
  renderStatus();
  renderCampanhas();
  renderMetricas();
  renderTemplates();
}

function renderTemplates() {
  const el = document.getElementById('cmp-templates');
  if (!el) return;
  if (!TEMPLATES.length) {
    el.innerHTML = '<div class="muted mono" style="font-size:11px">Nenhum template ativo.</div>';
    return;
  }
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px">${TEMPLATES.map(templateHTML).join('')}</div>`;
  document.querySelectorAll('[data-tpl-gen]').forEach(b => b.addEventListener('click', () => gerarDoTemplate(b.dataset.tplGen)));
}
function templateHTML(t) {
  const obrigs = Array.isArray(t.campos_obrigatorios) ? t.campos_obrigatorios : [];
  const aspect = t.formato === 'story_1080x1920' ? '9/16' : (t.formato === 'link_1200x628' ? '1200/628' : '1/1');
  return `
    <div class="tpl-item" data-tid="${t.id}">
      <div style="background:#f3f4f6;border-radius:6px;aspect-ratio:${aspect};display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px;text-align:center">
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:14px;letter-spacing:-0.5px">${esc(t.nome)}</div>
        <div class="mono muted" style="font-size:9px;margin-top:4px">${esc(t.formato.replace('_',' '))}</div>
      </div>
      <div class="mono" style="font-size:10.5px;color:var(--ink-3);margin-top:6px;line-height:1.35">${esc(t.descricao || '')}</div>
      <div class="mono" style="font-size:9.5px;color:var(--ink-3);margin-top:4px">requer: ${obrigs.join(', ') || '(sem)'}</div>
      <button class="btn btn--xs btn--primary" style="margin-top:6px;width:100%" data-tpl-gen="${t.id}">Gerar do template</button>
    </div>
  `;
}
async function gerarDoTemplate(templateId) {
  const btn = document.querySelector(`[data-tpl-gen="${templateId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'gerando…'; }
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-gerar-do-template', {
      method: 'POST', headers: { 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ projeto_id: MANDATO.id, template_id: templateId }),
    });
    const raw = await r.text(); let d = null;
    try { d = JSON.parse(raw); } catch { throw new Error('HTTP ' + r.status + ' · ' + raw.slice(0, 160)); }
    if (r.status === 422 && d.faltando) {
      toast('err', 'Template indisponível — falta: ' + d.faltando.join(', '));
      return;
    }
    if (!r.ok || !d.ok) throw new Error(d.erro || 'HTTP ' + r.status);
    toast('ok', 'Rascunho criado · renderizando…');
    await recarregar();
    if (d.criativo_id) await renderCriativo(d.criativo_id, /*silent*/ true);
  } catch (e) {
    console.error('[gerarDoTemplate]', e);
    toast('err', 'Template: ' + String(e.message).slice(0, 220));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Gerar do template'; }
  }
}
async function subirArte() {
  const file = document.getElementById('cmp-up-file').files[0];
  const formato = document.getElementById('cmp-up-fmt').value;
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toast('err', 'PNG > 5MB'); return; }
  const b64 = await new Promise((resolve, reject) => {
    const rd = new FileReader();
    rd.onload = () => resolve(String(rd.result).split(',')[1]);
    rd.onerror = reject;
    rd.readAsDataURL(file);
  });
  const btn = document.getElementById('cmp-up-btn');
  btn.disabled = true; btn.textContent = 'subindo…';
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-upload-criativo', {
      method: 'POST', headers: { 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ projeto_id: MANDATO.id, formato, png_base64: b64, nome: file.name.slice(0, 80) }),
    });
    const raw = await r.text(); let d = null;
    try { d = JSON.parse(raw); } catch { throw new Error('HTTP ' + r.status + ' · ' + raw.slice(0, 160)); }
    if (!r.ok || !d.ok) throw new Error(d.erro || 'HTTP ' + r.status);
    let msg = 'Enviado';
    if (d.aviso_dims) msg += ' · ⚠ ' + d.aviso_dims;
    toast('ok', msg);
    await recarregar();
  } catch (e) {
    console.error('[subirArte]', e);
    toast('err', 'Upload: ' + String(e.message).slice(0, 220));
  } finally {
    btn.disabled = true; btn.textContent = 'Subir';
    document.getElementById('cmp-up-file').value = '';
  }
}

function renderMetricas() {
  const el = document.getElementById('cmp-metricas');
  if (!el) return;
  const m = METRICAS || { n_campanhas:0, n_ativas:0, gasto_total:0, conversas_geradas:0, custo_medio_por_conversa:null };
  el.textContent = `${m.n_campanhas} campanha(s) · ${m.n_ativas} ativa(s) · gasto ${brl(m.gasto_total || 0)} · ${m.conversas_geradas} conversas · custo/conv ${m.custo_medio_por_conversa != null ? brl(m.custo_medio_por_conversa) : '—'}`;
}

function renderCampanhas() {
  const el = document.getElementById('cmp-campanhas');
  if (!el) return;
  if (!CAMPANHAS.length) {
    el.innerHTML = `<div class="muted mono" style="font-size:12px;padding:12px;text-align:center">Nenhuma campanha ainda. Aprove um criativo e clique "+ Criar rascunho".</div>`;
    return;
  }
  el.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">${CAMPANHAS.map(campanhaHTML).join('')}</div>`;
  bindCampanhaCards();
}

function campanhaHTML(c) {
  const cri = CRIATIVOS.find(x => x.id === c.criativo_id);
  const arq = ARQUETIPOS.find(x => x.id === c.arquetipo_id);
  const nConversas = ('n_conversas' in c) ? c.n_conversas : '—';
  const statusPill = {
    rascunho:  '<span class="pill pill--tpl-no">rascunho</span>',
    aprovada:  '<span class="pill pill--tpl-ok">aprovada</span>',
    publicada: '<span class="pill" style="background:#dbeafe;color:#1e40af">publicada (PAUSED no Meta)</span>',
    ativa:     '<span class="pill pill--ativa">ATIVA</span>',
    pausada:   '<span class="pill pill--pausada">pausada</span>',
    encerrada: '<span class="pill" style="background:#e5e7eb;color:#4b5563">encerrada</span>',
  }[c.status] || c.status;
  return `
    <div class="tpl-item" data-cid="${c.id}">
      <div class="tpl-item__head">
        <div class="tpl-item__nome">${esc(c.nome)} ${statusPill}</div>
        <div class="tpl-item__pills mono" style="font-size:10.5px;color:var(--ink-3)">
          orç ${brl(c.orcamento_diario||0)}/dia · gasto ${brl(c.gasto_acumulado||0)}${c.meta_campaign_id?` · camp ${esc(String(c.meta_campaign_id).slice(-8))}`:''}
        </div>
      </div>
      <div class="mono" style="font-size:11px;margin:4px 0">
        Criativo: <b>${esc(cri?.headline || '(sem)')}</b> · Arquétipo: ${esc(arq?.nome?.slice(0,50) || '(sem)')}
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
        ${c.status === 'rascunho' ? `<button class="btn btn--xs" data-editcmp="${c.id}">Editar</button>` : ''}
        ${c.status === 'rascunho' ? `<button class="btn btn--xs btn--primary" data-aprovcmp="${c.id}">Aprovar</button>` : ''}
        ${c.status === 'aprovada' ? `<button class="btn btn--xs" data-drycmp="${c.id}" title="SPEC + payload sem publicar">Ver SPEC</button>` : ''}
        ${c.status === 'aprovada' ? `<button class="btn btn--xs btn--primary" data-pubcmp="${c.id}" title="publica no Meta em PAUSED">Publicar no Meta</button>` : ''}
        ${['aprovada','publicada','ativa','pausada'].includes(c.status) ? `<button class="btn btn--xs" data-lancargasto="${c.id}" title="lançar gasto real do dia (débito ×1,5)">Lançar gasto</button>` : ''}
        <button class="btn btn--xs" data-delcmp="${c.id}" title="descartar rascunho">Descartar</button>
      </div>
    </div>
  `;
}

function bindCampanhaCards() {
  document.querySelectorAll('[data-editcmp]').forEach(b => b.addEventListener('click', () => editarCampanha(b.dataset.editcmp)));
  document.querySelectorAll('[data-aprovcmp]').forEach(b => b.addEventListener('click', () => aprovarCampanha(b.dataset.aprovcmp)));
  document.querySelectorAll('[data-drycmp]').forEach(b => b.addEventListener('click', () => publicarCampanha(b.dataset.drycmp, true)));
  document.querySelectorAll('[data-pubcmp]').forEach(b => b.addEventListener('click', () => publicarCampanha(b.dataset.pubcmp, false)));
  document.querySelectorAll('[data-lancargasto]').forEach(b => b.addEventListener('click', () => lancarGasto(b.dataset.lancargasto)));
  document.querySelectorAll('[data-delcmp]').forEach(b => b.addEventListener('click', () => descartarCampanha(b.dataset.delcmp)));
}

async function criarCampanha() {
  const aprovados = CRIATIVOS.filter(c => c.status === 'aprovado' && c.png_path);
  if (!aprovados.length) { toast('err', 'Aprove pelo menos 1 criativo antes'); return; }
  abrirBuilderPublico(null, aprovados);
}

// P5.2 · builder do público em camadas · modal estruturado
function abrirBuilderPublico(campanhaExistente, aprovados) {
  const c = campanhaExistente || {};
  const p = c.publico || {};
  const geo = p.geo || { modo: 'ufs', ufs: [MANDATO.uf || 'RJ'], cidades: [] };
  const html = `<div class="drw-bg" onclick="if(event.target===this)this.remove()">
    <div class="drw" style="max-width:640px">
      <button class="btn btn--sm" onclick="this.closest('.drw-bg').remove()" style="float:right">Fechar</button>
      <h3>${campanhaExistente ? 'Editar' : 'Nova'} campanha</h3>
      <div class="cad-config-grid" style="margin-top:8px">
        <label>Nome
          <input id="pub-nome" type="text" value="${esc(c.nome || ('Campanha ' + new Date().toISOString().slice(0,10)))}">
        </label>
        <label>Criativo aprovado
          <select id="pub-cri">
            ${aprovados.map(cr => `<option value="${cr.id}" ${cr.id===c.criativo_id?'selected':''}>${esc((cr.formato||'')+' · '+(cr.headline||'').slice(0,40))}</option>`).join('')}
          </select>
        </label>
        <label>Objetivo
          <select id="pub-obj">
            <option value="ctwa" ${c.objetivo_meta==='ctwa'?'selected':''}>CTWA (WhatsApp)</option>
            <option value="leadgen" ${c.objetivo_meta==='leadgen'?'selected':''}>Lead Gen (form no anúncio)</option>
            <option value="trafego" ${c.objetivo_meta==='trafego'?'selected':''}>Tráfego (link externo)</option>
          </select>
        </label>
        <label>Orçamento diário (R$)
          <input id="pub-orc" type="number" min="5" max="10000" value="${c.orcamento_diario || 30}">
        </label>
        <label>Duração (dias)
          <input id="pub-dias" type="number" min="1" max="90" value="14">
        </label>
      </div>
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--divisor)">
      <h4 style="margin:0 0 8px 0">Geo</h4>
      <div class="row">
        <label><input type="radio" name="pub-geo-modo" value="ufs" ${geo.modo!=='cidades'?'checked':''}> UFs</label>
        <label><input type="radio" name="pub-geo-modo" value="cidades" ${geo.modo==='cidades'?'checked':''}> Cidades (raio)</label>
      </div>
      <div id="pub-geo-body" style="margin-top:8px"></div>
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--divisor)">
      <h4 style="margin:0 0 8px 0">Demografia</h4>
      <div class="cad-config-grid">
        <label>Idade mín <input id="pub-imin" type="number" min="18" max="65" value="${p.idade_min || 30}"></label>
        <label>Idade máx <input id="pub-imax" type="number" min="18" max="65" value="${p.idade_max || 60}"></label>
        <label>Gênero
          <select id="pub-gen">
            <option value="todos" ${!p.genero||p.genero==='todos'?'selected':''}>todos</option>
            <option value="homens" ${p.genero==='homens'?'selected':''}>homens</option>
            <option value="mulheres" ${p.genero==='mulheres'?'selected':''}>mulheres</option>
          </select>
        </label>
      </div>
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--divisor)">
      <h4 style="margin:0 0 8px 0">Interesses</h4>
      <div class="row" style="gap:6px">
        <input id="pub-int-q" type="text" placeholder="buscar (ex: pequenas empresas)" style="flex:1;padding:6px 8px">
        <button class="btn btn--sm" id="pub-int-buscar">Buscar</button>
      </div>
      <div id="pub-int-sugestoes" class="mono" style="font-size:11px;margin-top:6px;max-height:120px;overflow:auto"></div>
      <div id="pub-int-selecionados" style="margin-top:8px"></div>
      <label style="margin-top:10px;display:flex;align-items:center;gap:6px">
        <input id="pub-adv" type="checkbox" ${p.advantage_detailed!==false?'checked':''}>
        Advantage Detailed Targeting <span class="mono muted" style="font-size:10.5px">(Meta expande além dos interesses · recomendado)</span>
      </label>
      <hr style="margin:14px 0;border:none;border-top:1px solid var(--divisor)">
      <div id="pub-resumo" class="mono" style="font-size:11px;background:#f3f4f6;padding:10px;border-radius:6px"></div>
      <div id="pub-alcance" class="mono muted" style="font-size:11px;margin-top:6px"></div>
      <div class="row" style="justify-content:space-between;margin-top:14px">
        <button class="btn btn--sm" id="pub-alcance-btn">Estimar alcance</button>
        <button class="btn btn--sm btn--primary" id="pub-salvar">${campanhaExistente?'Salvar':'Criar rascunho'}</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  ESTADO_PUB = { geo, interesses: (p.interesses || []).slice() };
  bindBuilderPublico(campanhaExistente);
  renderGeoBody(); renderInteresses(); atualizarResumo();
}

let ESTADO_PUB = { geo: {}, interesses: [] };

function renderGeoBody() {
  const el = document.getElementById('pub-geo-body');
  if (!el) return;
  if (ESTADO_PUB.geo.modo === 'cidades') {
    el.innerHTML = `
      <div class="row" style="gap:6px">
        <input id="pub-geo-cidq" type="text" placeholder="buscar cidade" style="flex:1;padding:6px 8px">
        <button class="btn btn--sm" id="pub-geo-cidbtn">Buscar</button>
      </div>
      <div id="pub-geo-cidsug" class="mono" style="font-size:11px;margin-top:6px;max-height:120px;overflow:auto"></div>
      <div id="pub-geo-cidsel" style="margin-top:8px">${
        (ESTADO_PUB.geo.cidades||[]).map((c,i) => `<span class="pill" style="margin:2px">${esc(c.nome)} · ${c.raio_km}km <button data-cid-rm="${i}" style="background:none;border:0;cursor:pointer;color:#dc2626">×</button></span>`).join('') || '<span class="muted mono" style="font-size:11px">nenhuma cidade</span>'
      }</div>
    `;
    document.getElementById('pub-geo-cidbtn').addEventListener('click', buscarCidades);
    document.querySelectorAll('[data-cid-rm]').forEach(b => b.addEventListener('click', () => {
      ESTADO_PUB.geo.cidades.splice(Number(b.dataset.cidRm), 1);
      renderGeoBody(); atualizarResumo();
    }));
  } else {
    el.innerHTML = `<input id="pub-geo-ufs" type="text" placeholder="UFs separadas por vírgula (ex: RJ,SP,MG)" value="${(ESTADO_PUB.geo.ufs||[]).join(',')}" style="width:100%;padding:6px 8px">`;
    document.getElementById('pub-geo-ufs').addEventListener('input', (ev) => {
      ESTADO_PUB.geo.ufs = ev.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      atualizarResumo();
    });
  }
}
async function buscarCidades() {
  const q = document.getElementById('pub-geo-cidq').value.trim();
  if (!q) return;
  const el = document.getElementById('pub-geo-cidsug');
  el.innerHTML = 'buscando…';
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-meta-buscar', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ type: 'adgeolocation', q, limit: 8 }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) { el.innerHTML = '<span style="color:#dc2626">' + esc(d.erro || 'erro') + '</span>'; return; }
    el.innerHTML = (d.sugestoes || []).map((s,i) => `<div style="padding:4px;cursor:pointer;border-bottom:1px solid #eee" data-cid-add="${i}">${esc(s.nome)} (${esc(s.regiao||'')})</div>`).join('') || 'nada encontrado';
    el.querySelectorAll('[data-cid-add]').forEach(b => b.addEventListener('click', () => {
      const s = d.sugestoes[Number(b.dataset.cidAdd)];
      ESTADO_PUB.geo.cidades = ESTADO_PUB.geo.cidades || [];
      ESTADO_PUB.geo.cidades.push({ nome: s.nome, meta_key: s.meta_key, raio_km: 25 });
      renderGeoBody(); atualizarResumo();
    }));
  } catch (e) { el.innerHTML = '<span style="color:#dc2626">rede: ' + esc(String(e.message)) + '</span>'; }
}

function renderInteresses() {
  const el = document.getElementById('pub-int-selecionados');
  if (!el) return;
  el.innerHTML = ESTADO_PUB.interesses.length
    ? ESTADO_PUB.interesses.map((i,idx) => `<span class="pill" style="margin:2px">${esc(i.nome)} <button data-int-rm="${idx}" style="background:none;border:0;cursor:pointer;color:#dc2626">×</button></span>`).join('')
    : '<span class="muted mono" style="font-size:11px">nenhum interesse selecionado</span>';
  el.querySelectorAll('[data-int-rm]').forEach(b => b.addEventListener('click', () => {
    ESTADO_PUB.interesses.splice(Number(b.dataset.intRm), 1);
    renderInteresses(); atualizarResumo();
  }));
}
async function buscarInteresses() {
  const q = document.getElementById('pub-int-q').value.trim();
  if (!q) return;
  const el = document.getElementById('pub-int-sugestoes');
  el.innerHTML = 'buscando…';
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-meta-buscar', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ type: 'adinterest', q, limit: 12 }),
    });
    const d = await r.json();
    if (r.status === 503) { el.innerHTML = '<span style="color:#dc2626">META_ACCESS_TOKEN ausente na Vercel · sem busca por enquanto</span>'; return; }
    if (!r.ok || !d.ok) { el.innerHTML = '<span style="color:#dc2626">' + esc(d.erro || 'erro') + '</span>'; return; }
    el.innerHTML = (d.sugestoes || []).map((s,i) => `<div style="padding:4px;cursor:pointer;border-bottom:1px solid #eee" data-int-add="${i}">${esc(s.nome)}${s.path?' <span class="muted" style="font-size:10px">('+esc(s.path)+')</span>':''}${s.audience?' <span class="muted" style="font-size:10px">· ~'+Number(s.audience).toLocaleString('pt-BR')+'</span>':''}</div>`).join('') || 'nada encontrado';
    el.querySelectorAll('[data-int-add]').forEach(b => b.addEventListener('click', () => {
      const s = d.sugestoes[Number(b.dataset.intAdd)];
      if (!ESTADO_PUB.interesses.find(x => x.meta_id === s.meta_id)) {
        ESTADO_PUB.interesses.push({ meta_id: s.meta_id, nome: s.nome });
      }
      renderInteresses(); atualizarResumo();
    }));
  } catch (e) { el.innerHTML = '<span style="color:#dc2626">rede: ' + esc(String(e.message)) + '</span>'; }
}

function coletarPublico() {
  const imin = Math.max(18, Math.min(65, Number(document.getElementById('pub-imin').value) || 30));
  const imax = Math.max(18, Math.min(65, Number(document.getElementById('pub-imax').value) || 60));
  return {
    geo: ESTADO_PUB.geo,
    idade_min: imin, idade_max: imax,
    genero: document.getElementById('pub-gen').value,
    interesses: ESTADO_PUB.interesses,
    comportamentos: [],
    advantage_detailed: document.getElementById('pub-adv').checked,
    audiencias: { incluir: [], excluir: [] },
    posicionamentos: 'automatico',
    idiomas: ['pt_BR'],
  };
}

function atualizarResumo() {
  const el = document.getElementById('pub-resumo');
  if (!el) return;
  const p = coletarPublico();
  const g = p.geo || {};
  let geoStr = '(sem geo)';
  if (g.modo === 'cidades' && g.cidades?.length) {
    geoStr = g.cidades.map(c => `${c.nome} (raio ${c.raio_km}km)`).join(', ');
  } else if (g.modo === 'ufs' && g.ufs?.length) {
    geoStr = g.ufs.join('/');
  }
  const intStr = p.interesses.length ? p.interesses.map(i => i.nome).join(', ') : '(nenhum · Advantage ' + (p.advantage_detailed?'ON expande':'OFF · público AMPLO') + ')';
  el.textContent = `${p.idade_min}-${p.idade_max} · ${p.genero} · ${geoStr} · interesses: ${intStr} · Advantage ${p.advantage_detailed?'ON':'OFF'}`;
  const alerta = [];
  if (!g.modo || (g.modo === 'cidades' && !g.cidades?.length) || (g.modo === 'ufs' && !g.ufs?.length)) alerta.push('⚠ geo vazio');
  if (!p.interesses.length && !p.advantage_detailed) alerta.push('⚠ público amplo demais (sem interesses e Advantage OFF)');
  if (alerta.length) el.innerHTML += '<div style="color:#dc2626;margin-top:4px">' + alerta.join(' · ') + '</div>';
}

function bindBuilderPublico(campanhaExistente) {
  document.querySelectorAll('input[name="pub-geo-modo"]').forEach(r => r.addEventListener('change', () => {
    ESTADO_PUB.geo.modo = document.querySelector('input[name="pub-geo-modo"]:checked').value;
    renderGeoBody(); atualizarResumo();
  }));
  ['pub-imin','pub-imax','pub-gen','pub-adv'].forEach(id => document.getElementById(id).addEventListener('input', atualizarResumo));
  document.getElementById('pub-int-buscar').addEventListener('click', buscarInteresses);
  document.getElementById('pub-alcance-btn').addEventListener('click', estimarAlcance);
  document.getElementById('pub-salvar').addEventListener('click', () => salvarCampanha(campanhaExistente));
}

async function estimarAlcance() {
  const el = document.getElementById('pub-alcance');
  el.textContent = 'calculando…';
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    // Pra chamar delivery_estimate precisamos do targeting_spec traduzido.
    // Como o traduzir mora no backend, chamamos o dry_run do publicar-campanha com uma
    // campanha temporária em memória? Simplificado: pedimos o backend receber o publico e
    // devolver o spec + alcance num único endpoint. Por ora, chamamos meta-buscar reach_estimate
    // com um spec montado no front (versão simplificada).
    const p = coletarPublico();
    const g = p.geo || {};
    const spec = { age_min: p.idade_min, age_max: p.idade_max };
    if (g.modo === 'cidades' && g.cidades?.length) spec.geo_locations = { cities: g.cidades.map(c => ({ key: c.meta_key, radius: c.raio_km, distance_unit: 'kilometer' })) };
    else if (g.modo === 'ufs' && g.ufs?.length) spec.geo_locations = { regions: g.ufs.map(u => ({ key: u })) };
    else spec.geo_locations = { countries: ['BR'] };
    if (p.interesses.length) spec.flexible_spec = [{ interests: p.interesses.map(i => ({ id: i.meta_id, name: i.nome })) }];
    if (p.genero === 'homens') spec.genders = [1]; else if (p.genero === 'mulheres') spec.genders = [2];
    const r = await fetch('/api/va-meta-buscar', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ type: 'reach_estimate', targeting_spec: spec }),
    });
    const d = await r.json();
    if (r.status === 503) { el.textContent = 'META_ACCESS_TOKEN ausente · alcance indisponível'; return; }
    if (!r.ok || !d.ok) { el.textContent = 'erro: ' + (d.erro || 'HTTP ' + r.status); return; }
    if (d.users_lower || d.users_upper) el.textContent = `alcance potencial: ${(d.users_lower||0).toLocaleString('pt-BR')}–${(d.users_upper||0).toLocaleString('pt-BR')} pessoas`;
    else el.textContent = 'alcance: sem dados retornados';
  } catch (e) { el.textContent = 'rede: ' + String(e.message).slice(0,180); }
}

async function salvarCampanha(campanhaExistente) {
  const nome = document.getElementById('pub-nome').value.trim();
  if (!nome) { toast('err', 'nome obrigatório'); return; }
  const cri_id = document.getElementById('pub-cri').value;
  const objetivo = document.getElementById('pub-obj').value;
  const orc = Number(document.getElementById('pub-orc').value) || 30;
  const dias = Number(document.getElementById('pub-dias').value) || 14;
  const publico = coletarPublico();
  // Validação leve · geo obrigatório
  if (!publico.geo?.modo || (publico.geo.modo === 'cidades' && !publico.geo.cidades?.length) || (publico.geo.modo === 'ufs' && !publico.geo.ufs?.length)) {
    toast('err', 'geo obrigatório'); return;
  }
  const cri = CRIATIVOS.find(c => c.id === cri_id);
  const inicio = new Date().toISOString().slice(0,10);
  const fim = new Date(Date.now() + dias * 86400_000).toISOString().slice(0,10);
  const row = {
    projeto_id: MANDATO.id, criativo_id: cri_id, arquetipo_id: cri?.arquetipo_id,
    nome, plataforma:'meta', objetivo_meta: objetivo, objetivo,
    publico, orcamento_diario: orc, orcamento_total: orc * dias,
    data_inicio: inicio, data_fim: fim, status: 'rascunho',
  };
  const q = campanhaExistente
    ? sb.from('va_campanhas').update({ nome, publico, orcamento_diario: orc, orcamento_total: orc * dias, objetivo_meta: objetivo, objetivo }).eq('id', campanhaExistente.id)
    : sb.from('va_campanhas').insert(row);
  const { error } = await q;
  if (error) { toast('err', error.message.slice(0, 220)); return; }
  toast('ok', campanhaExistente ? 'Salva' : 'Rascunho criado');
  document.querySelector('.drw-bg')?.remove();
  await recarregar();
}

async function editarCampanha(id) {
  const c = CAMPANHAS.find(x => x.id === id);
  if (!c) return;
  const aprovados = CRIATIVOS.filter(cr => cr.status === 'aprovado' && cr.png_path);
  abrirBuilderPublico(c, aprovados);
}

async function aprovarCampanha(id) {
  if (!confirm('Aprovar? Depois só é possível publicar (PAUSED no Meta) ou descartar.')) return;
  const { error } = await sb.from('va_campanhas').update({ status: 'aprovada', aprovado_em: new Date().toISOString() }).eq('id', id);
  if (error) { toast('err', error.message.slice(0,220)); return; }
  toast('ok', 'Aprovada'); await recarregar();
}

async function publicarCampanha(id, dryRun) {
  const label = dryRun ? 'Ver SPEC' : 'Publicar no Meta (PAUSED)';
  if (!dryRun && !confirm('Publicar no Meta AGORA em PAUSED? Você precisa ativar manualmente no Ads Manager depois.')) return;
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-publicar-campanha', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ campanha_id: id, dry_run: !!dryRun }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.erro || 'HTTP '+r.status);
    if (d.mode === 'spec_only' || d.mode === 'dry_run') {
      // Mostra SPEC num modal
      const html = `<div class="drw-bg" onclick="if(event.target===this)this.remove()">
        <div class="drw"><button class="btn btn--sm" onclick="this.closest('.drw-bg').remove()" style="float:right">Fechar</button>
        <h3>${dryRun?'SPEC (dry-run)':'SPEC (Meta indisponível)'}</h3>
        <p class="muted mono" style="font-size:11px">${d.motivo ? esc('Motivo: ' + d.motivo) : 'Simulação · campanha não publicada.'}</p>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:11px;overflow-x:auto;white-space:pre-wrap">${esc(d.spec || '')}</pre>
        <p class="mono" style="font-size:11px"><b>ctwaPayload (base64):</b><br>${esc(d.ctwa_payload_base64 || '')}</p>
        </div></div>`;
      document.body.insertAdjacentHTML('beforeend', html);
    } else {
      toast('ok', `Publicada PAUSED · campaign_id ${d.meta?.campaign_id}`);
    }
    await recarregar();
  } catch (e) { toast('err', String(e.message).slice(0,220)); }
}

async function lancarGasto(id) {
  const v = parseFloat(prompt('Valor de gasto real do dia (R$):', '10')) || 0;
  if (v <= 0) return;
  const c = CAMPANHAS.find(x => x.id === id);
  const novo = Number(c?.gasto_acumulado || 0) + v;
  const { error } = await sb.from('va_campanhas').update({ gasto_acumulado: novo }).eq('id', id);
  if (error) { toast('err', error.message.slice(0,220)); return; }
  // Débito midia_meta (×1,5) via RPC
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    await fetch('/api/va-publicar-campanha', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ campanha_id: id, lancar_gasto: v }),
    });
  } catch {}
  toast('ok', 'Gasto lançado + débito midia_meta enviado');
  await recarregar();
}

async function descartarCampanha(id) {
  const c = CAMPANHAS.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`Descartar "${c.nome}"?`)) return;
  const { error } = await sb.from('va_campanhas').delete().eq('id', id);
  if (error) { toast('err', error.message.slice(0,220)); return; }
  toast('ok', 'Descartada'); await recarregar();
}

function renderStatus() {
  const el = document.getElementById('cmp-status');
  const total = CRIATIVOS.length;
  const aprov = CRIATIVOS.filter(c => c.status === 'aprovado').length;
  const rasc  = CRIATIVOS.filter(c => c.status === 'rascunho').length;
  el.textContent = `${total} criativo(s) · ${aprov} aprovado(s) · ${rasc} rascunho(s)`;
}

function renderGerador() {
  const sel = document.getElementById('cmp-arq');
  sel.innerHTML = '<option value="">— arquétipo (opcional) —</option>'
    + ARQUETIPOS.map(a => `<option value="${a.id}">${esc(a.nome.slice(0,60))}</option>`).join('');
  const c = document.getElementById('cmp-custo');
  c.textContent = 'custo por geração (4 variações): ' + (PRECO_CRIATIVO != null ? brl(PRECO_CRIATIVO) : '?');
}

function renderGaleria() {
  const el = document.getElementById('cmp-galeria');
  if (!CRIATIVOS.length) {
    el.innerHTML = `<div class="muted mono" style="font-size:12px;padding:12px;text-align:center">Nenhum criativo ainda. Escolha arquétipo/formato/layout acima e "Gerar com IA".</div>`;
    return;
  }
  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
      ${CRIATIVOS.map(cardHTML).join('')}
    </div>`;
  bindCards();
}

function pngUrl(c) {
  if (!c.png_path) return null;
  const base = window.SUPABASE_URL || (window.sb && window.sb.supabaseUrl) || '';
  // Falta o URL público? Deriva do supabase-js
  const supUrl = sb?.storage?.from ? sb.supabaseUrl : base;
  return supUrl ? `${supUrl}/storage/v1/object/public/criativos-png/${c.png_path}` : null;
}

function cardHTML(c) {
  const arq = ARQUETIPOS.find(a => a.id === c.arquetipo_id);
  const url = pngUrl(c);
  const pill = c.status === 'aprovado'
    ? '<span class="pill pill--tpl-ok">aprovado</span>'
    : c.status === 'arquivado'
      ? '<span class="pill" style="background:#e5e7eb;color:#4b5563">arquivado</span>'
      : '<span class="pill pill--tpl-no">rascunho</span>';
  return `
    <div class="tpl-item" data-c="${c.id}">
      <div class="tpl-item__head">
        <div class="tpl-item__nome" style="font-size:12px">${esc((c.formato||'').replace('_',' '))} · ${esc((c.layout||'').replace(/_/g,' '))}</div>
        <div class="tpl-item__pills">${pill}</div>
      </div>
      <div style="background:#f3f4f6;border-radius:6px;overflow:hidden;aspect-ratio:${aspect(c.formato)};display:flex;align-items:center;justify-content:center;margin:6px 0">
        ${url
          ? `<img src="${esc(url)}?t=${c.versao||1}" alt="${esc(c.headline||'')}" style="width:100%;height:100%;object-fit:cover">`
          : `<span class="muted mono" style="font-size:10px">${c.png_path ? 'gerando…' : 'sem render · clique Renderizar'}</span>`}
      </div>
      <div class="mono" style="font-size:10.5px;color:var(--ink-3)">${esc(arq?.nome || 'sem arquétipo')}</div>
      <div style="font-size:12px;font-weight:600;line-height:1.3;margin:4px 0">${esc(c.headline || '(sem headline)')}</div>
      <div style="font-size:11px;color:var(--ink-3);line-height:1.35">${esc(c.texto || '')}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:8px">
        ${c.status !== 'aprovado' ? `<button class="btn btn--xs" data-render="${c.id}" title="renderiza / re-renderiza o PNG">${c.png_path?'Re-render':'Renderizar'}</button>` : ''}
        ${c.status === 'rascunho' ? `<button class="btn btn--xs" data-edit="${c.id}" title="editar copy">Editar copy</button>` : ''}
        ${c.status === 'rascunho' && c.png_path ? `<button class="btn btn--xs btn--primary" data-aprov="${c.id}" title="aprovar · congela">Aprovar</button>` : ''}
        ${c.status !== 'arquivado' ? `<button class="btn btn--xs" data-arq="${c.id}" title="arquivar">Arquivar</button>` : ''}
        ${url ? `<a class="btn btn--xs" href="${esc(url)}" download style="text-decoration:none">Baixar PNG</a>` : ''}
      </div>
    </div>
  `;
}

function aspect(fmt) {
  if (fmt === 'story_1080x1920') return '9/16';
  if (fmt === 'link_1200x628') return '1200/628';
  return '1/1';
}

function bindCards() {
  document.querySelectorAll('[data-render]').forEach(b => b.addEventListener('click', () => renderCriativo(b.dataset.render)));
  document.querySelectorAll('[data-aprov]').forEach(b => b.addEventListener('click', () => aprovar(b.dataset.aprov)));
  document.querySelectorAll('[data-arq]').forEach(b => b.addEventListener('click', () => arquivar(b.dataset.arq)));
  document.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editar(b.dataset.edit)));
}

function bindGerador() {
  document.getElementById('cmp-gerar')?.addEventListener('click', gerarCriativos);
  const upFile = document.getElementById('cmp-up-file');
  const upBtn = document.getElementById('cmp-up-btn');
  if (upFile && upBtn) {
    upFile.addEventListener('change', () => { upBtn.disabled = !upFile.files[0]; });
    upBtn.addEventListener('click', subirArte);
  }
}

async function gerarCriativos() {
  const btn = document.getElementById('cmp-gerar');
  const arqId = document.getElementById('cmp-arq').value || null;
  const fmt = document.getElementById('cmp-fmt').value;
  const lay = document.getElementById('cmp-lay').value;
  const val = document.getElementById('cmp-val').value === 'true';
  const custo = PRECO_CRIATIVO != null ? brl(PRECO_CRIATIVO) : '?';
  if (!confirm(`Gerar 4 variações via IA (custo ${custo})?`)) return;
  btn.disabled = true; btn.textContent = 'gerando…';
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-gerar-criativos', {
      method: 'POST', headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ projeto_id: MANDATO.id, arquetipo_id: arqId, formato: fmt, layout: lay, incluir_valor: val }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.erro || 'HTTP ' + r.status);
    toast('ok', `${d.variacoes?.length || 0} variação(ões) criada(s) · custo ${custo}`);
    await recarregar();
    // Renderiza automaticamente as novas
    for (const v of (d.variacoes || [])) { if (v.id) renderCriativo(v.id, /*silent*/ true); }
  } catch (e) {
    toast('err', String(e.message).slice(0, 220));
  } finally {
    btn.disabled = false; btn.textContent = 'Gerar com IA';
  }
}

async function renderCriativo(id, silent = false) {
  const btn = document.querySelector(`[data-render="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'renderizando…'; }
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-render-criativo', {
      method: 'POST', headers: { 'Content-Type':'application/json', Authorization: 'Bearer ' + tok },
      body: JSON.stringify({ criativo_id: id }),
    });
    // Defensivo: se runtime da function falha (FUNCTION_INVOCATION_FAILED),
    // body vem como texto (HTML) e r.json() explode com "Unexpected token".
    // Tratamos como erro do endpoint em vez de engolir silenciosamente.
    const raw = await r.text();
    let d = null;
    try { d = JSON.parse(raw); } catch {
      throw new Error('HTTP ' + r.status + ' · runtime falhou: ' + raw.slice(0, 180));
    }
    if (!r.ok || !d.ok) throw new Error((d.erro || 'HTTP ' + r.status) + (d.detalhe ? ' · ' + d.detalhe : ''));
    if (!silent) toast('ok', 'Renderizado');
    await recarregar();
  } catch (e) {
    console.error('[renderCriativo]', e);
    if (!silent) toast('err', 'Render: ' + String(e.message).slice(0, 260));
    if (btn) { btn.disabled = false; btn.textContent = 'Renderizar'; }
  }
}

async function aprovar(id) {
  if (!confirm('Aprovar? Uma vez aprovado, o criativo fica IMUTÁVEL. Alteração = nova versão.')) return;
  const { error } = await sb.from('va_criativos').update({ status: 'aprovado', aprovado_em: new Date().toISOString() }).eq('id', id);
  if (error) { toast('err', error.message.slice(0, 220)); return; }
  toast('ok', 'Aprovado');
  await recarregar();
}

async function arquivar(id) {
  if (!confirm('Arquivar? Some da galeria ativa.')) return;
  const { error } = await sb.from('va_criativos').update({ status: 'arquivado' }).eq('id', id);
  if (error) { toast('err', error.message.slice(0, 220)); return; }
  toast('ok', 'Arquivado');
  await recarregar();
}

async function editar(id) {
  const c = CRIATIVOS.find(x => x.id === id);
  if (!c) return;
  const hl = prompt('Headline (≤40):', c.headline || '');
  if (hl === null) return;
  const tx = prompt('Texto (≤120):', c.texto || '');
  if (tx === null) return;
  const ct = prompt('CTA (≤20):', c.cta || '');
  if (ct === null) return;
  const { error } = await sb.from('va_criativos').update({
    headline: hl.slice(0, 40), texto: tx.slice(0, 120), cta: ct.slice(0, 20),
  }).eq('id', id);
  if (error) { toast('err', error.message.slice(0, 220)); return; }
  toast('ok', 'Editado · re-renderize pra ver');
  await recarregar();
}
