-- ═══════════════════════════════════════════════════════════════════
-- VENDA ASSESSORADA · SLICE 3 · arquétipos, anexos, teaser
-- Aditivo · não altera nenhuma tabela existente
-- ═══════════════════════════════════════════════════════════════════

-- 1) Catálogo canônico global de arquétipos (referência) ──────────
CREATE TABLE IF NOT EXISTS va_arquetipos_catalogo (
  codigo text PRIMARY KEY,
  nome text NOT NULL,
  busca text NOT NULL,
  onde_achar text,
  multiplo text,
  mensagem text,
  conversao text,
  risco text,
  captavel_por text CHECK (captavel_por IN ('scrapper','midia','rede')),
  ordem int
);

-- SEED dos 9 arquétipos canônicos
INSERT INTO va_arquetipos_catalogo (codigo, nome, busca, onde_achar, multiplo, mensagem, conversao, risco, captavel_por, ordem) VALUES
('A1','Estratégico Setorial',
 'market share, carteira, capacidade instalada',
 'concorrentes indiretos via Maps, associações setoriais',
 'paga o múltiplo mais alto, compra sinergia',
 'consolidação e escala, números primeiro',
 'baixa em volume, altíssima em valor',
 'pede muita informação antes de se comprometer, pode ser fishing',
 'scrapper', 1),
('A2','Concorrente Direto Local',
 'eliminar concorrência, absorver carteira, ganhar praça',
 'Maps raio curto, mesmo CNAE, mesma cidade',
 'múltiplo alto mas negocia duro, conhece o mercado real',
 'direta e curta, ele já sabe o que é o negócio',
 'alta, ciclo curto',
 'SIGILO CRÍTICO, se vazar espera quebrar em vez de comprar',
 'scrapper', 2),
('A3','Investidor Financeiro',
 'EBITDA estável, gestão que permanece, previsibilidade',
 'LinkedIn, grupos de investimento, indicação de contador',
 'disciplinado, paga pelo número não pela história',
 'com laudo, DCF, ISE, nada emocional',
 'média, ciclo longo, due diligence pesada',
 'some se o dono for insubstituível',
 'midia', 3),
('A4','Operador Individual',
 'renda mensal, operação que consiga tocar, negócio pronto',
 'LinkedIn (desligamentos), OLX, grupos de franquia',
 'baixo, ticket até ~R$500k',
 'faturamento, retirada mensal, rotina',
 'alta em volume e baixíssima em fechamento',
 'FINANCIAMENTO É O GARGALO, gera muito lead e pouca transação, qualificar capital cedo',
 'midia', 4),
('A5','Expansão Geográfica',
 'ponto, licenças, equipe, carteira local',
 'mesmo CNAE em capitais vizinhas, franqueadores',
 'bom, comprar sai mais barato que abrir',
 'tempo de entrada no mercado',
 'média, decisão colegiada',
 'aprovação interna longa',
 'scrapper', 5),
('A6','Integração Vertical',
 'margem da etapa adjacente, controle de fornecimento ou canal',
 'própria cadeia, fornecedores e maiores clientes',
 'alto quando a dependência é real',
 'margem capturada e segurança de cadeia',
 'alta com relação prévia',
 'universo pequeno, é lista curta não campanha',
 'scrapper', 6),
('A7','Family Office',
 'ativo de renda, perenidade, baixo envolvimento',
 'rede de contadores, advogados, private banking',
 'confortável mas exige governança',
 'estabilidade e gestão que fica',
 'baixa, ciclo muito longo',
 'não é alcançável por scrapper, é rede',
 'rede', 7),
('A8','Empreendedor por Aquisição',
 'negócio com dono saindo e potencial de profissionalização',
 'LinkedIn, comunidades de M&A, MBAs',
 'justo, negocia com técnica',
 'tese de crescimento',
 'média-alta com fit',
 'universo pequeno no Brasil, depende de capital de terceiros',
 'midia', 8),
('A9','Oportunista',
 'desconto, urgência do vendedor, distress',
 'vem sozinho, não precisa captar',
 'mais baixo',
 'sem mensagem, não é público de campanha',
 'alta em proposta e baixa em valor',
 'ALTO RUÍDO, consome tempo e ancora o preço pra baixo',
 'rede', 9)
ON CONFLICT (codigo) DO UPDATE SET
  nome=EXCLUDED.nome, busca=EXCLUDED.busca, onde_achar=EXCLUDED.onde_achar,
  multiplo=EXCLUDED.multiplo, mensagem=EXCLUDED.mensagem,
  conversao=EXCLUDED.conversao, risco=EXCLUDED.risco,
  captavel_por=EXCLUDED.captavel_por, ordem=EXCLUDED.ordem;

-- 2) Arquétipos por projeto ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_arquetipos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  codigo text NOT NULL REFERENCES va_arquetipos_catalogo(codigo),
  prioridade int,
  meta_contatos_onda int,
  queries_busca text[],
  observacao text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, codigo)
);
CREATE INDEX IF NOT EXISTS va_proj_arq_projeto ON va_projeto_arquetipos (projeto_id);

-- 3) Anexos do projeto ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  categoria text NOT NULL CHECK (categoria IN ('financeiro','juridico','operacional','fotos','videos','gerado')),
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'arquivo' CHECK (tipo IN ('arquivo','link')),
  storage_path text,
  url_externa text,
  visibilidade text NOT NULL DEFAULT 'pos_nda' CHECK (visibilidade IN ('interno','cliente','pos_nda','publico')),
  aprovado_admin boolean NOT NULL DEFAULT false,
  tamanho_bytes bigint,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS va_anexos_projeto ON va_projeto_anexos (projeto_id);

-- 4) Teaser (várias versões) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS va_projeto_teaser (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  projeto_id uuid NOT NULL REFERENCES va_projetos(id) ON DELETE CASCADE,
  versao int NOT NULL,
  texto text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','aguardando_aprovacao','aprovado','recusado')),
  comentario_cliente text,
  aprovado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (projeto_id, versao)
);
CREATE INDEX IF NOT EXISTS va_teaser_projeto ON va_projeto_teaser (projeto_id);

-- ─── RLS ──────────────────────────────────────────────────────────
ALTER TABLE va_arquetipos_catalogo  ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_arquetipos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_anexos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE va_projeto_teaser       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS va_catalogo_read       ON va_arquetipos_catalogo;
DROP POLICY IF EXISTS va_proj_arq_auth       ON va_projeto_arquetipos;
DROP POLICY IF EXISTS va_anexos_auth         ON va_projeto_anexos;
DROP POLICY IF EXISTS va_teaser_auth         ON va_projeto_teaser;

CREATE POLICY va_catalogo_read ON va_arquetipos_catalogo FOR SELECT TO authenticated USING (true);
CREATE POLICY va_proj_arq_auth ON va_projeto_arquetipos  FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_anexos_auth   ON va_projeto_anexos      FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY va_teaser_auth   ON va_projeto_teaser      FOR ALL    TO authenticated USING (true) WITH CHECK (true);

-- ─── Storage bucket privado ───────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('projeto-anexos', 'projeto-anexos', false)
ON CONFLICT (id) DO NOTHING;

-- policies em storage.objects pra este bucket
DROP POLICY IF EXISTS va_anexos_read   ON storage.objects;
DROP POLICY IF EXISTS va_anexos_insert ON storage.objects;
DROP POLICY IF EXISTS va_anexos_update ON storage.objects;
DROP POLICY IF EXISTS va_anexos_delete ON storage.objects;

CREATE POLICY va_anexos_read   ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'projeto-anexos');
CREATE POLICY va_anexos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'projeto-anexos');
CREATE POLICY va_anexos_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'projeto-anexos') WITH CHECK (bucket_id = 'projeto-anexos');
CREATE POLICY va_anexos_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'projeto-anexos');
