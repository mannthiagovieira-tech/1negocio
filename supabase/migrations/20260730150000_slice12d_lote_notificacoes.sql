-- ═══════════════════════════════════════════════════════════════════
-- SLICE 12d · lote semanal + notificações (teto 2 programadas · imediatas)
-- ═══════════════════════════════════════════════════════════════════

-- 1) va_projeto_lote_semanal ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_lote_semanal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  semana_inicio date NOT NULL,
  arquetipo_codigo text,
  meta_quantidade int NOT NULL DEFAULT 0,
  gerados int NOT NULL DEFAULT 0,
  importados int NOT NULL DEFAULT 0,
  custo_total numeric(12,2) NOT NULL DEFAULT 0,
  breakdown jsonb,
  aviso_texto text,
  aviso_enviado_em timestamptz,
  status text NOT NULL DEFAULT 'planejado'
    CHECK (status IN ('planejado','gerado','aprovado','importado','cancelado','sem_saldo')),
  cnpjs_importados jsonb,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, semana_inicio)
);

-- 2) va_disparo_cadencia · config semanal + reserva mídia + resumo qui ─
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS leads_por_semana int;
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS gerar_automaticamente boolean NOT NULL DEFAULT true;
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS dia_geracao int NOT NULL DEFAULT 0;
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS hora_geracao time NOT NULL DEFAULT '20:00';
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS dia_aviso int NOT NULL DEFAULT 1;
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS hora_aviso time NOT NULL DEFAULT '08:00';
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS reserva_midia_percent numeric(5,2) NOT NULL DEFAULT 30.0;
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS dia_resumo int NOT NULL DEFAULT 4;
ALTER TABLE va_disparo_cadencia ADD COLUMN IF NOT EXISTS hora_resumo time NOT NULL DEFAULT '17:00';

-- 3) va_notificacoes · fila unificada ─────────────────────────────
CREATE TABLE IF NOT EXISTS va_notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('programada','imediata')),
  subtipo text NOT NULL,
  corpo text NOT NULL,
  meta jsonb,
  agrupado_com uuid REFERENCES va_notificacoes(id),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','agrupado','enviado','falhou','cancelado')),
  enviado_em timestamptz,
  erro text,
  zapi_message_id text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_notificacoes_projeto_status_idx ON va_notificacoes (projeto_id, status);
CREATE INDEX IF NOT EXISTS va_notificacoes_criado_idx ON va_notificacoes (criado_em DESC);

-- 4) RPC va_notificar · registra e agrupa imediatas do dia ────────
CREATE OR REPLACE FUNCTION va_notificar(
  p_projeto_id uuid, p_tipo text, p_subtipo text, p_corpo text, p_meta jsonb DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_master uuid;
BEGIN
  IF p_tipo NOT IN ('programada','imediata') THEN RAISE EXCEPTION 'tipo inválido'; END IF;

  IF p_tipo = 'imediata' THEN
    SELECT id INTO v_master
    FROM va_notificacoes
    WHERE projeto_id = p_projeto_id AND tipo='imediata'
      AND status IN ('pendente','agrupado')
      AND criado_em::date = CURRENT_DATE AND agrupado_com IS NULL
    ORDER BY criado_em ASC LIMIT 1;

    IF v_master IS NOT NULL THEN
      UPDATE va_notificacoes
      SET corpo = corpo || E'\n\n' || p_corpo,
          meta = COALESCE(meta,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('subtipo', p_subtipo, 'meta', p_meta))
      WHERE id = v_master;
      INSERT INTO va_notificacoes (projeto_id, tipo, subtipo, corpo, meta, agrupado_com, status)
      VALUES (p_projeto_id, p_tipo, p_subtipo, p_corpo, p_meta, v_master, 'agrupado')
      RETURNING id INTO v_id; RETURN v_id;
    END IF;
  END IF;

  INSERT INTO va_notificacoes (projeto_id, tipo, subtipo, corpo, meta)
  VALUES (p_projeto_id, p_tipo, p_subtipo, p_corpo, p_meta) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION va_notificar(uuid, text, text, text, jsonb) TO authenticated, service_role;

-- 5) Triggers · eventos qualificados → imediata ───────────────────
CREATE OR REPLACE FUNCTION va_contato_estagio_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estagio IS DISTINCT FROM OLD.estagio THEN
    IF NEW.estagio = 'negociacao' THEN
      PERFORM va_notificar(NEW.projeto_id, 'imediata', 'entrou_negociacao',
        'Novo lead em negociação: ' || COALESCE(NEW.nome, NEW.empresa, 'contato'),
        jsonb_build_object('contato_id', NEW.id));
    ELSIF NEW.estagio IN ('loi','carta_intencoes') THEN
      PERFORM va_notificar(NEW.projeto_id, 'imediata', 'loi_recebida',
        'Carta de intenções recebida de ' || COALESCE(NEW.nome, NEW.empresa, 'contato'),
        jsonb_build_object('contato_id', NEW.id));
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS va_contato_estagio_notify_tg ON va_contatos;
CREATE TRIGGER va_contato_estagio_notify_tg
AFTER UPDATE OF estagio ON va_contatos
FOR EACH ROW EXECUTE FUNCTION va_contato_estagio_notify();

CREATE OR REPLACE FUNCTION va_nda_assinado_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assinado_em IS NOT NULL AND OLD.assinado_em IS NULL THEN
    PERFORM va_notificar(NEW.projeto_id, 'imediata', 'nda_assinado',
      'NDA assinado por ' || COALESCE(NEW.assinado_nome, 'contato') || '.',
      jsonb_build_object('nda_id', NEW.id, 'contato_id', NEW.contato_id));
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS va_nda_assinado_notify_tg ON va_ndas;
CREATE TRIGGER va_nda_assinado_notify_tg
AFTER UPDATE OF assinado_em ON va_ndas
FOR EACH ROW EXECUTE FUNCTION va_nda_assinado_notify();

-- 6) RPC parcelas vencendo (chamada pelo dispatcher a cada rodada) ─
CREATE OR REPLACE FUNCTION va_notificar_parcelas_vencendo()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public SET row_security = off AS $$
DECLARE r record; c int := 0;
BEGIN
  FOR r IN
    SELECT p.id, p.projeto_id, p.numero, p.vencimento, p.valor
    FROM va_projeto_parcelas p
    WHERE p.status = 'pendente'
      AND p.vencimento BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM va_notificacoes n
        WHERE n.projeto_id = p.projeto_id AND n.subtipo = 'parcela_vencendo'
          AND (n.meta->>'parcela_id')::uuid = p.id
      )
  LOOP
    PERFORM va_notificar(r.projeto_id, 'imediata', 'parcela_vencendo',
      'Parcela ' || r.numero || ' vence em ' || to_char(r.vencimento,'DD/MM') || ' (R$ ' || r.valor || ').',
      jsonb_build_object('parcela_id', r.id, 'vencimento', r.vencimento));
    c := c + 1;
  END LOOP;
  RETURN c;
END; $$;
GRANT EXECUTE ON FUNCTION va_notificar_parcelas_vencendo() TO service_role;

-- 7) RPCs cálculo/planejamento do lote (bypass RLS pra ler cadência+precos) ─
CREATE OR REPLACE FUNCTION va_lote_semanal_calcular(p_projeto_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET row_security = off AS $$
DECLARE
  v_fin record; v_cad record;
  v_semanas int; v_saldo numeric; v_saldo_semanal numeric;
  v_reserva_midia numeric; v_preco_import numeric; v_preco_ia numeric;
  v_preco_wpp numeric := 0.10; v_preco_lead numeric;
  v_custo_disparos numeric; v_disponivel numeric; v_leads int;
  v_reserva_pct numeric := 30.0; v_msgs_dia int := 20;
BEGIN
  SELECT * INTO v_fin FROM va_projeto_financeiro WHERE projeto_id = p_projeto_id;
  IF v_fin IS NULL THEN RETURN jsonb_build_object('erro','projeto sem financeiro'); END IF;
  SELECT * INTO v_cad FROM va_disparo_cadencia WHERE projeto_id = p_projeto_id;
  IF FOUND THEN
    v_reserva_pct := COALESCE(v_cad.reserva_midia_percent, 30.0);
    v_msgs_dia   := COALESCE(v_cad.mensagens_por_dia, 20);
  END IF;
  v_saldo := COALESCE(v_fin.saldo, 0);
  v_semanas := GREATEST(1, CEIL(GREATEST(COALESCE(v_fin.dias_onda,90) - COALESCE(v_fin.dias_decorridos,0), 7) / 7.0)::int);
  v_saldo_semanal := v_saldo / v_semanas;
  v_reserva_midia := v_saldo_semanal * (v_reserva_pct / 100.0);
  SELECT preco INTO v_preco_import FROM va_precos WHERE tipo='similares_import' AND ativo LIMIT 1;
  SELECT preco INTO v_preco_ia     FROM va_precos WHERE tipo='mensagem_ia'      AND ativo LIMIT 1;
  BEGIN SELECT preco INTO v_preco_wpp FROM va_precos WHERE tipo='disparo_whatsapp' AND ativo LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_preco_wpp := 0.10; END;
  v_preco_wpp  := COALESCE(v_preco_wpp, 0.10);
  v_preco_lead := COALESCE(v_preco_import, 0.78) + COALESCE(v_preco_ia, 0.02);
  v_custo_disparos := 7 * v_msgs_dia * v_preco_wpp;
  v_disponivel := GREATEST(0, v_saldo_semanal - v_reserva_midia - v_custo_disparos);
  v_leads := GREATEST(0, FLOOR(v_disponivel / v_preco_lead)::int);
  RETURN jsonb_build_object(
    'saldo_atual', v_saldo, 'semanas_restantes', v_semanas,
    'saldo_semanal', ROUND(v_saldo_semanal, 2),
    'reserva_midia_percent', v_reserva_pct, 'reserva_midia', ROUND(v_reserva_midia, 2),
    'mensagens_por_dia', v_msgs_dia, 'preco_disparo_whatsapp', v_preco_wpp,
    'custo_disparos_semana', ROUND(v_custo_disparos, 2),
    'preco_lead', v_preco_lead, 'disponivel_leads', ROUND(v_disponivel, 2),
    'leads_por_semana', v_leads,
    'sem_saldo', (v_saldo <= 0), 'saldo_negativo', (v_saldo < 0));
END; $$;
GRANT EXECUTE ON FUNCTION va_lote_semanal_calcular(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION va_lote_semanal_planejar(
  p_projeto_id uuid, p_semana_inicio date, p_arquetipo text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public SET row_security = off AS $$
DECLARE v_break jsonb; v_leads int; v_status text; v_arq text; v_id uuid;
BEGIN
  v_break := va_lote_semanal_calcular(p_projeto_id);
  v_leads := COALESCE((v_break->>'leads_por_semana')::int, 0);
  IF v_leads > 0 THEN v_status := 'planejado'; ELSE v_status := 'sem_saldo'; END IF;
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
END; $$;
GRANT EXECUTE ON FUNCTION va_lote_semanal_planejar(uuid, date, text) TO authenticated, service_role;
