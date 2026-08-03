// MANDATO · Zona Máquina · aba FUNIL.
// Kanban 4 colunas + drawer + painel de cadência + adendos (desdobramento, contato).

import { sb } from '/mandato/core/core.js';
import { toast } from '/mandato/core/ui.js';
import { esc, brl, num, dataBR } from '/mandato/core/format.js';

let MANDATO = null;
let LEADS = [];       // leads com funil_etapa não-null (todos)
let ARQUETIPOS = [];
let CADENCIA = null;  // 1 config
let TEMPLATES = [];   // por arquétipo
let DISPAROS_HOJE = 0;

const COLUNAS = [
  { key:'na_fila',     label:'Na fila' },
  { key:'contatado',   label:'Contatado' },
  { key:'respondeu',   label:'Respondeu',   hot:true },
  { key:'em_conversa', label:'Em conversa', hot:true },
];
const DESDOBRAMENTOS = [
  { v:'interessado_ativo',    l:'interessado ativo' },
  { v:'quer_vender',          l:'quer vender' },
  { v:'comprador_outra_tese', l:'comprador · outra tese' },
  { v:'parceiro_potencial',   l:'parceiro potencial' },
  { v:'sem_interesse',        l:'sem interesse' },
];
const CARGOS = [
  { v:'dono_socio',  l:'dono/sócio' },
  { v:'diretor',     l:'diretor' },
  { v:'gerente',     l:'gerente' },
  { v:'funcionario', l:'funcionário' },
  { v:'outro',       l:'outro' },
];

export async function mountFunil(mandato) {
  MANDATO = mandato;
  const root = document.getElementById('mq-panel-funil');
  if (!root) return;
  root.innerHTML = `
    <div id="cad-painel" class="cad-painel">
      <div class="cad-painel__head" id="cad-head-toggle" style="cursor:pointer">
        <div class="cad-status" id="cad-status">carregando…</div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="mono muted" style="font-size:10px">clique pra editar</span>
        </div>
      </div>
      <div class="cad-painel__body" id="cad-body"></div>
    </div>
    <div class="desd-linha" id="desd-linha"></div>
    <div class="kb-wrap" id="kb-wrap"></div>
    <div class="kb-fora" id="kb-fora"></div>
  `;
  document.getElementById('cad-head-toggle').addEventListener('click', () => {
    document.getElementById('cad-painel').classList.toggle('is-open');
  });
  await recarregarTudo();
  root.setAttribute('data-ready', 'true');
}

async function recarregarTudo() {
  const [leadsR, arqR, cadR, tplR, dispR] = await Promise.all([
    sb.from('va_leads').select('*').eq('projeto_id', MANDATO.id).not('funil_etapa', 'is', null).order('aprovado_em', { ascending:true }),
    sb.from('va_arquetipos').select('id, nome, filtro, abordagem').eq('projeto_id', MANDATO.id).eq('status','aprovado'),
    sb.from('va_cadencia_config').select('*').eq('projeto_id', MANDATO.id).maybeSingle(),
    sb.from('va_cadencia_templates').select('*').eq('projeto_id', MANDATO.id),
    sb.from('va_disparos').select('id').eq('projeto_id', MANDATO.id).eq('status','enviado').gte('enviado_em', new Date(new Date().setHours(0,0,0,0)).toISOString()),
  ]);
  LEADS = leadsR.data || [];
  ARQUETIPOS = arqR.data || [];
  CADENCIA = cadR.data || null;
  TEMPLATES = tplR.data || [];
  DISPAROS_HOJE = (dispR.data || []).length;
  renderCadencia();
  renderDesdContadores();
  renderKanban();
  renderFora();
}

// ─── Cadência ────────────────────────────────────────────────────────
function renderCadencia() {
  const el = document.getElementById('cad-status');
  const ativa = !!CADENCIA?.ativa;
  const teto = CADENCIA?.teto_diario ?? 4;
  el.innerHTML = `
    <span class="pill ${ativa?'pill--ativa':'pill--pausada'}">${ativa?'ATIVA':'PAUSADA'}</span>
    <span>hoje: ${DISPAROS_HOJE} de ${teto} disparos</span>
    <span>janela: ${CADENCIA?.janela_inicio?.slice(0,5) || '09:00'}–${CADENCIA?.janela_fim?.slice(0,5) || '18:00'}${CADENCIA?.dias_uteis_apenas?' · úteis':''}</span>
  `;
  document.getElementById('cad-body').innerHTML = corpoCadenciaHTML();
  bindCadenciaHandlers();
}
function corpoCadenciaHTML() {
  const c = CADENCIA || { ativa:false, teto_diario:4, janela_inicio:'09:00', janela_fim:'18:00', dias_uteis_apenas:true, intervalo_toques_dias:2 };
  return `
    <div class="cad-config-grid">
      <label>ativa
        <select id="cad-ativa">
          <option value="false" ${!c.ativa?'selected':''}>não</option>
          <option value="true" ${c.ativa?'selected':''}>sim</option>
        </select>
      </label>
      <label>teto diário
        <input id="cad-teto" type="number" min="1" max="200" value="${c.teto_diario}">
      </label>
      <label>janela início
        <input id="cad-ji" type="time" value="${(c.janela_inicio||'09:00').slice(0,5)}">
      </label>
      <label>janela fim
        <input id="cad-jf" type="time" value="${(c.janela_fim||'18:00').slice(0,5)}">
      </label>
      <label>dias úteis apenas
        <select id="cad-du">
          <option value="true" ${c.dias_uteis_apenas?'selected':''}>sim</option>
          <option value="false" ${!c.dias_uteis_apenas?'selected':''}>não</option>
        </select>
      </label>
      <label>intervalo T1→T2 (dias)
        <input id="cad-int" type="number" min="1" max="30" value="${c.intervalo_toques_dias}">
      </label>
    </div>
    <div class="row" style="justify-content:space-between;margin-top:10px">
      <button class="btn btn--sm btn--primary" id="cad-salvar">Salvar config</button>
      <button class="btn btn--sm" id="cad-tick">Processar agora</button>
    </div>
    <div style="margin-top:14px" id="tpl-wrap">${templatesHTML()}</div>
  `;
}
function templatesHTML() {
  const arqsUsados = new Set(LEADS.filter(l => ['na_fila','contatado'].includes(l.funil_etapa)).map(l => l.arquetipo_id).filter(Boolean));
  const arqsRelevantes = ARQUETIPOS.filter(a => arqsUsados.has(a.id) || TEMPLATES.some(t => t.arquetipo_id === a.id));
  if (!arqsRelevantes.length) return `<div class="muted" style="font-size:12px">Nenhum arquétipo com lead no funil. Templates aparecem quando o portão manda leads pra cá.</div>`;
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
      <div class="mono" style="font-size:10.5px;text-transform:uppercase;color:var(--ink-3)">TEMPLATES POR ARQUÉTIPO (2 toques)</div>
      <button class="btn btn--xs" id="tpl-aprovar-todos" title="Aprova todos os templates rascunhados do projeto">Aprovar todos</button>
    </div>
    <div class="tpl-list">
      ${arqsRelevantes.map(a => tplItemHTML(a)).join('')}
    </div>
  `;
}
async function aprovarTodosTemplates() {
  // Coleta rascunhos (textarea + arquétipo/toque) que estão não-aprovados
  const rascunhos = [];
  document.querySelectorAll('[data-tpl]').forEach(el => {
    const [aid, tqStr] = el.dataset.tpl.split('::');
    const key = aid + '::' + tqStr;
    // check se o botão Aprovar está habilitado (=não aprovado ainda)
    const bt = document.querySelector(`[data-tpl-aprovar="${key}"]`);
    if (bt && !bt.disabled) {
      rascunhos.push({ arquetipo_id: aid, toque: Number(tqStr), corpo: el.value.trim() });
    }
  });
  if (!rascunhos.length) { toast('ok', 'Nenhum rascunho pra aprovar'); return; }
  if (!confirm(`Aprovar em massa ${rascunhos.length} template(s) rascunhado(s)?`)) return;
  let ok = 0, fail = 0;
  for (const r of rascunhos) {
    if (r.corpo.length < 10) { fail++; continue; }
    const { error } = await sb.from('va_cadencia_templates').upsert(
      { projeto_id: MANDATO.id, arquetipo_id: r.arquetipo_id, toque: r.toque, corpo: r.corpo, aprovado: true },
      { onConflict: 'arquetipo_id,toque' }
    );
    if (error) fail++; else ok++;
  }
  toast('ok', `${ok} aprovado(s)${fail?` · ${fail} falha(s)`:''}`);
  await recarregarTudo();
}
function tplItemHTML(arq) {
  const t1 = TEMPLATES.find(t => t.arquetipo_id === arq.id && t.toque === 1) || rascunhoTemplate(arq, 1);
  const t2 = TEMPLATES.find(t => t.arquetipo_id === arq.id && t.toque === 2) || rascunhoTemplate(arq, 2);
  const semTpl = LEADS.filter(l => l.arquetipo_id === arq.id && ['na_fila','contatado'].includes(l.funil_etapa)).length;
  const aviso = (!t1.aprovado || !t2.aprovado) && semTpl
    ? `<span class="pill pill--tpl-no" title="tem lead esperando template aprovado">${semTpl} lead(s) parado(s)</span>`
    : '';
  return `
    <div class="tpl-item" data-arq="${arq.id}">
      <div class="tpl-item__head">
        <div class="tpl-item__nome">${esc(arq.nome)}</div>
        <div class="tpl-item__pills">${aviso}</div>
      </div>
      <div class="tpl-toques">
        ${tplToqueHTML(arq, t1)}
        ${tplToqueHTML(arq, t2)}
      </div>
    </div>
  `;
}
function tplToqueHTML(arq, t) {
  const pill = t.aprovado
    ? `<span class="pill pill--tpl-ok">aprovado</span>`
    : `<span class="pill pill--tpl-no">rascunho</span>`;
  return `
    <div class="tpl-toque">
      <div style="font-family:var(--mono);font-size:10.5px;color:var(--ink-3);text-transform:uppercase;margin-bottom:3px">TOQUE ${t.toque}</div>
      <textarea data-tpl="${arq.id}::${t.toque}">${esc(t.corpo || '')}</textarea>
      <div class="tpl-toque__foot">
        <span class="tpl-toque__preview" data-preview="${arq.id}::${t.toque}"></span>
        <div style="display:flex;gap:5px;align-items:center">
          ${pill}
          <button class="btn btn--xs" data-tpl-salvar="${arq.id}::${t.toque}">Salvar</button>
          <button class="btn btn--xs ${t.aprovado?'':'btn--primary'}" data-tpl-aprovar="${arq.id}::${t.toque}" ${t.aprovado?'disabled':''}>Aprovar</button>
        </div>
      </div>
    </div>
  `;
}
function rascunhoTemplate(arq, toque) {
  // Toque 1 · abertura curta e neutra
  // Toque 2 · BUMP curto (P4.1): tentativa de reconexão + reforço mínimo.
  // Angulo completo vira munição da IA de resposta personalizada, não do T2.
  const corpo = toque === 1
    ? `Bom dia, {{nome_fantasia}}. Assessoro uma venda no setor · pode fazer sentido a gente conversar rápido pra ver se é caso. Faz sentido?`
    : `Oi {{nome_fantasia}}, só reconectando · a oportunidade que citei segue aberta. Se fizer sentido, marco 15 min. Se não for agora, sem problema.`;
  return { arquetipo_id: arq.id, toque, corpo, aprovado: false, _rascunho: true };
}
function bindCadenciaHandlers() {
  document.getElementById('cad-salvar')?.addEventListener('click', salvarCadencia);
  document.getElementById('cad-tick')?.addEventListener('click', processarAgora);
  document.getElementById('tpl-aprovar-todos')?.addEventListener('click', aprovarTodosTemplates);
  document.querySelectorAll('[data-tpl-salvar]').forEach(b => b.addEventListener('click', () => salvarTemplate(b.dataset.tplSalvar, false)));
  document.querySelectorAll('[data-tpl-aprovar]').forEach(b => b.addEventListener('click', () => salvarTemplate(b.dataset.tplAprovar, true)));
  // preview: pega 1º lead do arquétipo e resolve
  document.querySelectorAll('[data-preview]').forEach(el => {
    const [aid, tqStr] = el.dataset.preview.split('::');
    const ta = document.querySelector(`[data-tpl="${aid}::${tqStr}"]`);
    const update = () => {
      const lead = LEADS.find(l => l.arquetipo_id === aid);
      const nome = fmtNomeLead(lead) || 'Prezado(a)';
      el.textContent = 'preview: ' + (ta.value || '').replace(/\{\{\s*nome_fantasia\s*\}\}/g, nome).slice(0,80);
    };
    ta.addEventListener('input', update); update();
  });
}
async function salvarCadencia() {
  const patch = {
    projeto_id: MANDATO.id,
    ativa: document.getElementById('cad-ativa').value === 'true',
    teto_diario: Number(document.getElementById('cad-teto').value) || 4,
    janela_inicio: document.getElementById('cad-ji').value,
    janela_fim: document.getElementById('cad-jf').value,
    dias_uteis_apenas: document.getElementById('cad-du').value === 'true',
    intervalo_toques_dias: Number(document.getElementById('cad-int').value) || 2,
  };
  const { error } = await sb.from('va_cadencia_config').upsert(patch, { onConflict: 'projeto_id' });
  if (error) { toast('err', error.message); return; }
  toast('ok', 'Cadência salva'); await recarregarTudo();
}
async function salvarTemplate(key, aprovar) {
  const [aid, tqStr] = key.split('::');
  const toque = Number(tqStr);
  const corpo = document.querySelector(`[data-tpl="${key}"]`).value.trim();
  if (!corpo || corpo.length < 10) { toast('err', 'corpo mínimo 10 chars'); return; }
  const patch = {
    projeto_id: MANDATO.id, arquetipo_id: aid, toque, corpo,
  };
  if (aprovar) patch.aprovado = true;
  const { error } = await sb.from('va_cadencia_templates').upsert(patch, { onConflict: 'arquetipo_id,toque' });
  if (error) { toast('err', error.message); return; }
  toast('ok', aprovar ? 'Template aprovado' : 'Template salvo'); await recarregarTudo();
}
async function processarAgora() {
  if (!confirm('Processar cadência agora? Envia disparos elegíveis dentro do teto diário.')) return;
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-cadencia-tick', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ projeto_id: MANDATO.id }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.erro || 'falha tick');
    const enviados = d.projetos?.[0]?.enviados_ciclo ?? 0;
    toast('ok', `Tick concluído · ${enviados} enviado(s) neste ciclo`);
    await recarregarTudo();
  } catch (e) { toast('err', String(e.message).slice(0,240)); }
}

// ─── Contadores de desdobramento ─────────────────────────────────────
function renderDesdContadores() {
  const el = document.getElementById('desd-linha');
  const contagem = {};
  for (const l of LEADS) {
    if (l.desdobramento) contagem[l.desdobramento] = (contagem[l.desdobramento] || 0) + 1;
  }
  const partes = DESDOBRAMENTOS.filter(d => contagem[d.v]).map(d => `${contagem[d.v]} ${d.l}`);
  el.textContent = partes.length ? 'desdobramentos: ' + partes.join(' · ') : '';
}

// ─── Kanban ──────────────────────────────────────────────────────────
function fmtNomeLead(l) {
  if (!l) return '';
  const raw = l.nome_fantasia || l.razao_social || '';
  return raw.split(/\s+/).map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
function renderKanban() {
  const el = document.getElementById('kb-wrap');
  el.innerHTML = COLUNAS.map(c => colunaHTML(c)).join('');
  el.querySelectorAll('[data-lead-abrir]').forEach(k => k.addEventListener('click', () => abrirDrawer(k.dataset.leadAbrir)));
}
function colunaHTML(col) {
  const rows = LEADS.filter(l => l.funil_etapa === col.key);
  return `
    <div class="kb-col ${col.hot?'kb-col--hot':''}">
      <div class="kb-col__head">
        <h4 class="kb-col__title">${col.label}</h4>
        <span class="kb-col__count">${rows.length}</span>
      </div>
      <div class="kb-col__body">
        ${rows.map(l => cardHTML(l)).join('') || '<div class="muted mono" style="font-size:10.5px;text-align:center;padding:12px">vazio</div>'}
      </div>
    </div>
  `;
}
function cardHTML(l) {
  const arq = ARQUETIPOS.find(a => a.id === l.arquetipo_id)?.nome || '—';
  const caption = captionCard(l);
  const pause = l.pausado ? ' <span class="kb-card__pause" title="pausado manualmente">‖</span>' : '';
  return `
    <div class="kb-card" data-lead-abrir="${l.id}" title="${esc(l.razao_social||'')}">
      <div class="kb-card__nome">${esc(fmtNomeLead(l) || '(sem nome)')}${pause}</div>
      <div class="kb-card__meta">
        <span class="pill" style="font-size:10px">${esc(arq.slice(0,30))}</span>
        <span>${caption}</span>
      </div>
    </div>
  `;
}
function captionCard(l) {
  const dias = ts => Math.floor((Date.now() - new Date(ts).getTime()) / 86400_000);
  if (l.funil_etapa === 'respondeu' && l.respondeu_em) return `respondeu há ${dias(l.respondeu_em)}d`;
  if (l.funil_etapa === 'contatado' && l.toque2_em) return `T2 há ${dias(l.toque2_em)}d`;
  if (l.funil_etapa === 'contatado' && l.proximo_toque_apos) {
    const ds = Math.max(0, Math.floor((new Date(l.proximo_toque_apos).getTime() - Date.now()) / 86400_000));
    return `T2 em ${ds}d`;
  }
  if (l.funil_etapa === 'contatado' && l.toque1_em) return `T1 há ${dias(l.toque1_em)}d`;
  if (l.aprovado_em) return `aprovado há ${dias(l.aprovado_em)}d`;
  return '';
}
function renderFora() {
  const el = document.getElementById('kb-fora');
  const semC = LEADS.filter(l => l.funil_etapa === 'sem_contato').length;
  const optOut = LEADS.filter(l => l.funil_etapa === 'optout').length;
  const promov = LEADS.filter(l => l.funil_etapa === 'promovido').length;
  el.innerHTML = `
    ${semC ? `<button data-fora-toggle="sem_contato">sem contato (${semC})</button>` : ''}
    ${optOut ? `<button data-fora-toggle="optout">opt-out (${optOut})</button>` : ''}
    ${promov ? `<button data-fora-toggle="promovido">Promovidos (${promov})</button>` : ''}
  `;
  el.querySelectorAll('[data-fora-toggle]').forEach(b => b.addEventListener('click', () => alert('Lista '+b.dataset.foraToggle+': ver via drawer nos cards existentes (v1 mostra contagem apenas)')));
}

// ─── Drawer ──────────────────────────────────────────────────────────
async function abrirDrawer(leadId) {
  const l = LEADS.find(x => x.id === leadId); if (!l) return;
  // busca disparos + mensagens recebidas
  const [dR, mR] = await Promise.all([
    sb.from('va_disparos').select('*').eq('lead_id', leadId).order('criado_em', { ascending:false }).limit(20),
    sb.from('va_mensagens_recebidas').select('*').eq('lead_id', leadId).order('recebida_em', { ascending:false }).limit(20),
  ]);
  const disparos = dR.data || [];
  const mensagens = mR.data || [];
  const arq = ARQUETIPOS.find(a => a.id === l.arquetipo_id);
  const drwHtml = `
    <div class="drw-bg" onclick="if(event.target===this)this.remove()">
      <div class="drw">
        <button class="btn btn--sm" onclick="this.closest('.drw-bg').remove()" style="float:right">Fechar</button>
        <h3>${esc(fmtNomeLead(l) || l.razao_social || '(sem nome)')}</h3>
        <div class="mono muted" style="font-size:11px">${esc(l.cnpj || '—')} · ${esc(l.cidade || '')}/${esc(l.uf || '')}</div>
        <div class="mono" style="font-size:11px;margin-top:4px">arquétipo: <b>${esc(arq?.nome || '—')}</b></div>
        <div class="mono" style="font-size:11px">whatsapp: <b>${esc(l.whatsapp || '(sem)')}</b> · telefone: <b>${esc(l.telefone || '(sem)')}</b></div>
        <div class="row">
          <button class="btn btn--sm" id="drw-pausar">${l.pausado?'Retomar cadência':'Pausar cadência'}</button>
          <button class="btn btn--sm" id="drw-mover">Mover…</button>
          <button class="btn btn--sm btn--primary" id="drw-promover" ${l.funil_etapa==='promovido'?'disabled':''}>Promover pra Mesa</button>
          <button class="btn btn--sm" id="drw-optout" ${l.funil_etapa==='optout'?'disabled':''}>Marcar opt-out</button>
        </div>

        ${l.funil_etapa && ['respondeu','em_conversa','promovido'].includes(l.funil_etapa) || l.desdobramento ? `
        <div class="drw__section">
          <h4>Desdobramento + contato de quem respondeu</h4>
          <div class="desd-form">
            <select id="drw-desd">
              <option value="">— sem classificação —</option>
              ${DESDOBRAMENTOS.map(d => `<option value="${d.v}" ${l.desdobramento===d.v?'selected':''}>${d.l}</option>`).join('')}
            </select>
            <textarea id="drw-desd-nota" rows="2" placeholder="Nota rápida (opcional)">${esc(l.desdobramento_nota || '')}</textarea>
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:6px">
              <input id="drw-contato-nome" type="text" placeholder="Nome de quem respondeu" value="${esc(l.contato_nome || '')}">
              <select id="drw-contato-cargo">
                <option value="">cargo</option>
                ${CARGOS.map(c => `<option value="${c.v}" ${l.contato_cargo===c.v?'selected':''}>${c.l}</option>`).join('')}
              </select>
            </div>
            <button class="btn btn--sm btn--primary" id="drw-desd-salvar">Salvar classificação</button>
          </div>
        </div>` : ''}

        ${l.funil_etapa === 'respondeu' || l.funil_etapa === 'em_conversa' ? `
        <div class="drw__section">
          <h4>Rascunhar resposta (IA)</h4>
          <button class="btn btn--sm btn--primary" id="drw-rascunhar">Rascunhar com IA</button>
          <div id="drw-rascunho-wrap" style="display:none;margin-top:8px">
            <textarea id="drw-rascunho" rows="4" style="width:100%;padding:8px;border:1px solid var(--line);border-radius:var(--r-sm);font-family:var(--mono);font-size:12px"></textarea>
            <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
              <button class="btn btn--sm" id="drw-regenerar">Regenerar</button>
              <button class="btn btn--sm btn--primary" id="drw-enviar">Aprovar e enviar</button>
            </div>
          </div>
          <div id="drw-rascunho-status" class="mono muted" style="font-size:10.5px;margin-top:4px"></div>
        </div>` : ''}
        <div class="drw__section">
          <h4>Conversa (${disparos.length + mensagens.length})</h4>
          <div class="drw__historico">
            ${renderConversaCrono(disparos, mensagens)}
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', drwHtml);
  document.getElementById('drw-pausar')?.addEventListener('click', () => togglePausa(leadId));
  document.getElementById('drw-mover')?.addEventListener('click', () => moverLead(leadId));
  document.getElementById('drw-promover')?.addEventListener('click', () => promoverLead(leadId));
  document.getElementById('drw-optout')?.addEventListener('click', () => optOutManual(leadId));
  document.getElementById('drw-desd-salvar')?.addEventListener('click', () => salvarDesdobramento(leadId));
  document.getElementById('drw-rascunhar')?.addEventListener('click', () => rascunharIA(leadId));
  document.getElementById('drw-regenerar')?.addEventListener('click', () => rascunharIA(leadId));
  document.getElementById('drw-enviar')?.addEventListener('click', () => enviarResposta(leadId));
}

// Junta disparos + mensagens em uma timeline única (asc por tempo)
function renderConversaCrono(disparos, mensagens) {
  const items = [];
  for (const d of disparos) {
    if (d.status === 'enviado' && d.enviado_em) items.push({ ts: d.enviado_em, tipo: 'saida', label:`Nós · T${d.toque}${d.tipo_envio==='resposta'?' (resposta)':''}`, corpo: d.corpo_snapshot });
  }
  for (const m of mensagens) items.push({ ts: m.recebida_em, tipo: 'entrada', label:`Lead · ${m.telefone}`, corpo: m.corpo });
  items.sort((a,b) => new Date(a.ts) - new Date(b.ts));
  if (!items.length) return '<div class="muted" style="font-size:11px">Sem mensagens ainda.</div>';
  return items.map(i => `
    <div class="drw__${i.tipo==='saida'?'disparo':'msg'}">
      <b>${dataBR((i.ts||'').slice(0,10))} ${new Date(i.ts).toISOString().slice(11,16)} · ${esc(i.label)}</b>
      <div style="margin-top:3px;white-space:pre-wrap;font-size:11.5px">${esc(i.corpo || '(vazio)')}</div>
    </div>
  `).join('');
}
async function rascunharIA(leadId) {
  const btn = document.getElementById('drw-rascunhar');
  const btnR = document.getElementById('drw-regenerar');
  const status = document.getElementById('drw-rascunho-status');
  const wrap = document.getElementById('drw-rascunho-wrap');
  const ta = document.getElementById('drw-rascunho');
  const antes = btn?.textContent || 'Rascunhar com IA';
  if (btn) { btn.disabled = true; btn.textContent = 'gerando…'; }
  if (btnR) btnR.disabled = true;
  status.textContent = '';
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-rascunhar-resposta', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ lead_id: leadId }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error([d.erro, d.detalhe].filter(Boolean).join(' · ') || 'HTTP '+r.status);
    ta.value = d.rascunho;
    wrap.style.display = 'block';
    status.textContent = `arquétipo: ${d.contexto?.arquetipo || '—'} · região: ${d.contexto?.regiao || '—'} · ${d.contexto?.msgs_count||0} mensagem(ns) do lead`;
    if (btn) btn.textContent = 'Regerar (novo)';
  } catch (e) {
    status.textContent = String(e.message).slice(0,240);
    if (btn) btn.textContent = antes;
  } finally { if (btn) btn.disabled = false; if (btnR) btnR.disabled = false; }
}
async function enviarResposta(leadId) {
  const corpo = document.getElementById('drw-rascunho').value.trim();
  if (!corpo || corpo.length < 5) { toast('err', 'rascunho vazio'); return; }
  if (!confirm('Enviar essa resposta agora via WhatsApp? Consumo do teto de disparos NÃO é contado (resposta ≠ cadência).')) return;
  const btn = document.getElementById('drw-enviar');
  if (btn) { btn.disabled = true; btn.textContent = 'enviando…'; }
  try {
    const tok = (await sb.auth.getSession()).data.session?.access_token;
    const r = await fetch('/api/va-enviar-resposta', {
      method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+tok },
      body: JSON.stringify({ lead_id: leadId, corpo }),
    });
    const d = await r.json();
    if (!r.ok || !d.ok) throw new Error(d.erro || 'HTTP '+r.status);
    toast('ok', 'Enviado · lead → em conversa');
    document.querySelector('.drw-bg')?.remove();
    await recarregarTudo();
  } catch (e) {
    toast('err', String(e.message).slice(0,240));
    if (btn) { btn.disabled = false; btn.textContent = 'Aprovar e enviar'; }
  }
}
async function togglePausa(id) {
  const l = LEADS.find(x => x.id === id);
  const { error } = await sb.from('va_leads').update({ pausado: !l.pausado }).eq('id', id);
  if (error) { toast('err', error.message); return; }
  toast('ok', l.pausado ? 'Retomado' : 'Pausado');
  document.querySelector('.drw-bg')?.remove();
  await recarregarTudo();
}
async function moverLead(id) {
  const alvo = prompt('Mover para (na_fila / contatado / respondeu / em_conversa):');
  if (!alvo || !['na_fila','contatado','respondeu','em_conversa'].includes(alvo)) return;
  const { error } = await sb.from('va_leads').update({ funil_etapa: alvo }).eq('id', id);
  if (error) { toast('err', error.message); return; }
  await sb.from('va_leads_log').insert({ lead_id: id, acao: 'movido', detalhe: `manual → ${alvo}` });
  toast('ok', 'Movido'); document.querySelector('.drw-bg')?.remove(); await recarregarTudo();
}
async function promoverLead(id) {
  if (!confirm('Promover pra Mesa? Sai do kanban.')) return;
  const { error } = await sb.from('va_leads').update({ funil_etapa: 'promovido' }).eq('id', id);
  if (error) { toast('err', error.message); return; }
  await sb.from('va_leads_log').insert({ lead_id: id, acao: 'movido', detalhe: 'promovido pra Mesa' });
  toast('ok', 'Promovido'); document.querySelector('.drw-bg')?.remove(); await recarregarTudo();
}
async function optOutManual(id) {
  if (!confirm('Marcar opt-out? Ação irreversível (trigger impede volta).')) return;
  const { error } = await sb.from('va_leads').update({ funil_etapa: 'optout' }).eq('id', id);
  if (error) { toast('err', error.message); return; }
  toast('ok', 'Opt-out registrado'); document.querySelector('.drw-bg')?.remove(); await recarregarTudo();
}
async function salvarDesdobramento(id) {
  const desd = document.getElementById('drw-desd').value || null;
  const nota = document.getElementById('drw-desd-nota').value.trim() || null;
  const cnome = document.getElementById('drw-contato-nome').value.trim() || null;
  const ccargo = document.getElementById('drw-contato-cargo').value || null;
  const patch = { desdobramento: desd, desdobramento_nota: nota, contato_nome: cnome, contato_cargo: ccargo };
  const { error } = await sb.from('va_leads').update(patch).eq('id', id);
  if (error) { toast('err', error.message); return; }
  toast('ok', 'Classificação salva');
  document.querySelector('.drw-bg')?.remove();
  await recarregarTudo();
}
