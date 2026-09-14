-- =====================================================================
-- Categorias Fee e Always On (modelo mensal) e a categoria exclusiva de
-- um serviço
--
-- Pedido do Tiago em 12/09/2026: ao escolher o serviço Fee, a única
-- categoria possível é Fee; o mesmo com Always On. E essas duas
-- categorias só existem para os seus serviços.
--
-- A RELAÇÃO É UM CAMPO, NÃO O NOME. `categorias_dominio` é lista que o
-- usuário edita; casar "serviço Fee" com "categoria Fee" pela string
-- quebraria numa renomeação (mesmo raciocínio da 072). A categoria de
-- orçamento ganha `servico_exclusivo_id`: preenchido, ela só vale para
-- aquele serviço — e o serviço que tem categoria exclusiva só aceita as
-- dele. O nome é usado UMA vez, aqui, para ligar as linhas semeadas.
--
-- As duas nascem INATIVAS. O código que entende o modelo mensal ainda
-- não está no ar; categoria ativa agora apareceria no Select de quem usa
-- a versão atual e abriria um orçamento que nenhuma tela sabe mostrar.
-- Elas são ativadas pela migration que acompanha a entrega, junto da
-- trava do serviço no orçamento.
--
-- Os 5 orçamentos que já têm serviço Fee/Always On com categoria
-- nacional ficam como estão (decisão do Tiago, 14/09/2026).
--
-- Decisão 076. Aditivo.
-- =====================================================================

-- 1) a categoria exclusiva de um serviço --------------------------------
alter table public.categorias_dominio
  add column if not exists servico_exclusivo_id uuid
    references public.categorias_dominio(id) on delete restrict;

create index if not exists idx_categorias_dominio_servico_exclusivo
  on public.categorias_dominio(servico_exclusivo_id)
  where servico_exclusivo_id is not null;

comment on column public.categorias_dominio.servico_exclusivo_id is
  'Categoria de orçamento que só vale para UM serviço (categorias_dominio de escopo projeto). Preenchida: o orçamento com esta categoria precisa ter este serviço, e o serviço só aceita as categorias exclusivas dele. Escrita só por migration. Decisão 076.';

-- 2) Fee e Always On no escopo do orçamento -----------------------------
insert into public.categorias_dominio (tenant_id, escopo, nome, modelo_planilha, ativo)
select t.id, 'orcamento'::public.categoria_dominio_escopo, n.nome,
       'mensal'::public.categoria_modelo_planilha, false
  from public.tenants t
 cross join (values ('Fee'), ('Always On')) as n(nome)
on conflict (tenant_id, escopo, lower(nome))
do update set modelo_planilha = 'mensal'::public.categoria_modelo_planilha;

update public.categorias_dominio c
   set servico_exclusivo_id = s.id
  from public.categorias_dominio s
 where c.escopo = 'orcamento'
   and c.modelo_planilha = 'mensal'
   and c.servico_exclusivo_id is null
   and s.tenant_id = c.tenant_id
   and s.escopo = 'projeto'
   and lower(s.nome) = lower(c.nome);

-- 3) a trava da categoria com modelo próprio passa a cobrir o vínculo ----
-- Mesmo corpo da 20260911000001, mais o `servico_exclusivo_id`: ele é
-- contrato de código como o modelo. `ativo` segue livre.
create or replace function public.categoria_modelo_proprio_travado()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.modelo_planilha = 'nacional' then
    return new;
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.nome is distinct from old.nome then
    raise exception
      'A categoria "%" tem modelo de planilha próprio e não pode ser renomeada.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.escopo is distinct from old.escopo then
    raise exception
      'A categoria "%" tem modelo de planilha próprio e não pode mudar de escopo.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.modelo_planilha is distinct from old.modelo_planilha then
    raise exception
      'O modelo de planilha da categoria "%" só pode ser alterado por migration.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.servico_exclusivo_id is distinct from old.servico_exclusivo_id then
    raise exception
      'O serviço da categoria "%" só pode ser alterado por migration.', old.nome
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

grant select, insert, update on public.categorias_dominio to authenticated;
