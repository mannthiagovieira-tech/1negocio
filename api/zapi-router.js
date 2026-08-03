// /api/zapi-router · Vercel Function
// P4.1 · roteador único de webhook Z-API. Recebe POST do painel e
// FAN-OUT idêntico (mesmo body cru) para 2 destinos:
//   (a) hermes-webhook (edge legada · Supabase Functions) · fire-and-forget
//   (b) /api/va-zapi-webhook (interno · MANDATO)
//
// Segurança: token via query ?token= ou header x-webhook-token contra
// ZAPI_WEBHOOK_TOKEN. Repassa o token pros 2 destinos internos.
//
// Retorna 200 mesmo se um destino falhar (não devolve 5xx pro Z-API,
// que faria retry infinito). Log estruturado no response por destino.

const HERMES_URL = 'https://dbijmgqlcrgjlcfrastg.supabase.co/functions/v1/hermes-webhook';
const VA_WEBHOOK_URL = 'https://www.1negocio.com.br/api/va-zapi-webhook';
const HERMES_TIMEOUT_MS = 4000;   // fire-and-forget curto pra hermes
const VA_TIMEOUT_MS     = 8000;   // interno tem mais folga

const WEBHOOK_TOKEN = process.env.ZAPI_WEBHOOK_TOKEN;
const SB_SRK        = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, code, body) {
  res.status(code).setHeader('Content-Type','application/json');
  res.send(JSON.stringify(body));
}
async function lerBodyBruto(req) {
  if (req.body != null) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const c = []; for await (const x of req) c.push(x);
  return Buffer.concat(c).toString('utf8');
}
async function encaminhar(url, bodyRaw, extraHeaders, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const inicio = Date.now();
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: bodyRaw,
      signal: controller.signal,
    });
    const dur = Date.now() - inicio;
    let sample = '';
    try { sample = (await r.text()).slice(0, 200); } catch {}
    return { ok: r.ok, status: r.status, dur_ms: dur, sample };
  } catch (e) {
    return { ok: false, dur_ms: Date.now() - inicio, erro: String(e?.message || e).slice(0, 200) };
  } finally { clearTimeout(t); }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { ok:false });

  // Auth
  const qToken = new URL(req.url, 'http://x').searchParams.get('token');
  const hToken = req.headers['x-webhook-token'];
  if (!WEBHOOK_TOKEN || (qToken !== WEBHOOK_TOKEN && hToken !== WEBHOOK_TOKEN)) {
    return json(res, 403, { ok:false, erro:'token inválido' });
  }

  // Corpo cru pra repasse fiel
  const bodyRaw = await lerBodyBruto(req);

  // Fan-out em paralelo
  const [rHermes, rVa] = await Promise.all([
    encaminhar(
      HERMES_URL, bodyRaw,
      // Hermes-webhook (edge Supabase) exige Authorization: Bearer <SRK>
      // pra passar pelo gateway das Functions. Sem Client-Token específico.
      SB_SRK ? { Authorization: `Bearer ${SB_SRK}` } : {},
      HERMES_TIMEOUT_MS,
    ),
    encaminhar(
      // repassa o token via query pro webhook MANDATO (mesmo padrão do painel)
      `${VA_WEBHOOK_URL}?token=${encodeURIComponent(WEBHOOK_TOKEN)}`,
      bodyRaw,
      {},
      VA_TIMEOUT_MS,
    ),
  ]);

  return json(res, 200, {
    ok: true,
    fanout: { hermes: rHermes, va_mandato: rVa },
  });
};
