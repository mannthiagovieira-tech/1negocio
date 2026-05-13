-- v9.34.5 · Propostas comerciais assessoradas · tabela + RLS + bucket Storage público
CREATE TABLE IF NOT EXISTS propostas_comerciais (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text        UNIQUE NOT NULL,
  contato_nome     text        NOT NULL,
  negocio_setor    text        NOT NULL,
  faturamento_anual  numeric,
  margem_operacional numeric,
  situacao_bp      text        CHECK (situacao_bp IN ('positivo','neutro','negativo')),
  valor_aproximado numeric     NOT NULL,
  mensalidade_minimo  numeric  DEFAULT 500,
  mensalidade_ideal   numeric,
  mensalidade_maximo  numeric,
  plano_sugerido   text        DEFAULT 'ideal' CHECK (plano_sugerido IN ('minimo','ideal','maximo')),
  narrativa_diagnostico    text,
  narrativa_por_que_agora  text,
  storage_path     text,
  storage_url      text,
  status           text        NOT NULL DEFAULT 'enviada'
                               CHECK (status IN ('enviada','negociacao','negada','convertida','expirada')),
  admin_id         uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '30 days'
);

ALTER TABLE propostas_comerciais ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_all" ON propostas_comerciais;
CREATE POLICY "service_all" ON propostas_comerciais FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "anon_select_slug" ON propostas_comerciais;
CREATE POLICY "anon_select_slug" ON propostas_comerciais FOR SELECT TO anon USING (true);

INSERT INTO storage.buckets (id, name, public)
VALUES ('propostas', 'propostas', true)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_propostas_comerciais_created ON propostas_comerciais(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_propostas_comerciais_status ON propostas_comerciais(status);
