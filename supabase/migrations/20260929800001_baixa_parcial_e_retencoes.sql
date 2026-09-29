-- =====================================================================
-- Baixa parcial e impostos retidos na baixa, nas duas pontas
-- (decisão 125, Tiago, 29/09/2026)
-- =====================================================================
--
-- Até aqui cada título a receber, parcela de PP e conta avulsa tinha no
-- máximo UMA baixa viva (índices `uniq_baixa_ativa_por_*`), sempre do
-- valor cheio. Agora:
--
-- 1. BAIXA PARCIAL. O documento aceita várias baixas e só vira pago
--    (título `pago`, parcela com `pago_em`, avulsa `baixada`) quando a
--    soma delas chega ao valor dele. O que falta = valor − soma das
--    baixas. O valor a dar baixa nunca passa do que falta (D13): o que o
--    cliente pagou a mais entra como recebimento avulso.
--
-- 2. IMPOSTOS RETIDOS (ISS, PIS, COFINS, CSLL, IRRF; sem INSS, D6 1a).
--    A baixa continua sendo o lançamento, com o valor LÍQUIDO (o que
--    entrou ou saiu da conta, e é o que o extrato mostra). Os retidos
--    ficam na tabela nova `baixas_retencoes`, imposto por imposto,
--    pendurados no lançamento. Valor a dar baixa = líquido + retidos, e
--    é ele que quita o documento. No pagar, o retido fica para a agência
--    recolher: só é registrado, sem título da guia (P6).
--
--    Mudança sobre a D17.1 aprovada pelo Tiago: não há tabela de baixas
--    copiando as que existem — ela duplicaria o lançamento. Nenhum dado
--    é copiado ou reescrito.
--
-- 3. ONDE CABE. Parcial e retenção valem para título a receber, PP,
--    avulsa, recorrência e recebimento avulso (P4). Ficam só com o valor
--    inteiro e sem retenção: rendimento, folha (P1), PP de verba (P3),
--    item no cartão e documento que já foi para uma remessa CNAB
--    (interino da D15: "pago pela remessa com o valor cheio"). Desembolso,
--    devolução de verba (P2), fatura de cartão e transferência não passam
--    por aqui: seguem com as funções de hoje e a trava de uma baixa.
--
-- 4. CANCELAR é por baixa (`cancelar_baixa_lancamento`): apaga aquele
--    lançamento, os estornos dele e os retidos dele, e o documento volta
--    a ficar em aberto (parcial, se sobrar baixa). As funções antigas de
--    dar baixa e de cancelar mantêm a assinatura e passam a delegar: a
--    antiga de baixa baixa o que falta; a antiga de cancelar cancela a
--    baixa mais recente.
--
-- 5. TRAVAS que só olhavam "pago" passam a ver a baixa parcial: cancelar
--    a NF, reprovar a PP aprovada, mandar a PP para o cartão e excluir o
--    recebimento avulso.
--
-- As views (`vw_a_pagar`, `vw_fluxo_caixa`) projetam só o que falta na
-- migration seguinte (20260929800002).
--
-- Permissão: só administrador ou financeiro, no servidor (as actions já
-- exigiam; a função de baixa antiga aceitava qualquer membro do tenant).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Impostos retidos por baixa
-- ---------------------------------------------------------------------

create table if not exists public.baixas_retencoes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete restrict,
  lancamento_id  uuid not null references public.lancamentos_financeiros(id) on delete cascade,
  imposto        text not null,
  aliquota       numeric(7,4),
  valor          numeric(14,2) not null,
  criado_por     uuid not null references public.profiles(id),
  created_at     timestamptz not null default now(),
  constraint chk_baixa_retencao_imposto
    check (imposto in ('ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF')),
  constraint chk_baixa_retencao_valor check (valor > 0),
  constraint chk_baixa_retencao_aliquota
    check (aliquota is null or (aliquota > 0 and aliquota < 100)),
  constraint uq_baixa_retencao_imposto unique (lancamento_id, imposto)
);

comment on table public.baixas_retencoes is
  'Impostos retidos na fonte numa baixa (decisão 125). O lançamento guarda o líquido; valor a dar baixa = líquido + retidos. Escrita só pelas funções de baixa.';

create index if not exists idx_baixas_retencoes_tenant on public.baixas_retencoes (tenant_id);
create index if not exists idx_baixas_retencoes_criado_por on public.baixas_retencoes (criado_por);

alter table public.baixas_retencoes enable row level security;

-- Vê a retenção quem vê o lançamento dela: o `exists` passa pela RLS de
-- `lancamentos_financeiros` com o usuário de quem consulta.
drop policy if exists baixas_retencoes_select on public.baixas_retencoes;
create policy baixas_retencoes_select on public.baixas_retencoes
  for select to authenticated
  using (
    tenant_id in (select public.current_tenant_ids())
    and exists (
      select 1 from public.lancamentos_financeiros l
       where l.id = baixas_retencoes.lancamento_id
    )
  );

revoke all on table public.baixas_retencoes from public, anon;
revoke insert, update, delete, truncate, references, trigger on table public.baixas_retencoes from authenticated;
grant select on table public.baixas_retencoes to authenticated;

-- ---------------------------------------------------------------------
-- 2. Sai a trava de uma baixa viva por documento (D17.1)
-- ---------------------------------------------------------------------
-- Ficam as de desembolso, PP sem parcela (legado), fatura de cartão e
-- transferência, que continuam só com o valor inteiro. A concorrência
-- das baixas novas é segurada pelo `for update` no documento.

drop index if exists public.uniq_baixa_ativa_por_titulo;
drop index if exists public.uniq_baixa_ativa_por_parcela;
drop index if exists public.uniq_baixa_ativa_por_avulsa;

-- ---------------------------------------------------------------------
-- 3. Auxiliares (internas: sem execução para authenticated)
-- ---------------------------------------------------------------------

create or replace function public._exige_financeiro_para_baixar(p_tenant_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sessão inválida.';
  end if;
  if not (public.is_tenant_admin(p_tenant_id) or public.is_tenant_financeiro(p_tenant_id)) then
    raise exception 'Apenas admin ou financeiro pode dar baixa.'
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Soma das baixas vivas do documento pelo VALOR A DAR BAIXA (líquido +
-- retidos). Estorno não entra: é transação nova, não desfaz a baixa
-- (decisão 120).
create or replace function public._bruto_baixado(p_origem public.origem_lancamento, p_documento_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_total numeric;
begin
  select coalesce(sum(l.valor + coalesce(r.retido, 0)), 0)
    into v_total
    from public.lancamentos_financeiros l
    left join lateral (
      select sum(rb.valor) as retido
        from public.baixas_retencoes rb
       where rb.lancamento_id = l.id
    ) r on true
   where l.origem = p_origem
     and (
       (p_origem = 'titulo_baixa' and l.titulo_receber_id = p_documento_id)
       or (p_origem = 'pp_baixa' and l.pedido_compra_parcela_id = p_documento_id)
       or (p_origem = 'avulsa_baixa' and l.conta_avulsa_id = p_documento_id)
     );
  return v_total;
end;
$$;

-- Valida a lista de retidos e devolve a soma. Formato:
-- [{"imposto": "ISS", "aliquota": 5, "valor": 1800.00}, ...]
create or replace function public._retencoes_total(p_retencoes jsonb, p_valor_baixa numeric)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_item    jsonb;
  v_imposto text;
  v_valor   numeric;
  v_aliq    numeric;
  v_total   numeric := 0;
  v_vistos  text[] := '{}';
begin
  if p_retencoes is null or p_retencoes = 'null'::jsonb or p_retencoes = '[]'::jsonb then
    return 0;
  end if;
  if jsonb_typeof(p_retencoes) <> 'array' then
    raise exception 'Impostos retidos em formato inválido.';
  end if;

  for v_item in select value from jsonb_array_elements(p_retencoes) loop
    v_imposto := upper(btrim(v_item->>'imposto'));
    if v_imposto is null or v_imposto not in ('ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF') then
      raise exception 'Imposto retido inválido: %.', coalesce(v_item->>'imposto', '(vazio)');
    end if;
    if v_imposto = any (v_vistos) then
      raise exception 'O % aparece duas vezes nos impostos retidos.', v_imposto;
    end if;
    v_vistos := v_vistos || v_imposto;

    v_valor := round((v_item->>'valor')::numeric, 2);
    if v_valor is null or v_valor <= 0 then
      raise exception 'Informe o valor retido de %.', v_imposto;
    end if;

    v_aliq := nullif(v_item->>'aliquota', '')::numeric;
    if v_aliq is not null and (v_aliq <= 0 or v_aliq >= 100) then
      raise exception 'A alíquota de % precisa ficar entre 0%% e 100%%.', v_imposto;
    end if;

    v_total := v_total + v_valor;
  end loop;

  if v_total >= p_valor_baixa then
    raise exception 'Os impostos retidos não podem ser maiores que o valor a dar baixa.';
  end if;
  return v_total;
end;
$$;

create or replace function public._retencoes_gravar(
  p_lancamento_id uuid, p_tenant_id uuid, p_retencoes jsonb, p_uid uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_retencoes is null or p_retencoes = 'null'::jsonb or p_retencoes = '[]'::jsonb then
    return;
  end if;
  insert into public.baixas_retencoes (tenant_id, lancamento_id, imposto, aliquota, valor, criado_por)
  select p_tenant_id, p_lancamento_id,
         upper(btrim(x->>'imposto')),
         round(nullif(x->>'aliquota', '')::numeric, 4),
         round((x->>'valor')::numeric, 2),
         p_uid
    from jsonb_array_elements(p_retencoes) as x;
end;
$$;

-- Confere o valor a dar baixa contra o que falta e devolve o valor final
-- (arredondado; uma sobra de centavo de arredondamento vira o que falta).
create or replace function public._valor_da_baixa(p_valor_baixa numeric, p_aberto numeric)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_valor numeric := coalesce(round(p_valor_baixa, 2), round(p_aberto, 2));
begin
  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe o valor a dar baixa.';
  end if;
  if v_valor > p_aberto + 0.004 then
    -- Formato brasileiro na mão: o `to_char` com G/D segue o lc_numeric
    -- do servidor, que não é pt-BR.
    raise exception 'O valor a dar baixa passa do que falta (R$ %).',
      translate(to_char(p_aberto, 'FM999,999,990.00'), ',.', '.,');
  end if;
  return least(v_valor, round(p_aberto, 2));
end;
$$;

create or replace function public._conta_da_baixa(
  p_conta_bancaria_id uuid, p_tenant_id uuid, p_data date, p_rotulo text
)
returns public.contas_bancarias
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_conta public.contas_bancarias%rowtype;
begin
  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.tenant_id <> p_tenant_id then
    raise exception 'Conta bancária de outro tenant.';
  end if;
  -- Sem trava de empresa: a conta paga despesa de mais de uma empresa
  -- (29/08/2026). Quem diz a empresa é o documento.
  if v_conta.cartao_credito_id is not null then
    raise exception 'A conta espelho de um cartão não paga título direto — escolha a forma "cartão de crédito".';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  if p_data < v_conta.saldo_inicial_data then
    raise exception 'Data do % é anterior à data do saldo inicial da conta.', p_rotulo;
  end if;
  return v_conta;
end;
$$;

-- Documento que já foi para uma remessa CNAB (interino da D15).
create or replace function public._documento_em_remessa(p_documento_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.cnab_remessas_itens i where i.origem_id = p_documento_id);
$$;

revoke all on function public._exige_financeiro_para_baixar(uuid) from public, anon, authenticated;
revoke all on function public._bruto_baixado(public.origem_lancamento, uuid) from public, anon, authenticated;
revoke all on function public._retencoes_total(jsonb, numeric) from public, anon, authenticated;
revoke all on function public._retencoes_gravar(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function public._valor_da_baixa(numeric, numeric) from public, anon, authenticated;
revoke all on function public._conta_da_baixa(uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function public._documento_em_remessa(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Dar baixa: título a receber
-- ---------------------------------------------------------------------

create or replace function public.baixar_titulo_receber(
  p_titulo_id          uuid,
  p_pago_em            date,
  p_conta_bancaria_id  uuid,
  p_tipo_id            uuid,
  p_subtipo_id         uuid,
  p_valor_baixa        numeric default null,
  p_retencoes          jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid           uuid;
  v_titulo        titulos_receber%rowtype;
  v_fat           faturamentos%rowtype;
  v_conta         contas_bancarias%rowtype;
  v_subtipo_tipo  uuid;
  v_baixado       numeric;
  v_aberto        numeric;
  v_valor         numeric;
  v_retido        numeric;
  v_lancamento_id uuid;
  v_descricao     text;
  v_todos_pagos   boolean;
  v_bv            record;
begin
  if p_pago_em is null then
    raise exception 'Informe a data do recebimento.';
  end if;

  select * into v_titulo from public.titulos_receber where id = p_titulo_id for update;
  if not found then raise exception 'Título não encontrado.'; end if;

  v_uid := public._exige_financeiro_para_baixar(v_titulo.tenant_id);

  if v_titulo.status <> 'em_aberto' then
    raise exception 'Título não está em aberto (situação atual: %).', v_titulo.status;
  end if;

  select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;
  if v_fat.status <> 'emitido' then
    raise exception 'Faturamento não está emitido (situação atual: %).', v_fat.status;
  end if;

  if p_tipo_id is null or p_subtipo_id is null then
    raise exception 'Selecione o centro de custo do recebimento.';
  end if;
  select tipo_id into v_subtipo_tipo from public.plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo_tipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  v_conta := public._conta_da_baixa(p_conta_bancaria_id, v_titulo.tenant_id, p_pago_em, 'recebimento');

  v_baixado := public._bruto_baixado('titulo_baixa', p_titulo_id);
  v_aberto := v_titulo.valor - v_baixado;
  if v_aberto <= 0.004 then
    raise exception 'Este título já está quitado.';
  end if;
  v_valor := public._valor_da_baixa(p_valor_baixa, v_aberto);
  v_retido := public._retencoes_total(p_retencoes, v_valor);

  v_descricao := 'Recebimento NF ' || v_fat.numero_nf || '/' ||
                 v_titulo.numero_parcela::text || ' — ' ||
                 substring(v_fat.descricao, 1, 120);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id,
    titulo_receber_id, origem, criado_por
  ) values (
    v_titulo.tenant_id, v_titulo.empresa_id, p_conta_bancaria_id, p_pago_em,
    v_valor - v_retido,
    'entrada', v_descricao, p_tipo_id, p_subtipo_id,
    v_fat.fornecedor_id, v_fat.cliente_id,
    v_titulo.id, 'titulo_baixa', v_uid
  )
  returning id into v_lancamento_id;

  perform public._retencoes_gravar(v_lancamento_id, v_titulo.tenant_id, p_retencoes, v_uid);

  -- Quitou: o título vira pago com a data, a conta e o lançamento da
  -- baixa que fechou a conta.
  if v_baixado + v_valor >= v_titulo.valor - 0.004 then
    update public.titulos_receber
       set status = 'pago',
           pago_em = p_pago_em,
           pago_por = v_uid,
           conta_bancaria_recebimento_id = p_conta_bancaria_id,
           lancamento_id = v_lancamento_id
     where id = p_titulo_id;

    select bool_and(status = 'pago') into v_todos_pagos
      from public.titulos_receber
     where faturamento_id = v_fat.id
       and status <> 'cancelado';

    if v_todos_pagos then
      for v_bv in
        select fi.origem_id from public.faturamento_itens fi
         where fi.faturamento_id = v_fat.id and fi.origem_tipo = 'bv'
      loop
        update public.itens_bv set situacao = 'recebido' where id = v_bv.origem_id;
      end loop;
    end if;
  end if;

  return v_lancamento_id;
end;
$$;

revoke all on function public.baixar_titulo_receber(uuid, date, uuid, uuid, uuid, numeric, jsonb) from public, anon;
grant execute on function public.baixar_titulo_receber(uuid, date, uuid, uuid, uuid, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Dar baixa: conta avulsa (avulso, recorrência, folha, recebimento
--    avulso, rendimento)
-- ---------------------------------------------------------------------

create or replace function public.baixar_conta_avulsa(
  p_conta_avulsa_id    uuid,
  p_pago_em            date,
  p_conta_bancaria_id  uuid,
  p_tipo_id            uuid,
  p_subtipo_id         uuid,
  p_forma_pagamento    forma_pagamento default null,
  p_cartao_credito_id  uuid default null,
  p_valor_baixa        numeric default null,
  p_retencoes          jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
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

    v_descricao := 'Cartão · ' || substring(v_avulsa.descricao, 1, 180);

    select * into v_res from public.cartao_lancar_item(
      v_avulsa.tenant_id, v_avulsa.empresa_id, p_cartao_credito_id, p_pago_em,
      v_avulsa.valor, v_avulsa.natureza, v_descricao,
      p_tipo_id, p_subtipo_id,
      v_avulsa.fornecedor_id, v_avulsa.cliente_id, v_avulsa.job_id,
      v_avulsa.id, null, null, null, null,
      'avulsa_baixa', 'item', v_uid, null
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

  if v_baixado + v_valor >= v_avulsa.valor - 0.004 then
    update public.contas_avulsas
       set status = 'baixada', pago_em = p_pago_em, pago_por = v_uid,
           conta_bancaria_baixa_id = p_conta_bancaria_id
     where id = p_conta_avulsa_id;
  end if;

  return v_lancamento_id;
end;
$$;

revoke all on function public.baixar_conta_avulsa(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb) from public, anon;
grant execute on function public.baixar_conta_avulsa(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Dar baixa: parcela de PP
-- ---------------------------------------------------------------------

create or replace function public.baixar_parcela_pp(
  p_parcela_id         uuid,
  p_pago_em            date,
  p_conta_bancaria_id  uuid,
  p_tipo_id            uuid,
  p_subtipo_id         uuid,
  p_forma_pagamento    forma_pagamento default null,
  p_cartao_credito_id  uuid default null,
  p_valor_baixa        numeric default null,
  p_retencoes          jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
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
  v_lancamento_id  uuid;
  v_descricao      text;
  v_res            record;
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
    if public._documento_em_remessa(p_parcela_id) then
      raise exception 'Pago pela remessa com o valor cheio: esta parcela só aceita a baixa do que falta, sem retenção.';
    end if;
  end if;

  select count(*)::int into v_total from public.pedidos_compra_parcelas where pedido_compra_id = v_pp.id;

  if p_forma_pagamento = 'cartao_credito' then
    if v_baixado > 0 then
      raise exception 'Esta parcela já tem baixa parcial: o restante não vai para o cartão.';
    end if;

    v_descricao := 'Cartão · PP ' || v_pp.codigo || ' ' || v_parcela.numero || '/' || v_total
                   || ' — ' || substring(v_pp.servico, 1, 140);

    select * into v_res from public.cartao_lancar_item(
      v_pp.tenant_id, v_pp.empresa_id, p_cartao_credito_id, p_pago_em,
      v_parcela.valor, 'saida', v_descricao,
      p_tipo_id, p_subtipo_id,
      v_pp.fornecedor_id, null, v_pp.job_id,
      null, v_pp.id, v_parcela.id, null, null,
      'pp_baixa', 'item', v_uid, null
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

revoke all on function public.baixar_parcela_pp(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb) from public, anon;
grant execute on function public.baixar_parcela_pp(uuid, date, uuid, uuid, uuid, forma_pagamento, uuid, numeric, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 7. As funções antigas de baixa passam a baixar o que falta
-- ---------------------------------------------------------------------
-- Mesma assinatura, para nenhum chamador quebrar. Antes, num documento
-- já com baixa parcial, elas lançariam o valor cheio de novo. O
-- `p_criado_por` vindo do cliente é ignorado: quem baixa é a sessão.

create or replace function public.dar_baixa_titulo_com_plano(
  p_titulo_id uuid, p_pago_em date, p_conta_bancaria_id uuid,
  p_tipo_id uuid, p_subtipo_id uuid, p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.baixar_titulo_receber(
    p_titulo_id, p_pago_em, p_conta_bancaria_id, p_tipo_id, p_subtipo_id, null, '[]'::jsonb
  );
end;
$$;

create or replace function public.dar_baixa_avulsa_com_plano(
  p_conta_avulsa_id uuid, p_pago_em date, p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid,
  p_forma_pagamento forma_pagamento, p_cartao_credito_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.baixar_conta_avulsa(
    p_conta_avulsa_id, p_pago_em, p_conta_bancaria_id,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    p_forma_pagamento, p_cartao_credito_id, null, '[]'::jsonb
  );
end;
$$;

create or replace function public.dar_baixa_avulsa(
  p_conta_avulsa_id uuid, p_pago_em date, p_conta_bancaria_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_avulsa contas_avulsas%rowtype;
begin
  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;
  return public.baixar_conta_avulsa(
    p_conta_avulsa_id, p_pago_em, p_conta_bancaria_id,
    v_avulsa.plano_conta_tipo_id, v_avulsa.plano_conta_subtipo_id,
    null, null, null, '[]'::jsonb
  );
end;
$$;

create or replace function public.dar_baixa_pp_parcela(
  p_parcela_id uuid, p_pago_em date, p_conta_bancaria_id uuid,
  p_plano_conta_tipo_id uuid, p_plano_conta_subtipo_id uuid, p_criado_por uuid,
  p_forma_pagamento forma_pagamento, p_cartao_credito_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.baixar_parcela_pp(
    p_parcela_id, p_pago_em, p_conta_bancaria_id,
    p_plano_conta_tipo_id, p_plano_conta_subtipo_id,
    p_forma_pagamento, p_cartao_credito_id, null, '[]'::jsonb
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Cancelar UMA baixa (decisão 120, agora por lançamento)
-- ---------------------------------------------------------------------

create or replace function public.cancelar_baixa_lancamento(p_lancamento_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid       uuid;
  v_baixa     lancamentos_financeiros%rowtype;
  v_titulo    titulos_receber%rowtype;
  v_fat       faturamentos%rowtype;
  v_parcela   pedidos_compra_parcelas%rowtype;
  v_pp        pedidos_compra%rowtype;
  v_avulsa    contas_avulsas%rowtype;
  v_fatura    faturas_cartao%rowtype;
  v_cartao    boolean;
  v_retidos   jsonb;
  v_estornos  jsonb;
begin
  select * into v_baixa from public.lancamentos_financeiros where id = p_lancamento_id;
  if not found then raise exception 'Baixa não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_baixa.tenant_id);

  if v_baixa.origem not in ('titulo_baixa', 'pp_baixa', 'avulsa_baixa')
     or (v_baixa.origem = 'pp_baixa' and v_baixa.pedido_compra_parcela_id is null) then
    raise exception 'Esta baixa se cancela pelo documento dela (origem %).', v_baixa.origem;
  end if;

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  -- Trava o documento antes do lançamento, na mesma ordem das funções de
  -- baixa, para as duas nunca se esperarem em ciclo.
  if v_baixa.origem = 'titulo_baixa' then
    select * into v_titulo from public.titulos_receber where id = v_baixa.titulo_receber_id for update;
  elsif v_baixa.origem = 'pp_baixa' then
    select * into v_parcela from public.pedidos_compra_parcelas where id = v_baixa.pedido_compra_parcela_id for update;
    select * into v_pp from public.pedidos_compra where id = v_parcela.pedido_compra_id;
  else
    select * into v_avulsa from public.contas_avulsas where id = v_baixa.conta_avulsa_id for update;
    if v_avulsa.estorno_de_avulsa_id is not null then
      raise exception 'Estorno de compra não tem baixa própria para cancelar.';
    end if;
  end if;

  select * into v_baixa from public.lancamentos_financeiros where id = p_lancamento_id for update;
  if not found then raise exception 'Baixa não encontrada.'; end if;

  v_cartao := v_baixa.papel_na_fatura in ('item', 'ajuste') and v_baixa.fatura_cartao_id is not null;
  if v_cartao then
    select * into v_fatura from public.faturas_cartao where id = v_baixa.fatura_cartao_id;
    if v_fatura.status <> 'aberta' then
      raise exception
        'Este item está na fatura %, que já está %. Reabra a fatura (ou cancele o pagamento dela) antes de desfazer esta baixa.',
        v_fatura.codigo, v_fatura.status;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('imposto', r.imposto, 'aliquota', r.aliquota, 'valor', r.valor)
                            order by r.imposto), '[]'::jsonb)
    into v_retidos
    from public.baixas_retencoes r
   where r.lancamento_id = v_baixa.id;

  -- Toda baixa cancelada reabre o documento: a baixa nunca passa do que
  -- falta, então sem ela a soma fica abaixo do valor.
  if v_baixa.origem = 'titulo_baixa' then
    update public.titulos_receber
       set status = 'em_aberto',
           pago_em = null,
           pago_por = null,
           conta_bancaria_recebimento_id = null,
           lancamento_id = null
     where id = v_titulo.id
       and status = 'pago';

    select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;
    update public.itens_bv
       set situacao = 'confirmado'
     where situacao = 'recebido'
       and (
         id in (
           select fi.origem_id from public.faturamento_itens fi
            where fi.faturamento_id = v_titulo.faturamento_id
              and fi.origem_tipo = 'bv'
         )
         or (v_fat.origem_tipo = 'bv' and id = v_fat.origem_id)
       );
  elsif v_baixa.origem = 'pp_baixa' then
    update public.pedidos_compra_parcelas
       set pago_em = null,
           pago_por = null,
           fatura_cartao_id = case when v_cartao then null else fatura_cartao_id end
     where id = v_parcela.id;

    if v_pp.status = 'pago' then
      update public.pedidos_compra
         set status = 'aprovada', pago_em = null, pago_por = null
       where id = v_pp.id;
    end if;
  else
    update public.contas_avulsas
       set status = 'aprovada',
           pago_em = null,
           pago_por = null,
           conta_bancaria_baixa_id = null,
           fatura_cartao_id = case when v_cartao then null else fatura_cartao_id end
     where id = v_avulsa.id;
  end if;

  -- Os retidos saem junto, pela FK em cascata.
  v_estornos := public._apagar_lancamento_de_baixa(v_baixa.id);

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_baixa.tenant_id,
    case v_baixa.origem when 'titulo_baixa' then 'titulo_receber'
                        when 'pp_baixa' then 'pedido_compra'
                        else 'conta_avulsa' end,
    case v_baixa.origem when 'titulo_baixa' then v_titulo.id::text
                        when 'pp_baixa' then v_pp.id::text
                        else v_avulsa.id::text end,
    case v_baixa.origem when 'titulo_baixa' then 'titulo.baixa_cancelada'
                        when 'pp_baixa' then 'pedido_compra.parcela_baixa_cancelada'
                        else 'conta_avulsa.baixa_cancelada' end,
    v_uid,
    jsonb_build_object(
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_baixa.id,
      'data_movimento', v_baixa.data_movimento,
      'valor', v_baixa.valor,
      'retidos_apagados', v_retidos,
      'conta_bancaria_id', v_baixa.conta_bancaria_id,
      'parcela_id', v_parcela.id,
      'parcela_numero', v_parcela.numero,
      'pp_codigo', v_pp.codigo,
      'avulsa_codigo', v_avulsa.codigo,
      'numero_parcela_titulo', v_titulo.numero_parcela,
      'fatura', v_fatura.codigo,
      'estornos_apagados', v_estornos
    )
  );

  return v_baixa.id;
end;
$$;

revoke all on function public.cancelar_baixa_lancamento(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_lancamento(uuid, text) to authenticated;

-- As de antes, por documento, cancelam a baixa mais recente.

create or replace function public.cancelar_baixa_titulo_receber(p_titulo_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.lancamentos_financeiros
   where titulo_receber_id = p_titulo_id and origem = 'titulo_baixa'
   order by data_movimento desc, created_at desc
   limit 1;
  if v_id is null then raise exception 'Este título não tem baixa para cancelar.'; end if;
  return public.cancelar_baixa_lancamento(v_id, p_motivo);
end;
$$;

create or replace function public.cancelar_baixa_pp_parcela(p_parcela_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.lancamentos_financeiros
   where pedido_compra_parcela_id = p_parcela_id and origem = 'pp_baixa'
   order by data_movimento desc, created_at desc
   limit 1;
  if v_id is null then raise exception 'Esta parcela não tem baixa para cancelar.'; end if;
  return public.cancelar_baixa_lancamento(v_id, p_motivo);
end;
$$;

create or replace function public.cancelar_baixa_avulsa(p_conta_avulsa_id uuid, p_motivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.lancamentos_financeiros
   where conta_avulsa_id = p_conta_avulsa_id and origem = 'avulsa_baixa'
   order by data_movimento desc, created_at desc
   limit 1;
  if v_id is null then raise exception 'Esta conta não tem baixa para cancelar.'; end if;
  return public.cancelar_baixa_lancamento(v_id, p_motivo);
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Travas que só olhavam "pago" passam a ver a baixa parcial
-- ---------------------------------------------------------------------

create or replace function public.cancelar_faturamento(
  p_faturamento_id uuid, p_motivo text, p_cancelado_por uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fat       faturamentos%rowtype;
  v_qtd_pagos integer;
  v_bv        record;
begin
  if p_motivo is null or length(trim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_fat from public.faturamentos where id = p_faturamento_id;
  if not found then raise exception 'Faturamento não encontrado.'; end if;
  if not public.is_tenant_member(v_fat.tenant_id) then
    raise exception 'Sem acesso a este faturamento.';
  end if;
  if v_fat.status <> 'emitido' then
    raise exception 'Faturamento já está cancelado.';
  end if;

  -- Título com qualquer baixa, inteira ou parcial (decisão 125).
  select count(distinct t.id) into v_qtd_pagos
    from public.titulos_receber t
    join public.lancamentos_financeiros l
      on l.titulo_receber_id = t.id and l.origem = 'titulo_baixa'
   where t.faturamento_id = p_faturamento_id;

  if v_qtd_pagos > 0 then
    raise exception 'Existem % títulos com baixa. Cancele as baixas antes de cancelar a NF.', v_qtd_pagos;
  end if;

  if exists (
    select 1
      from public.faturamento_itens fi
      join public.saves_consumos sc on sc.job_origem_id = fi.origem_id
      join public.jobs_itens_orcado oc on oc.id = sc.job_item_orcado_id
      join public.jobs jc on jc.id = oc.job_id
     where fi.faturamento_id = p_faturamento_id
       and fi.origem_tipo = 'save'
       and jc.status in ('encerrado', 'finalizado')
  ) then
    raise exception 'Esta nota carrega saldo em save que já foi consumido por job encerrado. Cancelá-la reescreveria a margem de um job que já está congelado.';
  end if;

  update public.titulos_receber
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por
   where faturamento_id = p_faturamento_id
     and status = 'em_aberto';

  update public.faturamentos
     set status = 'cancelado',
         cancelado_em = now(),
         cancelado_por = p_cancelado_por,
         motivo_cancelamento = p_motivo
   where id = p_faturamento_id;

  for v_bv in
    select fi.origem_id from public.faturamento_itens fi
     where fi.faturamento_id = p_faturamento_id and fi.origem_tipo = 'bv'
  loop
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_bv.origem_id and situacao = 'recebido';
  end loop;

  if v_fat.origem_tipo = 'bv' and v_fat.origem_id is not null then
    update public.itens_bv
       set situacao = 'confirmado'
     where id = v_fat.origem_id and situacao = 'recebido';
  end if;
end;
$$;

create or replace function public.reprovar_pp_aprovada(p_pp_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_pp       pedidos_compra%rowtype;
  v_papel    text;
  v_pagas    integer;
  v_fatura   text;
begin
  if p_motivo is null or char_length(btrim(p_motivo)) < 10 then
    raise exception 'Motivo precisa ter pelo menos 10 caracteres.';
  end if;

  select * into v_pp from public.pedidos_compra where id = p_pp_id for update;
  if not found then raise exception 'PP não encontrada.'; end if;

  select tm.role::text into v_papel
    from public.tenant_members tm
    join public.profiles p on p.id = tm.user_id
   where tm.user_id = v_uid
     and tm.tenant_id = v_pp.tenant_id
     and tm.status = 'ativo'
     and p.ativo = true;
  if v_papel is null then raise exception 'Sem acesso a esta PP.'; end if;
  if v_papel not in ('administrador', 'financeiro') then
    raise exception 'Só o financeiro ou um administrador reprova uma PP aprovada.';
  end if;

  if v_pp.status <> 'aprovada' then
    raise exception 'Só PP aprovada pode ser reprovada (status atual: %).', v_pp.status;
  end if;

  -- Parcela paga ou com baixa parcial (decisão 125).
  select count(*) into v_pagas
    from public.pedidos_compra_parcelas par
   where par.pedido_compra_id = p_pp_id
     and (
       par.pago_em is not null
       or exists (
         select 1 from public.lancamentos_financeiros l
          where l.pedido_compra_parcela_id = par.id and l.origem = 'pp_baixa'
       )
     );
  if v_pagas > 0 then
    raise exception 'A PP já tem % parcela(s) com baixa. Cancele as baixas antes de reprovar.', v_pagas;
  end if;

  select f.codigo into v_fatura
    from public.pedidos_compra_parcelas par
    join public.faturas_cartao f on f.id = par.fatura_cartao_id
   where par.pedido_compra_id = p_pp_id
     and f.status <> 'aberta'
   limit 1;
  if v_fatura is not null then
    raise exception 'Uma parcela está na fatura % do cartão, que não está aberta. Reabra a fatura antes de reprovar.', v_fatura;
  end if;

  update public.pedidos_compra_parcelas
     set fatura_cartao_id        = null,
         data_pagamento          = null,
         data_pagamento_primeira = null
   where pedido_compra_id = p_pp_id;

  update public.pedidos_compra
     set status                     = 'rejeitada',
         rejeitada_por              = v_uid,
         rejeitada_em               = now(),
         motivo_rejeicao            = btrim(p_motivo),
         aprovada_em                = null,
         aprovada_por               = null,
         anexos_na_aprovacao        = null,
         prazo_pagamento_financeiro = null,
         forma_pagamento            = null,
         cartao_credito_id          = null,
         plano_conta_tipo_id        = null,
         plano_conta_subtipo_id     = null
   where id = p_pp_id;
end;
$$;

create or replace function public.rotear_pp_para_cartao(
  p_pp_id uuid, p_cartao_id uuid, p_tipo_id uuid, p_subtipo_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pp        pedidos_compra%rowtype;
  v_cartao    cartoes_credito%rowtype;
  v_parcela   record;
  v_subtipo   uuid;
  v_roteadas  integer := 0;
begin
  select * into v_pp from pedidos_compra where id = p_pp_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  if not is_tenant_member(v_pp.tenant_id) then
    raise exception 'Sem permissão nesta PP.';
  end if;

  if v_pp.status <> 'aprovada' then
    raise exception 'Só PP aprovada vai para o cartão (status atual: %).', v_pp.status;
  end if;

  select * into v_cartao from cartoes_credito where id = p_cartao_id;
  if not found then raise exception 'Cartão não encontrado.'; end if;
  if v_cartao.tenant_id <> v_pp.tenant_id then
    raise exception 'Cartão de outro tenant.';
  end if;
  if not v_cartao.ativo then raise exception 'Cartão está inativo.'; end if;

  select tipo_id into v_subtipo from plano_contas_subtipos where id = p_subtipo_id;
  if not found then raise exception 'Subtipo não encontrado.'; end if;
  if v_subtipo <> p_tipo_id then
    raise exception 'Subtipo não pertence ao tipo escolhido.';
  end if;

  -- Parcela com baixa parcial não vai para o cartão: a fatura levaria o
  -- valor cheio (decisão 125).
  if exists (
    select 1
      from pedidos_compra_parcelas par
      join lancamentos_financeiros l
        on l.pedido_compra_parcela_id = par.id and l.origem = 'pp_baixa'
     where par.pedido_compra_id = p_pp_id
       and par.pago_em is null
  ) then
    raise exception 'Uma parcela desta PP já tem baixa parcial: o restante não vai para o cartão.';
  end if;

  update pedidos_compra
     set forma_pagamento = 'cartao_credito',
         cartao_credito_id = p_cartao_id,
         plano_conta_tipo_id = p_tipo_id,
         plano_conta_subtipo_id = p_subtipo_id
   where id = p_pp_id;

  for v_parcela in
    select * from pedidos_compra_parcelas
     where pedido_compra_id = p_pp_id
       and pago_em is null
     order by numero
  loop
    update pedidos_compra_parcelas
       set fatura_cartao_id = public.garantir_fatura_aberta_do_cartao(
             p_cartao_id,
             coalesce(v_parcela.data_pagamento, v_parcela.data_vencimento)
           )
     where id = v_parcela.id;

    v_roteadas := v_roteadas + 1;
  end loop;

  return v_roteadas;
end;
$$;

create or replace function public.excluir_titulo_receber_avulso(p_conta_avulsa_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid;
  v_avulsa  contas_avulsas%rowtype;
begin
  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id for update;
  if not found or v_avulsa.tipo_entrada is null then
    raise exception 'Título não encontrado.';
  end if;

  v_uid := public._baixa_exige_financeiro(v_avulsa.tenant_id);

  if v_avulsa.status <> 'aprovada' then
    raise exception 'Este título já foi recebido. Para excluir, cancele a baixa antes.';
  end if;
  if exists (
    select 1 from public.lancamentos_financeiros
     where conta_avulsa_id = p_conta_avulsa_id and origem = 'avulsa_baixa'
  ) then
    raise exception 'Este título já tem baixa parcial. Para excluir, cancele as baixas antes.';
  end if;

  delete from public.contas_avulsas where id = p_conta_avulsa_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_avulsa.tenant_id, 'conta_avulsa', v_avulsa.id::text,
    'conta_avulsa.excluida', v_uid,
    jsonb_build_object(
      'codigo', v_avulsa.codigo,
      'tipo_entrada', v_avulsa.tipo_entrada,
      'descricao', v_avulsa.descricao,
      'valor', v_avulsa.valor,
      'empresa_id', v_avulsa.empresa_id,
      'data_prevista', v_avulsa.data_prevista_pagamento
    )
  );
end;
$$;
