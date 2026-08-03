-- Fix incidental descoberto no P3: va_debitar insere em "ciclo" mas a
-- coluna real de va_projeto_razao é "ciclo_numero". Bug latente vindo
-- do slice de preços versionados (BSC). Corrigido sem mudar o contrato.
CREATE OR REPLACE FUNCTION public.va_debitar(
  p_projeto uuid, p_tipo text, p_qtd numeric,
  p_referencia text DEFAULT NULL, p_ciclo integer DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off'
AS $function$
DECLARE
  v_preco record; v_row_id uuid; v_versao_id uuid; v_onda_id uuid;
BEGIN
  SELECT precos_versao_id INTO v_versao_id FROM va_projetos WHERE id = p_projeto;
  IF v_versao_id IS NULL THEN
    SELECT id INTO v_versao_id FROM va_precos_versao WHERE vigente=true LIMIT 1;
  END IF;
  SELECT * INTO v_preco FROM va_precos WHERE versao_id=v_versao_id AND tipo=p_tipo AND ativo LIMIT 1;
  IF v_preco IS NULL THEN RAISE EXCEPTION 'preço não encontrado · versão=% tipo=%', v_versao_id, p_tipo; END IF;

  SELECT id INTO v_onda_id FROM va_projeto_ondas WHERE projeto_id=p_projeto AND status='ativa' ORDER BY numero DESC LIMIT 1;

  INSERT INTO va_projeto_razao (
    projeto_id, onda_id, ciclo_numero, data, tipo, quantidade,
    preco_unitario_aplicado, custo_unitario_aplicado, valor_total, fornecedor, referencia
  ) VALUES (
    p_projeto, v_onda_id, p_ciclo, CURRENT_DATE, p_tipo, p_qtd,
    COALESCE(v_preco.preco,0), COALESCE(v_preco.custo_real,0),
    COALESCE(v_preco.preco,0) * p_qtd, v_preco.fornecedor, p_referencia
  ) RETURNING id INTO v_row_id;
  RETURN v_row_id;
END; $function$;
