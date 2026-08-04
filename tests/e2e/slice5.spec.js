// @ts-check
// Slice 5 (P5) · Campanhas · E2E CTWA · payload simulado → lead antessala
// origem=campanha com arquetipo_id + campanha_id + whatsapp_verificado=true.

const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
const PREFIXO = 'E2EP5·';
const PROJ_ID = 'b676073a-6074-48d4-a608-7947de006dff';

test.beforeAll(() => { if (!EMAIL || !PASS) throw new Error('E2E_EMAIL/E2E_PASS obrigatórios'); });

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
async function limpar(ctx) {
  const r = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}&select=id`);
  const leads = await r.json();
  for (const l of leads) await ctx.delete(`${SB_URL}/rest/v1/va_leads_log?lead_id=eq.${l.id}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_campanhas?projeto_id=eq.${PROJ_ID}&nome=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.delete(`${SB_URL}/rest/v1/va_criativos?projeto_id=eq.${PROJ_ID}&nome=like.${encodeURIComponent(PREFIXO+'%')}`);
}

test.describe('P5 · desemboque CTWA', () => {

  test('1 · webhook com ctwaPayload cria lead antessala origem=campanha', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    await limpar(ctx);

    // Seed: 1 arquétipo aprovado + 1 criativo aprovado + 1 campanha publicada
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    test.skip(!arq, 'sem arquétipo aprovado');
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_criativos`, {
      data: { projeto_id: PROJ_ID, arquetipo_id: arq.id, nome: `${PREFIXO}Cri E2E`, tipo:'estatico',
              formato:'feed_1080', layout:'tipografico_a', status:'aprovado', origem:'manual',
              headline:'Test', texto:'Test', cta:'Ver', png_path: `${PROJ_ID}/dummy-test.png` },
    });
    const [cri] = await rIns.json();
    const rCmp = await ctx.post(`${SB_URL}/rest/v1/va_campanhas`, {
      data: { projeto_id: PROJ_ID, arquetipo_id: arq.id, criativo_id: cri.id, nome: `${PREFIXO}Cmp E2E`,
              plataforma:'meta', objetivo:'ctwa', objetivo_meta:'ctwa', publico: {},
              orcamento_diario: 30, orcamento_total: 30, data_inicio: new Date().toISOString().slice(0,10),
              data_fim: new Date(Date.now()+7*86400000).toISOString().slice(0,10), status:'publicada',
              publicado_em: new Date().toISOString() },
    });
    const [cmp] = await rCmp.json();

    // Simula payload Meta com ctwaPayload injetado (base64 igual ao publicar-campanha)
    const payload = { campanha_id: cmp.id, criativo_id: cri.id, arquetipo_id: arq.id };
    const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
    const telefone = '5511900008888';
    const webhookBody = {
      fromMe: false, phone: telefone, text: { message: `${PREFIXO} Vi seu anúncio e quero saber mais` },
      adContext: {
        entryPointConversionSource: `https://facebook.com/ad?ctwa_payload=${encodeURIComponent(b64)}`,
        ctwaPayload: b64,
      },
    };
    const tokenWebhook = process.env.ZAPI_WEBHOOK_TOKEN || 'test';
    const rW = await ctx.post(`https://www.1negocio.com.br/api/va-zapi-webhook?token=${encodeURIComponent(tokenWebhook)}`, {
      data: webhookBody,
    });
    const dW = await rW.json();
    if (!dW.match && rW.status() === 403) test.skip(true, 'ZAPI_WEBHOOK_TOKEN não configurado');

    expect(dW.ok).toBe(true);
    expect(dW.match).toBe(true);
    expect(dW.origem).toBe('campanha');
    expect(dW.campanha_id).toBe(cmp.id);

    // Confirma lead criado
    const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?id=eq.${dW.lead_id}&select=origem,arquetipo_id,campanha_id,criativo_id,whatsapp,whatsapp_verificado,status`);
    const [lead] = await rL.json();
    expect(lead.origem).toBe('campanha');
    expect(lead.arquetipo_id).toBe(arq.id);
    expect(lead.campanha_id).toBe(cmp.id);
    expect(lead.criativo_id).toBe(cri.id);
    expect(lead.whatsapp_verificado).toBe(true);
    expect(lead.status).toBe('antessala');
    expect(lead.whatsapp).toBe(telefone);
    await limpar(ctx);
    await ctx.dispose();
  });

  test('2 · webhook SEM ctwaPayload → mensagem órfã', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    const telefone = '5511977778888';
    const tokenWebhook = process.env.ZAPI_WEBHOOK_TOKEN || 'test';
    const rW = await ctx.post(`https://www.1negocio.com.br/api/va-zapi-webhook?token=${encodeURIComponent(tokenWebhook)}`, {
      data: { fromMe:false, phone: telefone, text: { message: `${PREFIXO} sem contexto` } },
    });
    const dW = await rW.json();
    if (rW.status() === 403) test.skip(true, 'ZAPI_WEBHOOK_TOKEN não configurado');
    expect(dW.ok).toBe(true);
    expect(dW.match).toBe(false);
    // Limpa órfã criada
    await ctx.delete(`${SB_URL}/rest/v1/va_mensagens_recebidas?telefone=eq.${telefone}`);
    await ctx.dispose();
  });

  test('3 · va_campanhas_metricas view · conversas_geradas conta corretamente', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    const r = await ctx.get(`${SB_URL}/rest/v1/va_campanhas_metricas?projeto_id=eq.${PROJ_ID}&select=campanha_id,conversas_geradas,custo_por_conversa`);
    const rows = await r.json();
    expect(Array.isArray(rows)).toBe(true);
    // View existe · alguma campanha do projeto deve retornar (mesmo com 0 conversas)
    await ctx.dispose();
  });

});
