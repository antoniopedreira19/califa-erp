-- Decisão 184 — a emissão da nota passa a gravar o que o Faturar novo pede
-- (as colunas vêm da 20261016700001):
--
-- * CNPJ do tomador vindo do FORMULÁRIO (nasce com o do envio ou com o do
--   cadastro do cliente e pode ser trocado). Sem o campo no payload — app
--   antigo — vale a regra da 123: o do envio, senão o do cadastro.
-- * "Tomador no exterior": nota sem CNPJ do tomador.
-- * Nota avulsa referente a um job: sai na empresa (gerencial), para o
--   cliente e 100% na regional do job.
-- * Empresa (gerencial) travada no job: a nota de job e a de BV só saem na
--   empresa do job (até aqui o formulário deixava escolher qualquer uma e a
--   RPC gravava).
-- * A conferência "uma nota, um CNPJ" ignora a nota do envio sem CNPJ
--   (exterior), que não tem CNPJ para comparar.
--
-- O resto é a função da decisão 130 sem mudança.

create or replace function public.emitir_faturamento(payload jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant_id      uuid := (payload->>'tenant_id')::uuid;
  v_empresa_id     uuid := (payload->>'empresa_id')::uuid;
  v_origem_tipo    faturamento_origem := (payload->>'origem_tipo')::faturamento_origem;
  v_origem_id      uuid := nullif(payload->>'origem_id', '')::uuid;
  v_cliente_id     uuid := nullif(payload->>'cliente_id', '')::uuid;
  v_fornecedor_id  uuid := nullif(payload->>'fornecedor_id', '')::uuid;
  v_valor_total    numeric(14,2) := (payload->>'valor_total')::numeric;
  v_tipo_id        uuid := nullif(payload->>'plano_conta_tipo_id', '')::uuid;
  v_subtipo_id     uuid := nullif(payload->>'plano_conta_subtipo_id', '')::uuid;
  v_emitido_por    uuid := (payload->>'emitido_por')::uuid;
  v_cnae           text := nullif(trim(payload->>'cnae'), '');
  v_faturamento_id uuid;
  v_parcelas       jsonb := payload->'parcelas';
  v_itens          jsonb := coalesce(payload->'itens', '[]'::jsonb);
  v_soma_parcelas  numeric(14,2) := 0;
  v_soma_itens     numeric(14,2) := 0;
  v_parcela        jsonb;
  v_item           jsonb;
  v_subtipo_tipo   uuid;
  v_par            jobs_envio_faturamento_parcelas%rowtype;
  v_ja             numeric(14,2);
  v_saldo          numeric(14,2);
  v_codigo         text;
  v_save_previsto  numeric(14,2);
  v_save_ja        numeric(14,2);
  -- 079: cliente de cada job coberto pela nota
  v_job_conferir   uuid;
  v_cliente_job    uuid;
  v_nome_cliente   text;
  v_nome_nota      text;
  -- fornecedor do BV coberto pela nota
  v_bv_fornecedor  uuid;
  v_nome_fornecedor text;
  -- 086: rateio de regional da nota avulsa
  v_rateio         jsonb := coalesce(payload->'rateio', '[]'::jsonb);
  v_rat            jsonb;
  v_soma_rateio    numeric(7,2) := 0;
  v_reg_empresa    uuid;
  v_reg_ativo      boolean;
  v_reg_nome       text;
  -- 123: o CNPJ para o qual a nota sai
  v_cnpjs          text[];
  v_cnpj_tomador   text;
  -- 184: CNPJ do formulário, exterior, job de referência, empresa do job
  v_cnpj_form      text := nullif(regexp_replace(coalesce(payload->>'cnpj_tomador', ''), '[^0-9]', '', 'g'), '');
  v_exterior       boolean := coalesce((payload->>'tomador_exterior')::boolean, false);
  v_job_ref        uuid := nullif(payload->>'job_referencia_id', '')::uuid;
  v_ref_codigo     text;
  v_ref_status     text;
  v_ref_empresa    uuid;
  v_ref_regional   uuid;
  v_ref_cliente    uuid;
  v_job_empresa    uuid;
  -- 130: recebimento antes da NF
  v_antes          recebimentos_antes_nf%rowtype;
  v_antes_ultimo   recebimentos_antes_nf%rowtype;
  v_antes_total    numeric(14,2) := 0;
  v_titulo1        titulos_receber%rowtype;
begin
  if not public.is_tenant_member(v_tenant_id) then
    raise exception 'Sem acesso a este tenant.';
  end if;

  -- Só administrador e financeiro emitem nota: a mesma regra da action
  -- `emitirFaturamento`. Sem isto, qualquer membro do tenant emitia
  -- chamando a RPC direto pela API.
  if not exists (
    select 1
      from public.tenant_members tm
      join public.profiles p on p.id = tm.user_id
     where tm.user_id = (select auth.uid())
       and tm.tenant_id = v_tenant_id
       and tm.status = 'ativo'
       and p.ativo = true
       and tm.role in ('administrador', 'financeiro')
  ) then
    raise exception 'Apenas administrador ou financeiro pode emitir nota fiscal.';
  end if;

  if v_cnae is null then
    raise exception 'Informe o CNAE a ser utilizado na nota.';
  end if;

  if jsonb_array_length(v_parcelas) < 1 then
    raise exception 'Faturamento precisa de pelo menos uma parcela.';
  end if;

  if v_tipo_id is not null or v_subtipo_id is not null then
    if v_tipo_id is null or v_subtipo_id is null then
      raise exception 'Informe tipo e subtipo juntos, ou nenhum dos dois.';
    end if;
    select tipo_id into v_subtipo_tipo
      from public.plano_contas_subtipos where id = v_subtipo_id;
    if not found then raise exception 'Subtipo não encontrado.'; end if;
    if v_subtipo_tipo <> v_tipo_id then
      raise exception 'Subtipo não pertence ao tipo escolhido.';
    end if;
  end if;

  if jsonb_array_length(v_itens) = 0 then
    if v_origem_tipo = 'avulso' then
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', 'avulso', 'origem_id', null,
        'envio_parcela_id', null, 'valor', v_valor_total));
    else
      v_itens := jsonb_build_array(jsonb_build_object(
        'origem_tipo', v_origem_tipo, 'origem_id', v_origem_id,
        'envio_parcela_id', null, 'valor', v_valor_total));
    end if;
  end if;

  -- BV só sai em nota própria, contra o fornecedor dele (017 §7): nunca na
  -- nota do cliente e nunca junto de outro item.
  if exists (select 1 from jsonb_array_elements(v_itens) i where i->>'origem_tipo' = 'bv') then
    if jsonb_array_length(v_itens) > 1 then
      raise exception 'BV tem o fornecedor como contraparte e precisa ser faturado individualmente.';
    end if;
    if v_origem_tipo <> 'bv' then
      raise exception 'BV não entra na nota do cliente: ele é faturado numa nota própria, contra o fornecedor.';
    end if;
  elsif v_origem_tipo = 'bv' then
    raise exception 'Nota de BV só cobre o próprio BV.';
  end if;

  -- 086: a nota avulsa leva rateio de regional; a de job ou de BV fica na
  -- regional do job. As regionais precisam ser da empresa emissora.
  if jsonb_typeof(v_rateio) <> 'array' then
    raise exception 'O rateio de regional precisa ser uma lista.';
  end if;

  if jsonb_array_length(v_rateio) > 0 then
    if v_origem_tipo <> 'avulso' then
      raise exception 'Só a nota avulsa leva rateio de regional: a nota de job ou de BV fica na regional do job.';
    end if;

    for v_rat in select * from jsonb_array_elements(v_rateio)
    loop
      if nullif(v_rat->>'regional_id', '') is null then
        raise exception 'Selecione a regional de cada linha do rateio.';
      end if;
      if nullif(v_rat->>'percentual', '') is null
         or (v_rat->>'percentual')::numeric <= 0
         or (v_rat->>'percentual')::numeric > 100 then
        raise exception 'Cada regional do rateio precisa de um percentual entre 0,01 e 100.';
      end if;

      select r.empresa_id, r.ativo, r.nome
        into v_reg_empresa, v_reg_ativo, v_reg_nome
        from public.regionais r
       where r.id = (v_rat->>'regional_id')::uuid
         and r.tenant_id = v_tenant_id;
      if not found then
        raise exception 'Regional do rateio não encontrada.';
      end if;
      if v_reg_empresa is distinct from v_empresa_id then
        raise exception 'A regional % não é da empresa emissora da nota.', v_reg_nome;
      end if;
      if not v_reg_ativo then
        raise exception 'A regional % está inativa.', v_reg_nome;
      end if;

      v_soma_rateio := v_soma_rateio + (v_rat->>'percentual')::numeric;
    end loop;

    if (select count(distinct x->>'regional_id') from jsonb_array_elements(v_rateio) x)
       <> jsonb_array_length(v_rateio) then
      raise exception 'Cada regional só pode aparecer uma vez no rateio.';
    end if;

    if abs(v_soma_rateio - 100) >= 0.01 then
      raise exception 'O rateio de regional da nota soma %; precisa somar 100%%.',
        replace(to_char(v_soma_rateio, 'FM990.00'), '.', ',') || '%';
    end if;
  end if;

  -- 184: a nota avulsa referente a um job sai na empresa (gerencial), para
  -- o cliente e 100% na regional do job.
  if v_job_ref is not null then
    if v_origem_tipo <> 'avulso' then
      raise exception 'Só a nota avulsa leva job de referência: a de job já é do job.';
    end if;
    select j.codigo, j.status::text, j.empresa_id, j.regional_id, p.cliente_id
      into v_ref_codigo, v_ref_status, v_ref_empresa, v_ref_regional, v_ref_cliente
      from public.jobs j
      join public.projetos p on p.id = j.projeto_id
     where j.id = v_job_ref
       and j.tenant_id = v_tenant_id;
    if not found then
      raise exception 'Job de referência não encontrado.';
    end if;
    if v_ref_status not in ('aberto', 'em_producao', 'encerrado', 'finalizado') then
      raise exception 'O job % não está aberto nem encerrado: a nota não pode se referir a ele.', v_ref_codigo;
    end if;
    if v_ref_empresa is distinct from v_empresa_id then
      raise exception 'A nota referente ao % sai na empresa (gerencial) do job.', v_ref_codigo;
    end if;
    if v_ref_cliente is distinct from v_cliente_id then
      raise exception 'A nota referente ao % sai para o cliente do job.', v_ref_codigo;
    end if;
    if v_ref_regional is null then
      raise exception 'O job % não tem regional: escolha "Sem job" e faça o rateio.', v_ref_codigo;
    end if;
    if jsonb_array_length(v_rateio) <> 1
       or (v_rateio->0->>'regional_id')::uuid is distinct from v_ref_regional
       or abs((v_rateio->0->>'percentual')::numeric - 100) >= 0.01 then
      raise exception 'A nota referente ao % fica 100%% na regional do job.', v_ref_codigo;
    end if;
  end if;

  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    v_soma_parcelas := v_soma_parcelas + (v_parcela->>'valor')::numeric;
  end loop;

  if abs(v_soma_parcelas - v_valor_total) > 0.01 then
    raise exception 'Soma das parcelas (R$ %) não bate com valor total (R$ %).',
      v_soma_parcelas, v_valor_total;
  end if;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    v_soma_itens := v_soma_itens + (v_item->>'valor')::numeric;
  end loop;

  if abs(v_soma_itens - v_valor_total) > 0.01 then
    raise exception 'Soma dos jobs desta NF (R$ %) não bate com o valor total (R$ %).',
      v_soma_itens, v_valor_total;
  end if;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    -- 079: nota só cobre jobs de um mesmo cliente (017 §7). Conferido pelo
    -- job do item e pelo job da parcela — a RPC não exige que sejam o mesmo.
    -- 184: e sai na empresa (gerencial) do job.
    if (v_item->>'origem_tipo') in ('job', 'save') then
      foreach v_job_conferir in array array_remove(array[
        nullif(v_item->>'origem_id', '')::uuid,
        (select par.job_id
           from public.jobs_envio_faturamento_parcelas par
          where par.id = nullif(v_item->>'envio_parcela_id', '')::uuid)
      ], null)
      loop
        select j.codigo, p.cliente_id, coalesce(c.nome_fantasia, c.razao_social), j.empresa_id
          into v_codigo, v_cliente_job, v_nome_cliente, v_job_empresa
          from public.jobs j
          join public.projetos p on p.id = j.projeto_id
          join public.clientes c on c.id = p.cliente_id
         where j.id = v_job_conferir
           and j.tenant_id = v_tenant_id;
        if not found then
          raise exception 'Job desta nota não encontrado.';
        end if;
        if v_cliente_job is distinct from v_cliente_id then
          select coalesce(nome_fantasia, razao_social) into v_nome_nota
            from public.clientes where id = v_cliente_id;
          raise exception
            'Uma nota fiscal cobre apenas jobs de um mesmo cliente: % é do cliente %, e a nota é do cliente %.',
            coalesce(v_codigo, 'o job'), v_nome_cliente, coalesce(v_nome_nota, '(sem cliente)');
        end if;
        if v_job_empresa is distinct from v_empresa_id then
          raise exception 'A nota de % sai na empresa (gerencial) do job.', coalesce(v_codigo, 'job');
        end if;
      end loop;
    end if;

    if nullif(v_item->>'envio_parcela_id', '') is not null then
      select * into v_par
        from public.jobs_envio_faturamento_parcelas
       where id = (v_item->>'envio_parcela_id')::uuid;
      if not found then
        raise exception 'Parcela de faturamento não encontrada.';
      end if;
      if v_par.tenant_id <> v_tenant_id then
        raise exception 'Parcela de faturamento de outro tenant.';
      end if;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.envio_parcela_id = v_par.id
         and f.status = 'emitido';

      v_saldo := v_par.valor - v_ja;
      if (v_item->>'valor')::numeric > v_saldo + 0.01 then
        select codigo into v_codigo from public.jobs where id = v_par.job_id;
        raise exception
          '% (parcela %): o valor a faturar (R$ %) não pode ser maior que o saldo a faturar (R$ %).',
          coalesce(v_codigo, 'Job'), v_par.ordem,
          (v_item->>'valor')::numeric, v_saldo;
      end if;
    end if;

    if (v_item->>'origem_tipo') = 'save' then
      if v_par.job_id is distinct from (v_item->>'origem_id')::uuid then
        raise exception 'O saldo em save só pode ser faturado na nota do job que o gerou.';
      end if;

      select coalesce(faturamento_save_previsto, 0)::numeric(14,2) into v_save_previsto
        from public.jobs where id = (v_item->>'origem_id')::uuid;

      select coalesce(sum(fi.valor), 0)::numeric(14,2) into v_save_ja
        from public.faturamento_itens fi
        join public.faturamentos f on f.id = fi.faturamento_id
       where fi.origem_tipo = 'save'
         and fi.origem_id = (v_item->>'origem_id')::uuid
         and f.status = 'emitido';

      if v_save_ja + (v_item->>'valor')::numeric > v_save_previsto + 0.01 then
        select codigo into v_codigo from public.jobs where id = (v_item->>'origem_id')::uuid;
        raise exception
          '% gerou R$ % de saldo em save e R$ % já saiu em nota: não cabe faturar mais R$ %.',
          coalesce(v_codigo, 'O job'), v_save_previsto, v_save_ja, (v_item->>'valor')::numeric;
      end if;
    end if;

    if (v_item->>'origem_tipo') = 'bv' then
      -- O BV precisa ser do tenant e do fornecedor da nota.
      select b.fornecedor_id, f.nome
        into v_bv_fornecedor, v_nome_fornecedor
        from public.itens_bv b
        left join public.fornecedores f on f.id = b.fornecedor_id
       where b.id = nullif(v_item->>'origem_id', '')::uuid
         and b.tenant_id = v_tenant_id;
      if not found then
        raise exception 'BV desta nota não encontrado.';
      end if;
      if v_bv_fornecedor is distinct from v_fornecedor_id then
        raise exception 'Este BV é do fornecedor %, e a nota é de outro fornecedor.',
          coalesce(v_nome_fornecedor, '(sem fornecedor)');
      end if;

      -- 184: a nota do BV sai na empresa (gerencial) do job do BV.
      select jj.codigo, jj.empresa_id
        into v_codigo, v_job_empresa
        from public.itens_bv b
        join public.jobs_itens_orcado jio on jio.id = b.job_item_orcado_id
        join public.jobs jj on jj.id = jio.job_id
       where b.id = nullif(v_item->>'origem_id', '')::uuid;
      if found and v_job_empresa is distinct from v_empresa_id then
        raise exception 'A nota do BV de % sai na empresa (gerencial) do job.', coalesce(v_codigo, 'job');
      end if;

      if exists (
        select 1 from public.faturamento_itens fi
          join public.faturamentos f on f.id = fi.faturamento_id
         where fi.origem_tipo = 'bv'
           and fi.origem_id = (v_item->>'origem_id')::uuid
           and f.status = 'emitido'
      ) then
        raise exception 'Este BV já foi faturado.';
      end if;
    end if;
  end loop;

  -- 123: uma nota sai para um CNPJ só (D4): as notas do envio que ela
  -- cobre não podem ter CNPJs diferentes. 184: a nota do envio sem CNPJ
  -- (exterior) fica fora da comparação.
  select array_agg(distinct n.cnpj order by n.cnpj) filter (where n.cnpj is not null) into v_cnpjs
    from jsonb_array_elements(v_itens) i
    join public.jobs_envio_faturamento_parcelas par
      on par.id = nullif(i->>'envio_parcela_id', '')::uuid
    join public.jobs_envio_faturamento_notas n on n.id = par.nota_id;

  if coalesce(array_length(v_cnpjs, 1), 0) > 1 then
    raise exception
      'Uma nota fiscal sai para um CNPJ só: os jobs desta nota foram enviados para os CNPJs %.',
      (select string_agg(
                regexp_replace(c, '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5'),
                ', ')
         from unnest(v_cnpjs) c);
  end if;

  -- 184: o CNPJ do tomador é o do formulário; "exterior" sai sem CNPJ; o
  -- BV (contraparte fornecedor) continua sem. Sem o campo no payload (app
  -- antigo), vale a regra da 123: o do envio, senão o do cadastro.
  if v_origem_tipo = 'bv' then
    v_cnpj_tomador := null;
    v_exterior := false;
  elsif v_exterior then
    v_cnpj_tomador := null;
  elsif v_cnpj_form is not null then
    if v_cnpj_form !~ '^[0-9]{14}$' then
      raise exception 'O CNPJ do tomador precisa ter 14 números.';
    end if;
    v_cnpj_tomador := v_cnpj_form;
  elsif coalesce(array_length(v_cnpjs, 1), 0) = 1 then
    v_cnpj_tomador := v_cnpjs[1];
  elsif v_cliente_id is not null then
    select nullif(regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g'), '')
      into v_cnpj_tomador
      from public.clientes c
     where c.id = v_cliente_id;
    if v_cnpj_tomador !~ '^[0-9]{14}$' then
      v_cnpj_tomador := null;
    end if;
  end if;

  insert into public.faturamentos (
    tenant_id, empresa_id, origem_tipo, origem_id,
    cliente_id, fornecedor_id,
    numero_nf, serie, data_emissao, valor_total, descricao, cnae,
    anexo_nf_path, plano_conta_tipo_id, plano_conta_subtipo_id,
    emitido_por, cnpj_tomador, tomador_exterior, job_referencia_id
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', coalesce(nullif(payload->>'serie', ''), '1'),
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao', v_cnae,
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por, v_cnpj_tomador, v_exterior, v_job_ref
  )
  returning id into v_faturamento_id;

  -- 086: o rateio nasce na mesma transação da nota.
  insert into public.faturamentos_regionais (tenant_id, faturamento_id, regional_id, percentual)
  select v_tenant_id, v_faturamento_id, (x->>'regional_id')::uuid, (x->>'percentual')::numeric
    from jsonb_array_elements(v_rateio) x;

  for v_item in select * from jsonb_array_elements(v_itens)
  loop
    insert into public.faturamento_itens (
      tenant_id, faturamento_id, origem_tipo, origem_id,
      envio_parcela_id, valor
    ) values (
      v_tenant_id, v_faturamento_id,
      (v_item->>'origem_tipo')::faturamento_origem,
      nullif(v_item->>'origem_id', '')::uuid,
      nullif(v_item->>'envio_parcela_id', '')::uuid,
      (v_item->>'valor')::numeric
    );
  end loop;

  for v_parcela in select * from jsonb_array_elements(v_parcelas)
  loop
    insert into public.titulos_receber (
      tenant_id, empresa_id, faturamento_id,
      numero_parcela, valor, data_vencimento,
      data_previsao_recebimento, data_previsao_recebimento_primeira
    ) values (
      v_tenant_id, v_empresa_id, v_faturamento_id,
      (v_parcela->>'numero')::smallint,
      (v_parcela->>'valor')::numeric,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date,
      (v_parcela->>'data_vencimento')::date
    );
  end loop;


  -- 130: o recebimento antes da NF das notas do envio (ou do BV) que esta
  -- nota cobre vira a parcela 1, já paga. Os lançamentos dele passam a ser
  -- as baixas dela, na empresa da nota; nada entra de novo na conta.
  select coalesce(sum(r.valor), 0)::numeric(14,2) into v_antes_total
    from public.recebimentos_antes_nf r
   where r.tenant_id = v_tenant_id
     and r.status = 'aguardando'
     and (
       r.envio_nota_id in (
         select par.nota_id
           from jsonb_array_elements(v_itens) i
           join public.jobs_envio_faturamento_parcelas par
             on par.id = nullif(i->>'envio_parcela_id', '')::uuid)
       or r.item_bv_id in (
         select nullif(i->>'origem_id', '')::uuid
           from jsonb_array_elements(v_itens) i
          where i->>'origem_tipo' = 'bv')
     );

  if v_antes_total > 0 then
    if v_antes_total > v_valor_total + 0.004 then
      raise exception 'O recebido antes da NF (R$ %) passa do valor desta nota (R$ %).',
        translate(to_char(v_antes_total, 'FM999,999,990.00'), ',.', '.,'),
        translate(to_char(v_valor_total, 'FM999,999,990.00'), ',.', '.,');
    end if;

    select * into v_titulo1
      from public.titulos_receber
     where faturamento_id = v_faturamento_id and numero_parcela = 1;
    if not found or abs(v_titulo1.valor - v_antes_total) > 0.004 then
      raise exception 'A parcela 1 desta nota precisa ser o que foi recebido antes da NF (R$ %).',
        translate(to_char(v_antes_total, 'FM999,999,990.00'), ',.', '.,');
    end if;

    for v_antes in
      select r.*
        from public.recebimentos_antes_nf r
       where r.tenant_id = v_tenant_id
         and r.status = 'aguardando'
         and (
           r.envio_nota_id in (
             select par.nota_id
               from jsonb_array_elements(v_itens) i
               join public.jobs_envio_faturamento_parcelas par
                 on par.id = nullif(i->>'envio_parcela_id', '')::uuid)
           or r.item_bv_id in (
             select nullif(i->>'origem_id', '')::uuid
               from jsonb_array_elements(v_itens) i
              where i->>'origem_tipo' = 'bv')
         )
       order by r.data, r.created_at
         for update
    loop
      update public.lancamentos_financeiros
         set origem = 'titulo_baixa',
             titulo_receber_id = v_titulo1.id,
             empresa_id = v_empresa_id
       where id = v_antes.lancamento_id;

      update public.recebimentos_antes_nf
         set status = 'aplicado',
             faturamento_id = v_faturamento_id,
             titulo_receber_id = v_titulo1.id,
             aplicado_em = now()
       where id = v_antes.id;

      v_antes_ultimo := v_antes;
    end loop;

    update public.titulos_receber
       set status = 'pago',
           pago_em = v_antes_ultimo.data,
           pago_por = (select auth.uid()),
           conta_bancaria_recebimento_id = v_antes_ultimo.conta_bancaria_id,
           lancamento_id = v_antes_ultimo.lancamento_id
     where id = v_titulo1.id;

    -- Como na baixa: todas as parcelas recebidas, o BV da nota está recebido.
    if not exists (
      select 1 from public.titulos_receber
       where faturamento_id = v_faturamento_id and status = 'em_aberto'
    ) then
      update public.itens_bv set situacao = 'recebido'
       where id in (
         select fi.origem_id from public.faturamento_itens fi
          where fi.faturamento_id = v_faturamento_id and fi.origem_tipo = 'bv');
    end if;
  end if;

  return v_faturamento_id;
end;
$function$;
