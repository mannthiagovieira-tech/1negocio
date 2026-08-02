-- CRÍTICO · portal /meu-projeto.html não reconhecia o telefone
-- Causa: va_cli_projetos filtra por usuario_id = auth.uid(), mas todos os
-- 13 registros de va_projeto_acesso tinham usuario_id NULL. A trigger que
-- cria o registro (va_gerar_setup) grava só telefone_normalizado; usuario_id
-- só é preenchido depois via va_cli_registrar_acesso — que exige o cliente
-- já ter passado pelo login (ciclo impossível de iniciar).
--
-- Fix: filtrar por (usuario_id = auth.uid()) OR (telefone_normalizado bate
-- com o phone claim do JWT). Assim funciona no primeiro login e mantém
-- compatível com registros já preenchidos.
CREATE OR REPLACE FUNCTION public.va_cli_projetos()
RETURNS SETOF va_cliente_projeto
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT v.* FROM va_cliente_projeto v
  WHERE v.projeto_id IN (
    SELECT projeto_id FROM va_projeto_acesso
    WHERE ativo = true
      AND (
        usuario_id = auth.uid()
        OR telefone_normalizado = va_normalizar_telefone(auth.jwt() ->> 'phone')
      )
  );
$$;

-- Backfill: preenche usuario_id nos acessos existentes cujo telefone bate
-- com um auth.users.phone (usuários que já autenticaram alguma vez)
UPDATE va_projeto_acesso a
SET usuario_id = u.id
FROM auth.users u
WHERE a.usuario_id IS NULL
  AND a.telefone_normalizado = va_normalizar_telefone(u.phone)
  AND u.phone IS NOT NULL AND u.phone <> '';
