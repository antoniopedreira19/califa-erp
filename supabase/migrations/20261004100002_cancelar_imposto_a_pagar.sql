-- =====================================================================
-- Cancelar um imposto a pagar ainda não pago, à mão, com motivo
-- (decisão 145, item 6 — Tiago, 04/10/2026: "Precisamos adicionar isso,
-- mas deve ser registrado manualmente, e não por trás dos panos apenas como
-- uma regra")
-- =====================================================================
--
-- Quando as notas de uma guia já aprovada são canceladas, o imposto dela
-- deixa de ser devido, mas o título continuava em Impostos a Pagar, sem
-- jeito de sair (`corrigir_imposto` não aceita zero). Agora o financeiro
-- cancela o título em aberto, com motivo; o que já foi pago não se cancela
-- (fica a recuperar, com a contabilidade).
--
-- Aditiva: três colunas anuláveis, o status 'cancelado' nas duas travas de
-- status (os valores de hoje continuam valendo), um índice e uma função.
-- Nenhum dado muda.
-- =====================================================================

alter table public.impostos_a_pagar
  add column if not exists cancelado_em timestamptz,
  add column if not exists cancelado_por uuid references public.profiles(id),
  add column if not exists motivo_cancelamento text;

comment on column public.impostos_a_pagar.cancelado_em is
  'Quando o título em aberto foi cancelado à mão (decisão 145). Nulo fora do status cancelado.';
comment on column public.impostos_a_pagar.cancelado_por is 'Quem cancelou o título (decisão 145).';
comment on column public.impostos_a_pagar.motivo_cancelamento is
  'Por que o título foi cancelado, com pelo menos 10 caracteres (decisão 145).';

create index if not exists idx_impostos_a_pagar_cancelado_por
  on public.impostos_a_pagar (cancelado_por);

alter table public.impostos_a_pagar drop constraint if exists impostos_a_pagar_status_check;
alter table public.impostos_a_pagar
  add constraint impostos_a_pagar_status_check
  check (status in ('a_pagar', 'pago', 'cancelado'));

alter table public.impostos_a_pagar drop constraint if exists chk_imposto_pago_consistente;
alter table public.impostos_a_pagar
  add constraint chk_imposto_pago_consistente check (
    (status = 'pago' and pago_em is not null and conta_bancaria_id is not null and comprovante_path is not null)
    or (status = 'a_pagar' and pago_em is null and conta_bancaria_id is null and baixado_em is null)
    or (status = 'cancelado' and pago_em is null and conta_bancaria_id is null and baixado_em is null
        and cancelado_em is not null and length(btrim(coalesce(motivo_cancelamento, ''))) >= 10)
  );

-- Cancela um imposto em aberto, com motivo; auditado.
create or replace function public.cancelar_imposto_a_pagar(
  p_imposto_id  uuid,
  p_motivo      text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_imp impostos_a_pagar%rowtype;
begin
  select * into v_imp from public.impostos_a_pagar where id = p_imposto_id for update;
  if not found then raise exception 'Imposto não encontrado.'; end if;
  v_uid := public._exige_financeiro_fiscal(v_imp.tenant_id);
  if v_imp.status = 'cancelado' then
    raise exception 'Este imposto já está cancelado.';
  end if;
  if v_imp.status <> 'a_pagar' then
    raise exception 'Imposto pago não se cancela: o que já foi pago fica a recuperar, com a contabilidade.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explique o cancelamento em pelo menos 10 caracteres.';
  end if;

  update public.impostos_a_pagar
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = v_uid,
         motivo_cancelamento = btrim(p_motivo),
         updated_at = now()
   where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_imp.tenant_id, 'imposto_a_pagar', v_imp.id::text, 'fiscal.imposto_cancelado', v_uid,
          jsonb_build_object('tributo', v_imp.tributo, 'competencia', v_imp.competencia, 'origem', v_imp.origem,
                             'valor', v_imp.valor, 'motivo', btrim(p_motivo)));
  return v_imp.id;
end;
$$;

revoke all on function public.cancelar_imposto_a_pagar(uuid, text) from public, anon;
grant execute on function public.cancelar_imposto_a_pagar(uuid, text) to authenticated;

comment on function public.cancelar_imposto_a_pagar(uuid, text) is
  'Cancela, à mão e com motivo, um imposto a pagar ainda em aberto (decisão 145, item 6). Pago não se cancela.';
