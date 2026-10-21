-- =============================================================================
-- Juros e multa na baixa, e a fatura escolhida na baixa no cartão
-- (task 029, fase 2: M2.1 e M2.2; decisões 196 e 197)
-- =============================================================================
-- M2.1 — juros e multa na baixa de PP e de avulsa (Tiago, 21/10/2026):
-- • `baixar_parcela_pp` e `baixar_conta_avulsa` ganham `p_juros` (no fim,
--   padrão 0). Com juros, a baixa grava UM lançamento a mais, de saída, na
--   mesma conta, data e forma, em 11 · Despesa com Juros · 999 (o mesmo plano
--   da multa e dos juros do imposto, `baixar_imposto`), com a origem
--   `juros_baixa` (migration 20261021600001).
-- • O lançamento dos juros guarda as chaves do documento (a PP e a parcela,
--   ou a avulsa) e se liga à baixa por `juros_de_lancamento_id`. Toda soma do
--   que foi baixado filtra pela origem `pp_baixa`/`avulsa_baixa`, então os
--   juros nunca quitam o documento; o rateio de regional vem do documento,
--   como o da baixa (`vw_fluxo_caixa`, `lancamento_rateio`).
-- • Cancelar a baixa apaga os juros junto (FK em cascata: o cancelamento
--   apaga o lançamento da baixa em `_apagar_lancamento_de_baixa`). O estorno
--   do valor (`estornar_valor_da_baixa`) não aceita a origem `juros_baixa` e
--   só devolve o que a baixa movimentou: os juros ficam.
-- • As duas travas de origem de `lancamentos_financeiros` ganham o ramo de
--   `juros_baixa`, recriadas a partir da definição atual lida do próprio
--   banco (como fez a migration do fiscal com `imposto_baixa`): nenhuma regra
--   existente muda (confirmação do Tiago, 21/10/2026).
--
-- M2.2 — a fatura escolhida na baixa no cartão (Tiago, 21/10/2026):
-- • `baixar_parcela_pp`, `baixar_conta_avulsa` e `dar_baixa_desembolso_parcela`
--   ganham `p_fatura_competencia` (no fim, padrão nulo): a competência da
--   fatura em que o item entra. Aberta, entra nela; ainda sem fatura, o banco
--   cria (da competência da data do pagamento até 12 meses depois); fechada
--   ou paga, recusa — reabra-a na aba Cartão. Sem ela, como antes: a fatura
--   da data do pagamento.
-- • Por competência, e não pelo id da fatura: a "Nova fatura" ainda não tem
--   id, e criá-la antes da baixa, numa chamada à parte, deixaria uma fatura
--   vazia aberta se a baixa falhasse. Aqui é uma transação só; no lote, a
--   primeira baixa cria a fatura e as outras entram nela.
-- • `cartao_lancar_item` já recebia `p_fatura_id` e confere o cartão e o
--   status: não muda.
--
-- M2.4, a parte desta migration: `dar_baixa_desembolso_parcela` é recriada
-- aqui (assinatura nova), já com a trava de admin ou financeiro
-- (`_exige_financeiro_para_baixar`) no lugar do `is_tenant_member`. O autor da
-- baixa passa a ser quem está logado (`auth.uid()`), como nas outras baixas;
-- `p_criado_por` fica na assinatura só para as chamadas de hoje.
--
-- Mudança de assinatura troca a função (drop e create): o GRANT para
-- `authenticated` é refeito; nada para `anon`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A ligação dos juros com a baixa
-- -----------------------------------------------------------------------------
alter table public.lancamentos_financeiros
  add column juros_de_lancamento_id uuid
    references public.lancamentos_financeiros(id) on delete cascade;

comment on column public.lancamentos_financeiros.juros_de_lancamento_id is
  'Só na origem juros_baixa: a baixa (pp_baixa ou avulsa_baixa) cujos juros e multa este lançamento paga. Cancelar a baixa apaga os juros junto (decisão 196).';

-- Um lançamento de juros por baixa; o índice também serve à FK.
create unique index uq_lancamentos_juros_de_lancamento
  on public.lancamentos_financeiros (juros_de_lancamento_id)
  where juros_de_lancamento_id is not null;

alter table public.lancamentos_financeiros
  add constraint chk_juros_so_na_origem_de_juros
  check ((origem = 'juros_baixa'::origem_lancamento) = (juros_de_lancamento_id is not null));

-- -----------------------------------------------------------------------------
-- 2. As travas de origem: o ramo de juros_baixa, sem mudar os outros
-- -----------------------------------------------------------------------------
do $$
declare
  v_def   text;
  v_meio  text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass
     and conname = 'chk_origem_contraparte_tem_id';
  if v_def is null or left(v_def, 8) <> 'CHECK ((' or right(v_def, 2) <> '))' then
    raise exception 'Definição inesperada de chk_origem_contraparte_tem_id: %', v_def;
  end if;
  v_meio := substr(v_def, 9, length(v_def) - 10);
  alter table public.lancamentos_financeiros drop constraint chk_origem_contraparte_tem_id;
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_contraparte_tem_id CHECK (('
    || v_meio
    || ' OR ((origem = ''juros_baixa''::origem_lancamento) AND (juros_de_lancamento_id IS NOT NULL))))';

  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conrelid = 'public.lancamentos_financeiros'::regclass
     and conname = 'chk_origem_tem_referencia';
  if v_def is null or left(v_def, 8) <> 'CHECK ((' or right(v_def, 2) <> '))' then
    raise exception 'Definição inesperada de chk_origem_tem_referencia: %', v_def;
  end if;
  v_meio := substr(v_def, 9, length(v_def) - 10);
  alter table public.lancamentos_financeiros drop constraint chk_origem_tem_referencia;
  -- Os juros são de uma PP ou de uma avulsa, nunca dos dois.
  execute 'alter table public.lancamentos_financeiros add constraint chk_origem_tem_referencia CHECK (('
    || v_meio
    || ' OR ((origem = ''juros_baixa''::origem_lancamento) AND (juros_de_lancamento_id IS NOT NULL)'
    || ' AND (((pedido_compra_id IS NOT NULL) AND (conta_avulsa_id IS NULL))'
    || ' OR ((conta_avulsa_id IS NOT NULL) AND (pedido_compra_id IS NULL)))'
    || ' AND (titulo_receber_id IS NULL) AND (desembolso_id IS NULL) AND (pp_verba_devolucao_id IS NULL)'
    || ' AND (fatura_cartao_id IS NULL) AND (transferencia_id IS NULL) AND (imposto_a_pagar_id IS NULL))))';
end;
$$;

-- -----------------------------------------------------------------------------
-- 3. Os juros de uma baixa (uso interno das funções de baixa)
-- -----------------------------------------------------------------------------
create or replace function public._lancar_juros_da_baixa(
  p_baixa_id  uuid,
  p_juros     numeric,
  p_uid       uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_baixa       lancamentos_financeiros%rowtype;
  v_tipo_juros  uuid;
  v_sub_juros   uuid;
  v_id          uuid;
begin
  select * into v_baixa from public.lancamentos_financeiros where id = p_baixa_id;
  if not found then raise exception 'Baixa não encontrada.'; end if;
  if v_baixa.origem not in ('pp_baixa', 'avulsa_baixa') then
    raise exception 'Juros e multa só na baixa de PP ou de avulsa (origem %).', v_baixa.origem;
  end if;

  select t.id, s.id into v_tipo_juros, v_sub_juros
    from public.plano_contas_tipos t
    join public.plano_contas_subtipos s on s.tipo_id = t.id
   where t.tenant_id = v_baixa.tenant_id and t.codigo = '11' and s.codigo = '999';
  if v_sub_juros is null then
    raise exception 'O centro de custo dos juros e da multa (11 · 999) não está no plano de contas.';
  end if;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, regional_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id,
    pedido_compra_id, pedido_compra_parcela_id, conta_avulsa_id,
    forma_pagamento, origem, juros_de_lancamento_id, criado_por
  ) values (
    v_baixa.tenant_id, v_baixa.empresa_id, v_baixa.regional_id, v_baixa.conta_bancaria_id,
    v_baixa.data_movimento, p_juros,
    'saida', substring('Juros e multa · ' || v_baixa.descricao, 1, 240), v_tipo_juros, v_sub_juros,
    v_baixa.fornecedor_id, v_baixa.cliente_id, v_baixa.job_id,
    v_baixa.pedido_compra_id, v_baixa.pedido_compra_parcela_id, v_baixa.conta_avulsa_id,
    v_baixa.forma_pagamento, 'juros_baixa', v_baixa.id, p_uid
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public._lancar_juros_da_baixa(uuid, numeric, uuid) is
  'Uso interno das baixas de PP e de avulsa: grava os juros e a multa (11 · 999, origem juros_baixa) ligados à baixa (decisão 196).';

revoke all on function public._lancar_juros_da_baixa(uuid, numeric, uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. A fatura de uma competência do cartão (uso interno das baixas)
-- -----------------------------------------------------------------------------
create or replace function public._fatura_da_competencia(
  p_cartao_id    uuid,
  p_competencia  date,
  p_data         date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cartao       cartoes_credito%rowtype;
  v_fecha        int;
  v_ano          int;
  v_mes          int;
  v_ultimo_dia   int;
  v_fechamento   date;
  v_da_data      date;
  v_fatura       faturas_cartao%rowtype;
  v_id           uuid;
  v_criada       date;
begin
  select * into v_cartao from public.cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado.'; end if;

  -- A competência é a do fechamento, como em garantir_fatura_aberta_do_cartao:
  -- o dia do fechamento no mês escolhido (o último dia, se o mês for curto).
  v_fecha := coalesce(v_cartao.dia_fechamento_fatura, v_cartao.dia_vencimento_fatura);
  v_ano := extract(year from p_competencia);
  v_mes := extract(month from p_competencia);
  v_ultimo_dia := extract(day from (date_trunc('month', make_date(v_ano, v_mes, 1)) + interval '1 month - 1 day')::date);
  v_fechamento := make_date(v_ano, v_mes, least(v_fecha, v_ultimo_dia));

  select * into v_fatura
    from public.faturas_cartao
   where cartao_credito_id = p_cartao_id and competencia_fechamento = v_fechamento;

  if found then
    if v_fatura.status <> 'aberta' then
      raise exception 'A fatura % (%) do cartão % está %: reabra-a na aba Cartão para lançar o item nela, ou escolha outra fatura.',
        v_fatura.codigo, to_char(v_fechamento, 'MM/YYYY'), v_cartao.nome,
        case v_fatura.status when 'fechada' then 'fechada' when 'paga' then 'paga' else 'cancelada' end;
    end if;
    return v_fatura.id;
  end if;

  -- Fatura nova: da competência da data do pagamento até 12 meses depois.
  v_da_data := date_trunc('month', p_data)::date;
  if extract(day from p_data)::int > v_fecha then
    v_da_data := (v_da_data + interval '1 month')::date;
  end if;
  if date_trunc('month', p_competencia)::date < v_da_data
     or date_trunc('month', p_competencia)::date > (v_da_data + interval '12 months')::date then
    raise exception 'Fatura nova só da competência da data do pagamento (%) até 12 meses depois.',
      to_char(v_da_data, 'MM/YYYY');
  end if;

  v_id := public.garantir_fatura_aberta_do_cartao(p_cartao_id, v_fechamento);
  select competencia_fechamento into v_criada from public.faturas_cartao where id = v_id;
  if v_criada is distinct from v_fechamento then
    raise exception 'A fatura de % do cartão % não pôde ser criada.', to_char(v_fechamento, 'MM/YYYY'), v_cartao.nome;
  end if;
  return v_id;
end;
$$;

comment on function public._fatura_da_competencia(uuid, date, date) is
  'Uso interno das baixas no cartão: a fatura aberta da competência escolhida, criada se ainda não existir; recusa a fechada e a paga (decisão 197).';

revoke all on function public._fatura_da_competencia(uuid, date, date) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. A baixa da parcela de PP: juros e fatura escolhida
-- -----------------------------------------------------------------------------
drop function public.baixar_parcela_pp(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb);

create function public.baixar_parcela_pp(
  p_parcela_id          uuid,
  p_pago_em             date,
  p_conta_bancaria_id   uuid,
  p_tipo_id             uuid,
  p_subtipo_id          uuid,
  p_forma_pagamento     forma_pagamento default null,
  p_cartao_credito_id   uuid default null,
  p_valor_baixa         numeric default null,
  p_retencoes           jsonb default '[]'::jsonb,
  p_juros               numeric default 0,
  p_fatura_competencia  date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid;
  v_parcela        pedidos_compra_parcelas%rowtype;
  v_pp             pedidos_compra%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_baixado        numeric;
  v_aberto         numeric;
  v_valor          numeric;
  v_retido         numeric;
  v_juros          numeric := round(coalesce(p_juros, 0), 2);
  v_fatura_id      uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
  v_res            record;
  v_remessa        record;
begin
  if p_pago_em is null then
    raise exception 'Informe a data do pagamento.';
  end if;
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;
  if v_juros < 0 then
    raise exception 'Juros e multa não podem ser negativos.';
  end if;
  if v_juros > 0 and p_forma_pagamento = 'cartao_credito' then
    raise exception 'No cartão não há juros na baixa: o atraso vem na fatura.';
  end if;
  if p_fatura_competencia is not null and p_forma_pagamento is distinct from 'cartao_credito' then
    raise exception 'A fatura só se escolhe na baixa no cartão.';
  end if;

  select * into v_parcela from public.pedidos_compra_parcelas where id = p_parcela_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  v_uid := public._exige_financeiro_para_baixar(v_parcela.tenant_id);

  if v_parcela.fatura_cartao_id is not null then
    raise exception 'Parcela paga no cartão não se baixa sozinha: ela espera na aba Cartão e sai na baixa da fatura inteira.';
  end if;
  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_parcela.pedido_compra_id;
  if v_pp.status <> 'aprovada' then
    raise exception 'A PP precisa estar aprovada antes da baixa (status atual: %).', v_pp.status;
  end if;

  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_baixado := public._bruto_baixado('pp_baixa', p_parcela_id);
  v_aberto := v_parcela.valor - v_baixado;
  if v_aberto <= 0.004 then
    raise exception 'Esta parcela já está quitada.';
  end if;
  v_valor := public._valor_da_baixa(p_valor_baixa, v_aberto);
  v_retido := public._retencoes_total(p_retencoes, v_valor);

  if v_valor < v_aberto - 0.004 or v_retido > 0 then
    if v_pp.verba_producao then
      raise exception 'PP de verba só aceita a baixa do valor inteiro, sem retenção.';
    end if;
    if p_forma_pagamento = 'cartao_credito' then
      raise exception 'No cartão, a baixa é sempre do valor inteiro: o item entra inteiro na fatura.';
    end if;
  end if;

  -- Parcela numa remessa ativa (decisão 145): o banco pagou o documento
  -- inteiro, pelo valor do item. A baixa é do que falta, e o líquido dela é
  -- o que o banco pagou — sem retenção, se a remessa pagou o valor cheio.
  select * into v_remessa from public._item_da_remessa(p_parcela_id);
  if found then
    if v_valor < v_aberto - 0.004 then
      raise exception 'Pago pela remessa: esta parcela só aceita a baixa do que falta.';
    end if;
    if v_remessa.retido <= 0 and v_retido > 0 then
      raise exception 'Pago pela remessa com o valor cheio: esta parcela só aceita a baixa do que falta, sem retenção.';
    end if;
    if v_remessa.retido > 0 and abs((v_valor - v_retido) - v_remessa.valor) >= 0.005 then
      raise exception 'A remessa pagou R$ % ao fornecedor (o que faltava menos a retenção da aprovação da PP): o líquido da baixa precisa ser esse valor.',
        translate(to_char(v_remessa.valor, 'FM999,999,990.00'), ',.', '.,');
    end if;
  end if;

  select count(*)::int into v_total from public.pedidos_compra_parcelas where pedido_compra_id = v_pp.id;

  if p_forma_pagamento = 'cartao_credito' then
    if v_baixado > 0 then
      raise exception 'Esta parcela já tem baixa parcial: o restante não vai para o cartão.';
    end if;

    -- A fatura escolhida (decisão 197); sem ela, a da data do pagamento.
    if p_fatura_competencia is not null then
      v_fatura_id := public._fatura_da_competencia(p_cartao_credito_id, p_fatura_competencia, p_pago_em);
    end if;

    v_descricao := 'Cartão · PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_pp.servico, 1, 140);

    select * into v_res from public.cartao_lancar_item(
      v_pp.tenant_id, v_pp.empresa_id, p_cartao_credito_id, p_pago_em,
      v_parcela.valor, 'saida', v_descricao,
      p_tipo_id, p_subtipo_id,
      v_pp.fornecedor_id, null, v_pp.job_id,
      null, v_pp.id, v_parcela.id, null, null,
      'pp_baixa', 'item', v_uid, v_fatura_id
    );
    v_lancamento_id := v_res.lancamento_id;

    update public.pedidos_compra_parcelas
       set pago_em = p_pago_em, pago_por = v_uid,
           fatura_cartao_id = v_res.fatura_id
     where id = p_parcela_id;
  else
    v_conta := public._conta_da_baixa(p_conta_bancaria_id, v_parcela.tenant_id, p_pago_em, 'pagamento');

    v_descricao := 'PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_pp.servico, 1, 140);

    insert into public.lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
      forma_pagamento, cartao_credito_id,
      origem, criado_por
    ) values (
      v_pp.tenant_id, v_pp.empresa_id, p_conta_bancaria_id, p_pago_em, v_valor - v_retido,
      'saida', v_descricao, p_tipo_id, p_subtipo_id,
      v_pp.fornecedor_id, v_pp.job_id, v_pp.id, v_parcela.id,
      p_forma_pagamento, null,
      'pp_baixa', v_uid
    )
    returning id into v_lancamento_id;

    perform public._retencoes_gravar(v_lancamento_id, v_parcela.tenant_id, p_retencoes, v_uid);

    -- Os juros e a multa (decisão 196): um lançamento à parte, que não quita.
    if v_juros > 0 then
      perform public._lancar_juros_da_baixa(v_lancamento_id, v_juros, v_uid);
    end if;

    if v_baixado + v_valor >= v_parcela.valor - 0.004 then
      update public.pedidos_compra_parcelas
         set pago_em = p_pago_em, pago_por = v_uid
       where id = p_parcela_id;
    end if;
  end if;

  select count(*)::int into v_em_aberto
    from public.pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id and pago_em is null;

  if v_em_aberto = 0 then
    update public.pedidos_compra
       set status = 'pago', pago_em = p_pago_em, pago_por = v_uid
     where id = v_pp.id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke all on function public.baixar_parcela_pp(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb, numeric, date) from public, anon;
grant execute on function public.baixar_parcela_pp(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb, numeric, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. A baixa da avulsa (avulso, recorrência, folha): juros e fatura escolhida
-- -----------------------------------------------------------------------------
drop function public.baixar_conta_avulsa(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb);

create function public.baixar_conta_avulsa(
  p_conta_avulsa_id     uuid,
  p_pago_em             date,
  p_conta_bancaria_id   uuid,
  p_tipo_id             uuid,
  p_subtipo_id          uuid,
  p_forma_pagamento     forma_pagamento default null,
  p_cartao_credito_id   uuid default null,
  p_valor_baixa         numeric default null,
  p_retencoes           jsonb default '[]'::jsonb,
  p_juros               numeric default 0,
  p_fatura_competencia  date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid;
  v_avulsa         contas_avulsas%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_subtipo_tipo   uuid;
  v_baixado        numeric;
  v_aberto         numeric;
  v_valor          numeric;
  v_retido         numeric;
  v_juros          numeric := round(coalesce(p_juros, 0), 2);
  v_fatura_id      uuid;
  v_descricao      text;
  v_lancamento_id  uuid;
  v_res            record;
begin
  if p_pago_em is null then
    raise exception 'Informe a data da baixa.';
  end if;
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;
  if v_juros < 0 then
    raise exception 'Juros e multa não podem ser negativos.';
  end if;
  if v_juros > 0 and p_forma_pagamento = 'cartao_credito' then
    raise exception 'No cartão não há juros na baixa: o atraso vem na fatura.';
  end if;
  if p_fatura_competencia is not null and p_forma_pagamento is distinct from 'cartao_credito' then
    raise exception 'A fatura só se escolhe na baixa no cartão.';
  end if;

  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id for update;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  v_uid := public._exige_financeiro_para_baixar(v_avulsa.tenant_id);

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Só avulsa aprovada pode ser baixada (status atual: %).', v_avulsa.status;
  end if;
  if v_avulsa.fatura_cartao_id is not null then
    raise exception 'Item pago no cartão não se baixa sozinho: ele espera na aba Cartão e sai na baixa da fatura inteira.';
  end if;
  if v_avulsa.estorno_de_avulsa_id is not null then
    raise exception 'Estorno de compra não tem baixa própria: ele já entra na fatura quando é lançado.';
  end if;
  -- Folha não vai para a fatura do cartão (Tiago, 01/10/2026): salário se
  -- paga por PIX ou TED, quase sempre pela remessa.
  if v_avulsa.folha_id is not null and p_forma_pagamento = 'cartao_credito' then
    raise exception 'Folha não se paga com cartão de crédito.';
  end if;
  -- Juros e multa só no que se paga (decisão 196): no recebimento, não.
  if v_juros > 0 and v_avulsa.natureza = 'entrada' then
    raise exception 'Juros e multa só no pagamento.';
  end if;

  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_baixado := public._bruto_baixado('avulsa_baixa', p_conta_avulsa_id);
  v_aberto := v_avulsa.valor - v_baixado;
  if v_aberto <= 0.004 then
    raise exception 'Esta conta já está quitada.';
  end if;
  v_valor := public._valor_da_baixa(p_valor_baixa, v_aberto);
  v_retido := public._retencoes_total(p_retencoes, v_valor);

  -- Onde só cabe o valor inteiro, sem retenção.
  if v_valor < v_aberto - 0.004 or v_retido > 0 then
    if v_avulsa.tipo_entrada = 'rendimento' then
      raise exception 'Rendimento só aceita a baixa do valor inteiro, sem retenção.';
    end if;
    if v_avulsa.folha_id is not null then
      raise exception 'Folha só aceita a baixa do valor inteiro, sem retenção.';
    end if;
    if p_forma_pagamento = 'cartao_credito' then
      raise exception 'No cartão, a baixa é sempre do valor inteiro: o item entra inteiro na fatura.';
    end if;
    if public._documento_em_remessa(p_conta_avulsa_id) then
      raise exception 'Pago pela remessa com o valor cheio: esta conta só aceita a baixa do que falta, sem retenção.';
    end if;
  end if;

  if p_forma_pagamento = 'cartao_credito' then
    if v_baixado > 0 then
      raise exception 'Esta conta já tem baixa parcial: o restante não vai para o cartão.';
    end if;

    -- A fatura escolhida (decisão 197); sem ela, a da data do pagamento.
    if p_fatura_competencia is not null then
      v_fatura_id := public._fatura_da_competencia(p_cartao_credito_id, p_fatura_competencia, p_pago_em);
    end if;

    v_descricao := 'Cartão · ' || substring(v_avulsa.descricao, 1, 180);

    select * into v_res from public.cartao_lancar_item(
      v_avulsa.tenant_id, v_avulsa.empresa_id, p_cartao_credito_id, p_pago_em,
      v_avulsa.valor, v_avulsa.natureza, v_descricao,
      p_tipo_id, p_subtipo_id,
      v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id,
      v_avulsa.id, null, null, null, null,
      'avulsa_baixa', 'item', v_uid, v_fatura_id
    );
    v_lancamento_id := v_res.lancamento_id;

    update public.contas_avulsas
       set status = 'baixada', pago_em = p_pago_em, pago_por = v_uid,
           conta_bancaria_baixa_id = v_res.conta_espelho_id,
           forma_pagamento = 'cartao_credito',
           cartao_credito_id = p_cartao_credito_id,
           fatura_cartao_id = v_res.fatura_id
     where id = p_conta_avulsa_id;

    return v_lancamento_id;
  end if;

  v_conta := public._conta_da_baixa(
    p_conta_bancaria_id, v_avulsa.tenant_id, p_pago_em,
    case when v_avulsa.natureza = 'entrada' then 'recebimento' else 'pagamento' end
  );

  v_descricao := 'Avulsa · ' || substring(v_avulsa.descricao, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, conta_avulsa_id,
    forma_pagamento, cartao_credito_id,
    origem, criado_por
  ) values (
    v_avulsa.tenant_id, v_avulsa.empresa_id, p_conta_bancaria_id, p_pago_em, v_valor - v_retido,
    v_avulsa.natureza, v_descricao, p_tipo_id, p_subtipo_id,
    v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id, v_avulsa.id,
    p_forma_pagamento, null,
    'avulsa_baixa', v_uid
  )
  returning id into v_lancamento_id;

  perform public._retencoes_gravar(v_lancamento_id, v_avulsa.tenant_id, p_retencoes, v_uid);

  -- Os juros e a multa (decisão 196): um lançamento à parte, que não quita.
  if v_juros > 0 then
    perform public._lancar_juros_da_baixa(v_lancamento_id, v_juros, v_uid);
  end if;

  if v_baixado + v_valor >= v_avulsa.valor - 0.004 then
    update public.contas_avulsas
       set status = 'baixada', pago_em = p_pago_em, pago_por = v_uid,
           conta_bancaria_baixa_id = p_conta_bancaria_id
     where id = p_conta_avulsa_id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke all on function public.baixar_conta_avulsa(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb, numeric, date) from public, anon;
grant execute on function public.baixar_conta_avulsa(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb, numeric, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. A baixa do desembolso: fatura escolhida, e só admin ou financeiro (M2.4)
-- -----------------------------------------------------------------------------
drop function public.dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid);

create function public.dar_baixa_desembolso_parcela(
  p_parcela_id              uuid,
  p_pago_em                 date,
  p_conta_bancaria_id       uuid,
  p_plano_conta_tipo_id     uuid,
  p_plano_conta_subtipo_id  uuid,
  p_criado_por              uuid,
  p_forma_pagamento         forma_pagamento,
  p_cartao_credito_id       uuid default null,
  p_fatura_competencia      date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid;
  v_parcela        desembolsos_parcelas%rowtype;
  v_desembolso     desembolsos%rowtype;
  v_conta          contas_bancarias%rowtype;
  v_total          integer;
  v_em_aberto      integer;
  v_subtipo_tipo   uuid;
  v_fatura_id      uuid;
  v_lancamento_id  uuid;
  v_descricao      text;
  v_res            record;
begin
  if p_forma_pagamento = 'cartao_credito' and p_cartao_credito_id is null then
    raise exception 'Cartão obrigatório quando forma = cartão de crédito.';
  end if;
  if p_forma_pagamento is distinct from 'cartao_credito' and p_cartao_credito_id is not null then
    raise exception 'Cartão só pode ser informado quando forma = cartão de crédito.';
  end if;
  if p_fatura_competencia is not null and p_forma_pagamento is distinct from 'cartao_credito' then
    raise exception 'A fatura só se escolhe na baixa no cartão.';
  end if;

  select * into v_parcela from desembolsos_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  -- Só admin ou financeiro dá baixa (M2.4), como nas outras baixas.
  v_uid := public._exige_financeiro_para_baixar(v_parcela.tenant_id);

  if v_parcela.pago_em is not null then
    raise exception 'Esta parcela já está paga.';
  end if;

  select * into v_desembolso from desembolsos where id = v_parcela.desembolso_id;
  if v_desembolso.status <> 'aprovada' then
    raise exception 'O desembolso precisa estar aprovado antes da baixa (status atual: %).', v_desembolso.status;
  end if;

  select tipo_id into v_subtipo_tipo from plano_contas_subtipos where id = p_plano_conta_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_plano_conta_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  select count(*)::int into v_total from desembolsos_parcelas where desembolso_id = v_desembolso.id;

  if p_forma_pagamento = 'cartao_credito' then
    -- A fatura escolhida (decisão 197); sem ela, a da data do pagamento.
    if p_fatura_competencia is not null then
      v_fatura_id := public._fatura_da_competencia(p_cartao_credito_id, p_fatura_competencia, p_pago_em);
    end if;

    v_descricao := 'Cartão · Desembolso ' || v_desembolso.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_desembolso.descricao, 1, 140);

    select * into v_res from public.cartao_lancar_item(
      v_desembolso.tenant_id, v_desembolso.empresa_id, p_cartao_credito_id, p_pago_em,
      v_parcela.valor, 'saida', v_descricao,
      p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
      v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
      null, null, null, v_desembolso.id, v_parcela.id,
      'desembolso_baixa', 'item', v_uid, v_fatura_id
    );
    v_lancamento_id := v_res.lancamento_id;

    update desembolsos_parcelas
       set pago_em = p_pago_em, pago_por = v_uid
     where id = p_parcela_id;
  else
    select * into v_conta from contas_bancarias where id = p_conta_bancaria_id;
    if not found then raise exception 'Conta bancária não encontrada.'; end if;
    if v_conta.cartao_credito_id is not null then
      raise exception 'A conta espelho de um cartão não paga título direto — escolha a forma "cartão de crédito".';
    end if;
    if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
    if p_pago_em < v_conta.saldo_inicial_data then
      raise exception 'Data do pagamento é anterior à data do saldo inicial da conta.';
    end if;

    update desembolsos_parcelas
       set pago_em = p_pago_em, pago_por = v_uid
     where id = p_parcela_id;

    v_descricao := 'Desembolso ' || v_desembolso.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_desembolso.descricao, 1, 140);

    insert into lancamentos_financeiros (
      tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
      natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
      fornecedor_id, cliente_id, job_id,
      desembolso_id, desembolso_parcela_id,
      forma_pagamento, cartao_credito_id,
      origem, criado_por
    ) values (
      v_desembolso.tenant_id, v_desembolso.empresa_id, p_conta_bancaria_id, p_pago_em, v_parcela.valor,
      'saida', v_descricao, p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
      v_desembolso.fornecedor_id, v_desembolso.cliente_id, v_desembolso.job_id,
      v_desembolso.id, v_parcela.id,
      p_forma_pagamento, null,
      'desembolso_baixa', v_uid
    )
    returning id into v_lancamento_id;
  end if;

  select count(*)::int into v_em_aberto
    from desembolsos_parcelas
   where desembolso_id = v_desembolso.id and pago_em is null;

  if v_em_aberto = 0 then
    update desembolsos
       set status = 'pago', pago_em = now(), pago_por = v_uid
     where id = v_desembolso.id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke all on function public.dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid, date) from public, anon;
grant execute on function public.dar_baixa_desembolso_parcela(uuid, date, uuid, uuid, uuid, uuid, forma_pagamento, uuid, date) to authenticated;
