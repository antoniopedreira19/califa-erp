-- =====================================================================
-- Decisão 122, revisão de 29/09/2026: número de projeto nunca volta a ser
-- usado.
--
-- O sequencial do código do projeto (`gerarCodigoProjeto`) é o maior
-- número JÁ EXISTENTE na sigla e no ano + 1. Com a troca de cliente
-- (decisão 122), o projeto que sai de uma sigla leva o código junto; se
-- era o de maior número, o próximo projeto da sigla antiga ganharia o
-- mesmo código — e uma planilha ou conversa antiga passaria a apontar
-- para outro projeto. O mesmo já acontecia com projeto apagado (a limpeza
-- de 21/09/2026 liberou AMB-0002/26, NOV-0002/26 e mais 13).
--
-- Pedido do Tiago: "Melhor garantir que não ocorrerão conflitos."
--
-- 1) `codigos_de_projeto_usados`: todo código que um projeto já teve, por
--    tenant. Só cresce.
-- 2) Gatilho em `projetos` (insert e troca de código) registra o código.
-- 3) Carga inicial: os códigos atuais, o `codigo_anterior` da decisão 114,
--    e os códigos da auditoria (`projeto.criado`, que cobre os projetos
--    apagados, e `projeto.codigo_trocado`, de antes e de depois).
-- O gerador passa a considerar este registro no "maior número da sigla".
--
-- Aditiva: tabela, função e gatilho novos; a carga só insere.
-- =====================================================================

create table if not exists public.codigos_de_projeto_usados (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  codigo text not null,
  -- Nulo quando o projeto não existe mais (apagado na limpeza).
  projeto_id uuid references public.projetos(id) on delete set null,
  registrado_em timestamptz not null default now(),
  primary key (tenant_id, codigo)
);

comment on table public.codigos_de_projeto_usados is
  'Todo código que um projeto da produção já teve (decisão 122). Só cresce: o gerador pula estes números, e código não volta a ser usado.';

create index if not exists codigos_de_projeto_usados_projeto_id_idx
  on public.codigos_de_projeto_usados (projeto_id);

alter table public.codigos_de_projeto_usados enable row level security;

drop policy if exists codigos_de_projeto_usados_select on public.codigos_de_projeto_usados;
create policy codigos_de_projeto_usados_select
  on public.codigos_de_projeto_usados
  for select to authenticated
  using (is_tenant_member(tenant_id));

-- Só leitura para quem usa o app; quem escreve é o gatilho.
revoke all on public.codigos_de_projeto_usados from anon, authenticated;
grant select on public.codigos_de_projeto_usados to authenticated;

-- ---------------------------------------------------------------------
-- Gatilho: registra o código na criação e em cada troca
-- ---------------------------------------------------------------------
create or replace function public.registrar_codigo_de_projeto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.codigo is not null
     and (tg_op = 'INSERT' or new.codigo is distinct from old.codigo) then
    insert into public.codigos_de_projeto_usados (tenant_id, codigo, projeto_id)
    values (new.tenant_id, new.codigo, new.id)
    on conflict (tenant_id, codigo) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.registrar_codigo_de_projeto() from public, anon;

drop trigger if exists trg_projetos_registra_codigo on public.projetos;
create trigger trg_projetos_registra_codigo
  after insert or update of codigo on public.projetos
  for each row execute function public.registrar_codigo_de_projeto();

-- ---------------------------------------------------------------------
-- Carga inicial
-- ---------------------------------------------------------------------
insert into public.codigos_de_projeto_usados (tenant_id, codigo, projeto_id)
select p.tenant_id, p.codigo, p.id
  from public.projetos p
 where p.codigo is not null
on conflict (tenant_id, codigo) do nothing;

insert into public.codigos_de_projeto_usados (tenant_id, codigo, projeto_id)
select p.tenant_id, p.codigo_anterior, p.id
  from public.projetos p
 where p.codigo_anterior is not null
on conflict (tenant_id, codigo) do nothing;

insert into public.codigos_de_projeto_usados (tenant_id, codigo, projeto_id)
select a.tenant_id,
       c.codigo,
       (select p.id from public.projetos p where p.id::text = a.entidade_id)
  from public.audit_events a
  cross join lateral (
    values (a.metadata ->> 'codigo'), (a.metadata ->> 'codigo_anterior')
  ) as c(codigo)
 where a.acao in ('projeto.criado', 'projeto.codigo_trocado')
   and a.tenant_id is not null
   and c.codigo is not null
   and c.codigo <> ''
on conflict (tenant_id, codigo) do nothing;
