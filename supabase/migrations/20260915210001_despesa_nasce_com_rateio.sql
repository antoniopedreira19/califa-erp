-- =====================================================================
-- A despesa sem job nasce com o rateio, numa transação só
--
-- Decisão do Tiago em 15/09/2026 (revisão da 069): avulsa e recorrente
-- não têm job, e todo lançamento tem regional — com o rateio definido NO
-- MOMENTO DA CRIAÇÃO.
--
-- Até aqui a tela gravava a despesa numa requisição e o rateio em outra
-- (duas transações), e por isso o banco não conseguia exigir o rateio: uma
-- trava no insert da despesa disparava antes de o rateio existir. Estas
-- quatro funções gravam as duas coisas juntas, e são o que permite a trava
-- de `20260915210003`.
--
-- SECURITY INVOKER de propósito: rodam com a RLS e as policies de quem
-- chama, exatamente como o insert direto que substituem. Não abrem nada.
--
-- `criar_*` recebe os campos da despesa como jsonb e grava SÓ as chaves
-- informadas (a lista vem de `pg_attribute`, com os nomes citados) — as
-- que ficam de fora caem no default da tabela, como num insert comum.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Conta avulsa
-- ---------------------------------------------------------------------
create or replace function public.criar_conta_avulsa(p_dados jsonb, p_rateio jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cols   text;
  v_id     uuid;
  v_tenant uuid;
begin
  if p_rateio is null or jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0 then
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

  insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
  select v_tenant, v_id, r.regional_id, r.percentual
    from jsonb_to_recordset(p_rateio) as r(regional_id uuid, percentual numeric);

  return v_id;
end;
$$;

create or replace function public.substituir_rateio_conta_avulsa(p_conta_avulsa_id uuid, p_rateio jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if p_rateio is null or jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0 then
    raise exception 'Informe o rateio de regional: ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  select tenant_id into v_tenant from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then
    raise exception 'Conta avulsa não encontrada.';
  end if;

  delete from public.contas_avulsas_regionais where conta_avulsa_id = p_conta_avulsa_id;

  insert into public.contas_avulsas_regionais (tenant_id, conta_avulsa_id, regional_id, percentual)
  select v_tenant, p_conta_avulsa_id, r.regional_id, r.percentual
    from jsonb_to_recordset(p_rateio) as r(regional_id uuid, percentual numeric);
end;
$$;

-- ---------------------------------------------------------------------
-- Recorrência
-- ---------------------------------------------------------------------
create or replace function public.criar_conta_recorrente(p_dados jsonb, p_rateio jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cols   text;
  v_id     uuid;
  v_tenant uuid;
begin
  if p_rateio is null or jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0 then
    raise exception 'Informe o rateio de regional: ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  select string_agg(quote_ident(a.attname), ', ')
    into v_cols
    from pg_attribute a
   where a.attrelid = 'public.contas_avulsas_recorrentes'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('id', 'created_at', 'updated_at')
     and p_dados ? a.attname::text;

  if v_cols is null then
    raise exception 'Nenhum campo da recorrência foi informado.';
  end if;

  execute format(
    'insert into public.contas_avulsas_recorrentes (%1$s) '
    'select %1$s from jsonb_populate_record(null::public.contas_avulsas_recorrentes, $1) '
    'returning id, tenant_id',
    v_cols
  ) into v_id, v_tenant using p_dados;

  insert into public.contas_avulsas_recorrentes_regionais (tenant_id, recorrente_id, regional_id, percentual)
  select v_tenant, v_id, r.regional_id, r.percentual
    from jsonb_to_recordset(p_rateio) as r(regional_id uuid, percentual numeric);

  return v_id;
end;
$$;

create or replace function public.substituir_rateio_conta_recorrente(p_recorrente_id uuid, p_rateio jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  if p_rateio is null or jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0 then
    raise exception 'Informe o rateio de regional: ao menos uma regional.'
      using errcode = 'P0001';
  end if;

  select tenant_id into v_tenant from public.contas_avulsas_recorrentes where id = p_recorrente_id;
  if not found then
    raise exception 'Recorrência não encontrada.';
  end if;

  delete from public.contas_avulsas_recorrentes_regionais where recorrente_id = p_recorrente_id;

  insert into public.contas_avulsas_recorrentes_regionais (tenant_id, recorrente_id, regional_id, percentual)
  select v_tenant, p_recorrente_id, r.regional_id, r.percentual
    from jsonb_to_recordset(p_rateio) as r(regional_id uuid, percentual numeric);
end;
$$;

revoke all on function public.criar_conta_avulsa(jsonb, jsonb) from public, anon;
revoke all on function public.substituir_rateio_conta_avulsa(uuid, jsonb) from public, anon;
revoke all on function public.criar_conta_recorrente(jsonb, jsonb) from public, anon;
revoke all on function public.substituir_rateio_conta_recorrente(uuid, jsonb) from public, anon;
grant execute on function public.criar_conta_avulsa(jsonb, jsonb) to authenticated;
grant execute on function public.substituir_rateio_conta_avulsa(uuid, jsonb) to authenticated;
grant execute on function public.criar_conta_recorrente(jsonb, jsonb) to authenticated;
grant execute on function public.substituir_rateio_conta_recorrente(uuid, jsonb) to authenticated;

comment on function public.criar_conta_avulsa(jsonb, jsonb) is
  'Grava a conta avulsa e o rateio de regional numa transação só. SECURITY INVOKER: respeita a RLS de quem chama. Decisão 069, revisão de 15/09/2026.';
comment on function public.substituir_rateio_conta_avulsa(uuid, jsonb) is
  'Troca o rateio de regional da conta avulsa (apaga e grava) numa transação só, para a conta nunca ficar sem rateio no meio da edição.';
comment on function public.criar_conta_recorrente(jsonb, jsonb) is
  'Grava a recorrência e o rateio de regional numa transação só. SECURITY INVOKER: respeita a RLS de quem chama. Decisão 069, revisão de 15/09/2026.';
comment on function public.substituir_rateio_conta_recorrente(uuid, jsonb) is
  'Troca o rateio de regional da recorrência (apaga e grava) numa transação só.';
