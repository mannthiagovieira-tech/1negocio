-- Helper updated_at (cria se não existir)
create or replace function public.fn_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Tabela projeto_tarefas · checklist da jornada de Venda Assessorada
create table if not exists public.projeto_tarefas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  ordem int not null,
  titulo text not null,
  descricao text,
  data_prevista date,
  concluido boolean default false,
  concluido_em timestamptz,
  concluido_por_admin_id uuid references public.admins(id) on delete set null,
  notas_admin text,
  notas_cliente text,
  contador_atual int,
  contador_alvo int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_projeto_tarefas_negocio on public.projeto_tarefas(negocio_id);
create index if not exists idx_projeto_tarefas_ordem on public.projeto_tarefas(negocio_id, ordem);
create unique index if not exists ux_projeto_tarefas_negocio_ordem on public.projeto_tarefas(negocio_id, ordem);

alter table public.projeto_tarefas enable row level security;

drop policy if exists "admins_projeto_tarefas_all" on public.projeto_tarefas;
create policy "admins_projeto_tarefas_all" on public.projeto_tarefas
  for all using (public.is_admin_atual());

drop policy if exists "vendedor_ve_proprias_tarefas" on public.projeto_tarefas;
create policy "vendedor_ve_proprias_tarefas" on public.projeto_tarefas
  for select using (
    exists (select 1 from public.negocios n
      where n.id = projeto_tarefas.negocio_id
        and n.vendedor_id = auth.uid())
  );

drop trigger if exists trg_projeto_tarefas_updated_at on public.projeto_tarefas;
create trigger trg_projeto_tarefas_updated_at
  before update on public.projeto_tarefas
  for each row execute function public.fn_updated_at();
