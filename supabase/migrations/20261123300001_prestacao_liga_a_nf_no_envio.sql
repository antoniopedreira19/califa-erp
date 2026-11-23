-- Decisão 269 (23/11/2026): a NF da prestação de contas da verba entra no
-- cadastro único de notas no ENVIO ao financeiro, como a NF da PP e a do
-- desembolso (decisões 152 e 264). Antes (decisão 189) ela só entrava na
-- aprovação da prestação.
--
-- Pedido do Tiago, nos pontos do controle único de NFs: "Ligar no envio".
--
-- O que muda:
--  1. No envio da prestação (status → em_avaliacao), cada NF do documento é
--     ligada à nota do cadastro: o fornecedor pelo CNPJ do emitente (o
--     mesmo casamento da aprovação, com o cpf_cnpj igual ao informado; sem
--     ele, nasce o fornecedor "sem dados de pagamento", como a aprovação já
--     fazia) e a nota pelo fornecedor + número. Depois, o saldo de cada nota.
--     A aprovação continua igual: acha a nota já ligada e a registra.
--  2. A correção de um documento pelo financeiro (prestação em avaliação)
--     liga de novo a NF corrigida e confere o saldo.
--  3. O saldo da nota (`_conferir_partes_da_nota`) passa a somar também as
--     NFs das prestações enviadas e aprovadas — a parte é o valor do
--     documento. A prestação em rascunho ou reprovada não conta: ela ainda
--     vai ser corrigida e enviada de novo, e o envio confere de novo.
--  4. A lista de onde a nota já está (`notas_fiscais_do_fornecedor`) mostra
--     a prestação, com `tipo` = 'prestacao'.
--  5. As NFs das prestações que já estavam em avaliação são ligadas agora
--     (9 na produção em 23/11: 8 na PP-00455 e 1 na PP-00818; nenhuma
--     estava no cadastro). A do rascunho fica para o envio dela.
--
-- Os gatilhos rodam como security definer: quem envia a prestação (a
-- produção) não grava em fornecedores nem no cadastro de notas.

-- ---------------------------------------------------------------------------
-- A ligação das NFs de uma prestação ao cadastro de notas
-- ---------------------------------------------------------------------------
create or replace function public._ligar_notas_da_prestacao(p_prestacao_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  a        public.pp_verba_prestacoes_anexos%rowtype;
  v_forn   uuid;
  v_nota   uuid;
  v_notas  uuid[] := '{}';
begin
  select tenant_id into v_tenant from public.pp_verba_prestacoes where id = p_prestacao_id;
  if v_tenant is null then return; end if;

  for a in
    select * from public.pp_verba_prestacoes_anexos
     where prestacao_id = p_prestacao_id and documento_tipo = 'nota_fiscal'
     order by created_at, id
  loop
    if public.chave_do_numero_da_nf(a.documento_numero) is null or nullif(btrim(coalesce(a.emitente_documento, '')), '') is null then
      continue;
    end if;
    -- O fornecedor como a aprovação o acha (o CNPJ como foi informado).
    select f.id into v_forn
      from public.fornecedores f
     where f.tenant_id = v_tenant and f.cpf_cnpj = a.emitente_documento
     limit 1;
    if v_forn is null then
      insert into public.fornecedores (tenant_id, tipo_pessoa, nome, razao_social, cpf_cnpj, sem_dados_pagamento, created_by)
      values (v_tenant, 'juridica', btrim(coalesce(a.emitente_nome, a.emitente_documento)), btrim(coalesce(a.emitente_nome, a.emitente_documento)),
              a.emitente_documento, true, coalesce(auth.uid(), a.created_by))
      returning id into v_forn;
    end if;

    select n.id into v_nota
      from public.notas_fiscais_fornecedor n
     where n.tenant_id = v_tenant
       and n.fornecedor_id = v_forn
       and n.numero_chave = public.chave_do_numero_da_nf(a.documento_numero)
     for update;
    if v_nota is null then
      insert into public.notas_fiscais_fornecedor
        (tenant_id, fornecedor_id, numero, data_emissao, valor, tomador_estabelecimento_id, criada_por)
      values
        (v_tenant, v_forn, btrim(a.documento_numero), a.documento_data, a.valor, a.tomador_estabelecimento_id,
         coalesce(auth.uid(), a.created_by))
      returning id into v_nota;
    end if;

    update public.pp_verba_prestacoes_anexos set nota_fiscal_id = v_nota where id = a.id;
    v_notas := v_notas || v_nota;
  end loop;

  for v_nota in select distinct unnest(v_notas) loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;
end;
$function$;
revoke all on function public._ligar_notas_da_prestacao(uuid) from public, anon, authenticated;

-- No envio (primeiro ou depois de reprovada): status → em_avaliacao.
create or replace function public.prestacao_liga_notas_no_envio()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public._ligar_notas_da_prestacao(new.id);
  return null;
end;
$function$;
revoke all on function public.prestacao_liga_notas_no_envio() from public, anon, authenticated;

drop trigger if exists trg_prestacao_liga_notas_no_envio on public.pp_verba_prestacoes;
create trigger trg_prestacao_liga_notas_no_envio
  after insert or update of status on public.pp_verba_prestacoes
  for each row
  when (new.status = 'em_avaliacao')
  execute function public.prestacao_liga_notas_no_envio();

-- A correção do documento pelo financeiro, com a prestação em avaliação.
create or replace function public.prestacao_religa_nota_corrigida()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from public.pp_verba_prestacoes p where p.id = new.prestacao_id and p.status = 'em_avaliacao') then
    perform public._ligar_notas_da_prestacao(new.prestacao_id);
  end if;
  return null;
end;
$function$;
revoke all on function public.prestacao_religa_nota_corrigida() from public, anon, authenticated;

drop trigger if exists trg_prestacao_religa_nota_corrigida on public.pp_verba_prestacoes_anexos;
create trigger trg_prestacao_religa_nota_corrigida
  after update of documento_numero, documento_data, valor, tomador_estabelecimento_id, emitente_documento on public.pp_verba_prestacoes_anexos
  for each row
  when (new.documento_tipo = 'nota_fiscal')
  execute function public.prestacao_religa_nota_corrigida();

-- ---------------------------------------------------------------------------
-- O saldo da nota soma PPs, desembolsos e prestações enviadas
-- ---------------------------------------------------------------------------
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
      select pc.codigo || ' (prestação)', a.valor
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
               select pr.id, pc.codigo || ' (prestação)', a.valor, pr.status::text, 'prestacao'::text
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

-- ---------------------------------------------------------------------------
-- As prestações que já estavam com o financeiro
-- ---------------------------------------------------------------------------
do $$
declare
  v_id uuid;
begin
  for v_id in
    select distinct pr.id
      from public.pp_verba_prestacoes pr
      join public.pp_verba_prestacoes_anexos a on a.prestacao_id = pr.id
     where pr.status = 'em_avaliacao'
       and a.documento_tipo = 'nota_fiscal'
       and a.nota_fiscal_id is null
  loop
    perform public._ligar_notas_da_prestacao(v_id);
  end loop;
end $$;
