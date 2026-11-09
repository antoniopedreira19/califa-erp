-- =============================================================================
-- A aplicação automática aponta para a conta corrente dela (decisão 249)
-- =============================================================================
-- O banco aplica sozinho, todo dia, o que sobra na conta corrente (ContaMax no
-- Santander, Rende Fácil no BB) e resgata quando falta. A corrente fecha o dia
-- em R$ 0,00 e o dinheiro fica na aplicação: no sistema, as duas são contas
-- separadas, e só a soma faz sentido. O Tiago escolheu, em 09/11/2026, a
-- recomendação A do protótipo "Contas com aplicação": na lista da Conciliação,
-- a corrente e a aplicação viram uma linha só, com o saldo somado.
--
--   * `contas_bancarias.conta_corrente_id`: na conta de aplicação automática,
--     a corrente que ela acompanha. Nula no resto (inclusive nas XP, que são
--     investimento à parte).
--   * Uma aplicação por corrente (índice único), a conta não aponta para si
--     mesma, e o gatilho confere que a aplicação é de investimento, a corrente
--     é corrente e as duas são do mesmo tenant.
--   * Os quatro pares de hoje, que já existiam pelas regras de transferência
--     do extrato (`extrato_regras.conta_destino_id`), entram preenchidos:
--     California Santander + ContaMax, BB California + Rende Fácil, Santander
--     GoCrazy + ContaMax e Santander Hitlab + ContaMax.
--
-- Aditiva: coluna nova, nula por padrão; o preenchimento só escreve onde está
-- vazio. A tabela mantém RLS, policies e GRANT (authenticated: SELECT, INSERT,
-- UPDATE; anon: nada).
-- =============================================================================

alter table public.contas_bancarias
  add column if not exists conta_corrente_id uuid
    references public.contas_bancarias(id) on delete set null;

comment on column public.contas_bancarias.conta_corrente_id is
  'Na conta de aplicação automática (ContaMax, Rende Fácil): a conta corrente que ela acompanha. A lista da Conciliação mostra as duas numa linha só (decisão 249).';

alter table public.contas_bancarias
  drop constraint if exists contas_bancarias_corrente_nao_e_ela;
alter table public.contas_bancarias
  add constraint contas_bancarias_corrente_nao_e_ela check (conta_corrente_id is null or conta_corrente_id <> id);

create unique index if not exists uq_contas_bancarias_aplicacao_da_corrente
  on public.contas_bancarias (conta_corrente_id)
  where conta_corrente_id is not null;

create or replace function public._conta_corrente_da_aplicacao_valida()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_corrente public.contas_bancarias%rowtype;
begin
  if new.conta_corrente_id is null then
    return new;
  end if;
  if new.tipo <> 'investimento' then
    raise exception 'Só uma conta de investimento pode ser a aplicação automática de uma corrente.';
  end if;
  select * into v_corrente from public.contas_bancarias where id = new.conta_corrente_id;
  if not found or v_corrente.tenant_id <> new.tenant_id then
    raise exception 'A conta corrente da aplicação não foi encontrada.';
  end if;
  if v_corrente.tipo <> 'corrente' then
    raise exception 'A aplicação automática precisa apontar para uma conta corrente.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_conta_corrente_da_aplicacao_valida on public.contas_bancarias;
create trigger trg_conta_corrente_da_aplicacao_valida
  before insert or update of conta_corrente_id, tipo on public.contas_bancarias
  for each row execute function public._conta_corrente_da_aplicacao_valida();

-- Os pares de hoje, pelas regras de transferência do extrato: a aplicação é o
-- destino da regra, a corrente é a conta da regra. Só onde está vazio.
update public.contas_bancarias a
   set conta_corrente_id = p.corrente_id
  from (
    select distinct r.conta_destino_id as aplicacao_id, r.conta_bancaria_id as corrente_id
      from public.extrato_regras r
      join public.contas_bancarias ap on ap.id = r.conta_destino_id and ap.tipo = 'investimento'
      join public.contas_bancarias co on co.id = r.conta_bancaria_id and co.tipo = 'corrente'
     where r.conta_destino_id is not null
       and r.ativa
  ) p
 where a.id = p.aplicacao_id
   and a.conta_corrente_id is null;
