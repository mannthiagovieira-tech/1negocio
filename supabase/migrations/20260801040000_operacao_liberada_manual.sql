-- Gate manual · destrava operação sem exigir parcela/termo/etapa
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS operacao_liberada_manual boolean NOT NULL DEFAULT false;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS liberacao_manual_por text;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS liberacao_manual_em timestamptz;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS liberacao_manual_justificativa text;

CREATE OR REPLACE FUNCTION va_onda_operacional(p_projeto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE o record; p record; msg text;
BEGIN
  SELECT * INTO p FROM va_projetos WHERE id = p_projeto_id;
  SELECT * INTO o FROM va_projeto_ondas WHERE projeto_id = p_projeto_id ORDER BY numero DESC LIMIT 1;
  IF p.operacao_liberada_manual = true THEN
    RETURN jsonb_build_object('operacional', true,
      'mensagem', 'Operação liberada manualmente por ' || COALESCE(p.liberacao_manual_por, '?') || ' em ' || to_char(p.liberacao_manual_em, 'DD/MM'),
      'onda_id', o.id, 'status', COALESCE(o.status, 'sem_onda'), 'numero', o.numero, 'manual', true);
  END IF;
  IF o IS NULL THEN
    RETURN jsonb_build_object('operacional', false, 'mensagem', 'projeto sem onda', 'status', null);
  END IF;
  IF o.status = 'ativa' THEN
    RETURN jsonb_build_object('operacional', true, 'mensagem', 'ok', 'onda_id', o.id, 'status', 'ativa', 'numero', o.numero);
  ELSIF o.status = 'pausada' THEN
    msg := 'Mandato pausado desde '||to_char((SELECT MAX(pausado_em) FROM va_projeto_pausas WHERE onda_id = o.id AND retomado_em IS NULL),'DD/MM')||' — retome para operar.';
  ELSIF o.status = 'aguardando_pagamento' THEN
    msg := 'Aguardando pagamento da onda '||o.numero||'. Marque a primeira parcela como paga ou use "Liberar operação manualmente".';
  ELSIF o.status = 'encerrada' THEN
    msg := 'Onda '||o.numero||' encerrada em '||to_char(o.encerrada_em,'DD/MM/YYYY')||'. Renove para continuar.';
  ELSE
    msg := 'Onda '||o.numero||' com status '||o.status||' — operação bloqueada.';
  END IF;
  RETURN jsonb_build_object('operacional', false, 'mensagem', msg, 'onda_id', o.id, 'status', o.status, 'numero', o.numero);
END; $$;
GRANT EXECUTE ON FUNCTION va_onda_operacional(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_liberar_operacao_manual(p_projeto_id uuid, p_justificativa text, p_liberar boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
BEGIN
  IF p_liberar AND (p_justificativa IS NULL OR length(trim(p_justificativa)) = 0) THEN
    RAISE EXCEPTION 'justificativa obrigatória';
  END IF;
  IF p_liberar THEN
    UPDATE va_projetos SET operacao_liberada_manual=true,
      liberacao_manual_por = COALESCE(current_setting('request.jwt.claims',true)::jsonb->>'email','admin'),
      liberacao_manual_em = now(),
      liberacao_manual_justificativa = p_justificativa
    WHERE id = p_projeto_id;
  ELSE
    UPDATE va_projetos SET operacao_liberada_manual=false WHERE id = p_projeto_id;
  END IF;
END; $$;
GRANT EXECUTE ON FUNCTION va_liberar_operacao_manual(uuid, text, boolean) TO authenticated, service_role;
