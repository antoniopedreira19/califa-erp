-- Decisão 223, complemento de 27/10/2026: o retrato da versão no pedido ao
-- Comitê guarda também o valor do job, que a caixa do Comitê mostra na
-- coluna "Valor do job". `versao_limites` passa a devolver o valor do job
-- (mesma conta do cabeçalho da versão); o Resultado geral continua nulo
-- sem planejado, como antes. Troca de assinatura: a função é recriada
-- (só funções do próprio Comitê a chamam, pelo nome das colunas). Sem
-- backfill: não há pedido gravado ainda.
begin;
drop function if exists public.versao_limites(uuid);
create or replace function public.versao_limites(p_versao_id uuid)
returns table(itens_acima integer, resultado_geral numeric, valor_job numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_versao public.versoes_orcamento;
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
  v_negociado numeric;
  v_veiculo numeric;
begin
  select * into v_versao from public.versoes_orcamento where id = p_versao_id;
  if not found then return; end if;

  select c.modelo_planilha into v_modelo
    from public.orcamentos o
    left join public.categorias_dominio c on c.id = o.categoria_id
   where o.id = v_versao.orcamento_id and o.tenant_id = v_versao.tenant_id;

  select coalesce(count(*) filter (where total_planejado - total_orcado > 0.005), 0)::int,
         coalesce(sum(total_planejado), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo <> 'D'), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo not in ('C', 'FI')), 0),
         coalesce(sum(total_orcado) filter (where not em_save and tipo_custo in ('B', 'C')), 0),
         coalesce(sum(total_orcado), 0)
    into itens_acima, v_planejado, v_principal, v_base_honorarios, v_base_imposto, v_negociado
    from public.versoes_orcamento_itens
   where versao_orcamento_id = v_versao.id and tenant_id = v_versao.tenant_id;

  if v_modelo = 'midia_off' then
    v_veiculo := v_negociado * coalesce(v_versao.percentual_veiculo, 80) / 100;
    v_honorarios := (case when v_versao.base_honorarios = 'liquido' then v_veiculo else v_negociado end)
                    * coalesce(v_versao.percentual_honorarios, 0) / 100;
    v_imposto := v_honorarios * coalesce(v_versao.percentual_imposto, 0) / 100;
    v_valor_job := v_veiculo + v_honorarios;
    v_planejado := v_veiculo;
  else
    v_honorarios := v_base_honorarios * coalesce(v_versao.percentual_honorarios, 0) / 100;
    if v_modelo = 'internacional' then
      v_int_taxes := (v_base_imposto + v_honorarios) * greatest(0, least(99.99, coalesce(v_versao.percentual_int_taxes, 0)))
             / (100 - greatest(0, least(99.99, coalesce(v_versao.percentual_int_taxes, 0))));
      v_transacao := coalesce(v_versao.int_transaction_costs, 0);
    end if;
    v_imposto := (v_base_imposto + v_honorarios + v_int_taxes) * greatest(0, least(99.99, coalesce(v_versao.percentual_imposto, 0)))
           / (100 - greatest(0, least(99.99, coalesce(v_versao.percentual_imposto, 0))));
    v_valor_job := v_principal + v_honorarios + v_int_taxes + v_imposto + v_transacao;
    v_imposto := v_imposto + v_int_taxes + v_transacao;
  end if;

  valor_job := round(v_valor_job, 2);
  -- calcularResultadoOperacional: sem planejado, o resultado é travessão.
  resultado_geral := case
    when v_modelo is distinct from 'midia_off' and v_planejado <= 0 then null
    when v_valor_job > 0 then (v_valor_job - v_imposto - v_planejado) / v_valor_job * 100
    else null end;
  return next;
end;
$$;


create or replace function public.comite_pedido_guarda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lim record;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pendente' then
      raise exception 'O pedido ao Comitê nasce pendente.';
    end if;
    if (select auth.uid()) is not null then
      new.enviado_por := (select auth.uid());
    end if;
    new.enviado_em := now();
    new.decidido_por := null;
    new.decidido_em := null;
    new.comentario := null;
    if new.tipo = 'versao' then
      select v.orcamento_id into new.orcamento_id
        from public.versoes_orcamento v
       where v.id = new.versao_orcamento_id and v.tenant_id = new.tenant_id;
      if new.orcamento_id is null then
        raise exception 'Versão não encontrada.';
      end if;
      select l.itens_acima, l.resultado_geral, l.valor_job into v_lim
        from public.versao_limites(new.versao_orcamento_id) l;
      new.snapshot := jsonb_build_object('itens_acima', v_lim.itens_acima, 'resultado_geral', v_lim.resultado_geral, 'valor_job', v_lim.valor_job);
    else
      select a.job_id, a.item_realizado_id into new.job_id, new.item_realizado_id
        from public.pedidos_compra_a_emitir a
       where a.id = new.pp_a_emitir_id and a.tenant_id = new.tenant_id and a.excluida_em is null and a.pp_id is null;
      if new.job_id is null then
        raise exception 'PP a emitir não encontrada.';
      end if;
      new.snapshot := public.comite_retrato_da_pp(new.pp_a_emitir_id);
    end if;
    return new;
  end if;

  -- UPDATE: só sai de pendente, e o alvo não muda.
  if old.status <> 'pendente' then
    raise exception 'Este pedido ao Comitê já foi encerrado.' using errcode = '42501';
  end if;
  if new.tenant_id <> old.tenant_id or new.tipo <> old.tipo
     or new.versao_orcamento_id is distinct from old.versao_orcamento_id
     or new.orcamento_id is distinct from old.orcamento_id
     or new.pp_a_emitir_id is distinct from old.pp_a_emitir_id
     or new.job_id is distinct from old.job_id
     or new.item_realizado_id is distinct from old.item_realizado_id
     or new.enviado_por <> old.enviado_por or new.enviado_em <> old.enviado_em
     or new.motivo <> old.motivo then
    raise exception 'O pedido ao Comitê não pode ser alterado.' using errcode = '42501';
  end if;

  if new.status = 'cancelado' then
    -- Cancelar o envio: quem pode editar a versão ou a PP (a mesma regra
    -- da tela, conferida na action); a RLS já restringe ao tenant.
    new.decidido_por := null;
    new.decidido_em := null;
    new.snapshot := old.snapshot;
  elsif new.status in ('aprovado', 'devolvido') then
    if (select auth.uid()) is not null and not public.pode_decidir_no_comite(old.tenant_id) then
      raise exception 'Só um membro do Comitê de Aprovações decide este pedido.' using errcode = '42501';
    end if;
    new.decidido_por := coalesce((select auth.uid()), new.decidido_por);
    new.decidido_em := now();
    -- O retrato que vale é o do momento da decisão (a versão estava
    -- travada; a PP a emitir pode ter sido salva de novo antes).
    if old.tipo = 'versao' then
      select l.itens_acima, l.resultado_geral, l.valor_job into v_lim
        from public.versao_limites(old.versao_orcamento_id) l;
      new.snapshot := jsonb_build_object('itens_acima', v_lim.itens_acima, 'resultado_geral', v_lim.resultado_geral, 'valor_job', v_lim.valor_job);
    else
      new.snapshot := public.comite_retrato_da_pp(old.pp_a_emitir_id);
    end if;
  elsif new.status = 'pendente' then
    new.snapshot := old.snapshot;
  end if;
  return new;
end;
$$;

revoke all on function public.versao_limites(uuid) from public, anon, authenticated;
revoke all on function public.comite_pedido_guarda() from public, anon, authenticated;
commit;
