/**
 * Chat IA 1Negócio — Widget
 * Versão 1.0 — 2026-04-17
 * 
 * Uso: incluir em qualquer página com:
 *   <script src="/chat-ia.js" defer></script>
 * 
 * O widget se auto-injeta no DOM: botão flutuante + modal + estilos.
 */

(function() {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  const API_ENDPOINT = 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/chat-ia';
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
  const WHATSAPP_FALLBACK = '5511952136406';
  
  // Delay antes de exibir resposta (simula digitação)
  const MIN_DELAY_MS = 800;
  const MAX_DELAY_MS = 1600;

  // ============================================================
  // ESTADO
  // ============================================================
  const state = {
    isOpen: false,
    isTyping: false,
    messages: [],           // [{role: 'user'|'assistant', content: string}]
    perfil: null,           // 'comprador' | 'vendedor' | 'corretor' | 'curioso'
    subPerfil: null,
    leadCaptured: false,
    leadId: null,
    lead: { nome: null, whatsapp: null },
    qualificationDone: false,
    captureAsked: false,
  };

  // ============================================================
  // CSS (injetado no <head>)
  // ============================================================
  const STYLES = `
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Mono:wght@400;500&display=swap');
    
    #n1-chat-wrap, #n1-chat-wrap * { box-sizing: border-box; }
    
    #n1-chat-btn {
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 56px;
      height: 56px;
      background: #10b981;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-style: italic;
      font-size: 22px;
      color: #ffffff;
      z-index: 2147483646;
      transition: transform 0.15s ease, background 0.15s ease;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
    }
    #n1-chat-btn:hover { transform: scale(1.05); background: #0ea472; }
    #n1-chat-btn.open { background: #0c0c0a; color: #10b981; }
    
    /* Modo discreto (usado em páginas de formulário tipo diagnóstico) */
    #n1-chat-btn.discreto {
      width: 44px;
      height: 44px;
      font-size: 16px;
      bottom: 16px;
      right: 16px;
      opacity: 0.75;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
    }
    #n1-chat-btn.discreto:hover { opacity: 1; transform: scale(1.08); }
    #n1-chat-btn.discreto .n1-pulse { display: none; }
    #n1-chat-btn .n1-pulse {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 14px;
      height: 14px;
      background: #f59e0b;
      border: 2px solid #ffffff;
      border-radius: 50%;
      animation: n1-pulse 2s infinite;
    }
    @keyframes n1-pulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.2); opacity: 0.7; }
    }
    
    #n1-chat-panel {
      position: fixed;
      bottom: 92px;
      right: 24px;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 580px;
      max-height: calc(100vh - 120px);
      background: #0c0c0a;
      border: 1px solid #1a1a17;
      display: none;
      flex-direction: column;
      font-family: 'DM Mono', monospace;
      color: #e7e7e1;
      z-index: 2147483645;
      box-shadow: 0 20px 50px rgba(0,0,0,0.4);
    }
    #n1-chat-panel.open { display: flex; }
    
    #n1-chat-header {
      padding: 16px 18px;
      border-bottom: 1px solid #1a1a17;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    #n1-chat-header .n1-logo {
      font-family: 'Syne', sans-serif;
      font-weight: 800;
      font-size: 18px;
      letter-spacing: -0.01em;
    }
    #n1-chat-header .n1-logo em {
      color: #10b981;
      font-style: italic;
      font-weight: 800;
      margin-right: 2px;
    }
    #n1-chat-header .n1-status {
      font-family: 'DM Mono', monospace;
      font-size: 10px;
      color: #6b6b66;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #n1-chat-header .n1-status::before {
      content: '';
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      animation: n1-blink 2.5s infinite;
    }
    @keyframes n1-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    
    #n1-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scrollbar-width: thin;
      scrollbar-color: #1a1a17 transparent;
    }
    #n1-chat-messages::-webkit-scrollbar { width: 6px; }
    #n1-chat-messages::-webkit-scrollbar-track { background: transparent; }
    #n1-chat-messages::-webkit-scrollbar-thumb { background: #1a1a17; }
    
    .n1-msg {
      max-width: 85%;
      padding: 10px 14px;
      font-size: 13px;
      line-height: 1.55;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .n1-msg.user {
      align-self: flex-end;
      background: #10b981;
      color: #0c0c0a;
      font-weight: 500;
    }
    .n1-msg.bot {
      align-self: flex-start;
      background: #161614;
      color: #e7e7e1;
      border-left: 2px solid #10b981;
    }
    .n1-msg.bot a {
      color: #10b981;
      text-decoration: underline;
    }
    .n1-msg.bot strong {
      color: #ffffff;
      font-weight: 500;
    }
    
    .n1-typing {
      align-self: flex-start;
      padding: 10px 14px;
      background: #161614;
      border-left: 2px solid #10b981;
      display: flex;
      gap: 4px;
    }
    .n1-typing span {
      width: 6px;
      height: 6px;
      background: #10b981;
      border-radius: 50%;
      animation: n1-dot 1.4s infinite;
    }
    .n1-typing span:nth-child(2) { animation-delay: 0.2s; }
    .n1-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes n1-dot {
      0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
      30% { opacity: 1; transform: scale(1); }
    }
    
    .n1-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }
    .n1-quick-btn {
      background: transparent;
      border: 1px solid #10b981;
      color: #10b981;
      padding: 7px 11px;
      font-family: 'DM Mono', monospace;
      font-size: 11px;
      cursor: pointer;
      transition: background 0.15s;
      text-align: left;
    }
    .n1-quick-btn:hover {
      background: #10b981;
      color: #0c0c0a;
    }
    
    #n1-chat-input-area {
      border-top: 1px solid #1a1a17;
      padding: 12px;
      display: flex;
      gap: 8px;
    }
    #n1-chat-input {
      flex: 1;
      background: #161614;
      border: 1px solid #1a1a17;
      color: #e7e7e1;
      padding: 10px 12px;
      font-family: 'DM Mono', monospace;
      font-size: 13px;
      outline: none;
      resize: none;
      min-height: 38px;
      max-height: 100px;
    }
    #n1-chat-input:focus { border-color: #10b981; }
    #n1-chat-send {
      background: #10b981;
      color: #0c0c0a;
      border: none;
      padding: 0 16px;
      font-family: 'DM Mono', monospace;
      font-weight: 500;
      font-size: 12px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    #n1-chat-send:hover { background: #0ea472; }
    #n1-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
    
    #n1-chat-footer {
      padding: 8px 14px;
      font-family: 'DM Mono', monospace;
      font-size: 9px;
      color: #6b6b66;
      text-align: center;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      border-top: 1px solid #1a1a17;
    }
    
    .n1-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 6px;
    }
    .n1-form input {
      background: #0c0c0a;
      border: 1px solid #1a1a17;
      color: #e7e7e1;
      padding: 9px 11px;
      font-family: 'DM Mono', monospace;
      font-size: 12px;
      outline: none;
    }
    .n1-form input:focus { border-color: #10b981; }
    .n1-form button {
      background: #10b981;
      color: #0c0c0a;
      border: none;
      padding: 9px 11px;
      font-family: 'DM Mono', monospace;
      font-weight: 500;
      font-size: 11px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .n1-form button.skip {
      background: transparent;
      border: 1px solid #1a1a17;
      color: #6b6b66;
    }
    
    @media (max-width: 480px) {
      #n1-chat-panel {
        width: calc(100vw - 16px);
        height: calc(100vh - 100px);
        right: 8px;
        bottom: 80px;
      }
      #n1-chat-btn {
        right: 16px;
        bottom: 16px;
      }
    }
  `;

  // ============================================================
  // HTML DO WIDGET
  // ============================================================
  const HTML = `
    <button id="n1-chat-btn" aria-label="Abrir chat 1Negócio" title="Fale com a 1Negócio">
      <span>1N</span>
      <span class="n1-pulse"></span>
    </button>
    <div id="n1-chat-panel" role="dialog" aria-label="Chat 1Negócio">
      <div id="n1-chat-header">
        <div class="n1-logo"><em>1</em>NEGÓCIO</div>
        <div class="n1-status">Online</div>
      </div>
      <div id="n1-chat-messages" role="log" aria-live="polite"></div>
      <div id="n1-chat-input-area">
        <textarea id="n1-chat-input" placeholder="Digite sua mensagem..." rows="1" aria-label="Mensagem"></textarea>
        <button id="n1-chat-send" aria-label="Enviar">→</button>
      </div>
      <div id="n1-chat-footer">1Negócio · Diagnóstico + avaliação de empresas</div>
    </div>
  `;

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    // Evita dupla inicialização
    if (document.getElementById('n1-chat-wrap')) return;

    const wrap = document.createElement('div');
    wrap.id = 'n1-chat-wrap';
    wrap.innerHTML = HTML;
    document.body.appendChild(wrap);

    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    // Detecta modo discreto: <script src="/chat-ia.js" data-mode="discreto">
    // ou via <body data-chat-mode="discreto">
    const scriptTag = document.currentScript || document.querySelector('script[src*="chat-ia.js"]');
    const modoScript = scriptTag ? scriptTag.getAttribute('data-mode') : null;
    const modoBody = document.body.getAttribute('data-chat-mode');
    const modo = modoScript || modoBody;
    
    if (modo === 'discreto') {
      document.getElementById('n1-chat-btn').classList.add('discreto');
    }

    attachListeners();
  }

  function attachListeners() {
    const btn = document.getElementById('n1-chat-btn');
    const panel = document.getElementById('n1-chat-panel');
    const input = document.getElementById('n1-chat-input');
    const sendBtn = document.getElementById('n1-chat-send');

    btn.addEventListener('click', togglePanel);
    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    input.addEventListener('input', autoResize);
  }

  function autoResize() {
    const input = document.getElementById('n1-chat-input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 100) + 'px';
  }

  function togglePanel() {
    state.isOpen = !state.isOpen;
    const btn = document.getElementById('n1-chat-btn');
    const panel = document.getElementById('n1-chat-panel');
    const pulse = btn.querySelector('.n1-pulse');
    
    if (state.isOpen) {
      panel.classList.add('open');
      btn.classList.add('open');
      if (pulse) pulse.style.display = 'none';
      btn.querySelector('span').textContent = '×';
      
      // Primeira abertura: iniciar conversa
      if (state.messages.length === 0) {
        startConversation();
      } else {
        document.getElementById('n1-chat-input').focus();
      }
    } else {
      panel.classList.remove('open');
      btn.classList.remove('open');
      if (pulse) pulse.style.display = 'block';
      btn.querySelector('span').textContent = '1N';
    }
  }

  // ============================================================
  // CONVERSA
  // ============================================================
  function startConversation() {
    // Mensagem inicial com qualificação
    const welcomeMsg = "Olá, você está procurando por um negócio à venda ou gostaria de avaliar e/ou vender o seu?";
    renderBotMessage(welcomeMsg, [
      { label: "Procuro um negócio pra comprar", action: () => selectPerfil('comprador') },
      { label: "Quero avaliar / vender o meu", action: () => selectPerfil('vendedor') },
      { label: "Sou corretor ou assessor", action: () => selectPerfil('corretor') },
      { label: "Só quero entender como funciona", action: () => selectPerfil('curioso') },
    ]);
  }

  function selectPerfil(perfil) {
    state.perfil = perfil;
    state.qualificationDone = true;
    
    const labels = {
      comprador: "Procuro um negócio pra comprar",
      vendedor: "Quero avaliar / vender o meu",
      corretor: "Sou corretor ou assessor",
      curioso: "Só quero entender como funciona",
    };
    
    renderUserMessage(labels[perfil]);
    
    // Registra no histórico como se o usuário tivesse escrito
    state.messages.push({
      role: 'user',
      content: labels[perfil],
    });
    
    // Mostra digitando e envia pro backend
    showTyping();
    setTimeout(() => {
      sendToBackend();
    }, randomDelay());
  }

  function handleSend() {
    const input = document.getElementById('n1-chat-input');
    const text = input.value.trim();
    if (!text || state.isTyping) return;

    input.value = '';
    input.style.height = 'auto';

    renderUserMessage(text);
    state.messages.push({ role: 'user', content: text });

    // Se é a primeira mensagem digitada e ainda não qualificou, assume 'curioso'
    if (!state.qualificationDone) {
      state.perfil = 'curioso';
      state.qualificationDone = true;
    }

    showTyping();
    setTimeout(() => {
      sendToBackend();
    }, randomDelay());
  }

  async function sendToBackend() {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          messages: state.messages,
        }),
      });

      const data = await res.json();
      hideTyping();

      if (!res.ok || data.error) {
        renderBotMessage("Tive um probleminha pra responder agora. Tenta de novo em instantes ou fala direto com nosso time no WhatsApp.", [
          { label: "Abrir WhatsApp", action: openWhatsApp },
        ]);
        return;
      }

      const reply = data.reply || "Hmm, não consegui gerar uma resposta. Tenta reformular?";
      state.messages.push({ role: 'assistant', content: reply });

      // Detecta se deve pedir captura de lead (após qualificação, antes de capturar)
      const shouldAskCapture = state.qualificationDone 
        && !state.leadCaptured 
        && !state.captureAsked
        && state.messages.filter(m => m.role === 'assistant').length >= 1;

      renderBotMessage(reply);

      if (shouldAskCapture) {
        state.captureAsked = true;
        setTimeout(() => {
          askForContact();
        }, 900);
      }

    } catch (err) {
      hideTyping();
      console.error('Erro chat-ia:', err);
      renderBotMessage("Perdi a conexão aqui. Se quiser, fala direto com nosso time.", [
        { label: "Abrir WhatsApp", action: openWhatsApp },
      ]);
    }
  }

  // ============================================================
  // CAPTURA DE LEAD
  // ============================================================
  function askForContact() {
    const wrap = document.createElement('div');
    wrap.className = 'n1-msg bot';
    wrap.innerHTML = `
      <div>Antes de seguirmos, me deixa seu nome e WhatsApp? Assim nosso time também fica disponível caso você precise de suporte humano em algum momento.</div>
      <form class="n1-form" id="n1-contact-form">
        <input type="text" name="nome" placeholder="Seu nome" required>
        <input type="tel" name="whatsapp" placeholder="WhatsApp com DDD (ex: 48 99999-9999)" required>
        <button type="submit">Enviar contato</button>
        <button type="button" class="skip" id="n1-skip-contact">Continuar sem informar</button>
      </form>
    `;
    document.getElementById('n1-chat-messages').appendChild(wrap);
    scrollToBottom();

    const form = wrap.querySelector('#n1-contact-form');
    const skipBtn = wrap.querySelector('#n1-skip-contact');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const nome = form.nome.value.trim();
      const whatsapp = form.whatsapp.value.trim();
      
      if (!nome || !whatsapp) return;
      
      state.lead.nome = nome;
      state.lead.whatsapp = whatsapp;
      
      // Remove o form
      wrap.remove();
      renderUserMessage(`${nome} · ${whatsapp}`);
      
      saveLead();
    });

    skipBtn.addEventListener('click', () => {
      wrap.remove();
      renderBotMessage("Sem problema, seguimos. Se precisar do nosso time depois, é só pedir.");
    });
  }

  async function saveLead() {
    try {
      const res = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          action: 'save_lead',
          messages: state.messages,
          pagina_origem: window.location.href,
          lead_data: {
            nome: state.lead.nome,
            whatsapp: state.lead.whatsapp,
            perfil: state.perfil || 'curioso',
            sub_perfil: state.subPerfil,
          },
        }),
      });
      
      const data = await res.json();
      if (data.success && data.lead_id) {
        state.leadCaptured = true;
        state.leadId = data.lead_id;
      }
      
      renderBotMessage(`Perfeito, ${state.lead.nome}! Anotado aqui. Agora me conta mais — como posso te ajudar?`);
    } catch (err) {
      console.error('Erro salvando lead:', err);
      renderBotMessage("Anotei aqui. Como posso te ajudar?");
    }
  }

  // ============================================================
  // RENDERIZAÇÃO
  // ============================================================
  function renderBotMessage(text, quickReplies) {
    const container = document.getElementById('n1-chat-messages');
    const div = document.createElement('div');
    div.className = 'n1-msg bot';
    div.innerHTML = formatText(text);
    container.appendChild(div);

    if (quickReplies && quickReplies.length) {
      const replies = document.createElement('div');
      replies.className = 'n1-quick-replies';
      quickReplies.forEach(r => {
        const btn = document.createElement('button');
        btn.className = 'n1-quick-btn';
        btn.textContent = r.label;
        btn.addEventListener('click', () => {
          replies.remove();
          r.action();
        });
        replies.appendChild(btn);
      });
      container.appendChild(replies);
    }

    scrollToBottom();
  }

  function renderUserMessage(text) {
    const container = document.getElementById('n1-chat-messages');
    const div = document.createElement('div');
    div.className = 'n1-msg user';
    div.textContent = text;
    container.appendChild(div);
    scrollToBottom();
  }

  function showTyping() {
    state.isTyping = true;
    document.getElementById('n1-chat-send').disabled = true;
    const container = document.getElementById('n1-chat-messages');
    const div = document.createElement('div');
    div.className = 'n1-typing';
    div.id = 'n1-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(div);
    scrollToBottom();
  }

  function hideTyping() {
    state.isTyping = false;
    document.getElementById('n1-chat-send').disabled = false;
    const indicator = document.getElementById('n1-typing-indicator');
    if (indicator) indicator.remove();
  }

  function scrollToBottom() {
    const container = document.getElementById('n1-chat-messages');
    container.scrollTop = container.scrollHeight;
  }

  function formatText(text) {
    // Converte markdown simples: **bold**, [link](url), \n
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function randomDelay() {
    return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  }

  // ============================================================
  // ESCALAÇÃO WHATSAPP
  // ============================================================
  function openWhatsApp() {
    const resumo = state.messages.slice(-3)
      .map(m => `${m.role === 'user' ? 'Eu' : 'Assistente'}: ${m.content.slice(0, 100)}`)
      .join('\n');
    
    const perfilTexto = state.perfil ? `\nPerfil: ${state.perfil}` : '';
    const msg = encodeURIComponent(
      `Olá, vim da conversa com o assistente da 1Negócio.${perfilTexto}\n\nÚltimas mensagens:\n${resumo}`
    );
    window.open(`https://wa.me/${WHATSAPP_FALLBACK}?text=${msg}`, '_blank');
    
    // Registra escalação no backend
    if (state.leadId) {
      fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
        },
        body: JSON.stringify({
          action: 'escalate',
          messages: state.messages,
          lead_data: {
            lead_id: state.leadId,
            motivo: 'usuario_pediu_whatsapp',
          },
        }),
      }).catch(e => console.error('Erro escalando:', e));
    }
  }

  // ============================================================
  // BOOT
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expor para debug
  window.n1Chat = { state, open: () => { if (!state.isOpen) togglePanel(); } };
})();
