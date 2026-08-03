// MANDATO · Zona Máquina · aba CAPTAÇÃO.
// 3 painéis (Fonte/Antessala/Destino) · usa sb do core e toast do ui.
// Vazão = meta: seleção em massa, atalhos A/D, contadores discretos.

import { sb } from '/mandato/core/core.js';
import { toast } from '/mandato/core/ui.js';
import { esc, brl, num, dataBR } from '/mandato/core/format.js';

// ─── estado local do módulo ──────────────────────────────────────────
let MANDATO = null;
let ARQUETIPOS = [];  // aprovados (+ metadata "extraível")
let EXTRACOES = [];   // últimas 5 do projeto
let LEADS = [];       // antessala + bloqueado
let BLACKLIST = [];
let SUGESTOES = [];   // sugestões automáticas de blacklist (não persistidas ainda)
let PRECO_LEAD = null;
let SELECAO = new Set();
let FILTRO_UI = { arquetipo: 'todos', samecity: false, bloqueados: false };

// ─── carregamento ────────────────────────────────────────────────────
export async function mountCaptacao(mandato) {
  MANDATO = mandato;
  const root = document.getElementById('mq-panel-captacao');
  if (!root) return;
  root.innerHTML = `
    <div class="cap-grid" id="cap-grid">
      <div class="cap-col" id="cap-col-fonte"></div>
      <div class="cap-col" id="cap-col-antessala"></div>
      <div class="cap-col" id="cap-col-destino"></div>
    </div>
  `;
  await recarregarTudo();
  bindAtalhos();
  root.setAttribute('data-ready', 'true');
}

async function recarregarTudo() {
  const [arqR, extR, leadsR, blR, precoR, fontesR] = await Promise.all([
    sb.from('va_arquetipos').select('*').eq('projeto_id', MANDATO.id).eq('status','aprovado').order('criado_em', { ascending:false }),
    sb.from('va_extracoes').select('*').eq('projeto_id', MANDATO.id).order('criado_em', { ascending:false }).limit(5),
    sb.from('va_leads').select('*').eq('projeto_id', MANDATO.id).in('status', ['antessala','bloqueado']).order('criado_em', { ascending:false }),
    sb.from('va_projeto_blacklist').select('*').eq('projeto_id', MANDATO.id).order('criado_em', { ascending:false }),
    sb.from('va_precos').select('preco, rotulo').eq('tipo','lead_scrapper').eq('ativo', true).maybeSingle(),
    sb.from('va_projeto_fontes').select('conteudo_destilado, conteudo, formato_detectado, tipo').eq('projeto_id', MANDATO.id),
  ]);
  ARQUETIPOS = (arqR.data || []).map(a => ({ ...a, extraivel: filtroCompilavel(a.filtro) }));
  EXTRACOES = extR.data || [];
  LEADS = leadsR.data || [];
  BLACKLIST = blR.data || [];
  PRECO_LEAD = precoR.data?.preco != null ? Number(precoR.data.preco) : null;
  SUGESTOES = extrairSugestoesBlacklist(fontesR.data || [], BLACKLIST);
  SELECAO = new Set([...SELECAO].filter(id => LEADS.find(l => l.id === id))); // dropa selecoes stale
  renderFonte();
  renderAntessala();
  renderDestino();
}

// ─── heurística: filtro é compilável se tem ao menos 1 gate base CNPJ
function filtroCompilavel(f) {
  if (!f) return false;
  const cnaes = Array.isArray(f.cnaes) ? f.cnaes.filter(Boolean) : [];
  const uf    = Array.isArray(f.uf) ? f.uf.filter(Boolean) : [];
  const porte = Array.isArray(f.porte) ? f.porte.filter(Boolean) : [];
  const fatMin = f.faturamento_min != null;
  const fatMax = f.faturamento_max != null;
  return cnaes.length > 0 || uf.length > 0 || fatMin || fatMax || porte.length > 0;
}

// ─── sugestões automáticas de blacklist a partir das fontes ──────────
function extrairSugestoesBlacklist(fontes, blJaCadastrada) {
  const jaNorm = new Set(blJaCadastrada.map(b => normNome(b.nome)));
  const sug = new Map();
  const reBlacklist = /\b(n[ãa]o pode(?:m|r)? saber|manter em sigilo|blacklist|proibid[oa] de contato|evitar\s+contato)\b/i;
  for (const f of fontes) {
    const txt = (f.conteudo_destilado || '') + '\n' + (f.conteudo || '');
    if (!reBlacklist.test(txt)) continue;
    // pega frases próximas ao gatilho, extrai NOMES em bold ou capitalização de 2-4 palavras
    const trechos = txt.split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/).filter(t => reBlacklist.test(t));
    for (const t of trechos) {
      const bolds = [...t.matchAll(/\*\*([^*]+)\*\*/g)].map(m => m[1].trim());
      const nomes = [...t.matchAll(/\b([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+){0,3})\b/g)].map(m => m[1]);
      for (const nome of [...bolds, ...nomes]) {
        if (nome.length < 4) continue;
        if (jaNorm.has(normNome(nome))) continue;
        if (!sug.has(normNome(nome))) sug.set(normNome(nome), { nome, motivo: 'menção de restrição na fonte' });
      }
    }
  }
  return [...sug.values()].slice(0, 8);
}
function normNome(s) { return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim(); }

// ─── FONTE (esquerda) ────────────────────────────────────────────────
function renderFonte() {
  const el = document.getElementById('cap-col-fonte');
  const cards = ARQUETIPOS.length
    ? ARQUETIPOS.map(a => arqCard(a)).join('')
    : `<div class="antes-vazia"><p>Nenhum arquétipo aprovado ainda.</p><p class="muted">Aprove na aba <strong>Ativo</strong> pra habilitar extração.</p></div>`;
  const hist = EXTRACOES.length
    ? EXTRACOES.map(e => histLinha(e)).join('')
    : `<div class="cap-hist__linha muted">Sem extrações ainda.</div>`;
  el.innerHTML = `
    <div class="cap-col__head">
      <h3 class="cap-col__title">Fonte · arquétipos</h3>
      <span class="cap-col__count">${ARQUETIPOS.length} aprovado(s)</span>
    </div>
    <div class="arq-cards" id="fonte-arq-cards">${cards}</div>
    <div class="cap-hist">
      <div class="cap-hist__title">Últimas extrações</div>
      ${hist}
    </div>
  `;
  el.querySelectorAll('[data-extrair]').forEach(b => {
    b.addEventListener('click', () => extrairLeads(b.dataset.extrair));
  });
}
function arqCard(a) {
  const f = a.filtro || {};
  const pills = [
    f.uf?.length ? `<span class="pill">${esc(f.uf.join('/'))}</span>` : '',
    f.cidades?.length ? `<span class="pill">${esc(f.cidades.slice(0,2).join('/'))}${f.cidades.length>2?'…':''}</span>` : '',
    f.faturamento_min || f.faturamento_max ? `<span class="pill">${brl(f.faturamento_min||0)}${f.faturamento_max ? '–'+brl(f.faturamento_max) : '+'}</span>` : '',
    f.cnaes?.length ? `<span class="pill">${f.cnaes.length} CNAE${f.cnaes.length>1?'s':''}</span>` : '',
  ].filter(Boolean).join('');
  const btnExtrair = a.extraivel
    ? `<button class="btn btn--sm btn--primary" data-extrair="${a.id}">Extrair leads</button>`
    : `<button class="btn btn--sm" disabled title="Filtro não compilável em base CNPJ · use canal campanha">Extrair leads</button>`;
  const badgeCamp = a.extraivel ? '' : `<span class="arq-card-cap__badge-camp" title="Sem base CNPJ compilável">canal campanha</span>`;
  return `
    <div class="arq-card-cap" data-arq="${a.id}">
      <h4 class="arq-card-cap__nome">${esc(a.nome)}</h4>
      <div class="arq-card-cap__filtro">${pills || '<span class="muted mono" style="font-size:10px">sem filtro compilável</span>'}</div>
      <div class="arq-card-cap__foot">
        ${badgeCamp}
        ${btnExtrair}
      </div>
    </div>
  `;
}
function histLinha(e) {
  const cls = e.status === 'erro' ? 'is-erro' : e.status === 'executando' ? 'is-exec' : '';
  const meta = e.status === 'erro'
    ? `erro: ${esc((e.erro||'').slice(0,80))}`
    : `${e.qtd_encontrados||0} encontrados · ${e.qtd_novos||0} novos · ${e.qtd_duplicados||0} dup · ${e.qtd_blacklist||0} bl · ${e.qtd_consultados_bruto||0} brutos`;
  return `<div class="cap-hist__linha ${cls}" title="${esc(meta)}">${dataBR((e.criado_em||'').slice(0,10))} · ${meta}</div>`;
}
async function extrairLeads(arqId) {
  const arq = ARQUETIPOS.find(a => a.id === arqId);
  if (!arq) return;
  if (!confirm(`Extrair leads do arquétipo "${arq.nome}"? Antessala custa 0 (portão só cobra ao aprovar).`)) return;
  const btn = document.querySelector(`[data-extrair="${arqId}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'extraindo…'; }
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-extrair-leads', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ projeto_id: MANDATO.id, arquetipo_id: arqId }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error([d.erro, d.detalhe].filter(Boolean).join(' · ') || ('HTTP '+r.status));
    toast('ok', `${d.qtd_novos} novos · ${d.qtd_duplicados} dup · ${d.qtd_blacklist} bl · ${d.qtd_consultados_bruto} brutos`);
    await recarregarTudo();
  } catch (e) {
    toast('err', String(e.message).slice(0,240));
    if (btn) { btn.disabled = false; btn.textContent = 'Extrair leads'; }
  }
}

// ─── ANTESSALA (centro) ──────────────────────────────────────────────
function leadsVisiveis() {
  return LEADS.filter(l => {
    if (FILTRO_UI.samecity && !l.same_city) return false;
    if (FILTRO_UI.bloqueados && !l.blacklist_hit) return false;
    if (FILTRO_UI.arquetipo !== 'todos' && l.arquetipo_id !== FILTRO_UI.arquetipo) return false;
    return true;
  });
}
function renderAntessala() {
  const el = document.getElementById('cap-col-antessala');
  const visiveis = leadsVisiveis();
  const optsArq = [`<option value="todos">todos arquétipos</option>`]
    .concat(ARQUETIPOS.map(a => `<option value="${a.id}" ${FILTRO_UI.arquetipo===a.id?'selected':''}>${esc(a.nome.slice(0,40))}</option>`))
    .join('');
  const totalLeads = LEADS.length;
  const totalBloq = LEADS.filter(l => l.blacklist_hit).length;
  const totalSame = LEADS.filter(l => l.same_city).length;
  el.innerHTML = `
    <div class="cap-col__head">
      <h3 class="cap-col__title">Antessala</h3>
      <span class="cap-col__count">${totalLeads} lead(s) · ${totalSame} same-city · ${totalBloq} bloqueado(s)</span>
    </div>
    <div class="antes-topbar">
      <div class="antes-filtros">
        <select id="filt-arq">${optsArq}</select>
        <label><input type="checkbox" id="filt-sc" ${FILTRO_UI.samecity?'checked':''}> só same-city</label>
        <label><input type="checkbox" id="filt-bl" ${FILTRO_UI.bloqueados?'checked':''}> só bloqueados</label>
      </div>
      <div class="mono muted" style="font-size:10.5px">A: aprovar · D: descartar</div>
    </div>
    ${visiveis.length ? tabelaAntessala(visiveis) : `<div class="antes-vazia"><p>Sem leads visíveis com os filtros atuais.</p><p class="muted">Extraia via painel Fonte ou ajuste os filtros.</p></div>`}
  `;
  document.getElementById('filt-arq').addEventListener('change', e => { FILTRO_UI.arquetipo = e.target.value; renderAntessala(); });
  document.getElementById('filt-sc').addEventListener('change', e => { FILTRO_UI.samecity = e.target.checked; renderAntessala(); });
  document.getElementById('filt-bl').addEventListener('change', e => { FILTRO_UI.bloqueados = e.target.checked; renderAntessala(); });
  // check all
  const chkAll = document.getElementById('chk-all');
  if (chkAll) chkAll.addEventListener('change', () => {
    const vis = leadsVisiveis().filter(l => !l.blacklist_hit); // "todos visíveis" pula bloqueados
    if (chkAll.checked) vis.forEach(l => SELECAO.add(l.id));
    else vis.forEach(l => SELECAO.delete(l.id));
    renderAntessala(); renderDestino();
  });
  // check individuais
  el.querySelectorAll('[data-chk]').forEach(c => c.addEventListener('change', () => {
    const id = c.dataset.chk;
    if (c.checked) SELECAO.add(id); else SELECAO.delete(id);
    renderDestino();
    const tr = c.closest('tr'); if (tr) tr.classList.toggle('is-selected', c.checked);
  }));
  // ações por linha
  el.querySelectorAll('[data-aprov1]').forEach(b => b.addEventListener('click', () => {
    SELECAO.add(b.dataset.aprov1); confirmarPortao();
  }));
  el.querySelectorAll('[data-desc1]').forEach(b => b.addEventListener('click', () => descartarUm(b.dataset.desc1)));
  el.querySelectorAll('[data-over1]').forEach(b => b.addEventListener('click', () => abrirModalOverride(b.dataset.over1)));
  el.querySelectorAll('[data-enriq1]').forEach(b => b.addEventListener('click', () => enriquecerLeads([b.dataset.enriq1])));
  const btnEnriqMassa = document.getElementById('btn-enriq-massa');
  if (btnEnriqMassa) btnEnriqMassa.addEventListener('click', () => {
    const ids = [...SELECAO].filter(id => {
      const l = LEADS.find(x => x.id === id);
      return l && !l.blacklist_hit && !l.enriquecido_em;
    });
    if (ids.length) enriquecerLeads(ids);
  });
}
async function enriquecerLeads(ids) {
  if (!ids.length) return;
  if (!confirm(`Enriquecer ${ids.length} lead(s)? Cada chamada tem custo Kipflow (partners+debts).`)) return;
  const btnMassa = document.getElementById('btn-enriq-massa');
  if (btnMassa) { btnMassa.disabled = true; btnMassa.textContent = 'enriquecendo…'; }
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-enriquecer-lead', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ projeto_id: MANDATO.id, lead_ids: ids }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error([d.erro, d.detalhe].filter(Boolean).join(' · ') || ('HTTP '+r.status));
    const custo = d.custo_kipflow_total || 0;
    toast('ok', `${d.enriquecidos} enriquecido(s) · custo Kipflow ${brl(custo)}${d.falhas?` · ${d.falhas.length} falha(s)`:''}`);
    await recarregarTudo();
  } catch (e) {
    toast('err', String(e.message).slice(0,240));
    if (btnMassa) { btnMassa.disabled = false; btnMassa.textContent = 'Enriquecer'; }
  }
}
function tabelaAntessala(rows) {
  const selecionadosParaEnriq = [...SELECAO].filter(id => {
    const l = LEADS.find(x => x.id === id);
    return l && !l.blacklist_hit && !l.enriquecido_em;
  });
  const btnEnriqMassa = selecionadosParaEnriq.length
    ? `<button class="btn btn--xs" id="btn-enriq-massa" title="enriquece partners+debts dos selecionados">Enriquecer ${selecionadosParaEnriq.length}</button>`
    : '';
  return `
    <div class="antes-tabela-wrap">
    <div style="display:flex;justify-content:flex-end;gap:6px;margin-bottom:6px">${btnEnriqMassa}</div>
    <table class="antes-tabela">
      <thead><tr>
        <th style="width:22px"><input type="checkbox" id="chk-all"></th>
        <th class="col-razao">Empresa · CNAE</th>
        <th>Cidade/UF</th>
        <th>Faturamento</th>
        <th>Sócio idade</th>
        <th>Dívida</th>
        <th>Flags</th>
        <th>Arquétipo</th>
        <th class="col-acao">Ações</th>
      </tr></thead>
      <tbody>
        ${rows.map(l => trLead(l)).join('')}
      </tbody>
    </table>
    </div>
  `;
}
function trLead(l) {
  const cls = [];
  if (l.blacklist_hit) cls.push('is-blocked');
  else if (l.same_city) cls.push('is-samecity');
  if (SELECAO.has(l.id)) cls.push('is-selected');
  const arqNome = (ARQUETIPOS.find(a => a.id === l.arquetipo_id)?.nome || '—').slice(0, 30);
  const flags = [
    l.same_city ? `<span class="pill pill--samecity" title="mesma cidade do ativo · risco de identificação — triar com atenção">same-city</span>` : '',
    l.blacklist_hit ? `<span class="pill pill--blocked" title="proibido pela blacklist deste mandato">BLOQUEADO</span>` : '',
    l.enriquecido_em ? `<span class="pill" style="font-size:10px" title="dados de sócio/dívida vindos do enriquecimento">enriq.</span>` : '',
  ].filter(Boolean).join(' ') || '—';
  // Dados de enriquecimento (quando existem)
  const enr = l.dados_enriquecimento || {};
  const idadeStr = (enr.idade_min_socios != null || enr.idade_max_socios != null)
    ? (enr.idade_min_socios === enr.idade_max_socios ? String(enr.idade_min_socios) : `${enr.idade_min_socios||'?'}–${enr.idade_max_socios||'?'}`)
    : '—';
  const dividaStr = (enr.com_divida === true) ? 'sim' : (enr.com_divida === false) ? 'não' : '—';
  const acoes = l.blacklist_hit
    ? `<button class="btn btn--xs" data-over1="${l.id}">Liberar…</button>`
    : `<button class="btn btn--xs btn--primary" data-aprov1="${l.id}" title="A">Aprovar</button>
       <button class="btn btn--xs" data-desc1="${l.id}" title="D">Descartar</button>
       ${l.enriquecido_em ? '' : `<button class="btn btn--xs" data-enriq1="${l.id}" title="enriquecer partners+debts">Enriq.</button>`}`;
  const checkbox = l.blacklist_hit
    ? '' // bloqueados não entram na seleção normal
    : `<input type="checkbox" data-chk="${l.id}" ${SELECAO.has(l.id)?'checked':''}>`;
  return `
    <tr class="${cls.join(' ')}" data-lid="${l.id}">
      <td>${checkbox}</td>
      <td class="col-razao">
        <strong>${esc(l.razao_social || l.nome_fantasia || '(sem razão)')}</strong>
        <div class="mono">${esc(l.cnpj || '—')} · CNAE ${esc(l.cnae || '—')}</div>
      </td>
      <td class="mono">${esc(l.cidade || '—')}/${esc(l.uf || '—')}</td>
      <td class="mono">${l.faturamento_estimado != null ? brl(l.faturamento_estimado) : '—'}</td>
      <td class="mono">${idadeStr}</td>
      <td class="mono">${dividaStr}</td>
      <td>${flags}</td>
      <td class="mono" style="font-size:11px">${esc(arqNome)}</td>
      <td class="col-acao">${acoes}</td>
    </tr>
  `;
}
async function descartarUm(id) {
  const motivo = prompt('Motivo (opcional):') || '';
  const { error } = await sb.from('va_leads').update({
    status:'descartado', motivo_descarte: motivo || null, descartado_em: new Date().toISOString(),
  }).eq('id', id);
  if (error) { toast('err', error.message); return; }
  toast('ok', 'Descartado');
  SELECAO.delete(id);
  await recarregarTudo();
}
function abrirModalOverride(leadId) {
  const lead = LEADS.find(l => l.id === leadId); if (!lead) return;
  // busca motivo da blacklist
  const nomeNorm = normNome(lead.razao_social || lead.nome_fantasia || '');
  const bl = BLACKLIST.find(b => {
    const bn = normNome(b.nome);
    return b.cnpj && lead.cnpj && b.cnpj.replace(/\D/g,'') === (lead.cnpj||'').replace(/\D/g,'')
        || (bn && nomeNorm && (bn === nomeNorm || bn.includes(nomeNorm) || nomeNorm.includes(bn)));
  });
  const html = `<div class="modal-bg" onclick="if(event.target===this)this.remove()">
    <div class="modal">
      <div class="lbl">Override de blacklist</div>
      <h3 style="margin-top:6px">Liberar mesmo assim?</h3>
      <p class="muted" style="font-size:12.5px;margin:8px 0">
        <strong>${esc(lead.razao_social || lead.nome_fantasia || '')}</strong> bate contra:
        <br><strong>${esc(bl?.nome || '(regra não encontrada)')}</strong>
        ${bl?.motivo ? `<br><span class="mono" style="font-size:11px">motivo: ${esc(bl.motivo)}</span>` : ''}
      </p>
      <p class="muted" style="font-size:12px;color:#8a2020">
        Ao liberar, o lead vira APROVADO e consome ${PRECO_LEAD ? brl(PRECO_LEAD) : '?'} do crédito.
        A ação é logada e permanente.
      </p>
      <div class="row" style="gap:8px;justify-content:flex-end;margin-top:16px">
        <button class="btn btn--ghost" onclick="this.closest('.modal-bg').remove()">Cancelar</button>
        <button class="btn btn--primary" id="over-conf">Liberar mesmo assim</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  document.getElementById('over-conf').addEventListener('click', async () => {
    if (!PRECO_LEAD) { toast('err', 'preço lead_scrapper indisponível'); return; }
    const { error } = await sb.from('va_leads').update({
      override_blacklist: true, status:'aprovado', custo_creditos: PRECO_LEAD, aprovado_em: new Date().toISOString(),
    }).eq('id', leadId);
    if (error) { toast('err', error.message); return; }
    // debita na razão manualmente (pra manter o padrão do portão)
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const arqNome = (ARQUETIPOS.find(a => a.id === lead.arquetipo_id)?.nome || 'sem_arq').slice(0,40);
    await sb.rpc('va_debitar', {
      p_projeto: MANDATO.id, p_tipo:'lead_scrapper', p_qtd: 1,
      p_referencia: `lead:${leadId.slice(0,8)} · arq:${arqNome} · override_blacklist`,
      p_ciclo: null,
    });
    document.querySelector('.modal-bg')?.remove();
    toast('ok', 'Liberado e aprovado · custo ' + brl(PRECO_LEAD));
    SELECAO.delete(leadId);
    await recarregarTudo();
  });
}

// ─── DESTINO (direita) ───────────────────────────────────────────────
function renderDestino() {
  const el = document.getElementById('cap-col-destino');
  const selecionados = [...SELECAO];
  const custo = PRECO_LEAD ? selecionados.length * PRECO_LEAD : null;
  const noFunil = 'Prompt 4'; // placeholder até funil existir

  const blItems = BLACKLIST.length
    ? BLACKLIST.map(b => `
        <div class="dest-bl__item">
          <div>
            <strong>${esc(b.nome)}</strong>
            <div class="motivo">${esc(b.motivo || '(sem motivo)')} · ${esc(b.origem)}</div>
          </div>
          <button class="btn btn--xs" data-bl-del="${b.id}" title="Remover">×</button>
        </div>
      `).join('')
    : `<div class="muted" style="font-size:11.5px">Nenhuma entrada.</div>`;

  const sugItems = SUGESTOES.length
    ? SUGESTOES.map(s => `
        <div class="dest-bl__sug">
          <strong>${esc(s.nome)}</strong>
          <div class="motivo">${esc(s.motivo)}</div>
          <div class="row">
            <button class="btn btn--xs btn--primary" data-sug-add='${JSON.stringify(s).replace(/'/g,"&#39;")}'>Adicionar</button>
            <button class="btn btn--xs" data-sug-del="${esc(s.nome)}">Descartar</button>
          </div>
        </div>
      `).join('')
    : '';

  el.innerHTML = `
    <div class="cap-col__head">
      <h3 class="cap-col__title">Destino</h3>
      <span class="cap-col__count">portão</span>
    </div>
    <div class="dest-resumo">
      <div class="dest-resumo__label">Selecionados para aprovar</div>
      ${selecionados.length ? `
        <div class="dest-resumo__num">${selecionados.length}</div>
        <div class="dest-resumo__custo">custo estimado: ${custo != null ? brl(custo) : '—'} · unitário ${PRECO_LEAD ? brl(PRECO_LEAD) : '—'}</div>
      ` : `<div class="dest-resumo__vazio">Nenhum lead marcado. Marque no centro pra confirmar entrada no funil.</div>`}
    </div>
    <button class="btn btn--primary dest-portao" id="btn-portao" ${selecionados.length ? '' : 'disabled'}>
      Confirmar entrada no funil
    </button>
    <div class="mono muted" style="font-size:10.5px;text-align:center">
      Ao confirmar, cada lead é lançado como consumo de crédito.
    </div>
    <div class="dest-bl">
      <h4 class="dest-bl__title">Blacklist do mandato</h4>
      <div class="dest-bl__lista">${blItems}</div>
      ${sugItems ? `<div style="margin-top:8px"><div class="dest-bl__title">Sugestões das fontes</div>${sugItems}</div>` : ''}
      <div class="dest-bl__add">
        <input id="bl-nome" placeholder="Nome (obrigatório)">
        <input id="bl-cnpj" placeholder="CNPJ (opcional)">
        <input id="bl-dom" placeholder="Domínio de email (opcional)">
        <input id="bl-motivo" placeholder="Motivo">
        <button class="btn btn--xs" id="bl-add">Adicionar à blacklist</button>
      </div>
    </div>
  `;
  document.getElementById('btn-portao').addEventListener('click', confirmarPortao);
  el.querySelectorAll('[data-bl-del]').forEach(b => b.addEventListener('click', () => removerBlacklist(b.dataset.blDel)));
  el.querySelectorAll('[data-sug-add]').forEach(b => b.addEventListener('click', () => {
    const s = JSON.parse(b.dataset.sugAdd.replace(/&#39;/g,"'"));
    adicionarBlacklistDireto({ nome: s.nome, motivo: s.motivo, origem: 'fonte' });
  }));
  el.querySelectorAll('[data-sug-del]').forEach(b => b.addEventListener('click', () => {
    SUGESTOES = SUGESTOES.filter(s => s.nome !== b.dataset.sugDel);
    renderDestino();
  }));
  document.getElementById('bl-add').addEventListener('click', async () => {
    const nome = document.getElementById('bl-nome').value.trim();
    if (!nome || nome.length < 3) { toast('err', 'nome mínimo 3 chars'); return; }
    const cnpj = document.getElementById('bl-cnpj').value.trim() || null;
    const dominio = document.getElementById('bl-dom').value.trim() || null;
    const motivo = document.getElementById('bl-motivo').value.trim() || null;
    await adicionarBlacklistDireto({ nome, cnpj, dominio, motivo, origem:'manual' });
  });
}
async function adicionarBlacklistDireto(entrada) {
  const { error } = await sb.from('va_projeto_blacklist').insert({ projeto_id: MANDATO.id, ...entrada });
  if (error) { toast('err', error.message); return; }
  toast('ok', 'Blacklist adicionada'); await recarregarTudo();
}
async function removerBlacklist(id) {
  if (!confirm('Remover essa entrada da blacklist?')) return;
  const { error } = await sb.from('va_projeto_blacklist').delete().eq('id', id);
  if (error) { toast('err', error.message); return; }
  toast('ok', 'Removida'); await recarregarTudo();
}

async function confirmarPortao() {
  const ids = [...SELECAO];
  if (!ids.length) { toast('err', 'nenhum lead selecionado'); return; }
  if (!PRECO_LEAD) { toast('err', 'preço lead_scrapper indisponível'); return; }
  const custo = ids.length * PRECO_LEAD;
  if (!confirm(`Confirmar entrada de ${ids.length} lead(s) no funil? Custo total: ${brl(custo)}.`)) return;
  const btn = document.getElementById('btn-portao');
  if (btn) { btn.disabled = true; btn.textContent = 'processando…'; }
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-portao-leads', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ projeto_id: MANDATO.id, lead_ids: ids }),
    });
    const d = await r.json();
    if (!d.ok && !d.aprovados) throw new Error([d.erro, d.detalhe].filter(Boolean).join(' · ') || ('HTTP '+r.status));
    toast('ok', `${d.aprovados} aprovado(s) · custo ${brl(d.custo_total)}${d.falhas?` · ${d.falhas.length} falha(s)`:''}`);
    SELECAO.clear();
    await recarregarTudo();
  } catch (e) {
    toast('err', String(e.message).slice(0,240));
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar entrada no funil'; }
  }
}

// ─── atalhos de teclado A/D ──────────────────────────────────────────
function bindAtalhos() {
  document.addEventListener('keydown', (ev) => {
    if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA' || ev.target.tagName === 'SELECT') return;
    if (document.getElementById('mq-panel-captacao')?.hidden) return;
    if (ev.key === 'a' || ev.key === 'A') { if (SELECAO.size) confirmarPortao(); }
    else if (ev.key === 'd' || ev.key === 'D') {
      const primeiro = [...SELECAO][0]; if (primeiro) descartarUm(primeiro);
    }
  });
}
