-- Bug: trigger auto_liberar_apos_nda muda NEW.status='liberado'
-- ANTES da WITH CHECK avaliar. Policy só aceitava 'nda_assinado'.
-- Resultado: UPDATE silenciosamente bloqueado.
--
-- Fix: ampliar WITH CHECK pra aceitar ambos os estados pós-assinatura.

ALTER POLICY public_update_nda_assinado ON solicitacoes_info
  WITH CHECK (status IN ('nda_assinado', 'liberado'));

COMMENT ON POLICY public_update_nda_assinado ON solicitacoes_info IS
  'Permite comprador marcar como nda_assinado. Trigger auto_liberar_apos_nda pode refinar pra liberado em modo automatico, ambos validos.';
