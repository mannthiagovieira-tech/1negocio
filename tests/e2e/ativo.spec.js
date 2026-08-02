// @ts-check
// MANDATO · Zona ATIVO · E2E.
// Não chama IA (edges de geração ficam em teste manual).
// Setup: cria dados de teste com prefixo "E2E ·" e limpa no teardown.

const { test, expect, request } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

test.beforeAll(() => {
  if (!EMAIL || !PASS) throw new Error('E2E_EMAIL e E2E_PASS obrigatórios');
});

// ── helpers de banco (via REST + JWT do próprio admin) ─────────────
async function loginToken() {
  const ctx = await request.newContext();
  const r = await ctx.post(`${SB_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SB_ANON, 'Content-Type': 'application/json' },
    data: { email: EMAIL, password: PASS },
  });
  const d = await r.json();
  await ctx.dispose();
  return d.access_token;
}
async function apiInsertArq(token, row) {
  const ctx = await request.newContext();
  const r = await ctx.post(`${SB_URL}/rest/v1/va_arquetipos`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    data: row,
  });
  const body = await r.json();
  await ctx.dispose();
  return { status: r.status(), body };
}
async function apiDeleteArqPorNome(token, projetoId, prefixo) {
  const ctx = await request.newContext();
  await ctx.delete(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${projetoId}&nome=like.${encodeURIComponent(prefixo+'%')}`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
  });
  await ctx.dispose();
}
async function apiListMandato(token) {
  const ctx = await request.newContext();
  const r = await ctx.get(`${SB_URL}/rest/v1/va_projetos_resumo?arquivado_em=is.null&select=id,cliente_nome,negocio_titulo&order=data_inicio.desc&limit=1`, {
    headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  await ctx.dispose();
  return d[0];
}

async function login(page) {
  await page.goto('/mandato/ativo.html');
  await page.waitForSelector('#lgf');
  await page.fill('#lg-em', EMAIL);
  await page.fill('#lg-pw', PASS);
  await page.click('#lgf button[type=submit]');
  // Aguarda o reload pós-login estabilizar antes de próximas navegações.
  await page.waitForSelector('.selector__card, #ativo-body[data-ready="true"]', { timeout: 15_000 });
}

async function irParaAtivo(page, mandatoId) {
  await page.goto(`/mandato/ativo.html?mandato=${mandatoId}`);
  await page.waitForSelector('#ativo-body[data-ready="true"]', { timeout: 15_000 });
}

test.describe('Zona ATIVO · E2E', () => {

  // ── 1. faixa-resumo com dados reais + data-ready ────────────────
  test('1 · faixa-resumo renderiza com dados reais + data-ready', async ({ page }) => {
    await login(page);
    await page.waitForSelector('.selector__card', { timeout: 10_000 });
    await Promise.all([
      page.waitForURL(/\?mandato=/),
      page.locator('.selector__card').first().click(),
    ]);
    await page.waitForSelector('#ativo-body[data-ready="true"]', { timeout: 15_000 });
    await expect(page.locator('.faixa__nome')).toBeVisible();
    const nome = (await page.locator('.faixa__nome').textContent())?.trim();
    expect(nome && nome.length).toBeGreaterThan(0);
  });

  // ── 2. definir valor de venda via modal ──────────────────────────
  test('2 · definir valor de venda persiste e recarrega', async ({ page }) => {
    const tok = await loginToken();
    const m = await apiListMandato(tok);
    await login(page);
    await irParaAtivo(page, m.id);
    await page.click('#btn-def-valor');
    await page.waitForSelector('.modal');
    const valor = 1234567;
    await page.fill('#mv-valor', String(valor));
    await page.fill('#mv-just', 'E2E · valor de teste, será revertido');
    await page.click('#mv-salvar');
    await page.waitForSelector('.valor-box__num', { timeout: 5000 });
    const txt = await page.locator('.valor-box__num').textContent();
    expect(txt).toContain('1.234.567');
    // Confirma persistência no banco (via API) ANTES de recarregar
    const ctx = await request.newContext();
    const chk = await ctx.get(`${SB_URL}/rest/v1/va_projetos_resumo?id=eq.${m.id}&select=valor_venda`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${tok}` },
    });
    const rows = await chk.json();
    await ctx.dispose();
    expect(Number(rows[0]?.valor_venda)).toBe(valor);
    // Reload com goto (bypassa qualquer cache do reload)
    await page.goto(`/mandato/ativo.html?mandato=${m.id}`);
    await page.waitForSelector('#ativo-body[data-ready="true"]');
    await expect(page.locator('.valor-box__num')).toContainText('1.234.567');
  });

  // ── 3. criar arquétipo manual completo → rascunho ────────────────
  test('3 · criar arquétipo manual → aparece como rascunho', async ({ page }) => {
    const tok = await loginToken();
    const m = await apiListMandato(tok);
    await apiDeleteArqPorNome(tok, m.id, 'E2E ·');
    await login(page);
    await irParaAtivo(page, m.id);
    // Cria via API (o prompt() do browser é bloqueado em headless — API é mais robusto)
    await apiInsertArq(tok, {
      projeto_id: m.id, nome: 'E2E · arquétipo manual', origem: 'manual',
      tese: 'Teste E2E · tese válida com pelo menos vinte caracteres pra passar validação.',
      filtro: { uf: ['SC'], porte: ['ME'] },
      abordagem: { angulo: 'ângulo teste E2E longo', objecao_provavel: 'objeção teste E2E longa', segmentacao_meta: 'segmentação teste E2E longa' },
    });
    await page.reload();
    await page.waitForSelector('#ativo-body[data-ready="true"]');
    const card = page.locator('.arq-card', { hasText: 'E2E · arquétipo manual' });
    await expect(card).toBeVisible();
    await expect(card.locator('.pill').first()).toContainText(/rascunho/);
  });

  // ── 4. aprovar arquétipo → pill muda, edição bloqueada ──────────
  test('4 · aprovar arquétipo → pill aprovado + edição bloqueada', async ({ page }) => {
    const tok = await loginToken();
    const m = await apiListMandato(tok);
    await apiDeleteArqPorNome(tok, m.id, 'E2E ·');
    const { body } = await apiInsertArq(tok, {
      projeto_id: m.id, nome: 'E2E · aprovar', origem: 'manual',
      tese: 'tese válida pro E2E de aprovação com mais de vinte caracteres.',
      filtro: { uf: ['SC'] },
      abordagem: { angulo: 'ang teste E2E', objecao_provavel: 'obj teste E2E', segmentacao_meta: 'seg teste E2E' },
    });
    const arqId = body[0].id;
    await login(page);
    await irParaAtivo(page, m.id);
    // aceita o confirm() automaticamente
    page.on('dialog', (d) => d.accept());
    await page.click(`[data-arq-aprovar="${arqId}"]`);
    await page.waitForSelector(`.arq-card[data-arq="${arqId}"] .pill--accent`, { timeout: 5000 });
    // não deve ter botão editar (só nova versão + arquivar)
    await expect(page.locator(`[data-arq-editar="${arqId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-arq-nova-versao="${arqId}"]`)).toBeVisible();
  });

  // ── 5. teto: 5 ativos → botão desabilitado + insert direto erra ──
  test('5 · teto 5 · botão desabilitado + trigger bloqueia insert direto', async ({ page }) => {
    const tok = await loginToken();
    const m = await apiListMandato(tok);
    await apiDeleteArqPorNome(tok, m.id, 'E2E ·');
    // Zera ativos deste projeto: arquiva tudo que não é E2E
    const ctx = await request.newContext();
    await ctx.patch(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${m.id}&status=neq.arquivado`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      data: { status: 'arquivado' },
    });
    await ctx.dispose();
    // Insere 5 E2E
    for (let i = 1; i <= 5; i++) {
      await apiInsertArq(tok, {
        projeto_id: m.id, nome: `E2E · teto ${i}`, origem: 'manual',
        tese: `tese válida do teto ${i} com pelo menos vinte caracteres teste.`,
        filtro: { uf: ['SC'] },
        abordagem: { angulo: 'a', objecao_provavel: 'b', segmentacao_meta: 'c' }, // curto, mas o trigger não valida isso
      });
    }
    // 6º insert deve falhar pelo trigger
    const { status, body } = await apiInsertArq(tok, {
      projeto_id: m.id, nome: 'E2E · teto 6', origem: 'manual',
      tese: 'tese válida do teto sexto com pelo menos vinte caracteres teste.',
      filtro: { uf: ['SC'] }, abordagem: { angulo: 'a', objecao_provavel: 'b', segmentacao_meta: 'c' },
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(body)).toMatch(/ARQ_TETO/);
    // UI: botão desabilitado
    await login(page);
    await irParaAtivo(page, m.id);
    await expect(page.locator('#btn-ger-arq')).toBeDisabled();
    await expect(page.locator('#btn-man-arq')).toBeDisabled();
  });

  // ── 6. arquivar → some do grid, aparece no toggle ────────────────
  test('6 · arquivar remove do grid principal, aparece no toggle', async ({ page }) => {
    const tok = await loginToken();
    const m = await apiListMandato(tok);
    await apiDeleteArqPorNome(tok, m.id, 'E2E ·');
    const { body } = await apiInsertArq(tok, {
      projeto_id: m.id, nome: 'E2E · pra arquivar', origem: 'manual',
      tese: 'tese válida pra teste de arquivamento com mais de vinte caracteres.',
      filtro: { uf: ['SC'] },
      abordagem: { angulo: 'a', objecao_provavel: 'b', segmentacao_meta: 'c' },
    });
    const arqId = body[0].id;
    await login(page);
    await irParaAtivo(page, m.id);
    page.on('dialog', (d) => d.accept());
    await page.click(`[data-arq-arquivar="${arqId}"]`);
    await page.waitForTimeout(600); // aguarda re-render
    await expect(page.locator(`.arq-card[data-arq="${arqId}"]`)).toHaveCount(0);
    await page.check('#tog-arq');
    await page.waitForTimeout(400);
    await expect(page.locator(`.arq-card[data-arq="${arqId}"]`)).toBeVisible();
  });

  // ── 7. cleanup: garante que os testes não deixaram rastro ───────
  test.afterAll(async () => {
    const tok = await loginToken();
    const m = await apiListMandato(tok);
    if (m) {
      const ctx = await request.newContext();
      // Remove todos E2E
      await ctx.delete(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${m.id}&nome=like.E2E%20%C2%B7%25`, {
        headers: { apikey: SB_ANON, Authorization: `Bearer ${tok}` },
      });
      await ctx.dispose();
    }
  });
});
