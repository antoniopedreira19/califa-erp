-- Decisão 262, parte 2 (D10): o fechamento da conciliação é do mês e reabre mês a mês.
--
-- Hoje (decisão 205) o fechamento é uma data ("fechada até dd/mm"), e o
-- reabrir solta tudo: a conta fica toda aberta. Com o fechamento por mês, a
-- tela fecha sempre no último dia do mês ("Fechar outubro" é o
-- `fechar_conciliacao` até 31/10, com as mesmas três condições), e
-- "Reabrir outubro" reabre só outubro: se o mês anterior já tinha sido
-- fechado alguma vez, ele continua fechado (um registro novo, ativo, até o
-- fim dele); se nunca foi, a conta fica toda aberta, como hoje.
--
-- Aditiva:
-- - coluna `reabertura_de` em `conciliacao_fechamentos`: o registro que
--   nasce do "Reabrir" do mês seguinte aponta para o registro reaberto. A
--   tela não lê esse registro como um fechamento novo feito por alguém (no
--   histórico, o mês continuou fechado);
-- - função `reabrir_mes_da_conciliacao(conta, motivo)`, com as mesmas
--   travas e a mesma auditoria de `reabrir_conciliacao` (que fica, sem uso
--   na tela).
-- `fechar_conciliacao` e a trava dos lançamentos (`_exige_periodo_aberto`)
-- não mudam: continuam lendo o registro ativo.

alter table public.conciliacao_fechamentos
  add column if not exists reabertura_de uuid references public.conciliacao_fechamentos(id) on delete set null;

comment on column public.conciliacao_fechamentos.reabertura_de is
  'Decisão 262: o registro que nasceu do "Reabrir" do mês seguinte (o mês anterior continuou fechado) aponta para o registro reaberto.';

create index if not exists idx_conciliacao_fechamentos_reabertura_de
  on public.conciliacao_fechamentos (reabertura_de) where reabertura_de is not null;

create or replace function public.reabrir_mes_da_conciliacao(p_conta_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid;
  v_conta   contas_bancarias%rowtype;
  v_ativo   conciliacao_fechamentos%rowtype;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_antes   date;
  v_novo    uuid;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  v_uid := public._exige_financeiro_conciliacao(v_conta.tenant_id);
  if length(v_motivo) < 10 then
    raise exception 'Explique o motivo (pelo menos 10 caracteres).';
  end if;
  if length(v_motivo) > 1000 then
    raise exception 'O motivo passa de 1.000 caracteres: resuma.';
  end if;

  select * into v_ativo from public.conciliacao_fechamentos
   where conta_bancaria_id = p_conta_id and ativo
   for update;
  if not found then
    raise exception 'A conciliação desta conta não está fechada.';
  end if;

  -- O fim do mês anterior ao do fechamento ativo.
  v_antes := (date_trunc('month', v_ativo.ate) - interval '1 day')::date;

  update public.conciliacao_fechamentos
     set ativo = false, reaberto_em = now(), reaberto_por = v_uid, motivo_reabertura = v_motivo
   where id = v_ativo.id;

  -- O mês anterior continua fechado se já tinha sido fechado alguma vez.
  if exists (
    select 1 from public.conciliacao_fechamentos
     where conta_bancaria_id = p_conta_id and id <> v_ativo.id and ate <= v_antes
  ) then
    insert into public.conciliacao_fechamentos (tenant_id, conta_bancaria_id, ate, fechado_por, reabertura_de)
    values (v_conta.tenant_id, p_conta_id, v_antes, v_uid, v_ativo.id)
    returning id into v_novo;
  end if;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_conta.tenant_id, 'conciliacao_fechamento', v_ativo.id::text, 'conciliacao.reaberta', v_uid,
          jsonb_build_object('conta_bancaria_id', p_conta_id, 'ate', v_ativo.ate, 'motivo', v_motivo,
                             'mes_a_mes', true,
                             'continua_fechada_ate', case when v_novo is not null then v_antes end,
                             'fechamento_mantido_id', v_novo));

  return jsonb_build_object('continua_fechada_ate', case when v_novo is not null then v_antes end);
end;
$$;

revoke all on function public.reabrir_mes_da_conciliacao(uuid, text) from public, anon;
grant execute on function public.reabrir_mes_da_conciliacao(uuid, text) to authenticated;
