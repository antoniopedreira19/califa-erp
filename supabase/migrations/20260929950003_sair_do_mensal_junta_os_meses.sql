-- =====================================================================
-- Decisão 128 (Tiago, 29/09/2026), opção A: sair do modelo mensal (Fee,
-- Always On) para uma categoria de planilha comum JUNTA os meses, em vez
-- de apagar os que vêm depois do primeiro.
--
-- Até aqui a troca guardava só o primeiro mês e apagava os grupos e itens
-- dos outros (decisão 078). Isso mudava o orçado e o valor do job — num
-- orçamento em que a troca é correção de categoria, o que o cliente
-- aprovou precisa continuar inteiro. E, com job, nem chegava a apagar: a
-- cópia do job (mesmo cancelado) aponta para essas linhas com chave
-- NO ACTION, e a tela avisava "os demais campos foram salvos, mas a troca
-- de planilha não foi feita", deixando a gravação pela metade. Em 29/09,
-- 3 dos 4 orçamentos Always On com job tinham mais de um mês.
--
-- Agora: todos os grupos de todos os meses passam para a planilha comum,
-- na ordem dos meses; nome de grupo que se repete entre meses ganha o nome
-- do mês ("Influenciadores · Julho"), porque sem mês o nome é único na
-- versão (`uniq_grupo_nome_por_versao`). Nenhuma linha é apagada. Vale
-- para todo orçamento, antes ou depois da aprovação.
--
-- O caminho contrário (entrar no mensal) não muda: os grupos vão para o
-- primeiro mês do período.
--
-- Mesma assinatura e mesmo `security invoker` de antes; só o ramo de
-- saída do mensal é reescrito. Nenhum dado existente muda até alguém
-- trocar a categoria na tela.
-- =====================================================================

create or replace function public.trocar_modelo_mensal_do_orcamento(
  p_orcamento_id uuid,
  p_servico_id uuid,
  p_categoria_id uuid,
  p_meses date[]
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_tenant uuid;
  v_primeiro uuid;
  v_id uuid;
  v record;
  m date;
  c_meses constant text[] := array[
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
begin
  select tenant_id into v_tenant from orcamentos where id = p_orcamento_id;
  if v_tenant is null then
    raise exception 'Orçamento não encontrado.' using errcode = 'no_data_found';
  end if;

  if coalesce(array_length(p_meses, 1), 0) > 0 then
    -- Entra no mensal: como antes, tudo vai para o primeiro mês.
    for v in select id from versoes_orcamento where orcamento_id = p_orcamento_id loop
      if exists (select 1 from versoes_orcamento_meses where versao_orcamento_id = v.id) then
        continue;
      end if;
      v_primeiro := null;
      for m in select distinct date_trunc('month', x)::date from unnest(p_meses) as x order by 1 loop
        insert into versoes_orcamento_meses (tenant_id, versao_orcamento_id, mes, created_by)
        values (v_tenant, v.id, m, auth.uid()) returning id into v_id;
        if v_primeiro is null then v_primeiro := v_id; end if;
      end loop;
      update versoes_orcamento_grupos set mes_id = v_primeiro
       where versao_orcamento_id = v.id and mes_id is null;
    end loop;
  else
    -- Sai do mensal: os meses se juntam numa planilha só.
    for v in select id from versoes_orcamento where orcamento_id = p_orcamento_id loop
      if not exists (select 1 from versoes_orcamento_meses where versao_orcamento_id = v.id) then
        continue;
      end if;

      -- 1. Nome repetido entre meses ganha o nome do mês.
      update versoes_orcamento_grupos g
         set nome = g.nome || ' · ' || c_meses[extract(month from mm.mes)::int]
        from versoes_orcamento_meses mm
       where mm.id = g.mes_id
         and g.versao_orcamento_id = v.id
         and exists (
           select 1
             from versoes_orcamento_grupos o
            where o.versao_orcamento_id = v.id
              and o.id <> g.id
              and lower(o.nome) = lower(g.nome)
         );

      -- 2. Sem mês, na ordem dos meses e, dentro do mês, na de antes.
      update versoes_orcamento_grupos g
         set mes_id = null,
             ordem = x.nova
        from (
          select g2.id,
                 row_number() over (order by mm2.mes, g2.ordem, g2.created_at) as nova
            from versoes_orcamento_grupos g2
            join versoes_orcamento_meses mm2 on mm2.id = g2.mes_id
           where g2.versao_orcamento_id = v.id
        ) x
       where g.id = x.id;

      delete from versoes_orcamento_meses where versao_orcamento_id = v.id;
    end loop;
  end if;

  update orcamentos
     set servico_id = p_servico_id,
         categoria_id = p_categoria_id
   where id = p_orcamento_id;
end;
$$;

comment on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) is
  'Decisões 078 e 128: troca de/para o modelo mensal. Entrando, os grupos vão para o primeiro mês; saindo, os meses se juntam numa planilha só (nada é apagado). Grava serviço e categoria junto.';

revoke all on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) from public, anon;
grant execute on function public.trocar_modelo_mensal_do_orcamento(uuid, uuid, uuid, date[]) to authenticated;
