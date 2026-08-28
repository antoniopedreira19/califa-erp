-- =====================================================================
-- A fatura fecha (e reabre) com parcela de PP dentro
--
-- Até aqui `fechar_fatura_cartao` só enxergava conta avulsa. Com a PP
-- podendo ser paga no cartão, a fatura passa a ter duas fontes de item:
--
--   contas_avulsas          → compra avulsa, assinatura, estorno
--   pedidos_compra_parcelas → parcela de PP aprovada no cartão
--
-- Cada uma vira um lançamento próprio na conta do cartão, com o SEU plano
-- de contas — a granularidade do DRE continua intacta, que é a razão de o
-- cartão ser uma conta.
--
-- ── Onde o plano de contas da PP vem ────────────────────────────────
--
-- Da própria PP (`plano_conta_tipo_id` / `plano_conta_subtipo_id`),
-- escolhido pelo financeiro na aprovação. Na PP normal o plano é
-- escolhido na baixa; na PP no cartão não existe baixa individual, então
-- ele é escolhido antes. Ver `20260829140001`.
--
-- ── Reabrir devolve os dois lados ───────────────────────────────────
--
-- O delete dos lançamentos já cobre a PP (é `papel_na_fatura in
-- ('item','ajuste')`). Faltava desfazer o resto: a parcela volta a
-- `pago_em = null`, e a PP que tinha virado 'pago' volta para
-- 'aprovada'. Sem isso, reabrir deixaria a PP paga sem lançamento
-- nenhum — pior do que não reabrir.
-- =====================================================================

create or replace function public.fechar_fatura_cartao(
  p_fatura_id uuid,
  p_valor_cobrado numeric,
  p_ajuste_tipo_id uuid default null,
  p_ajuste_subtipo_id uuid default null,
  p_ajuste_descricao text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid  uuid;
  v_fatura      faturas_cartao%rowtype;
  v_conta       contas_bancarias%rowtype;
  v_item        record;
  v_pp          record;
  v_em_aberto   integer;
  v_soma        numeric := 0;
  v_diferenca   numeric;
  v_subtipo_tipo uuid;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status <> 'aberta' then
    raise exception 'Só fatura aberta pode ser fechada (status atual: %).', v_fatura.status;
  end if;

  if p_valor_cobrado is null then
    raise exception 'Informe o valor cobrado pelo banco nesta fatura.';
  end if;

  select * into v_conta from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  -- ---- Fonte 1: contas avulsas (compra, assinatura, estorno) --------
  for v_item in
    select a.*
      from contas_avulsas a
     where a.fatura_cartao_id = p_fatura_id
       and a.status = 'aprovada'
     order by a.data_prevista_pagamento, a.created_at
  loop
    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, cliente_id, job_id, conta_avulsa_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      origem, criado_por
    ) values (
      v_item.tenant_id, v_item.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, v_item.valor,
      v_item.natureza,
      case when v_item.estorno_de_avulsa_id is not null
           then 'Estorno · ' else 'Cartão · ' end
        || substring(v_item.descricao, 1, 180),
      v_item.plano_conta_tipo_id, v_item.plano_conta_subtipo_id,
      v_item.fornecedor_id, v_item.cliente_id, v_item.job_id, v_item.id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id, 'item',
      'avulsa_baixa', v_caller_uid
    );

    update contas_avulsas
       set status = 'baixada',
           pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid,
           conta_bancaria_baixa_id = v_conta.id
     where id = v_item.id;

    v_soma := v_soma
      + case when v_item.natureza = 'entrada' then -v_item.valor else v_item.valor end;
  end loop;

  -- ---- Fonte 2: parcelas de PP aprovadas no cartão ------------------
  for v_pp in
    select par.id      as parcela_id,
           par.numero  as parcela_numero,
           par.valor   as parcela_valor,
           pc.id       as pp_id,
           pc.codigo   as pp_codigo,
           pc.servico  as pp_servico,
           pc.tenant_id, pc.empresa_id, pc.fornecedor_id, pc.job_id,
           pc.plano_conta_tipo_id, pc.plano_conta_subtipo_id,
           (select count(*) from pedidos_compra_parcelas x
             where x.pedido_compra_id = pc.id) as total_parcelas
      from pedidos_compra_parcelas par
      join pedidos_compra pc on pc.id = par.pedido_compra_id
     where par.fatura_cartao_id = p_fatura_id
       and par.pago_em is null
     order by pc.codigo, par.numero
  loop
    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      origem, criado_por
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, v_pp.parcela_valor,
      'saida',
      'Cartão · PP ' || v_pp.pp_codigo || ' '
        || v_pp.parcela_numero || '/' || v_pp.total_parcelas
        || ' — ' || substring(v_pp.pp_servico, 1, 140),
      v_pp.plano_conta_tipo_id, v_pp.plano_conta_subtipo_id,
      v_pp.fornecedor_id, v_pp.job_id, v_pp.pp_id, v_pp.parcela_id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id, 'item',
      'pp_baixa', v_caller_uid
    );

    update pedidos_compra_parcelas
       set pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid
     where id = v_pp.parcela_id;

    -- A PP só vira 'pago' quando a última parcela dela sai — e as
    -- parcelas podem estar em faturas de meses diferentes.
    select count(*)::int into v_em_aberto
      from pedidos_compra_parcelas
     where pedido_compra_id = v_pp.pp_id and pago_em is null;

    if v_em_aberto = 0 then
      update pedidos_compra
         set status = 'pago',
             pago_em = v_fatura.competencia_fechamento,
             pago_por = v_caller_uid
       where id = v_pp.pp_id;
    end if;

    v_soma := v_soma + v_pp.parcela_valor;
  end loop;

  v_diferenca := p_valor_cobrado - v_soma;

  if abs(v_diferenca) > 0.005 then
    if p_ajuste_tipo_id is null or p_ajuste_subtipo_id is null then
      raise exception
        'A fatura fecha em % e o banco cobrou % — diferença de %. Informe o plano de contas do ajuste (IOF, anuidade, juros) ou lance o que está faltando antes de fechar.',
        to_char(v_soma, 'FM999999999990.00'),
        to_char(p_valor_cobrado, 'FM999999999990.00'),
        to_char(v_diferenca, 'FM999999999990.00');
    end if;

    select tipo_id into v_subtipo_tipo
      from plano_contas_subtipos where id = p_ajuste_subtipo_id;
    if not found then raise exception 'Subtipo do ajuste não encontrado.'; end if;
    if v_subtipo_tipo <> p_ajuste_tipo_id then
      raise exception 'Subtipo do ajuste não pertence ao tipo escolhido.';
    end if;

    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
      origem, criado_por
    ) values (
      v_fatura.tenant_id, v_conta.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, abs(v_diferenca),
      (case when v_diferenca > 0 then 'saida' else 'entrada' end)::natureza_lancamento,
      coalesce(nullif(btrim(p_ajuste_descricao), ''), 'Ajuste da fatura ' || v_fatura.codigo),
      p_ajuste_tipo_id, p_ajuste_subtipo_id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id, 'ajuste',
      'manual', v_caller_uid
    );
  end if;

  update faturas_cartao
     set status = 'fechada', valor_cobrado = p_valor_cobrado,
         fechada_em = now(), fechada_por = v_caller_uid
   where id = p_fatura_id;

  return p_fatura_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- Reabrir devolve a parcela de PP também
-- ---------------------------------------------------------------------
create or replace function public.reabrir_fatura_cartao(
  p_fatura_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid uuid;
  v_fatura     faturas_cartao%rowtype;
  v_apagados   integer;
  v_voltaram   integer;
  v_pps        integer;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  if p_motivo is null or length(btrim(p_motivo)) < 3 then
    raise exception 'Diga por que a fatura está sendo reaberta.';
  end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status = 'aberta' then
    raise exception 'A fatura % já está aberta.', v_fatura.codigo;
  end if;
  if v_fatura.status = 'paga' then
    raise exception
      'A fatura % já foi paga. Estorne a baixa dela primeiro — reabrir sem isso deixaria o extrato do banco com um pagamento sem fatura.',
      v_fatura.codigo;
  end if;

  delete from lancamentos_financeiros
   where fatura_cartao_id = p_fatura_id
     and papel_na_fatura in ('item', 'ajuste');
  get diagnostics v_apagados = row_count;

  update contas_avulsas
     set status = 'aprovada',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null
   where fatura_cartao_id = p_fatura_id
     and status = 'baixada';
  get diagnostics v_voltaram = row_count;

  -- A PP volta junto. O status dela vem ANTES de reabrir as parcelas:
  -- ele é decidido olhando quais parcelas pertencem a esta fatura, e
  -- depois do update abaixo essa informação continuaria lá — mas a
  -- ordem deixa a intenção explícita e não depende disso.
  update pedidos_compra pc
     set status = 'aprovada', pago_em = null, pago_por = null
   where pc.status = 'pago'
     and exists (
       select 1 from pedidos_compra_parcelas par
        where par.pedido_compra_id = pc.id
          and par.fatura_cartao_id = p_fatura_id
     );

  update pedidos_compra_parcelas
     set pago_em = null, pago_por = null
   where fatura_cartao_id = p_fatura_id
     and pago_em is not null;
  get diagnostics v_pps = row_count;

  update faturas_cartao
     set status = 'aberta',
         valor_cobrado = null,
         fechada_em = null,
         fechada_por = null
   where id = p_fatura_id;

  insert into audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_fatura.tenant_id, 'fatura_cartao', p_fatura_id::text,
    'fatura_cartao.reaberta', v_caller_uid,
    jsonb_build_object(
      'codigo', v_fatura.codigo,
      'motivo', btrim(p_motivo),
      'valor_cobrado_anterior', v_fatura.valor_cobrado,
      'lancamentos_apagados', v_apagados,
      'itens_reabertos', v_voltaram,
      'parcelas_pp_reabertas', v_pps
    )
  );

  return p_fatura_id;
end;
$function$;

revoke execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) from public;
grant  execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) to authenticated;

revoke execute on function public.reabrir_fatura_cartao(uuid, text) from public;
grant  execute on function public.reabrir_fatura_cartao(uuid, text) to authenticated;
