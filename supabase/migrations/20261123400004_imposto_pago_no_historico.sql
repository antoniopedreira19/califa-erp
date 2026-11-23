-- Decisão 277 (entrega 3, 23/11/2026, pedido do Tiago, opção A): o imposto
-- pago no histórico.
--
-- Por quê: para fechar o 4º trimestre com tudo no sistema, as guias pagas
-- antes de o fiscal rodar inteiro (o ISS de 04/11 e 10/11, o PIS/COFINS de
-- 20/11, as guias da GoCrazy de 19/11) entram aprovadas — mas o pagamento já
-- está no histórico da planilha (`historico_movimentos`), e é por lá que o
-- DRE e o fluxo de caixa contam. Dar baixa criaria um lançamento e contaria a
-- saída duas vezes; ligar a baixa ao histórico (`ligar_baixa_ao_historico`)
-- não serve, porque as linhas do histórico já estão conciliadas com o banco
-- (ou, as de 20/11, esperam o extrato). Então a guia é marcada **paga no
-- histórico**: sai de A pagar, guarda a data e a conta, e nenhum lançamento é
-- criado. O DARF e o comprovante são opcionais neste caminho (combinado com o
-- Tiago em 23/11).
--
-- O que faz:
-- 1. `impostos_a_pagar.pago_no_historico` (só acrescenta).
-- 2. A regra `chk_imposto_pago_consistente` passa a aceitar o pago sem
--    comprovante quando é no histórico. Para as linhas que já existem (todas
--    com a marca falsa) a regra continua exatamente a mesma.
-- 3. `marcar_imposto_pago_no_historico(...)`: A pagar → pago, sem lançamento,
--    com a auditoria `fiscal.imposto_pago_no_historico`.
-- 4. `cancelar_baixa_imposto` desfaz também a marca (o pago no histórico não
--    tem lançamento a apagar: o laço não encontra nenhum). Fora isso, igual.

alter table public.impostos_a_pagar
  add column if not exists pago_no_historico boolean not null default false;

comment on column public.impostos_a_pagar.pago_no_historico is
  'Decisão 277: pago fora do sistema, com o pagamento no histórico da planilha. Sem lançamento (o DRE e o fluxo contam pelo histórico); guia e comprovante opcionais.';

alter table public.impostos_a_pagar drop constraint if exists chk_imposto_pago_consistente;
alter table public.impostos_a_pagar add constraint chk_imposto_pago_consistente check (
  (
    status = 'pago' and pago_em is not null and conta_bancaria_id is not null
    and (comprovante_path is not null or pago_no_historico)
  )
  or (
    status = 'a_pagar' and pago_em is null and conta_bancaria_id is null and baixado_em is null
    and not pago_no_historico
  )
  or (
    status = 'cancelado' and pago_em is null and conta_bancaria_id is null and baixado_em is null
    and cancelado_em is not null and length(btrim(coalesce(motivo_cancelamento, ''))) >= 10
    and not pago_no_historico
  )
);

create or replace function public.marcar_imposto_pago_no_historico(
  p_imposto_id        uuid,
  p_pago_em           date,
  p_conta_bancaria_id uuid,
  p_guia_path         text,
  p_comprovante_path  text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid;
  v_imp  public.impostos_a_pagar%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into v_imp from public.impostos_a_pagar where id = p_imposto_id for update;
  if not found then raise exception 'Imposto não encontrado.'; end if;
  v_uid := public._exige_financeiro_para_baixar(v_imp.tenant_id);

  if v_imp.status = 'cancelado' then raise exception 'Este imposto foi cancelado.'; end if;
  if v_imp.status <> 'a_pagar' then raise exception 'Este imposto já está pago.'; end if;
  if p_pago_em is null then raise exception 'Informe a data do pagamento.'; end if;
  if p_pago_em > v_hoje then
    raise exception 'A data do pagamento no histórico não pode ser depois de hoje.';
  end if;
  -- As mesmas travas de conta da baixa: do tenant, ativa, fora do cartão.
  perform public._conta_da_baixa(p_conta_bancaria_id, v_imp.tenant_id, p_pago_em, 'pagamento');

  update public.impostos_a_pagar
     set status = 'pago',
         pago_em = p_pago_em,
         conta_bancaria_id = p_conta_bancaria_id,
         multa_juros = 0,
         guia_path = coalesce(nullif(btrim(coalesce(p_guia_path, '')), ''), v_imp.guia_path),
         comprovante_path = nullif(btrim(coalesce(p_comprovante_path, '')), ''),
         pago_no_historico = true,
         baixado_por = v_uid,
         baixado_em = now()
   where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_imp.tenant_id, 'imposto_a_pagar', v_imp.id::text, 'fiscal.imposto_pago_no_historico', v_uid,
          jsonb_build_object('pago_em', p_pago_em, 'conta_bancaria_id', p_conta_bancaria_id,
                             'valor', v_imp.valor, 'tributo', v_imp.tributo,
                             'codigo_receita', v_imp.codigo_receita, 'competencia', v_imp.competencia));
  return v_imp.id;
end;
$$;

revoke all on function public.marcar_imposto_pago_no_historico(uuid, date, uuid, text, text) from public, anon;
grant execute on function public.marcar_imposto_pago_no_historico(uuid, date, uuid, text, text) to authenticated;

create or replace function public.cancelar_baixa_imposto(p_imposto_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid;
  v_imp       impostos_a_pagar%rowtype;
  v_l         record;
  v_apagados  jsonb := '[]'::jsonb;
begin
  select * into v_imp from public.impostos_a_pagar where id = p_imposto_id for update;
  if not found then raise exception 'Imposto não encontrado.'; end if;
  v_uid := public._exige_financeiro_para_baixar(v_imp.tenant_id);
  if v_imp.status <> 'pago' then
    raise exception 'Este imposto não tem baixa para cancelar.';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  -- O pago no histórico (decisão 277) não tem lançamento: o laço não acha nenhum.
  for v_l in
    select id, valor, empresa_id, regional_id, data_movimento
      from public.lancamentos_financeiros
     where imposto_a_pagar_id = v_imp.id and estorno_de_lancamento_id is null
     for update
  loop
    v_apagados := v_apagados || jsonb_build_object(
      'id', v_l.id, 'valor', v_l.valor, 'empresa_id', v_l.empresa_id,
      'regional_id', v_l.regional_id, 'data', v_l.data_movimento,
      'estornos', public._apagar_lancamento_de_baixa(v_l.id)
    );
  end loop;

  update public.impostos_a_pagar
     set status = 'a_pagar',
         pago_em = null,
         conta_bancaria_id = null,
         multa_juros = 0,
         comprovante_path = null,
         pago_no_historico = false,
         baixado_por = null,
         baixado_em = null
   where id = v_imp.id;

  insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
  values (v_imp.tenant_id, 'imposto_a_pagar', v_imp.id::text, 'fiscal.imposto_baixa_cancelada', v_uid,
          jsonb_build_object('motivo', btrim(p_motivo), 'pago_em', v_imp.pago_em,
                             'conta_bancaria_id', v_imp.conta_bancaria_id,
                             'multa_juros', v_imp.multa_juros, 'lancamentos_apagados', v_apagados,
                             'pago_no_historico', v_imp.pago_no_historico));
  return v_imp.id;
end;
$$;
