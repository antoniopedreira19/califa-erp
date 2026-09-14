-- =====================================================================
-- Ações dos meses do orçamento mensal, cada uma numa transação só
--
-- Quatro operações mexem em mais de uma tabela de uma vez e não podem
-- ficar pela metade — mesma razão da `deletar_grupo_orcamento`
-- (20260904100001): dois deletes do PostgREST são duas transações, e se o
-- segundo falhar sobra um estado que ninguém pediu.
--
--   adicionar_mes_na_versao   mês novo + período do orçamento
--   remover_mes_da_versao     itens + grupos + mês + período (nunca o último)
--   copiar_mes_da_versao      grupos e itens de um mês para outro VAZIO
--   trocar_modelo_mensal_do_orcamento
--                             entrar ou sair do modelo mensal ao trocar a
--                             categoria: entrando, os grupos vão para o
--                             primeiro mês; saindo, só o primeiro mês fica
--
-- Regras do Tiago (14/09/2026): apagar mês é permitido, mas o orçamento
-- nunca fica sem mês; o período acompanha os meses; copiar só para mês
-- vazio; trocar de/para Fee ou Always On pede confirmação e, saindo do
-- mensal, só o primeiro mês permanece.
--
-- O período novo é calculado no TypeScript (`periodoQueAcompanhaOsMeses`,
-- lib/calculos/meses-trimestre.ts, com testes) e chega pronto: a regra de
-- "manter o dia digitado" tem um lugar só. Aqui ele só é gravado junto.
--
-- SECURITY INVOKER: as policies de tenant valem como em qualquer outro
-- caminho. Regras que devolvem frase de tela (versão aprovada, permissão)
-- ficam nas server actions; aqui só o que garante o estado.
--
-- Decisão 076. Aditivo: só funções novas.
-- =====================================================================

create or replace function public.adicionar_mes_na_versao(
  p_versao_id uuid,
  p_mes date,
  p_inicio date,
  p_fim date
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
  v_orcamento uuid;
  v_id uuid;
begin
  select tenant_id, orcamento_id
    into v_tenant, v_orcamento
    from versoes_orcamento
   where id = p_versao_id;

  if v_tenant is null then
    raise exception 'Versão não encontrada.' using errcode = 'no_data_found';
  end if;

  -- O trigger de mesmo trimestre e o unique por mês fazem a conferência.
  insert into versoes_orcamento_meses (tenant_id, versao_orcamento_id, mes, created_by)
  values (v_tenant, p_versao_id, date_trunc('month', p_mes)::date, auth.uid())
  returning id into v_id;

  if p_inicio is not null and p_fim is not null then
    update orcamentos
       set data_inicio_prevista = p_inicio,
           data_fim_prevista = p_fim
     where id = v_orcamento;
  end if;

  return v_id;
end;
$$;

create or replace function public.remover_mes_da_versao(
  p_mes_id uuid,
  p_inicio date,
  p_fim date
)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_versao uuid;
  v_orcamento uuid;
  v_qtd integer;
begin
  select m.versao_orcamento_id, v.orcamento_id
    into v_versao, v_orcamento
    from versoes_orcamento_meses m
    join versoes_orcamento v on v.id = m.versao_orcamento_id
   where m.id = p_mes_id;

  if v_versao is null then
    raise exception 'Mês não encontrado.' using errcode = 'no_data_found';
  end if;

  select count(*) into v_qtd
    from versoes_orcamento_meses
   where versao_orcamento_id = v_versao;

  if v_qtd <= 1 then
    raise exception 'O orçamento precisa ter pelo menos um mês.'
      using errcode = 'check_violation';
  end if;

  -- Ordem explícita: item -> grupo -> mês, por causa dos RESTRICT.
  -- `itens_bv` e `saves_consumos` caem por CASCADE a partir do item.
  delete from versoes_orcamento_itens
   where grupo_id in (select id from versoes_orcamento_grupos where mes_id = p_mes_id);
  delete from versoes_orcamento_grupos where mes_id = p_mes_id;
  delete from versoes_orcamento_meses where id = p_mes_id;

  if p_inicio is not null and p_fim is not null then
    update orcamentos
       set data_inicio_prevista = p_inicio,
           data_fim_prevista = p_fim
     where id = v_orcamento;
  end if;
end;
$$;

create or replace function public.copiar_mes_da_versao(
  p_origem_mes_id uuid,
  p_destino_mes_id uuid
)
returns integer
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_versao uuid;
  v_versao_destino uuid;
  v_tenant uuid;
  v_ordem_grupo integer;
  v_ordem_item integer;
  v_novo uuid;
  v_n integer;
  v_qtd integer := 0;
  g record;
begin
  select versao_orcamento_id, tenant_id
    into v_versao, v_tenant
    from versoes_orcamento_meses
   where id = p_origem_mes_id;
  select versao_orcamento_id
    into v_versao_destino
    from versoes_orcamento_meses
   where id = p_destino_mes_id;

  if v_versao is null or v_versao_destino is null then
    raise exception 'Mês não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_versao <> v_versao_destino then
    raise exception 'Os dois meses precisam ser da mesma versão.'
      using errcode = 'check_violation';
  end if;
  if p_origem_mes_id = p_destino_mes_id then
    raise exception 'Escolha um mês diferente do atual.'
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from versoes_orcamento_grupos where mes_id = p_destino_mes_id) then
    raise exception 'O mês de destino já tem grupos. Só é possível copiar para um mês vazio.'
      using errcode = 'check_violation';
  end if;

  -- A ordem de grupos e itens é global na versão: a cópia vai para o fim.
  select coalesce(max(ordem), 0) into v_ordem_grupo
    from versoes_orcamento_grupos where versao_orcamento_id = v_versao;
  select coalesce(max(ordem), 0) into v_ordem_item
    from versoes_orcamento_itens where versao_orcamento_id = v_versao;

  for g in
    select id, nome
      from versoes_orcamento_grupos
     where mes_id = p_origem_mes_id
     order by ordem
  loop
    v_ordem_grupo := v_ordem_grupo + 1;
    insert into versoes_orcamento_grupos (tenant_id, versao_orcamento_id, nome, ordem, mes_id)
    values (v_tenant, v_versao, g.nome, v_ordem_grupo, p_destino_mes_id)
    returning id into v_novo;

    -- Mesmas colunas que `duplicarVersao` copia: BV, save e o planejado
    -- congelado não atravessam — são do mês de origem.
    insert into versoes_orcamento_itens (
      tenant_id, versao_orcamento_id, grupo_id, ordem, categoria_id,
      planilha_origem, item, tipo_custo,
      valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
      valor_unitario_planejado, quantidade_planejada, dias_meses_planejado,
      fornecedor_id, observacoes
    )
    select v_tenant, v_versao, v_novo,
           v_ordem_item + row_number() over (order by i.ordem),
           i.categoria_id, i.planilha_origem, i.item, i.tipo_custo,
           i.valor_unitario_orcado, i.quantidade_orcada, i.dias_meses_orcado,
           i.valor_unitario_planejado, i.quantidade_planejada, i.dias_meses_planejado,
           i.fornecedor_id, i.observacoes
      from versoes_orcamento_itens i
     where i.grupo_id = g.id;

    get diagnostics v_n = row_count;
    v_ordem_item := v_ordem_item + v_n;
    v_qtd := v_qtd + v_n;
  end loop;

  return v_qtd;
end;
$$;

-- Serviço e categoria são gravados JUNTOS aqui: a trava do par serviço ×
-- categoria (trigger da migration de ativação) confere os dois na mesma
-- linha, e gravar um antes do outro deixaria o par incoerente no meio.
create or replace function public.trocar_modelo_mensal_do_orcamento(
  p_orcamento_id uuid,
  p_servico_id uuid,
  p_categoria_id uuid,
  -- Meses do período quando ENTRA no mensal; vazio ou nulo quando SAI.
  p_meses date[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
  v_primeiro uuid;
  v_id uuid;
  v record;
  m date;
begin
  select tenant_id into v_tenant from orcamentos where id = p_orcamento_id;
  if v_tenant is null then
    raise exception 'Orçamento não encontrado.' using errcode = 'no_data_found';
  end if;

  if coalesce(array_length(p_meses, 1), 0) > 0 then
    -- ENTRANDO: toda versão ganha os meses do período, e os grupos que ela
    -- já tinha vão para o primeiro deles.
    for v in select id from versoes_orcamento where orcamento_id = p_orcamento_id loop
      if exists (select 1 from versoes_orcamento_meses where versao_orcamento_id = v.id) then
        continue;
      end if;
      v_primeiro := null;
      for m in
        select distinct date_trunc('month', x)::date
          from unnest(p_meses) as x
         order by 1
      loop
        insert into versoes_orcamento_meses (tenant_id, versao_orcamento_id, mes, created_by)
        values (v_tenant, v.id, m, auth.uid())
        returning id into v_id;
        if v_primeiro is null then
          v_primeiro := v_id;
        end if;
      end loop;
      update versoes_orcamento_grupos
         set mes_id = v_primeiro
       where versao_orcamento_id = v.id
         and mes_id is null;
    end loop;
  else
    -- SAINDO: fica só o primeiro mês de cada versão; os grupos dele deixam
    -- de ter mês, e o resto sai com os itens.
    for v in select id from versoes_orcamento where orcamento_id = p_orcamento_id loop
      select id into v_primeiro
        from versoes_orcamento_meses
       where versao_orcamento_id = v.id
       order by mes
       limit 1;
      if v_primeiro is null then
        continue;
      end if;
      delete from versoes_orcamento_itens
       where grupo_id in (
         select id from versoes_orcamento_grupos
          where versao_orcamento_id = v.id
            and mes_id is not null
            and mes_id <> v_primeiro
       );
      delete from versoes_orcamento_grupos
       where versao_orcamento_id = v.id
         and mes_id is not null
         and mes_id <> v_primeiro;
      update versoes_orcamento_grupos
         set mes_id = null
       where versao_orcamento_id = v.id
         and mes_id = v_primeiro;
      delete from versoes_orcamento_meses where versao_orcamento_id = v.id;
    end loop;
  end if;

  update orcamentos
     set servico_id = p_servico_id,
         categoria_id = p_categoria_id
   where id = p_orcamento_id;
end;
$$;

comment on function public.adicionar_mes_na_versao(uuid, date, date, date) is
  'Mês novo na versão do orçamento mensal + período do orçamento, numa transação. Decisão 076.';
comment on function public.remover_mes_da_versao(uuid, date, date) is
  'Apaga itens, grupos e o mês (nunca o último) + período do orçamento, numa transação. Decisão 076.';
comment on function public.copiar_mes_da_versao(uuid, uuid) is
  'Copia grupos e itens de um mês para outro mês VAZIO da mesma versão. Devolve quantos itens copiou. Decisão 076.';
comment on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) is
  'Troca a categoria do orçamento entrando (meses do período; grupos vão para o 1º mês) ou saindo (só o 1º mês fica) do modelo mensal. Decisão 076.';

revoke all on function public.adicionar_mes_na_versao(uuid, date, date, date) from public, anon;
revoke all on function public.remover_mes_da_versao(uuid, date, date) from public, anon;
revoke all on function public.copiar_mes_da_versao(uuid, uuid) from public, anon;
revoke all on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) from public, anon;
grant execute on function public.adicionar_mes_na_versao(uuid, date, date, date) to authenticated;
grant execute on function public.remover_mes_da_versao(uuid, date, date) to authenticated;
grant execute on function public.copiar_mes_da_versao(uuid, uuid) to authenticated;
grant execute on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) to authenticated;
