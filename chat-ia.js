/** * Chat IA 1NEGÓCIO - Widget * Versao 2.7 - 2026-04-20 * Design: frosted glass, logo 1N identica a home * v2.7: tema verde #10b981 (igual home/brandbook) + '1NEGÓCIO' maiusculo */
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

  // Restaurar mensagens da sessão anterior (navegação entre páginas)
  const _savedState = sessionStorage.getItem('n1ChatState');
  if (_savedState) {
    try {
      const parsed = JSON.parse(_savedState);
      if (parsed.messages) state.messages = parsed.messages;
      if (parsed.leadCaptured) state.leadCaptured = parsed.leadCaptured;
      if (parsed.leadId) state.leadId = parsed.leadId;
      if (parsed.lead) state.lead = parsed.lead;
      if (parsed.nameCollected) state.nameCollected = parsed.nameCollected;
      if (parsed.nameAsked) state.nameAsked = parsed.nameAsked;
      if (parsed.phoneCaptureAsked) state.phoneCaptureAsked = parsed.phoneCaptureAsked;
      if (parsed.assistantMsgCount) state.assistantMsgCount = parsed.assistantMsgCount;
    } catch(e) {}
  }

  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Cabinet+Grotesk:wght@400;500;700;800&display=swap');
    #n1-chat-wrap,#n1-chat-wrap *{box-sizing:border-box}
    #n1-chat-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;background:transparent;border:2px solid #10b981;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:all .2s ease;box-shadow:0 0 12px #10b981,0 0 24px rgba(167,139,250,.35),inset 0 0 10px rgba(167,139,250,.06);overflow:hidden}
    #n1-chat-btn:hover{transform:scale(1.06);background:rgba(167,139,250,.12);box-shadow:0 0 20px #10b981,0 0 40px rgba(167,139,250,.5),inset 0 0 16px rgba(167,139,250,.1);border-color:#34d399}
    #n1-chat-btn.open{background:rgba(167,139,250,.15);border-color:#34d399;box-shadow:0 0 16px #10b981,0 0 32px rgba(167,139,250,.4)}
    #n1-chat-btn .n1-open-icon svg{width:24px;height:24px;filter:drop-shadow(0 0 6px #10b981)}
    #n1-chat-btn .n1-close-icon{display:none;color:#10b981;font-size:22px;font-family:'Cabinet Grotesk',sans-serif;font-weight:700;line-height:1;text-shadow:0 0 8px #10b981}
    #n1-chat-btn.open .n1-open-icon{display:none}
    #n1-chat-btn.open .n1-close-icon{display:flex}
    #n1-chat-btn .n1-pulse{position:absolute;top:-1px;right:-1px;width:13px;height:13px;background:#f59e0b;border:2px solid rgba(0,0,0,.6);border-radius:50%;animation:n1-pulse 2s infinite}
    @keyframes n1-pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.2);opacity:.7}}
    #n1-chat-btn.discreto{width:44px;height:44px;bottom:16px;right:16px;opacity:.75}
    #n1-chat-btn.discreto:hover{opacity:1}
    #n1-chat-btn.discreto .n1-pulse{display:none}
    #n1-chat-panel{position:fixed;bottom:96px;right:24px;width:370px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 120px);background:rgba(255,255,255,.82);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5);border:1.5px solid rgba(167,139,250,.2);border-radius:24px;display:none;flex-direction:column;font-family:'Cabinet Grotesk',sans-serif;color:#0d2b1e;z-index:2147483645;box-shadow:0 8px 40px rgba(167,139,250,.12),0 2px 8px rgba(167,139,250,.08);overflow:hidden;animation:n1-slideUp .22s ease}
    @keyframes n1-slideUp{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
    #n1-chat-panel.open{display:flex}
    #n1-chat-header{padding:13px 16px 11px;border-bottom:1px solid rgba(167,139,250,.15);display:flex;align-items:center;justify-content:space-between;background:rgba(247,247,255,.92);border-radius:24px 24px 0 0;flex-shrink:0}
    .n1-header-left{display:flex;align-items:center;gap:10px}
    .n1-logo-badge{display:flex;align-items:center;justify-content:center;width:38px;height:38px;background:#0c0c0a;border-radius:9px;flex-shrink:0}
    .n1-logo-txt{font-family:'Syne',sans-serif;font-weight:800;font-size:15px;letter-spacing:-.04em;line-height:1;white-space:nowrap;display:inline-flex;align-items:baseline}
    .n1-logo-txt em{color:#0c0c0a;background:#10b981;font-style:normal;padding:0 .18em .04em;border-radius:.15em;margin-right:.06em;display:inline-block;line-height:1}
    .n1-logo-txt span{color:#fff}
    .n1-header-info{display:flex;flex-direction:column;gap:1px}
    .n1-header-name{font-family:'Syne',sans-serif;font-weight:800;font-size:15px;color:#0d2b1e;letter-spacing:-.02em;line-height:1.2;display:inline-flex;align-items:baseline}
    .n1-header-name em{color:#0d2b1e;background:#10b981;font-style:normal;padding:0 .18em .04em;border-radius:.12em;margin-right:.08em;display:inline-block;line-height:1}
    .n1-header-status{font-family:'Cabinet Grotesk',sans-serif;font-size:11px;color:#10b981;font-weight:500;display:flex;align-items:center;gap:5px}
    .n1-header-status::before{content:'';width:6px;height:6px;background:#10b981;border-radius:50%;animation:n1-blink 2.5s infinite}
    @keyframes n1-blink{0%,100%{opacity:1}50%{opacity:.35}}
    #n1-chat-close{background:rgba(167,139,250,.1);border:none;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#10b981;font-size:16px;font-family:'Cabinet Grotesk',sans-serif;transition:background .15s;flex-shrink:0}
    #n1-chat-close:hover{background:rgba(167,139,250,.2)}
    #n1-chat-messages{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;scrollbar-color:rgba(167,139,250,.2) transparent}
    #n1-chat-messages::-webkit-scrollbar{width:4px}
    #n1-chat-messages::-webkit-scrollbar-thumb{background:rgba(167,139,250,.2);border-radius:2px}
    .n1-msg{max-width:84%;padding:9px 13px;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word;font-family:'Cabinet Grotesk',sans-serif;font-weight:400}
    .n1-msg.user{align-self:flex-end;background:#10b981;color:#fff;font-weight:500;border-radius:16px 16px 4px 16px}
    .n1-msg.bot{align-self:flex-start;background:rgba(255,255,255,.88);color:#0d2b1e;border-radius:4px 16px 16px 16px;border:1px solid rgba(167,139,250,.15);box-shadow:0 1px 4px rgba(167,139,250,.08)}
    .n1-msg.bot a{color:#10b981;text-decoration:underline}
    .n1-msg.bot strong{color:#0d2b1e;font-weight:700}
    .n1-typing{align-self:flex-start;padding:10px 14px;background:rgba(255,255,255,.88);border-radius:4px 16px 16px 16px;border:1px solid rgba(167,139,250,.15);display:flex;gap:4px;align-items:center}
    .n1-typing span{width:6px;height:6px;background:#10b981;border-radius:50%;animation:n1-dot 1.4s infinite;opacity:.4}
    .n1-typing span:nth-child(2){animation-delay:.2s}
    .n1-typing span:nth-child(3){animation-delay:.4s}
    @keyframes n1-dot{0%,60%,100%{opacity:.3;transform:scale(.85)}30%{opacity:1;transform:scale(1)}}
    .n1-quick-replies{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px;padding-left:2px}
    .n1-quick-btn{background:rgba(255,255,255,.92);border:1.5px solid rgba(167,139,250,.4);color:#10b981;padding:6px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;transition:all .15s;border-radius:20px;line-height:1.3}
    .n1-quick-btn:hover{background:#10b981;color:#fff;border-color:#10b981}
    #n1-chat-input-area{border-top:1px solid rgba(167,139,250,.1);padding:10px 12px;display:flex;gap:8px;align-items:flex-end;background:rgba(247,247,255,.92);flex-shrink:0}
    #n1-chat-input{flex:1;background:rgba(255,255,255,.95);border:1.5px solid rgba(167,139,250,.2);color:#0d2b1e;padding:9px 13px;font-family:'Cabinet Grotesk',sans-serif;font-size:13.5px;font-weight:400;outline:none;resize:none;min-height:38px;max-height:100px;border-radius:20px;transition:border-color .15s}
    #n1-chat-input::placeholder{color:rgba(13,43,30,.35)}
    #n1-chat-input:focus{border-color:#10b981;box-shadow:0 0 0 3px rgba(167,139,250,.12)}
    #n1-chat-send{background:#10b981;color:#fff;border:none;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,transform .1s;margin-bottom:1px}
    #n1-chat-send:hover{background:#9061f9;transform:scale(1.05)}
    #n1-chat-send:disabled{opacity:.35;cursor:not-allowed;transform:none}
    #n1-chat-footer{padding:5px 14px 10px;font-family:'Cabinet Grotesk',sans-serif;font-size:10px;color:rgba(13,43,30,.3);text-align:center;letter-spacing:.05em;text-transform:uppercase;background:rgba(247,247,255,.92);flex-shrink:0}
    .n1-form{display:flex;flex-direction:column;gap:8px;margin-top:8px}
    .n1-form input{background:#fff;border:1.5px solid rgba(167,139,250,.25);color:#0d2b1e;padding:9px 12px;font-family:'Cabinet Grotesk',sans-serif;font-size:13px;outline:none;border-radius:12px;transition:border-color .15s;width:100%}
    .n1-form input::placeholder{color:rgba(13,43,30,.35)}
    .n1-form input:focus{border-color:#10b981}
    .n1-form button{background:#10b981;color:#fff;border:none;padding:10px 14px;font-family:'Cabinet Grotesk',sans-serif;font-weight:700;font-size:13px;cursor:pointer;border-radius:20px;transition:background .15s}
    .n1-form button:hover{background:#9061f9}
    .n1-form button.skip{background:transparent;border:1.5px solid rgba(167,139,250,.3);color:rgba(13,43,30,.45);font-weight:500}
    .n1-form button.skip:hover{background:rgba(167,139,250,.06);color:rgba(13,43,30,.65)}
    #n1-welcome-bubble{position:fixed;bottom:92px;right:24px;background:#fff;border-radius:16px 16px 4px 16px;padding:10px 32px 10px 14px;font-family:'Cabinet Grotesk',sans-serif;font-size:13.5px;font-weight:500;color:#0d2b1e;box-shadow:0 4px 20px rgba(167,139,250,.2);border:1px solid rgba(167,139,250,.3);z-index:2147483644;max-width:230px;line-height:1.4;cursor:pointer;animation:n1-bubbleIn .35s ease;display:none}
    #n1-welcome-close{position:absolute;top:6px;right:8px;background:none;border:none;color:rgba(13,43,30,.35);font-size:14px;cursor:pointer;line-height:1;padding:0}
    @keyframes n1-bubbleIn{from{opacity:0;transform:translateY(8px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}
    @media(max-width:600px){
      #n1-chat-btn{right:16px;bottom:16px}
      #n1-chat-panel{position:fixed;width:calc(100vw - 32px);max-width:420px;height:auto;min-height:60vh;max-height:calc(100dvh - 100px);top:50%;left:50%;right:auto;bottom:auto;transform:translate(-50%,-50%);border-radius:20px}
    }
  `;

  const HTML = `
    <button id="n1-chat-btn" aria-label="Abrir chat 1NEGÓCIO" title="Fale com a 1NEGÓCIO">
      <span class="n1-open-icon"><svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></span>
      <span class="n1-close-icon">&#215;</span>
      <span class="n1-pulse"></span>
    </button>
    <div id="n1-chat-panel" role="dialog" aria-label="Chat 1NEGÓCIO">
      <div id="n1-chat-header">
        <div class="n1-header-left">
          <div class="n1-logo-badge"><div class="n1-logo-txt"><em>1</em><span>N</span></div></div>
          <div class="n1-header-info">
            <div class="n1-header-name"><em>1</em>NEGÓCIO</div>
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
      <div id="n1-chat-footer">1NEGÓCIO &middot; Diagnóstico + avaliação de empresas</div>
    </div>
    <div id="n1-welcome-bubble" style="display:none">
      <span id="n1-welcome-text">Hey, qualquer duvida estou por aqui!</span>
      <button id="n1-welcome-close">&#215;</button>
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
    setTimeout(showWelcomeBubble, 2000);
  }

  function showWelcomeBubble() {
    var bubble = document.getElementById('n1-welcome-bubble');
    if (!bubble) return;
    bubble.style.display = 'block';
    document.getElementById('n1-welcome-close').addEventListener('click', function(e) {
      e.stopPropagation();
      bubble.style.display = 'none';
    });
    bubble.addEventListener('click', function() {
      bubble.style.display = 'none';
      openPanel();
    });
  }

  function attachListeners() {
    document.getElementById('n1-chat-btn').addEventListener('click', togglePanel);
    document.getElementById('n1-chat-close').addEventListener('click', closePanel);
    document.getElementById('n1-chat-send').addEventListener('click', handleSend);
    const input = document.getElementById('n1-chat-input');
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
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
    var bubble = document.getElementById('n1-welcome-bubble');
    if (bubble) bubble.style.display = 'none';
    if (state.messages.length === 0) {
      startConversation();
    } else {
      // Re-renderizar mensagens salvas ao abrir em nova pagina
      const _container = document.getElementById('n1-chat-messages');
      if (_container.children.length === 0) {
        state.messages.forEach(function(msg) {
          if (msg.role === 'user') renderUserMessage(msg.content);
          else if (msg.role === 'assistant') renderBotMessage(msg.content);
        });
      }
      document.getElementById('n1-chat-input').focus();
    }
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
    } catch(e) { console.error('Erro pre-lead:', e); }
  }

  async function sendToBackend() {
    try {
      const res = await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY }, body: JSON.stringify({ 
          pagina_atual: window.location.href,
          tela_diagnostico: (typeof telaAtual !== 'undefined' ? telaAtual : null),
          messages: state.messages }) });
      const data = await res.json();
      hideTyping();
      if (!res.ok || data.error) { renderBotMessage('Tive um probleminha pra responder agora. Tenta de novo em instantes.', [{ label: 'Abrir WhatsApp', action: openWhatsApp }]); return; }
      const reply = data.reply || 'Hmm, nao consegui gerar uma resposta. Tenta reformular?';
      state.messages.push({ role: 'assistant', content: reply });
      state.assistantMsgCount++;
      if (state.assistantMsgCount === 1 && state.messages[0] && state.messages[0].content.startsWith('Inicie a conversa')) state.messages.shift();
      renderBotMessage(reply);
      if (state.nameCollected && !state.phoneCaptureAsked && !state.leadCaptured && state.assistantMsgCount >= state.phoneTriggerCount) {
        state.phoneCaptureAsked = true;
        setTimeout(askForPhone, 1200);
      }
    } catch (err) {
      hideTyping();
      renderBotMessage('Perdi a conexao. Se quiser, fala direto com nosso time.', [{ label: 'Abrir WhatsApp', action: openWhatsApp }]);
    }
  }

  function askForPhone() {
    const pn = state.lead.nome ? state.lead.nome.split(' ')[0] : '';
    const cumpr = pn ? ', ' + pn : '';
    const wrap = document.createElement('div');
    wrap.className = 'n1-msg bot';
    wrap.innerHTML = '<div>Aproveito para perguntar' + cumpr + ' qual e o seu WhatsApp? Assim consigo te conectar com um especialista quando fizer sentido.</div><form class="n1-form" id="n1-phone-form" style="margin-top:10px"><input type="tel" name="whatsapp" placeholder="WhatsApp com DDD (ex: 48 99999-9999)" required><button type="submit">Enviar</button><button type="button" class="skip" id="n1-skip-phone">Agora nao</button></form>';
    document.getElementById('n1-chat-messages').appendChild(wrap);
    scrollToBottom();
    wrap.querySelector('#n1-phone-form').addEventListener('submit', function(e) {
      e.preventDefault();
      const wpp = e.target.whatsapp.value.trim();
      if (!wpp) return;
      state.lead.whatsapp = wpp;
      wrap.remove();
      renderUserMessage(wpp);
      saveLead();
    });
    wrap.querySelector('#n1-skip-phone').addEventListener('click', function() {
      wrap.remove();
      renderBotMessage('Tudo bem! Fico por aqui se precisar de mais alguma coisa.');
    });
  }

  async function saveLead() {
    try {
      const res = await fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY }, body: JSON.stringify({ action: 'save_lead', messages: state.messages, pagina_origem: window.location.href, lead_data: { nome: state.lead.nome, whatsapp: state.lead.whatsapp, perfil: state.perfil || 'curioso', sub_perfil: state.subPerfil } }) });
      const data = await res.json();
      if (data.success && data.lead_id) { state.leadCaptured = true; state.leadId = data.lead_id; }
      const pn = state.lead.nome ? state.lead.nome.split(' ')[0] : '';
      renderBotMessage(pn ? 'Anotado, ' + pn + '! Pode continuar a vontade.' : 'Anotado! Pode continuar.');
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
      quickReplies.forEach(function(r) {
        const btn = document.createElement('button');
        btn.className = 'n1-quick-btn';
        btn.textContent = r.label;
        btn.addEventListener('click', function() { replies.remove(); r.action(); });
        replies.appendChild(btn);
      });
      container.appendChild(replies);
    }
    scrollToBottom();
  sessionStorage.setItem('n1ChatState', JSON.stringify({messages: state.messages, leadCaptured: state.leadCaptured, leadId: state.leadId, lead: state.lead, nameCollected: state.nameCollected, nameAsked: state.nameAsked, phoneCaptureAsked: state.phoneCaptureAsked, assistantMsgCount: state.assistantMsgCount}));
  }

  function renderUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'n1-msg user';
    div.textContent = text;
    document.getElementById('n1-chat-messages').appendChild(div);
    scrollToBottom();
  sessionStorage.setItem('n1ChatState', JSON.stringify({messages: state.messages, leadCaptured: state.leadCaptured, leadId: state.leadId, lead: state.lead, nameCollected: state.nameCollected, nameAsked: state.nameAsked, phoneCaptureAsked: state.phoneCaptureAsked, assistantMsgCount: state.assistantMsgCount}));
  }

  function showTyping() {
    state.isTyping = true;
    document.getElementById('n1-chat-send').disabled = true;
    const div = document.createElement('div');
    div.className = 'n1-typing';
    div.id = 'n1-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    document.getElementById('n1-chat-messages').appendChild(div);
    scrollToBottom();
  }

  function hideTyping() {
    state.isTyping = false;
    document.getElementById('n1-chat-send').disabled = false;
    const el = document.getElementById('n1-typing-indicator');
    if (el) el.remove();
  }

  function scrollToBottom() {
    const c = document.getElementById('n1-chat-messages');
    c.scrollTop = c.scrollHeight;
  }

  function formatText(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/[*][*]([^*]+)[*][*]/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  function randomDelay() { return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS); }

  function openWhatsApp() {
    const resumo = state.messages.slice(-3).map(function(m) { return (m.role === 'user' ? 'Eu' : 'Bot') + ': ' + m.content.slice(0, 100); }).join('\n');
    const msg = encodeURIComponent('Olá, vim do chat da 1NEGÓCIO.\nPerfil: ' + (state.perfil || 'não identificado') + '\n\n' + resumo);
    window.open('https://wa.me/' + WHATSAPP_FALLBACK + '?text=' + msg, '_blank');
    if (state.leadId) {
      fetch(API_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY }, body: JSON.stringify({ action: 'escalate', messages: state.messages, lead_data: { lead_id: state.leadId, motivo: 'usuario_pediu_whatsapp' } }) }).catch(function(){});
    }
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
  window.n1Chat = { state, open: openPanel, close: closePanel };
})();
