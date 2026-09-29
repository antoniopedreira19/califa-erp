-- =====================================================================
-- Decisão 123 (parte 2) — a nota emitida guarda o CNPJ, e a nota
-- agrupada só junta o mesmo CNPJ
-- =====================================================================
--
-- Com a `...500001`, cada nota do envio para faturamento tem o próprio
-- CNPJ do cliente (tomador). Dois pontos que o Tiago aprovou em
-- 29/09/2026 decorrem disso:
--
-- 1. A NOTA EMITIDA GUARDA O CNPJ. Até aqui `faturamentos` só apontava o
--    cliente, porque o CNPJ era sempre o do cadastro. Agora pode ser
--    outro, e sem guardá-lo o histórico perde para quem a nota saiu.
--    `emitir_faturamento` preenche `cnpj_tomador` sozinho: o CNPJ das
--    notas do envio que a nota cobre; sem envio (avulsa), o do cadastro
--    do cliente; BV (contraparte fornecedor) fica nulo.
--    Notas emitidas antes desta migration ficam com o campo nulo — foram
--    todas para o CNPJ do cadastro da época, que a tela mostra no lugar.
--    Preencher com o cadastro de HOJE poderia gravar um CNPJ que mudou.
--
-- 2. A NOTA AGRUPADA SÓ JUNTA O MESMO CNPJ (D4). A 079 já garantia um
--    cliente só; agora também um CNPJ só — uma nota não sai para dois
--    tomadores. Quem garante é o banco; a tela avisa antes.
--
-- E a fila de faturamento (`vw_faturamento_pendente`) ganha, NO FIM (a
-- única posição em que `create or replace view` aceita coluna nova), a
-- nota do envio a que cada parcela pertence: id, posição, CNPJ, CNAE
-- sugerido e descritivo. A tela junta as parcelas de uma nota numa linha
-- só — "uma nota, vários vencimentos".
-- =====================================================================

alter table public.faturamentos
  add column if not exists cnpj_tomador text;

alter table public.faturamentos
  drop constraint if exists chk_faturamento_cnpj_tomador;
alter table public.faturamentos
  add constraint chk_faturamento_cnpj_tomador check (cnpj_tomador is null or cnpj_tomador ~ '^[0-9]{14}$');

comment on column public.faturamentos.cnpj_tomador is
  'Decisão 123: CNPJ para o qual a nota saiu, só dígitos. Nulo nas notas anteriores a 29/09/2026 (foram para o CNPJ do cadastro) e nas de BV.';

-- ---------------------------------------------------------------------
-- A fila de faturamento, com a nota do envio de cada parcela
-- ---------------------------------------------------------------------

create or replace view public.vw_faturamento_pendente as
 WITH parcela_faturada AS (
         SELECT fi.envio_parcela_id,
            sum(fi.valor)::numeric(14,2) AS valor_faturado,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo <> 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(sum(fi.valor) FILTER (WHERE fi.origem_tipo = 'save'::faturamento_origem), 0::numeric)::numeric(14,2) AS faturado_save
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE f.status = 'emitido'::faturamento_status AND fi.envio_parcela_id IS NOT NULL
          GROUP BY fi.envio_parcela_id
        ), parcelas AS (
         SELECT par.id,
            par.envio_id,
            par.job_id,
            par.tenant_id,
            par.ordem,
            par.valor,
            par.data_vencimento,
            count(*) OVER (PARTITION BY par.envio_id)::smallint AS total,
            COALESCE(pf.valor_faturado, 0::numeric)::numeric(14,2) AS ja_faturado,
            COALESCE(pf.faturado_proprio, 0::numeric)::numeric(14,2) AS faturado_proprio,
            COALESCE(pf.faturado_save, 0::numeric)::numeric(14,2) AS faturado_save,
            GREATEST(0::numeric, LEAST(par.valor,
                CASE
                    WHEN e.mes IS NOT NULL THEN e.valor_faturado - COALESCE(e.valor_save, 0::numeric)
                    ELSE COALESCE(j.faturamento_previsto, 0::numeric) - COALESCE(j.faturamento_save_previsto, 0::numeric)
                END - (sum(par.valor) OVER (PARTITION BY par.envio_id ORDER BY par.ordem, par.id) - par.valor)))::numeric(14,2) AS bruto_proprio,
            e.mes,
            par.nota_id,
            n.ordem AS nota_ordem,
            (SELECT count(*) FROM jobs_envio_faturamento_notas n2 WHERE n2.envio_id = par.envio_id)::smallint AS nota_total,
            n.cnpj AS nota_cnpj,
            n.cnae_sugerido AS nota_cnae_sugerido,
            n.descritivo AS nota_descritivo
           FROM jobs_envio_faturamento_parcelas par
             JOIN jobs_envio_faturamento e ON e.id = par.envio_id
             JOIN jobs j ON j.id = par.job_id
             JOIN jobs_envio_faturamento_notas n ON n.id = par.nota_id
             LEFT JOIN parcela_faturada pf ON pf.envio_parcela_id = par.id
        )
 SELECT 'job'::text AS origem_tipo,
    j.id AS origem_id,
    j.tenant_id,
    j.empresa_id,
    j.codigo,
    j.nome AS descricao,
    p.cliente_id,
    NULL::uuid AS fornecedor_id,
    par.valor::numeric AS valor_previsto,
    par.ja_faturado AS valor_ja_faturado,
    (par.valor - par.ja_faturado)::numeric(14,2) AS saldo,
    par.data_vencimento AS data_prevista,
    par.id AS envio_parcela_id,
    par.ordem AS parcela_numero,
    par.total AS parcela_total,
    ( SELECT sum(x.valor - x.ja_faturado)::numeric(14,2) AS sum
           FROM parcelas x
          WHERE x.envio_id = par.envio_id AND (x.valor - x.ja_faturado) > 0::numeric) AS saldo_job,
    LEAST(par.valor, par.bruto_proprio) AS valor_proprio_da_parcela,
    (par.valor - LEAST(par.valor, par.bruto_proprio))::numeric(14,2) AS valor_save_da_parcela,
    GREATEST(0::numeric, LEAST(par.valor, par.bruto_proprio) - par.faturado_proprio)::numeric(14,2) AS saldo_proprio,
    GREATEST(0::numeric, par.valor - LEAST(par.valor, par.bruto_proprio) - par.faturado_save)::numeric(14,2) AS saldo_save,
    j.id AS job_id,
    par.mes AS mes_referencia,
    par.nota_id AS envio_nota_id,
    par.nota_ordem,
    par.nota_total,
    par.nota_cnpj AS cnpj_tomador,
    par.nota_cnae_sugerido AS cnae_sugerido,
    par.nota_descritivo AS descritivo_nota
   FROM parcelas par
     JOIN jobs j ON j.id = par.job_id
     JOIN projetos p ON p.id = j.projeto_id
  WHERE (j.status = ANY (ARRAY['aberto'::job_status, 'encerrado'::job_status, 'finalizado'::job_status])) AND (par.valor - par.ja_faturado) > 0::numeric
UNION ALL
 SELECT 'bv'::text AS origem_tipo,
    bv.id AS origem_id,
    bv.tenant_id,
    NULL::uuid AS empresa_id,
    jbv.codigo,
    'BV — '::text || COALESCE(v.item, jio.item) AS descricao,
    NULL::uuid AS cliente_id,
    bv.fornecedor_id,
    bv.valor AS valor_previsto,
    0::numeric(14,2) AS valor_ja_faturado,
    bv.valor AS saldo,
    bv.prazo_repasse AS data_prevista,
    NULL::uuid AS envio_parcela_id,
    1::smallint AS parcela_numero,
    1::smallint AS parcela_total,
    bv.valor AS saldo_job,
    bv.valor AS valor_proprio_da_parcela,
    0::numeric(14,2) AS valor_save_da_parcela,
    bv.valor AS saldo_proprio,
    0::numeric(14,2) AS saldo_save,
    jio.job_id,
    NULL::date AS mes_referencia,
    NULL::uuid AS envio_nota_id,
    NULL::smallint AS nota_ordem,
    NULL::smallint AS nota_total,
    NULL::text AS cnpj_tomador,
    NULL::text AS cnae_sugerido,
    NULL::text AS descritivo_nota
   FROM itens_bv bv
     LEFT JOIN versoes_orcamento_itens v ON v.id = bv.item_versao_id
     LEFT JOIN jobs_itens_orcado jio ON jio.id = bv.job_item_orcado_id
     LEFT JOIN jobs jbv ON jbv.id = jio.job_id
  WHERE bv.situacao = 'confirmado'::bv_situacao AND NOT (EXISTS ( SELECT 1
           FROM faturamento_itens fi
             JOIN faturamentos f ON f.id = fi.faturamento_id
          WHERE fi.origem_tipo = 'bv'::faturamento_origem AND fi.origem_id = bv.id AND f.status = 'emitido'::faturamento_status));

-- ---------------------------------------------------------------------
-- emitir_faturamento: um CNPJ por nota, e a nota guarda qual foi
-- ---------------------------------------------------------------------
-- A função é a vigente (079 + 086 + 117) com dois acréscimos marcados
-- "123": a conferência do CNPJ depois da do cliente, e `cnpj_tomador` no
-- INSERT da nota. Nada mais mudou.

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
    if (v_item->>'origem_tipo') in ('job', 'save') then
      foreach v_job_conferir in array array_remove(array[
        nullif(v_item->>'origem_id', '')::uuid,
        (select par.job_id
           from public.jobs_envio_faturamento_parcelas par
          where par.id = nullif(v_item->>'envio_parcela_id', '')::uuid)
      ], null)
      loop
        select j.codigo, p.cliente_id, coalesce(c.nome_fantasia, c.razao_social)
          into v_codigo, v_cliente_job, v_nome_cliente
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

  -- 123: uma nota sai para um CNPJ só (D4). O CNPJ é o das notas do envio
  -- que as parcelas cobertas pertencem; sem envio, o do cadastro do
  -- cliente; o BV (contraparte fornecedor) fica sem.
  select array_agg(distinct n.cnpj order by n.cnpj) into v_cnpjs
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

  if coalesce(array_length(v_cnpjs, 1), 0) = 1 then
    v_cnpj_tomador := v_cnpjs[1];
  elsif v_cliente_id is not null and v_origem_tipo <> 'bv' then
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
    emitido_por, cnpj_tomador
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', coalesce(nullif(payload->>'serie', ''), '1'),
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao', v_cnae,
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por, v_cnpj_tomador
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

  return v_faturamento_id;
end;
$function$;
