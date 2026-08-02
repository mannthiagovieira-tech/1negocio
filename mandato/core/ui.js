// MANDATO · ui compartilhado · topbar, seletor de mandato, toasts.
// Zero HTML de nav duplicado nas páginas — tudo injetado por este módulo.

import { sb, withMandato, mandatoIdFromURL, listarMandatos } from './core.js';
import { esc, dataBR } from './format.js';

const ZONAS = [
  { key: 'cockpit', href: 'cockpit.html', label: 'Cockpit' },
  { key: 'ativo',   href: 'ativo.html',   label: 'Ativo' },
  { key: 'maquina', href: 'maquina.html', label: 'Máquina' },
  { key: 'mesa',    href: 'mesa.html',    label: 'Mesa' },
];

/**
 * Injeta a topbar no topo do body. Chame uma vez por página.
 * @param {'cockpit'|'ativo'|'maquina'|'mesa'} atual
 * @param {{id:string,cliente_nome:string,negocio_titulo?:string,codigo?:string}|null} mandato
 */
export function mountTopbar(atual, mandato) {
  const bar = document.createElement('header');
  bar.className = 'topbar';
  const nomeCentro = mandato
    ? (mandato.negocio_titulo || mandato.cliente_nome || 'Mandato')
    : 'Selecione um mandato';
  const lblCentro = mandato?.codigo ? mandato.codigo : 'mandato ativo';
  const navHtml = ZONAS.map(z => {
    const href = withMandato(z.href, mandato?.id);
    const cur = z.key === atual ? ' aria-current="page"' : '';
    return `<a href="${esc(href)}"${cur}>${esc(z.label)}</a>`;
  }).join('');

  bar.innerHTML = `
    <div class="topbar__inner">
      <a class="topbar__logo" href="cockpit.html" title="Ir para o cockpit">1Negócio · Mandato</a>
      <div class="topbar__mandato" role="button" tabindex="0" id="tb-mandato" title="Trocar de mandato">
        <span class="topbar__mandato-lbl">${esc(lblCentro)}</span>
        <span class="topbar__mandato-nome">${esc(nomeCentro)}</span>
      </div>
      <nav class="topbar__nav">${navHtml}</nav>
      <button class="topbar__logout" id="tb-logout" title="Sair">Sair</button>
    </div>`;
  document.body.insertBefore(bar, document.body.firstChild);

  document.getElementById('tb-mandato').addEventListener('click', trocarMandato);
  document.getElementById('tb-mandato').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trocarMandato(); }
  });
  document.getElementById('tb-logout').addEventListener('click', async () => {
    await sb.auth.signOut(); location.reload();
  });
}

function trocarMandato() {
  const url = new URL(location.href);
  url.searchParams.delete('mandato');
  location.href = url.toString();
}

/**
 * Renderiza o seletor de mandatos como página inteira.
 * Retorna Promise que nunca resolve (a página fica no seletor).
 */
export async function renderSelector(zonaAtual) {
  const main = document.querySelector('main.wrap') || document.body;
  main.innerHTML = `
    <div class="selector">
      <h1>Escolha um mandato</h1>
      <p>Todo o painel opera dentro de um mandato de venda assessorada. Escolha um para continuar.</p>
      <div class="selector__grid" id="sel-grid"><div class="muted">Carregando…</div></div>
    </div>`;
  try {
    const items = await listarMandatos();
    const grid = document.getElementById('sel-grid');
    if (!items.length) {
      grid.innerHTML = `<div class="muted">Nenhum mandato ativo. Cadastre em <a href="/projetos.html">/projetos.html</a>.</div>`;
      return;
    }
    grid.innerHTML = items.map(m => {
      const nome = m.negocio_titulo || m.cliente_nome || '—';
      const meta = [m.codigo, m.cidade, m.data_inicio ? 'início ' + dataBR(m.data_inicio) : null]
        .filter(Boolean).join(' · ');
      const dia = (m.dia_atual !== null && m.dia_atual !== undefined)
        ? `<span class="pill">dia ${esc(m.dia_atual)}</span>` : '';
      const status = m.status ? `<span class="pill pill--accent">${esc(m.status)}</span>` : '';
      const progr = m.etapas_total
        ? `<span class="pill">${esc(m.etapas_ok || 0)} de ${esc(m.etapas_total)} etapas</span>` : '';
      const url = withMandato(`${zonaAtual}.html`, m.id);
      return `<a class="selector__card" href="${esc(url)}">
        <div class="selector__nome">${esc(nome)}</div>
        <div class="selector__meta">${esc(meta || '—')}</div>
        <div class="selector__pills">${status}${dia}${progr}</div>
      </a>`;
    }).join('');
  } catch (e) {
    document.getElementById('sel-grid').innerHTML =
      `<div class="muted">Não foi possível carregar: ${esc(e.message)}</div>`;
    toast('err', 'Falha ao carregar mandatos');
  }
  return new Promise(() => {});
}

// ─── Toasts ─────────────────────────────────────────────────────────
let _toastWrap = null;
export function toast(kind = 'info', msg = '') {
  if (!_toastWrap) {
    _toastWrap = document.createElement('div');
    _toastWrap.className = 'toast-wrap';
    document.body.appendChild(_toastWrap);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' toast--err' : kind === 'ok' ? ' toast--ok' : '');
  el.textContent = msg;
  _toastWrap.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}
