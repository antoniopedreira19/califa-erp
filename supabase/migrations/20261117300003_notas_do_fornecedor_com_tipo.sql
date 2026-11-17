-- Decisão 264 (17/11/2026): a lista de onde a nota já está diz se cada uso é
-- uma PP ou um pedido de desembolso (`tipo`).
--
-- Desde a 20261117300001 a função lista também os desembolsos que usam a
-- nota. Os dois têm status "em_avaliacao", e o formulário da PP oferece
-- "Corrigir a PP-…" para as PPs em avaliação: sem o tipo, ofereceria
-- "Corrigir a DES-…" e abriria a correção de PP com o id de um desembolso.
-- Só acrescenta a chave `tipo` no jsonb; a assinatura não muda.

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
             ) u
         ), '[]'::jsonb)
    from public.notas_fiscais_fornecedor n
   where n.fornecedor_id = p_fornecedor_id
     and n.tenant_id in (select public.current_tenant_ids())
     and n.numero_chave = any (select public.chave_do_numero_da_nf(x) from unnest(p_numeros) x)
$function$;
revoke all on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) from public, anon;
grant execute on function public.notas_fiscais_do_fornecedor(uuid, text[], uuid) to authenticated;
