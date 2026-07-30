-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 9 · criativos, campanhas e atribuição
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_criativos ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_criativos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('estatico','video','carrossel')),
  arquetipo_codigo text REFERENCES va_arquetipos_catalogo(codigo),
  canal_sufixo text,
  teaser_versao int,
  copy_principal text,
  copy_secundaria text,
  storage_path text,
  url_externa text,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','aprovado','no_ar','pausado','arquivado')),
  aprovado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_criativos_projeto ON va_criativos (projeto_id);

-- 2) va_campanhas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  nome text NOT NULL,
  plataforma text NOT NULL DEFAULT 'meta' CHECK (plataforma IN ('meta','google','outro')),
  campanha_externa_id text,
  canal_sufixo text,
  objetivo text,
  publico_descricao text,
  arquetipo_codigo text REFERENCES va_arquetipos_catalogo(codigo),
  orcamento_total numeric(12,2),
  orcamento_diario numeric(12,2),
  data_inicio date,
  data_fim date,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','ativa','pausada','encerrada')),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_campanhas_projeto ON va_campanhas (projeto_id);

-- 3) va_campanha_criativos (N:N) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS va_campanha_criativos (
  campanha_id uuid NOT NULL REFERENCES va_campanhas(id) ON DELETE CASCADE,
  criativo_id uuid NOT NULL REFERENCES va_criativos(id) ON DELETE CASCADE,
  PRIMARY KEY (campanha_id, criativo_id)
);

-- 4) va_campanha_metricas ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_campanha_metricas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid NOT NULL REFERENCES va_campanhas(id) ON DELETE CASCADE,
  criativo_id uuid REFERENCES va_criativos(id) ON DELETE SET NULL,
  data date NOT NULL,
  impressoes int NOT NULL DEFAULT 0,
  cliques int NOT NULL DEFAULT 0,
  custo numeric(12,2) NOT NULL DEFAULT 0,
  conversas_iniciadas int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campanha_id, criativo_id, data)
);
-- Constraint parcial pra permitir UNIQUE quando criativo_id é null
-- (postgres trata NULL como distinto → UNIQUE não bate; contornamos com índice parcial)
CREATE UNIQUE INDEX IF NOT EXISTS va_metricas_camp_data_nocriativo
  ON va_campanha_metricas (campanha_id, data) WHERE criativo_id IS NULL;
CREATE INDEX IF NOT EXISTS va_metricas_camp_data ON va_campanha_metricas (campanha_id, data DESC);

-- 5) FUNÇÃO va_lancar_gasto_midia (incremental) ──────────────────
CREATE OR REPLACE FUNCTION va_lancar_gasto_midia(
  p_campanha uuid, p_data date, p_custo numeric,
  p_impressoes int, p_cliques int
) RETURNS uuid AS $$
DECLARE
  v_campanha va_campanhas%ROWTYPE;
  v_existente va_campanha_metricas%ROWTYPE;
  v_id uuid;
  v_delta numeric;
  v_ref text;
BEGIN
  SELECT * INTO v_campanha FROM va_campanhas WHERE id = p_campanha;
  IF v_campanha.id IS NULL THEN RAISE EXCEPTION 'campanha % não encontrada', p_campanha; END IF;

  -- Busca existente (sem criativo_id, agregado por campanha+data)
  SELECT * INTO v_existente FROM va_campanha_metricas
   WHERE campanha_id = p_campanha AND data = p_data AND criativo_id IS NULL
   LIMIT 1;

  v_ref := v_campanha.nome || ' · ' || to_char(p_data, 'DD/MM');

  IF v_existente.id IS NULL THEN
    -- Novo lançamento
    INSERT INTO va_campanha_metricas (campanha_id, data, impressoes, cliques, custo)
    VALUES (p_campanha, p_data, p_impressoes, p_cliques, p_custo)
    RETURNING id INTO v_id;
    IF p_custo > 0 THEN
      PERFORM va_debitar(v_campanha.projeto_id, 'midia_meta', 1, v_ref || ' · R$ ' || p_custo, NULL);
    END IF;
    RETURN v_id;
  ELSE
    -- Update: debita SÓ a diferença se aumentou
    v_delta := p_custo - v_existente.custo;
    UPDATE va_campanha_metricas
    SET impressoes = p_impressoes, cliques = p_cliques, custo = p_custo
    WHERE id = v_existente.id;
    IF v_delta > 0 THEN
      PERFORM va_debitar(v_campanha.projeto_id, 'midia_meta', 1,
        v_ref || ' · +R$ ' || v_delta || ' (ajuste)', NULL);
    END IF;
    -- Se delta <= 0 (relançou menor ou igual), não debita nada (não estornamos)
    RETURN v_existente.id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6) VIEW va_projeto_canal_desempenho ────────────────────────────
CREATE OR REPLACE VIEW va_projeto_canal_desempenho AS
WITH inv AS (
  SELECT c.projeto_id, c.canal_sufixo,
         SUM(m.custo)   AS investido,
         SUM(m.cliques) AS cliques
  FROM va_campanhas c
  LEFT JOIN va_campanha_metricas m ON m.campanha_id = c.id
  WHERE c.canal_sufixo IS NOT NULL
  GROUP BY c.projeto_id, c.canal_sufixo
),
conv AS (
  SELECT projeto_id, canal_sufixo, COUNT(*) AS conversas
  FROM va_atendimentos WHERE canal_sufixo IS NOT NULL
  GROUP BY projeto_id, canal_sufixo
),
ct AS (
  SELECT projeto_id,
         -- extrai sufixo do origem_detalhe (padrão do slice 8: "atendimento canal X")
         regexp_replace(origem_detalhe, '.*canal\s+', '') AS canal_sufixo,
         COUNT(*) AS contatos_gerados,
         COUNT(*) FILTER (WHERE estagio IN ('interesse_inicial','apresentado','nda_assinado','em_negociacao','proposta','fechado')) AS interessados
  FROM va_contatos
  WHERE origem = 'anuncio' AND origem_detalhe ILIKE 'atendimento canal %'
  GROUP BY projeto_id, regexp_replace(origem_detalhe, '.*canal\s+', '')
)
SELECT
  co.projeto_id, co.sufixo AS canal_sufixo, co.rotulo,
  COALESCE(inv.investido, 0)::numeric(14,2) AS investido,
  COALESCE(inv.cliques, 0)::int             AS cliques,
  COALESCE(conv.conversas, 0)::int          AS conversas,
  COALESCE(ct.contatos_gerados, 0)::int     AS contatos_gerados,
  COALESCE(ct.interessados, 0)::int         AS interessados,
  CASE WHEN COALESCE(conv.conversas, 0) > 0
       THEN (COALESCE(inv.investido, 0) / conv.conversas)::numeric(14,2) END AS custo_por_conversa,
  CASE WHEN COALESCE(ct.interessados, 0) > 0
       THEN (COALESCE(inv.investido, 0) / ct.interessados)::numeric(14,2) END AS custo_por_interessado
FROM va_canais_origem co
LEFT JOIN inv  ON inv.projeto_id  = co.projeto_id AND inv.canal_sufixo  = co.sufixo
LEFT JOIN conv ON conv.projeto_id = co.projeto_id AND conv.canal_sufixo = co.sufixo
LEFT JOIN ct   ON ct.projeto_id   = co.projeto_id AND ct.canal_sufixo   = co.sufixo;

-- 7) RLS ──────────────────────────────────────────────────────────
ALTER TABLE va_criativos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_campanhas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_campanha_criativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_campanha_metricas  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_criativos_admin      ON va_criativos;
DROP POLICY IF EXISTS va_campanhas_admin      ON va_campanhas;
DROP POLICY IF EXISTS va_camp_crit_admin      ON va_campanha_criativos;
DROP POLICY IF EXISTS va_metricas_admin       ON va_campanha_metricas;

CREATE POLICY va_criativos_admin      ON va_criativos          FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_campanhas_admin      ON va_campanhas          FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_camp_crit_admin      ON va_campanha_criativos FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_metricas_admin       ON va_campanha_metricas  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());

-- 8) Aperta policies do bucket projeto-anexos pra allowlist ─────
-- (herdado do slice 3 estava USING authenticated USING true → agora admin only)
DROP POLICY IF EXISTS va_anexos_read   ON storage.objects;
DROP POLICY IF EXISTS va_anexos_insert ON storage.objects;
DROP POLICY IF EXISTS va_anexos_update ON storage.objects;
DROP POLICY IF EXISTS va_anexos_delete ON storage.objects;

CREATE POLICY va_anexos_read   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'projeto-anexos' AND va_is_admin());
CREATE POLICY va_anexos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'projeto-anexos' AND va_is_admin());
CREATE POLICY va_anexos_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'projeto-anexos' AND va_is_admin()) WITH CHECK (bucket_id = 'projeto-anexos' AND va_is_admin());
CREATE POLICY va_anexos_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'projeto-anexos' AND va_is_admin());

GRANT EXECUTE ON FUNCTION va_lancar_gasto_midia(uuid, date, numeric, int, int) TO authenticated;
