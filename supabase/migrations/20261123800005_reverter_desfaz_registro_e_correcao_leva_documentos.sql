-- Decisão 271, ponto 6 (23/11/2026): o que acompanha o "Editar registro".
--
-- 1. AJUSTE 4 — reverter a aprovação desfaz o registro da nota.
--    Até aqui, reverter a aprovação de uma PP ou de um desembolso deixava a
--    nota registrada por ele (4 notas registradas sem documento aprovado em
--    23/11). Agora `_desfazer_registro_das_notas` roda no fim das duas
--    reversões: a nota registrada pelo documento passa a outro documento
--    aprovado que a traga (PP ou desembolso aprovado/pago) e, se não houver,
--    volta a "Em avaliação" e se corrige na seção Notas Fiscais. As 4 notas
--    antigas NÃO são mexidas aqui (mudar dado existente pede o OK do Tiago).
--
-- 2. 6c — o "Corrigir a NF" da PP continua (quem enviou corrige com a PP em
--    avaliação) e passa a levar junto o desembolso e a prestação da mesma
--    nota: as cópias deles acompanham, e quando a nota antiga fica sem PP,
--    os documentos dela passam para a nota corrigida. Antes, a nota antiga
--    usada por um desembolso fazia a correção falhar (a FK barrava o delete).
--
-- Mudança de COMPORTAMENTO em funções existentes, decidida na 271 (ajustes
-- 4 e 6c, OK do Tiago à v8). Nenhum dado existente muda.

create or replace function public._desfazer_registro_das_notas(p_pp_id uuid, p_desembolso_id uuid)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  r     record;
  v_pp  uuid;
  v_des uuid;
begin
  for r in
    select id from public.notas_fiscais_fornecedor
     where registrada_em is not null
       and ((p_pp_id is not null and registrada_na_pp_id = p_pp_id)
            or (p_desembolso_id is not null and registrada_no_desembolso_id = p_desembolso_id))
     for update
  loop
    select p.id into v_pp
      from public.pedidos_compra_anexos a
      join public.pedidos_compra p on p.id = a.pedido_compra_id
     where a.nota_fiscal_id = r.id
       and p.status in ('aprovada', 'pago')
       and p.id is distinct from p_pp_id
     order by p.aprovada_em nulls last
     limit 1;
    if v_pp is not null then
      update public.notas_fiscais_fornecedor
         set registrada_na_pp_id = v_pp, registrada_no_desembolso_id = null
       where id = r.id;
      continue;
    end if;

    select d.id into v_des
      from public.desembolsos_anexos a
      join public.desembolsos d on d.id = a.desembolso_id
     where a.nota_fiscal_id = r.id
       and d.status in ('aprovada', 'pago')
       and d.id is distinct from p_desembolso_id
     order by d.aprovada_em nulls last
     limit 1;
    if v_des is not null then
      update public.notas_fiscais_fornecedor
         set registrada_no_desembolso_id = v_des, registrada_na_pp_id = null
       where id = r.id;
      continue;
    end if;

    update public.notas_fiscais_fornecedor
       set registrada_em = null, registrada_por = null,
           registrada_na_pp_id = null, registrada_no_desembolso_id = null
     where id = r.id;
  end loop;
end;
$function$;

comment on function public._desfazer_registro_das_notas(uuid, uuid) is
  'Decisão 271, ajuste 4: ao reverter a aprovação de uma PP ou de um desembolso, a nota registrada por ele passa a outro documento aprovado que a traga ou volta a Em avaliação.';

revoke all on function public._desfazer_registro_das_notas(uuid, uuid) from public, anon, authenticated;

-- A reversão da PP: igual à de antes, com o registro desfeito no fim.
create or replace function public.reverter_aprovacao_pp(p_pp_id uuid, p_destino text, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid    uuid := auth.uid();
  v_pp     pedidos_compra%rowtype;
  v_papel  text;
  v_pagas  integer;
  v_fatura text;
begin
  if p_destino not in ('avaliacao', 'rejeitar') then
    raise exception 'Escolha para onde a PP volta.';
  end if;

  if p_destino = 'rejeitar' then
    perform public.reprovar_pp_aprovada(p_pp_id, p_motivo);
    perform public._desfazer_registro_das_notas(p_pp_id, null);
    return;
  end if;

  if p_motivo is null or char_length(btrim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_pp from public.pedidos_compra where id = p_pp_id for update;
  if not found then raise exception 'PP não encontrada.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro ou um administrador reverte a aprovação de uma PP.';
  end if;

  if v_pp.status <> 'aprovada' then
    raise exception 'Só PP aprovada pode ter a aprovação revertida (status atual: %).', v_pp.status;
  end if;

  select count(*) into v_pagas
    from public.pedidos_compra_parcelas par
   where par.pedido_compra_id = p_pp_id
     and (
       par.pago_em is not null
       or exists (
         select 1 from public.lancamentos_financeiros l
          where l.pedido_compra_parcela_id = par.id and l.origem = 'pp_baixa'
       )
     );
  if v_pagas > 0 then
    raise exception 'A PP já tem % parcela(s) com baixa. Cancele as baixas antes de reverter.', v_pagas;
  end if;

  select f.codigo into v_fatura
    from public.pedidos_compra_parcelas par
    join public.faturas_cartao f on f.id = par.fatura_cartao_id
   where par.pedido_compra_id = p_pp_id
     and f.status <> 'aberta'
   limit 1;
  if v_fatura is not null then
    raise exception 'Uma parcela está na fatura % do cartão, que não está aberta. Reabra a fatura antes de reverter.', v_fatura;
  end if;

  update public.pedidos_compra_parcelas
     set fatura_cartao_id        = null,
         data_pagamento          = null,
         data_pagamento_primeira = null
   where pedido_compra_id = p_pp_id;

  update public.pedidos_compra
     set status                                 = 'em_avaliacao',
         aprovada_em                            = null,
         aprovada_por                           = null,
         anexos_na_aprovacao                    = null,
         prazo_pagamento_financeiro             = null,
         forma_pagamento                        = null,
         cartao_credito_id                      = null,
         plano_conta_tipo_id                    = null,
         plano_conta_subtipo_id                 = null,
         pagamento_fora_do_cadastro_aprovado_por = null,
         pagamento_fora_do_cadastro_aprovado_em  = null
   where id = p_pp_id;

  update public.pedidos_compra_eventos
     set motivo = btrim(p_motivo)
   where pedido_compra_id = p_pp_id
     and evento = 'aprovacao_desfeita'
     and em = now()
     and motivo is null;

  perform public._desfazer_registro_das_notas(p_pp_id, null);
end;
$function$;

-- A reversão do desembolso: igual à de antes, com o registro desfeito no fim.
create or replace function public.reverter_aprovacao_desembolso(p_desembolso_id uuid, p_destino text, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid   uuid := auth.uid();
  v_d     desembolsos%rowtype;
  v_papel text;
  v_pagas integer;
begin
  if p_destino not in ('avaliacao', 'rejeitar') then
    raise exception 'Escolha para onde o desembolso volta.';
  end if;
  if p_motivo is null or char_length(btrim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_d from public.desembolsos where id = p_desembolso_id for update;
  if not found then raise exception 'Desembolso não encontrado.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_d.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a este desembolso.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro ou um administrador reverte a aprovação de um desembolso.';
  end if;

  if v_d.status <> 'aprovada' then
    raise exception 'Só desembolso aprovado pode ter a aprovação revertida (status atual: %).', v_d.status;
  end if;

  select count(*) into v_pagas
    from public.desembolsos_parcelas par
   where par.desembolso_id = p_desembolso_id
     and (
       par.pago_em is not null
       or exists (select 1 from public.lancamentos_financeiros l where l.desembolso_parcela_id = par.id)
     );
  if v_pagas > 0 then
    raise exception 'O desembolso já tem % parcela(s) com baixa. Cancele as baixas antes de reverter.', v_pagas;
  end if;

  update public.desembolsos_parcelas
     set data_pagamento          = null,
         data_pagamento_primeira = null
   where desembolso_id = p_desembolso_id;

  if p_destino = 'avaliacao' then
    update public.desembolsos
       set status            = 'em_avaliacao',
           aprovada_em       = null,
           aprovada_por      = null,
           forma_pagamento   = null,
           cartao_credito_id = null
     where id = p_desembolso_id;
  else
    update public.desembolsos
       set status            = 'rejeitada',
           motivo_rejeicao   = btrim(p_motivo),
           rejeitada_por     = v_uid,
           rejeitada_em      = now(),
           aprovada_em       = null,
           aprovada_por      = null,
           forma_pagamento   = null,
           cartao_credito_id = null
     where id = p_desembolso_id;
  end if;

  perform public._desfazer_registro_das_notas(null, p_desembolso_id);
end;
$function$;

-- 6c: o "Corrigir a NF" da PP leva junto o desembolso e a prestação da mesma
-- nota. Igual à versão de 16/10, com três mudanças marcadas "6c".
create or replace function public.corrigir_notas_fiscais_da_pp(p_pp_id uuid, p_notas jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_novas      uuid[] := '{}';
  v_anexos_nf  int;
  v_antes      jsonb;
  v_old        jsonb;
  v_mud        text[];
  v_partes     text[] := '{}';
  v_codigo     text;
  i            int;
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
  if not (
    public.is_tenant_admin(v_tenant)
    or public.is_tenant_financeiro(v_tenant)
    or public.produtor_envia_pp_do_job(
         (select pc.job_id from public.pedidos_compra pc where pc.id = p_pp_id))
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
      v_novas := v_novas || v_nota;  -- 6c: de qual nota para qual
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

  -- 6c: a nota antiga que ficou sem PP leva os outros documentos dela
  -- (desembolso, prestação) para a nota corrigida.
  for i in 1 .. coalesce(array_length(v_antigas, 1), 0) loop
    if not exists (select 1 from public.pedidos_compra_anexos x where x.nota_fiscal_id = v_antigas[i]) then
      update public.desembolsos_anexos set nota_fiscal_id = v_novas[i] where nota_fiscal_id = v_antigas[i];
      update public.pp_verba_prestacoes_anexos set nota_fiscal_id = v_novas[i] where nota_fiscal_id = v_antigas[i];
    end if;
  end loop;

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

  update public.pedidos_compra_anexos a
     set documento_numero = n.numero,
         nf_data_emissao = n.data_emissao,
         nf_valor = n.valor,
         nf_tomador_estabelecimento_id = n.tomador_estabelecimento_id
    from public.notas_fiscais_fornecedor n
   where a.nota_fiscal_id = n.id and n.id = any(v_notas);

  -- 6c: as cópias do desembolso e da prestação acompanham (na prestação,
  -- o `valor` é a parte dela e não muda).
  update public.desembolsos_anexos a
     set documento_numero = n.numero,
         nf_data_emissao = n.data_emissao,
         nf_valor = n.valor,
         nf_tomador_estabelecimento_id = n.tomador_estabelecimento_id
    from public.notas_fiscais_fornecedor n
   where a.nota_fiscal_id = n.id and n.id = any(v_notas)
     and (a.documento_numero is distinct from n.numero or a.nf_data_emissao is distinct from n.data_emissao
          or a.nf_valor is distinct from n.valor or a.nf_tomador_estabelecimento_id is distinct from n.tomador_estabelecimento_id);
  update public.pp_verba_prestacoes_anexos a
     set documento_numero = n.numero,
         documento_data = n.data_emissao,
         tomador_estabelecimento_id = n.tomador_estabelecimento_id
    from public.notas_fiscais_fornecedor n
   where a.nota_fiscal_id = n.id and n.id = any(v_notas)
     and (a.documento_numero is distinct from n.numero or a.documento_data is distinct from n.data_emissao
          or a.tomador_estabelecimento_id is distinct from n.tomador_estabelecimento_id);

  -- 6c: a nota antiga só sai quando nenhum documento a usa mais.
  delete from public.notas_fiscais_fornecedor n
   where n.id = any(v_antigas)
     and n.registrada_em is null
     and not exists (select 1 from public.pedidos_compra_anexos x where x.nota_fiscal_id = n.id)
     and not exists (select 1 from public.desembolsos_anexos x where x.nota_fiscal_id = n.id)
     and not exists (select 1 from public.pp_verba_prestacoes_anexos x where x.nota_fiscal_id = n.id);

  foreach v_nota in array v_notas loop
    perform public._conferir_partes_da_nota(v_nota);
  end loop;

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
$function$;
