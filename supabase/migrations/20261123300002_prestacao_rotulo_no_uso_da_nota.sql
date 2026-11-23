-- Decisão 269 (23/11/2026), acerto de texto: o uso da nota pela prestação
-- da verba aparece como "PP-00951 · prestação" (antes "PP-00951
-- (prestação)"). Na tela, a frase ficava com parênteses dobrados:
-- "Esta NF já está em PP-00951 (prestação) (R$ 30,00)"; na mensagem do
-- saldo, parênteses dentro de parênteses. O mesmo rótulo do protótipo das
-- Notas Fiscais. Só o texto muda: as duas funções são as da migration
-- 20261123300001, com o rótulo novo.

create or replace function public._conferir_partes_da_nota(p_nota uuid)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_valor  numeric;
  v_numero text;
  v_soma   numeric;
  v_lista  text;
  r        record;
begin
  select valor, numero into v_valor, v_numero from public.notas_fiscais_fornecedor where id = p_nota;

  select coalesce(sum(x.parte), 0), string_agg(x.codigo || ' com ' || public._reais(x.parte), ', ' order by x.codigo)
    into v_soma, v_lista
    from (
      select p.codigo, a.nf_valor_na_pp as parte
        from public.pedidos_compra_anexos a
        join public.pedidos_compra p on p.id = a.pedido_compra_id
       where a.nota_fiscal_id = p_nota and p.status <> 'cancelada'
      union all
      select d.codigo, coalesce(a.nf_valor_no_pedido, a.nf_valor)
        from public.desembolsos_anexos a
        join public.desembolsos d on d.id = a.desembolso_id
       where a.nota_fiscal_id = p_nota and d.status <> 'cancelada'
      union all
      select pc.codigo || ' · prestação', a.valor
        from public.pp_verba_prestacoes_anexos a
        join public.pp_verba_prestacoes pr on pr.id = a.prestacao_id
        join public.pedidos_compra pc on pc.id = pr.pedido_compra_id
       where a.nota_fiscal_id = p_nota and pr.status in ('em_avaliacao', 'aprovada')
    ) x;
  if v_soma > v_valor + 0.005 then
    raise exception 'A NF % vale % e os documentos ligados a ela somam % (%). Corrija o valor da NF no documento que estiver errado.',
      v_numero, public._reais(v_valor), public._reais(v_soma), v_lista;
  end if;

  for r in
    select p.codigo, p.valor, sum(a.nf_valor_na_pp) as soma, count(*) as notas
      from public.pedidos_compra p
      join public.pedidos_compra_anexos a
        on a.pedido_compra_id = p.id and a.nota_fiscal_id is not null and a.nf_valor_na_pp is not null
     where p.status <> 'cancelada'
       and p.id in (select x.pedido_compra_id from public.pedidos_compra_anexos x where x.nota_fiscal_id = p_nota)
     group by p.codigo, p.valor
  loop
    if r.soma > r.valor + 0.005 then
      if r.notas = 1 then
        raise exception 'O valor da NF % na % (%) passa do valor da PP (%). Numa PP, a parte da nota vai até o valor da PP.',
          v_numero, r.codigo, public._reais(r.soma), public._reais(r.valor);
      end if;
      raise exception 'As NFs da % somam % nela, mais que o valor da PP (%).',
        r.codigo, public._reais(r.soma), public._reais(r.valor);
    end if;
  end loop;
end;
$function$;

create or replace function public.notas_fiscais_do_fornecedor(p_fornecedor_id uuid, p_numeros text[], p_excluir_pp_id uuid default null)
returns table(numero_chave text, nota_id uuid, numero text, data_emissao date, valor numeric, tomador_estabelecimento_id uuid, registrada boolean, pps jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
  select n.numero_chave, n.id, n.numero, n.data_emissao, n.valor, n.tomador_estabelecimento_id,
         n.registrada_em is not null,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', u.id, 'codigo', u.codigo, 'valor_na_pp', u.parte, 'status', u.status, 'tipo', u.tipo)
                            order by u.codigo)
             from (
               select p.id, p.codigo, a.nf_valor_na_pp as parte, p.status::text as status, 'pp'::text as tipo
                 from public.pedidos_compra_anexos a
                 join public.pedidos_compra p on p.id = a.pedido_compra_id
                where a.nota_fiscal_id = n.id
                  and p.status <> 'cancelada'
                  and (p_excluir_pp_id is null or p.id <> p_excluir_pp_id)
               union all
               select d.id, d.codigo, coalesce(a.nf_valor_no_pedido, a.nf_valor), d.status::text, 'desembolso'::text
                 from public.desembolsos_anexos a
                 join public.desembolsos d on d.id = a.desembolso_id
                where a.nota_fiscal_id = n.id
                  and d.status <> 'cancelada'
                  and (p_excluir_pp_id is null or d.id <> p_excluir_pp_id)
               union all
               select pr.id, pc.codigo || ' · prestação', a.valor, pr.status::text, 'prestacao'::text
                 from public.pp_verba_prestacoes_anexos a
                 join public.pp_verba_prestacoes pr on pr.id = a.prestacao_id
                 join public.pedidos_compra pc on pc.id = pr.pedido_compra_id
                where a.nota_fiscal_id = n.id
                  and pr.status in ('em_avaliacao', 'aprovada')
                  and (p_excluir_pp_id is null or pc.id <> p_excluir_pp_id)
             ) u
         ), '[]'::jsonb)
    from public.notas_fiscais_fornecedor n
   where n.fornecedor_id = p_fornecedor_id
     and n.tenant_id in (select public.current_tenant_ids())
     and n.numero_chave = any (select public.chave_do_numero_da_nf(x) from unnest(p_numeros) x)
$function$;
revoke all on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) from public, anon;
grant execute on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) to authenticated;
