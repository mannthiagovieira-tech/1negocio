-- ═══════════════════════════════════════════════════════════════════
-- SLICE 12c · cadência 2 toques + IA + aprovação
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_disparo_fila · toque + IA + aprovação ─────────────────────
ALTER TABLE va_disparo_fila ADD COLUMN IF NOT EXISTS toque int NOT NULL DEFAULT 1;
ALTER TABLE va_disparo_fila ADD COLUMN IF NOT EXISTS gerado_por_ia boolean NOT NULL DEFAULT false;
ALTER TABLE va_disparo_fila ADD COLUMN IF NOT EXISTS aprovado_por_admin boolean NOT NULL DEFAULT false;
ALTER TABLE va_disparo_fila ADD COLUMN IF NOT EXISTS prompt_contexto jsonb;
ALTER TABLE va_disparo_fila DROP CONSTRAINT IF EXISTS va_disparo_fila_toque_chk;
ALTER TABLE va_disparo_fila ADD CONSTRAINT va_disparo_fila_toque_chk CHECK (toque IN (1,2));

-- Amplia status pra incluir aguardando_aprovacao
ALTER TABLE va_disparo_fila DROP CONSTRAINT IF EXISTS va_disparo_fila_status_check;
ALTER TABLE va_disparo_fila ADD CONSTRAINT va_disparo_fila_status_check
  CHECK (status = ANY (ARRAY['agendado','aguardando_aprovacao','enviado','entregue','falhou','cancelado']));

-- Unique deve incluir toque (senão bloqueia 2 toques por contato)
ALTER TABLE va_disparo_fila DROP CONSTRAINT IF EXISTS va_disparo_fila_projeto_id_contato_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS va_disparo_fila_projeto_contato_toque_key
  ON va_disparo_fila (projeto_id, contato_id, toque);

-- 2) va_contatos · resposta ao toque 1 ────────────────────────────
ALTER TABLE va_contatos ADD COLUMN IF NOT EXISTS respondeu_toque1_em timestamptz;
ALTER TABLE va_contatos ADD COLUMN IF NOT EXISTS elegivel_toque2 boolean NOT NULL DEFAULT false;

-- 3) va_projetos · toggle auto-aprovar toque 2 ────────────────────
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS auto_aprovar_toque2 boolean NOT NULL DEFAULT false;

-- 4) va_precos · custo da chamada Anthropic ───────────────────────
INSERT INTO va_precos (tipo, rotulo, unidade, preco, custo_real, fornecedor, ativo, ordem)
VALUES ('mensagem_ia', 'Mensagem gerada por IA (toque 2)', 'mensagem', 0.02, 0.01, 'anthropic', true, 40)
ON CONFLICT (tipo) DO UPDATE SET rotulo=EXCLUDED.rotulo, unidade=EXCLUDED.unidade,
  preco=EXCLUDED.preco, custo_real=EXCLUDED.custo_real, fornecedor=EXCLUDED.fornecedor, ativo=true;

-- 5) Gate duro + promove pra 'agendado' ao aprovar ────────────────
CREATE OR REPLACE FUNCTION va_disparo_gate_toque2()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_respondeu timestamptz;
BEGIN
  IF NEW.toque = 2 THEN
    SELECT respondeu_toque1_em INTO v_respondeu
    FROM va_contatos WHERE id = NEW.contato_id;
    IF v_respondeu IS NULL THEN
      RAISE EXCEPTION 'toque 2 exige contato.respondeu_toque1_em preenchido (contato %)', NEW.contato_id;
    END IF;
    IF NEW.aprovado_por_admin = true AND NEW.status = 'aguardando_aprovacao' THEN
      NEW.status := 'agendado';
    ELSIF NEW.aprovado_por_admin = false AND (NEW.status IS NULL OR NEW.status = 'agendado') THEN
      NEW.status := 'aguardando_aprovacao';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS va_disparo_gate_toque2_tg ON va_disparo_fila;
CREATE TRIGGER va_disparo_gate_toque2_tg
BEFORE INSERT OR UPDATE OF toque, aprovado_por_admin ON va_disparo_fila
FOR EACH ROW EXECUTE FUNCTION va_disparo_gate_toque2();

-- 6) RPC · marcar resposta ao toque 1 (webhook Z-API chama) ───────
CREATE OR REPLACE FUNCTION va_registrar_resposta_toque1(p_contato_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE va_contatos
  SET respondeu_toque1_em = COALESCE(respondeu_toque1_em, now()),
      elegivel_toque2 = true,
      atualizado_em = now()
  WHERE id = p_contato_id;
END;
$$;
GRANT EXECUTE ON FUNCTION va_registrar_resposta_toque1(uuid) TO authenticated, service_role;

-- 7) Template padrão toque 1 (global · projeto_id NULL) ───────────
INSERT INTO va_disparo_templates (projeto_id, nome, arquetipo_codigo, corpo, versao, status)
SELECT NULL, 'toque_1_abertura', NULL, 'Oi {{primeiro_nome}}, {{saudacao}}. Tudo bem?', 1, 'aprovado'
WHERE NOT EXISTS (SELECT 1 FROM va_disparo_templates WHERE nome = 'toque_1_abertura' AND projeto_id IS NULL);

-- 8) VIEW métricas por projeto+arquétipo ──────────────────────────
CREATE OR REPLACE VIEW va_cadencia_metricas AS
WITH base AS (
  SELECT
    f.projeto_id, c.arquetipo_codigo,
    f.toque, f.gerado_por_ia,
    (f.status IN ('enviado','entregue','lido')) AS enviado,
    (c.respondeu_toque1_em IS NOT NULL) AS lead_respondeu,
    (c.estagio IN ('interesse','qualificado','nda','completo')) AS avancou_interesse
  FROM va_disparo_fila f
  JOIN va_contatos c ON c.id = f.contato_id
)
SELECT
  projeto_id,
  COALESCE(arquetipo_codigo,'sem_arquetipo') AS arquetipo,
  COUNT(*) FILTER (WHERE toque=1 AND enviado) AS toque1_enviados,
  COUNT(DISTINCT CASE WHEN toque=1 AND enviado AND lead_respondeu THEN 1 END) AS toque1_respondidos,
  COUNT(*) FILTER (WHERE toque=2 AND enviado) AS toque2_enviados,
  COUNT(*) FILTER (WHERE toque=2 AND enviado AND gerado_por_ia) AS toque2_ia,
  COUNT(*) FILTER (WHERE toque=2 AND enviado AND NOT gerado_por_ia) AS toque2_manual,
  COUNT(*) FILTER (WHERE toque=2 AND enviado AND avancou_interesse) AS toque2_avancou
FROM base
GROUP BY projeto_id, COALESCE(arquetipo_codigo,'sem_arquetipo');
