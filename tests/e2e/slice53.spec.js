// @ts-check
// P5.3 · trava de orçamento · E2E · 3 asserções.
const { test, expect, request: pwrequest } = require('@playwright/test');

const EMAIL = process.env.E2E_EMAIL;
const PASS  = process.env.E2E_PASS;
const SB_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA';

test.beforeAll(() => { if (!EMAIL || !PASS) throw new Error('E2E_EMAIL/E2E_PASS obrigatórios'); });
async function loginToken() {
  const ctx = await pwrequest.newContext();
  const r = await ctx.post(`${SB_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SB_ANON, 'Content-Type':'application/json' },
    data: { email: EMAIL, password: PASS },
  });
  const d = await r.json(); await ctx.dispose(); return d.access_token;
}
async function api(tok) {
  return pwrequest.newContext({
    extraHTTPHeaders: { apikey: SB_ANON, Authorization: `Bearer ${tok}`, 'Content-Type':'application/json', Prefer:'return=representation' },
  });
}

test.describe('P5.3 · trava de orçamento', () => {

  test('1 · va_saldo_ciclo retorna estrutura completa', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    const r = await ctx.post(`${SB_URL}/rest/v1/rpc/va_saldo_ciclo`, { data: { p_projeto: 'b676073a-6074-48d4-a608-7947de006dff' } });
    expect(r.ok()).toBeTruthy();
    const d = await r.json();
    expect(typeof d.credito).toBe('number');
    expect(typeof d.consumido).toBe('number');
    expect(typeof d.saldo).toBe('number');
    expect(d.ciclo_de).toBeTruthy();
    expect(d.ciclo_ate).toBeTruthy();
    await ctx.dispose();
  });

  test('2 · va_debitar_seguro bloqueia com CREDITO_CICLO_ESGOTADO quando saldo <= 0', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    // Cria projeto fake com credito_ciclo=1 e força consumo pra zerar
    const rInsP = await ctx.post(`${SB_URL}/rest/v1/va_projetos`, {
      data: { cliente_nome:'E2E53', negocio_titulo:'E2E53 credito zerado', codigo:'E2E53', status:'ativo',
              credito_ciclo: 1.0, ciclo_inicio: new Date().toISOString().slice(0,10) },
    });
    const [pj] = await rInsP.json();
    // Consome R$ 1 (limite exato → saldo=0)
    await ctx.post(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
      data: { p_projeto: pj.id, p_tipo: 'ia_geracao_criativo', p_qtd: 1, p_referencia: 'E2E53 zerar', p_ciclo: null, p_excedente_autorizado: false },
    });
    // Segunda tentativa deve estourar
    const r2 = await ctx.post(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
      data: { p_projeto: pj.id, p_tipo: 'ia_geracao_criativo', p_qtd: 1, p_referencia: 'E2E53 estouro', p_ciclo: null, p_excedente_autorizado: false },
    });
    expect(r2.ok()).toBeFalsy();
    const err = await r2.text();
    expect(err).toMatch(/CREDITO_CICLO_ESGOTADO/);
    // Excedente autorizado deve passar
    const r3 = await ctx.post(`${SB_URL}/rest/v1/rpc/va_debitar_seguro`, {
      data: { p_projeto: pj.id, p_tipo: 'ia_geracao_criativo', p_qtd: 1, p_referencia: 'E2E53 forçado', p_ciclo: null, p_excedente_autorizado: true },
    });
    expect(r3.ok()).toBeTruthy();
    const d3 = await r3.json();
    expect(d3.excedente_autorizado).toBe(true);
    // Confirma que gravou com prefixo [EXCEDENTE_AUTORIZADO]
    const rRaz = await ctx.get(`${SB_URL}/rest/v1/va_projeto_razao?projeto_id=eq.${pj.id}&referencia=like.*EXCEDENTE_AUTORIZADO*&select=referencia`);
    const razoes = await rRaz.json();
    expect(razoes.length).toBeGreaterThanOrEqual(1);
    // Cleanup
    await ctx.delete(`${SB_URL}/rest/v1/va_projeto_razao?projeto_id=eq.${pj.id}`);
    await ctx.delete(`${SB_URL}/rest/v1/va_projetos?id=eq.${pj.id}`);
    await ctx.dispose();
  });

  test('3 · /api/va-publicar-campanha 402 quando orcamento_total > saldo', async () => {
    const tok = await loginToken();
    const ctx = await api(tok);
    const rInsP = await ctx.post(`${SB_URL}/rest/v1/va_projetos`, {
      data: { cliente_nome:'E2E53b', negocio_titulo:'E2E53 orc excede', codigo:'E2E53b', status:'ativo',
              credito_ciclo: 10.0, ciclo_inicio: new Date().toISOString().slice(0,10) },
    });
    const [pj] = await rInsP.json();
    // Cria criativo aprovado dummy
    const rC = await ctx.post(`${SB_URL}/rest/v1/va_criativos`, {
      data: { projeto_id: pj.id, nome:'E2E53 cri', tipo:'estatico', formato:'feed_1080', layout:'tipografico_a',
              status:'aprovado', origem:'manual', headline:'T', texto:'T', cta:'V', png_path: `${pj.id}/dummy.png` },
    });
    const [cri] = await rC.json();
    // Cria campanha aprovada com orcamento_total=100 (excede saldo 10)
    const rCmp = await ctx.post(`${SB_URL}/rest/v1/va_campanhas`, {
      data: { projeto_id: pj.id, criativo_id: cri.id, nome:'E2E53 cmp', plataforma:'meta', objetivo:'ctwa', objetivo_meta:'ctwa',
              publico: { geo: { modo:'ufs', ufs:['RJ'] }, idade_min:30, idade_max:60, advantage_detailed:true },
              orcamento_diario: 10, orcamento_total: 100, status:'aprovada' },
    });
    const [cmp] = await rCmp.json();
    const rPub = await ctx.post('https://www.1negocio.com.br/api/va-publicar-campanha', {
      data: { campanha_id: cmp.id, dry_run: true },
    });
    expect(rPub.status()).toBe(402);
    const d = await rPub.json();
    expect(d.erro).toBe('orcamento_excede_saldo');
    expect(d.debito_previsto).toBe(150); // 100 × 1,5
    // Cleanup
    await ctx.delete(`${SB_URL}/rest/v1/va_campanhas?id=eq.${cmp.id}`);
    await ctx.delete(`${SB_URL}/rest/v1/va_criativos?id=eq.${cri.id}`);
    await ctx.delete(`${SB_URL}/rest/v1/va_projetos?id=eq.${pj.id}`);
    await ctx.dispose();
  });

});
