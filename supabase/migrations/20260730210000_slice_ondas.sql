-- ═══════════════════════════════════════════════════════════════════
-- SLICE ONDAS · renovação, repactuação, aditivo e pausa
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS va_projeto_ondas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  numero int NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('inicial','renovacao','repactuacao')),
  data_inicio date NOT NULL, data_fim date NOT NULL, meses int NOT NULL,
  valor_mensal numeric(12,2) NOT NULL, comissao_percent numeric(5,2) NOT NULL,
  reserva_midia_percent numeric(5,2), observacao text,
  dias_pausados int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'planejada'
    CHECK (status IN ('planejada','aguardando_pagamento','ativa','pausada','encerrada','cancelada')),
  ativada_em timestamptz, encerrada_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, numero)
);
CREATE INDEX IF NOT EXISTS va_projeto_ondas_status_idx ON va_projeto_ondas (projeto_id, status);

CREATE TABLE IF NOT EXISTS va_projeto_pausas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  onda_id uuid NOT NULL REFERENCES va_projeto_ondas(id) ON DELETE CASCADE,
  motivo text NOT NULL, pausado_em date NOT NULL DEFAULT CURRENT_DATE,
  retomado_em date, dias int,
  solicitado_por text NOT NULL CHECK (solicitado_por IN ('cliente','operador')),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_projeto_pausas_ativa_idx ON va_projeto_pausas (onda_id) WHERE retomado_em IS NULL;

CREATE TABLE IF NOT EXISTS va_projeto_aditivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  onda_id uuid NOT NULL REFERENCES va_projeto_ondas(id) ON DELETE CASCADE,
  valor numeric(12,2) NOT NULL, motivo text NOT NULL, vencimento date,
  pago_em timestamptz,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','cancelado')),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE va_projeto_parcelas ADD COLUMN IF NOT EXISTS onda_id uuid REFERENCES va_projeto_ondas(id) ON DELETE SET NULL;
ALTER TABLE va_projeto_razao    ADD COLUMN IF NOT EXISTS onda_id uuid REFERENCES va_projeto_ondas(id) ON DELETE SET NULL;
ALTER TABLE va_relatorio_ciclo  ADD COLUMN IF NOT EXISTS onda_id uuid REFERENCES va_projeto_ondas(id) ON DELETE SET NULL;

-- Backfill: cria onda 1 pra projetos existentes
INSERT INTO va_projeto_ondas (projeto_id, numero, tipo, data_inicio, data_fim, meses, valor_mensal, comissao_percent, status, ativada_em)
SELECT p.id, 1, 'inicial', p.data_inicio,
       p.data_inicio + (COALESCE(p.fidelidade_meses,3) * 30 - 1),
       COALESCE(p.fidelidade_meses,3), COALESCE(p.valor_mensal,0), COALESCE(p.comissao_percent,5),
       CASE WHEN p.status='ativo' THEN 'ativa' ELSE 'planejada' END,
       CASE WHEN p.status='ativo' THEN p.criado_em END
FROM va_projetos p
WHERE NOT EXISTS (SELECT 1 FROM va_projeto_ondas o WHERE o.projeto_id = p.id);

UPDATE va_projeto_parcelas pp SET onda_id = o.id
FROM va_projeto_ondas o
WHERE pp.projeto_id = o.projeto_id AND pp.onda_id IS NULL
  AND pp.vencimento BETWEEN o.data_inicio AND o.data_fim;
UPDATE va_projeto_razao pr SET onda_id = o.id
FROM va_projeto_ondas o
WHERE pr.projeto_id = o.projeto_id AND pr.onda_id IS NULL
  AND pr.data BETWEEN o.data_inicio AND o.data_fim;
UPDATE va_relatorio_ciclo rc SET onda_id = o.id
FROM va_projeto_ondas o
WHERE rc.projeto_id = o.projeto_id AND rc.onda_id IS NULL
  AND rc.periodo_inicio >= o.data_inicio AND rc.periodo_fim <= o.data_fim;

-- ═══ RPCs · gate global + ativar/pausar/retomar/renovar/aditivo ═══
CREATE OR REPLACE FUNCTION va_onda_operacional(p_projeto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET row_security = off AS $$
DECLARE o record; msg text;
BEGIN
  SELECT * INTO o FROM va_projeto_ondas WHERE projeto_id = p_projeto_id ORDER BY numero DESC LIMIT 1;
  IF o IS NULL THEN RETURN jsonb_build_object('operacional', false, 'mensagem', 'projeto sem onda', 'status', null); END IF;
  IF o.status = 'ativa' THEN
    RETURN jsonb_build_object('operacional', true, 'mensagem', 'ok', 'onda_id', o.id, 'status', 'ativa', 'numero', o.numero);
  ELSIF o.status = 'pausada' THEN
    msg := 'Mandato pausado desde '||to_char((SELECT MAX(pausado_em) FROM va_projeto_pausas WHERE onda_id = o.id AND retomado_em IS NULL),'DD/MM')||' — retome para operar.';
  ELSIF o.status = 'aguardando_pagamento' THEN
    msg := 'Aguardando pagamento da onda '||o.numero||'. Marque a primeira parcela como paga para liberar.';
  ELSIF o.status = 'encerrada' THEN
    msg := 'Onda '||o.numero||' encerrada em '||to_char(o.encerrada_em,'DD/MM/YYYY')||'. Renove para continuar.';
  ELSE msg := 'Onda '||o.numero||' com status '||o.status||' — operação bloqueada.';
  END IF;
  RETURN jsonb_build_object('operacional', false, 'mensagem', msg, 'onda_id', o.id, 'status', o.status, 'numero', o.numero);
END; $$;
GRANT EXECUTE ON FUNCTION va_onda_operacional(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_onda_ativar(p_onda_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE tem_paga boolean; s text;
BEGIN
  SELECT status INTO s FROM va_projeto_ondas WHERE id = p_onda_id;
  IF s = 'ativa' THEN RETURN true; END IF;
  IF s NOT IN ('planejada','aguardando_pagamento') THEN RAISE EXCEPTION 'onda com status % não pode ativar', s; END IF;
  SELECT EXISTS(SELECT 1 FROM va_projeto_parcelas WHERE onda_id = p_onda_id AND status = 'pago') INTO tem_paga;
  IF NOT tem_paga THEN RETURN false; END IF;
  UPDATE va_projeto_ondas SET status='ativa', ativada_em = now() WHERE id = p_onda_id;
  RETURN true;
END; $$;
GRANT EXECUTE ON FUNCTION va_onda_ativar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_parcela_ativa_onda() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'pago' AND (OLD.status IS DISTINCT FROM NEW.status) AND NEW.onda_id IS NOT NULL THEN
    PERFORM va_onda_ativar(NEW.onda_id);
  END IF; RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS va_parcela_ativa_onda_tg ON va_projeto_parcelas;
CREATE TRIGGER va_parcela_ativa_onda_tg
AFTER UPDATE OF status ON va_projeto_parcelas
FOR EACH ROW EXECUTE FUNCTION va_parcela_ativa_onda();

CREATE OR REPLACE FUNCTION va_onda_pausar(p_onda_id uuid, p_motivo text, p_solicitado_por text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_pause_id uuid; s text; pj uuid;
BEGIN
  SELECT status, projeto_id INTO s, pj FROM va_projeto_ondas WHERE id = p_onda_id;
  IF s IS NULL THEN RAISE EXCEPTION 'onda não encontrada'; END IF;
  IF s <> 'ativa' THEN RAISE EXCEPTION 'só onda ativa pode ser pausada (atual: %)', s; END IF;
  INSERT INTO va_projeto_pausas (projeto_id, onda_id, motivo, pausado_em, solicitado_por)
  VALUES (pj, p_onda_id, p_motivo, CURRENT_DATE, p_solicitado_por) RETURNING id INTO v_pause_id;
  UPDATE va_projeto_ondas SET status='pausada' WHERE id = p_onda_id;
  PERFORM va_notificar(pj, 'imediata', 'onda_pausada', 'Onda pausada: '||p_motivo, jsonb_build_object('onda_id', p_onda_id));
  RETURN v_pause_id;
END; $$;
GRANT EXECUTE ON FUNCTION va_onda_pausar(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_onda_retomar(p_onda_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_dias int; nova_fim date; o record; p_id uuid;
BEGIN
  SELECT * INTO o FROM va_projeto_ondas WHERE id = p_onda_id;
  IF o IS NULL THEN RAISE EXCEPTION 'onda não encontrada'; END IF;
  IF o.status <> 'pausada' THEN RAISE EXCEPTION 'onda não está pausada'; END IF;
  SELECT id INTO p_id FROM va_projeto_pausas WHERE onda_id=p_onda_id AND retomado_em IS NULL ORDER BY pausado_em DESC LIMIT 1;
  IF p_id IS NULL THEN RAISE EXCEPTION 'sem registro de pausa aberta'; END IF;
  UPDATE va_projeto_pausas SET retomado_em = CURRENT_DATE, dias = (CURRENT_DATE - pausado_em)::int
  WHERE id = p_id RETURNING dias INTO v_dias;
  nova_fim := o.data_fim + v_dias;
  UPDATE va_projeto_ondas SET status='ativa', dias_pausados = dias_pausados + v_dias, data_fim = nova_fim
  WHERE id = p_onda_id;
  PERFORM va_notificar(o.projeto_id, 'imediata', 'onda_retomada', 'Onda retomada · prazo estendido em '||v_dias||' dia(s) até '||to_char(nova_fim,'DD/MM/YYYY'), jsonb_build_object('onda_id', p_onda_id, 'dias', v_dias));
  RETURN jsonb_build_object('dias', v_dias, 'nova_data_fim', nova_fim);
END; $$;
GRANT EXECUTE ON FUNCTION va_onda_retomar(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_criar_onda_renovacao(
  p_projeto_id uuid, p_meses int, p_valor_mensal numeric, p_comissao_percent numeric, p_tipo text DEFAULT 'renovacao'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE v_ultima record; v_novo_num int; v_inicio date; v_id uuid;
BEGIN
  SELECT * INTO v_ultima FROM va_projeto_ondas WHERE projeto_id = p_projeto_id ORDER BY numero DESC LIMIT 1;
  IF v_ultima IS NULL THEN RAISE EXCEPTION 'projeto sem onda inicial'; END IF;
  v_novo_num := v_ultima.numero + 1;
  v_inicio := GREATEST(v_ultima.data_fim + 1, CURRENT_DATE);
  INSERT INTO va_projeto_ondas (projeto_id, numero, tipo, data_inicio, data_fim, meses, valor_mensal, comissao_percent, status)
  VALUES (p_projeto_id, v_novo_num, p_tipo, v_inicio, v_inicio + (p_meses*30 - 1), p_meses, p_valor_mensal, p_comissao_percent, 'aguardando_pagamento')
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION va_criar_onda_renovacao(uuid, int, numeric, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_aditivo_marcar_pago(p_aditivo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  UPDATE va_projeto_aditivos SET status='pago', pago_em = now() WHERE id = p_aditivo_id AND status <> 'pago';
END; $$;
GRANT EXECUTE ON FUNCTION va_aditivo_marcar_pago(uuid) TO authenticated, service_role;

-- Trigger: cria onda 1 auto pra projeto novo
CREATE OR REPLACE FUNCTION va_projeto_cria_onda1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO va_projeto_ondas (projeto_id, numero, tipo, data_inicio, data_fim, meses, valor_mensal, comissao_percent, status)
  VALUES (NEW.id, 1, 'inicial',
          NEW.data_inicio,
          NEW.data_inicio + (COALESCE(NEW.fidelidade_meses,3) * 30 - 1),
          COALESCE(NEW.fidelidade_meses,3),
          COALESCE(NEW.valor_mensal,0),
          COALESCE(NEW.comissao_percent,5),
          'aguardando_pagamento');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS va_projeto_cria_onda1_tg ON va_projetos;
CREATE TRIGGER va_projeto_cria_onda1_tg
AFTER INSERT ON va_projetos
FOR EACH ROW EXECUTE FUNCTION va_projeto_cria_onda1();
