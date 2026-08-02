-- Tabela de templates de mensagens (config global) — usada pelo /projetos.html
-- na etapa Onboarding. Cada projeto ainda pode editar o preview sem alterar
-- o template padrão.
CREATE TABLE IF NOT EXISTS va_mensagens_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chave text NOT NULL UNIQUE,
  nome text NOT NULL,
  descricao text,
  corpo text NOT NULL,
  variaveis text[] DEFAULT ARRAY[]::text[],
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_por text
);
ALTER TABLE va_mensagens_template ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS va_mensagens_template_admin ON va_mensagens_template;
CREATE POLICY va_mensagens_template_admin ON va_mensagens_template
  FOR ALL TO authenticated USING (va_is_admin()) WITH CHECK (va_is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON va_mensagens_template TO authenticated;

INSERT INTO va_mensagens_template (chave, nome, descricao, corpo, variaveis) VALUES
('onboarding_portal', 'Onboarding · portal',
 'Primeira mensagem do envio de onboarding. Apresenta o portal do cliente.',
 E'Oi {{primeiro_nome}}, aqui é do 1negocio. Bem-vindo(a) ao seu projeto de venda assessorada.\n\nSeu portal pra acompanhar o processo: {{link_portal}}\n\nUse seu WhatsApp para receber o código de acesso.',
 ARRAY['primeiro_nome','link_portal']),
('onboarding_checklist', 'Onboarding · checklist',
 'Segunda mensagem. Lista o que o cliente precisa separar pra reunião de Avaliação.',
 E'Pra nossa primeira reunião (a Avaliação), separa:\n\n• DRE ou faturamento dos últimos 12 meses\n• Extratos bancários dos últimos 3 meses\n• Número de funcionários e sócios\n• Se possível, lista dos 10 maiores clientes\n\nNão precisa estar perfeito — a gente ajusta na reunião.',
 ARRAY[]::text[]),
('onboarding_agenda', 'Onboarding · agenda (3 opções)',
 'Terceira mensagem. {{opcoes}} vira 3 linhas numeradas com data e hora escolhidas no preview.',
 E'Para avançarmos, precisamos de uma conversa de cerca de 1h. Separei três horários:\n\n{{opcoes}}\n\nMe responde com o número da opção que funciona melhor.',
 ARRAY['opcoes'])
ON CONFLICT (chave) DO NOTHING;

-- 3 opções sugeridas + horário escolhido pelo cliente
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS opcoes_horario jsonb;
ALTER TABLE va_projetos ADD COLUMN IF NOT EXISTS horario_escolhido timestamptz;
