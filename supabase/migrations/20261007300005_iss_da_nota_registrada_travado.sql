-- O ISS retido da NF já registrada fica travado na aprovação das outras
-- PPs dela (decisão 152, resposta do Tiago em 07/10/2026).
--
-- "Ao notar que a NF já está no sistema, os campos devem ser
-- automaticamente preenchidos com o preenchimento já feito, e travados com
-- o mesmo." A tela de aprovação já preenche e trava o ISS; aqui é a trava
-- de verdade: com retenção, o ISS desta PP tem de ser o que a aprovação
-- que registrou a nota decidiu. A função é a mesma da 20261007300001, com
-- a conferência no laço das notas — nada mais muda.

create or replace function public.registrar_notas_fiscais_da_pp(
  p_pp_id     uuid,
  p_notas     jsonb,
  p_retencoes jsonb
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
  v_imp        text;
  v_aliq       numeric;
  v_iss        numeric;
  v_anexo      uuid;
  v_numero     text;
  v_emissao    date;
  v_valor      numeric;
  v_parte      numeric;
  v_tomador    uuid;
  v_sem_cred   boolean;
  v_motivo     text;
  v_nota       uuid;
  v_notas      uuid[] := '{}';
  v_anexos_nf  int;
  v_retem      boolean := p_retencoes is not null
                          and jsonb_typeof(p_retencoes) = 'array'
                          and jsonb_array_length(p_retencoes) > 0;
  v_reg_iss    numeric;
  v_reg_pp     text;
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;

  select tenant_id, status::text, verba_producao, fornecedor_id
    into v_tenant, v_status, v_verba, v_fornecedor
    from public.pedidos_compra where id = p_pp_id for update;
  if v_tenant is null or v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'PP não encontrada.';
  end if;
  if not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    raise exception 'Apenas admin ou financeiro registra as notas fiscais da PP.' using errcode = '42501';
  end if;
  if v_status <> 'em_avaliacao' then
    raise exception 'As notas fiscais só se registram com a PP em avaliação.';
  end if;
  if v_verba or v_fornecedor is null then
    raise exception 'Verba de produção não tem nota fiscal na aprovação.';
  end if;

  -- As retenções da PP (como antes) e o ISS, que vai para as notas novas.
  delete from public.pedidos_compra_retencoes where pedido_compra_id = p_pp_id;
  if p_retencoes is not null and jsonb_typeof(p_retencoes) = 'array' then
    for v_item in select value from jsonb_array_elements(p_retencoes) loop
      v_imp := upper(btrim(v_item->>'imposto'));
      v_aliq := (v_item->>'aliquota')::numeric;
      if v_imp not in ('ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF') then
        raise exception 'Imposto retido inválido: %', v_imp;
      end if;
      if v_aliq is null or v_aliq <= 0 or v_aliq >= 100 then
        raise exception 'Alíquota inválida para %.', v_imp;
      end if;
      insert into public.pedidos_compra_retencoes (tenant_id, pedido_compra_id, imposto, aliquota, criado_por)
      values (v_tenant, p_pp_id, v_imp, v_aliq, v_uid);
      if v_imp = 'ISS' then
        v_iss := v_aliq;
      end if;
    end loop;
  end if;

  -- Uma entrada por anexo do tipo NF da PP, nem mais nem menos.
  if p_notas is null or jsonb_typeof(p_notas) <> 'array' or jsonb_array_length(p_notas) = 0 then
    raise exception 'Informe as notas fiscais da PP.';
  end if;
  select count(*) into v_anexos_nf
    from public.pedidos_compra_anexos
   where pedido_compra_id = p_pp_id and documento_tipo = 'nota_fiscal';
  if v_anexos_nf <> jsonb_array_length(p_notas)
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

  for v_item in select value from jsonb_array_elements(p_notas) loop
    v_anexo   := (v_item->>'anexo_id')::uuid;
    v_numero  := nullif(btrim(v_item->>'numero'), '');
    v_emissao := nullif(v_item->>'data_emissao', '')::date;
    v_valor   := nullif(v_item->>'valor', '')::numeric;
    v_parte   := coalesce(nullif(v_item->>'valor_na_pp', '')::numeric, v_valor);
    v_tomador := nullif(v_item->>'tomador_estabelecimento_id', '')::uuid;
    v_sem_cred := coalesce((v_item->>'credito_retirado')::boolean, false);
    v_motivo  := nullif(btrim(v_item->>'credito_motivo'), '');

    if v_numero is null then
      raise exception 'Informe o número de cada NF.';
    end if;
    if v_emissao is null then
      raise exception 'Informe a data de emissão da NF %.', v_numero;
    end if;
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor da NF %.', v_numero;
    end if;
    if v_parte is null or v_parte <= 0 or v_parte > v_valor + 0.005 then
      raise exception 'O valor da NF % nesta PP precisa ser maior que zero e até o valor da nota.', v_numero;
    end if;
    if not exists (
      select 1 from public.fiscal_estabelecimentos e
       where e.id = v_tomador and e.tenant_id = v_tenant and e.ativo
    ) then
      raise exception 'Escolha o CNPJ tomador da NF % entre os CNPJs ativos do cadastro de impostos.', v_numero;
    end if;
    if v_sem_cred and v_motivo is null then
      raise exception 'Escolha por que a NF % não gera crédito de PIS/COFINS.', v_numero;
    end if;

    v_nota := public._nota_fiscal_do_anexo(
      v_tenant, v_fornecedor, v_anexo, v_numero, v_emissao, v_valor, v_tomador, v_uid, true);
    if v_nota = any(v_notas) then
      raise exception 'A NF % foi anexada duas vezes nesta PP.', v_numero;
    end if;
    v_notas := v_notas || v_nota;

    -- A nota que OUTRA PP já registrou traz o ISS retido daquela aprovação,
    -- travado (resposta do Tiago em 07/10/2026): o ISS é da nota, e a parte
    -- desta PP retém na mesma alíquota. Sem retenção nenhuma (o cartão) a
    -- conferência não se aplica.
    if v_retem then
      select n.iss_retido_aliquota, rp.codigo
        into v_reg_iss, v_reg_pp
        from public.notas_fiscais_fornecedor n
        join public.pedidos_compra rp on rp.id = n.registrada_na_pp_id
       where n.id = v_nota
         and n.registrada_em is not null
         and n.registrada_na_pp_id <> p_pp_id;
      if found and abs(coalesce(v_reg_iss, 0) - coalesce(v_iss, 0)) > 0.00005 then
        raise exception 'A NF % já foi registrada com a % e o ISS retido dela (%) vale para esta PP também. Recarregue a tela.',
          v_numero, v_reg_pp,
          case when v_reg_iss is null then 'sem ISS'
               else replace(trim_scale(v_reg_iss)::text, '.', ',') || '%' end;
      end if;
    end if;

    update public.notas_fiscais_fornecedor
       set iss_retido_aliquota = case when registrada_em is null then v_iss else iss_retido_aliquota end,
           registrada_na_pp_id = coalesce(registrada_na_pp_id, p_pp_id),
           registrada_por = coalesce(registrada_por, v_uid),
           registrada_em = coalesce(registrada_em, now()),
           credito_pis_cofins_retirado = v_sem_cred,
           credito_pis_cofins_motivo = case when v_sem_cred then v_motivo else null end
     where id = v_nota;

    update public.pedidos_compra_anexos
       set nota_fiscal_id = v_nota,
           documento_numero = v_numero,
           nf_data_emissao = v_emissao,
           nf_valor = round(v_valor, 2),
           nf_tomador_estabelecimento_id = v_tomador,
           nf_valor_na_pp = round(v_parte, 2)
     where id = v_anexo;
  end loop;

  foreach v_nota in array v_notas loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;

  update public.pedidos_compra
     set nf_registrada_por = v_uid,
         nf_registrada_em = now()
   where id = p_pp_id;
end;
$$;
revoke all on function public.registrar_notas_fiscais_da_pp(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.registrar_notas_fiscais_da_pp(uuid, jsonb, jsonb) to authenticated;
comment on function public.registrar_notas_fiscais_da_pp(uuid, jsonb, jsonb) is
  'Aprovação da PP pelo financeiro (decisão 152): grava as retenções da PP, liga cada anexo NF à sua nota (cria, liga ou corrige para todas as PPs) e registra a nota na 1ª aprovação. A nota que outra PP registrou trava o ISS retido.';
