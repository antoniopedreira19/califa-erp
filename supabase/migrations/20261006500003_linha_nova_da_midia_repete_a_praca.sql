-- =====================================================================
-- Linha nova da Mídia Off repete a praça e a unidade da de cima
-- (decisão 147)
--
-- No protótipo aprovado, o "+ Nova linha" de um meio nasce com a praça da
-- última linha do meio (o PM lança várias emissoras da mesma praça em
-- seguida) e, no período, com a mesma unidade ("bissemanas" segue
-- "bissemanas"). A `midia_nova_linha` da 20261006500002 nascia sempre em
-- branco. Só a função muda; nada é gravado. Aditivo.
-- =====================================================================

create or replace function public.midia_nova_linha(
  p_grupo_id uuid,
  p_praca text default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  g record;
  ultima record;
  v_ordem integer;
  v_id uuid;
  v_mes date;
begin
  select gr.id, gr.tenant_id, gr.versao_orcamento_id, gr.forma_compra, gr.formato, m.mes
    into g
    from versoes_orcamento_grupos gr
    left join versoes_orcamento_meses m on m.id = gr.mes_id
   where gr.id = p_grupo_id;
  if g.id is null or g.forma_compra is null then
    raise exception 'Meio não encontrado.' using errcode = 'no_data_found';
  end if;
  v_mes := g.mes;

  -- A de cima: a última do meio.
  select praca, unidade_periodo, ordem
    into ultima
    from versoes_orcamento_itens
   where grupo_id = p_grupo_id
   order by ordem desc
   limit 1;

  -- A ordem é global na versão (decisão 104): a linha entra logo depois
  -- da última do meio, e as de depois andam uma casa.
  v_ordem := coalesce(ultima.ordem, 0);
  if v_ordem = 0 then
    select coalesce(max(ordem), 0) into v_ordem
      from versoes_orcamento_itens where versao_orcamento_id = g.versao_orcamento_id;
  else
    update versoes_orcamento_itens
       set ordem = ordem + 1
     where versao_orcamento_id = g.versao_orcamento_id and ordem > v_ordem;
  end if;

  insert into versoes_orcamento_itens (
    tenant_id, versao_orcamento_id, grupo_id, ordem, item, tipo_custo,
    valor_unitario_orcado, quantidade_orcada, dias_meses_orcado,
    praca, peca, formato, insercoes_por_dia,
    data_inicio, data_fim, unidade_periodo,
    valor_unitario_tabela, percentual_desconto
  ) values (
    g.tenant_id, g.versao_orcamento_id, p_grupo_id, v_ordem + 1, '', 'A',
    0, 1, 1,
    coalesce(nullif(trim(coalesce(p_praca, '')), ''), ultima.praca),
    case when g.forma_compra = 'grade' then 'A' end,
    g.formato,
    case when g.forma_compra = 'grade' then '{}'::jsonb end,
    case when g.forma_compra = 'periodo' then v_mes end,
    case when g.forma_compra = 'periodo' then (v_mes + interval '1 month' - interval '1 day')::date end,
    case when g.forma_compra = 'periodo' then coalesce(ultima.unidade_periodo, 'mês') end,
    0, 0
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.midia_nova_linha(uuid, text) from public, anon;
grant execute on function public.midia_nova_linha(uuid, text) to authenticated;
