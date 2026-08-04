# P5.2 · Backlog registrado (não construir agora)

## (a) Custom Audience por lista do banco + Lookalike — a arma B2B real

Fonte: `va_leads` filtrados por critérios (aprovado + whatsapp_verificado, ou promovidos, ou de arquétipo X).

Fluxo Meta:
1. Exportar lista → hashear telefones (SHA-256, formato Meta: E.164 sem "+")
   e emails (SHA-256, lower+trim).
2. `POST /{ad_account}/customaudiences` com `subtype='CUSTOM'`,
   `customer_file_source='USER_PROVIDED_ONLY'`.
3. `POST /{ca_id}/users` com `schema=['PHONE','EMAIL']` e o `data` hasheado
   em batches de 10k.
4. Aguardar Meta processar (24-48h · não é imediato).
5. Criar Lookalike: `POST /{ad_account}/customaudiences` com
   `subtype='LOOKALIKE'`, `origin_audience_id=CA_id`, `lookalike_spec` com
   país BR e ratio (1%-10%).

UI futura:
- Botão "Criar audiência do funil" na aba Campanhas (filtro de leads →
  hasheia local → envia).
- Campo `audiencias.incluir/excluir` do contrato já preparado no P5.2.

Custo: Custom Audience é grátis, mas exige que a lista tenha >100 leads
matcheados na plataforma pra ser utilizável.

## (b) Retargeting via Pixel do portal 1negocio.com.br

Fonte: pixel Meta já instalado no `/portal.html` / páginas de negócios.

Fluxo:
1. Confirmar pixel ID configurado no portal (pesquisar `fbq('init',`).
2. Definir eventos padrão (`ViewContent`, `Contact`, `Lead`) nas páginas
   relevantes (drawer de negócio, botão "quero saber").
3. Criar `WEBSITE` Custom Audience via `POST /{ad_account}/customaudiences`
   com `subtype='WEBSITE'` e `rule` (URL contém `/negocio.html`, últimos 30d).
4. Usar audiência em `audiencias.incluir` (retarget) ou `excluir` (evitar
   quem já converteu).

## (c) Posicionamentos manuais

Hoje: `posicionamentos='automatico'` fixo v1.

Meta permite escolher: `publisher_platforms=['facebook','instagram']`,
`facebook_positions=['feed','story','reels']`, `instagram_positions=[...]`,
`device_platforms=['mobile','desktop']`.

UI futura: dropdown avançado no builder de público (colapsado por padrão).

## (d) Advantage+ Placements vs manual

Meta hoje empurra Advantage+ (audiência automática). Deixamos `advantage_detailed=true` por default no P5.2. Quando testar CA/Lookalike, pode fazer sentido desligar Advantage e usar apenas a lista.

## Dependências

- **META_ACCESS_TOKEN na Vercel** — bloqueia tudo. Item 1 do pendente.
- **META_PIXEL_ID** — descobrir e documentar (letra b).
- **Consentimento LGPD** — validar com jurídico antes de subir lista de leads
  hasheada pro Meta (base legítima de interesse OU consentimento explícito).
