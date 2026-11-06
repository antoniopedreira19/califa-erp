-- =====================================================================
-- 240 — O financeiro põe o job no Interno, ou tira dele, pelo "Editar
--       registro" (revê a 105, resposta 3-a)
--
-- Pedido do Tiago em 05/11/2026 (docs/decisions/240). Até aqui o gatilho
-- `job_servico_e_categoria_seguem_a_planilha` recusava a troca: o Interno
-- decide a planilha do job (só custo F · Interno, planejado igual ao
-- orçado) e ela nasceu no orçamento. Agora a troca é possível nos dois
-- sentidos, sempre levando o ORÇAMENTO junto — exceção à 055, só para o
-- Interno —, porque todas as regras do Interno (errata, planejado, save,
-- faturamento) leem o serviço do orçamento (`orcamento_de_investimento_interno`).
--
--   Entrar: todas as linhas do job e de todas as versões viram FI, e o
--           planejado passa a ser o orçado (os gatilhos que já existem
--           fazem isso: `orcamento_entra_no_interno` nas versões e
--           `planejado_espelha_orcado` em cada linha). O BV em negociação
--           das linhas do job é cancelado.
--   Sair:   as linhas FI do job e de todas as versões viram B. O planejado
--           fica como está.
--
-- Bloqueiam a entrada (respostas do Tiago): linha em save (ou pedido de
-- save aguardando), BV confirmado ou recebido, nota emitida, recebimento
-- registrado. Também o envio para faturamento já feito: o Interno não
-- fatura, e o envio ficaria pendente no financeiro sem nota a emitir.
-- As linhas A e D não bloqueiam: viram FI e passam a ser pagas pela
-- California por PP (o pop-up avisa).
--
-- Os espelhos do job (valor total, faturamento previsto, faturamento de
-- save) chegam calculados pela action, como na aprovação de save
-- (`decidir_pedido_save`): a conta do fechamento mora no TypeScript
-- (`lib/data/espelhos-do-job.ts`) e não é repetida aqui. A action calcula
-- sobre as linhas JÁ convertidas, confere as previsões contra esses
-- números e só então chama esta função — que faz tudo numa transação.
--
-- As previsões (recebimento, impostos, desembolso) não são tocadas aqui:
-- o "Salvar alterações" regrava as três logo depois, como sempre.
--
-- Aditiva: duas funções novas e a mensagem do gatilho do job reescrita.
-- Nenhum dado muda ao aplicar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. O que impede o job de entrar no Interno
-- ---------------------------------------------------------------------
-- Uma frase por motivo, na língua da tela: é o que o pop-up lista. Vazio
-- quando nada impede. Quem não é administrador ou financeiro recebe nulo.

create or replace function public.bloqueios_do_job_para_o_interno(p_job_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_motivos text[] := array[]::text[];
begin
  select tenant_id into v_tenant from jobs where id = p_job_id;
  if v_tenant is null
     or not (public.is_tenant_admin(v_tenant) or public.is_tenant_financeiro(v_tenant)) then
    return null;
  end if;

  if exists (
    select 1 from jobs_itens_orcado
     where job_id = p_job_id
       and (em_save or coalesce(save_consumido, 0) > 0)
  ) then
    v_motivos := v_motivos || 'Há linha do job em save (gerando ou consumindo).';
  end if;

  if exists (
    select 1 from saves_aprovacoes
     where job_id = p_job_id and situacao = 'aguardando'
  ) then
    v_motivos := v_motivos || 'Há pedido de save aguardando o financeiro.';
  end if;

  if exists (
    select 1
      from itens_bv b
      join jobs_itens_orcado i on i.id = b.job_item_orcado_id
     where i.job_id = p_job_id
       and b.situacao in ('confirmado', 'recebido')
  ) then
    v_motivos := v_motivos || 'Há BV confirmado ou recebido.';
  end if;

  if exists (
    select 1 from jobs_envio_faturamento where job_id = p_job_id
  ) then
    v_motivos := v_motivos || 'O job já foi enviado para faturamento.';
  end if;

  if exists (
    select 1
      from faturamento_itens fi
      join faturamentos f on f.id = fi.faturamento_id
     where fi.origem_tipo in ('job', 'save')
       and fi.origem_id = p_job_id
       and f.status <> 'cancelado'
  ) then
    v_motivos := v_motivos || 'Já há nota emitida para o job.';
  end if;

  if exists (
    select 1 from recebimentos_antes_nf
     where job_id = p_job_id and status <> 'cancelado'
  ) then
    v_motivos := v_motivos || 'Já há recebimento registrado para o job.';
  end if;

  return v_motivos;
end;
$$;

comment on function public.bloqueios_do_job_para_o_interno(uuid) is
  'Decisão 240: os motivos que impedem o job de entrar no serviço Interno pelo "Editar registro" (save, BV confirmado ou recebido, envio para faturamento, nota, recebimento). Vazio quando nada impede; nulo para quem não é administrador ou financeiro.';

revoke all on function public.bloqueios_do_job_para_o_interno(uuid) from public, anon;
grant execute on function public.bloqueios_do_job_para_o_interno(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. A troca
-- ---------------------------------------------------------------------

create or replace function public.trocar_job_de_lado_do_interno(
  p_job_id uuid,
  p_servico_id uuid,
  p_totais jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  j record;
  v_orc record;
  v_servico record;
  v_entra boolean;
  v_motivos text[];
  v_linhas int := 0;
  v_tipos jsonb;
  v_bv record;
  v_bv_cancelados int := 0;
  v_valor numeric;
  v_fat numeric;
  v_fat_save numeric;
begin
  select id, tenant_id, status::text as status, orcamento_id, servico_id, codigo
    into j
    from jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception 'Job não encontrado.';
  end if;
  if not (public.is_tenant_admin(j.tenant_id) or public.is_tenant_financeiro(j.tenant_id)) then
    raise exception 'Só o administrador ou o financeiro troca o serviço do job.'
      using errcode = '42501';
  end if;
  if j.status not in ('aberto', 'em_producao') then
    raise exception 'Só job aberto tem o serviço trocado pelo registro.';
  end if;

  select id, servico_id into v_orc from orcamentos where id = j.orcamento_id for update;
  if not found then
    raise exception 'O orçamento do job não foi encontrado.';
  end if;

  select id, nome, escopo::text as escopo, ativo, investimento_interno
    into v_servico
    from categorias_dominio
   where id = p_servico_id and tenant_id = j.tenant_id;
  if not found or v_servico.escopo <> 'projeto' then
    raise exception 'Serviço de job inválido.';
  end if;
  if not v_servico.ativo then
    raise exception 'Este serviço foi inativado. Escolha outro.';
  end if;

  v_entra := coalesce(v_servico.investimento_interno, false);
  if v_entra = public.servico_de_investimento_interno(v_orc.servico_id) then
    raise exception 'Este serviço não põe nem tira o job do Interno.';
  end if;

  if p_totais is null
     or p_totais->>'valor_total' is null
     or p_totais->>'faturamento_previsto' is null then
    raise exception 'Totais do job ausentes na troca do serviço.';
  end if;
  v_valor := (p_totais->>'valor_total')::numeric;
  v_fat := (p_totais->>'faturamento_previsto')::numeric;
  v_fat_save := coalesce((p_totais->>'faturamento_save_previsto')::numeric, 0);
  if v_valor < 0 or v_fat < 0 or v_fat_save < 0 then
    raise exception 'Totais do job inválidos na troca do serviço.';
  end if;
  if v_entra and v_fat > 0.004 then
    raise exception 'O job Interno não tem faturamento previsto.';
  end if;

  -- Os tipos de antes, para a auditoria.
  select coalesce(jsonb_object_agg(tipo_custo, n), '{}'::jsonb)
    into v_tipos
    from (select tipo_custo::text as tipo_custo, count(*) as n
            from jobs_itens_orcado where job_id = p_job_id
           group by 1) t;

  if v_entra then
    v_motivos := public.bloqueios_do_job_para_o_interno(p_job_id);
    if coalesce(array_length(v_motivos, 1), 0) > 0 then
      raise exception 'Este job não pode passar para o serviço Interno. %', array_to_string(v_motivos, ' ')
        using errcode = 'check_violation';
    end if;

    -- BV em negociação das linhas do job: cancelado, com a mesma
    -- auditoria da troca de tipo de uma linha. Os das versões o gatilho
    -- do orçamento cancela.
    for v_bv in
      update itens_bv b
         set situacao = 'cancelado'
        from jobs_itens_orcado i
       where b.job_item_orcado_id = i.id
         and i.job_id = p_job_id
         and b.situacao = 'a_negociar'
      returning b.id, b.tenant_id, b.valor, b.job_item_orcado_id, i.item
    loop
      v_bv_cancelados := v_bv_cancelados + 1;
      perform public.log_audit_event(
        'item_bv.cancelado', v_bv.tenant_id, 'item_bv', v_bv.id::text,
        jsonb_build_object(
          'job_item_orcado_id', v_bv.job_item_orcado_id,
          'item', v_bv.item,
          'valor', v_bv.valor,
          'motivo', 'job_virou_interno'
        )
      );
    end loop;

    -- O orçamento primeiro: `orcamento_entra_no_interno` converte todas as
    -- versões, e daí em diante `planejado_espelha_orcado` enxerga o
    -- Interno também nas linhas do job.
    update orcamentos set servico_id = p_servico_id where id = v_orc.id;
    update jobs set servico_id = p_servico_id where id = p_job_id;
    update jobs_itens_orcado set tipo_custo = 'FI' where job_id = p_job_id;
    get diagnostics v_linhas = row_count;
  else
    -- Sair: o orçamento deixa o Interno (o gatilho de coerência recusa
    -- uma categoria que o serviço novo não aceita) e o FI vira B.
    update orcamentos set servico_id = p_servico_id where id = v_orc.id;
    update versoes_orcamento_itens i
       set tipo_custo = 'B'
      from versoes_orcamento v
     where v.id = i.versao_orcamento_id
       and v.orcamento_id = v_orc.id
       and i.tipo_custo = 'FI';
    update jobs set servico_id = p_servico_id where id = p_job_id;
    update jobs_itens_orcado set tipo_custo = 'B' where job_id = p_job_id and tipo_custo = 'FI';
    get diagnostics v_linhas = row_count;
  end if;

  update jobs
     set valor_total = v_valor,
         faturamento_previsto = v_fat,
         faturamento_save_previsto = v_fat_save,
         -- O Interno não tem recebimento (decisão 105).
         data_prevista_faturamento = case when v_entra then null else data_prevista_faturamento end
   where id = p_job_id;

  perform public.log_audit_event(
    'job.servico_interno_trocado', j.tenant_id, 'job', p_job_id::text,
    jsonb_build_object(
      'sentido', case when v_entra then 'entrou' else 'saiu' end,
      'codigo', j.codigo,
      'orcamento_id', v_orc.id,
      'servico_de', j.servico_id,
      'servico_orcamento_de', v_orc.servico_id,
      'servico_para', p_servico_id,
      'tipos_antes', v_tipos,
      'linhas_convertidas', v_linhas,
      'bv_cancelados', v_bv_cancelados,
      'totais', p_totais
    )
  );

  return jsonb_build_object('linhas', v_linhas, 'bv_cancelados', v_bv_cancelados);
end;
$$;

comment on function public.trocar_job_de_lado_do_interno(uuid, uuid, jsonb) is
  'Decisão 240: põe o job (e o orçamento dele) no serviço Interno, ou tira, numa transação. Entrar converte todas as linhas em FI com o planejado igual ao orçado; sair converte o FI em B. Os espelhos do job chegam calculados pela action.';

revoke all on function public.trocar_job_de_lado_do_interno(uuid, uuid, jsonb) from public, anon;
grant execute on function public.trocar_job_de_lado_do_interno(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 3. O gatilho do job: a mesma trava, a mensagem nova
-- ---------------------------------------------------------------------
-- A regra continua: job e orçamento ficam do mesmo lado do Interno. O que
-- muda é o caminho — a troca dos dois juntos, pela função acima.

create or replace function public.job_servico_e_categoria_seguem_a_planilha()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_orc_servico uuid;
  v_orc_categoria uuid;
  v_modelo_job text;
  v_modelo_orc text;
begin
  select servico_id, categoria_id
    into v_orc_servico, v_orc_categoria
    from orcamentos
   where id = new.orcamento_id;

  if new.servico_id is not null
     and (tg_op = 'INSERT' or new.servico_id is distinct from old.servico_id)
     and public.servico_de_investimento_interno(new.servico_id)
         <> public.servico_de_investimento_interno(v_orc_servico) then
    raise exception 'O job e o orçamento ficam do mesmo lado do Interno. Para pôr o job no Interno, ou tirar dele, troque o serviço pelo "Editar registro", que troca os dois juntos.'
      using errcode = 'check_violation';
  end if;

  if new.categoria_id is not null
     and v_orc_categoria is not null
     and (tg_op = 'INSERT' or new.categoria_id is distinct from old.categoria_id) then
    select modelo_planilha::text into v_modelo_job from categorias_dominio where id = new.categoria_id;
    select modelo_planilha::text into v_modelo_orc from categorias_dominio where id = v_orc_categoria;
    if v_modelo_job is distinct from v_modelo_orc then
      raise exception 'A categoria decide o modelo da planilha do job (nacional, internacional ou mensal) e só pode ser trocada por outra do mesmo modelo.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;
