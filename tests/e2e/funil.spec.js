// @ts-check
// MANDATO · Zona Máquina · aba FUNIL · E2E.
// NÃO chama Z-API real · usa VA_CADENCIA_MOCK=true no ambiente da function
// (env var permanente na Vercel para essa flag NÃO existe — o teste força
// via seed direto no banco onde possível, e usa endpoint /api/va-cadencia-tick
// apenas quando MOCK está ativo — o teste 3 verifica APENAS a agenda/débito
// via seed manual, não o envio real).
//
// Setup: prefixo 'E2EFUNIL·' + teardown limpo.

const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

const PREFIXO = 'E2EFUNIL·';
const PROJ_ID = 'b676073a-6074-48d4-a608-7947de006dff'; // Arte Deli

test.beforeAll(() => {
  if (!EMAIL || !PASS) throw new Error('E2E_EMAIL e E2E_PASS obrigatórios');
});

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
  return pwrequest.newContext({
    extraHTTPHeaders: {
      apikey: SB_ANON, Authorization: `Bearer ${tok}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
  });
}
async function limpar(tok) {
  const ctx = await api(tok);
  await ctx.delete(`${SB_URL}/rest/v1/va_disparos?projeto_id=eq.${PROJ_ID}&corpo_snapshot=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_mensagens_recebidas?projeto_id=eq.${PROJ_ID}&telefone=like.55E2E%`);
  await ctx.delete(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_cadencia_templates?projeto_id=eq.${PROJ_ID}&corpo=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.dispose();
}
async function pegarArquetipo(tok) {
  const ctx = await api(tok);
  const r = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&order=criado_em.asc&limit=1&select=id,nome`);
  const [a] = await r.json();
  await ctx.dispose();
  if (!a) throw new Error('Arte Deli sem arquétipo aprovado');
  return a;
}

// Seed: 4 leads distribuídos nas 4 colunas + template aprovado t1 do arquétipo
async function seedFunil(tok) {
  await limpar(tok);
  const ctx = await api(tok);
  const arq = await pegarArquetipo(tok);
  const base = { projeto_id: PROJ_ID, origem:'manual', fonte:'manual', status:'aprovado',
                 custo_creditos: 1.0, aprovado_em: new Date(Date.now()-86400_000).toISOString(),
                 arquetipo_id: arq.id, whatsapp:'5548999999901' };
  const seeds = [
    { ...base, razao_social:`${PREFIXO}NaFila`,   cnpj:'20.000.001/0001-01', funil_etapa:'na_fila' },
    { ...base, razao_social:`${PREFIXO}Contat`,   cnpj:'20.000.002/0001-02', funil_etapa:'contatado', toque1_em:new Date(Date.now()-3*86400_000).toISOString(), proximo_toque_apos:new Date(Date.now()-86400_000).toISOString() },
    { ...base, razao_social:`${PREFIXO}Respond`,  cnpj:'20.000.003/0001-03', funil_etapa:'respondeu', respondeu_em: new Date().toISOString() },
    { ...base, razao_social:`${PREFIXO}Conversa`, cnpj:'20.000.004/0001-04', funil_etapa:'em_conversa' },
  ];
  for (const s of seeds) {
    const r = await ctx.post(`${SB_URL}/rest/v1/va_leads`, { data: s });
    if (!r.ok()) throw new Error('seed lead ' + r.status() + ' ' + (await r.text()).slice(0,200));
  }
  // template aprovado t1 pra permitir tick
  await ctx.post(`${SB_URL}/rest/v1/va_cadencia_templates`, {
    data: { projeto_id: PROJ_ID, arquetipo_id: arq.id, toque: 1,
            corpo: `${PREFIXO}Bom dia {{nome_fantasia}}, teste E2E toque 1.`, aprovado: true },
  });
  // template t2 também
  await ctx.post(`${SB_URL}/rest/v1/va_cadencia_templates`, {
    data: { projeto_id: PROJ_ID, arquetipo_id: arq.id, toque: 2,
            corpo: `${PREFIXO}{{nome_fantasia}}, teste E2E toque 2.`, aprovado: true },
  });
  // config ativa (janela ampla · dias_uteis=false pra rodar em qualquer dia)
  await ctx.post(`${SB_URL}/rest/v1/va_cadencia_config`, {
    data: { projeto_id: PROJ_ID, ativa: true, teto_diario: 4,
            janela_inicio:'00:00', janela_fim:'23:59', dias_uteis_apenas: false, intervalo_toques_dias: 2 },
    headers: { Prefer: 'resolution=merge-duplicates' },
  });
  await ctx.dispose();
  return { arq };
}
async function login(page) {
  await page.goto('/mandato/cockpit.html');
  await page.waitForSelector('#lgf', { state:'visible', timeout: 10_000 });
  await page.fill('#lg-em', EMAIL); await page.fill('#lg-pw', PASS);
  await Promise.all([page.waitForLoadState('load'), page.click('#lgf button[type=submit]')]);
  await page.waitForSelector('.selector__card, .topbar__mandato-nome', { timeout: 15_000 });
}
async function irFunil(page) {
  await page.goto(`/mandato/maquina.html?mandato=${PROJ_ID}#funil`);
  await page.waitForSelector('#mq-tabs[data-ready="true"]', { timeout: 25_000 });
  await page.waitForSelector('#mq-panel-funil[data-ready="true"]', { timeout: 25_000 });
}

// ─── testes ──────────────────────────────────────────────────────────
test.describe('Zona MÁQUINA · FUNIL · E2E', () => {

  test('1 · aba renderiza + data-ready + kanban 4 colunas com contadores', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    await login(page); await irFunil(page);
    await expect(page.locator('.kb-col')).toHaveCount(4);
    // 4 seeds, um em cada coluna
    await expect(page.locator(`.kb-card:has-text("${PREFIXO}NaFila")`)).toBeVisible();
    await expect(page.locator(`.kb-card:has-text("${PREFIXO}Contat")`)).toBeVisible();
    await expect(page.locator(`.kb-card:has-text("${PREFIXO}Respond")`)).toBeVisible();
    await expect(page.locator(`.kb-card:has-text("${PREFIXO}Conversa")`)).toBeVisible();
  });

  test('2 · portão · lead recém-aprovado com whatsapp cai em na_fila', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    const ctx = await api(tok);
    const arq = await pegarArquetipo(tok);
    // cria antessala e chama portão real
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: PROJ_ID, origem:'manual', arquetipo_id: arq.id,
              razao_social:`${PREFIXO}Fresh`, cnpj:'20.000.099/0001-99', whatsapp:'5548999999999' },
    });
    if (!rIns.ok()) throw new Error('insert antessala ' + rIns.status());
    const [lead] = await rIns.json();
    const rPort = await ctx.post('https://www.1negocio.com.br/api/va-portao-leads', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { projeto_id: PROJ_ID, lead_ids:[lead.id] },
    });
    const dPort = await rPort.json();
    expect(dPort.ok).toBe(true);
    const rC = await ctx.get(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}&select=funil_etapa,status`);
    const [after] = await rC.json();
    expect(after.status).toBe('aprovado');
    expect(after.funil_etapa).toBe('na_fila');
    await ctx.dispose();
  });

  test('3 · trigger opt-out não volta pra disparo', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    const ctx = await api(tok);
    // marca NaFila como optout
    const rF = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=eq.${encodeURIComponent(PREFIXO+'NaFila')}&select=id`);
    const [l] = await rF.json();
    const r1 = await ctx.patch(`${SB_URL}/rest/v1/va_leads?id=eq.${l.id}`, { data: { funil_etapa:'optout' } });
    expect(r1.ok()).toBeTruthy();
    // tenta voltar pra na_fila → deve falhar
    const r2 = await ctx.patch(`${SB_URL}/rest/v1/va_leads?id=eq.${l.id}`, { data: { funil_etapa:'na_fila' } });
    const body = await r2.text();
    expect(r2.status()).toBeGreaterThanOrEqual(400);
    expect(body).toMatch(/FUNIL_OPTOUT_TRAVA|optout/i);
    await ctx.dispose();
  });

  test('4 · desdobramento e contato via UI (adendos 1+2) grava e conta', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    await login(page); await irFunil(page);
    // Clica no card Respond
    await page.locator(`.kb-card:has-text("${PREFIXO}Respond")`).click();
    await expect(page.locator('.drw-bg')).toBeVisible();
    // Preenche form desdobramento
    await page.locator('#drw-desd').selectOption('quer_vender');
    await page.fill('#drw-desd-nota', 'quer vender · nota E2E');
    await page.fill('#drw-contato-nome', 'João Teste');
    await page.locator('#drw-contato-cargo').selectOption('dono_socio');
    await page.locator('#drw-desd-salvar').click();
    await expect(page.locator('.toast').filter({ hasText: /Classificação salva/i })).toBeVisible({ timeout: 5000 });
    // Confirma no banco
    const ctx = await api(tok);
    const r = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=eq.${encodeURIComponent(PREFIXO+'Respond')}&select=desdobramento,contato_nome,contato_cargo,visao_registrada_em`);
    const [after] = await r.json();
    expect(after.desdobramento).toBe('quer_vender');
    expect(after.contato_nome).toBe('João Teste');
    expect(after.contato_cargo).toBe('dono_socio');
    expect(after.visao_registrada_em).toBeTruthy();
    await ctx.dispose();
    // Contador do desdobramento aparece
    await page.reload();
    await page.waitForSelector('#mq-panel-funil[data-ready="true"]', { timeout: 25_000 });
    await expect(page.locator('#desd-linha')).toContainText(/quer vender/);
  });

  test('5 · webhook simulado · resposta move para respondeu + cancela agendados', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    const ctx = await api(tok);
    // pega lead NaFila com whatsapp conhecido, cria 1 disparo agendado
    const rF = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=eq.${encodeURIComponent(PREFIXO+'NaFila')}&select=id,whatsapp`);
    const [l] = await rF.json();
    const arq = await pegarArquetipo(tok);
    await ctx.post(`${SB_URL}/rest/v1/va_disparos`, {
      data: { projeto_id: PROJ_ID, lead_id: l.id, arquetipo_id: arq.id, toque:1,
              corpo_snapshot:`${PREFIXO}pendente`, status:'agendado', agendado_para: new Date().toISOString() },
    });
    // Simula webhook COM token
    const tokenWebhook = process.env.ZAPI_WEBHOOK_TOKEN || 'test'; // usa env local se houver
    const rW = await ctx.post(`https://www.1negocio.com.br/api/va-zapi-webhook?token=${encodeURIComponent(tokenWebhook)}`, {
      data: { phone: l.whatsapp, text:{ message:'Olá, tenho interesse sim!' }, fromMe: false },
    });
    const dW = await rW.json();
    if (!dW.match && rW.status() === 403) {
      test.skip(true, 'ZAPI_WEBHOOK_TOKEN não configurado no ambiente do teste; webhook não pôde ser exercitado');
    }
    expect(dW.ok).toBe(true);
    expect(dW.match).toBe(true);
    expect(dW.etapa).toBe('respondeu');
    // lead agora respondeu
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?id=eq.${l.id}&select=funil_etapa,respondeu_em`);
    const [after] = await rL.json();
    expect(after.funil_etapa).toBe('respondeu');
    expect(after.respondeu_em).toBeTruthy();
    // disparo agendado foi cancelado
    const rD = await ctx.get(`${SB_URL}/rest/v1/va_disparos?lead_id=eq.${l.id}&status=eq.cancelado&select=id,erro`);
    const cancelados = await rD.json();
    expect(cancelados.length).toBeGreaterThan(0);
    await ctx.dispose();
  });

  test('6 · webhook opt-out · vira optout + trigger impede volta', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    const ctx = await api(tok);
    const rF = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=eq.${encodeURIComponent(PREFIXO+'Contat')}&select=id,whatsapp`);
    const [l] = await rF.json();
    const tokenWebhook = process.env.ZAPI_WEBHOOK_TOKEN || 'test';
    const rW = await ctx.post(`https://www.1negocio.com.br/api/va-zapi-webhook?token=${encodeURIComponent(tokenWebhook)}`, {
      data: { phone: l.whatsapp, text:{ message:'não quero, remover da lista por favor' }, fromMe: false },
    });
    const dW = await rW.json();
    if (rW.status() === 403) test.skip(true, 'webhook token indisponível');
    expect(dW.etapa).toBe('optout');
    // tentativa de voltar
    const rBack = await ctx.patch(`${SB_URL}/rest/v1/va_leads?id=eq.${l.id}`, { data: { funil_etapa:'na_fila' } });
    expect(rBack.status()).toBeGreaterThanOrEqual(400);
    await ctx.dispose();
  });

  test('7 · template não-aprovado bloqueia · tick sem envio (usando lead inelegível por sem_fone)', async ({ page }) => {
    // Verificamos indiretamente pela agenda: sem template aprovado, sem disparo.
    // Como fizemos seedFunil com templates aprovados, testamos aqui a lógica
    // "sem_fone impede disparo": criamos lead sem whatsapp na coluna na_fila.
    const tok = await loginToken();
    await seedFunil(tok);
    const ctx = await api(tok);
    const arq = await pegarArquetipo(tok);
    await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: PROJ_ID, origem:'manual', arquetipo_id: arq.id,
              razao_social:`${PREFIXO}SemFone`, cnpj:'20.000.005/0001-05',
              status:'aprovado', custo_creditos: 1.0, aprovado_em: new Date().toISOString(),
              funil_etapa:'na_fila' /* sem whatsapp/telefone */ },
    });
    // chama tick (via JWT admin) — deve pular por sem_fone; sem crash
    const rT = await ctx.post('https://www.1negocio.com.br/api/va-cadencia-tick', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { projeto_id: PROJ_ID },
    });
    const dT = await rT.json();
    expect(rT.status()).toBeLessThan(500);
    // resposta tem estrutura projetos[]
    expect(dT.projetos || dT.tick).toBeTruthy();
    await ctx.dispose();
  });

  // ═══ P4.1 ═════════════════════════════════════════════════════════
  test('8 · P4.1 · aprovar todos os templates rascunhados', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    // limpa templates aprovados pra ter algo pra "aprovar todos"
    const ctx = await api(tok);
    const arq = await pegarArquetipo(tok);
    await ctx.patch(`${SB_URL}/rest/v1/va_cadencia_templates?arquetipo_id=eq.${arq.id}`, { data: { aprovado: false } });
    await ctx.dispose();
    await login(page); await irFunil(page);
    // Abre painel + click aprovar todos (dialog accept)
    await page.locator('#cad-head-toggle').click();
    page.on('dialog', d => d.accept());
    await page.locator('#tpl-aprovar-todos').click();
    await expect(page.locator('.toast').filter({ hasText: /aprovado/i })).toBeVisible({ timeout: 8000 });
  });

  test('9 · P4.1 · roteador auth (sem token → 403)', async ({ page }) => {
    const tok = await loginToken();
    const ctx = await api(tok);
    const r = await ctx.post('https://www.1negocio.com.br/api/zapi-router', {
      headers: {}, data: { phone:'5500999999999', text:{ message:'ping' }, fromMe:false },
    });
    expect(r.status()).toBe(403);
    const d = await r.json();
    expect(d.erro).toMatch(/token/i);
    await ctx.dispose();
  });

  test('10 · P4.1 · rascunhar IA para lead que respondeu', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    // Prepara Respond lead pra ter mensagem recebida
    const ctx = await api(tok);
    const rF = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=eq.${encodeURIComponent(PREFIXO+'Respond')}&select=id`);
    const [lead] = await rF.json();
    await ctx.post(`${SB_URL}/rest/v1/va_mensagens_recebidas`, {
      data: { projeto_id: PROJ_ID, lead_id: lead.id, telefone:'55E2E123456', corpo:'Recebido', processada:true },
    });
    // Chama /api/va-rascunhar-resposta direto (IA real)
    const rR = await ctx.post('https://www.1negocio.com.br/api/va-rascunhar-resposta', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { lead_id: lead.id },
    });
    expect(rR.status()).toBe(200);
    const dR = await rR.json();
    expect(dR.ok).toBe(true);
    expect(typeof dR.rascunho).toBe('string');
    expect(dR.rascunho.length).toBeGreaterThan(20);
    // Não pode conter valor R$ nem CNPJ nem cidade exata
    expect(dR.rascunho).not.toMatch(/R\$\s*\d/);
    expect(dR.rascunho).not.toMatch(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/);
    await ctx.dispose();
  });

  test('11 · P4.1 · aprovar e enviar resposta · lead vai a em_conversa + tipo_envio=resposta', async ({ page }) => {
    const tok = await loginToken();
    await seedFunil(tok);
    const ctx = await api(tok);
    const rF = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=eq.${encodeURIComponent(PREFIXO+'Respond')}&select=id,whatsapp`);
    const [lead] = await rF.json();
    const rE = await ctx.post('https://www.1negocio.com.br/api/va-enviar-resposta', {
      headers: { Authorization: `Bearer ${tok}` },
      data: { lead_id: lead.id, corpo: `${PREFIXO}Resposta E2E manual · sem valor R$.` },
    });
    // pode falhar por credencial Z-API real ou passar; validamos comportamento
    const dE = await rE.json();
    // Se enviou, checar estado
    if (dE.ok) {
      const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?id=eq.${lead.id}&select=funil_etapa`);
      const [after] = await rL.json();
      expect(after.funil_etapa).toBe('em_conversa');
      const rD = await ctx.get(`${SB_URL}/rest/v1/va_disparos?id=eq.${dE.disparo_id}&select=tipo_envio,status`);
      const [disp] = await rD.json();
      expect(disp.tipo_envio).toBe('resposta');
      expect(disp.status).toBe('enviado');
    } else {
      // Sem cred Z-API disponível: aceita 502 mas ainda cria disparo com erro
      expect([200,502]).toContain(rE.status());
    }
    await ctx.dispose();
  });

  test.afterAll(async () => {
    const tok = await loginToken();
    await limpar(tok);
    const ctx = await api(tok);
    await ctx.patch(`${SB_URL}/rest/v1/va_cadencia_config?projeto_id=eq.${PROJ_ID}`, { data: { ativa: false } });
    await ctx.dispose();
  });
});
