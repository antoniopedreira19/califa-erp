-- Notas de sócio no Tipo 15 (decisão 231, aprovada pelo Tiago em 02/11/2026).
--
-- A empresa emite nota a quem paga o sócio e repassa o dinheiro aos sócios. Na
-- planilha, a entrada e as saídas ficam no Tipo DL. No sistema o Tipo 15 era só
-- de saída, e o Recebimento avulso não o oferecia: a entrada não tinha como ser
-- lançada.
--
-- O que muda:
--   1. O Tipo 15 passa de `saida` para `ambos`, como o Tipo 12. Sobrescreve um
--      valor, com o OK do Tiago no protótipo: nenhum lançamento usa o Tipo 15, e
--      só o filtro do Recebimento avulso e o cadastro leem esse campo.
--   2. Subtipo 15.001 "Notas de sócio". Não leva o nome de quem paga: a entrada
--      veio da FitDance até 01/2026 e da Community desde 04/2026.
--   3. `contas_avulsas.numero_nf`: uma nota por PIX. É por ela que se sabe o
--      trimestre do Tipo quando a DRE passar a ler o sistema (o PIX de 02/10 é
--      nota de setembro, DL 3T).
--   4. O subtipo não tem rateio: a regional é TD, como na planilha e no mútuo.
--      A trava "toda conta avulsa precisa de rateio" abre exceção só para ele.
--
-- De fora, de propósito:
--   - A nota não entra no Fiscal: nenhuma nota real está em `faturamentos` ainda.
--   - A DRE continua lendo só o histórico. A linha fica líquida pela regra que já
--     existe em `lib/historico-financeiro/dre.ts`.
--   - A nota não abate saldo de mútuo: é uma conta avulsa, e o mútuo só soma
--     `transferencias_contas`.

alter table public.contas_avulsas add column if not exists numero_nf text;

comment on column public.contas_avulsas.numero_nf is
  'Número da nota, nas notas de sócio (decisão 231). As outras avulsas guardam o documento nos anexos.';

update public.plano_contas_tipos
   set natureza_padrao = 'ambos'
 where codigo = '15'
   and natureza_padrao = 'saida';

insert into public.plano_contas_subtipos (tenant_id, tipo_id, codigo, nome)
select t.tenant_id, t.id, '001', 'Notas de sócio'
  from public.plano_contas_tipos t
 where t.codigo = '15'
   and not exists (
     select 1 from public.plano_contas_subtipos s
      where s.tipo_id = t.id and s.codigo = '001'
   );

-- O subtipo 15.001, pelo código, como o 10.001 do rendimento.
create or replace function public._eh_notas_de_socio(p_subtipo_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.plano_contas_subtipos s
      join public.plano_contas_tipos t on t.id = s.tipo_id
     where s.id = p_subtipo_id
       and t.codigo = '15'
       and s.codigo = '001'
  );
$$;

revoke all on function public._eh_notas_de_socio(uuid) from public, anon;
grant execute on function public._eh_notas_de_socio(uuid) to authenticated, service_role;

-- A trava do rateio, com a exceção das notas de sócio. O resto da conta é o de
-- antes.
create or replace function public.exige_rateio_conta_avulsa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
begin
  if tg_table_name = 'contas_avulsas' then
    v_id := new.id;
  else
    v_id := old.conta_avulsa_id;
  end if;

  if exists (
       select 1 from public.contas_avulsas a
        where a.id = v_id
          and not public._eh_notas_de_socio(a.plano_conta_subtipo_id)
     )
     and not exists (
       select 1 from public.contas_avulsas_regionais r where r.conta_avulsa_id = v_id
     )
  then
    raise exception 'Toda conta avulsa precisa de rateio de regional. Informe ao menos uma regional.'
      using errcode = 'P0001';
  end if;
  return null;
end;
$function$;

create or replace function public.criar_conta_avulsa(p_dados jsonb, p_rateio jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_cols   text;
  v_id     uuid;
  v_tenant uuid;
  v_notas  boolean := public._eh_notas_de_socio((p_dados->>'plano_conta_subtipo_id')::uuid);
begin
  if not v_notas
     and (p_rateio is null or jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0) then
    raise exception 'Informe o rateio de regional: ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  select string_agg(quote_ident(a.attname), ', ')
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.contas_avulsas'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('id', 'created_at', 'updated_at')
     and p_dados ? a.attname::text;

  if v_cols is null then
    raise exception 'Nenhum campo da conta avulsa foi informado.';
  end if;

  execute format(
    'insert into public.contas_avulsas (%1$s) '
    'select %1$s from jsonb_populate_record(null::public.contas_avulsas, $1) '
    'returning id, tenant_id',
    v_cols
  ) into v_id, v_tenant using p_dados;

  -- Nota de sócio é TD: o rateio não se aplica, mesmo que venha.
  if not v_notas then
    insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
    select v_tenant, v_id, r.regional_id, r.percentual
      from jsonb_to_recordset(p_rateio) as r(regional_id uuid, percentual numeric);
  end if;

  return v_id;
end;
$function$;

create or replace function public.substituir_rateio_conta_avulsa(p_conta_avulsa_id uuid, p_rateio jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_tenant  uuid;
  v_subtipo uuid;
  v_notas   boolean;
begin
  select tenant_id, plano_conta_subtipo_id into v_tenant, v_subtipo
    from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;
  v_notas := public._eh_notas_de_socio(v_subtipo);

  if not v_notas
     and (p_rateio is null or jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0) then
    raise exception 'Informe o rateio de regional: ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  delete from public.contas_avulsas_regionais where conta_avulsa_id = p_conta_avulsa_id;
  if not v_notas then
    insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
    select v_tenant, p_conta_avulsa_id, r.regional_id, r.percentual
      from jsonb_to_recordset(p_rateio) as r(regional_id uuid, percentual numeric);
  end if;
end;
$function$;

-- O Recebimento avulso: nas notas de sócio, o número é obrigatório e vai para a
-- descrição, que é o que as listas e o Extrato mostram.
create or replace function public.criar_titulo_receber_avulso(p_dados jsonb, p_rateio jsonb)
returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_uid        uuid := auth.uid();
  v_tipo       text := p_dados->>'tipo_entrada';
  v_empresa    empresas%rowtype;
  v_valor      numeric := round((p_dados->>'valor')::numeric, 2);
  v_data       date := (p_dados->>'data_prevista')::date;
  v_descricao  text := btrim(coalesce(p_dados->>'descricao', ''));
  v_tipo_pc    uuid;
  v_sub_pc     uuid;
  v_conta      contas_bancarias%rowtype;
  v_comp       date;
  v_cliente    uuid;
  v_fornecedor uuid;
  v_codigo     text;
  v_mes        text;
  v_id         uuid;
  v_nf         text;
begin
  if v_uid is null then raise exception 'Sessão inválida.'; end if;

  if v_tipo is null or v_tipo not in ('recebimento_avulso', 'rendimento') then
    raise exception 'Tipo de recebimento inválido.';
  end if;

  select * into v_empresa from public.empresas where id = (p_dados->>'empresa_id')::uuid;
  if not found then raise exception 'Escolha a empresa.'; end if;

  if not (public.is_tenant_admin(v_empresa.tenant_id) or public.is_tenant_financeiro(v_empresa.tenant_id)) then
    raise exception 'Apenas admin ou financeiro pode lançar recebimento avulso.'
      using errcode = '42501';
  end if;

  if v_valor is null or v_valor <= 0 then raise exception 'Informe o valor.'; end if;
  if v_data is null then raise exception 'Informe a data.'; end if;

  if v_tipo = 'rendimento' then
    select * into v_conta from public.contas_bancarias
     where id = (p_dados->>'conta_bancaria_prevista_id')::uuid;
    if not found then raise exception 'Escolha a conta de aplicação.'; end if;
    if v_conta.tenant_id <> v_empresa.tenant_id then
      raise exception 'Conta bancária de outro tenant.';
    end if;
    if v_conta.tipo <> 'investimento' or v_conta.cartao_credito_id is not null then
      raise exception 'Rendimento só entra em conta de aplicação (tipo Investimento).';
    end if;
    if not v_conta.ativo then raise exception 'A conta de aplicação está inativa.'; end if;

    v_comp := date_trunc('month', (p_dados->>'competencia')::date)::date;
    if v_comp is null then raise exception 'Escolha o mês do rendimento.'; end if;

    if exists (
      select 1 from public.contas_avulsas
       where tipo_entrada = 'rendimento'
         and conta_bancaria_prevista_id = v_conta.id
         and competencia = v_comp
    ) then
      raise exception 'Esta conta já tem o rendimento de %. Cancele ou exclua o que existe antes de lançar de novo.',
        to_char(v_comp, 'MM/YYYY');
    end if;

    select t.id, s.id into v_tipo_pc, v_sub_pc
      from public.plano_contas_tipos t
      join public.plano_contas_subtipos s on s.tipo_id = t.id and s.codigo = '001'
     where t.tenant_id = v_empresa.tenant_id and t.codigo = '10';
    if v_sub_pc is null then
      raise exception 'Falta o subtipo "Rendimento de aplicação" no tipo 10 do plano de contas.';
    end if;

    v_mes := (array['janeiro','fevereiro','março','abril','maio','junho','julho',
                    'agosto','setembro','outubro','novembro','dezembro'])[extract(month from v_comp)::int];
    v_descricao := 'Rendimento de ' || v_mes || ' de ' || extract(year from v_comp)::int
                   || ' · ' || v_conta.nome;
  else
    if length(v_descricao) < 3 then raise exception 'Informe a descrição.'; end if;

    v_tipo_pc := (p_dados->>'plano_conta_tipo_id')::uuid;
    v_sub_pc := (p_dados->>'plano_conta_subtipo_id')::uuid;
    if v_tipo_pc is null or v_sub_pc is null then
      raise exception 'Selecione o centro de custo.';
    end if;
    if not exists (
      select 1 from public.plano_contas_subtipos s
       where s.id = v_sub_pc and s.tipo_id = v_tipo_pc and s.ativo
         and s.tenant_id = v_empresa.tenant_id
    ) then
      raise exception 'Subtipo inválido ou não pertence ao tipo escolhido.';
    end if;

    if public._eh_notas_de_socio(v_sub_pc) then
      v_nf := nullif(btrim(coalesce(p_dados->>'numero_nf', '')), '');
      if v_nf is null then raise exception 'Informe o número da nota.'; end if;
      v_descricao := v_descricao || ' · NF ' || v_nf;
    end if;

    v_cliente := nullif(p_dados->>'cliente_id', '')::uuid;
    v_fornecedor := nullif(p_dados->>'fornecedor_id', '')::uuid;
    if v_cliente is not null and v_fornecedor is not null then
      raise exception '"Recebido de" é um cliente ou um fornecedor, não os dois.';
    end if;
  end if;

  v_codigo := public.gerar_codigo_avulsa(v_empresa.tenant_id);

  v_id := public.criar_conta_avulsa(
    jsonb_build_object(
      'tenant_id', v_empresa.tenant_id,
      'codigo', v_codigo,
      'empresa_id', v_empresa.id,
      'descricao', v_descricao,
      'valor', v_valor,
      'natureza', 'entrada',
      'tipo_entrada', v_tipo,
      'data_prevista_pagamento', v_data,
      'data_pagamento', v_data,
      'data_pagamento_primeira', v_data,
      'cliente_id', v_cliente,
      'fornecedor_id', v_fornecedor,
      'plano_conta_tipo_id', v_tipo_pc,
      'plano_conta_subtipo_id', v_sub_pc,
      'conta_bancaria_prevista_id', case when v_tipo = 'rendimento' then v_conta.id end,
      'competencia', v_comp,
      'numero_nf', v_nf,
      'criado_por', v_uid,
      'aprovada_em', now(),
      'aprovada_por', v_uid
    ),
    p_rateio
  );

  return v_id;
end;
$function$;
