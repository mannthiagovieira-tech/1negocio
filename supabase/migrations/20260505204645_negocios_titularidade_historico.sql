-- Histórico de transferências de titularidade de negócios
create table if not exists public.negocios_titularidade_historico (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  titular_anterior_id uuid references public.usuarios(id) on delete set null,
  titular_novo_id uuid not null references public.usuarios(id) on delete restrict,
  transferido_por_admin_id uuid references public.admins(id) on delete set null,
  mensagem_enviada text,
  notificou_novo_titular boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_titularidade_negocio
  on public.negocios_titularidade_historico(negocio_id);

alter table public.negocios_titularidade_historico enable row level security;

drop policy if exists "admins_titularidade_historico" on public.negocios_titularidade_historico;
create policy "admins_titularidade_historico"
  on public.negocios_titularidade_historico
  for all using (public.is_admin_atual());
