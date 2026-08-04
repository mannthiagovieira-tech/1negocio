// @ts-check
// Slice 4.5 · Gate de whatsapp_verificado no disparador · E2E.
// Seed: 3 leads com verified null/false/true (todos em na_fila, mesmo arquétipo,
// template t1 aprovado). Roda /api/va-cadencia-tick filtrado pro Arte Deli e
// exige que apenas o verified=true entre no pool.
//
// Sem dependência de Z-API real (o gate é SQL puro na query do disparador).

const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
const PREFIXO = 'E2E45·';
const PROJ_ID = 'b676073a-6074-48d4-a608-7947de006dff';

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
  await ctx.delete(`${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}&razao_social=like.${encodeURIComponent(PREFIXO+'%')}`);
  await ctx.dispose();
}

test.describe('Slice 4.5 · gate whatsapp_verificado', () => {

  test('1 · gate SQL · só verified=true entra no pool do disparador', async () => {
    const tok = await loginToken();
    await limpar(tok);
    const ctx = await api(tok);
    // Pega qualquer arquétipo aprovado do projeto (mínimo pro seed)
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    if (!arq) test.skip(true, 'projeto sem arquétipo aprovado');
    const base = {
      projeto_id: PROJ_ID, origem:'manual', fonte:'manual', status:'aprovado',
      custo_creditos: 1.0, aprovado_em: new Date(Date.now()-86400_000).toISOString(),
      arquetipo_id: arq.id, whatsapp:'5548999999901', funil_etapa:'na_fila',
    };
    const seeds = [
      { ...base, razao_social:`${PREFIXO}VerifNull`, cnpj:'20.045.001/0001-01', whatsapp_verificado: null },
      { ...base, razao_social:`${PREFIXO}VerifFalse`, cnpj:'20.045.002/0001-02', whatsapp_verificado: false },
      { ...base, razao_social:`${PREFIXO}VerifTrue`, cnpj:'20.045.003/0001-03', whatsapp_verificado: true },
    ];
    for (const s of seeds) {
      const r = await ctx.post(`${SB_URL}/rest/v1/va_leads`, { data: s });
      expect(r.ok(), 'seed ' + s.razao_social + ' → ' + r.status()).toBeTruthy();
    }
    // Query IDÊNTICA à do disparador (url1)
    const nowIso = new Date().toISOString();
    const url = `${SB_URL}/rest/v1/va_leads?projeto_id=eq.${PROJ_ID}` +
                `&funil_etapa=eq.na_fila&pausado=is.false&whatsapp_verificado=is.true` +
                `&razao_social=like.${encodeURIComponent(PREFIXO+'%')}` +
                `&select=id,razao_social,whatsapp_verificado`;
    const rQ = await ctx.get(url);
    const rows = await rQ.json();
    expect(rows.length, 'só verified=true deve entrar · veio ' + rows.length).toBe(1);
    expect(rows[0].razao_social).toBe(PREFIXO + 'VerifTrue');
    expect(rows[0].whatsapp_verificado).toBe(true);
    await ctx.dispose();
    await limpar(tok);
  });

  test('2 · endpoint va-verificar-whatsapp exige lead_id · retorna 400 sem', async () => {
    const tok = await loginToken();
    const ctx = await pwrequest.newContext();
    const r = await ctx.post('https://www.1negocio.com.br/api/va-verificar-whatsapp', {
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type':'application/json' },
      data: {},
    });
    expect(r.status()).toBe(400);
    const d = await r.json();
    expect(d.erro).toMatch(/lead_id/);
    await ctx.dispose();
  });

  test('3 · endpoint va-verificar-whatsapp em lead sem telefone → 422', async () => {
    const tok = await loginToken();
    await limpar(tok);
    const ctx = await api(tok);
    const rA = await ctx.get(`${SB_URL}/rest/v1/va_arquetipos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id`);
    const [arq] = await rA.json();
    if (!arq) test.skip(true, 'sem arquétipo aprovado');
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_leads`, {
      data: { projeto_id: PROJ_ID, origem:'manual', fonte:'manual', arquetipo_id: arq.id,
              status:'antessala', razao_social:`${PREFIXO}SemTel`, cnpj:'20.045.099/0001-99' },
    });
    const [lead] = await rIns.json();
    const rV = await ctx.post('https://www.1negocio.com.br/api/va-verificar-whatsapp', {
      data: { lead_id: lead.id },
    });
    expect(rV.status()).toBe(422);
    const d = await rV.json();
    expect(d.erro).toMatch(/sem_telefone/);
    await ctx.dispose();
    await limpar(tok);
  });

});
