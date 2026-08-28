-- =====================================================================
-- A data da compra, e o estorno de uma compra no cartão
--
-- Duas lacunas que o teste de 28/08/2026 deixou anotadas.
--
-- ── 1. data_compra ──────────────────────────────────────────────────
--
-- Até aqui a compra escolhia a fatura por `current_date`: o dia em que
-- foi LANÇADA. Serve enquanto o financeiro lança no mesmo ciclo, e mente
-- assim que ele lança com atraso — a compra de 20/09 registrada em 02/10
-- caía na fatura de outubro.
--
-- Agora existe `data_compra`. Quem não informa continua caindo em hoje.
--
-- Uma compra retroativa cuja competência já fechou não volta para dentro
-- da fatura fechada: `fatura_aberta_do_cartao` rola para a competência
-- aberta seguinte. É o certo — a fatura fechada já virou contabilidade, e
-- a diferença dela já foi classificada no fechamento.
--
-- ── 2. estorno_de_avulsa_id ─────────────────────────────────────────
--
-- Devolução de compra, cancelamento de assinatura, cobrança indevida
-- reconhecida pela operadora: o cartão recebe crédito. Sem isso, a única
-- saída era o ajuste do fechamento, que é para IOF e anuidade e não deixa
-- rastro de qual compra foi desfeita.
--
-- O estorno APONTA PARA A COMPRA, como a devolução de verba aponta para a
-- PP (`pp_verba_devolucoes.pedido_compra_id`). Dessa ligação ele herda
-- plano de contas, job, fornecedor, cliente e empresa — herda em vez de
-- perguntar, porque estorno com plano de contas diferente do da compra
-- não se anula no DRE, e essa é a única razão de ele existir.
--
-- Aqui ele é COLUNA e não tabela nova, ao contrário da devolução de
-- verba: o estorno precisa entrar numa fatura, e o que entra em fatura é
-- avulsa. Uma tabela à parte obrigaria toda query de fatura — gatilho,
-- fechamento, aba Cartão, Conciliação — a unir duas fontes para somar.
--
-- O sinal mora em `natureza` ('entrada'), nunca no valor:
-- `chk_avulsa_valor_positivo` continua valendo e nenhum valor negativo
-- entra na tabela.
--
-- ⚠️ PARA QUEM FOR IMPLEMENTAR PARCELAMENTO NO CARTÃO: o estorno aponta
-- para a COMPRA, de propósito — nunca para a parcela. Uma compra em 3x
-- estornada por inteiro gera UM estorno do valor cheio, e as parcelas já
-- pagas continuam pagas; o crédito cai na fatura aberta do dia do estorno
-- e abate o que vier. É como a operadora faz. Se o parcelamento
-- re-apontar o estorno para a parcela, isso quebra. Regra do Tiago,
-- 29/08/2026.
-- =====================================================================

alter table public.contas_avulsas
  add column if not exists data_compra date,
  add column if not exists estorno_de_avulsa_id uuid
    references public.contas_avulsas(id) on delete restrict;

comment on column public.contas_avulsas.data_compra is
  'Dia em que a compra aconteceu. É ela que escolhe a fatura do cartão; vazio = hoje.';
comment on column public.contas_avulsas.estorno_de_avulsa_id is
  'A compra que este lançamento estorna. Aponta para a COMPRA, nunca para a parcela.';

-- Índice: a validação soma os estornos de uma compra a cada novo estorno,
-- e a tela lista os estornos de cada compra.
create index if not exists idx_avulsas_estorno_de
  on public.contas_avulsas (estorno_de_avulsa_id)
  where estorno_de_avulsa_id is not null;

-- Estorno é sempre crédito, e só existe no cartão: fora do cartão a
-- devolução de uma despesa é um recebimento, que tem caminho próprio.
alter table public.contas_avulsas
  drop constraint if exists chk_avulsa_estorno_coerente;
alter table public.contas_avulsas
  add constraint chk_avulsa_estorno_coerente check (
    estorno_de_avulsa_id is null
    or (natureza = 'entrada' and forma_pagamento = 'cartao_credito')
  );

-- E o contrário também: crédito no cartão sem compra apontada não entra.
-- O que não vem de uma compra específica — IOF, anuidade, cashback — é o
-- ajuste do fechamento, que tem lugar próprio.
alter table public.contas_avulsas
  drop constraint if exists chk_avulsa_credito_no_cartao_e_estorno;
alter table public.contas_avulsas
  add constraint chk_avulsa_credito_no_cartao_e_estorno check (
    not (forma_pagamento = 'cartao_credito' and natureza = 'entrada')
    or estorno_de_avulsa_id is not null
  );

-- ---------------------------------------------------------------------
-- O estorno herda da compra, e não pode passar dela
-- ---------------------------------------------------------------------
create or replace function public.avulsa_estorno_herda_da_compra()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_compra        contas_avulsas%rowtype;
  v_ja_estornado  numeric;
  v_disponivel    numeric;
begin
  if new.estorno_de_avulsa_id is null then
    return new;
  end if;

  if new.estorno_de_avulsa_id = new.id then
    raise exception 'Um estorno não pode apontar para ele mesmo.';
  end if;

  select * into v_compra from contas_avulsas where id = new.estorno_de_avulsa_id;
  if not found then
    raise exception 'A compra estornada não existe.';
  end if;

  if v_compra.tenant_id <> new.tenant_id then
    raise exception 'A compra estornada é de outro tenant.';
  end if;

  if v_compra.estorno_de_avulsa_id is not null then
    raise exception 'Não se estorna um estorno. Aponte para a compra original.';
  end if;

  if v_compra.forma_pagamento is distinct from 'cartao_credito'
     or v_compra.cartao_credito_id is null then
    raise exception 'Só compra feita no cartão pode ser estornada por aqui.';
  end if;

  if new.cartao_credito_id is distinct from v_compra.cartao_credito_id then
    raise exception 'O estorno tem que ser no mesmo cartão da compra.';
  end if;

  -- Quanto da compra ainda não foi estornado. A compra paga entra aqui do
  -- mesmo jeito: devolução de compra já paga é justamente o caso comum, e
  -- o crédito cai na fatura aberta de hoje.
  select coalesce(sum(e.valor), 0) into v_ja_estornado
    from contas_avulsas e
   where e.estorno_de_avulsa_id = v_compra.id
     and e.id is distinct from new.id;

  v_disponivel := v_compra.valor - v_ja_estornado;

  if new.valor > v_disponivel + 0.005 then
    raise exception
      'A compra % é de % e já tem % estornado — sobram % para estornar.',
      coalesce(v_compra.codigo, '(sem código)'),
      to_char(v_compra.valor,  'FM999999999990.00'),
      to_char(v_ja_estornado,  'FM999999999990.00'),
      to_char(v_disponivel,    'FM999999999990.00');
  end if;

  -- Herda. Estorno com plano de contas diferente do da compra não se
  -- anula no DRE, e anular é a razão de ele existir.
  new.natureza              := 'entrada';
  new.empresa_id            := v_compra.empresa_id;
  new.plano_conta_tipo_id   := v_compra.plano_conta_tipo_id;
  new.plano_conta_subtipo_id:= v_compra.plano_conta_subtipo_id;
  new.job_id                := v_compra.job_id;
  new.fornecedor_id         := v_compra.fornecedor_id;
  new.cliente_id            := v_compra.cliente_id;

  return new;
end;
$function$;

drop trigger if exists trg_avulsa_estorno_herda on public.contas_avulsas;
-- ⚠️ O nome importa: gatilhos rodam em ordem alfabética, e "estorno_herda"
-- vem antes de "entra_na_fatura"… não vem. "entra" < "estorno". Como o
-- gatilho da fatura só lê forma/cartão/data_compra e este só escreve
-- plano/job/empresa, a ordem é indiferente — mas fica dito, para o dia em
-- que um dos dois passar a ler o que o outro escreve.
create trigger trg_avulsa_estorno_herda
  before insert or update of estorno_de_avulsa_id, valor, cartao_credito_id
  on public.contas_avulsas
  for each row execute function public.avulsa_estorno_herda_da_compra();

revoke execute on function public.avulsa_estorno_herda_da_compra() from public;

-- ---------------------------------------------------------------------
-- A fatura escolhe pela data da compra
-- ---------------------------------------------------------------------
create or replace function public.avulsa_entra_na_fatura()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_vencimento date;
  v_status     fatura_cartao_status;
begin
  if new.forma_pagamento is distinct from 'cartao_credito'
     or new.cartao_credito_id is null then
    new.fatura_cartao_id := null;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.fatura_cartao_id is not null then
    select status into v_status
      from faturas_cartao
     where id = new.fatura_cartao_id
       and cartao_credito_id = new.cartao_credito_id;

    if found and v_status = 'aberta' then
      return new;
    end if;
  end if;

  -- A data da COMPRA escolhe a fatura. Vazio = hoje. Nunca a data de
  -- pagamento: ela SAI daqui, e usá-la como entrada empurrava a compra uma
  -- competência para a frente (28/08/2026).
  new.fatura_cartao_id := public.fatura_aberta_do_cartao(
    new.cartao_credito_id,
    coalesce(new.data_compra, current_date)
  );

  select data_vencimento into v_vencimento
    from faturas_cartao where id = new.fatura_cartao_id;

  if v_vencimento is not null then
    new.data_prevista_pagamento := v_vencimento;
    new.data_pagamento := v_vencimento;
    if tg_op = 'INSERT' then
      new.data_pagamento_primeira := v_vencimento;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_avulsa_entra_na_fatura on public.contas_avulsas;
create trigger trg_avulsa_entra_na_fatura
  before insert or update of cartao_credito_id, forma_pagamento,
                             data_prevista_pagamento, data_compra
  on public.contas_avulsas
  for each row execute function public.avulsa_entra_na_fatura();

-- ---------------------------------------------------------------------
-- O fechamento soma com sinal, e aceita fatura credora
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

  -- Zero e negativo passam: com estorno maior que as compras do mês a
  -- fatura é credora, e o banco não cobra nada. Só nulo é recusado.
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
      forma_pagamento, cartao_credito_id, fatura_cartao_id,
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
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id,
      'avulsa_baixa', v_caller_uid
    );

    update contas_avulsas
       set status = 'baixada',
           pago_em = v_fatura.competencia_fechamento,
           pago_por = v_caller_uid,
           conta_bancaria_baixa_id = v_conta.id
     where id = v_item.id;

    -- Com sinal: o estorno é 'entrada' e ABATE a fatura.
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
      forma_pagamento, cartao_credito_id, fatura_cartao_id,
      origem, criado_por
    ) values (
      v_fatura.tenant_id, v_conta.empresa_id, v_conta.id,
      v_fatura.competencia_fechamento, abs(v_diferenca),
      (case when v_diferenca > 0 then 'saida' else 'entrada' end)::natureza_lancamento,
      coalesce(nullif(btrim(p_ajuste_descricao), ''), 'Ajuste da fatura ' || v_fatura.codigo),
      p_ajuste_tipo_id, p_ajuste_subtipo_id,
      'cartao_credito', v_fatura.cartao_credito_id, p_fatura_id,
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

revoke execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) from public;
grant  execute on function public.fechar_fatura_cartao(uuid, numeric, uuid, uuid, text) to authenticated;
