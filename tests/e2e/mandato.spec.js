// @ts-check
/**
 * MANDATO · chassi (Prompt 1) · E2E · 8 critérios de aceite.
 * Credenciais lidas de E2E_EMAIL / E2E_PASS (nunca commitadas).
 * Não-admin opcional: E2E_NONADMIN_EMAIL / E2E_NONADMIN_PASS · pula se ausente.
 */
const { test, expect } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS = process.env.E2E_PASS;
const NONADMIN_EMAIL = process.env.E2E_NONADMIN_EMAIL;
const NONADMIN_PASS = process.env.E2E_NONADMIN_PASS;

test.beforeAll(() => {
  if (!EMAIL || !PASS) {
    throw new Error('E2E_EMAIL e E2E_PASS obrigatórios. Exporte no shell antes de rodar.');
  }
});

async function login(page, email = EMAIL, pass = PASS) {
  await page.goto('/mandato/cockpit.html');
  await page.waitForSelector('#lgf', { state: 'visible', timeout: 10_000 });
  await page.fill('#lg-em', email);
  await page.fill('#lg-pw', pass);
  await Promise.all([
    page.waitForLoadState('load'),
    page.click('#lgf button[type=submit]'),
  ]);
}

// Helper: espera o seletor de mandatos aparecer (renderizado depois do login,
// via renderSelector que popula .selector__grid com cards).
// IMPORTANTE: só espera .selector__card. Não considerar .muted:not(:empty)
// como sinal de prontidão — ele casa com "Carregando…" antes dos cards existirem.
async function esperarSeletor(page) {
  await page.waitForSelector('.selector__card', { timeout: 10_000 });
}

// Helper: reúne erros de console + pageerror pro critério 7
function coletarErrosDeConsole(page, sink) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') sink.push({ tipo: 'console.error', texto: msg.text(), url: page.url() });
  });
  page.on('pageerror', (err) => {
    sink.push({ tipo: 'pageerror', texto: err.message, stack: err.stack, url: page.url() });
  });
}

test.describe('MANDATO chassi · critérios de aceite', () => {

  // ── 1. Sem sessão → login inline ────────────────────────────────
  test('1 · sem sessão · /cockpit.html mostra login inline', async ({ page }) => {
    await page.context().clearCookies();
    await page.addInitScript(() => {
      try { localStorage.clear(); sessionStorage.clear(); } catch {}
    });
    await page.goto('/mandato/cockpit.html');
    await expect(page.locator('#lgf')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('h1').first()).toContainText(/Entrar no MANDATO/i);
    // Não deve ter renderizado nem topbar nem seletor
    await expect(page.locator('.topbar')).toHaveCount(0);
    await expect(page.locator('.selector')).toHaveCount(0);
  });

  // ── 2. Login admin → seletor lista mandatos reais ───────────────
  test('2 · login admin · seletor lista mandatos reais', async ({ page }) => {
    await login(page);
    await esperarSeletor(page);
    const cards = page.locator('.selector__card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    // Cada card tem nome + meta com código ou cidade
    const primeiro = cards.first();
    await expect(primeiro.locator('.selector__nome')).not.toBeEmpty();
    await expect(primeiro.locator('.selector__meta')).not.toBeEmpty();
  });

  // ── 3. Clicar num mandato → ?mandato ganha uuid + header real ───
  test('3 · selecionar mandato · URL com ?mandato e header populado', async ({ page }) => {
    await login(page);
    await esperarSeletor(page);
    const card = page.locator('.selector__card').first();
    const href = await card.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href).toMatch(/\?mandato=[0-9a-f-]{36}/i);
    await Promise.all([
      page.waitForURL(/\?mandato=[0-9a-f-]{36}/i),
      card.click(),
    ]);
    // Topbar apareceu com nome do mandato (não "Selecione um mandato")
    await expect(page.locator('.topbar__mandato-nome')).toBeVisible();
    const nome = await page.locator('.topbar__mandato-nome').textContent();
    expect(nome?.trim().toLowerCase()).not.toBe('selecione um mandato');
    expect(nome?.trim().length).toBeGreaterThan(0);
  });

  // ── 4. Navegar 4 zonas via topbar preserva ?mandato ─────────────
  test('4 · navegar cockpit → ativo → máquina → mesa preserva ?mandato', async ({ page }) => {
    await login(page);
    await esperarSeletor(page);
    await Promise.all([
      page.waitForURL(/\?mandato=[0-9a-f-]{36}/i),
      page.locator('.selector__card').first().click(),
    ]);
    const url0 = new URL(page.url());
    const mandatoId = url0.searchParams.get('mandato');
    expect(mandatoId).toMatch(/^[0-9a-f-]{36}$/i);

    // Clica em cada zona pela topbar (não navigate direto)
    for (const zona of ['Ativo', 'Máquina', 'Mesa', 'Cockpit']) {
      await Promise.all([
        page.waitForURL(new RegExp(`\\?mandato=${mandatoId}`, 'i')),
        page.locator('.topbar__nav a', { hasText: new RegExp(`^${zona}$`) }).click(),
      ]);
      const u = new URL(page.url());
      expect(u.searchParams.get('mandato')).toBe(mandatoId);
    }
  });

  // ── 5. Deep-link · reload de /ativo.html?mandato=uuid restaura ─
  test('5 · deep-link · /ativo.html?mandato=uuid restaura sem seletor', async ({ page }) => {
    // Autentica primeiro pra ter sessão
    await login(page);
    await esperarSeletor(page);
    await Promise.all([
      page.waitForURL(/\?mandato=/i),
      page.locator('.selector__card').first().click(),
    ]);
    const mandatoId = new URL(page.url()).searchParams.get('mandato');

    // Deep-link direto pra Ativo com o mesmo uuid, RELOAD frio
    await page.goto(`/mandato/ativo.html?mandato=${mandatoId}`);
    await expect(page.locator('.topbar__mandato-nome')).toBeVisible({ timeout: 10_000 });
    // Não passou pelo seletor
    await expect(page.locator('.selector')).toHaveCount(0);
    // A URL manteve o param
    expect(new URL(page.url()).searchParams.get('mandato')).toBe(mandatoId);
    // Zona atual está marcada
    await expect(page.locator('.topbar__nav a[aria-current="page"]')).toContainText(/Ativo/);
  });

  // ── 6. Login não-admin → acesso negado (skip se sem creds) ──────
  test('6 · login não-admin · tela acesso negado', async ({ page }) => {
    test.skip(!NONADMIN_EMAIL || !NONADMIN_PASS,
      'E2E_NONADMIN_EMAIL / E2E_NONADMIN_PASS não fornecidos. NÃO-TESTÁVEL.');
    await login(page, NONADMIN_EMAIL, NONADMIN_PASS);
    // Após signIn com sucesso e RPC va_is_admin=false → tela "acesso negado"
    await expect(page.locator('h1')).toContainText(/allowlist|acesso negado/i, { timeout: 10_000 });
    await expect(page.locator('.topbar')).toHaveCount(0);
    await expect(page.locator('.selector')).toHaveCount(0);
  });

  // ── 7. Zero erros de console em cada zona ────────────────────────
  test('7 · zero erros de JS em nenhuma das 4 páginas', async ({ page }) => {
    const erros = [];
    coletarErrosDeConsole(page, erros);
    await login(page);
    await esperarSeletor(page);
    await Promise.all([
      page.waitForURL(/\?mandato=/i),
      page.locator('.selector__card').first().click(),
    ]);
    const mandatoId = new URL(page.url()).searchParams.get('mandato');
    for (const zona of ['cockpit', 'ativo', 'maquina', 'mesa']) {
      await page.goto(`/mandato/${zona}.html?mandato=${mandatoId}`);
      // aguarda topbar montar (garante que module executou)
      await expect(page.locator('.topbar__mandato-nome')).toBeVisible({ timeout: 10_000 });
      // pequeno idle pra qualquer erro assíncrono
      await page.waitForTimeout(400);
    }
    if (erros.length) {
      const resumo = erros.map(e => `[${e.tipo}] @ ${e.url}\n  ${e.texto}`).join('\n');
      throw new Error(`Erros detectados:\n${resumo}`);
    }
  });

  // ── 8. Abas Máquina · Captação/Funil sem reload e sem perder mandato
  test('8 · abas da Máquina · troca client-side · ?mandato preservado', async ({ page }) => {
    await login(page);
    await esperarSeletor(page);
    await Promise.all([
      page.waitForURL(/\?mandato=/i),
      page.locator('.selector__card').first().click(),
    ]);
    const mandatoId = new URL(page.url()).searchParams.get('mandato');
    await page.goto(`/mandato/maquina.html?mandato=${mandatoId}`);
    // Espera o MÓDULO ES sinalizar prontidão · #mq-tabs é HTML estático
    // (existe antes do JS montar handlers). data-ready="true" é setado como
    // última linha do inline module de maquina.html.
    await page.waitForSelector('#mq-tabs[data-ready="true"]', { timeout: 10_000 });

    // Estado inicial: Captação
    await expect(page.locator('#mq-panel-captacao')).toBeVisible();
    await expect(page.locator('#mq-panel-funil')).toBeHidden();
    await expect(page.locator('#mq-tabs button[data-tab="captacao"][aria-current="true"]')).toBeVisible();

    // Sensor de reload robusto: planta um marcador único no window da página
    // atual. Se sobreviver aos cliques, não houve reload. hash changes via
    // history.replaceState() NÃO limpam o window — só reload de página inteira.
    const marker = 'e2e-no-reload-' + Date.now();
    await page.evaluate((m) => { window.__e2eMarker = m; }, marker);

    // Clica Funil
    await page.locator('#mq-tabs button[data-tab="funil"]').click();
    await expect(page.locator('#mq-panel-funil')).toBeVisible();
    await expect(page.locator('#mq-panel-captacao')).toBeHidden();
    await expect(page.locator('#mq-tabs button[data-tab="funil"][aria-current="true"]')).toBeVisible();

    // Clica Captação de volta
    await page.locator('#mq-tabs button[data-tab="captacao"]').click();
    await expect(page.locator('#mq-panel-captacao')).toBeVisible();
    await expect(page.locator('#mq-panel-funil')).toBeHidden();

    // Se houve reload, window.__e2eMarker foi apagado.
    const markerAtual = await page.evaluate(() => window.__e2eMarker);
    expect(markerAtual).toBe(marker);
    // ?mandato continua na URL
    expect(new URL(page.url()).searchParams.get('mandato')).toBe(mandatoId);
  });
});
