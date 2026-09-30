-- =====================================================================
-- Serviço Mídia, categorias Mídia On e Mídia Off, e a categoria "em breve"
--
-- Pedido do Tiago em 29/09/2026 (design aprovado no mesmo dia): um serviço
-- novo, Mídia, com duas categorias que só existem para ele:
--
-- - Mídia On abre a planilha nacional, a mesma da Ativação;
-- - Mídia Off vai ganhar um modelo de planilha próprio "em breve". Até lá
--   ela APARECE na lista da Categoria, mas não pode ser escolhida.
--
-- A EXCLUSIVIDADE É O MECANISMO DA 078. As duas categorias têm
-- `servico_exclusivo_id` = o serviço Mídia: só aparecem com ele, e ele só
-- aceita as dele. Nenhuma é `aceita_servico_interno` — o Interno não usa
-- Mídia On (resposta do Tiago). O nome é usado UMA vez, aqui, para ligar
-- as linhas semeadas; daí em diante a relação é o campo.
--
-- "EM BREVE" É UM CAMPO, NÃO O NOME. `em_breve = true`: a categoria
-- aparece travada nas listas e ninguém a grava num orçamento. Mídia Off
-- nasce `nacional` só porque o enum precisa de um valor; quando o modelo
-- dela ficar pronto, uma migration troca o modelo e desliga o `em_breve`,
-- no mesmo passo.
--
-- As três linhas nascem INATIVAS. Ativas agora, apareceriam no formulário
-- da versão do app que está no ar, que não sabe travar o Mídia Off. A
-- 20260929996002 as ativa, junto com o código (decisão 078 fez igual).
--
-- Travas no banco (regra crítica não depende da tela):
-- 1. `orcamento_servico_e_categoria_coerentes` recusa categoria em breve
--    quando o orçamento nasce com ela ou passa a usá-la;
-- 2. `categoria_vinculo_e_em_breve_travados`: o vínculo com um serviço e a
--    marca "em breve" só mudam por migration, e a categoria em breve não
--    se renomeia nem muda de escopo pela tela. Ativar e desativar seguem
--    livres, como nas categorias de planilha própria.
--
-- Decisão 131. Aditivo: coluna nova com default, três linhas novas,
-- trigger novo e uma recusa a mais numa função de trigger.
-- =====================================================================

-- 1) a categoria "em breve" -------------------------------------------
alter table public.categorias_dominio
  add column if not exists em_breve boolean not null default false;

comment on column public.categorias_dominio.em_breve is
  'Categoria de orçamento que aparece nas listas, travada, e não pode ser escolhida: o modelo de planilha dela ainda está em construção. Escrita só por migration. Decisão 131.';

-- 2) o serviço Mídia (escopo projeto) ----------------------------------
insert into public.categorias_dominio (tenant_id, escopo, nome, ativo)
select t.id, 'projeto'::public.categoria_dominio_escopo, 'Mídia', false
  from public.tenants t
on conflict (tenant_id, escopo, lower(nome)) do nothing;

-- 3) Mídia On e Mídia Off (escopo orcamento), exclusivas do Mídia -------
insert into public.categorias_dominio
  (tenant_id, escopo, nome, modelo_planilha, servico_exclusivo_id, em_breve, ativo)
select s.tenant_id, 'orcamento'::public.categoria_dominio_escopo, n.nome,
       'nacional'::public.categoria_modelo_planilha, s.id, n.em_breve, false
  from public.categorias_dominio s
 cross join (values ('Mídia On', false), ('Mídia Off', true)) as n(nome, em_breve)
 where s.escopo = 'projeto'
   and lower(s.nome) = lower('Mídia')
on conflict (tenant_id, escopo, lower(nome)) do nothing;

-- 4) o par serviço × categoria recusa a categoria em breve --------------
-- Mesmo corpo da 20260925100001 (decisão 105), mais a recusa do
-- `em_breve`, que vale para qualquer serviço, inclusive o Interno. Só
-- recusa quando a categoria é a que ENTRA (insert, ou categoria trocada).
create or replace function public.orcamento_servico_e_categoria_coerentes()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_exclusivo uuid;
  v_modelo text;
  v_aceita_interno boolean;
  v_em_breve boolean;
  v_nome_categoria text;
  v_interno boolean;
  v_nome_servico text;
  v_servico_tem_exclusiva boolean;
begin
  if tg_op = 'UPDATE'
     and new.servico_id is not distinct from old.servico_id
     and new.categoria_id is not distinct from old.categoria_id then
    return new;
  end if;
  if new.categoria_id is null then
    return new;
  end if;

  select servico_exclusivo_id, modelo_planilha::text, aceita_servico_interno,
         em_breve, nome
    into v_exclusivo, v_modelo, v_aceita_interno, v_em_breve, v_nome_categoria
    from categorias_dominio
   where id = new.categoria_id;

  -- Decisão 131: categoria em breve não entra em orçamento nenhum.
  if coalesce(v_em_breve, false) then
    if tg_op = 'INSERT' then
      raise exception 'A categoria % ainda não está disponível.', v_nome_categoria
        using errcode = 'check_violation';
    end if;
    if new.categoria_id is distinct from old.categoria_id then
      raise exception 'A categoria % ainda não está disponível.', v_nome_categoria
        using errcode = 'check_violation';
    end if;
  end if;

  if new.servico_id is null then
    return new;
  end if;

  select investimento_interno, nome
    into v_interno, v_nome_servico
    from categorias_dominio
   where id = new.servico_id;

  -- Decisão 105: o Interno escolhe entre as categorias nacionais e a
  -- Always On (mensal). Internacional, não.
  if coalesce(v_interno, false) then
    if v_modelo = 'internacional' then
      raise exception 'O serviço % não aceita categoria de planilha internacional.', v_nome_servico
        using errcode = 'check_violation';
    end if;
    if v_exclusivo is not null
       and v_exclusivo <> new.servico_id
       and not coalesce(v_aceita_interno, false) then
      raise exception 'A categoria escolhida é exclusiva de outro serviço.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if v_exclusivo is not null and v_exclusivo <> new.servico_id then
    raise exception 'A categoria escolhida é exclusiva de outro serviço.'
      using errcode = 'check_violation';
  end if;

  select exists (
    select 1 from categorias_dominio where servico_exclusivo_id = new.servico_id
  ) into v_servico_tem_exclusiva;

  if v_servico_tem_exclusiva and v_exclusivo is distinct from new.servico_id then
    raise exception 'Este serviço só aceita a categoria dele.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.orcamento_servico_e_categoria_coerentes() is
  'Recusa orçamento com categoria exclusiva de outro serviço, serviço com categoria exclusiva usando outra categoria, e categoria em breve (decisão 131). Só confere quando serviço ou categoria mudam. Decisões 076, 105 e 131.';

-- 5) vínculo com o serviço e "em breve" só por migration -----------------
-- `categoria_modelo_proprio_travado` já trava o vínculo das categorias de
-- planilha própria (Fee, Always On); Mídia On e Mídia Off são nacionais e
-- passavam por fora dele. Esta trava vale para toda categoria.
create or replace function public.categoria_vinculo_e_em_breve_travados()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.em_breve or new.servico_exclusivo_id is not null then
      raise exception 'O vínculo com um serviço e a marca "em breve" só podem ser definidos por migration.'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.em_breve is distinct from old.em_breve then
    raise exception 'A marca "em breve" da categoria "%" só pode ser alterada por migration.', old.nome
      using errcode = 'check_violation';
  end if;

  if new.servico_exclusivo_id is distinct from old.servico_exclusivo_id then
    raise exception 'O serviço da categoria "%" só pode ser alterado por migration.', old.nome
      using errcode = 'check_violation';
  end if;

  if old.em_breve then
    if new.nome is distinct from old.nome or new.escopo is distinct from old.escopo then
      raise exception 'A categoria "%" ainda está em construção e só pode ser alterada por migration.', old.nome
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.categoria_vinculo_e_em_breve_travados() is
  'O vínculo com um serviço (servico_exclusivo_id) e a marca em_breve só mudam por migration; a categoria em breve não se renomeia nem muda de escopo pela tela. Ativar e desativar seguem livres. Decisão 131.';

drop trigger if exists trg_categoria_vinculo_e_em_breve_travados on public.categorias_dominio;
create trigger trg_categoria_vinculo_e_em_breve_travados
  before insert or update on public.categorias_dominio
  for each row execute function public.categoria_vinculo_e_em_breve_travados();

grant select, insert, update on public.categorias_dominio to authenticated;
