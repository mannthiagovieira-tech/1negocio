// Zona MÁQUINA · aba CAMPANHAS · Slice P5 A (criativos)
// Galeria de criativos gerados via IA + render server-side em PNG.
// Slice B (campanhas Meta) + C (desemboque) virão em cima disso.

import { sb } from './core/core.js';
import { esc, brl } from './core/format.js';
import { toast } from './core/ui.js';

let MANDATO = null;
let CRIATIVOS = [];
let ARQUETIPOS = [];
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
    </section>
  `;
  await recarregar();
  bindGerador();
}

async function recarregar() {
  const [arqR, criR, projR] = await Promise.all([
    sb.from('va_arquetipos').select('id, nome').eq('projeto_id', MANDATO.id).in('status', ['aprovado']).order('criado_em', { ascending: false }),
    sb.from('va_criativos').select('*').eq('projeto_id', MANDATO.id).order('criado_em', { ascending: false }),
    sb.from('va_projetos').select('precos_versao_id').eq('id', MANDATO.id).maybeSingle(),
  ]);
  ARQUETIPOS = arqR.data || [];
  CRIATIVOS = criR.data || [];
  // Preço geração IA · da versão vigente do projeto (ou vigente global)
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
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.erro || 'HTTP ' + r.status);
    if (!silent) toast('ok', 'Renderizado');
    await recarregar();
  } catch (e) {
    if (!silent) toast('err', String(e.message).slice(0, 220));
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
