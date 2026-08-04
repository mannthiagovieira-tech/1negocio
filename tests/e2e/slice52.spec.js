// @ts-check
// P5.2 · contrato do público · E2E · 3 asserções.
const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';
const PROJ_ID = 'b676073a-6074-48d4-a608-7947de006dff';

test.beforeAll(() => { if (!EMAIL || !PASS) throw new Error('E2E_EMAIL/E2E_PASS obrigatórios'); });

async function loginToken() {
  const ctx = await pwrequest.newContext();
  const r = await ctx.post(`${SB_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SB_ANON, 'Content-Type':'application/json' },
    data: { email: EMAIL, password: PASS },
  });
  const d = await r.json(); await ctx.dispose(); return d.access_token;
}

test.describe('P5.2 · contrato público', () => {

  test('1 · publicar-campanha 422 quando geo ausente', async () => {
    const tok = await loginToken();
    // Cria campanha aprovada sem geo
    const ctx = await pwrequest.newContext({ extraHTTPHeaders: { apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json', Prefer:'return=representation' } });
    const rCri = await ctx.get(`${SB_URL}/rest/v1/va_criativos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id,arquetipo_id`);
    const [cri] = await rCri.json();
    test.skip(!cri, 'sem criativo aprovado no Arte Deli');
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_campanhas`, {
      data: { projeto_id: PROJ_ID, criativo_id: cri.id, arquetipo_id: cri.arquetipo_id,
              nome: 'E2E52·sem_geo', plataforma:'meta', objetivo_meta:'ctwa', objetivo:'ctwa',
              publico: { idade_min: 30, idade_max: 60 }, // geo ausente
              orcamento_diario: 30, orcamento_total: 30, status:'aprovada' },
    });
    const [cmp] = await rIns.json();
    const rPub = await ctx.post('https://www.1negocio.com.br/api/va-publicar-campanha', {
      data: { campanha_id: cmp.id, dry_run: true },
    });
    expect(rPub.status()).toBe(422);
    const d = await rPub.json();
    expect(d.erro).toBe('contrato_publico_invalido');
    expect(Array.isArray(d.validacoes)).toBe(true);
    await ctx.delete(`${SB_URL}/rest/v1/va_campanhas?id=eq.${cmp.id}`);
    await ctx.dispose();
  });

  test('2 · dry_run traduz contrato → targeting_spec real do Meta', async () => {
    const tok = await loginToken();
    const ctx = await pwrequest.newContext({ extraHTTPHeaders: { apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json', Prefer:'return=representation' } });
    const rCri = await ctx.get(`${SB_URL}/rest/v1/va_criativos?projeto_id=eq.${PROJ_ID}&status=eq.aprovado&limit=1&select=id,arquetipo_id`);
    const [cri] = await rCri.json();
    test.skip(!cri, 'sem criativo aprovado');
    const publico = {
      geo: { modo: 'ufs', ufs: ['RJ','SP'] },
      idade_min: 35, idade_max: 60, genero: 'todos',
      interesses: [{ meta_id: '6003107902433', nome: 'Empreendedorismo' }],
      advantage_detailed: true,
    };
    const rIns = await ctx.post(`${SB_URL}/rest/v1/va_campanhas`, {
      data: { projeto_id: PROJ_ID, criativo_id: cri.id, arquetipo_id: cri.arquetipo_id,
              nome: 'E2E52·spec', plataforma:'meta', objetivo_meta:'ctwa', objetivo:'ctwa',
              publico, orcamento_diario: 30, orcamento_total: 30, status:'aprovada' },
    });
    const [cmp] = await rIns.json();
    const rPub = await ctx.post('https://www.1negocio.com.br/api/va-publicar-campanha', {
      data: { campanha_id: cmp.id, dry_run: true },
    });
    expect(rPub.ok()).toBeTruthy();
    const d = await rPub.json();
    expect(d.targeting_spec).toBeTruthy();
    expect(d.targeting_spec.geo_locations.regions).toHaveLength(2);
    expect(d.targeting_spec.age_min).toBe(35);
    expect(d.targeting_spec.age_max).toBe(60);
    expect(d.targeting_spec.flexible_spec[0].interests).toHaveLength(1);
    expect(d.targeting_spec.targeting_automation.advantage_audience).toBe(1);
    await ctx.delete(`${SB_URL}/rest/v1/va_campanhas?id=eq.${cmp.id}`);
    await ctx.dispose();
  });

  test('3 · endpoint meta-buscar responde (503 se sem token, 200 se OK)', async () => {
    const tok = await loginToken();
    const ctx = await pwrequest.newContext({ extraHTTPHeaders: { apikey: SB_ANON, Authorization:'Bearer '+tok, 'Content-Type':'application/json' } });
    const r = await ctx.post('https://www.1negocio.com.br/api/va-meta-buscar', {
      data: { type: 'adinterest', q: 'empreendedorismo' },
    });
    // Aceita 200 (token OK · devolve sugestões) OU 503 (token ausente)
    expect([200, 503]).toContain(r.status());
    const d = await r.json();
    if (r.status() === 200) expect(Array.isArray(d.sugestoes)).toBe(true);
    else expect(d.erro).toMatch(/META_ACCESS_TOKEN/);
    await ctx.dispose();
  });

});
