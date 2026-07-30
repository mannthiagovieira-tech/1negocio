# CLAUDE.md · regras do projeto 1Negócio

Este arquivo carrega automaticamente em qualquer sessão do Claude Code
neste repositório. Regras aqui têm precedência sobre convenções
comuns e devem ser seguidas literalmente.

## Regras críticas

### Auth · nunca criar usuário por INSERT direto em `auth.users`

Sempre usar `supabase.auth.admin.createUser()` (via `supabase-js` em
edge functions) ou o endpoint HTTP `POST /auth/v1/admin/users`.

**Insert manual em `auth.users` deixa colunas de token em `NULL`** —
`confirmation_token`, `email_change`, `email_change_token_new`,
`email_change_token_current`, `recovery_token`, `phone_change`,
`phone_change_token`, `reauthentication_token`. O parser Go do GoTrue
declara essas colunas como `string` (não `sql.NullString`) e explode
com **`Database error querying schema`** (HTTP 500,
`error_code: unexpected_failure`) no próximo login desse usuário.

Vale também para: seeds SQL, scripts de migração de dados, backup/restore
manual e qualquer via que não passe pela Admin API do GoTrue.

Se aparecer o erro de novo, o fix pontual é:
`UPDATE auth.users SET <col> = COALESCE(<col>, '') WHERE <col> IS NULL`
para cada uma das 8 colunas acima. Mas o certo é não deixar entrar NULL
em primeiro lugar.
