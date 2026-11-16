-- Decisão 256: "+ Faturamento" — o Novo faturamento (o financeiro fatura o
-- job no lugar do envio da produção), as deduções, os impostos da nota
-- (CBS e IBS registrados), as retenções previstas do cliente e o
-- recebimento antes da NF preso ao job.
--
-- Racional (Tiago, 12 e 15/11/2026; protótipo aprovado):
--
-- 1. Novo faturamento. Nota de job (`origem_tipo = 'job'`) com itens `job` e
--    `save` SEM parcela de envio, de um job só, marcada com
--    `faturado_pelo_financeiro`. Fecha o envio da produção mesmo abaixo do
--    previsto: o resto fica como saldo com o financeiro. Carimba
--    `jobs.faturamento_enviado_em` pela `job_faturamento_todo_enviado`, que
--    passa a contar o Novo faturamento; o job encerrado fica finalizado. No
--    mensal fecha o mês (`mes_novo_faturamento`), com o previsto que o mês
--    tinha no dia da nota (`previsto_do_mes`); o job fica todo enviado
--    quando todos os meses fecharem. Job com envio do GP esperando nota não
--    tem Novo faturamento (no mensal, o mês): a nota sai pelo envio.
-- 2. Envio fechado: a trava de escrita do envio recusa o envio do job (ou
--    do mês) que o financeiro já faturou pelo Novo faturamento.
-- 3. Cancelada a NF do Novo faturamento, o envio reabre se nada mais cobre
--    o job; o job finalizado volta a encerrado.
-- 4. Deduções (o repasse, custo AR): saem só da base do ISS, em todos os
--    regimes; PIS, COFINS, IRPJ e CSLL ficam sobre o total (o portal da
--    NFS-e só destrincha o ISS) até a contabilidade confirmar.
-- 5. CBS e IBS (reforma tributária, fase de teste): registrados na nota,
--    sobre o líquido (total − ISS − PIS − COFINS), com as alíquotas do
--    cadastro de impostos (parâmetros `cbs` e `ibs`, com vigência).
-- 6. Retenções previstas: as alíquotas que o cliente retém, informadas no
--    Faturar; a baixa abre com elas.
-- 7. Recebimento antes da NF preso ao job (job sem envio), registrado na
--    conciliação; o Faturar associa à nota os que escolher.
--
-- Duas regras do banco ficam mais largas (autorizado pelo Tiago em
-- 15/11/2026; nenhuma linha existente muda): o item `save` sem parcela de
-- envio e o recebimento antes da NF só com o job.

-- ---------------------------------------------------------------------------
-- 1. Colunas novas da nota
-- ---------------------------------------------------------------------------
alter table public.faturamentos
  add column if not exists faturado_pelo_financeiro boolean not null default false,
  add column if not exists mes_novo_faturamento date,
  add column if not exists previsto_do_mes numeric(14,2),
  add column if not exists valor_deducoes numeric(14,2) not null default 0,
  add column if not exists retencoes_previstas jsonb not null default '[]'::jsonb,
  add column if not exists aliquota_cbs numeric(7,4),
  add column if not exists valor_cbs numeric(14,2),
  add column if not exists aliquota_ibs numeric(7,4),
  add column if not exists valor_ibs numeric(14,2);

comment on column public.faturamentos.faturado_pelo_financeiro is
  'Decisão 256: nota do Novo faturamento — o financeiro faturou o job sem o envio da produção.';
comment on column public.faturamentos.mes_novo_faturamento is
  'Decisão 256: o mês (dia 1) que o Novo faturamento fatura no job mensal e na Mídia Off.';
comment on column public.faturamentos.previsto_do_mes is
  'Decisão 256: o previsto do mês no dia da nota do Novo faturamento (fecha o mês no envio).';
comment on column public.faturamentos.valor_deducoes is
  'Decisão 256: o repasse (custo AR) que sai da base do ISS, como no emissor da NFS-e.';
comment on column public.faturamentos.retencoes_previstas is
  'Decisão 256: [{imposto, aliquota}] que o cliente retém na fonte; a baixa abre com elas.';
comment on column public.faturamentos.valor_cbs is
  'Decisão 256: CBS da nota (reforma tributária, fase de teste), sobre o líquido; registro, sem guia.';
comment on column public.faturamentos.valor_ibs is
  'Decisão 256: IBS da nota (reforma tributária, fase de teste), sobre o líquido; registro, sem guia.';

alter table public.faturamentos
  add constraint chk_faturamento_novo_e_job
    check (not faturado_pelo_financeiro or origem_tipo = 'job'),
  add constraint chk_faturamento_mes_do_novo
    check (mes_novo_faturamento is null
           or (faturado_pelo_financeiro and extract(day from mes_novo_faturamento) = 1)),
  add constraint chk_faturamento_previsto_do_mes
    check ((mes_novo_faturamento is null) = (previsto_do_mes is null)
           and coalesce(previsto_do_mes, 0) >= 0),
  add constraint chk_faturamento_deducoes
    check (valor_deducoes >= 0 and valor_deducoes <= valor_total),
  add constraint chk_faturamento_retencoes_previstas
    check (jsonb_typeof(retencoes_previstas) = 'array'),
  add constraint chk_faturamento_cbs_ibs
    check (coalesce(valor_cbs, 0) >= 0 and coalesce(valor_ibs, 0) >= 0
           and coalesce(aliquota_cbs, 0) >= 0 and coalesce(aliquota_ibs, 0) >= 0);

create index if not exists idx_faturamentos_pelo_financeiro
  on public.faturamentos (tenant_id)
  where faturado_pelo_financeiro;

-- ---------------------------------------------------------------------------
-- 2. As duas regras mais largas
-- ---------------------------------------------------------------------------
alter table public.faturamento_itens drop constraint chk_fat_item_origem;
alter table public.faturamento_itens add constraint chk_fat_item_origem check (
     (origem_tipo = 'avulso' and origem_id is null and envio_parcela_id is null)
  or (origem_tipo = 'bv' and origem_id is not null and envio_parcela_id is null)
  or (origem_tipo = 'job' and origem_id is not null)
  or (origem_tipo = 'save' and origem_id is not null)
);

alter table public.recebimentos_antes_nf drop constraint chk_recebimento_antes_nf_alvo;
alter table public.recebimentos_antes_nf add constraint chk_recebimento_antes_nf_alvo check (
     num_nonnulls(envio_nota_id, item_bv_id) = 1
  or (envio_nota_id is null and item_bv_id is null and job_id is not null)
);

-- ---------------------------------------------------------------------------
-- 3. O job todo enviado conta o Novo faturamento
-- ---------------------------------------------------------------------------
create or replace function public.job_faturamento_todo_enviado(p_job_id uuid, p_previsto numeric)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with novo as (
    select f.mes_novo_faturamento as mes, max(f.previsto_do_mes) as previsto_do_mes
      from public.faturamentos f
     where f.faturado_pelo_financeiro
       and f.status = 'emitido'
       and exists (
         select 1 from public.faturamento_itens fi
          where fi.faturamento_id = f.id
            and fi.origem_tipo in ('job', 'save')
            and fi.origem_id = p_job_id)
     group by f.mes_novo_faturamento
  ),
  enviado as (
    select coalesce(sum(e.valor_faturado), 0)
           + coalesce((select sum(n.previsto_do_mes) from novo n where n.mes is not null), 0) as valor
      from public.jobs_envio_faturamento e
     where e.job_id = p_job_id
       and (e.mes is null
            or e.mes not in (select n.mes from novo n where n.mes is not null))
  )
  select coalesce(p_previsto, 0) > 0.004
     and (
       exists (select 1 from novo where mes is null)
       or ((select valor from enviado) > 0
           and (select valor from enviado) >= coalesce(p_previsto, 0) - 0.05)
     );
$function$;

-- ---------------------------------------------------------------------------
-- 4. A emissão
-- ---------------------------------------------------------------------------
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
  -- 256: Novo faturamento, deduções, retenções previstas, CBS/IBS e os
  -- recebimentos do job associados à nota
  v_pelo_fin       boolean := coalesce((payload->>'faturado_pelo_financeiro')::boolean, false);
  v_mes_novo       date := nullif(payload->>'mes_referencia', '')::date;
  v_previsto_mes   numeric(14,2) := nullif(payload->>'previsto_do_mes', '')::numeric;
  v_deducoes       numeric(14,2) := coalesce(nullif(payload->>'valor_deducoes', '')::numeric, 0);
  v_retencoes      jsonb := coalesce(payload->'retencoes_previstas', '[]'::jsonb);
  v_ret            jsonb;
  v_aliq_cbs       numeric(7,4) := nullif(payload->>'aliquota_cbs', '')::numeric;
  v_valor_cbs      numeric(14,2) := nullif(payload->>'valor_cbs', '')::numeric;
  v_aliq_ibs       numeric(7,4) := nullif(payload->>'aliquota_ibs', '')::numeric;
  v_valor_ibs      numeric(14,2) := nullif(payload->>'valor_ibs', '')::numeric;
  v_associados     uuid[] := array[]::uuid[];
  v_qtd_assoc      integer;
  v_job_novo       uuid;
  v_novo_codigo    text;
  v_novo_status    text;
  v_novo_previsto  numeric(14,2);
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

  -- 256: o Novo faturamento (o financeiro fatura o job sem o envio da
  -- produção), as deduções, as retenções previstas e os recebimentos do job.
  if jsonb_typeof(coalesce(payload->'recebidos_associados', '[]'::jsonb)) <> 'array' then
    raise exception 'Os recebimentos associados precisam ser uma lista.';
  end if;
  select coalesce(array_agg(distinct x::uuid), array[]::uuid[]) into v_associados
    from jsonb_array_elements_text(coalesce(payload->'recebidos_associados', '[]'::jsonb)) x;

  if v_pelo_fin then
    if v_origem_tipo <> 'job' then
      raise exception 'O Novo faturamento é uma nota de job.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_itens) i
       where i->>'origem_tipo' not in ('job', 'save')
          or nullif(i->>'envio_parcela_id', '') is not null
          or nullif(i->>'origem_id', '') is null
    ) then
      raise exception 'O Novo faturamento cobre o job, sem parcela do envio da produção.';
    end if;
    if (select count(distinct i->>'origem_id') from jsonb_array_elements(v_itens) i) <> 1 then
      raise exception 'O Novo faturamento cobre um job só.';
    end if;
    v_job_novo := (v_itens->0->>'origem_id')::uuid;

    select j.codigo, j.status::text into v_novo_codigo, v_novo_status
      from public.jobs j
     where j.id = v_job_novo
       and j.tenant_id = v_tenant_id
       for update;
    if not found then
      raise exception 'Job desta nota não encontrado.';
    end if;
    if v_novo_status not in ('aberto', 'em_producao', 'encerrado', 'finalizado') then
      raise exception 'O % não está aberto nem encerrado: o Novo faturamento não sai.', v_novo_codigo;
    end if;

    if v_mes_novo is not null then
      if extract(day from v_mes_novo) <> 1 then
        raise exception 'O mês do Novo faturamento começa no dia 1.';
      end if;
      if v_previsto_mes is null or v_previsto_mes < 0 then
        raise exception 'Informe o previsto do mês do Novo faturamento.';
      end if;
    else
      v_previsto_mes := null;
    end if;

    -- O envio do GP esperando nota trava o Novo faturamento: a nota sai pelo
    -- Faturar do envio. No mensal, vale para o mês.
    if exists (
      select 1 from public.vw_faturamento_pendente v
       where v.origem_tipo = 'job'
         and v.job_id = v_job_novo
         and v.saldo > 0.004
         and (v_mes_novo is null or v.mes_referencia = v_mes_novo)
    ) then
      raise exception 'O GP enviou o % para faturamento e a nota ainda não saiu: fature pelo envio.', v_novo_codigo;
    end if;
  else
    if v_mes_novo is not null then
      raise exception 'Só o Novo faturamento leva o mês.';
    end if;
    v_previsto_mes := null;
    if exists (
      select 1 from jsonb_array_elements(v_itens) i
       where i->>'origem_tipo' in ('job', 'save')
         and nullif(i->>'envio_parcela_id', '') is null
    ) then
      raise exception 'A nota de job sai pelo envio da produção ou pelo Novo faturamento.';
    end if;
  end if;

  -- As deduções (o repasse) saem só da base do ISS (Tiago, 15/11/2026).
  if v_deducoes < 0 or v_deducoes > v_valor_total + 0.004 then
    raise exception 'As deduções vão de zero ao valor total da nota.';
  end if;
  if coalesce(v_valor_cbs, 0) < 0 or coalesce(v_valor_ibs, 0) < 0
     or coalesce(v_aliq_cbs, 0) < 0 or coalesce(v_aliq_ibs, 0) < 0 then
    raise exception 'CBS e IBS não podem ser negativos.';
  end if;

  if jsonb_typeof(v_retencoes) <> 'array' then
    raise exception 'As retenções previstas precisam ser uma lista.';
  end if;
  for v_ret in select * from jsonb_array_elements(v_retencoes)
  loop
    if coalesce(v_ret->>'imposto', '') not in ('ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF') then
      raise exception 'Retenção prevista de imposto desconhecido.';
    end if;
    if nullif(v_ret->>'aliquota', '') is null
       or (v_ret->>'aliquota')::numeric <= 0
       or (v_ret->>'aliquota')::numeric >= 100 then
      raise exception 'A alíquota retida de % vai de 0,01 a 99,99%%.', v_ret->>'imposto';
    end if;
  end loop;
  if (select count(distinct r->>'imposto') from jsonb_array_elements(v_retencoes) r)
     <> jsonb_array_length(v_retencoes) then
    raise exception 'Cada imposto aparece uma vez nas retenções previstas.';
  end if;
  -- Guarda só o imposto e a alíquota: o valor se refaz (ISS sobre a base,
  -- os federais sobre o total), como na baixa.
  select coalesce(jsonb_agg(jsonb_build_object('imposto', r->>'imposto', 'aliquota', (r->>'aliquota')::numeric)
                  order by r->>'imposto'), '[]'::jsonb)
    into v_retencoes
    from jsonb_array_elements(v_retencoes) r;

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
    select j.codigo, j.status::text, j.empresa_id, j.regional_id, j.cliente_id
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
        select j.codigo, j.cliente_id, coalesce(c.nome_fantasia, c.razao_social), j.empresa_id
          into v_codigo, v_cliente_job, v_nome_cliente, v_job_empresa
          from public.jobs j
          join public.projetos p on p.id = j.projeto_id
          join public.clientes c on c.id = j.cliente_id
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

      v_saldo := v_par.valor + public._variacao_cambial_da_parcela(v_par.id) - v_ja;
      if (v_item->>'valor')::numeric > v_saldo + 0.01 then
        select codigo into v_codigo from public.jobs where id = v_par.job_id;
        raise exception
          '% (parcela %): o valor a faturar (R$ %) não pode ser maior que o saldo a faturar (R$ %).',
          coalesce(v_codigo, 'Job'), v_par.ordem,
          (v_item->>'valor')::numeric, v_saldo;
      end if;
    end if;

    if (v_item->>'origem_tipo') = 'save' then
      -- 256: no Novo faturamento o save vem sem parcela de envio, do job da nota.
      if nullif(v_item->>'envio_parcela_id', '') is null then
        if not v_pelo_fin or (v_item->>'origem_id')::uuid is distinct from v_job_novo then
          raise exception 'O saldo em save só pode ser faturado na nota do job que o gerou.';
        end if;
      elsif v_par.job_id is distinct from (v_item->>'origem_id')::uuid then
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
    emitido_por, cnpj_tomador, tomador_exterior, job_referencia_id,
    faturado_pelo_financeiro, mes_novo_faturamento, previsto_do_mes, valor_deducoes,
    retencoes_previstas, aliquota_cbs, valor_cbs, aliquota_ibs, valor_ibs
  ) values (
    v_tenant_id, v_empresa_id, v_origem_tipo, v_origem_id,
    v_cliente_id, v_fornecedor_id,
    payload->>'numero_nf', coalesce(nullif(payload->>'serie', ''), '1'),
    (payload->>'data_emissao')::date, v_valor_total, payload->>'descricao', v_cnae,
    payload->>'anexo_nf_path', v_tipo_id, v_subtipo_id,
    v_emitido_por, v_cnpj_tomador, v_exterior, v_job_ref,
    v_pelo_fin, case when v_pelo_fin then v_mes_novo end, v_previsto_mes, round(v_deducoes, 2),
    v_retencoes, v_aliq_cbs, v_valor_cbs, v_aliq_ibs, v_valor_ibs
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
       or (r.id = any(v_associados)
           and r.envio_nota_id is null
           and r.item_bv_id is null
           and r.job_id in (
             select nullif(i->>'origem_id', '')::uuid
               from jsonb_array_elements(v_itens) i
              where i->>'origem_tipo' in ('job', 'save')))
     );

  -- 256: cada recebimento associado é do job da nota e ainda espera nota.
  if cardinality(v_associados) > 0 then
    select count(*) into v_qtd_assoc
      from public.recebimentos_antes_nf r
     where r.id = any(v_associados)
       and r.tenant_id = v_tenant_id
       and r.status = 'aguardando'
       and r.envio_nota_id is null
       and r.item_bv_id is null
       and r.job_id in (
         select nullif(i->>'origem_id', '')::uuid
           from jsonb_array_elements(v_itens) i
          where i->>'origem_tipo' in ('job', 'save'));
    if v_qtd_assoc <> cardinality(v_associados) then
      raise exception 'Um recebimento associado não é do job desta nota ou já entrou em outra nota.';
    end if;
  end if;

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
           or (r.id = any(v_associados)
               and r.envio_nota_id is null
               and r.item_bv_id is null
               and r.job_id in (
                 select nullif(i->>'origem_id', '')::uuid
                   from jsonb_array_elements(v_itens) i
                  where i->>'origem_tipo' in ('job', 'save')))
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

  -- 256: o Novo faturamento fecha o envio da produção, mesmo abaixo do
  -- previsto (o resto fica como saldo com o financeiro). No mensal fecha o
  -- mês, e o job só fica todo enviado quando todos os meses fecharem. O job
  -- encerrado fica finalizado, como no envio do GP.
  if v_pelo_fin then
    select j.status::text, j.faturamento_previsto into v_novo_status, v_novo_previsto
      from public.jobs j
     where j.id = v_job_novo;
    if public.job_faturamento_todo_enviado(v_job_novo, v_novo_previsto) then
      if v_novo_status = 'encerrado' then
        update public.jobs
           set faturamento_enviado_em = coalesce(faturamento_enviado_em, now()),
               status = 'finalizado',
               finalizado_em = now()
         where id = v_job_novo;
        if auth.uid() is not null then
          perform public.log_audit_event(
            'job.finalizado', v_tenant_id, 'job', v_job_novo::text,
            jsonb_build_object('momento', 'novo_faturamento', 'faturamento_id', v_faturamento_id)
          );
        end if;
      else
        update public.jobs
           set faturamento_enviado_em = coalesce(faturamento_enviado_em, now())
         where id = v_job_novo;
      end if;
    end if;
  end if;

  return v_faturamento_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. O cancelamento reabre o envio da nota do Novo faturamento
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_faturamento(p_faturamento_id uuid, p_motivo text, p_cancelado_por uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_fat       faturamentos%rowtype;
  v_qtd_pagos integer;
  v_bv        record;
  v_antes     recebimentos_antes_nf%rowtype;
  -- 256
  v_job       record;
  v_status    text;
  v_previsto  numeric(14,2);
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_fat from public.faturamentos where id = p_faturamento_id;
  if not found then raise exception 'Faturamento não encontrado.'; end if;
  if not public.is_tenant_member(v_fat.tenant_id) then
    raise exception 'Sem acesso a este faturamento.';
  end if;
  if v_fat.status <> 'emitido' then
    raise exception 'Faturamento já está cancelado.';
  end if;

  -- 130 (E6): o recebimento antes da NF volta a esperar a nota, sem sair
  -- do extrato. Com estorno na parcela, não dá para desfazer sozinho.
  if exists (
    select 1
      from public.recebimentos_antes_nf r
      join public.lancamentos_financeiros e on e.estorno_de_lancamento_id = r.lancamento_id
     where r.faturamento_id = p_faturamento_id and r.status = 'aplicado'
  ) then
    raise exception 'A parcela recebida antes da NF tem estorno. Cancele a baixa dela em Títulos a Receber antes de cancelar a NF.';
  end if;

  for v_antes in
    select * from public.recebimentos_antes_nf
     where faturamento_id = p_faturamento_id and status = 'aplicado'
       for update
  loop
    update public.lancamentos_financeiros
       set origem = 'recebimento_antes_nf',
           titulo_receber_id = null,
           empresa_id = v_antes.empresa_id
     where id = v_antes.lancamento_id;

    update public.recebimentos_antes_nf
       set status = 'aguardando',
           faturamento_id = null,
           titulo_receber_id = null,
           aplicado_em = null
     where id = v_antes.id;
  end loop;

  -- A parcela que só tinha o recebimento volta a ficar em aberto, para
  -- ser cancelada com as outras logo abaixo.
  update public.titulos_receber t
     set status = 'em_aberto',
         pago_em = null,
         pago_por = null,
         conta_bancaria_recebimento_id = null,
         lancamento_id = null
   where t.faturamento_id = p_faturamento_id
     and t.status = 'pago'
     and not exists (
       select 1 from public.lancamentos_financeiros l
        where l.titulo_receber_id = t.id and l.origem = 'titulo_baixa'
     );

  -- Título com qualquer baixa, inteira ou parcial (decisão 125).
  select count(distinct t.id) into v_qtd_pagos
    from public.titulos_receber t
    join public.lancamentos_financeiros l
      on l.titulo_receber_id = t.id and l.origem = 'titulo_baixa'
   where t.faturamento_id = p_faturamento_id;

  if v_qtd_pagos > 0 then
    raise exception 'Existem % títulos com baixa. Cancele as baixas antes de cancelar a NF.', v_qtd_pagos;
  end if;

  if exists (
    select 1
      from public.faturamento_itens fi
      join public.saves_consumos sc on sc.job_origem_id = fi.origem_id
      join public.jobs_itens_orcado oc on oc.id = sc.job_item_orcado_id
      join public.jobs jc on jc.id = oc.job_id
     where fi.faturamento_id = p_faturamento_id
       and fi.origem_tipo = 'save'
       and jc.status in ('encerrado', 'finalizado')
  ) then
    raise exception 'Esta nota carrega saldo em save que já foi consumido por job encerrado. Cancelá-la reescreveria a margem de um job que já está congelado.';
  end if;

  update public.titulos_receber
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por
   where faturamento_id = p_faturamento_id
     and status = 'em_aberto';

  update public.faturamentos
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por,
         motivo_cancelamento = p_motivo
   where id = p_faturamento_id;

  for v_bv in
    select fi.origem_id from public.faturamento_itens fi
     where fi.faturamento_id = p_faturamento_id and fi.origem_tipo = 'bv'
  loop
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_bv.origem_id and situacao = 'recebido';
  end loop;

  if v_fat.origem_tipo = 'bv' and v_fat.origem_id is not null then
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_fat.origem_id and situacao = 'recebido';
  end if;

  -- 256: cancelada a NF do Novo faturamento, o envio da produção reabre se
  -- nada mais cobre o job (outra nota do financeiro ou o envio do GP); o
  -- job finalizado volta a encerrado.
  if v_fat.faturado_pelo_financeiro then
    for v_job in
      select distinct fi.origem_id as id
        from public.faturamento_itens fi
       where fi.faturamento_id = p_faturamento_id
         and fi.origem_tipo in ('job', 'save')
         and fi.origem_id is not null
    loop
      select j.status::text, j.faturamento_previsto into v_status, v_previsto
        from public.jobs j
       where j.id = v_job.id
         for update;
      if not public.job_faturamento_todo_enviado(v_job.id, v_previsto) then
        update public.jobs
           set faturamento_enviado_em = null,
               status = case when status = 'finalizado' then 'encerrado'::public.job_status else status end,
               finalizado_em = case when status = 'finalizado' then null else finalizado_em end
         where id = v_job.id;
        if v_status = 'finalizado' and auth.uid() is not null then
          perform public.log_audit_event(
            'job.finalizacao_desfeita', v_fat.tenant_id, 'job', v_job.id::text,
            jsonb_build_object('momento', 'cancelamento_do_novo_faturamento', 'faturamento_id', p_faturamento_id)
          );
        end if;
      end if;
    end loop;
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. O envio fechado pelo Novo faturamento
-- ---------------------------------------------------------------------------
create or replace function public.envio_faturamento_guarda_escrita_direta()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_status    text;
  v_revisao   boolean;
  v_tenant    uuid;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(public.session_role()::text, '') not in ('administrador', 'financeiro') then
      raise exception 'Só o financeiro altera um envio para faturamento já feito.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- O papel de quem envia é conferido por `envio_faturamento_autor`.
  select j.status::text, coalesce(j.abertura_em_revisao, false), j.tenant_id
    into v_status, v_revisao, v_tenant
    from public.jobs j
   where j.id = new.job_id;

  if not found or v_tenant is distinct from new.tenant_id then
    raise exception 'Job não encontrado.' using errcode = '42501';
  end if;
  if v_status not in ('aberto', 'em_producao', 'encerrado') then
    raise exception 'Só job aberto ou encerrado pode ser enviado para faturamento.'
      using errcode = '42501';
  end if;
  if v_revisao then
    raise exception 'O envio para faturamento volta quando o financeiro salvar a revisão da abertura.'
      using errcode = '42501';
  end if;

  -- 256: o financeiro já faturou o job (no mensal, o mês) pelo Novo
  -- faturamento: o envio da produção está fechado.
  if exists (
    select 1
      from public.faturamentos f
      join public.faturamento_itens fi on fi.faturamento_id = f.id
     where f.faturado_pelo_financeiro
       and f.status = 'emitido'
       and fi.origem_tipo in ('job', 'save')
       and fi.origem_id = new.job_id
       and (f.mes_novo_faturamento is null or f.mes_novo_faturamento = new.mes)
  ) then
    raise exception 'O financeiro já faturou este job pelo Novo faturamento: o envio para faturamento está fechado.'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. O recebimento antes da NF preso ao job (job sem envio)
-- ---------------------------------------------------------------------------
create or replace function public.registrar_recebimento_antes_nf_do_job(
  p_job_id uuid,
  p_data date,
  p_conta_bancaria_id uuid,
  p_valor numeric,
  p_tipo_id uuid,
  p_subtipo_id uuid
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid           uuid;
  v_tenant        uuid;
  v_empresa       uuid;
  v_cliente       uuid;
  v_codigo        text;
  v_nome          text;
  v_status        text;
  v_regional      uuid;
  v_previsto      numeric;
  v_faturado      numeric;
  v_ja            numeric;
  v_cabe          numeric;
  v_valor         numeric := round(p_valor, 2);
  v_conta         contas_bancarias%rowtype;
  v_subtipo_tipo  uuid;
  v_lancamento    uuid;
  v_id            uuid;
begin
  if p_job_id is null then
    raise exception 'Escolha o job do recebimento.';
  end if;
  if p_data is null then
    raise exception 'Informe a data do recebimento.';
  end if;

  -- Tranca o job antes de somar, para dois registros ao mesmo tempo não
  -- passarem juntos do saldo.
  select j.tenant_id, j.empresa_id, j.cliente_id, j.codigo, j.nome, j.status::text,
         j.regional_id, coalesce(j.faturamento_previsto, 0)
    into v_tenant, v_empresa, v_cliente, v_codigo, v_nome, v_status, v_regional, v_previsto
    from public.jobs j
   where j.id = p_job_id
     for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;

  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  if v_status not in ('aberto', 'em_producao', 'encerrado', 'finalizado') then
    raise exception 'O % não está aberto nem encerrado.', v_codigo;
  end if;
  if v_empresa is null then
    raise exception 'O % não tem empresa para o recebimento.', v_codigo;
  end if;

  -- Com envio do GP esperando nota, o recebimento vai para a nota do envio.
  if exists (
    select 1 from public.vw_faturamento_pendente v
     where v.origem_tipo = 'job' and v.job_id = p_job_id and v.saldo > 0.004
  ) then
    raise exception 'O % tem envio do GP esperando nota: o recebimento vai para a nota do envio.', v_codigo;
  end if;

  select coalesce(sum(fi.valor), 0) into v_faturado
    from public.faturamento_itens fi
    join public.faturamentos f on f.id = fi.faturamento_id
   where fi.origem_tipo in ('job', 'save')
     and fi.origem_id = p_job_id
     and f.status = 'emitido';

  select coalesce(sum(r.valor), 0) into v_ja
    from public.recebimentos_antes_nf r
   where r.job_id = p_job_id
     and r.status = 'aguardando'
     and r.envio_nota_id is null
     and r.item_bv_id is null;

  v_cabe := round(v_previsto - v_faturado - v_ja, 2);
  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe o valor recebido.';
  end if;
  if v_valor > v_cabe + 0.004 then
    raise exception 'O valor passa do que falta faturar do % (R$ %).',
      v_codigo, translate(to_char(greatest(v_cabe, 0), 'FM999,999,990.00'), ',.', '.,');
  end if;

  if p_tipo_id is null or p_subtipo_id is null then
    raise exception 'Selecione o centro de custo do recebimento.';
  end if;
  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_conta := public._conta_da_baixa(p_conta_bancaria_id, v_tenant, p_data, 'recebimento');

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, regional_id,
    origem, criado_por
  ) values (
    v_tenant, v_empresa, p_conta_bancaria_id, p_data, v_valor,
    'entrada',
    'Recebimento antes da NF · ' || coalesce(v_codigo || ' · ', '') || substring(coalesce(v_nome, ''), 1, 120),
    p_tipo_id, p_subtipo_id,
    null, v_cliente, p_job_id, v_regional,
    'recebimento_antes_nf', v_uid
  )
  returning id into v_lancamento;

  insert into public.recebimentos_antes_nf (
    tenant_id, empresa_id, envio_nota_id, item_bv_id, job_id, cliente_id, fornecedor_id,
    lancamento_id, valor, data, conta_bancaria_id, criado_por
  ) values (
    v_tenant, v_empresa, null, null, p_job_id, v_cliente, null,
    v_lancamento, v_valor, p_data, p_conta_bancaria_id, v_uid
  )
  returning id into v_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_tenant, 'recebimento_antes_nf', v_id::text,
    'recebimento_antes_nf.registrado', v_uid,
    jsonb_build_object(
      'job_id', p_job_id,
      'codigo', v_codigo,
      'preso_ao_job', true,
      'valor', v_valor,
      'data', p_data,
      'conta_bancaria_id', p_conta_bancaria_id,
      'lancamento_id', v_lancamento
    )
  );

  return v_id;
end;
$function$;

revoke all on function public.registrar_recebimento_antes_nf_do_job(uuid, date, uuid, numeric, uuid, uuid) from public, anon;
grant execute on function public.registrar_recebimento_antes_nf_do_job(uuid, date, uuid, numeric, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. CBS e IBS no cadastro de impostos (fase de teste de 2026)
-- ---------------------------------------------------------------------------
insert into public.fiscal_parametros (tenant_id, chave, valor, descricao, vigencia_inicio)
select p.tenant_id, x.chave, x.valor, x.descricao, date '2026-01-01'
  from (select distinct tenant_id from public.fiscal_parametros where chave = 'irpj') p
 cross join (values
   ('cbs', 0.9::numeric, 'CBS da reforma tributária (fase de teste): sobre o líquido da nota (total − ISS − PIS − COFINS); registro, sem guia'),
   ('ibs', 0.1::numeric, 'IBS da reforma tributária (fase de teste): sobre o líquido da nota (total − ISS − PIS − COFINS); registro, sem guia')
 ) as x(chave, valor, descricao)
 where not exists (
   select 1 from public.fiscal_parametros f
    where f.tenant_id = p.tenant_id and f.chave = x.chave
 );
