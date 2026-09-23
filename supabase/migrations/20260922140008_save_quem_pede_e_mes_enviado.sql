-- =============================================================================
-- Decisão 099 — correções da conferência final no navegador (22/09/2026)
-- =============================================================================
--
-- Quatro defeitos achados antes do merge, todos da própria 099:
--
-- 1. QUEM PEDE. `save_pedir`, `save_retirar`, `save_retirar_nao_enviado` e
--    `save_enviar_pendentes('legado_botao')` só conferiam se o job era
--    visível. Pela API, um financeiro pedia save e depois aprovava o próprio
--    pedido — justamente o que o modelo de RPCs existe para impedir — e um
--    freelancer do projeto também pedia. A tela só oferece essas ações a
--    quem `quemPodeMexer` (app/(app)/jobs/[jobId]/carregar-detalhe.ts):
--    administrador, ou GP/produtor RESPONSÁVEL pelo job. O banco passa a
--    conferir a mesma coisa (`save_pode_mexer_no_job`). `cancelar_pedido_save`
--    fica como está: a especificação diz "qualquer membro que enxerga o job".
--
-- 2. AUTOR DO PEDIDO QUE NASCE NA ABERTURA. Em `abertura`/`reenvio` o pedido
--    nasce quando o FINANCEIRO registra a abertura, e `enviado_por` gravava o
--    próprio financeiro — o pop-up "Aprovar save" e a faixa da revisão
--    mostravam o financeiro como autor do save. Passa a ser quem marcou a
--    linha (`save_marcado_por`) ou quem gravou o consumo, e na falta deles
--    quem enviou o job. `legado_botao` segue com quem clicou no botão.
--
-- 3. MÊS JÁ ENVIADO NO MENSAL. O envio de um mês grava a parte de save dele
--    (`jobs_envio_faturamento.valor_save`), e a fila do contas a receber e o
--    fluxo de caixa leem esse número. A 099 permite gerar (e retirar) save
--    num mês já enviado, e a aprovação muda os espelhos do job — mas o
--    `valor_save` do envio ficava congelado, e o financeiro via o mês inteiro
--    como receita própria. No nacional isso não acontece: a fila lê o espelho
--    vivo. Agora `save_gravar_totais` aceita, no mesmo `p_totais`, a parte de
--    save de cada mês já enviado (`saves_por_mes`), calculada pelo
--    TypeScript com a MESMA conta do envio (`faturamentoPorMes`), e regrava o
--    `valor_save` dos envios existentes. Chave ausente = nada muda (nacional).
--    Nota já emitida continua fora (regra 21, pendente).
--
-- 4. CACHE `save_consumido`. A trava de errata na linha que consome save
--    (`save_trava_linha_job`) lê o cache `jobs_itens_orcado.save_consumido`,
--    que nenhum gatilho protegia: com a 140003 ligada, zerar o cache direto
--    pela API liberava a errata de valores de uma linha com consumo
--    aprovado. O cache só é mantido pelo gatilho de `saves_consumos`
--    (`save_consumido_recalcula`), que em job aberto só roda dentro das RPCs
--    (chave `app.save_fluxo`). A escrita direta passa a ser recusada nas
--    mesmas condições da marca de save — e só com a 140003 ligada.
--
-- Tudo aditivo: funções recriadas com o mesmo contrato, um gatilho novo.
-- Nenhum dado muda nesta migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quem mexe no save da linha (espelho de `quemPodeMexer`)
-- -----------------------------------------------------------------------------
create or replace function public.save_pode_mexer_no_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
      from public.jobs j
      join public.tenant_members tm
        on tm.tenant_id = j.tenant_id
       and tm.user_id = (select auth.uid())
       and tm.status = 'ativo'
      join public.profiles p on p.id = tm.user_id and p.ativo = true
     where j.id = p_job_id
       and (tm.role = 'administrador'
            or (tm.role in ('gerente_producao', 'produtor')
                and j.responsavel_id = (select auth.uid())))
  );
$$;

comment on function public.save_pode_mexer_no_job(uuid) is
  'Decisão 099: quem pede, retira ou envia save da linha — administrador, ou GP/produtor responsável pelo job. Espelha quemPodeMexer da tela.';

revoke all on function public.save_pode_mexer_no_job(uuid) from public, anon, authenticated;

-- save_pedir: igual à 140001, com a conferência de quem pede.
create or replace function public.save_pedir(
  p_job_item_orcado_id uuid,
  p_tipo public.save_aprovacao_tipo,
  p_origens jsonb,
  p_numeros jsonb,
  p_errata jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  o            public.jobs_itens_orcado%rowtype;
  v_status     public.job_status;
  v_grupo      text;
  v_origens    jsonb;
  v_antes      jsonb;
  v_valor      numeric(14,2);
  v_substitui  uuid;
  v_errata     uuid;
  v_id         uuid;
  e            jsonb;
begin
  select * into o from public.jobs_itens_orcado where id = p_job_item_orcado_id for update;
  if not found then
    raise exception 'Linha não encontrada.';
  end if;
  if not public.save_job_visivel(o.job_id) then
    raise exception 'Sem acesso a este job.';
  end if;
  if not public.save_pode_mexer_no_job(o.job_id) then
    raise exception 'Apenas o responsável do job ou o administrador muda o save desta linha.';
  end if;
  select j.status into v_status from public.jobs j where j.id = o.job_id;
  if v_status not in ('aberto', 'em_producao') then
    raise exception 'Só um job aberto recebe pedido de save.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id and a.situacao = 'aguardando') then
    raise exception 'Esta linha já tem pedido de save aguardando aprovação: cancele o pedido antes de mudar.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id and a.situacao = 'recusado') then
    raise exception 'O save desta linha foi recusado: retire-o pelo pop-up antes de fazer um pedido novo.';
  end if;

  select g.nome into v_grupo from public.versoes_orcamento_grupos g where g.id = o.grupo_id;

  perform set_config('app.save_fluxo', 'on', true);

  if p_tipo = 'gera' then
    if o.em_save then
      raise exception 'Esta linha já é save.';
    end if;
    update public.jobs_itens_orcado set em_save = true where id = o.id;
    v_origens := '[]'::jsonb;
    v_antes := '[]'::jsonb;
    v_valor := coalesce(o.total_orcado, 0);
  else
    if o.em_save then
      raise exception 'Uma linha não pode gerar e consumir save ao mesmo tempo.';
    end if;
    if p_origens is null or jsonb_typeof(p_origens) <> 'array' then
      raise exception 'Informe de qual job sai o saldo consumido.';
    end if;
    -- Uma entrada por origem, só valores positivos.
    select coalesce(jsonb_agg(jsonb_build_object('job_origem_id', s.job_origem_id, 'valor', s.valor)
                              order by s.job_origem_id), '[]'::jsonb)
      into v_origens
      from (
        select (x->>'job_origem_id')::uuid as job_origem_id,
               sum((x->>'valor')::numeric)::numeric(14,2) as valor
          from jsonb_array_elements(p_origens) x
         where coalesce((x->>'valor')::numeric, 0) > 0
         group by (x->>'job_origem_id')::uuid
      ) s;
    if jsonb_array_length(v_origens) = 0 then
      raise exception 'Informe o valor consumido de ao menos um job. Para tirar o consumo da linha, use Retirar no pop-up.';
    end if;

    v_antes := public.save_origens_da_linha(o.id);
    if v_antes = v_origens then
      raise exception 'O consumo não mudou.';
    end if;
    select a.id into v_substitui
      from public.saves_aprovacoes a
     where a.job_item_orcado_id = o.id and a.tipo = 'consome' and a.situacao = 'aprovado';

    delete from public.saves_consumos where job_item_orcado_id = o.id;
    for e in select * from jsonb_array_elements(v_origens) loop
      insert into public.saves_consumos (tenant_id, job_origem_id, job_item_orcado_id, valor, created_by)
      values (o.tenant_id, (e->>'job_origem_id')::uuid, o.id, (e->>'valor')::numeric, (select auth.uid()));
    end loop;
    select coalesce(sum((x->>'valor')::numeric), 0) into v_valor from jsonb_array_elements(v_origens) x;
  end if;

  v_errata := public.save_registrar_errata(o.id, p_errata);

  insert into public.saves_aprovacoes (
    tenant_id, job_id, job_item_orcado_id, item_descricao, grupo_nome,
    tipo, situacao, momento, valor, origens, origens_antes,
    valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois,
    substitui_id, errata_id, enviado_por
  ) values (
    o.tenant_id, o.job_id, o.id, o.item, v_grupo,
    p_tipo, 'aguardando', 'job_aberto', v_valor, v_origens, v_antes,
    (p_numeros->>'valor_job_antes')::numeric, (p_numeros->>'valor_job_depois')::numeric,
    (p_numeros->>'faturamento_previsto_antes')::numeric, (p_numeros->>'faturamento_previsto_depois')::numeric,
    v_substitui, v_errata, (select auth.uid())
  )
  returning id into v_id;

  perform set_config('app.save_fluxo', '', true);
  return v_id;
end;
$$;

-- save_retirar: igual à 140001, com a conferência de quem retira.
create or replace function public.save_retirar(p_id uuid, p_totais jsonb, p_errata jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  a        public.saves_aprovacoes%rowtype;
  v_status public.job_status;
begin
  select * into a from public.saves_aprovacoes where id = p_id for update;
  if not found then
    raise exception 'Pedido de save não encontrado.';
  end if;
  if not public.save_job_visivel(a.job_id) then
    raise exception 'Sem acesso ao job deste pedido de save.';
  end if;
  if not public.save_pode_mexer_no_job(a.job_id) then
    raise exception 'Apenas o responsável do job ou o administrador muda o save desta linha.';
  end if;
  select j.status into v_status from public.jobs j where j.id = a.job_id;
  if v_status not in ('aberto', 'em_producao') then
    raise exception 'Job encerrado não muda o save: os números dele estão congelados.';
  end if;

  if a.situacao = 'recusado' then
    if p_totais is not null or p_errata is not null then
      raise exception 'Save recusado só se arquiva: os números do job já voltaram na recusa.';
    end if;
    update public.saves_aprovacoes set situacao = 'retirado' where id = p_id;
    return;
  end if;

  if a.situacao <> 'aprovado' then
    raise exception 'Pedido aguardando se cancela, não se retira.';
  end if;
  if a.job_item_orcado_id is null then
    raise exception 'A linha deste save foi removida.';
  end if;
  if p_totais is null or p_errata is null then
    raise exception 'Retirar save aprovado é errata de save e precisa dos números do job.';
  end if;
  perform 1 from public.jobs_itens_orcado where id = a.job_item_orcado_id for update;

  perform set_config('app.save_fluxo', 'on', true);
  if a.tipo = 'gera' then
    -- O trigger da linha confere o uso do saldo e passa o pedido a 'retirado'.
    update public.jobs_itens_orcado set em_save = false where id = a.job_item_orcado_id and em_save;
    if exists (select 1 from public.saves_aprovacoes where id = p_id and situacao = 'aprovado') then
      update public.saves_aprovacoes set situacao = 'retirado' where id = p_id;
    end if;
  else
    delete from public.saves_consumos where job_item_orcado_id = a.job_item_orcado_id;
    update public.saves_aprovacoes set situacao = 'retirado' where id = p_id;
  end if;
  perform public.save_registrar_errata(a.job_item_orcado_id, p_errata);
  perform public.save_gravar_totais(a.job_id, p_totais);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

-- save_retirar_nao_enviado: igual à 140006, com a conferência de quem retira.
create or replace function public.save_retirar_nao_enviado(
  p_job_item_orcado_id uuid,
  p_totais jsonb,
  p_errata jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  o        public.jobs_itens_orcado%rowtype;
  v_status public.job_status;
begin
  select * into o from public.jobs_itens_orcado where id = p_job_item_orcado_id for update;
  if not found then
    raise exception 'Linha não encontrada.';
  end if;
  if not public.save_job_visivel(o.job_id) then
    raise exception 'Sem acesso a este job.';
  end if;
  if not public.save_pode_mexer_no_job(o.job_id) then
    raise exception 'Apenas o responsável do job ou o administrador muda o save desta linha.';
  end if;
  select j.status into v_status from public.jobs j where j.id = o.job_id;
  if v_status not in ('aberto', 'em_producao') then
    raise exception 'Job encerrado não muda o save: os números dele estão congelados.';
  end if;
  if exists (
       select 1 from public.saves_aprovacoes a
        where a.job_item_orcado_id = o.id
          and a.situacao in ('aguardando', 'aprovado', 'recusado')) then
    raise exception 'Esta linha tem pedido de save: use o pop-up de save para cancelar ou retirar.';
  end if;
  if p_totais is null or p_errata is null then
    raise exception 'Retirar save é errata de save e precisa dos números do job.';
  end if;

  perform set_config('app.save_fluxo', 'on', true);
  if o.em_save then
    update public.jobs_itens_orcado set em_save = false where id = o.id;
  elsif exists (select 1 from public.saves_consumos c where c.job_item_orcado_id = o.id) then
    delete from public.saves_consumos where job_item_orcado_id = o.id;
  else
    raise exception 'Esta linha não tem save nem consumo de save.';
  end if;
  perform public.save_registrar_errata(o.id, p_errata);
  perform public.save_gravar_totais(o.job_id, p_totais);
  perform set_config('app.save_fluxo', '', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. save_enviar_pendentes: quem pede o legado e o autor do pedido da abertura
-- -----------------------------------------------------------------------------
create or replace function public.save_enviar_pendentes(
  p_job_id uuid,
  p_momento text,
  p_numeros jsonb
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_job   public.jobs%rowtype;
  r       record;
  n       jsonb;
  v_qtd   integer := 0;
begin
  if p_momento not in ('abertura', 'reenvio', 'legado_botao') then
    raise exception 'Momento de pedido de save inválido.';
  end if;
  select * into v_job from public.jobs where id = p_job_id for update;
  if not found or not public.save_job_visivel(p_job_id) then
    raise exception 'Sem acesso a este job.';
  end if;
  if p_momento in ('abertura', 'reenvio')
     and not (public.is_tenant_admin(v_job.tenant_id) or public.is_tenant_financeiro(v_job.tenant_id)) then
    raise exception 'Só o administrador ou o financeiro abre o job.';
  end if;
  if p_momento = 'legado_botao' and not public.save_pode_mexer_no_job(p_job_id) then
    raise exception 'Apenas o responsável do job ou o administrador envia os saves deste job para aprovação.';
  end if;
  if v_job.status not in ('aberto', 'em_producao') then
    raise exception 'Só um job aberto recebe pedido de save.';
  end if;

  for r in
    select o.id, o.tenant_id, o.item, o.total_orcado, o.em_save, o.save_marcado_por,
           g.nome as grupo_nome,
           public.save_origens_da_linha(o.id) as origens
      from public.jobs_itens_orcado o
      left join public.versoes_orcamento_grupos g on g.id = o.grupo_id
     where o.job_id = p_job_id
       and not exists (
         select 1 from public.saves_aprovacoes a
          where a.job_item_orcado_id = o.id
            and a.situacao in ('aguardando', 'aprovado', 'recusado'))
       and (o.em_save or exists (select 1 from public.saves_consumos c where c.job_item_orcado_id = o.id))
     order by o.id
  loop
    n := case when p_numeros is not null then p_numeros->(r.id::text) end;
    insert into public.saves_aprovacoes (
      tenant_id, job_id, job_item_orcado_id, item_descricao, grupo_nome,
      tipo, situacao, momento, valor, origens, origens_antes,
      valor_job_antes, valor_job_depois, faturamento_previsto_antes, faturamento_previsto_depois,
      enviado_por
    ) values (
      r.tenant_id, p_job_id, r.id, r.item, r.grupo_nome,
      case when r.em_save then 'gera'::public.save_aprovacao_tipo else 'consome'::public.save_aprovacao_tipo end,
      'aguardando', p_momento,
      case when r.em_save then coalesce(r.total_orcado, 0)
           else (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(r.origens) x) end,
      case when r.em_save then '[]'::jsonb else r.origens end,
      '[]'::jsonb,
      (n->>'valor_job_antes')::numeric, (n->>'valor_job_depois')::numeric,
      (n->>'faturamento_previsto_antes')::numeric, (n->>'faturamento_previsto_depois')::numeric,
      -- Na abertura quem chama é o financeiro: o autor do pedido é quem
      -- marcou a linha ou gravou o consumo (na falta, quem enviou o job).
      case when p_momento in ('abertura', 'reenvio') then
        coalesce(
          case when r.em_save then r.save_marcado_por end,
          (select c.created_by
             from public.saves_consumos c
            where c.job_item_orcado_id = r.id and not r.em_save
            order by c.created_at desc
            limit 1),
          v_job.created_by,
          (select auth.uid()))
      else (select auth.uid()) end
    );
    v_qtd := v_qtd + 1;
  end loop;

  return v_qtd;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. save_gravar_totais: a parte de save dos meses já enviados (mensal)
-- -----------------------------------------------------------------------------
create or replace function public.save_gravar_totais(p_job_id uuid, p_totais jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if p_totais is null then
    return;
  end if;
  if not (p_totais ? 'valor_total'
          and p_totais ? 'faturamento_previsto'
          and p_totais ? 'faturamento_save_previsto')
     or (p_totais->>'valor_total') is null
     or (p_totais->>'faturamento_previsto') is null
     or (p_totais->>'faturamento_save_previsto') is null then
    raise exception 'Totais do job incompletos na mudança de save.';
  end if;
  update public.jobs
     set valor_total = (p_totais->>'valor_total')::numeric,
         faturamento_previsto = (p_totais->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p_totais->>'faturamento_save_previsto')::numeric
   where id = p_job_id;

  -- Modelo mensal: o envio de cada mês guarda a parte de save do mês, e a
  -- fila e o fluxo de caixa leem dali. Só os meses já enviados têm linha.
  if p_totais ? 'saves_por_mes' then
    if jsonb_typeof(p_totais->'saves_por_mes') <> 'array' then
      raise exception 'Parte de save por mês inválida na mudança de save.';
    end if;
    update public.jobs_envio_faturamento e
       set valor_save = (x->>'valor_save')::numeric
      from jsonb_array_elements(p_totais->'saves_por_mes') x
     where e.job_id = p_job_id
       and e.mes = (x->>'mes')::date
       and e.valor_save is distinct from (x->>'valor_save')::numeric;
  end if;
end;
$$;

revoke all on function public.save_gravar_totais(uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. O cache save_consumido só muda pelo fluxo de save em job aberto
-- -----------------------------------------------------------------------------
create or replace function public.save_consumido_trava()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status public.job_status;
begin
  if new.save_consumido is distinct from old.save_consumido
     and public.save_aprovacao_em_vigor()
     and not public.save_fluxo_ativo() then
    select j.status into v_status from public.jobs j where j.id = new.job_id;
    if coalesce(v_status in ('aberto', 'em_producao', 'encerrado', 'finalizado'), false) then
      raise exception 'O consumo de save de um job aberto muda pelo pop-up de save da linha, que envia o pedido para aprovação do financeiro.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.save_consumido_trava() from public, anon, authenticated;

drop trigger if exists trg_save_consumido_trava on public.jobs_itens_orcado;
create trigger trg_save_consumido_trava
  before update of save_consumido on public.jobs_itens_orcado
  for each row execute function public.save_consumido_trava();
