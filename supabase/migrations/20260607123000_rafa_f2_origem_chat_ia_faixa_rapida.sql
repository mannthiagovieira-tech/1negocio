-- F2 · permite origem 'chat_ia_faixa_rapida' em anuncios_v2.
-- Marca rascunhos vindos da faixa rápida (chat-ia) pra distinguir de anúncio real depois.
ALTER TABLE public.anuncios_v2 DROP CONSTRAINT IF EXISTS anuncios_v2_origem_check;
ALTER TABLE public.anuncios_v2 ADD CONSTRAINT anuncios_v2_origem_check
  CHECK (origem = ANY (ARRAY['cliente','povoamento_inicial','parceiro_indicacao','maquininha_teste','chat_ia_faixa_rapida']));
