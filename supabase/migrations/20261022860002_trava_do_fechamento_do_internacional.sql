-- Decisão 206: a trava do fechamento do orçamento internacional.
--
-- As colunas da exceção nasceram em `20261022860001`. Este gatilho garante
-- a regra fora da tela:
-- - INSERT de versão internacional sem exceção nasce no padrão (int. taxes
--   18,02, custo de transação 0, alíquota fora da lista vira 19,53). A
--   coluna `percentual_int_taxes` tem default 0, e mais de um caminho cria
--   versão (orçamento novo, nova versão, duplicar, importar, planilha do
--   projeto): normalizar aqui é o que impede uma cópia de herdar a exceção.
-- - UPDATE que tira as três taxas do padrão sem exceção é recusado, e só o
--   administrador grava, troca ou remove a exceção.
-- Vale só para a sessão `authenticated`; migration e service role passam.
-- NÃO é `security definer` (a lição da decisão 072): lá dentro
-- `current_user` seria o dono da função e a trava não valeria nunca.
-- Linha já gravada fora do padrão (o 0% do SOF-P002/26-01) não é tocada:
-- o gatilho só olha as três taxas quando elas mudam.

create or replace function public.versao_fechamento_internacional_no_padrao()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_modelo text;
  v_mudou_excecao boolean;
  v_mudou_taxas boolean;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  select c.modelo_planilha::text into v_modelo
    from public.orcamentos o
    left join public.categorias_dominio c on c.id = o.categoria_id
   where o.id = new.orcamento_id and o.tenant_id = new.tenant_id;

  if v_modelo is distinct from 'internacional' then
    if new.excecao_fechamento_motivo is not null
       and (tg_op = 'INSERT' or old.excecao_fechamento_motivo is null) then
      raise exception 'A exceção no fechamento só existe no orçamento internacional.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  v_mudou_excecao := case
    when tg_op = 'INSERT' then new.excecao_fechamento_motivo is not null
    else new.excecao_fechamento_motivo is distinct from old.excecao_fechamento_motivo
      or new.excecao_fechamento_por is distinct from old.excecao_fechamento_por
      or new.excecao_fechamento_em is distinct from old.excecao_fechamento_em
  end;

  if v_mudou_excecao and not public.is_tenant_admin(new.tenant_id) then
    raise exception 'Só o administrador registra, altera ou remove a exceção no fechamento.'
      using errcode = '42501';
  end if;

  -- Versão nova sem exceção nasce no padrão.
  if tg_op = 'INSERT' and new.excecao_fechamento_motivo is null then
    new.percentual_int_taxes := 18.02;
    new.int_transaction_costs := 0;
    if new.percentual_imposto not in (0, 19.53) then
      new.percentual_imposto := 19.53;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- Tirar a exceção conta como mudar as taxas: sem ela, elas têm de
    -- voltar ao padrão no mesmo update.
    v_mudou_taxas :=
      new.percentual_int_taxes is distinct from old.percentual_int_taxes
      or new.int_transaction_costs is distinct from old.int_transaction_costs
      or new.percentual_imposto is distinct from old.percentual_imposto
      or (old.excecao_fechamento_motivo is not null and new.excecao_fechamento_motivo is null);

    if v_mudou_taxas and new.excecao_fechamento_motivo is null and (
      new.percentual_int_taxes <> 18.02
      or new.int_transaction_costs <> 0
      or new.percentual_imposto not in (0, 19.53)
    ) then
      raise exception 'Fora do padrão (int. taxes 18,02%%, impostos BR 19,53%%, sem custo de transação), o fechamento do internacional só muda por exceção do administrador.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_versao_fechamento_internacional_no_padrao on public.versoes_orcamento;
create trigger trg_versao_fechamento_internacional_no_padrao
  before insert or update of percentual_int_taxes, int_transaction_costs, percentual_imposto,
    excecao_fechamento_motivo, excecao_fechamento_por, excecao_fechamento_em
  on public.versoes_orcamento
  for each row execute function public.versao_fechamento_internacional_no_padrao();

revoke execute on function public.versao_fechamento_internacional_no_padrao() from public, anon, authenticated;
