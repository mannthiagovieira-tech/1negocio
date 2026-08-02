-- ZONA ATIVO · schema dos 4 artefatos.
-- Escopo: cria va_arquetipos limpo (não reutiliza va_projeto_arquetipos
-- nem arquetipos_compradores para não quebrar fluxos legados no monolito),
-- estende va_projeto_teaser (retrocompatível), acrescenta valor_venda_definido_em.

-- ─── ARQUÉTIPOS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_arquetipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  versao int NOT NULL DEFAULT 1 CHECK (versao >= 1),
  parent_id uuid NULL REFERENCES va_arquetipos(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','aprovado','arquivado')),
  origem text NOT NULL DEFAULT 'ia'
    CHECK (origem IN ('ia','manual')),
  nome text NOT NULL,
  tese text NOT NULL,
  filtro jsonb NOT NULL DEFAULT '{}'::jsonb,
  abordagem jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  aprovado_em timestamptz NULL,
  arquivado_em timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_va_arquetipos_projeto_status
  ON va_arquetipos(projeto_id, status);
CREATE INDEX IF NOT EXISTS idx_va_arquetipos_parent
  ON va_arquetipos(parent_id) WHERE parent_id IS NOT NULL;

-- Trigger 1 · teto de 5 ativos (rascunho + aprovado) por projeto
CREATE OR REPLACE FUNCTION va_arquetipos_teto_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE ativos int;
BEGIN
  -- Só conta quando o novo estado é ativo (rascunho/aprovado)
  IF NEW.status = 'arquivado' THEN RETURN NEW; END IF;
  -- Não conta a própria linha em UPDATE
  SELECT count(*) INTO ativos FROM va_arquetipos
  WHERE projeto_id = NEW.projeto_id
    AND status <> 'arquivado'
    AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);
  IF ativos >= 5 THEN
    RAISE EXCEPTION 'ARQ_TETO: máximo de 5 arquétipos ativos por projeto (atual: %). Arquive um antes de criar/reativar outro.', ativos
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_arquetipos_teto ON va_arquetipos;
CREATE TRIGGER trg_va_arquetipos_teto
  BEFORE INSERT OR UPDATE OF status ON va_arquetipos
  FOR EACH ROW EXECUTE FUNCTION va_arquetipos_teto_check();

-- Trigger 2 · aprovado é imutável em nome/tese/filtro/abordagem/origem
-- (status pode mudar pra 'arquivado', versao/parent/aprovado_em/arquivado_em servem à mecânica)
CREATE OR REPLACE FUNCTION va_arquetipos_imutabilidade_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'aprovado' THEN
    IF NEW.nome      IS DISTINCT FROM OLD.nome
    OR NEW.tese      IS DISTINCT FROM OLD.tese
    OR NEW.filtro    IS DISTINCT FROM OLD.filtro
    OR NEW.abordagem IS DISTINCT FROM OLD.abordagem
    OR NEW.origem    IS DISTINCT FROM OLD.origem
    OR NEW.versao    IS DISTINCT FROM OLD.versao
    OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
      RAISE EXCEPTION 'ARQ_IMUTAVEL: arquétipo aprovado não pode ter nome/tese/filtro/abordagem/origem/versao/parent alterados. Crie uma nova versão via parent_id.'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Status só pode ir pra 'arquivado' (não pode voltar pra rascunho)
    IF NEW.status = 'rascunho' THEN
      RAISE EXCEPTION 'ARQ_IMUTAVEL: aprovado não volta pra rascunho. Crie nova versão.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_arquetipos_imut ON va_arquetipos;
CREATE TRIGGER trg_va_arquetipos_imut
  BEFORE UPDATE ON va_arquetipos
  FOR EACH ROW EXECUTE FUNCTION va_arquetipos_imutabilidade_check();

-- Trigger 3 · aprovado_em/arquivado_em automáticos por transição de status
CREATE OR REPLACE FUNCTION va_arquetipos_timestamps() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'aprovado' AND OLD.status <> 'aprovado' AND NEW.aprovado_em IS NULL THEN
      NEW.aprovado_em := now();
    END IF;
    IF NEW.status = 'arquivado' AND OLD.status <> 'arquivado' AND NEW.arquivado_em IS NULL THEN
      NEW.arquivado_em := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_arquetipos_ts ON va_arquetipos;
CREATE TRIGGER trg_va_arquetipos_ts
  BEFORE UPDATE OF status ON va_arquetipos
  FOR EACH ROW EXECUTE FUNCTION va_arquetipos_timestamps();

-- RLS · allowlist admin (padrão dos demais va_*)
ALTER TABLE va_arquetipos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_arquetipos_admin ON va_arquetipos;
CREATE POLICY va_arquetipos_admin ON va_arquetipos
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON va_arquetipos TO authenticated;

-- ─── TEASER · estende retrocompatível ───────────────────────────────
-- Reutiliza va_projeto_teaser (id, projeto_id, versao, texto, status,
-- angulo, gerado_por, gerado_em, aprovado_em, criado_em).
ALTER TABLE va_projeto_teaser
  ADD COLUMN IF NOT EXISTS origem text
    CHECK (origem IN ('ia','manual'));
-- Backfill: linhas existentes com gerado_por preenchido são 'ia', resto 'manual'
UPDATE va_projeto_teaser
  SET origem = CASE WHEN gerado_por IS NOT NULL THEN 'ia' ELSE 'manual' END
  WHERE origem IS NULL;

-- Trigger de imutabilidade quando aprovado
CREATE OR REPLACE FUNCTION va_teaser_imutabilidade_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'aprovado' AND (
       NEW.texto IS DISTINCT FROM OLD.texto
    OR NEW.angulo IS DISTINCT FROM OLD.angulo
    OR NEW.origem IS DISTINCT FROM OLD.origem
    OR NEW.versao IS DISTINCT FROM OLD.versao
  ) THEN
    RAISE EXCEPTION 'TEASER_IMUTAVEL: teaser aprovado não pode ter texto/angulo/origem/versao alterados. Crie nova versão.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_teaser_imut ON va_projeto_teaser;
CREATE TRIGGER trg_va_teaser_imut
  BEFORE UPDATE ON va_projeto_teaser
  FOR EACH ROW EXECUTE FUNCTION va_teaser_imutabilidade_check();

-- ─── VALOR DE VENDA · timestamp da decisão ─────────────────────────
ALTER TABLE va_projetos
  ADD COLUMN IF NOT EXISTS valor_venda_definido_em timestamptz NULL;
-- Atualiza automaticamente quando valor_venda muda
CREATE OR REPLACE FUNCTION va_projetos_valor_venda_ts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.valor_venda IS DISTINCT FROM OLD.valor_venda THEN
    NEW.valor_venda_definido_em := now();
  END IF;
  IF TG_OP = 'INSERT' AND NEW.valor_venda IS NOT NULL THEN
    NEW.valor_venda_definido_em := COALESCE(NEW.valor_venda_definido_em, now());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_va_projetos_valor_venda_ts ON va_projetos;
CREATE TRIGGER trg_va_projetos_valor_venda_ts
  BEFORE INSERT OR UPDATE OF valor_venda ON va_projetos
  FOR EACH ROW EXECUTE FUNCTION va_projetos_valor_venda_ts();

-- Expõe na view de resumo
DROP VIEW IF EXISTS va_projetos_resumo CASCADE;
CREATE VIEW va_projetos_resumo AS
 SELECT p.id, p.negocio_id, p.cliente_nome, p.cliente_whatsapp, p.cliente_usuario_id,
    p.negocio_titulo, p.cidade, p.setor,
    p.valor_mensal, p.fidelidade_meses, p.comissao_percent,
    p.data_inicio, p.expectativa_valor,
    p.valor_avaliacao, p.valor_avaliacao_min, p.valor_avaliacao_max,
    p.valor_venda, p.valor_venda_justificativa, p.valor_venda_decidido_por,
    p.valor_venda_definido_em,
    p.nivel_sigilo, p.status,
    p.codigo, p.uf, p.avaliacao_setor, p.cnpj,
    p.modalidade, p.forma_pagamento,
    p.operacao_liberada_manual, p.liberacao_manual_por, p.liberacao_manual_em,
    p.avaliacao_origem_id, p.laudo_v2_id,
    p.descricao_negocio, p.descricao_negocio_versao, p.descricao_negocio_gerado_em,
    p.onboarding_enviado_em, p.onboarding_enviado_por, p.onboarding_conteudo_snapshot,
    p.primeira_reuniao_em, p.agendamento_link,
    p.arquivado_em, p.arquivado_por, p.arquivado_motivo,
    p.precos_versao_id,
    p.criado_em, p.atualizado_em,
    COALESCE(e.total, 0::bigint) AS etapas_total,
    COALESCE(e.ok, 0::bigint) AS etapas_ok,
    COALESCE(pa.total_pago, 0::numeric) AS total_pago,
    (COALESCE(pa.total_pago, 0::numeric) * 0.5) AS credito_liberado,
    ((p.data_inicio + ((p.fidelidade_meses || ' months'::text))::interval))::date AS fim_da_onda,
    (CURRENT_DATE - p.data_inicio) AS dia_atual
 FROM va_projetos p
   LEFT JOIN ( SELECT projeto_id, count(*) AS total,
                      count(*) FILTER (WHERE status = 'concluida'::text) AS ok
               FROM va_projeto_etapas GROUP BY projeto_id) e ON e.projeto_id = p.id
   LEFT JOIN ( SELECT projeto_id, sum(valor) AS total_pago
               FROM va_projeto_parcelas WHERE status = 'pago'::text
               GROUP BY projeto_id) pa ON pa.projeto_id = p.id;
GRANT SELECT ON va_projetos_resumo TO authenticated;
