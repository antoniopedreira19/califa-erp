-- =============================================================================
-- Decisão 099 — revisão adversarial das correções da 20260922140008 (23/09/2026)
-- =============================================================================
--
-- Três pontos que a revisão antes do merge confirmou, todos aditivos:
--
-- 1. AUTOR QUE NÃO EXISTE MAIS. A 140008 passou o autor do pedido nascido na
--    abertura/reenvio para `save_marcado_por` (ou quem gravou o consumo, ou
--    quem enviou o job). `save_marcado_por` não tem FK, de propósito; já
--    `saves_aprovacoes.enviado_por` tem FK para `profiles`. Um autor apagado
--    fazia o INSERT falhar e o job abria sem os pedidos de save. Agora cada
--    candidato só vale se o perfil existe; senão cai para o próximo, e por
--    fim para quem registra a abertura (a regra de antes da 140008).
--
-- 2. CACHE `save_consumido` NO INSERT. A trava da 140008 cobria só o UPDATE.
--    Uma linha NOVA em job aberto nascendo com `save_consumido > 0` (sem
--    consumo em `saves_consumos`) baixava o faturamento sem aprovação e
--    travava o envio para faturamento para sempre. O INSERT passa a ser
--    recusado nas mesmas condições (só com a 140003 ligada).
--
-- 3. CORRIDA COM O ENVIO DO MÊS. O TypeScript lê quais meses já foram
--    enviados e manda a parte de save de cada um (`saves_por_mes`). Se um
--    mês for enviado entre essa leitura e a RPC, ele ficaria de fora e o
--    `valor_save` do envio dele desatualizado. `save_gravar_totais` agora
--    trava a linha do job (o `update` já faz isso) e recusa quando existe
--    envio com mês que não veio na lista — a tela pede para tentar de novo,
--    e a nova leitura inclui o mês.
--
-- Nenhum dado muda nesta migration.
-- =============================================================================

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
      case when p_momento in ('abertura', 'reenvio') then
        coalesce(
          (select p.id from public.profiles p
            where r.em_save and p.id = r.save_marcado_por),
          (select p.id
             from public.saves_consumos c
             join public.profiles p on p.id = c.created_by
            where c.job_item_orcado_id = r.id and not r.em_save
            order by c.created_at desc
            limit 1),
          (select p.id from public.profiles p where p.id = v_job.created_by),
          (select auth.uid()))
      else (select auth.uid()) end
    );
    v_qtd := v_qtd + 1;
  end loop;

  return v_qtd;
end;
$$;

create or replace function public.save_consumido_trava()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_status public.job_status;
  v_mudou  boolean;
begin
  if tg_op = 'INSERT' then
    v_mudou := coalesce(new.save_consumido, 0) <> 0;
  else
    v_mudou := new.save_consumido is distinct from old.save_consumido;
  end if;

  if v_mudou
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
  before insert or update of save_consumido on public.jobs_itens_orcado
  for each row execute function public.save_consumido_trava();

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
  if p_totais ? 'saves_por_mes' and jsonb_typeof(p_totais->'saves_por_mes') <> 'array' then
    raise exception 'Parte de save por mês inválida na mudança de save.';
  end if;

  update public.jobs
     set valor_total = (p_totais->>'valor_total')::numeric,
         faturamento_previsto = (p_totais->>'faturamento_previsto')::numeric,
         faturamento_save_previsto = (p_totais->>'faturamento_save_previsto')::numeric
   where id = p_job_id;

  if exists (
       select 1
         from public.jobs_envio_faturamento e
        where e.job_id = p_job_id
          and e.mes is not null
          and not exists (
                select 1
                  from jsonb_array_elements(coalesce(p_totais->'saves_por_mes', '[]'::jsonb)) x
                 where (x->>'mes')::date = e.mes)) then
    raise exception 'Um mês deste job acabou de ser enviado para faturamento. Tente de novo.';
  end if;

  if p_totais ? 'saves_por_mes' then
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
