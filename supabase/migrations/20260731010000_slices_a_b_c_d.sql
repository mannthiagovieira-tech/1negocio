-- ═══════════════════════════════════════════════════════════════════
-- MODO AUTÔNOMO · 4 slices em sequência (A/B/C/D)
-- ═══════════════════════════════════════════════════════════════════
-- A: Parceiros · B: Landing pública · C: Cockpit carteira · D: Revisão D+60
-- Migrations aplicadas via MCP em ordem. Resumo abaixo pra reprodução.

-- ─ SLICE A · Parceiros ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_parceiros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL, empresa text, telefone text, telefone_normalizado text,
  email text, cnpj text, cidade text, estado text,
  regioes_atuacao text[], setores_atuacao text[],
  faixa_porte_min numeric, faixa_porte_max numeric,
  tipo text CHECK (tipo IN ('corretor','contador','advogado','consultoria','outro')),
  percentual_padrao numeric(5,2),
  status text NOT NULL DEFAULT 'candidato' CHECK (status IN ('candidato','abordado','homologado','inativo')),
  origem text, observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (telefone_normalizado)
);
CREATE TABLE IF NOT EXISTS va_parceiro_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  parceiro_id uuid NOT NULL REFERENCES va_parceiros(id) ON DELETE CASCADE,
  percentual_ofertado numeric(5,2),
  token_publico text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(24),'hex'),
  enviado_em timestamptz NOT NULL DEFAULT now(), visualizado_em timestamptz,
  status text NOT NULL DEFAULT 'enviado' CHECK (status IN ('enviado','visualizado','indicou','recusou')),
  janela_dias int NOT NULL DEFAULT 180,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, parceiro_id)
);
CREATE TABLE IF NOT EXISTS va_parceiro_indicacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envio_id uuid NOT NULL REFERENCES va_parceiro_envios(id) ON DELETE CASCADE,
  parceiro_id uuid NOT NULL REFERENCES va_parceiros(id) ON DELETE CASCADE,
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  nome text, telefone text, telefone_normalizado text, empresa text, contexto text,
  contato_id uuid REFERENCES va_contatos(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'registrada' CHECK (status IN ('registrada','duplicada','bloqueada','convertida')),
  motivo_status text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
-- RPCs completas aplicadas via MCP: va_parceiros_match, va_parceiro_enviar,
-- va_parceiro_indicar (registra em antessala + notifica), va_parceiro_envio_publico.

-- ─ SLICE B · Landing ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_landing (
  projeto_id uuid PRIMARY KEY REFERENCES va_projetos(id) ON DELETE CASCADE,
  slug text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16),'hex'),
  titulo text, subtitulo text, corpo text,
  destaques jsonb, imagens jsonb, canal_sufixo text,
  ativa boolean NOT NULL DEFAULT false,
  aprovada_admin boolean NOT NULL DEFAULT false,
  visualizacoes int NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
-- RPC va_landing_publica(slug) só devolve se ativa AND aprovada_admin.

-- ─ SLICE C · Cockpit da carteira ─────────────────────────────────
-- VIEW va_carteira_resumo · uma consulta agrega tudo:
-- receita_recorrente, orçamento, gasto, saldo, comissão líquida projetada,
-- contadores de estágios, dias restantes, próxima parcela.
-- VIEW va_carteira_cockpit · agregação total pra faixa consolidada.

-- ─ SLICE D · Revisão D+60 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_revisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  onda_id uuid REFERENCES va_projeto_ondas(id) ON DELETE CASCADE,
  data_prevista date NOT NULL, data_realizada date,
  payload jsonb,
  decisao_preco text CHECK (decisao_preco IN ('manter','ajustar','reavaliar')),
  decisao_teaser text CHECK (decisao_teaser IN ('manter','ajustar','refazer')),
  decisao_arquetipos text CHECK (decisao_arquetipos IN ('manter','ajustar','refazer')),
  decisao_campanhas text CHECK (decisao_campanhas IN ('manter','ajustar','encerrar')),
  decisao_estrategia text CHECK (decisao_estrategia IN ('manter','ajustar','repactuar')),
  observacoes text,
  status text NOT NULL DEFAULT 'agendada' CHECK (status IN ('agendada','realizada','adiada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onda_id)
);
-- RPC va_gerar_revisao_d60(onda_id) congela evidência dos 5 eixos em payload.
-- Cron /api/cron-revisao-d60 (diário 12:30 UTC) gera automaticamente.
