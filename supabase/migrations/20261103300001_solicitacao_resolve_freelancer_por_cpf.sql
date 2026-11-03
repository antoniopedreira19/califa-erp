-- Solicitação de contratação: resolve freelancer_id automaticamente pelo CPF.
--
-- Contexto: a lista de /freelancers/solicitacoes mostra "Contratação" vs
-- "Renovação" com base em freelancer_solicitacoes.freelancer_id — se tiver
-- link pro cadastro é renovação, senão contratação. O form na criação já
-- detecta via debounce de CPF se o freela existe, mas NÃO enviava o id pro
-- server. Resultado: solicitações pra freelas cadastrados caíam como
-- "contratação" (10 registros no histórico).
--
-- Esta migration:
--   1. Cria trigger BEFORE INSERT OR UPDATE em freelancer_solicitacoes que
--      resolve freelancer_id via CPF (mesmo tenant). Age como rede de
--      segurança: cobre qualquer caminho — form novo, API direto, script,
--      bulk import. Zero mudança no fluxo quando freelancer_id já veio
--      preenchido ou quando cpf_freela é null.
--   2. Faz backfill nas solicitações existentes que estavam órfãs mas o
--      CPF bate com algum freela cadastrado.
--
-- A regra de migração de responsável (quando solicitante != responsável
-- atual, migrar na aprovação) fica no server action aprovarSolicitacao,
-- não aqui — depende de session (quem aprovou) que não é visível pro DB.

create or replace function public.resolver_freelancer_id_por_cpf()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.freelancer_id is null and new.cpf_freela is not null then
    select id into new.freelancer_id
    from public.freelancers
    where tenant_id = new.tenant_id
      and cpf = new.cpf_freela
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_solicitacao_resolve_freelancer_id
  on public.freelancer_solicitacoes;

create trigger trg_solicitacao_resolve_freelancer_id
  before insert or update of cpf_freela, freelancer_id
  on public.freelancer_solicitacoes
  for each row
  execute function public.resolver_freelancer_id_por_cpf();

-- Backfill: amarra as órfãs ao cadastro correspondente. Só toca linhas
-- que estão sem freelancer_id — não mexe nas já vinculadas.
update public.freelancer_solicitacoes s
set freelancer_id = f.id
from public.freelancers f
where f.cpf = s.cpf_freela
  and f.tenant_id = s.tenant_id
  and s.freelancer_id is null
  and s.cpf_freela is not null;
