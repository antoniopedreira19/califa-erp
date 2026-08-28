-- =====================================================================
-- A fatura fechada volta a abrir, e a paga volta a fechada
--
-- Faltava o caminho de volta. Fechar era porta de mão única: se o valor
-- não batesse com o banco, ou se aparecesse uma compra retroativa depois
-- do fechamento, não havia o que fazer — a compra ia para a competência
-- seguinte e a fatura ficava errada para sempre.
--
-- Agora a escada tem os dois sentidos:
--
--     aberta  ⇄  fechada  ⇄  paga
--             reabrir     estornar
--
-- ── A diferença entre reabrir e estornar ────────────────────────────
--
-- REABRIR desfaz o FECHAMENTO. Os lançamentos do fechamento são
-- derivados: eles nascem inteiros, deterministicamente, a partir dos
-- itens da fatura. Nenhum deles corresponde a dinheiro que saiu do
-- banco — a fatura ainda não foi paga. Então reabrir os APAGA, e o
-- fechamento seguinte os recria. Contra-lançar aqui encheria o razão do
-- cartão de pares +150/−150 a cada correção, sem nenhum ganho.
--
-- ESTORNAR desfaz o PAGAMENTO, e aí o dinheiro saiu de verdade. Esse não
-- se apaga: ganha contra-lançamento, como toda baixa estornada no
-- sistema, porque o extrato do banco também vai mostrar as duas pernas.
--
-- Fatura paga não reabre direto: primeiro estorna o pagamento, depois
-- reabre. A RPC recusa e diz isso.
--
-- ── papel_na_fatura ─────────────────────────────────────────────────
--
-- Reabrir precisa apagar exatamente os lançamentos do fechamento, sem
-- encostar nos do pagamento. Dava para deduzir por conta + origem +
-- forma de pagamento, mas seria uma dedução frágil, que quebraria em
-- silêncio no dia em que alguém mudasse um desses três. A coluna diz o
-- papel de cada lançamento na fatura, e acabou a adivinhação.
-- =====================================================================

alter table public.lancamentos_financeiros
  add column if not exists papel_na_fatura text;

alter table public.lancamentos_financeiros
  drop constraint if exists chk_papel_na_fatura;
alter table public.lancamentos_financeiros
  add constraint chk_papel_na_fatura check (
    papel_na_fatura is null
    or papel_na_fatura in ('item', 'ajuste', 'pagamento', 'pagamento_estorno')
  );

comment on column public.lancamentos_financeiros.papel_na_fatura is
  'O que este lançamento é dentro da fatura do cartão: item, ajuste do fechamento, pagamento, ou estorno do pagamento. Null fora do cartão.';

create index if not exists idx_lancamentos_papel_na_fatura
  on public.lancamentos_financeiros (fatura_cartao_id, papel_na_fatura)
  where fatura_cartao_id is not null;

-- Backfill do que já existe. Item tem conta avulsa apontada; ajuste é o
-- que sobra na conta espelho; pagamento é o par que envolve a conta
-- bancária de verdade.
update public.lancamentos_financeiros l
   set papel_na_fatura = case
         when l.conta_avulsa_id is not null then 'item'
         when l.forma_pagamento = 'cartao_credito' then 'ajuste'
         else 'pagamento'
       end
 where l.fatura_cartao_id is not null
   and l.papel_na_fatura is null;

-- ---------------------------------------------------------------------
-- Fechamento e pagamento passam a carimbar o papel
-- ---------------------------------------------------------------------
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

create or replace function public.dar_baixa_fatura_cartao(
  p_fatura_id uuid,
  p_pago_em date,
  p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid,
  p_plano_conta_subtipo_id uuid
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller_uid   uuid;
  v_fatura       faturas_cartao%rowtype;
  v_cartao       cartoes_credito%rowtype;
  v_conta_banco  contas_bancarias%rowtype;
  v_conta_cartao contas_bancarias%rowtype;
  v_subtipo_tipo uuid;
  v_lanc_banco   uuid;
  v_lanc_cartao  uuid;
  v_descricao    text;
begin
  v_caller_uid := auth.uid();
  if v_caller_uid is null then raise exception 'Sessão inválida.'; end if;

  select * into v_fatura from faturas_cartao where id = p_fatura_id;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  if not is_tenant_member(v_fatura.tenant_id) then
    raise exception 'Sem permissão nesta fatura.';
  end if;

  if v_fatura.status = 'paga' then
    raise exception 'Esta fatura já foi paga.';
  end if;
  if v_fatura.status <> 'fechada' then
    raise exception 'Só fatura fechada pode ser paga — a aberta ainda recebe compra (status atual: %).', v_fatura.status;
  end if;
  if v_fatura.valor_cobrado is null then
    raise exception 'Fatura sem valor cobrado. Feche-a informando o valor do banco.';
  end if;
  if v_fatura.valor_cobrado <= 0 then
    raise exception
      'A fatura % fechou em % — os estornos cobriram as compras e não há o que pagar. O crédito fica no cartão e abate a próxima fatura.',
      v_fatura.codigo,
      to_char(v_fatura.valor_cobrado, 'FM999999999990.00');
  end if;

  select * into v_cartao from cartoes_credito where id = v_fatura.cartao_credito_id;

  select * into v_conta_cartao from contas_bancarias
   where cartao_credito_id = v_fatura.cartao_credito_id;
  if not found then
    raise exception 'Cartão sem conta espelho. Avise o suporte.';
  end if;

  select * into v_conta_banco from contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;

  if v_conta_banco.cartao_credito_id is not null then
    raise exception 'Fatura de cartão não se paga com outro cartão.';
  end if;
  if v_conta_banco.tenant_id <> v_fatura.tenant_id then
    raise exception 'Conta bancária de outro tenant.';
  end if;
  if not v_conta_banco.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_pago_em < v_conta_banco.saldo_inicial_data then
    raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
  end if;

  select tipo_id into v_subtipo_tipo
    from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_descricao := 'Fatura ' || v_fatura.codigo || ' · ' || v_cartao.nome;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
    origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_banco.empresa_id, p_conta_bancaria_id,
    p_pago_em, v_fatura.valor_cobrado, 'saida', v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'pagamento',
    'manual', v_caller_uid
  )
  returning id into v_lanc_banco;

  insert into lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    forma_pagamento, cartao_credito_id, fatura_cartao_id, papel_na_fatura,
    origem, criado_por
  ) values (
    v_fatura.tenant_id, v_conta_cartao.empresa_id, v_conta_cartao.id,
    p_pago_em, v_fatura.valor_cobrado, 'entrada', 'Pagamento da ' || v_descricao,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    null, v_fatura.cartao_credito_id, p_fatura_id, 'pagamento',
    'manual', v_caller_uid
  )
  returning id into v_lanc_cartao;

  update faturas_cartao set status = 'paga' where id = p_fatura_id;

  return array[v_lanc_banco, v_lanc_cartao];
end;
$function$;

revoke execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) from public;
grant  execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) to authenticated;

revoke execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) from public;
grant  execute on function public.dar_baixa_fatura_cartao(uuid, date, uuid, uuid, uuid) to authenticated;
