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
      <span class="topbar__saldo pill" id="tb-saldo" title="crédito do ciclo" style="display:none">…</span>
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
  // P5.3 · pill de saldo do ciclo · presente em toda zona
  if (mandato?.id) atualizarPillSaldo(mandato.id);
}

// P5.3 · pill de crédito · verde >=20% · amarelo 5-20% · vermelho <5% · cinza null
async function atualizarPillSaldo(projetoId) {
  const el = document.getElementById('tb-saldo');
  if (!el) return;
  try {
    const { data, error } = await sb.rpc('va_saldo_ciclo', { p_projeto: projetoId });
    if (error || !data || !data.credito) { el.style.display = 'none'; return; }
    const saldo = Number(data.saldo || 0);
    const credito = Number(data.credito || 0);
    const pct = credito > 0 ? (saldo / credito) : 0;
    const cor = pct >= 0.20 ? '#16a34a' : pct >= 0.05 ? '#f59e0b' : '#dc2626';
    const fmt = v => 'R$ ' + v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    el.style.display = 'inline-flex';
    el.style.background = cor;
    el.style.color = '#fff';
    el.style.fontSize = '11px';
    el.style.padding = '4px 10px';
    el.style.fontWeight = '600';
    el.textContent = `CRÉDITO · ${fmt(saldo)} de ${fmt(credito)}`;
    el.title = `ciclo ${data.ciclo_de} → ${data.ciclo_ate} · consumido R$ ${Number(data.consumido||0).toFixed(2)}`;
  } catch { el.style.display = 'none'; }
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
    // P4.7 · busca ritmo em lote pra pintar dot em cada card. Falha silenciosa
    // (sem ritmo → dot cinza). Reusa RPC va_ritmo_carteira que faz N chamadas
    // internas indexadas por projeto_id.
    let ritmoMap = {};
    try {
      const ids = items.map(m => m.id).filter(Boolean);
      if (ids.length) {
        const { data } = await sb.rpc('va_ritmo_carteira', { p_projetos: ids });
        ritmoMap = data || {};
      }
    } catch { /* sem ritmo → todos cinza */ }
    // Classificador reduzido (2 dimensões · idêntico ao funil.js mas standalone
    // pra não depender do módulo do funil aqui).
    function corRitmo(r) {
      if (!r || !r.meta_dia) return 'cinza';
      const now = new Date();
      const dow = now.getDay();
      const diasUt = dow === 0 ? 5 : Math.min(dow, 5);
      const proRata = diasUt * r.meta_dia;
      const hoje = r.hoje||0, sem = r.semana||0, fila = r.fila_pronta||0, ante = r.antessala||0, metaF = r.meta_fila||10;
      let contato;
      if (sem < proRata * 0.5) contato = 'vermelho';
      else if (dow>=1 && dow<=5 && now.getHours()>=12 && hoje===0) contato = 'vermelho';
      else if (hoje >= r.meta_dia || sem >= proRata) contato = 'verde';
      else contato = 'amarelo';
      let mun;
      if (fila >= metaF) mun = 'verde';
      else if (ante >= metaF) mun = 'amarelo';
      else mun = 'vermelho';
      const rk = { verde:0, amarelo:1, vermelho:2 };
      return rk[contato] >= rk[mun] ? contato : mun;
    }
    const cores = { verde:'#16a34a', amarelo:'#f59e0b', vermelho:'#dc2626', cinza:'#94a3b8' };
    grid.innerHTML = items.map(m => {
      const nome = m.negocio_titulo || m.cliente_nome || '—';
      const meta = [m.codigo, m.cidade, m.data_inicio ? 'início ' + dataBR(m.data_inicio) : null]
        .filter(Boolean).join(' · ');
      const dia = (m.dia_atual !== null && m.dia_atual !== undefined)
        ? `<span class="pill">dia ${esc(m.dia_atual)}</span>` : '';
      const status = m.status ? `<span class="pill pill--accent">${esc(m.status)}</span>` : '';
      const progr = m.etapas_total
        ? `<span class="pill">${esc(m.etapas_ok || 0)} de ${esc(m.etapas_total)} etapas</span>` : '';
      const r = ritmoMap[m.id] || null;
      const cor = corRitmo(r);
      const dot = `<span title="ritmo ${cor}${r ? ` · contato ${r.hoje||0}/${r.meta_dia||0} · fila ${r.fila_pronta||0}/${r.meta_fila||0}`:''}" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${cores[cor]};margin-right:6px;vertical-align:middle"></span>`;
      const url = withMandato(`${zonaAtual}.html`, m.id);
      return `<a class="selector__card" href="${esc(url)}">
        <div class="selector__nome">${dot}${esc(nome)}</div>
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
