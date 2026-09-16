-- A nota avulsa nasce com rateio de regional (decisão 086).
--
-- O problema: a nota fiscal sem job (`faturamentos.origem_tipo = 'avulso'`)
-- não tinha de onde tirar regional. Pela 069 a regional da receita vem do
-- job da nota — e a avulsa não tem job. O título previsto e a baixa dele
-- entravam no fluxo de caixa e no DRE sem regional nenhuma.
--
-- A regra é a mesma da despesa sem job (082): uma regional ou várias, com
-- o rateio definido na criação e somando 100%. A nota de job ou de BV não
-- leva rateio — fica na regional do job.
--
-- O rateio é da NOTA, não da parcela: todas as parcelas de recebimento se
-- dividem igual, e a baixa de cada uma (e o estorno dela) herda a divisão.
--
-- Esta migration é a primeira de duas. Ela cria a tabela, as travas de
-- forma (só nota avulsa, soma 100), grava o rateio na emissão e faz a view
-- ler. A trava que EXIGE rateio na nota avulsa vem em migration própria,
-- depois que o formulário novo estiver no ar — a ordem que faltou em
-- 08/09/2026 e que a 084 seguiu.

-- ---------------------------------------------------------------------
-- 1) A tabela
-- ---------------------------------------------------------------------
create table public.faturamentos_regionais (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  faturamento_id uuid not null references public.faturamentos(id) on delete cascade,
  regional_id    uuid not null references public.regionais(id) on delete restrict,
  percentual     numeric(5,2) not null,
  created_at     timestamptz not null default now(),
  constraint chk_faturamento_rateio_percentual check (percentual > 0 and percentual <= 100),
  constraint uniq_faturamento_regional unique (faturamento_id, regional_id)
);

comment on table public.faturamentos_regionais is
  'Decisão 086: rateio de regional da nota fiscal avulsa (sem job). Soma 100%. Nota de job ou de BV não tem linha aqui: fica na regional do job.';

create index idx_faturamento_rateio_regional on public.faturamentos_regionais (regional_id);
create index idx_faturamento_rateio_tenant on public.faturamentos_regionais (tenant_id);

-- Leitura: quem vê a nota vê o rateio dela. O `exists` passa pela RLS de
-- `faturamentos` (tenant e empresa), então a regra de visibilidade é uma só.
alter table public.faturamentos_regionais enable row level security;

create policy faturamento_rateio_select on public.faturamentos_regionais
  for select to authenticated
  using (exists (select 1 from public.faturamentos f where f.id = faturamentos_regionais.faturamento_id));

-- Escrita só pela emissão (`emitir_faturamento`, SECURITY DEFINER). A nota
-- emitida não se edita; não há policy de escrita, e o GRANT também não dá.
revoke all on table public.faturamentos_regionais from anon, authenticated;
grant select on table public.faturamentos_regionais to authenticated;

-- ---------------------------------------------------------------------
-- 2) As travas de forma
-- ---------------------------------------------------------------------
create or replace function public.rateio_so_na_nota_avulsa()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_origem faturamento_origem;
begin
  select f.origem_tipo into v_origem
    from public.faturamentos f
   where f.id = new.faturamento_id;

  if v_origem is distinct from 'avulso' then
    raise exception 'Só a nota avulsa leva rateio de regional: a nota de job ou de BV fica na regional do job.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_faturamento_rateio_so_avulsa
  before insert or update on public.faturamentos_regionais
  for each row execute function public.rateio_so_na_nota_avulsa();

create or replace function public.enforce_rateio_soma_100_faturamento()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id   uuid;
  v_soma numeric(7,2);
begin
  if tg_op = 'DELETE' then
    v_id := old.faturamento_id;
  else
    v_id := new.faturamento_id;
  end if;

  select coalesce(sum(r.percentual), 0) into v_soma
    from public.faturamentos_regionais r
   where r.faturamento_id = v_id;

  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'O rateio de regional da nota soma %; precisa somar 100%%.',
      replace(to_char(v_soma, 'FM990.00'), '.', ',') || '%'
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

create constraint trigger trg_faturamento_rateio_soma
  after insert or update or delete on public.faturamentos_regionais
  deferrable initially deferred
  for each row execute function public.enforce_rateio_soma_100_faturamento();

revoke all on function public.rateio_so_na_nota_avulsa() from public, anon, authenticated;
revoke all on function public.enforce_rateio_soma_100_faturamento() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) A emissão grava o rateio junto da nota
-- ---------------------------------------------------------------------
-- Igual à versão de 14/09/2026 (079), com o bloco do rateio acrescentado.
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

  insert into public.faturamentos (
    tenant_id, empresa_id, origem_tipo, origem_id,
    cliente_id, fornecedor_id,
    numero_nf, serie, data_emissao, valor_total, descricao, cnae,
    anexo_nf_path, plano_conta_tipo_id, plano_conta_subtipo_id,
    emitido_por
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', coalesce(nullif(payload->>'serie', ''), '1'),
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao', v_cnae,
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por
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

-- ---------------------------------------------------------------------
-- 4) O fluxo de caixa divide o título e a baixa pelo rateio da nota
-- ---------------------------------------------------------------------
-- A view é grande demais para reescrever inteira sem risco; o padrão da
-- 20260915150003 é trocar trechos exatos. Cada âncora precisa aparecer uma
-- vez só — se a view tiver mudado por baixo, a migration para aqui.
--
-- a) CTE `fat_rateio`, antes de `lancamento_rateio`, que já a usa.
-- b) A baixa de título (e o estorno dela) de nota com rateio sai do ramo
--    genérico e ganha o seu, com fator.
-- c) O título previsto: sem job no item, divide pela regional da nota.
do $patch$
declare
  v text := pg_get_viewdef('public.vw_fluxo_caixa'::regclass);
  ancoras text[] := array[
    E'), lancamento_rateio AS (',
    E'          WHERE ((l.conta_avulsa_id IS NULL) AND (l.desembolso_id IS NULL))\n        ), fat_composicao AS (',
    E'((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)))::numeric(14,2) AS valor,',
    E'COALESCE(j.regional_id, t.regional_id) AS regional_id,',
    E'     LEFT JOIN jobs j ON ((j.id = c.job_id)))\n  WHERE ((t.status = ''em_aberto''::titulo_receber_status) AND (tp.valor_proprio > (0)::numeric))'
  ];
  trocas text[] := array[
    E'), fat_rateio AS (\n         SELECT r.faturamento_id,\n            r.regional_id,\n            (r.percentual / 100.0) AS fator\n           FROM faturamentos_regionais r\n        ), lancamento_rateio AS (',
    E'          WHERE ((l.conta_avulsa_id IS NULL) AND (l.desembolso_id IS NULL) AND (NOT (EXISTS ( SELECT 1\n                   FROM (titulos_receber tr\n                     JOIN fat_rateio fr ON ((fr.faturamento_id = tr.faturamento_id)))\n                  WHERE (tr.id = l.titulo_receber_id)))))\n        UNION ALL\n         SELECT l.id,\n            fr.regional_id,\n            fr.fator\n           FROM ((lancamentos_financeiros l\n             JOIN titulos_receber tr ON ((tr.id = l.titulo_receber_id)))\n             JOIN fat_rateio fr ON ((fr.faturamento_id = tr.faturamento_id)))\n          WHERE ((l.conta_avulsa_id IS NULL) AND (l.desembolso_id IS NULL))\n        ), fat_composicao AS (',
    E'(((tp.valor_proprio * COALESCE((c.valor / NULLIF(ft.total, (0)::numeric)), (1)::numeric)) * COALESCE(fr.fator, 1.0)))::numeric(14,2) AS valor,',
    E'COALESCE(j.regional_id, fr.regional_id, t.regional_id) AS regional_id,',
    E'     LEFT JOIN jobs j ON ((j.id = c.job_id)))\n     LEFT JOIN fat_rateio fr ON (((fr.faturamento_id = t.faturamento_id) AND (c.job_id IS NULL)))\n  WHERE ((t.status = ''em_aberto''::titulo_receber_status) AND (tp.valor_proprio > (0)::numeric))'
  ];
  i int;
  n int;
begin
  for i in 1 .. array_length(ancoras, 1) loop
    n := (length(v) - length(replace(v, ancoras[i], ''))) / length(ancoras[i]);
    if n <> 1 then
      raise exception 'vw_fluxo_caixa: a âncora % aparece % vez(es), e precisava aparecer uma. A view mudou; revise a migration.', i, n;
    end if;
    v := replace(v, ancoras[i], trocas[i]);
  end loop;

  v := rtrim(rtrim(v), ';');
  execute 'create or replace view public.vw_fluxo_caixa as ' || v;
end
$patch$;
