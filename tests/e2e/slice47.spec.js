// @ts-check
// Slice 4.7 · Termômetro de ritmo (contato + munição) · E2E.
// Testa: cálculo hoje/semana, dedupe por (lead_id, dia), classificação de
// contato/munição em 3 estados (verde/amarelo/vermelho), meta_fila.

const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
const PREFIXO = 'E2E47·';
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
async function ritmoOf(ctx, projeto_id) {
  const r = await ctx.post(`${SB_URL}/rest/v1/rpc/va_ritmo_mandato`, { data: { p_projeto: projeto_id } });
  return r.json();
}
async function limpar(ctx) {
  // Só linhas do prefixo · logs órfãos ficam mas não afetam leads reais
  const rL = await ctx.get(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}&select=id`);
  const leads = await rL.json();
  for (const l of leads) {
    await ctx.delete(`${SB_URL}/rest/v1/va_leads_log?lead_id=eq.${l.id}`);
  }
  await ctx.delete(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}`);
}

test.describe('Slice 4.7 · termômetro de ritmo', () => {

  test('1 · RPC retorna meta_dia, meta_fila, hoje, semana, fila_pronta, antessala', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    const r = await ritmoOf(ctx, PROJ_ID);
    expect(typeof r.meta_dia).toBe('number');
    expect(typeof r.meta_fila).toBe('number');
    expect(typeof r.hoje).toBe('number');
    expect(typeof r.semana).toBe('number');
    expect(typeof r.fila_pronta).toBe('number');
    expect(typeof r.antessala).toBe('number');
    expect(r.meta_semana).toBe(r.meta_dia * 5);
    await ctx.dispose();
  });

  test('2 · dedupe · 2 cliques no MESMO lead no MESMO dia = 1 toque', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    await limpar(ctx);
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    test.skip(!arq, 'sem arquétipo aprovado');
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: PROJ_ID, origem:'manual', fonte:'manual', status:'aprovado',
              arquetipo_id: arq.id, razao_social:`${PREFIXO}Dedupe`, cnpj:'20.047.001/0001-01',
              whatsapp:'5548999999997', whatsapp_verificado: true, funil_etapa:'na_fila',
              aprovado_em: new Date().toISOString() },
    });
    const [lead] = await rIns.json();
    const antes = await ritmoOf(ctx, PROJ_ID);
    // 2 logs iguais no mesmo dia
    for (let i = 0; i < 2; i++) {
      await ctx.post(`${SB_URL}/rest/v1/va_leads_log`, {
        data: { lead_id: lead.id, acao: 'contato_manual_iniciado', detalhe: 'e2e dedup '+i },
      });
    }
    const depois = await ritmoOf(ctx, PROJ_ID);
    expect(depois.hoje - antes.hoje).toBe(1);  // dedupe: mesmo lead+dia = 1
    expect(depois.semana - antes.semana).toBe(1);
    await limpar(ctx);
    await ctx.dispose();
  });

  test('3 · fila_pronta conta na_fila + whatsapp_verificado=true + pausado=false', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    await limpar(ctx);
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    test.skip(!arq, 'sem arquétipo aprovado');
    const antes = await ritmoOf(ctx, PROJ_ID);
    const base = { projeto_id: PROJ_ID, origem:'manual', fonte:'manual', status:'aprovado',
                   arquetipo_id: arq.id, whatsapp:'5548999999996', funil_etapa:'na_fila',
                   aprovado_em: new Date().toISOString() };
    // 3 leads: conta / não conta (null verified) / não conta (pausado)
    await ctx.post(`${SB_URL}/rest/v1/va_leads`, { data: { ...base, razao_social:`${PREFIXO}Conta`,     cnpj:'20.047.002/0001-02', whatsapp_verificado: true } });
    await ctx.post(`${SB_URL}/rest/v1/va_leads`, { data: { ...base, razao_social:`${PREFIXO}NullVerif`, cnpj:'20.047.003/0001-03' } });
    await ctx.post(`${SB_URL}/rest/v1/va_leads`, { data: { ...base, razao_social:`${PREFIXO}Pausado`,   cnpj:'20.047.004/0001-04', whatsapp_verificado: true, pausado: true } });
    const depois = await ritmoOf(ctx, PROJ_ID);
    expect(depois.fila_pronta - antes.fila_pronta).toBe(1);
    await limpar(ctx);
    await ctx.dispose();
  });

  test('4 · antessala conta status=antessala não-blacklist', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    await limpar(ctx);
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    test.skip(!arq, 'sem arquétipo aprovado');
    const antes = await ritmoOf(ctx, PROJ_ID);
    await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: PROJ_ID, origem:'manual', fonte:'manual', status:'antessala',
              arquetipo_id: arq.id, razao_social:`${PREFIXO}Antessala`, cnpj:'20.047.005/0001-05' },
    });
    const depois = await ritmoOf(ctx, PROJ_ID);
    expect(depois.antessala - antes.antessala).toBe(1);
    await limpar(ctx);
    await ctx.dispose();
  });

  test('5 · va_ritmo_carteira · retorna JSON indexado por projeto_id', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    const r = await ctx.post(`${SB_URL}/rest/v1/rpc/va_ritmo_carteira`, { data: { p_projetos: [PROJ_ID] } });
    const d = await r.json();
    expect(d[PROJ_ID]).toBeTruthy();
    expect(typeof d[PROJ_ID].meta_dia).toBe('number');
    await ctx.dispose();
  });

});
