-- Decisão 204: exceções do orçamento e da PP exigem administrador.
-- Só valida novas aprovações/envios; não altera registros existentes.
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
      raise exception 'Só o administrador pode aprovar esta versão: o resultado geral está abaixo de 20%%. Peça a aprovação ao administrador.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.versao_confere_limites_na_aprovacao() from public, anon, authenticated;
create trigger trg_versao_confere_limites_na_aprovacao
before update of status on public.versoes_orcamento
for each row execute function public.versao_confere_limites_na_aprovacao();

create or replace function public.pp_confere_orcado_no_envio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orcado numeric;
  v_realizado numeric;
  v_devolvido numeric;
begin
  if new.status <> 'em_avaliacao' then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  if public.is_tenant_admin(new.tenant_id) then return new; end if;

  -- Mesma âncora que o recálculo do realizado atualiza: serializa o envio
  -- com geração/edição/cancelamento de PP e devolução de verba do item.
  perform 1 from public.jobs_itens_realizado
   where id = new.item_realizado_id and tenant_id = new.tenant_id for update;
  select o.total_orcado into v_orcado
    from public.jobs_itens_realizado r
    join public.jobs_itens_orcado o on o.id = r.job_item_orcado_id
   where r.id = new.item_realizado_id and r.tenant_id = new.tenant_id
     and o.tenant_id = new.tenant_id;
  if v_orcado is null then
    raise exception 'Não foi possível conferir o orçado do item da PP.';
  end if;
  select coalesce(sum(p.valor), 0) + new.valor into v_realizado
    from public.pedidos_compra p
   where p.item_realizado_id = new.item_realizado_id and p.tenant_id = new.tenant_id
     and p.id <> new.id and p.status <> 'cancelada';
  select coalesce(sum(pv.valor_devolvido), 0) into v_devolvido
    from public.pp_verba_prestacoes pv
    join public.pedidos_compra p on p.id = pv.pedido_compra_id
   where p.item_realizado_id = new.item_realizado_id and p.tenant_id = new.tenant_id
     and (p.status <> 'cancelada' or p.id = new.id) and pv.status = 'aprovada';
  if round(v_realizado - v_devolvido, 2) - v_orcado > 0.005 then
    raise exception 'Só o administrador pode enviar esta PP ao financeiro: o realizado acumulado do item ultrapassa o orçado. Peça o envio ao administrador.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.pp_confere_orcado_no_envio() from public, anon, authenticated;
create trigger trg_pp_confere_orcado_no_envio
before insert or update of status on public.pedidos_compra
for each row execute function public.pp_confere_orcado_no_envio();
