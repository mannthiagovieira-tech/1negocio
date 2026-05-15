-- BLOCO 1 · migração auth OTP-only · schema banco
-- Aplicado via Supabase MCP em 2026-05-07. Este arquivo existe pra git history.
-- Tag de checkpoint: pre-auth-otp-v6

-- D1 · usuarios · telefone validado + tags
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS telefone_validado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- D2 · backfill tag 'vendedor' (DML idempotente)
UPDATE public.usuarios SET tags = array_append(tags, 'vendedor')
WHERE id IN (
  SELECT DISTINCT vendedor_id FROM public.negocios
  WHERE vendedor_id IS NOT NULL
)
AND NOT ('vendedor' = ANY(COALESCE(tags, '{}'::text[])));

-- D3 · teses_investimento · titulo (codigo + usuario_id já existem)
ALTER TABLE public.teses_investimento
  ADD COLUMN IF NOT EXISTS titulo TEXT;

-- D4 · função de próximo código sequencial (T-NNNN zero-padded)
CREATE OR REPLACE FUNCTION public.proximo_codigo_tese()
RETURNS TEXT AS $$
DECLARE
  proximo_num INT;
  novo_codigo TEXT;
BEGIN
  SELECT COALESCE(
    MAX(CAST(SUBSTRING(codigo FROM 'T-(\d+)') AS INT)),
    0
  ) + 1
  INTO proximo_num
  FROM public.teses_investimento
  WHERE codigo ~ '^T-\d+$';

  IF proximo_num < 10000 THEN
    novo_codigo := 'T-' || LPAD(proximo_num::TEXT, 4, '0');
  ELSE
    novo_codigo := 'T-' || proximo_num::TEXT;
  END IF;

  RETURN novo_codigo;
END;
$$ LANGUAGE plpgsql;

-- D5 · trigger BEFORE INSERT preenche codigo se vazio
CREATE OR REPLACE FUNCTION public.setar_codigo_tese_se_vazio()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.codigo IS NULL OR NEW.codigo = '' THEN
    NEW.codigo := public.proximo_codigo_tese();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_setar_codigo_tese ON public.teses_investimento;
CREATE TRIGGER trg_setar_codigo_tese
  BEFORE INSERT ON public.teses_investimento
  FOR EACH ROW EXECUTE FUNCTION public.setar_codigo_tese_se_vazio();

-- D6 · backfill tag 'comprador' (mapping confirmado: usuarios.id == auth.users.id)
UPDATE public.usuarios SET tags = array_append(tags, 'comprador')
WHERE id IN (
  SELECT DISTINCT usuario_id FROM public.teses_investimento
  WHERE usuario_id IS NOT NULL
)
AND NOT ('comprador' = ANY(COALESCE(tags, '{}'::text[])));

-- D7 · negocios_salvos
CREATE TABLE IF NOT EXISTS public.negocios_salvos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  negocio_id UUID NOT NULL REFERENCES public.negocios(id) ON DELETE CASCADE,
  salvo_em TIMESTAMPTZ DEFAULT NOW(),
  notas TEXT,
  UNIQUE(usuario_id, negocio_id)
);

CREATE INDEX IF NOT EXISTS idx_negocios_salvos_usuario
  ON public.negocios_salvos(usuario_id);
CREATE INDEX IF NOT EXISTS idx_negocios_salvos_negocio
  ON public.negocios_salvos(negocio_id);

ALTER TABLE public.negocios_salvos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_ve_proprios_salvos ON public.negocios_salvos;
CREATE POLICY usuario_ve_proprios_salvos ON public.negocios_salvos
  FOR ALL USING (usuario_id = auth.uid());

DROP POLICY IF EXISTS admin_ve_todos_salvos ON public.negocios_salvos;
CREATE POLICY admin_ve_todos_salvos ON public.negocios_salvos
  FOR SELECT USING (public.is_admin_atual());

-- D8 · negocios_salvos_teses (M:N)
CREATE TABLE IF NOT EXISTS public.negocios_salvos_teses (
  negocio_salvo_id UUID NOT NULL REFERENCES public.negocios_salvos(id) ON DELETE CASCADE,
  tese_id UUID NOT NULL REFERENCES public.teses_investimento(id) ON DELETE CASCADE,
  atrelado_em TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (negocio_salvo_id, tese_id)
);

ALTER TABLE public.negocios_salvos_teses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_ve_proprios_salvos_teses ON public.negocios_salvos_teses;
CREATE POLICY usuario_ve_proprios_salvos_teses ON public.negocios_salvos_teses
  FOR ALL USING (
    negocio_salvo_id IN (
      SELECT id FROM public.negocios_salvos WHERE usuario_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS admin_ve_todos_salvos_teses ON public.negocios_salvos_teses;
CREATE POLICY admin_ve_todos_salvos_teses ON public.negocios_salvos_teses
  FOR SELECT USING (public.is_admin_atual());

-- D9 · solicitacoes_info · teses_atreladas
ALTER TABLE public.solicitacoes_info
  ADD COLUMN IF NOT EXISTS teses_atreladas UUID[] DEFAULT '{}';

-- D10 · teses_investimento · policies admin via is_admin_atual() (phone-based)
DROP POLICY IF EXISTS tese_select_admin ON public.teses_investimento;
DROP POLICY IF EXISTS tese_update_admin ON public.teses_investimento;
DROP POLICY IF EXISTS tese_delete_admin ON public.teses_investimento;

CREATE POLICY tese_select_admin ON public.teses_investimento
  FOR SELECT USING (public.is_admin_atual());

CREATE POLICY tese_update_admin ON public.teses_investimento
  FOR UPDATE USING (public.is_admin_atual());

CREATE POLICY tese_delete_admin ON public.teses_investimento
  FOR DELETE USING (public.is_admin_atual());
