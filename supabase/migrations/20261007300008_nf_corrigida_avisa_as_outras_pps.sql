-- Revisão da decisão 152 (07/10/2026) — a correção dos dados da nota avisa
-- também as outras PPs com ela.
--
-- POR QUE
-- No teste da 20261007300007 (TES-1014/26), a correção do CNPJ tomador da NF
-- 9019 pela PP-00143 mudou a nota também na PP-00142 — certo, a nota é uma
-- só —, mas o evento `nf_corrigida` entrou só na PP-00143. O financeiro que
-- aprovasse a PP-00142 veria o CNPJ novo sem saber que ele mudou depois do
-- envio.
--
-- O QUE MUDA
--   Quando os dados da nota mudam (número, emissão, valor ou CNPJ tomador),
--   cada outra PP não cancelada com a nota ganha o evento, com o que mudou e
--   "(corrigida na PP-…)", e a marca `nf_corrigida_*`. A parte de cada PP
--   não entra: ela é da própria PP.

create or replace function public.corrigir_notas_fiscais_da_pp(
  p_pp_id uuid,
  p_notas jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid        uuid := auth.uid();
  v_tenant     uuid;
  v_status     text;
  v_verba      boolean;
  v_fornecedor uuid;
  v_item       jsonb;
  v_anexo      uuid;
  v_numero     text;
  v_emissao    date;
  v_valor      numeric;
  v_parte      numeric;
  v_tomador    uuid;
  v_atual      uuid;
  v_alvo       uuid;
  v_nota       uuid;
  v_nota_row   public.notas_fiscais_fornecedor%rowtype;
  v_notas      uuid[] := '{}';
  v_antigas    uuid[] := '{}';
  v_anexos_nf  int;
  v_antes      jsonb;
  v_old        jsonb;
  v_mud        text[];
  v_partes     text[] := '{}';
  v_codigo     text;
  r            record;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select tenant_id, status::text, verba_producao, fornecedor_id, codigo
    into v_tenant, v_status, v_verba, v_fornecedor, v_codigo
    from public.pedidos_compra where id = p_pp_id for update;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'PP não encontrada.';
  end if;
  -- Quem envia PP (GP e administrador) e o financeiro.
  if not (
    public.is_tenant_admin(v_tenant)
    or public.is_tenant_financeiro(v_tenant)
    or exists (
      select 1 from public.tenant_members tm
       where tm.user_id = v_uid and tm.tenant_id = v_tenant and tm.status = 'ativo'
         and tm.role = 'gerente_producao')
  ) then
    raise exception 'Só o GP, o administrador ou o financeiro corrige a NF da PP.' using errcode = '42501';
  end if;
  if v_status <> 'em_avaliacao' then
    raise exception 'A NF só se corrige com a PP em avaliação no financeiro.';
  end if;
  if v_verba or v_fornecedor is null then
    raise exception 'Verba de produção não tem nota fiscal.';
  end if;

  select count(*) into v_anexos_nf
    from public.pedidos_compra_anexos
   where pedido_compra_id = p_pp_id and documento_tipo = 'nota_fiscal';
  if v_anexos_nf = 0 then
    raise exception 'Esta PP não tem NF anexada.';
  end if;
  if p_notas is null or jsonb_typeof(p_notas) <> 'array'
     or jsonb_array_length(p_notas) <> v_anexos_nf
     or exists (
       select 1 from jsonb_array_elements(p_notas) e
        where not exists (
          select 1 from public.pedidos_compra_anexos a
           where a.id = (e.value->>'anexo_id')::uuid
             and a.pedido_compra_id = p_pp_id
             and a.documento_tipo = 'nota_fiscal'))
     or (select count(distinct e.value->>'anexo_id') from jsonb_array_elements(p_notas) e) <> v_anexos_nf then
    raise exception 'As notas não batem com os anexos de NF da PP. Recarregue a tela.';
  end if;

  -- Como as NFs estavam, para dizer no histórico o que mudou.
  select jsonb_object_agg(a.id::text, jsonb_build_object(
           'numero', a.documento_numero, 'emissao', a.nf_data_emissao, 'valor', a.nf_valor,
           'tomador', a.nf_tomador_estabelecimento_id, 'parte', a.nf_valor_na_pp))
    into v_antes
    from public.pedidos_compra_anexos a
   where a.pedido_compra_id = p_pp_id and a.documento_tipo = 'nota_fiscal';

  for v_item in select value from jsonb_array_elements(p_notas) loop
    v_anexo   := (v_item->>'anexo_id')::uuid;
    v_numero  := nullif(btrim(v_item->>'numero'), '');
    v_emissao := nullif(v_item->>'data_emissao', '')::date;
    v_valor   := nullif(v_item->>'valor', '')::numeric;
    v_parte   := coalesce(nullif(v_item->>'valor_na_pp', '')::numeric, v_valor);
    v_tomador := nullif(v_item->>'tomador_estabelecimento_id', '')::uuid;

    if public.chave_do_numero_da_nf(v_numero) is null then
      raise exception 'Informe o número de cada NF.';
    end if;
    if v_emissao is null then
      raise exception 'Informe a data de emissão da NF %.', v_numero;
    end if;
    if v_emissao > (now() at time zone 'America/Sao_Paulo')::date then
      raise exception 'A data de emissão da NF % está no futuro.', v_numero;
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor da NF %.', v_numero;
    end if;
    if not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = v_tomador and e.tenant_id = v_tenant and e.ativo
    ) then
      raise exception 'Escolha o CNPJ tomador da NF %.', v_numero;
    end if;

    select nota_fiscal_id into v_atual from public.pedidos_compra_anexos where id = v_anexo;
    select id into v_alvo
      from public.notas_fiscais_fornecedor
     where tenant_id = v_tenant and fornecedor_id = v_fornecedor
       and numero_chave = public.chave_do_numero_da_nf(v_numero)
     for update;

    if v_alvo is null then
      -- Número que o fornecedor ainda não tem. Se a nota atual é só desta
      -- PP e não foi registrada, foi o número dela que estava errado: ela
      -- muda. Senão (outras PPs com ela, ou já registrada), esta PP passa
      -- para uma nota nova e as outras ficam com a de antes.
      if v_atual is not null
         and exists (select 1 from public.notas_fiscais_fornecedor where id = v_atual and registrada_em is null)
         and not exists (
           select 1 from public.pedidos_compra_anexos x
            where x.nota_fiscal_id = v_atual and x.id <> v_anexo) then
        update public.notas_fiscais_fornecedor
           set numero = btrim(v_numero), data_emissao = v_emissao,
               valor = round(v_valor, 2), tomador_estabelecimento_id = v_tomador
         where id = v_atual;
        v_nota := v_atual;
      else
        insert into public.notas_fiscais_fornecedor
          (tenant_id, fornecedor_id, numero, data_emissao, valor, tomador_estabelecimento_id, criada_por)
        values
          (v_tenant, v_fornecedor, btrim(v_numero), v_emissao, round(v_valor, 2), v_tomador, v_uid)
        returning id into v_nota;
      end if;
    else
      v_nota := v_alvo;
      select * into v_nota_row from public.notas_fiscais_fornecedor where id = v_alvo;
      if v_nota_row.registrada_em is null then
        -- Ainda não registrada: a correção vale para todas as PPs com ela.
        update public.notas_fiscais_fornecedor
           set numero = btrim(v_numero), data_emissao = v_emissao,
               valor = round(v_valor, 2), tomador_estabelecimento_id = v_tomador
         where id = v_alvo;
      elsif v_nota_row.data_emissao <> v_emissao
            or abs(v_nota_row.valor - v_valor) > 0.005
            or v_nota_row.tomador_estabelecimento_id <> v_tomador then
        raise exception 'A NF % já foi registrada pelo financeiro: os dados dela só o financeiro corrige. A parte desta PP continua livre.',
          v_nota_row.numero;
      end if;
    end if;

    if v_nota = any(v_notas) then
      raise exception 'A NF % foi anexada duas vezes nesta PP.', v_numero;
    end if;
    v_notas := v_notas || v_nota;
    if v_atual is not null and v_atual <> v_nota then
      v_antigas := v_antigas || v_atual;
    end if;

    select * into v_nota_row from public.notas_fiscais_fornecedor where id = v_nota;
    if v_parte <= 0 or v_parte > v_nota_row.valor + 0.005 then
      raise exception 'O valor da NF % nesta PP precisa ser maior que zero e até o valor da nota.', v_nota_row.numero;
    end if;

    update public.pedidos_compra_anexos
       set nota_fiscal_id = v_nota,
           nf_valor_na_pp = round(v_parte, 2)
     where id = v_anexo;
  end loop;

  -- As outras PPs com a mesma nota ganham o evento também: o financeiro que
  -- aprovar qualquer uma delas precisa saber que a nota mudou depois do
  -- envio. A comparação é com a cópia da nota no anexo, ainda a de antes.
  for r in
    select a.pedido_compra_id, p.tenant_id,
           string_agg(
             'NF ' || n.numero || ': ' || array_to_string(array_remove(array[
               case when coalesce(a.documento_numero, '') <> n.numero
                    then format('número de %s para %s', coalesce(a.documento_numero, '—'), n.numero) end,
               case when a.nf_data_emissao is distinct from n.data_emissao
                    then format('emissão de %s para %s', coalesce(to_char(a.nf_data_emissao, 'DD/MM/YYYY'), '—'), to_char(n.data_emissao, 'DD/MM/YYYY')) end,
               case when a.nf_valor is distinct from n.valor
                    then format('valor da nota de %s para %s', case when a.nf_valor is null then '—' else public._reais(a.nf_valor) end, public._reais(n.valor)) end,
               case when a.nf_tomador_estabelecimento_id is distinct from n.tomador_estabelecimento_id
                    then format('CNPJ tomador de %s para %s',
                      coalesce((select e.nome from public.fiscal_estabelecimentos e where e.id = a.nf_tomador_estabelecimento_id), '—'),
                      (select e.nome from public.fiscal_estabelecimentos e where e.id = n.tomador_estabelecimento_id)) end
             ], null), '; '),
             ' · ') as motivo
      from public.pedidos_compra_anexos a
      join public.notas_fiscais_fornecedor n on n.id = a.nota_fiscal_id
      join public.pedidos_compra p on p.id = a.pedido_compra_id
     where n.id = any(v_notas)
       and a.pedido_compra_id <> p_pp_id
       and p.status <> 'cancelada'
       and (coalesce(a.documento_numero, '') <> n.numero
            or a.nf_data_emissao is distinct from n.data_emissao
            or a.nf_valor is distinct from n.valor
            or a.nf_tomador_estabelecimento_id is distinct from n.tomador_estabelecimento_id)
     group by a.pedido_compra_id, p.tenant_id
  loop
    insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, motivo)
    values (r.tenant_id, r.pedido_compra_id, 'nf_corrigida', v_uid, r.motivo || ' (corrigida na ' || v_codigo || ').');
    update public.pedidos_compra
       set nf_corrigida_em = now(),
           nf_corrigida_por = v_uid
     where id = r.pedido_compra_id;
  end loop;

  -- As cópias dos dados da nota nos anexos ligados a ela (desta e das
  -- outras PPs) acompanham a correção.
  update public.pedidos_compra_anexos a
     set documento_numero = n.numero,
         nf_data_emissao = n.data_emissao,
         nf_valor = n.valor,
         nf_tomador_estabelecimento_id = n.tomador_estabelecimento_id
    from public.notas_fiscais_fornecedor n
   where a.nota_fiscal_id = n.id and n.id = any(v_notas);

  -- A nota que ficou sem PP nenhuma, e nunca foi registrada, sai do cadastro.
  delete from public.notas_fiscais_fornecedor n
   where n.id = any(v_antigas)
     and n.registrada_em is null
     and not exists (select 1 from public.pedidos_compra_anexos x where x.nota_fiscal_id = n.id);

  foreach v_nota in array v_notas loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;

  -- O que mudou em cada NF, para o histórico da PP.
  for r in
    select a.id, a.documento_numero, a.nf_data_emissao, a.nf_valor, a.nf_tomador_estabelecimento_id, a.nf_valor_na_pp
      from public.pedidos_compra_anexos a
     where a.pedido_compra_id = p_pp_id and a.documento_tipo = 'nota_fiscal'
     order by a.created_at
  loop
    v_old := v_antes -> r.id::text;
    v_mud := '{}';
    if coalesce(v_old->>'numero', '') <> coalesce(r.documento_numero, '') then
      v_mud := v_mud || format('número de %s para %s', coalesce(v_old->>'numero', '—'), r.documento_numero);
    end if;
    if (v_old->>'emissao')::date is distinct from r.nf_data_emissao then
      v_mud := v_mud || format('emissão de %s para %s',
        coalesce(to_char((v_old->>'emissao')::date, 'DD/MM/YYYY'), '—'), to_char(r.nf_data_emissao, 'DD/MM/YYYY'));
    end if;
    if (v_old->>'valor')::numeric is distinct from r.nf_valor then
      v_mud := v_mud || format('valor da nota de %s para %s',
        case when v_old->>'valor' is null then '—' else public._reais((v_old->>'valor')::numeric) end,
        public._reais(r.nf_valor));
    end if;
    if (v_old->>'tomador')::uuid is distinct from r.nf_tomador_estabelecimento_id then
      v_mud := v_mud || format('CNPJ tomador de %s para %s',
        coalesce((select e.nome from public.fiscal_estabelecimentos e where e.id = (v_old->>'tomador')::uuid), '—'),
        (select e.nome from public.fiscal_estabelecimentos e where e.id = r.nf_tomador_estabelecimento_id));
    end if;
    if (v_old->>'parte')::numeric is distinct from r.nf_valor_na_pp then
      v_mud := v_mud || format('valor nesta PP de %s para %s',
        case when v_old->>'parte' is null then '—' else public._reais((v_old->>'parte')::numeric) end,
        public._reais(r.nf_valor_na_pp));
    end if;
    if array_length(v_mud, 1) > 0 then
      v_partes := v_partes || ('NF ' || r.documento_numero || ': ' || array_to_string(v_mud, '; '));
    end if;
  end loop;

  if array_length(v_partes, 1) > 0 then
    insert into public.pedidos_compra_eventos (tenant_id, pedido_compra_id, evento, por, motivo)
    values (v_tenant, p_pp_id, 'nf_corrigida', v_uid, array_to_string(v_partes, ' · ') || '.');
    update public.pedidos_compra
       set nf_corrigida_em = now(),
           nf_corrigida_por = v_uid
     where id = p_pp_id;
  end if;
end;
$$;
revoke all on function public.corrigir_notas_fiscais_da_pp(uuid, jsonb) from public, anon;
grant execute on function public.corrigir_notas_fiscais_da_pp(uuid, jsonb) to authenticated;
comment on function public.corrigir_notas_fiscais_da_pp(uuid, jsonb) is
  'Revisão da decisão 152 (07/10/2026): com a PP em avaliação, GP, administrador ou financeiro corrige a NF sem aprovar — a parte desta PP sempre; os dados da nota enquanto ela não foi registrada (valem para todas as PPs com ela). Grava o evento nf_corrigida com o que mudou, nesta PP e nas outras com a mesma nota.';
