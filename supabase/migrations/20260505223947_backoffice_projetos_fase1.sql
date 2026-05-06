-- Cleanup estrutura antiga
drop table if exists public.projeto_tarefas cascade;

-- Entregáveis · cliente vê
create table if not exists public.projeto_entregaveis (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade,
  ordem int not null,
  mes_relativo int not null,
  titulo text not null,
  descricao_cliente text,
  tipo text not null check (tipo in ('onboarding','recorrente_mensal','recorrente_trimestral')),
  data_prevista date,
  status text not null default 'pendente' check (status in ('pendente','em_curso','concluido','atrasado')),
  concluido_em timestamptz,
  concluido_por_admin_id uuid references public.admins(id) on delete set null,
  notas_admin text,
  notas_cliente text,
  contador_atual int,
  contador_alvo int,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index if not exists idx_proj_entregaveis_unique on public.projeto_entregaveis(negocio_id, ordem);
create index if not exists idx_proj_entregaveis_negocio on public.projeto_entregaveis(negocio_id);
create index if not exists idx_proj_entregaveis_status on public.projeto_entregaveis(negocio_id, status);
create index if not exists idx_proj_entregaveis_data on public.projeto_entregaveis(data_prevista) where status in ('pendente','em_curso');

alter table public.projeto_entregaveis enable row level security;
create policy "admins_entregaveis_all" on public.projeto_entregaveis for all using (public.is_admin_atual());
create policy "vendedor_ve_proprios_entregaveis" on public.projeto_entregaveis for select using (
  exists (select 1 from public.negocios n where n.id = projeto_entregaveis.negocio_id and n.vendedor_id = auth.uid())
);
create trigger trg_entregaveis_updated_at before update on public.projeto_entregaveis
  for each row execute function public.fn_updated_at();

-- Tarefas internas · só admin
create table if not exists public.projeto_tarefas_internas (
  id uuid primary key default gen_random_uuid(),
  entregavel_id uuid not null references public.projeto_entregaveis(id) on delete cascade,
  ordem int not null,
  titulo text not null,
  descricao_interna text,
  concluida boolean not null default false,
  concluida_em timestamptz,
  concluida_por_admin_id uuid references public.admins(id) on delete set null,
  notas_admin text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_proj_tarefas_internas_entregavel on public.projeto_tarefas_internas(entregavel_id);
alter table public.projeto_tarefas_internas enable row level security;
create policy "admins_tarefas_internas_all" on public.projeto_tarefas_internas for all using (public.is_admin_atual());
create trigger trg_tarefas_internas_updated_at before update on public.projeto_tarefas_internas
  for each row execute function public.fn_updated_at();

-- Metadata · controle das ondas
create table if not exists public.projeto_metadata (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios(id) on delete cascade unique,
  iniciado_em timestamptz default now(),
  proxima_onda_em date,
  ultima_onda_meses int,
  status text default 'ativo' check (status in ('ativo','pausado','concluido','cancelado')),
  notas_admin text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_proj_metadata_negocio on public.projeto_metadata(negocio_id);
create index if not exists idx_proj_metadata_proxima on public.projeto_metadata(proxima_onda_em) where status = 'ativo';
alter table public.projeto_metadata enable row level security;
create policy "admins_metadata_all" on public.projeto_metadata for all using (public.is_admin_atual());
create policy "vendedor_ve_proprio_metadata" on public.projeto_metadata for select using (
  exists (select 1 from public.negocios n where n.id = projeto_metadata.negocio_id and n.vendedor_id = auth.uid())
);
create trigger trg_metadata_updated_at before update on public.projeto_metadata
  for each row execute function public.fn_updated_at();
