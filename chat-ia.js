/** * Chat IA 1Negócio — Widget * Versão 2.3 — 2026-04-17 * Design: frosted glass, Cabinet Grotesk, logo 1N idêntica à home * v2.2: responsivo mobile — painel centralizado na tela, sem estouro de bordas * v2.3: ícone robô animado (3 variações) */
(function() {
  'use strict';
  const API_ENDPOINT = 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/chat-ia';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
  const WHATSAPP_FALLBACK = '5511952136406';
  const MIN_DELAY_MS = 700;
  const MAX_DELAY_MS = 1400;
  const LEAD_ASK_AFTER_MIN = 3;
  const LEAD_ASK_AFTER_MAX = 5;
    const state = { isOpen: false, isTyping: false, messages: [], perfil: null, subPerfil: null, leadCaptured: false, leadId: null, lead: { nome: null, whatsapp: null }, qualificationDone: false, nameAsked: false, nameCollected: false, phoneTriggerCount: 0, assistantMsgCount: 0, phoneCaptureAsked: false };
  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Cabinet+Grotesk:wght@400;500;700;800&display=swap');
    #n1-chat-wrap,#n1-chat-wrap *{box-sizing:border-box}
    #n1-chat-btn{position:fixed;bottom:24px;right:24px;width:52px;height:52px;background:#1a7a3c;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .15s ease,background .15s ease;box-shadow:0 4px 16px rgba(26,122,60,.35);overflow:hidden}
    #n1-chat-btn:hover{transform:scale(1.06);background:#166534}
    #n1-chat-btn.open{background:#1a3a28}
    #n1-chat-btn .n1-open-icon svg{width:24px;height:24px}
    #n1-chat-btn .n1-close-icon{display:none;color:#fff;font-size:22px;font-family:'Cabinet Grotesk',sans-serif;font-weight:700;line-height:1}
    #n1-chat-btn.open .n1-open-icon{display:none}
    #n1-chat-btn.open .n1-close-icon{display:flex}
    #n1-chat-btn .n1-pulse{position:absolute;top:-1px;right:-1px;width:13px;height:13px;background:#f59e0b;border:2px solid #fff;border-radius:50%;animation:n1-pulse 2s infinite}
    @keyframes n1-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.2);opacity:.7}}
    #n1-chat-btn.discreto{width:42px;height:42px;bottom:16px;right:16px;opacity:.8}
    #n1-chat-btn.discreto:hover{opacity:1}
    #n1-chat-btn.discreto .n1-pulse{display:none}
    #n1-chat-panel{position:fixed;bottom:96px;right:24px;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:rgba(255,255,255,.82);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);border:1.5px solid rgba(26,122,60,.15);border-radius:24px;display:none;flex-direction:column;font-family:'Cabinet Grotesk',sans-serif;color:#0d2b1e;z-index:2147483645;box-shadow:0 8px 40px rgba(13,43,30,.10),0 2px 8px rgba(13,43,30,.06);overflow:hidden;animation:n1-slideUp .22s ease}
    @keyframes n1-slideUp{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
    #n1-chat-panel.open{display:flex}
    #n1-chat-header{padding:13px 16px 11px;border-bottom:1px solid rgba(26,122,60,.1);display:flex;align-items:center;justify-content:space-between;background:rgba(247,252,249,.92);border-radius:24px 24px 0 0;flex-shrink:0}
    .n1-header-left{display:flex;align-items:center;gap:10px}
    .n1-logo-badge{display:flex;align-items:center;justify-content:center;width:38px;height:38px;background:#0d2b1e;border-radius:10px;flex-shrink:0}
    .n1-logo-txt{font-family:'Syne',sans-serif;font-weight:800;font-size:15px;letter-spacing:-.03em;line-height:1;white-space:nowrap}
    .n1-logo-txt em{color:#1a7a3c;font-style:normal}
    .n1-logo-txt span{color:#fff}
    .n1-header-info{display:flex;flex-direction:column;gap:1px}
    .n1-header-name{font-family:'Syne',sans-serif;font-weight:800;font-size:14px;color:#0d2b1e;letter-spacing:-.01em;line-height:1.2}
    .n1-header-name em{color:#1a7a3c;font-style:normal}
    .n1-header-status{font-family:'Cabinet Grotesk',sans-serif;font-size:11px;color:#1a7a3c;font-weight:500;display:flex;align-items:center;gap:5px}
    .n1-header-status::before{content:'';width:6px;height:6px;background:#1a7a3c;border-radius:50%;animation:n1-blink 2.5s infinite}
    @keyframes n1-blink{0%,100%{opacity:1}50%{opacity:.35}}
    #n1-chat-close{background:rgba(13,43,30,.06);border:none;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#0d2b1e;font-size:16px;font-family:'Cabinet Grotesk',sans-serif;transition:background .15s;flex-shrink:0}
    #n1-chat-close:hover{background:rgba(13,43,30,.12)}
    #n1-chat-messages{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:rgba(13,43,30,.1) transparent}
    #n1-chat-messages::-webkit-scrollbar{width:4px}
    #n1-chat-messages::-webkit-scrollbar-thumb{background:rgba(13,43,30,.1);border-radius:2px}
    .n1-msg{max-width:84%;padding:9px 13px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;font-family:'Cabinet Grotesk',sans-serif;font-weight:400}
    .n1-msg.user{align-self:flex-end;background:#1a7a3c;color:#fff;font-weight:500;border-radius:16px 16px 4px 16px}
    .n1-msg.bot{align-self:flex-start;background:rgba(255,255,255,.88);color:#0d2b1e;border-radius:4px 16px 16px 16px;border:1px solid rgba(26,122,60,.12);box-shadow:0 1px 4px rgba(13,43,30,.06)}
    .n1-msg.bot a{color:#1a7a3c;text-decoration:underline}
    .n1-msg.bot strong{color:#0d2b1e;font-weight:700}
    .n1-typing{align-self:flex-start;padding:10px 14px;background:rgba(255,255,255,.88);border-radius:4px 16px 16px 16px;border:1px solid rgba(26,122,60,.12);display:flex;gap:4px;align-items:center}
    .n1-typing span{width:6px;height:6px;background:#1a7a3c;border-radius:50%;animation:n1-dot 1.4s infinite;opacity:.4}
    .n1-typing span:nth-child(2){animation-delay:.2s}
    .n1-typing span:nth-child(3){animation-delay:.4s}
    @keyframes n1-dot{0%,60%,100%{opacity:.3;transform:scale(.85)}30%{opacity:1;transform:scale(1)}}
    .n1-quick-replies{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;padding-left:2px}
    .n1-quick-btn{background:rgba(255,255,255,.92);border:1.5px solid rgba(26,122,60,.35);color:#1a7a3c;padding:6px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .15s;border-radius:20px;line-height:1.3}
    .n1-quick-btn:hover{background:#1a7a3c;color:#fff;border-color:#1a7a3c}
    #n1-chat-input-area{border-top:1px solid rgba(26,122,60,.08);padding:10px 12px;display:flex;gap:8px;align-items:flex-end;background:rgba(247,252,249,.92);flex-shrink:0}
    #n1-chat-input{flex:1;background:rgba(255,255,255,.95);border:1.5px solid rgba(13,43,30,.12);color:#0d2b1e;padding:9px 13px;font-family:'Cabinet Grotesk',sans-serif;font-size:13.5px;font-weight:400;outline:none;resize:none;min-height:38px;max-height:100px;border-radius:20px;transition:border-color .15s}
    #n1-chat-input::placeholder{color:rgba(13,43,30,.35)}
    #n1-chat-input:focus{border-color:#1a7a3c}
    #n1-chat-send{background:#1a7a3c;color:#fff;border:none;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,transform .1s;margin-bottom:1px}
    #n1-chat-send:hover{background:#166534;transform:scale(1.05)}
    #n1-chat-send:disabled{opacity:.35;cursor:not-allowed;transform:none}
    #n1-chat-footer{padding:5px 14px 10px;font-family:'Cabinet Grotesk',sans-serif;font-size:10px;color:rgba(13,43,30,.3);text-align:center;letter-spacing:.05em;text-transform:uppercase;background:rgba(247,252,249,.92);flex-shrink:0}
    .n1-form{display:flex;flex-direction:column;gap:8px;margin-top:8px}
    .n1-form input{background:#fff;border:1.5px solid rgba(13,43,30,.15);color:#0d2b1e;padding:9px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:13px;outline:none;border-radius:12px;transition:border-color .15s;width:100%}
    .n1-form input::placeholder{color:rgba(13,43,30,.35)}
    .n1-form input:focus{border-color:#1a7a3c}
    .n1-form button{background:#1a7a3c;color:#fff;border:none;padding:10px 14px;font-family:'Cabinet Grotesk',sans-serif;font-weight:700;font-size:13px;cursor:pointer;border-radius:20px;transition:background .15s}
    .n1-form button:hover{background:#166534}
    .n1-form button.skip{background:transparent;border:1.5px solid rgba(13,43,30,.15);color:rgba(13,43,30,.45);font-weight:500}
    .n1-form button.skip:hover{background:rgba(13,43,30,.04);color:rgba(13,43,30,.65)}
    @media(max-width:600px){
      #n1-chat-btn{right:16px;bottom:16px}
      #n1-chat-panel{position:fixed;width:calc(100vw - 32px);max-width:420px;height:auto;min-height:60vh;max-height:calc(100dvh - 100px);top:50%;left:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);border-radius:20px}
    }
  `;
  const HTML = `
    <button id="n1-chat-btn" aria-label="Abrir chat 1Negócio" title="Fale com a 1Negócio">
      <span class="n1-open-icon"><svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="8" width="14" height="10" rx="3" fill="white"/><rect x="9" y="5" width="2" height="3" rx="1" fill="white"/><rect x="13" y="5" width="2" height="3" rx="1" fill="white"/><circle cx="9" cy="13" r="1.5" fill="#1a7a3c"/><circle cx="15" cy="13" r="1.5" fill="#1a7a3c"/><rect x="10" y="15.5" width="4" height="1" rx="0.5" fill="#1a7a3c"/><rect x="2" y="11" width="2" height="4" rx="1" fill="white"/><rect x="20" y="11" width="2" height="4" rx="1" fill="white"/></svg></span>
      <span class="n1-close-icon">&#215;</span>
      <span class="n1-pulse"></span>
    </button>
    <div id="n1-chat-panel" role="dialog" aria-label="Chat 1Negócio">
      <div id="n1-chat-header">
        <div class="n1-header-left">
          <div class="n1-logo-badge"><div class="n1-logo-txt"><em>1</em><span>N</span></div></div>
          <div class="n1-header-info">
            <div class="n1-header-name"><em>1</em>Negócio</div>
            <div class="n1-header-status">Online agora</div>
          </div>
        </div>
        <button id="n1-chat-close" aria-label="Fechar chat">&#215;</button>
      </div>
      <div id="n1-chat-messages" role="log" aria-live="polite"></div>
      <div id="n1-chat-input-area">
        <textarea id="n1-chat-input" placeholder="Digite sua mensagem..." rows="1" aria-label="Mensagem"></textarea>
        <button id="n1-chat-send" aria-label="Enviar"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M22 2L11 13" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      <div id="n1-chat-footer">1Negócio &middot; Diagnóstico + avaliação de empresas</div>
    </div>
  `;
  function init() {
    if (document.getElementById('n1-chat-wrap')) return;
    const wrap = document.createElement('div');
    wrap.id = 'n1-chat-wrap';
    wrap.innerHTML = HTML;
    document.body.appendChild(wrap);
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);
    const scriptTag = document.currentScript || document.querySelector('script[src*="chat-ia.js"]');
    const modo = (scriptTag ? scriptTag.getAttribute('data-mode') : null) || document.body.getAttribute('data-chat-mode');
    if (modo === 'discreto') document.getElementById('n1-chat-btn').classList.add('discreto');
    attachListeners();
  }
  function attachListeners() {
    document.getElementById('n1-chat-btn').addEventListener('click', togglePanel);
    document.getElementById('n1-chat-close').addEventListener('click', closePanel);
    document.getElementById('n1-chat-send').addEventListener('click', handleSend);
    const input = document.getElementById('n1-chat-input');
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
    input.addEventListener('input', autoResize);
  }
  function autoResize() {
    const input = document.getElementById('n1-chat-input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }
  function togglePanel() { state.isOpen ? closePanel() : openPanel(); }
  function openPanel() {
    state.isOpen = true;
    const btn = document.getElementById('n1-chat-btn');
    const panel = document.getElementById('n1-chat-panel');
    panel.classList.add('open');
    btn.classList.add('open');
    const pulse = btn.querySelector('.n1-pulse');
    if (pulse) pulse.style.display = 'none';
    if (state.messages.length === 0) { startConversation(); } else { document.getElementById('n1-chat-input').focus(); }
  }
  function closePanel() {
    state.isOpen = false;
    document.getElementById('n1-chat-btn').classList.remove('open');
    document.getElementById('n1-chat-panel').classList.remove('open');
    const pulse = document.getElementById('n1-chat-btn').querySelector('.n1-pulse');
    if (pulse) pulse.style.display = 'block';
  }
  function startConversation() {
    state.phoneTriggerCount = LEAD_ASK_AFTER_MIN + Math.floor(Math.random() * (LEAD_ASK_AFTER_MAX - LEAD_ASK_AFTER_MIN + 1));
    state.qualificationDone = true;
    const hora = new Date().getHours();
    const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    state.messages.push({ role: 'user', content: 'Inicie a conversa com uma saudacao de ' + saudacao + ' e pergunte apenas "posso ajudar?". Sem listas, sem opcoes, apenas isso.' });
    showTyping();
    setTimeout(sendToBackend, randomDelay());
  }
  function handleSend() {
    const input = document.getElementById('n1-chat-input');
    const text = input.value.trim();
    if (!text || state.isTyping) return;
    input.value = '';
    input.style.height = 'auto';
    renderUserMessage(text);
    state.messages.push({ role: 'user', content: text });
    if (!state.qualificationDone) state.qualificationDone = true;
    if (state.nameAsked && !state.nameCollected) { state.nameCollected = true; state.lead.nome = text; savePreLead(text); }
    showTyping();
    setTimeout(sendToBackend, randomDelay());
  }
  async function savePreLead(nome) {
    try {
      await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY }, body: JSON.stringify({ action: 'save_lead', messages: state.messages, pagina_origem: window.location.href, lead_data: { nome, perfil: state.perfil || 'curioso' } }) });
    } catch(e) { console.error('Erro pré-lead:', e); }
  }
  async function sendToBackend() {
    try {
      const res = await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY }, body: JSON.stringify({ messages: state.messages }) });
      const data = await res.json();
      hideTyping();
      if (!res.ok || data.error) { renderBotMessage('Tive um probleminha pra responder agora. Tenta de novo em instantes.', [{ label: 'Abrir WhatsApp', action: openWhatsApp }]); return; }
      const reply = data.reply || 'Hmm, não consegui gerar uma resposta. Tenta reformular?';
      state.messages.push({ role: 'assistant', content: reply });
      state.assistantMsgCount++;
      if (state.assistantMsgCount === 1 && state.messages[0] && state.messages[0].content.startsWith('Inicie a conversa')) state.messages.shift();
      renderBotMessage(reply);
      if (state.nameCollected && !state.phoneCaptureAsked && !state.leadCaptured && state.assistantMsgCount >= state.phoneTriggerCount) { state.phoneCaptureAsked = true; setTimeout(askForPhone, 1200); }
    } catch (err) {
      hideTyping();
      renderBotMessage('Perdi a conexão. Se quiser, fala direto com nosso time.', [{ label: 'Abrir WhatsApp', action: openWhatsApp }]);
    }
  }
  function askForPhone() {
    const pn = state.lead.nome ? state.lead.nome.split(' ')[0] : '';
    const cumpr = pn ? ', ' + pn : '';
    const wrap = document.createElement('div');
    wrap.className = 'n1-msg bot';
    wrap.innerHTML = '<div>Aproveito para perguntar' + cumpr + ' — qual é o seu WhatsApp? Assim consigo te conectar com um especialista quando fizer sentido.</div><form class="n1-form" id="n1-phone-form" style="margin-top:10px"><input type="tel" name="whatsapp" placeholder="WhatsApp com DDD (ex: 48 99999-9999)" required><button type="submit">Enviar</button><button type="button" class="skip" id="n1-skip-phone">Agora não</button></form>';
    document.getElementById('n1-chat-messages').appendChild(wrap);
    scrollToBottom();
    wrap.querySelector('#n1-phone-form').addEventListener('submit', function(e) { e.preventDefault(); const wpp = e.target.whatsapp.value.trim(); if (!wpp) return; state.lead.whatsapp = wpp; wrap.remove(); renderUserMessage(wpp); saveLead(); });
    wrap.querySelector('#n1-skip-phone').addEventListener('click', function() { wrap.remove(); renderBotMessage('Tudo bem! Fico por aqui se precisar de mais alguma coisa.'); });
  }
  async function saveLead() {
    try {
      const res = await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY }, body: JSON.stringify({ action: 'save_lead', messages: state.messages, pagina_origem: window.location.href, lead_data: { nome: state.lead.nome, whatsapp: state.lead.whatsapp, perfil: state.perfil || 'curioso', sub_perfil: state.subPerfil } }) });
      const data = await res.json();
      if (data.success && data.lead_id) { state.leadCaptured = true; state.leadId = data.lead_id; }
      const pn = state.lead.nome ? state.lead.nome.split(' ')[0] : '';
      renderBotMessage(pn ? 'Anotado, ' + pn + '! Pode continuar à vontade.' : 'Anotado! Pode continuar.');
    } catch (err) { renderBotMessage('Anotado! Pode continuar.'); }
  }
  function renderBotMessage(text, quickReplies) {
    const container = document.getElementById('n1-chat-messages');
    const div = document.createElement('div');
    div.className = 'n1-msg bot';
    div.innerHTML = formatText(text);
    container.appendChild(div);
    if (quickReplies && quickReplies.length) {
      const replies = document.createElement('div');
      replies.className = 'n1-quick-replies';
      quickReplies.forEach(function(r) { const btn = document.createElement('button'); btn.className = 'n1-quick-btn'; btn.textContent = r.label; btn.addEventListener('click', function() { replies.remove(); r.action(); }); replies.appendChild(btn); });
      container.appendChild(replies);
    }
    scrollToBottom();
  }
  function renderUserMessage(text) { const div = document.createElement('div'); div.className = 'n1-msg user'; div.textContent = text; document.getElementById('n1-chat-messages').appendChild(div); scrollToBottom(); }
  function showTyping() { state.isTyping = true; document.getElementById('n1-chat-send').disabled = true; const div = document.createElement('div'); div.className = 'n1-typing'; div.id = 'n1-typing-indicator'; div.innerHTML = '<span></span><span></span><span></span>'; document.getElementById('n1-chat-messages').appendChild(div); scrollToBottom(); }
  function hideTyping() { state.isTyping = false; document.getElementById('n1-chat-send').disabled = false; const el = document.getElementById('n1-typing-indicator'); if (el) el.remove(); }
  function scrollToBottom() { const c = document.getElementById('n1-chat-messages'); c.scrollTop = c.scrollHeight; }
  function formatText(text) { return text.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/[*][*]([^*]+)[*][*]/g,"<strong>$1</strong>").replace(/\n/g,"<br>"); }
  function randomDelay() { return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS); }
  function openWhatsApp() {
    const resumo = state.messages.slice(-3).map(function(m) { return (m.role === 'user' ? 'Eu' : 'Bot') + ': ' + m.content.slice(0, 100); }).join('\n');
    const msg = encodeURIComponent('Olá, vim do chat da 1Negócio.\nPerfil: ' + (state.perfil || '—') + '\n\n' + resumo);
    window.open('https://wa.me/' + WHATSAPP_FALLBACK + '?text=' + msg, '_blank');
    if (state.leadId) { fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY }, body: JSON.stringify({ action: 'escalate', messages: state.messages, lead_data: { lead_id: state.leadId, motivo: 'usuario_pediu_whatsapp' } }) }).catch(function(){}); }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
  window.n1Chat = { state, open: openPanel, close: closePanel };
})();
