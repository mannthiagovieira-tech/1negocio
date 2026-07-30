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

### RLS · autorização é allowlist, não heurística

Nas tabelas `va_*`, a autorização de admin passa pela allowlist explícita
`va_admins` via `va_is_admin()` (SECURITY DEFINER). **Nunca** usar
proxies como "tem email no JWT" ou "tem phone" — o marketplace tem
milhares de usuários autenticados com email que NÃO devem ver dados
internos do sistema de Venda Assessorada.

Adicionar admin: `INSERT INTO va_admins (usuario_id, nome) VALUES (...);`.

Toda mudança de policy em `va_*` **termina obrigatoriamente com um teste
HTTP real** antes do commit:
1. `POST /auth/v1/token?grant_type=password` como `admin@1negocio.com.br`
2. `GET /rest/v1/va_projetos` com `Authorization: Bearer <access_token>`
3. Confirmar que retorna dados. Se não retornar, o admin foi trancado
   e a mudança precisa reverter antes do commit.

### Verificação · eu executo, não delego

Em toda tarefa que envolva DB, deploy, RLS ou auth: eu mesmo rodo o
teste e mostro o resultado real. Não peço pro usuário abrir dashboard,
rodar SQL, testar login. Se precisar de algo que só o usuário pode
fazer (senha de outra conta, chave privada em um cofre, clique em UI
externa sem API — ex: Stripe Console, Twilio Console, Supabase Studio
pra ações sem endpoint), digo exatamente o quê e por quê.

Casos onde delegar é legítimo: senha que não sei; chave/token que
não está exposto em nenhuma variável; ação em UI de terceiro sem API
programática; ação irreversível de escopo alto onde a confirmação
humana é a política de segurança.

### /projetos.html não pode ficar inacessível

`/projetos.html` é o painel operacional do usuário. Qualquer mudança
que possa trancá-lo (RLS, migração de auth, mudança de anon key,
alteração de bucket) exige teste em ambiente que reproduza o cenário
do usuário — não só o SQL no MCP. O `admin@1negocio.com.br` é o baseline
mínimo que precisa continuar logando e vendo dados após cada deploy.
