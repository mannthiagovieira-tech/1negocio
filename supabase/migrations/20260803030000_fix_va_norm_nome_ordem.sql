-- Fix: lower() precisa vir ANTES do regexp_replace('[^a-z0-9 ]'),
-- senão letras maiúsculas do input eram apagadas (regex case-sensitive)
-- e o trigger de blacklist falhava silenciosamente pra qualquer nome
-- passado em CAIXA-ALTA (que é o padrão do Kipflow: "PILATE INDUSTRIA").
CREATE OR REPLACE FUNCTION public.va_norm_nome(txt text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    lower(translate(
      COALESCE(txt,''),
      'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇñÑ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcCnN'
    )),
    '[^a-z0-9 ]', '', 'g'
  );
$$;
