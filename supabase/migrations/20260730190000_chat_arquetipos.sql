CREATE TABLE IF NOT EXISTS va_arquetipos_chat_sessao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','aprovada','descartada')),
  mensagens jsonb NOT NULL DEFAULT '[]'::jsonb,
  teses_propostas jsonb,
  aprovada_em timestamptz,
  aprovada_por uuid,
  custo_ia_total numeric(10,4) NOT NULL DEFAULT 0,
  custo_kipflow_contagem numeric(10,4) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_arquetipos_chat_projeto_idx ON va_arquetipos_chat_sessao (projeto_id, status);

CREATE OR REPLACE FUNCTION va_arquetipos_aprovar_teses(p_sessao_id uuid, p_teses jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_projeto_id uuid; v_tese jsonb; v_count int := 0;
BEGIN
  SELECT projeto_id INTO v_projeto_id FROM va_arquetipos_chat_sessao WHERE id = p_sessao_id AND status='aberta';
  IF v_projeto_id IS NULL THEN RAISE EXCEPTION 'sessão não encontrada ou já fechada'; END IF;
  FOR v_tese IN SELECT * FROM jsonb_array_elements(p_teses) LOOP
    INSERT INTO va_projeto_arquetipos (projeto_id, codigo, prioridade, ativo, queries_busca, observacao)
    VALUES (v_projeto_id, COALESCE(v_tese->>'codigo', 'A'||(v_count+1)::text),
            v_count+1, true,
            ARRAY(SELECT jsonb_array_elements_text(v_tese->'queries_busca')),
            v_tese->>'observacao')
    ON CONFLICT (projeto_id, codigo) DO UPDATE
      SET queries_busca=EXCLUDED.queries_busca, observacao=EXCLUDED.observacao,
          ativo=true, prioridade=EXCLUDED.prioridade;
    v_count := v_count + 1;
  END LOOP;
  UPDATE va_arquetipos_chat_sessao
  SET status='aprovada', aprovada_em=now(), teses_propostas=p_teses, atualizado_em=now()
  WHERE id = p_sessao_id;
  RETURN v_count;
END; $$;
GRANT EXECUTE ON FUNCTION va_arquetipos_aprovar_teses(uuid, jsonb) TO authenticated, service_role;
