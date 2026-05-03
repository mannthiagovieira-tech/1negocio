import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function gerarCodigoLead(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let cod = 'L';
  for (let i = 0; i < 5; i++) cod += chars[Math.floor(Math.random() * chars.length)];
  return cod;
}

Deno.serve(async (req: Request) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { nome, nome_negocio } = await req.json();

    if (!nome || !nome_negocio) {
      return new Response(JSON.stringify({ error: 'nome e nome_negocio obrigatórios' }), { status: 400, headers: cors });
    }

    // Gerar código único
    let codigo_lead = '';
    for (let t = 0; t < 10; t++) {
      const c = gerarCodigoLead();
      const { data } = await supabase.from('leads_entrada').select('id').eq('codigo_lead', c).single();
      if (!data) { codigo_lead = c; break; }
    }

    const { error } = await supabase.from('leads_entrada').insert({ nome, nome_negocio, codigo_lead });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, codigo_lead }), { headers: cors });

  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
