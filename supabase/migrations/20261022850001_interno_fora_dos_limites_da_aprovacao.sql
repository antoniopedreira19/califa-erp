-- Decisão 204, revisão de 22/10/2026: o serviço Interno fica fora dos
-- limites da aprovação.
--
-- O orçamento Interno (decisão 105) só tem F · Interno, sem honorários, e o
-- planejado acompanha o orçado. O resultado geral é, portanto, sempre 0%, e
-- o gatilho de 21/10 barrava toda aprovação de Interno feita por GP. A marca
-- é a mesma da 105: `categorias_dominio.investimento_interno` no serviço do
-- orçamento, lida por `orcamento_de_investimento_interno`.
--
-- O motivo passa a dizer o resultado geral com uma casa, no formato do
-- cabeçalho da versão, igual ao que `bloqueioAprovacaoPorLimites` mostra na
-- tela. Só troca o corpo da função: o gatilho, os grants e a revogação de
-- execução direta continuam os de `20261021850001`. Sem backfill.
create or replace function public.versao_confere_limites_na_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modelo text;
  v_planejado numeric;
  v_principal numeric;
  v_base_honorarios numeric;
  v_base_imposto numeric;
  v_honorarios numeric;
  v_int_taxes numeric := 0;
  v_imposto numeric;
  v_transacao numeric := 0;
  v_valor_job numeric;
  v_resultado numeric;
  v_negociado numeric;
  v_veiculo numeric;
  v_item_acima boolean;
begin
  if new.status <> 'aprovada' or old.status = 'aprovada' then return new; end if;
  if public.is_tenant_admin(new.tenant_id) then return new; end if;
  if public.orcamento_de_investimento_interno(new.orcamento_id) then return new; end if;

  select c.modelo_planilha into v_modelo
    from public.orcamentos o
    left join public.categorias_dominio c on c.id = o.categoria_id
   where o.id = new.orcamento_id and o.tenant_id = new.tenant_id;

  -- Base do VALOR DO JOB: save gerado fica fora; consumo continua dentro.
  -- Espelha REGRAS_TIPO_CUSTO/calcularTotaisVersao, não o faturamento.
  select coalesce(bool_or(total_planejado - total_orcado > 0.005), false),
         coalesce(sum(total_planejado), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo <> 'D'), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo not in ('C', 'FI')), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo in ('B', 'C')), 0),
         coalesce(sum(total_orcado), 0)
    into v_item_acima, v_planejado, v_principal, v_base_honorarios, v_base_imposto, v_negociado
    from public.versoes_orcamento_itens
   where versao_orcamento_id = new.id and tenant_id = new.tenant_id;

  if v_item_acima then
    raise exception 'Só o administrador pode aprovar esta versão: há item com planejado acima do orçado. Peça a aprovação ao administrador.' using errcode = '42501';
  end if;

  if v_modelo = 'midia_off' then
    -- fechamentoDosItens/contaDoNegociado: imposto sai dos honorários.
    v_veiculo := v_negociado * coalesce(new.percentual_veiculo, 80) / 100;
    v_honorarios := (case when new.base_honorarios = 'liquido' then v_veiculo else v_negociado end)
                    * coalesce(new.percentual_honorarios, 0) / 100;
    v_imposto := v_honorarios * coalesce(new.percentual_imposto, 0) / 100;
    v_valor_job := v_veiculo + v_honorarios;
    v_planejado := v_veiculo;
  else
    -- calcularResultadoOperacional: sem planejado, resultado é travessão.
    if v_planejado <= 0 then return new; end if;
    v_honorarios := v_base_honorarios * coalesce(new.percentual_honorarios, 0) / 100;
    if v_modelo = 'internacional' then
      v_int_taxes := (v_base_imposto + v_honorarios) * greatest(0, least(99.99, coalesce(new.percentual_int_taxes, 0)))
             / (100 - greatest(0, least(99.99, coalesce(new.percentual_int_taxes, 0))));
      v_transacao := coalesce(new.int_transaction_costs, 0);
    end if;
    v_imposto := (v_base_imposto + v_honorarios + v_int_taxes) * greatest(0, least(99.99, coalesce(new.percentual_imposto, 0)))
           / (100 - greatest(0, least(99.99, coalesce(new.percentual_imposto, 0))));
    v_valor_job := v_principal + v_honorarios + v_int_taxes + v_imposto + v_transacao;
    v_imposto := v_imposto + v_int_taxes + v_transacao;
  end if;

  if v_valor_job > 0 then
    v_resultado := (v_valor_job - v_imposto - v_planejado) / v_valor_job * 100;
    if v_resultado < 20 - 0.000000001 then
      -- O "%" do percentual vai no parâmetro: no formato, "%%" já é literal.
      raise exception 'Só o administrador pode aprovar esta versão: o resultado geral está em %, abaixo do mínimo de 20%%. Peça a aprovação ao administrador.',
        replace(to_char(round(v_resultado, 1), 'FM999999990.0'), '.', ',') || '%'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
