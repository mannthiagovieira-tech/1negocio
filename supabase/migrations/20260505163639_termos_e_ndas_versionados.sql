-- ============================================================
-- Termos e NDAs versionados
-- 2026-05-05 · estende termos_adesao + nda_solicitacoes · cria documentos_templates
-- Aplicado via MCP em produção · este arquivo serve pra git history.
-- ============================================================

-- 1. documentos_templates · NOVA tabela
create table if not exists public.documentos_templates (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('termo_adesao','nda')),
  formato text check (formato in ('gratuito','guiado','assessorada')),
  versao int not null,
  texto text not null,
  ativo boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  notas_versao text,
  unique (tipo, formato, versao),
  constraint chk_template_formato_consistente check (
    (tipo = 'termo_adesao' and formato is not null) or
    (tipo = 'nda' and formato is null)
  )
);

create unique index if not exists uq_documentos_templates_ativo
  on public.documentos_templates (tipo, coalesce(formato,'_nda_'))
  where ativo = true;

create index if not exists idx_documentos_templates_tipo
  on public.documentos_templates(tipo);

alter table public.documentos_templates enable row level security;
drop policy if exists "templates_admin_only" on public.documentos_templates;
create policy "templates_admin_only" on public.documentos_templates
  for all using (
    exists (select 1 from public.admins a where a.id = auth.uid() and a.ativo = true)
  );

-- 2. termos_adesao · ALTER (mantém 660 linhas existentes)
alter table public.termos_adesao alter column razao_social drop not null;
alter table public.termos_adesao alter column cnpj drop not null;
alter table public.termos_adesao alter column endereco drop not null;
alter table public.termos_adesao alter column representante_nome drop not null;
alter table public.termos_adesao alter column representante_cpf drop not null;
alter table public.termos_adesao alter column email drop not null;
alter table public.termos_adesao alter column whatsapp drop not null;
alter table public.termos_adesao alter column eh_proprietario drop not null;

alter table public.termos_adesao drop constraint if exists termos_adesao_plano_check;
alter table public.termos_adesao add constraint termos_adesao_plano_check
  check (plano in ('gratuito','guiado','assessorada'));

alter table public.termos_adesao drop constraint if exists termos_adesao_comissao_pct_check;
alter table public.termos_adesao add constraint termos_adesao_comissao_pct_check
  check (comissao_pct >= 0 and comissao_pct <= 100);

alter table public.termos_adesao drop constraint if exists termos_adesao_status_check;
alter table public.termos_adesao add constraint termos_adesao_status_check
  check (status in ('pendente','gerado','enviado','visualizado','assinado','cancelado'));

alter table public.termos_adesao add column if not exists codigo text;
alter table public.termos_adesao add column if not exists template_id uuid references public.documentos_templates(id);
alter table public.termos_adesao add column if not exists link_token text;
alter table public.termos_adesao add column if not exists valor_adesao numeric default 0;
alter table public.termos_adesao add column if not exists mensalidade numeric default 0;
alter table public.termos_adesao add column if not exists forma_pagamento text;
alter table public.termos_adesao drop constraint if exists termos_adesao_forma_pagamento_check;
alter table public.termos_adesao add constraint termos_adesao_forma_pagamento_check
  check (forma_pagamento is null or forma_pagamento in ('pix','cartao','boleto','transferencia','outro'));
alter table public.termos_adesao add column if not exists notas_admin text;
alter table public.termos_adesao add column if not exists gerado_em timestamptz;
alter table public.termos_adesao add column if not exists enviado_em timestamptz;
alter table public.termos_adesao add column if not exists visualizado_em timestamptz;
alter table public.termos_adesao add column if not exists gerado_por uuid references auth.users(id);

with numbered as (
  select id, row_number() over (order by created_at, id) as n
  from public.termos_adesao
  where codigo is null
)
update public.termos_adesao t
set codigo = 'TR-' || lpad(n.n::text, 4, '0'),
    gerado_em = coalesce(t.abertura_em, t.created_at)
from numbered n
where t.id = n.id;

create unique index if not exists ux_termos_adesao_codigo on public.termos_adesao(codigo) where codigo is not null;
create unique index if not exists ux_termos_adesao_link  on public.termos_adesao(link_token) where link_token is not null;
create index if not exists idx_termos_adesao_link_btree   on public.termos_adesao(link_token);
create index if not exists idx_termos_adesao_codigo_btree on public.termos_adesao(codigo);

-- 3. nda_solicitacoes · ALTER (mantém 4 linhas)
alter table public.nda_solicitacoes drop constraint if exists nda_solicitacoes_status_check;
alter table public.nda_solicitacoes add constraint nda_solicitacoes_status_check
  check (status in ('pendente','aprovado','reprovado','em_analise','gerado','enviado','visualizado','assinado','cancelado'));

alter table public.nda_solicitacoes add column if not exists codigo text;
alter table public.nda_solicitacoes add column if not exists template_id uuid references public.documentos_templates(id);
alter table public.nda_solicitacoes add column if not exists texto_renderizado text;
alter table public.nda_solicitacoes add column if not exists assinante_ip text;
alter table public.nda_solicitacoes add column if not exists assinante_ua text;
alter table public.nda_solicitacoes add column if not exists assinado_em timestamptz;
alter table public.nda_solicitacoes add column if not exists visualizado_em timestamptz;
alter table public.nda_solicitacoes add column if not exists gerado_em timestamptz;
alter table public.nda_solicitacoes add column if not exists gerado_por uuid references auth.users(id);

with numbered as (
  select id, row_number() over (order by created_at, id) as n
  from public.nda_solicitacoes
  where codigo is null
)
update public.nda_solicitacoes nd
set codigo = 'ND-' || lpad(n.n::text, 4, '0'),
    gerado_em = coalesce(nd.created_at, now())
from numbered n
where nd.id = n.id;

create unique index if not exists ux_nda_solicitacoes_codigo on public.nda_solicitacoes(codigo) where codigo is not null;
create index if not exists idx_nda_codigo_btree on public.nda_solicitacoes(codigo);

-- 4. Sequências (start = próximo número após backfill)
create sequence if not exists public.termos_adesao_codigo_seq start 661;
create sequence if not exists public.ndas_codigo_seq start 5;

-- 5. Triggers · BEFORE INSERT codigo + BEFORE UPDATE imutabilidade
create or replace function public.fn_termo_codigo()
returns trigger language plpgsql as $func$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'TR-' || lpad(nextval('public.termos_adesao_codigo_seq')::text, 4, '0');
  end if;
  return new;
end $func$;
drop trigger if exists trg_termo_codigo on public.termos_adesao;
create trigger trg_termo_codigo before insert on public.termos_adesao
  for each row execute function public.fn_termo_codigo();

create or replace function public.fn_nda_codigo()
returns trigger language plpgsql as $func$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'ND-' || lpad(nextval('public.ndas_codigo_seq')::text, 4, '0');
  end if;
  return new;
end $func$;
drop trigger if exists trg_nda_codigo on public.nda_solicitacoes;
create trigger trg_nda_codigo before insert on public.nda_solicitacoes
  for each row execute function public.fn_nda_codigo();

create or replace function public.fn_termo_imutavel()
returns trigger language plpgsql as $func$
begin
  if old.termo_texto is not null and new.termo_texto is distinct from old.termo_texto then
    raise exception 'termo_texto eh imutavel apos preenchimento (snapshot)';
  end if;
  if old.template_id is not null and new.template_id is distinct from old.template_id then
    raise exception 'template_id eh imutavel apos atribuicao';
  end if;
  return new;
end $func$;
drop trigger if exists trg_termo_imutavel on public.termos_adesao;
create trigger trg_termo_imutavel before update on public.termos_adesao
  for each row execute function public.fn_termo_imutavel();

create or replace function public.fn_nda_imutavel()
returns trigger language plpgsql as $func$
begin
  if old.texto_renderizado is not null and new.texto_renderizado is distinct from old.texto_renderizado then
    raise exception 'texto_renderizado eh imutavel apos preenchimento (snapshot)';
  end if;
  if old.template_id is not null and new.template_id is distinct from old.template_id then
    raise exception 'template_id eh imutavel apos atribuicao';
  end if;
  return new;
end $func$;
drop trigger if exists trg_nda_imutavel on public.nda_solicitacoes;
create trigger trg_nda_imutavel before update on public.nda_solicitacoes
  for each row execute function public.fn_nda_imutavel();

-- 6. RPCs auxiliares · pré-alocar codigo antes do INSERT (edge functions usam)
create or replace function public.proximo_codigo_termo()
returns text language plpgsql security definer as $f$
begin
  return 'TR-' || lpad(nextval('public.termos_adesao_codigo_seq')::text, 4, '0');
end $f$;

create or replace function public.proximo_codigo_nda()
returns text language plpgsql security definer as $f$
begin
  return 'ND-' || lpad(nextval('public.ndas_codigo_seq')::text, 4, '0');
end $f$;

revoke execute on function public.proximo_codigo_termo() from public;
revoke execute on function public.proximo_codigo_nda() from public;
grant execute on function public.proximo_codigo_termo() to service_role;
grant execute on function public.proximo_codigo_nda() to service_role;

-- 7. Seed dos 4 templates v1 · texto está no DB · ver tabela documentos_templates
-- (insertados via migration separada `seed_documentos_templates_v1`)
