// @ts-check
// MANDATO · Zona Máquina · aba CAPTAÇÃO · E2E.
// Não chama Kipflow real · leads seedados via REST + service role.
// Setup: prefixos identificáveis. Teardown limpa.

const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

const PREFIXO = 'E2ECAP·';

test.beforeAll(() => {
  if (!EMAIL || !PASS) throw new Error('E2E_EMAIL e E2E_PASS obrigatórios');
});

// ─── helpers ─────────────────────────────────────────────────────────
async function loginToken() {
  const ctx = await pwrequest.newContext();
  const r = await ctx.post(`${SB_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SB_ANON, 'Content-Type':'application/json' },
    data: { email: EMAIL, password: PASS },
  });
  const d = await r.json();
  await ctx.dispose();
  return d.access_token;
}
async function api(tok) {
  const ctx = await pwrequest.newContext({
    extraHTTPHeaders: {
      apikey: SB_ANON,
      Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });
  return ctx;
}
// Fixa Arte Deli (b676073a) como projeto único do E2E de captação. Antes
// era resolvido dinamicamente sem ORDER, e o projeto variava entre testes,
// contaminando estado (blacklist/leads) e causando flake do teste 5.
const CAPTACAO_PROJ_ID = 'b676073a-6074-48d4-a608-7947de006dff';
async function pegarMandatoComArquetipoAprovado(tok) {
  const ctx = await api(tok);
  const rProj = await ctx.get(`${SB_URL}/rest/v1/va_projetos_resumo?id=eq.${CAPTACAO_PROJ_ID}&select=id,cliente_nome,negocio_titulo,cidade,uf`);
  const [proj] = await rProj.json();
  if (!proj) { await ctx.dispose(); throw new Error(`Projeto ${CAPTACAO_PROJ_ID} não encontrado`); }
  // Garante que exista pelo menos 1 arquétipo aprovado (reativa arquivado se preciso)
  const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${proj.id}&status=eq.aprovado&select=id,nome,filtro&order=criado_em.asc&limit=1`);
  let [arq] = await rA.json();
  if (!arq) {
    // fallback: pega qualquer arquivado e reativa
    const rArq = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${proj.id}&order=criado_em.asc&limit=1`);
    const [any] = await rArq.json();
    if (!any) { await ctx.dispose(); throw new Error('Arte Deli sem arquétipos'); }
    await ctx.patch(`${SB_URL}/rest/v1/va_arquetipos?id=eq.${any.id}`, {
      data: { status:'aprovado', arquivado_em: null },
    });
    arq = { ...any, status:'aprovado' };
  }
  await ctx.dispose();
  return { proj, arq };
}
async function seedLeads(tok, projetoId, arquetipoId, cidadeAtivo) {
  const ctx = await api(tok);
  // limpa seeds anteriores
  await ctx.delete(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${projetoId}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_projeto_blacklist?projeto_id=eq.${projetoId}&nome=like.${encodeURIComponent(PREFIXO+'%')}`);
  // cria extração-mãe (INSERT single retorna array)
  const extR = await ctx.post(`${SB_URL}/rest/v1/va_extracoes`, {
    data: { projeto_id: projetoId, arquetipo_id: arquetipoId, fonte:'manual', status:'concluida', query:{ seed:true } },
  });
  if (!extR.ok()) throw new Error('seed:extracao ' + extR.status() + ' ' + (await extR.text()).slice(0,200));
  const extBody = await extR.json();
  const ext = Array.isArray(extBody) ? extBody[0] : extBody;
  // blacklist: 1 entrada
  const blR = await ctx.post(`${SB_URL}/rest/v1/va_projeto_blacklist`, {
    data: { projeto_id: projetoId, nome: `${PREFIXO}Concorrente Proibido`, motivo:'seed E2E · concorrente vetado', origem:'manual' },
  });
  if (!blR.ok()) throw new Error('seed:blacklist ' + blR.status() + ' ' + (await blR.text()).slice(0,200));
  // 5 normais + 1 same_city + 1 blacklist_hit · INSERTS individuais (evita comportamento de array)
  const base = { projeto_id: projetoId, extracao_id: ext.id, arquetipo_id: arquetipoId, origem:'extracao', fonte:'manual' };
  const seeds = [
    { ...base, razao_social:`${PREFIXO}Alfa Alimentos SA`,   cnpj:'11.111.111/0001-11', cidade:'Cidade Longe', uf:'MG', faturamento_estimado: 2500000, same_city:false },
    { ...base, razao_social:`${PREFIXO}Beta Foods Ltda`,     cnpj:'22.222.222/0001-22', cidade:'Cidade Longe', uf:'SP', faturamento_estimado: 3200000, same_city:false },
    { ...base, razao_social:`${PREFIXO}Gama Industrial`,     cnpj:'33.333.333/0001-33', cidade:'Cidade Longe', uf:'PR', faturamento_estimado: 4100000, same_city:false },
    { ...base, razao_social:`${PREFIXO}Delta Produtos`,      cnpj:'44.444.444/0001-44', cidade:'Cidade Longe', uf:'RS', faturamento_estimado: 5000000, same_city:false },
    { ...base, razao_social:`${PREFIXO}Epsilon Indústria`,   cnpj:'55.555.555/0001-55', cidade:'Cidade Longe', uf:'BA', faturamento_estimado: 1800000, same_city:false },
    { ...base, razao_social:`${PREFIXO}Zeta Mesma Cidade`,   cnpj:'66.666.666/0001-66', cidade: cidadeAtivo || 'Cidade Longe', uf:'RJ', faturamento_estimado: 2900000, same_city:true },
    { ...base, razao_social:`${PREFIXO}Concorrente Proibido Ltda`, cnpj:'77.777.777/0001-77', cidade:'Cidade Longe', uf:'RJ', faturamento_estimado: 3000000 },
  ];
  for (const s of seeds) {
    const r = await ctx.post(`${SB_URL}/rest/v1/va_leads`, { data: s });
    if (!r.ok()) throw new Error(`seed:lead(${s.razao_social}) ${r.status()} ${(await r.text()).slice(0,200)}`);
  }
  await ctx.dispose();
  return { ext };
}
async function teardown(tok, projetoId) {
  const ctx = await api(tok);
  // pega ids de leads pra apagar log em cascade
  await ctx.delete(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${projetoId}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_projeto_blacklist?projeto_id=eq.${projetoId}&nome=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_extracoes?projeto_id=eq.${projetoId}&fonte=eq.manual&query->>seed=eq.true`);
  await ctx.dispose();
}
async function login(page) {
  await page.goto('/mandato/cockpit.html');
  await page.waitForSelector('#lgf', { state: 'visible', timeout: 10_000 });
  await page.fill('#lg-em', EMAIL);
  await page.fill('#lg-pw', PASS);
  await Promise.all([page.waitForLoadState('load'), page.click('#lgf button[type=submit]')]);
  // aguarda a página pós-login estabilizar antes de próxima navegação
  await page.waitForSelector('.selector__card, .topbar__mandato-nome', { timeout: 15_000 });
}
async function irMaquinaCaptacao(page, mid) {
  await page.goto(`/mandato/maquina.html?mandato=${mid}`);
  // captação é a aba default · setAba dispara mountCaptacao lazy
  await page.waitForSelector('#mq-tabs[data-ready="true"]', { timeout: 25_000 });
  await page.waitForSelector('#mq-panel-captacao[data-ready="true"]', { timeout: 25_000 });
}

// ─── testes ──────────────────────────────────────────────────────────
test.describe('Zona MÁQUINA · CAPTAÇÃO · E2E', () => {

  test('1 · aba renderiza · data-ready · arq aprovado no painel Fonte', async ({ page }) => {
    const tok = await loginToken();
    const { proj } = await pegarMandatoComArquetipoAprovado(tok);
    await login(page);
    await irMaquinaCaptacao(page, proj.id);
    // 3 painéis presentes
    await expect(page.locator('#cap-col-fonte')).toBeVisible();
    await expect(page.locator('#cap-col-antessala')).toBeVisible();
    await expect(page.locator('#cap-col-destino')).toBeVisible();
    // pelo menos 1 arquétipo card visível
    await expect(page.locator('.arq-card-cap').first()).toBeVisible();
  });

  test('2 · seeds · same-city destaca · bloqueado destaca', async ({ page }) => {
    const tok = await loginToken();
    const { proj, arq } = await pegarMandatoComArquetipoAprovado(tok);
    await seedLeads(tok, proj.id, arq.id, proj.cidade);
    await login(page);
    await irMaquinaCaptacao(page, proj.id);
    // Alfa/Beta/... aparecem
    await expect(page.locator(`text=${PREFIXO}Alfa Alimentos`).first()).toBeVisible();
    // Same city: linha com classe is-samecity
    const same = page.locator(`tr:has-text("${PREFIXO}Zeta Mesma Cidade")`);
    await expect(same).toHaveClass(/is-samecity/);
    // Bloqueado: linha com is-blocked + pill BLOQUEADO
    const bloq = page.locator(`tr:has-text("${PREFIXO}Concorrente Proibido")`);
    await expect(bloq).toHaveClass(/is-blocked/);
    await expect(bloq.locator('.pill--blocked')).toBeVisible();
  });

  // Portão via endpoint real em prod (python http.server local não serve /api)
  test('3 · aprovar 1 via portão · lançamento na razão verificado', async ({ page }) => {
    const tok = await loginToken();
    const { proj, arq } = await pegarMandatoComArquetipoAprovado(tok);
    await seedLeads(tok, proj.id, arq.id, proj.cidade);
    // renderiza UI pra provar que a linha Alfa aparece
    await login(page);
    await irMaquinaCaptacao(page, proj.id);
    await expect(page.locator(`tr:has-text("${PREFIXO}Alfa Alimentos")`)).toBeVisible();

    // busca id do lead Alfa
    const ctx = await api(tok);
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${proj.id}&razao_social=eq.${encodeURIComponent(PREFIXO+'Alfa Alimentos SA')}&select=id`);
    const [alfa] = await rL.json();
    // chama portão real em prod (o endpoint /api NÃO é servido pelo python local)
    const rPort = await ctx.post('https://www.1negocio.com.br/api/va-portao-leads', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { projeto_id: proj.id, lead_ids: [alfa.id] },
    });
    const dPort = await rPort.json();
    expect(dPort.ok).toBe(true);
    expect(dPort.aprovados).toBe(1);
    expect(Number(dPort.custo_total)).toBeGreaterThan(0);

    // valida lead + razão
    const rL2 = await ctx.get(`${SB_URL}/rest/v1/va_leads?id=eq.${alfa.id}&select=status,custo_creditos`);
    const [alfaP] = await rL2.json();
    expect(alfaP.status).toBe('aprovado');
    expect(Number(alfaP.custo_creditos)).toBeGreaterThan(0);
    const shortId = alfa.id.slice(0,8);
    const rR = await ctx.get(`${SB_URL}/rest/v1/va_projeto_razao?projeto_id=eq.${proj.id}&referencia=like.${encodeURIComponent('%lead:'+shortId+'%')}&select=tipo,quantidade,valor_total,referencia`);
    const razao = await rR.json();
    await ctx.dispose();
    expect(razao.length).toBeGreaterThan(0);
    expect(razao[0].tipo).toBe('lead_scrapper');
    expect(Number(razao[0].valor_total)).toBeGreaterThan(0);
  });

  test('4 · seleção em massa · 3 leads via portão', async ({ page }) => {
    const tok = await loginToken();
    const { proj, arq } = await pegarMandatoComArquetipoAprovado(tok);
    await seedLeads(tok, proj.id, arq.id, proj.cidade);
    await login(page);
    await irMaquinaCaptacao(page, proj.id);

    // seleção em massa via UI (checkbox)
    for (const nome of ['Beta Foods','Gama Industrial','Delta Produtos']) {
      await page.locator(`tr:has-text("${PREFIXO}${nome}")`).locator('input[type=checkbox]').check();
    }
    await expect(page.locator('.dest-resumo__num')).toHaveText('3');

    // portão real em prod
    const ctx = await api(tok);
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${proj.id}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}&razao_social=in.(${['Beta Foods Ltda','Gama Industrial','Delta Produtos'].map(n=>encodeURIComponent(PREFIXO+n)).join(',')})&select=id`);
    const alvo = await rL.json();
    expect(alvo.length).toBe(3);
    const rPort = await ctx.post('https://www.1negocio.com.br/api/va-portao-leads', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { projeto_id: proj.id, lead_ids: alvo.map(l => l.id) },
    });
    const dPort = await rPort.json();
    expect(dPort.ok).toBe(true);
    expect(dPort.aprovados).toBe(3);
    await ctx.dispose();
  });

  test('5 · bloqueado · override abre modal · logs override_blacklist', async ({ page }) => {
    const tok = await loginToken();
    const { proj, arq } = await pegarMandatoComArquetipoAprovado(tok);
    await seedLeads(tok, proj.id, arq.id, proj.cidade);
    await login(page);
    await irMaquinaCaptacao(page, proj.id);
    page.on('dialog', d => d.accept());

    const linhaBloq = page.locator(`tr:has-text("${PREFIXO}Concorrente Proibido")`);
    // linha bloqueada NÃO tem checkbox nem botão Aprovar
    await expect(linhaBloq.locator('input[type=checkbox]')).toHaveCount(0);
    // botão Liberar abre modal
    await linhaBloq.locator('button:has-text("Liberar")').click();
    await expect(page.locator('.modal-bg')).toBeVisible();
    await page.locator('#over-conf').click();
    await expect(page.locator('.toast').filter({ hasText: /Liberado/i })).toBeVisible({ timeout: 15_000 });

    // log deve ter 'override_blacklist'
    const ctx = await api(tok);
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?razao_social=eq.${encodeURIComponent(PREFIXO+'Concorrente Proibido Ltda')}&select=id,status`);
    const [l] = await rL.json();
    expect(l.status).toBe('aprovado');
    const rLog = await ctx.get(`${SB_URL}/rest/v1/va_leads_log?lead_id=eq.${l.id}&acao=eq.override_blacklist&select=acao,detalhe`);
    const logs = await rLog.json();
    await ctx.dispose();
    expect(logs.length).toBeGreaterThan(0);
  });

  test('6 · dedupe · insert de CNPJ repetido no projeto → 409', async ({ page }) => {
    const tok = await loginToken();
    const { proj, arq } = await pegarMandatoComArquetipoAprovado(tok);
    await seedLeads(tok, proj.id, arq.id, proj.cidade);
    // verifica que Alfa existe (a seed rodou de verdade)
    const ctx = await api(tok);
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${proj.id}&razao_social=eq.${encodeURIComponent(PREFIXO+'Alfa Alimentos SA')}&select=cnpj`);
    const seedRows = await rL.json();
    expect(seedRows.length).toBe(1); // seed persistiu
    expect(seedRows[0].cnpj).toBe('11.111.111/0001-11');
    // agora tenta duplicar
    const r = await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: proj.id, arquetipo_id: arq.id, origem:'manual', razao_social:`${PREFIXO}Duplicado`, cnpj:'11.111.111/0001-11' },
    });
    await ctx.dispose();
    expect(r.status()).toBe(409); // UNIQUE partial index
  });

  test('7 · trigger de custo · UPDATE direto pra aprovado sem custo → exception', async ({ page }) => {
    const tok = await loginToken();
    const { proj, arq } = await pegarMandatoComArquetipoAprovado(tok);
    await seedLeads(tok, proj.id, arq.id, proj.cidade);
    // pega um lead em antessala (Epsilon)
    const ctx = await api(tok);
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?razao_social=eq.${encodeURIComponent(PREFIXO+'Epsilon Indústria')}&select=id`);
    const [l] = await rL.json();
    const rU = await ctx.patch(`${SB_URL}/rest/v1/va_leads?id=eq.${l.id}`, {
      data: { status: 'aprovado' },
    });
    const body = await rU.text();
    await ctx.dispose();
    expect(rU.status()).toBeGreaterThanOrEqual(400);
    expect(body).toMatch(/CAPT_CUSTO|custo_creditos/);
  });

  test.afterAll(async () => {
    const tok = await loginToken();
    const { proj } = await pegarMandatoComArquetipoAprovado(tok);
    await teardown(tok, proj.id);
  });
});
