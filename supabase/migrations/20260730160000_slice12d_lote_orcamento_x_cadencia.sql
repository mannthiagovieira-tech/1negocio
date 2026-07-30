-- ═══════════════════════════════════════════════════════════════════
-- SLICE 12d/ajuste · lote = MIN(orçamento, cadência) · sem constante
-- ═══════════════════════════════════════════════════════════════════

-- aproveitamento: % de leads que realmente viram disparo (falta wpp, blacklist)
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS aproveitamento_percent numeric(5,2) NOT NULL DEFAULT 80.0;

-- Reescrita: breakdown com por_orcamento, por_cadencia, lote, limitado_por,
-- fila_acumulada zera o lote, alerta_verba_sobrando após 2+ semanas cadência limitando.
CREATE OR REPLACE FUNCTION va_lote_semanal_calcular(p_projeto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET row_security = off AS $$
DECLARE
  v_fin record; v_cad record;
  v_semanas int; v_saldo numeric; v_saldo_semanal numeric;
  v_reserva_midia numeric;
  v_preco_import numeric; v_preco_ia numeric;
  v_preco_wpp numeric := 0.10; v_preco_lead numeric;
  v_reserva_pct numeric := 30.0; v_msgs_dia int := 20;
  v_dias_semana int[] := ARRAY[1,2,3,4,5]::int[]; v_aprov_pct numeric := 80.0;
  v_dias_uteis int; v_capacidade int;
  v_por_orc int; v_por_cad int; v_lote int;
  v_novos_fila int; v_fila_alerta boolean := false; v_fila_msg text := NULL;
  v_limitado_por text; v_cadencia_gargalo_semanas int := 0;
BEGIN
  SELECT * INTO v_fin FROM va_projeto_financeiro WHERE projeto_id = p_projeto_id;
  IF v_fin IS NULL THEN RETURN jsonb_build_object('erro','projeto sem financeiro'); END IF;

  SELECT * INTO v_cad FROM va_disparo_cadencia WHERE projeto_id = p_projeto_id;
  IF FOUND THEN
    v_reserva_pct := COALESCE(v_cad.reserva_midia_percent, 30.0);
    v_msgs_dia    := COALESCE(v_cad.mensagens_por_dia, 20);
    v_aprov_pct   := COALESCE(v_cad.aproveitamento_percent, 80.0);
    IF v_cad.dias_semana IS NOT NULL AND array_length(v_cad.dias_semana,1) > 0 THEN
      v_dias_semana := v_cad.dias_semana;
    END IF;
  END IF;

  v_saldo := COALESCE(v_fin.saldo, 0);
  v_semanas := GREATEST(1, CEIL(GREATEST(COALESCE(v_fin.dias_onda,90) - COALESCE(v_fin.dias_decorridos,0), 7) / 7.0)::int);
  v_saldo_semanal := v_saldo / v_semanas;
  v_reserva_midia := GREATEST(0, v_saldo_semanal * (v_reserva_pct / 100.0));

  SELECT preco INTO v_preco_import FROM va_precos WHERE tipo='similares_import' AND ativo LIMIT 1;
  SELECT preco INTO v_preco_ia     FROM va_precos WHERE tipo='mensagem_ia'      AND ativo LIMIT 1;
  BEGIN SELECT preco INTO v_preco_wpp FROM va_precos WHERE tipo='disparo_whatsapp' AND ativo LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_preco_wpp := 0.10; END;
  v_preco_wpp  := COALESCE(v_preco_wpp, 0.10);
  v_preco_lead := COALESCE(v_preco_import, 0.78) + COALESCE(v_preco_ia, 0.02);

  v_dias_uteis := GREATEST(1, COALESCE(array_length(v_dias_semana,1),5));
  v_capacidade := v_msgs_dia * v_dias_uteis;
  v_por_cad := GREATEST(0, FLOOR(v_capacidade * (v_aprov_pct / 100.0))::int);

  IF v_saldo_semanal - v_reserva_midia > 0 THEN
    v_por_orc := GREATEST(0, FLOOR((v_saldo_semanal - v_reserva_midia) / (v_preco_lead + v_preco_wpp))::int);
  ELSE
    v_por_orc := 0;
  END IF;

  v_lote := LEAST(v_por_orc, v_por_cad);

  SELECT COUNT(*) INTO v_novos_fila FROM va_contatos WHERE projeto_id = p_projeto_id AND estagio = 'novo';
  IF v_novos_fila > (v_capacidade * 1.5) THEN
    v_lote := 0;
    v_fila_alerta := true;
    v_fila_msg := 'Fila com ' || v_novos_fila || ' contatos não abordados — mais de uma semana e meia de trabalho parado. Nenhum lead novo gerado.';
  END IF;

  IF v_lote = 0 AND v_fila_alerta THEN v_limitado_por := 'fila_acumulada';
  ELSIF v_saldo <= 0 THEN v_limitado_por := 'sem_saldo';
  ELSIF v_por_cad < v_por_orc THEN v_limitado_por := 'cadencia';
  ELSIF v_por_orc < v_por_cad THEN v_limitado_por := 'orcamento';
  ELSE v_limitado_por := 'empate';
  END IF;

  SELECT COUNT(*) INTO v_cadencia_gargalo_semanas
  FROM va_projeto_lote_semanal
  WHERE projeto_id = p_projeto_id
    AND semana_inicio >= CURRENT_DATE - INTERVAL '21 days'
    AND breakdown->>'limitado_por' = 'cadencia';

  RETURN jsonb_build_object(
    'saldo_atual', v_saldo, 'semanas_restantes', v_semanas,
    'saldo_semanal', ROUND(v_saldo_semanal, 2),
    'reserva_midia_percent', v_reserva_pct, 'reserva_midia', ROUND(v_reserva_midia, 2),
    'mensagens_por_dia', v_msgs_dia, 'dias_uteis_semana', v_dias_uteis,
    'aproveitamento_percent', v_aprov_pct, 'preco_disparo_whatsapp', v_preco_wpp,
    'preco_lead', v_preco_lead, 'capacidade', v_capacidade,
    'por_orcamento', v_por_orc, 'por_cadencia', v_por_cad,
    'lote', v_lote, 'limitado_por', v_limitado_por,
    'novos_na_fila', v_novos_fila, 'fila_alerta', v_fila_alerta, 'fila_mensagem', v_fila_msg,
    'cadencia_gargalo_semanas_ultimas_3', v_cadencia_gargalo_semanas,
    'alerta_verba_sobrando', (v_cadencia_gargalo_semanas >= 2),
    'sem_saldo', (v_saldo <= 0), 'saldo_negativo', (v_saldo < 0),
    'frase',
      CASE
        WHEN v_fila_alerta THEN v_fila_msg
        WHEN v_saldo <= 0 THEN 'Sem saldo · gerando 0.'
        WHEN v_por_cad < v_por_orc THEN
          'O orçamento comportaria ' || v_por_orc || ' leads, mas a cadência de ' || v_msgs_dia || ' mensagens/dia trabalha ' || v_por_cad || '. Gerando ' || v_lote || '.'
        WHEN v_por_orc < v_por_cad THEN
          'A cadência comportaria ' || v_por_cad || ' leads, mas o orçamento suporta ' || v_por_orc || '. Gerando ' || v_lote || '.'
        ELSE 'Orçamento e cadência empatam em ' || v_lote || '. Gerando ' || v_lote || '.'
      END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION va_lote_semanal_calcular(uuid) TO authenticated, service_role;

-- va_lote_semanal_planejar agora lê `lote`; fila acumulada → status 'cancelado'
CREATE OR REPLACE FUNCTION va_lote_semanal_planejar(
  p_projeto_id uuid, p_semana_inicio date, p_arquetipo text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET row_security = off AS $$
DECLARE v_break jsonb; v_leads int; v_status text; v_arq text; v_id uuid;
BEGIN
  v_break := va_lote_semanal_calcular(p_projeto_id);
  v_leads := COALESCE((v_break->>'lote')::int, 0);
  IF v_leads > 0 THEN v_status := 'planejado';
  ELSIF (v_break->>'fila_alerta')::boolean THEN v_status := 'cancelado';
  ELSE v_status := 'sem_saldo';
  END IF;

  IF p_arquetipo IS NULL THEN
    SELECT pa.codigo INTO v_arq
    FROM va_projeto_arquetipos pa
    JOIN va_arquetipos_catalogo ac ON ac.codigo = pa.codigo
    WHERE pa.projeto_id = p_projeto_id AND pa.ativo AND ac.alcancavel_por_cnpj
    ORDER BY
      (SELECT COUNT(*) FROM va_projeto_lote_semanal l
       WHERE l.projeto_id = p_projeto_id AND l.arquetipo_codigo = pa.codigo) ASC,
      pa.prioridade ASC LIMIT 1;
  ELSE v_arq := p_arquetipo; END IF;

  INSERT INTO va_projeto_lote_semanal (projeto_id, semana_inicio, arquetipo_codigo, meta_quantidade, status, breakdown)
  VALUES (p_projeto_id, p_semana_inicio, v_arq, v_leads, v_status, v_break)
  ON CONFLICT (projeto_id, semana_inicio) DO UPDATE
    SET arquetipo_codigo=EXCLUDED.arquetipo_codigo, meta_quantidade=EXCLUDED.meta_quantidade,
        breakdown=EXCLUDED.breakdown,
        status=CASE WHEN va_projeto_lote_semanal.status IN ('importado','aprovado') THEN va_projeto_lote_semanal.status ELSE EXCLUDED.status END
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
