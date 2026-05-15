-- Adicionar estrutura prompts_textos_ia ao snapshot v2026.07
-- Prompts serão populados em sub-passo 4.2 após revisão do Thiago
-- Spec rev3 §11

UPDATE parametros_versoes
SET snapshot = jsonb_set(
  snapshot,
  '{prompts_textos_ia}',
  '{
    "_versao": "0.1-estrutura",
    "_status": "aguardando_prompts",
    "laudo": {
      "texto_resumo_executivo_completo": null,
      "texto_contexto_negocio": null,
      "texto_parecer_tecnico": null,
      "texto_riscos_atencao": null,
      "texto_diferenciais": null,
      "texto_publico_alvo_comprador": null,
      "descricoes_polidas_upsides": null
    },
    "anuncio": {
      "sugestoes_titulo_anuncio": null,
      "texto_consideracoes_valor": null
    },
    "config": {
      "limite_caracteres_titulo_anuncio": 50,
      "quantidade_sugestoes_titulo": 3
    }
  }'::jsonb
)
WHERE id = 'v2026.07';
