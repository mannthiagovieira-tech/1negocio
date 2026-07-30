-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 7 · disparo (templates, cadência, fila)
-- (numeração 007 porque 006 já foi va_admins_allowlist)
-- Aditivo. RLS por allowlist va_admins via va_is_admin().
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS va_disparo_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  nome text NOT NULL,
  arquetipo_codigo text NULL REFERENCES va_arquetipos_catalogo(codigo),
  corpo text NOT NULL,
  versao int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aprovado','arquivado')),
  usos int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_tpl_projeto ON va_disparo_templates (projeto_id);

CREATE TABLE IF NOT EXISTS va_disparo_cadencia (
  projeto_id uuid PRIMARY KEY REFERENCES va_projetos(id) ON DELETE CASCADE,
  ativa boolean NOT NULL DEFAULT false,
  mensagens_por_dia int NOT NULL DEFAULT 4,
  hora_inicio time NOT NULL DEFAULT '09:00',
  hora_fim time NOT NULL DEFAULT '18:00',
  dias_semana int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  intervalo_minimo_min int NOT NULL DEFAULT 60,
  template_id uuid REFERENCES va_disparo_templates(id),
  ordem_fila text NOT NULL DEFAULT 'fifo' CHECK (ordem_fila IN ('fifo','manual_primeiro')),
  meta_ciclo int NOT NULL DEFAULT 50,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS va_disparo_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  contato_id uuid NOT NULL REFERENCES va_contatos(id) ON DELETE CASCADE,
  template_id uuid REFERENCES va_disparo_templates(id),
  corpo_resolvido text,
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado','enviado','entregue','falhou','cancelado')),
  agendado_para timestamptz,
  enviado_em timestamptz,
  erro text,
  zapi_message_id text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, contato_id)
);
CREATE INDEX IF NOT EXISTS va_fila_status ON va_disparo_fila (projeto_id, status, agendado_para);

-- ─── helper: avança timestamp pro próximo slot válido da janela ─
CREATE OR REPLACE FUNCTION va_proxima_janela(p_ts timestamptz, p_ini time, p_fim time, p_dias int[])
RETURNS timestamptz AS $$
DECLARE
  v_ts timestamptz := p_ts;
  v_dow int;
  v_hora time;
BEGIN
  FOR _i IN 1..14 LOOP
    v_dow := CASE WHEN extract(dow from v_ts)::int = 0 THEN 7 ELSE extract(dow from v_ts)::int END;
    v_hora := v_ts::time;
    IF v_dow = ANY(p_dias) THEN
      IF v_hora < p_ini THEN
        RETURN date_trunc('day', v_ts) + p_ini;
      ELSIF v_hora <= p_fim THEN
        RETURN v_ts;
      END IF;
    END IF;
    -- avança para 00:00 do próximo dia (loop achará hora_ini)
    v_ts := date_trunc('day', v_ts) + interval '1 day';
  END LOOP;
  RETURN v_ts;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── enfileirar disparos ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION va_enfileirar_disparos(p_projeto uuid, p_qtd int)
RETURNS jsonb AS $$
DECLARE
  v_cad va_disparo_cadencia%ROWTYPE;
  v_projeto va_projetos%ROWTYPE;
  v_saldo numeric;
  v_ciclo int;
  v_meta_bat int;
  v_tpl va_disparo_templates%ROWTYPE;
  v_contato RECORD;
  v_agenda timestamptz;
  v_enfileirados int := 0;
  v_bloqueados int := 0;
  v_corpo text;
  v_primeiro_nome text;
BEGIN
  SELECT * INTO v_cad FROM va_disparo_cadencia WHERE projeto_id = p_projeto;
  IF v_cad.projeto_id IS NULL OR NOT v_cad.ativa THEN
    RETURN jsonb_build_object('status','inativa');
  END IF;

  SELECT * INTO v_projeto FROM va_projetos WHERE id = p_projeto;

  SELECT saldo INTO v_saldo FROM va_projeto_financeiro WHERE projeto_id = p_projeto;
  IF COALESCE(v_saldo, 0) <= 0 THEN
    RETURN jsonb_build_object('status','sem_saldo');
  END IF;

  v_ciclo := floor(GREATEST((CURRENT_DATE - v_projeto.data_inicio)::numeric / 30.0, 0))::int + 1;
  SELECT COUNT(*) INTO v_meta_bat
  FROM va_projeto_razao
  WHERE projeto_id = p_projeto AND tipo = 'disparo_whatsapp' AND ciclo_numero = v_ciclo;
  IF v_meta_bat >= v_cad.meta_ciclo THEN
    RETURN jsonb_build_object('status','meta_atingida','meta',v_cad.meta_ciclo,'atingido',v_meta_bat);
  END IF;

  SELECT * INTO v_tpl FROM va_disparo_templates WHERE id = v_cad.template_id;
  IF v_tpl.id IS NULL OR v_tpl.status <> 'aprovado' THEN
    RETURN jsonb_build_object('status','template_invalido');
  END IF;

  v_agenda := va_proxima_janela(now(), v_cad.hora_inicio, v_cad.hora_fim, v_cad.dias_semana);

  FOR v_contato IN
    SELECT c.*
    FROM va_contatos c
    WHERE c.projeto_id = p_projeto
      AND c.estagio = 'novo'
      AND c.trilha = 'fria'
      AND NOT EXISTS (SELECT 1 FROM va_disparo_fila f WHERE f.projeto_id = p_projeto AND f.contato_id = c.id)
    ORDER BY
      CASE WHEN v_cad.ordem_fila = 'manual_primeiro' AND c.origem = 'manual' THEN 0 ELSE 1 END,
      c.criado_em ASC
    LIMIT (p_qtd * 3 + 50)
  LOOP
    -- Gate blacklist duro (obrigatório mesmo tendo passado na entrada)
    IF EXISTS (
      SELECT 1 FROM va_projeto_blacklist b
      WHERE b.projeto_id = p_projeto
        AND (
          (b.telefone IS NOT NULL AND v_contato.telefone_normalizado IS NOT NULL
           AND va_normalizar_telefone(b.telefone) = v_contato.telefone_normalizado)
          OR (b.cnpj IS NOT NULL AND v_contato.cnpj IS NOT NULL AND b.cnpj = v_contato.cnpj)
        )
    ) THEN
      v_bloqueados := v_bloqueados + 1;
      CONTINUE;
    END IF;

    v_primeiro_nome := NULLIF(split_part(coalesce(v_contato.nome,''),' ',1), '');
    v_corpo := v_tpl.corpo;
    v_corpo := replace(v_corpo, '{{primeiro_nome}}', COALESCE(v_primeiro_nome, ''));
    v_corpo := replace(v_corpo, '{{empresa}}',       COALESCE(v_contato.empresa, ''));
    v_corpo := replace(v_corpo, '{{cidade}}',        COALESCE(v_contato.cidade, ''));
    v_corpo := replace(v_corpo, '{{setor}}',         COALESCE(v_projeto.setor, ''));

    INSERT INTO va_disparo_fila
      (projeto_id, contato_id, template_id, corpo_resolvido, status, agendado_para)
    VALUES
      (p_projeto, v_contato.id, v_tpl.id, v_corpo, 'agendado', v_agenda);

    v_enfileirados := v_enfileirados + 1;
    v_agenda := v_agenda + make_interval(mins => v_cad.intervalo_minimo_min + (random()*30)::int);
    v_agenda := va_proxima_janela(v_agenda, v_cad.hora_inicio, v_cad.hora_fim, v_cad.dias_semana);
    EXIT WHEN v_enfileirados >= p_qtd;
  END LOOP;

  RETURN jsonb_build_object(
    'status','ok',
    'enfileirados', v_enfileirados,
    'bloqueados_blacklist', v_bloqueados
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── confirmar disparo ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION va_confirmar_disparo(
  p_fila_id uuid, p_sucesso boolean, p_zapi_id text, p_erro text
) RETURNS void AS $$
DECLARE v_fila va_disparo_fila%ROWTYPE;
BEGIN
  SELECT * INTO v_fila FROM va_disparo_fila WHERE id = p_fila_id;
  IF v_fila.id IS NULL THEN RAISE EXCEPTION 'fila % não encontrada', p_fila_id; END IF;
  IF v_fila.status IN ('entregue','falhou','cancelado') THEN
    RETURN; -- idempotência
  END IF;

  IF p_sucesso THEN
    UPDATE va_disparo_fila
      SET status='entregue', enviado_em=now(), zapi_message_id=p_zapi_id, erro=NULL
      WHERE id = p_fila_id;
    PERFORM va_debitar(v_fila.projeto_id, 'disparo_whatsapp', 1,
      'Disparo · contato ' || left(replace(v_fila.contato_id::text,'-',''), 6), NULL);
    -- move contato pra abordado com feedback auto
    PERFORM va_mover_contato(v_fila.contato_id, 'abordado', NULL, 'Disparo enviado');
    INSERT INTO va_contato_interacoes (contato_id, projeto_id, tipo, conteudo, autor)
    VALUES (v_fila.contato_id, v_fila.projeto_id, 'disparo',
            'Template ' || coalesce(v_fila.template_id::text,'') ||
            CASE WHEN p_zapi_id IS NOT NULL THEN ' · zapi '||p_zapi_id ELSE '' END,
            'sistema');
    IF v_fila.template_id IS NOT NULL THEN
      UPDATE va_disparo_templates SET usos = usos + 1 WHERE id = v_fila.template_id;
    END IF;
  ELSE
    UPDATE va_disparo_fila
      SET status='falhou', erro=COALESCE(p_erro,'sem detalhe')
      WHERE id = p_fila_id;
    -- REGRA: falha nunca consome crédito, não move contato
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── RLS: allowlist va_admins ───────────────────────────────────
ALTER TABLE va_disparo_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_disparo_cadencia  ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_disparo_fila      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_disparo_templates_admin ON va_disparo_templates;
DROP POLICY IF EXISTS va_disparo_cadencia_admin  ON va_disparo_cadencia;
DROP POLICY IF EXISTS va_disparo_fila_admin      ON va_disparo_fila;

CREATE POLICY va_disparo_templates_admin ON va_disparo_templates FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_disparo_cadencia_admin  ON va_disparo_cadencia  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
CREATE POLICY va_disparo_fila_admin      ON va_disparo_fila      FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());

GRANT EXECUTE ON FUNCTION va_enfileirar_disparos(uuid, int)        TO authenticated;
GRANT EXECUTE ON FUNCTION va_confirmar_disparo(uuid, boolean, text, text) TO authenticated;
