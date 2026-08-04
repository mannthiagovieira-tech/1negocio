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
      <div id="cmp-gerador" class="cad-config-grid" style="padding:10px 12px;border:1px solid var(--divisor);border-radius:8px;margin-bottom:14px">
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
  const [arqR, criR, cmpR, metR, projR] = await Promise.all([
    sb.from('va_arquetipos').select('id, nome, abordagem').eq('projeto_id', MANDATO.id).in('status', ['aprovado','arquivado']).order('criado_em', { ascending: false }),
    sb.from('va_criativos').select('*').eq('projeto_id', MANDATO.id).order('criado_em', { ascending: false }),
    sb.from('va_campanhas').select('*').eq('projeto_id', MANDATO.id).order('criado_em', { ascending: false }),
    sb.from('va_projetos_metricas_campanhas').select('*').eq('projeto_id', MANDATO.id).maybeSingle(),
    sb.from('va_projetos').select('precos_versao_id').eq('id', MANDATO.id).maybeSingle(),
  ]);
  ARQUETIPOS = arqR.data || [];
  CRIATIVOS = criR.data || [];
  CAMPANHAS = cmpR.data || [];
  METRICAS = metR.data || null;
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
  const nome = prompt('Nome da campanha:', `Campanha ${new Date().toISOString().slice(0,10)}`);
  if (!nome) return;
  // Escolha do criativo
  const escolhas = aprovados.map((c, i) => `${i+1}. ${(c.formato||'').padEnd(16)} · ${(c.headline||'').slice(0,40)}`).join('\n');
  const idx = parseInt(prompt('Escolha o criativo (número):\n\n' + escolhas, '1'), 10) - 1;
  if (isNaN(idx) || !aprovados[idx]) return;
  const cri = aprovados[idx];
  const arq = ARQUETIPOS.find(a => a.id === cri.arquetipo_id);
  // Pré-preenche público do segmentacao_meta do arquétipo
  const seg = arq?.abordagem?.segmentacao_meta || '';
  const publico = { idade_min: 30, idade_max: 65, interesses: seg ? [seg] : [], regioes: [{ uf: MANDATO.uf || 'BR' }] };
  const orc = parseFloat(prompt('Orçamento diário (R$):', '30')) || 30;
  const dias = parseInt(prompt('Duração (dias):', '14'), 10) || 14;
  const objetivo = confirm('Usar CTWA (WhatsApp direto)?\n\nOK = CTWA · Cancelar = Lead Gen (fallback)') ? 'ctwa' : 'leadgen';
  const inicio = new Date().toISOString().slice(0,10);
  const fim = new Date(Date.now() + dias * 86400_000).toISOString().slice(0,10);
  const { error } = await sb.from('va_campanhas').insert({
    projeto_id: MANDATO.id, criativo_id: cri.id, arquetipo_id: cri.arquetipo_id,
    nome, plataforma: 'meta', objetivo_meta: objetivo, objetivo: objetivo,
    publico, orcamento_diario: orc, orcamento_total: orc * dias,
    data_inicio: inicio, data_fim: fim, status: 'rascunho',
  });
  if (error) { toast('err', error.message.slice(0,220)); return; }
  toast('ok', 'Rascunho criado');
  await recarregar();
}

async function editarCampanha(id) {
  const c = CAMPANHAS.find(x => x.id === id);
  if (!c) return;
  const orc = parseFloat(prompt('Orçamento diário (R$):', String(c.orcamento_diario || 30))) || c.orcamento_diario;
  const dias = parseInt(prompt('Duração (dias):', '14'), 10) || 14;
  const inicio = c.data_inicio || new Date().toISOString().slice(0,10);
  const fim = new Date(new Date(inicio).getTime() + dias * 86400_000).toISOString().slice(0,10);
  const { error } = await sb.from('va_campanhas').update({
    orcamento_diario: orc, orcamento_total: orc * dias, data_fim: fim,
  }).eq('id', id);
  if (error) { toast('err', error.message.slice(0,220)); return; }
  toast('ok', 'Editada'); await recarregar();
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
  document.getElementById('cmp-gerar').addEventListener('click', gerarCriativos);
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
