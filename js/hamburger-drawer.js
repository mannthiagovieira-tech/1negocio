// hamburger-drawer.js · V8 BLOCO 8.6 · 1Negócio
// Drawer hamburger unificado · markup + CSS + behavior idêntico à home
//
// Aplicação: páginas públicas SEM hamburger próprio (vender · comprar ·
// avaliar · negocio · socio-parceiro-cadastro). Index.html JÁ tem o
// drawer embutido · este módulo NÃO duplica (early-return se #drawer existe).
//
// Uso: <script src="/js/hamburger-account.js"></script>
//      <script src="/js/hamburger-drawer.js"></script>
//
// Botão trigger: injeta um <button.topbar-menu> flutuante top-right com
// z-index alto · funciona em qualquer página sem mexer no markup dela.
//
// Theme toggle: persiste em localStorage '1n-theme' · seta body.dataset.theme.
// Páginas com CSS para light/dark respeitam · páginas sem · ignoram visualmente.

(function () {
  if (window.HamburgerDrawer) return;
  if (document.getElementById('drawer')) return; // página já tem drawer (ex: index.html)

  const CSS = `
    .hd-trigger{
      position:fixed;top:14px;right:14px;z-index:115;
      width:38px;height:38px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
      border:1px solid var(--line, rgba(10,15,12,.1));border-radius:10px;
      background:var(--bg-2, #ffffff);cursor:pointer;
      box-shadow:0 4px 14px -6px rgba(10,20,12,.18);
      transition:transform .12s ease, box-shadow .15s ease;
    }
    .hd-trigger:hover{transform:translateY(-1px);box-shadow:0 8px 20px -8px rgba(10,20,12,.25)}
    .hd-trigger span{width:14px;height:1.5px;background:var(--ink-2, rgba(10,21,16,.78));border-radius:1px;transition:.2s}
    .hd-trigger.open span:nth-child(1){transform:rotate(45deg) translate(3px,3px)}
    .hd-trigger.open span:nth-child(2){opacity:0}
    .hd-trigger.open span:nth-child(3){transform:rotate(-45deg) translate(3px,-3px)}

    .drawer-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(4px);opacity:0;pointer-events:none;transition:opacity .25s;z-index:120}
    .drawer-overlay.open{opacity:1;pointer-events:auto}
    .drawer{
      position:fixed;top:0;right:0;bottom:0;z-index:121;
      width:min(320px,88vw);
      background:var(--bg-2, #ffffff);border-left:1px solid var(--line-2, rgba(10,15,12,.18));
      transform:translateX(100%);transition:transform .3s cubic-bezier(.2,.8,.2,1);
      display:flex;flex-direction:column;
      font-family:var(--sans, 'Geist','Inter',system-ui,sans-serif);
    }
    .drawer.open{transform:translateX(0)}
    .drawer-head{display:flex;align-items:center;justify-content:space-between;padding:18px 22px;border-bottom:1px solid var(--line, rgba(10,15,12,.1))}
    .drawer-head .logo{font-family:var(--serif, 'Syne', serif);font-weight:800;font-size:18px;letter-spacing:-.04em;color:var(--ink, #0a1510);text-decoration:none}
    .drawer-head .logo em{color:var(--accent, #0aa85a);font-style:normal}
    .drawer-head .sheet-close{background:transparent;border:none;font-size:18px;color:var(--ink-3, rgba(10,21,16,.58));cursor:pointer;padding:6px 10px}
    .drawer-body{flex:1;overflow-y:auto;padding:14px 0 8px}
    .drawer-link{
      display:flex;align-items:center;gap:14px;
      padding:8px 22px;text-decoration:none;color:var(--ink, #0a1510);
      transition:background .12s;
    }
    .drawer-link:hover{background:rgba(10,15,12,.04)}
    body[data-theme="dark"] .drawer-link:hover{background:rgba(255,255,255,.04)}
    .drawer-link-t{font-family:var(--sans, 'Geist', system-ui, sans-serif);font-weight:500;font-size:15px;letter-spacing:-.01em}
    .drawer-link-s{font-family:var(--mono, 'JetBrains Mono', monospace);font-size:10px;color:var(--ink-3, rgba(10,21,16,.58));margin-top:3px;letter-spacing:.03em}
    .drawer-link.enter{
      margin:2px 14px 14px;padding:14px 16px;border-radius:14px;
      background:var(--accent-soft, rgba(10,168,90,.12));
      border:1px solid var(--accent-line, rgba(10,168,90,.3));
    }
    .drawer-link.enter:hover{background:color-mix(in oklab, var(--accent, #0aa85a) 16%, transparent)}
    .drawer-link.enter .drawer-link-t{color:var(--accent, #0aa85a);font-family:var(--serif, 'Syne', serif);font-weight:700;letter-spacing:.04em;text-transform:uppercase;font-size:16px}
    .drawer-link.enter .drawer-link-s{color:color-mix(in oklab, var(--accent, #0aa85a) 70%, var(--ink-3, rgba(10,21,16,.58)));margin-top:4px}
    .drawer-link.enter .enter-icon{color:var(--accent, #0aa85a);margin-left:auto;flex-shrink:0}
    .drawer-link.enter.logged{padding:14px 14px;align-items:center;gap:12px}
    .drawer-avatar{width:40px;height:40px;border-radius:50%;background:var(--accent, #0aa85a);color:var(--accent-ink, #ffffff);display:flex;align-items:center;justify-content:center;font-family:var(--serif, 'Syne', serif);font-weight:700;font-size:17px;flex-shrink:0;letter-spacing:0;text-transform:uppercase}
    .drawer-link.enter.logged .drawer-link-t{font-family:var(--serif, 'Syne', serif);font-weight:700;font-size:16px;letter-spacing:0;text-transform:none;color:var(--accent, #0aa85a)}
    .drawer-link.enter.logged .drawer-link-s{font-family:var(--mono, 'JetBrains Mono', monospace);font-size:10.5px;color:color-mix(in oklab, var(--accent, #0aa85a) 70%, var(--ink-3, rgba(10,21,16,.58)))}
    .drawer-link.signout{
      display:flex;justify-content:center;padding:14px 0 6px;margin-top:10px;
      border-top:1px solid var(--line, rgba(10,15,12,.1));
      opacity:.55;transition:opacity .15s;
    }
    .drawer-link.signout:hover{opacity:1;background:transparent}
    .drawer-link.signout .drawer-link-t{
      font-family:var(--mono, 'JetBrains Mono', monospace);
      font-size:10px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;
      color:var(--ink-3, rgba(10,21,16,.58));
    }
    .drawer-link.signout .drawer-link-s{display:none}
    .drawer-section{display:flex;align-items:center;gap:10px;margin:18px 22px 6px}
    .drawer-section:first-of-type{margin-top:10px}
    .drawer-section-label{font-family:var(--mono, 'JetBrains Mono', monospace);font-size:9.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3, rgba(10,21,16,.58));flex-shrink:0}
    .drawer-section-line{flex:1;height:1px;background:var(--line, rgba(10,15,12,.1))}

    .drawer-theme{margin:18px 22px 8px;padding:6px 6px 6px 12px;border-radius:999px;background:transparent;border:1px solid var(--line, rgba(10,15,12,.1));display:flex;align-items:center;gap:10px}
    .drawer-theme-label{font-family:var(--mono, 'JetBrains Mono', monospace);font-size:9.5px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-3, rgba(10,21,16,.58));font-weight:600}
    .drawer-theme-toggle{display:flex;gap:2px;padding:2px;background:var(--bg, #f6f7f5);border:1px solid var(--line, rgba(10,15,12,.1));border-radius:999px;margin-left:auto}
    .dtt-opt{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:5px 10px;border-radius:999px;border:none;background:transparent;cursor:pointer;font-family:var(--mono, 'JetBrains Mono', monospace);font-weight:500;font-size:10.5px;color:var(--ink-2, rgba(10,21,16,.78));text-transform:lowercase;letter-spacing:.04em;transition:all .18s}
    .dtt-opt svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .dtt-opt:hover{color:var(--ink, #0a1510)}
    body[data-theme="dark"] .dtt-opt[data-theme="dark"],
    body[data-theme="light"] .dtt-opt[data-theme="light"]{background:var(--accent-soft, rgba(10,168,90,.12));color:var(--accent, #0aa85a)}

    .drawer-foot{padding:16px 22px;border-top:1px solid var(--line, rgba(10,15,12,.1))}
    .drawer-foot .hd-cta{
      display:flex;align-items:center;justify-content:center;gap:8px;width:100%;
      padding:13px 18px;border-radius:999px;text-decoration:none;
      background:var(--accent, #0aa85a);color:var(--accent-ink, #ffffff);
      font-family:var(--mono, 'JetBrains Mono', monospace);font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:600;
    }
    .drawer-foot .hd-cta-stack{display:flex;flex-direction:column;align-items:center;gap:2px;line-height:1}
    .drawer-foot .hd-cta-main{font-weight:700}
    .drawer-foot .hd-cta-sub{font-size:9px;font-weight:500;opacity:.75;letter-spacing:.02em;text-transform:none}
  `;

  const MARKUP = `
    <button class="hd-trigger" id="menuBtn" aria-label="Menu" type="button">
      <span></span><span></span><span></span>
    </button>

    <div class="drawer-overlay" id="drawerOverlay"></div>

    <aside class="drawer" id="drawer" aria-label="Menu de navegação">
      <div class="drawer-head">
        <a class="logo" href="/" aria-label="1Negócio · página inicial"><em>1</em>NEGÓCIO</a>
        <button class="sheet-close" type="button" aria-label="Fechar">✕</button>
      </div>
      <div class="drawer-body">
        <a class="drawer-link enter" id="drawer-auth-link" href="/portal-usuario.html">
          <div class="drawer-avatar" id="drawer-avatar" style="display:none"></div>
          <div>
            <div class="drawer-link-t" id="drawer-auth-t">ENTRAR</div>
            <div class="drawer-link-s" id="drawer-auth-s">Acesse sua conta</div>
          </div>
          <svg class="enter-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>
        </a>

        <div class="drawer-theme">
          <span class="drawer-theme-label">Aparência</span>
          <div class="drawer-theme-toggle" id="drawerThemeToggle" role="tablist" aria-label="Tema">
            <button class="dtt-opt" data-theme="light" type="button" aria-label="Tema claro">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.9" y1="4.9" x2="7" y2="7"/><line x1="17" y1="17" x2="19.1" y2="19.1"/><line x1="4.9" y1="19.1" x2="7" y2="17"/><line x1="17" y1="7" x2="19.1" y2="4.9"/></svg>
              <span>Claro</span>
            </button>
            <button class="dtt-opt" data-theme="dark" type="button" aria-label="Tema escuro">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
              <span>Escuro</span>
            </button>
          </div>
        </div>

        <div class="drawer-section"><span class="drawer-section-label">Avaliar</span><span class="drawer-section-line"></span></div>
        <a class="drawer-link" href="/avaliar.html"><div><div class="drawer-link-t">Avaliar gratuitamente</div><div class="drawer-link-s">Quanto vale a sua empresa · entenda o processo</div></div></a>

        <div class="drawer-section"><span class="drawer-section-label">Vender</span><span class="drawer-section-line"></span></div>
        <a class="drawer-link" href="/vender.html"><div><div class="drawer-link-t">Como funciona pra vender</div><div class="drawer-link-s">Do diagnóstico à venda</div></div></a>

        <div class="drawer-section"><span class="drawer-section-label">Comprar</span><span class="drawer-section-line"></span></div>
        <a class="drawer-link" href="/comprar.html"><div><div class="drawer-link-t">Ver oportunidades</div><div class="drawer-link-s">Marketplace de negócios avaliados</div></div></a>
        <a class="drawer-link" href="/cadastre.html"><div><div class="drawer-link-t">Cadastrar tese de investimento</div><div class="drawer-link-s">Receba oportunidades sob medida</div></div></a>

        <div class="drawer-section"><span class="drawer-section-label">Representar</span><span class="drawer-section-line"></span></div>
        <a class="drawer-link" href="/parcerias-pontuais.html"><div><div class="drawer-link-t">Parcerias pontuais</div><div class="drawer-link-s">Trouxe negócio ou comprador? Vamos conversar</div></div></a>
        <a class="drawer-link" href="/socio-parceiro.html"><div><div class="drawer-link-t">Ser sócio-parceiro</div><div class="drawer-link-s">Indique negócios e ganhe comissão recorrente</div></div></a>

        <div class="drawer-section"><span class="drawer-section-label">Institucional</span><span class="drawer-section-line"></span></div>
        <a class="drawer-link" href="/analises.html"><div><div class="drawer-link-t">Análises do mercado</div><div class="drawer-link-s">Compra e venda de empresas na prática</div></div></a>
        <a class="drawer-link" href="https://wa.me/5511952136406" target="_blank" rel="noopener"><div><div class="drawer-link-t">Falar conosco</div><div class="drawer-link-s">WhatsApp comercial · resposta no horário útil</div></div></a>
      </div>
      <div class="drawer-foot">
        <a href="/avaliar.html" class="hd-cta">
          <span class="hd-cta-stack"><span class="hd-cta-main">Avaliar gratuitamente</span></span>
        </a>
        <a class="drawer-link signout" href="#" id="drawer-signout" style="display:none"><div><div class="drawer-link-t">Sair da conta</div><div class="drawer-link-s">Encerra sua sessão neste navegador</div></div></a>
      </div>
    </aside>
  `;

  function _injectCss() {
    if (document.getElementById('hd-css')) return;
    const s = document.createElement('style');
    s.id = 'hd-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function _injectMarkup() {
    const wrap = document.createElement('div');
    wrap.id = 'hd-root';
    wrap.innerHTML = MARKUP;
    document.body.appendChild(wrap);
  }

  function _toggle(force) {
    const drawer = document.getElementById('drawer');
    const overlay = document.getElementById('drawerOverlay');
    const btn = document.getElementById('menuBtn');
    if (!drawer || !overlay || !btn) return;
    const willOpen = typeof force === 'boolean' ? force : !drawer.classList.contains('open');
    drawer.classList.toggle('open', willOpen);
    overlay.classList.toggle('open', willOpen);
    btn.classList.toggle('open', willOpen);
  }

  function _setTheme(t) {
    if (t !== 'light' && t !== 'dark') return;
    document.body.dataset.theme = t;
    try { localStorage.setItem('1n-theme', t); } catch (e) {}
  }

  function _bindBehavior() {
    const btn = document.getElementById('menuBtn');
    const overlay = document.getElementById('drawerOverlay');
    const drawer = document.getElementById('drawer');
    if (btn) btn.addEventListener('click', () => _toggle());
    if (overlay) overlay.addEventListener('click', () => _toggle(false));
    const closeBtn = drawer && drawer.querySelector('.sheet-close');
    if (closeBtn) closeBtn.addEventListener('click', () => _toggle(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer && drawer.classList.contains('open')) _toggle(false);
    });
    // Theme toggle
    document.querySelectorAll('#drawerThemeToggle .dtt-opt').forEach(b => {
      b.addEventListener('click', () => _setTheme(b.dataset.theme));
    });
    // Signout (HamburgerAccount.signOut · injetado por js/hamburger-account.js)
    const out = document.getElementById('drawer-signout');
    if (out) out.addEventListener('click', (e) => {
      e.preventDefault();
      if (window.HamburgerAccount && typeof window.HamburgerAccount.signOut === 'function') {
        window.HamburgerAccount.signOut();
      }
    });
  }

  function mount() {
    if (document.getElementById('drawer')) return; // belt-and-suspenders
    _injectCss();
    _injectMarkup();
    _bindBehavior();
    // Aplica tema persistido (se existir) · senão respeita o que a página já setou
    try {
      const saved = localStorage.getItem('1n-theme');
      if (saved === 'light' || saved === 'dark') document.body.dataset.theme = saved;
    } catch (e) {}
    // Refresh do account caso tenha sido carregado antes do drawer
    if (window.HamburgerAccount && typeof window.HamburgerAccount.refresh === 'function') {
      window.HamburgerAccount.refresh();
    }
  }

  window.HamburgerDrawer = { mount, toggle: _toggle };
  // Compat com chamadas legacy (caso algum onclick=toggleDrawer() reste)
  if (typeof window.toggleDrawer !== 'function') window.toggleDrawer = () => _toggle();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
