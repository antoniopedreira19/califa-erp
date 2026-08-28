-- =====================================================================
-- Compra parcelada no cartão
--
-- Uma compra em 3x cai em três faturas seguidas. Isso já é exatamente o
-- que `fatura_aberta_do_cartao` faz com a data da compra — só faltava
-- gerar as três linhas com as datas certas.
--
-- ── Por que N avulsas, e não uma tabela de parcelas ─────────────────
--
-- A PP tem `pedidos_compra_parcelas` porque a PP é um documento só que se
-- paga em pedaços. No cartão é diferente: cada parcela É uma linha da
-- fatura daquele mês, com valor próprio, competência própria e
-- lançamento próprio. Uma tabela de parcelas obrigaria o fechamento, a
-- aba Cartão, os totais e a Conciliação a unir duas fontes — e todas
-- essas já sabem lidar com avulsa.
--
-- Então: a compra em 3x nasce como TRÊS avulsas irmãs, cada uma com
-- `data_compra` um mês à frente da anterior. O gatilho da fatura faz o
-- resto sozinho.
--
-- A primeira é a CABEÇA (`parcela_numero = 1`, sem `parcela_de_avulsa_id`)
-- e as outras apontam para ela. É na cabeça que o estorno se prende.
--
-- ── O resto da divisão vai na primeira ──────────────────────────────
--
-- R$ 100 em 3x = 33,34 + 33,33 + 33,33. O centavo sobrando vai na
-- primeira, que é a convenção das operadoras e evita que a soma das
-- parcelas fique menor que a compra.
--
-- ── Estorno de compra parcelada ─────────────────────────────────────
--
-- Regra do Tiago, 29/08/2026: "o estorno aconteceria inteiro e as
-- parcelas continuariam pagas". O estorno aponta para a CABEÇA e o teto
-- dele é o total do GRUPO — não o valor de uma parcela. As parcelas já
-- pagas seguem pagas; o crédito cai na fatura aberta do dia e abate o
-- que vier.
-- =====================================================================

alter table public.contas_avulsas
  add column if not exists parcela_numero smallint not null default 1,
  add column if not exists parcela_total  smallint not null default 1,
  add column if not exists parcela_de_avulsa_id uuid
    references public.contas_avulsas(id) on delete restrict;

comment on column public.contas_avulsas.parcela_de_avulsa_id is
  'A primeira parcela (cabeça) desta compra parcelada. Null na própria cabeça e na compra à vista.';

create index if not exists idx_avulsas_parcela_de
  on public.contas_avulsas (parcela_de_avulsa_id)
  where parcela_de_avulsa_id is not null;

alter table public.contas_avulsas
  drop constraint if exists chk_avulsa_parcela_coerente;
alter table public.contas_avulsas
  add constraint chk_avulsa_parcela_coerente check (
    parcela_numero >= 1
    and parcela_total >= parcela_numero
    -- A cabeça é a 1 e não aponta para ninguém; da 2 em diante aponta.
    and (
      (parcela_numero = 1 and parcela_de_avulsa_id is null)
      or (parcela_numero > 1 and parcela_de_avulsa_id is not null)
    )
    -- Parcelamento só existe no cartão: fora dele, quem parcela é a PP,
    -- que tem tabela própria.
    and (parcela_total = 1 or forma_pagamento = 'cartao_credito')
    -- Estorno não se parcela: ele é um crédito único.
    and (parcela_total = 1 or estorno_de_avulsa_id is null)
  );

-- ---------------------------------------------------------------------
-- O estorno mede o teto pelo GRUPO, não pela parcela
-- ---------------------------------------------------------------------
create or replace function public.avulsa_estorno_herda_da_compra()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_compra        contas_avulsas%rowtype;
  v_total_compra  numeric;
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

  -- O estorno se prende à CABEÇA da compra parcelada, nunca a uma
  -- parcela: a compra em 3x estornada por inteiro é UM estorno do valor
  -- cheio (29/08/2026).
  if v_compra.parcela_de_avulsa_id is not null then
    raise exception
      'Aponte o estorno para a primeira parcela da compra (%/% desta), não para uma parcela do meio.',
      v_compra.parcela_numero, v_compra.parcela_total;
  end if;

  if v_compra.forma_pagamento is distinct from 'cartao_credito'
     or v_compra.cartao_credito_id is null then
    raise exception 'Só compra feita no cartão pode ser estornada por aqui.';
  end if;

  if new.cartao_credito_id is distinct from v_compra.cartao_credito_id then
    raise exception 'O estorno tem que ser no mesmo cartão da compra.';
  end if;

  -- Total da compra = a cabeça mais as irmãs dela. Na compra à vista o
  -- segundo termo é zero.
  select v_compra.valor + coalesce(sum(p.valor), 0)
    into v_total_compra
    from contas_avulsas p
   where p.parcela_de_avulsa_id = v_compra.id;

  select coalesce(sum(e.valor), 0) into v_ja_estornado
    from contas_avulsas e
   where e.estorno_de_avulsa_id = v_compra.id
     and e.id is distinct from new.id;

  v_disponivel := v_total_compra - v_ja_estornado;

  if new.valor > v_disponivel + 0.005 then
    raise exception
      'A compra % é de % e já tem % estornado — sobram % para estornar.',
      coalesce(v_compra.codigo, '(sem código)'),
      to_char(v_total_compra, 'FM999999999990.00'),
      to_char(v_ja_estornado, 'FM999999999990.00'),
      to_char(v_disponivel,   'FM999999999990.00');
  end if;

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

revoke execute on function public.avulsa_estorno_herda_da_compra() from public;

-- ---------------------------------------------------------------------
-- Criar a compra parcelada
-- ---------------------------------------------------------------------
--
-- Fica no banco, e não na action, porque as N linhas têm que nascer numa
-- transação só: três parcelas com a segunda faltando é pior do que
-- nenhuma. A action monta a cabeça e chama isto para as irmãs.
create or replace function public.parcelar_compra_cartao(
  p_cabeca_id uuid,
  p_parcelas smallint
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cabeca   contas_avulsas%rowtype;
  v_total    numeric;
  v_base     numeric;
  v_resto    numeric;
  v_data     date;
  v_criadas  integer := 0;
  n          smallint;
begin
  if p_parcelas is null or p_parcelas < 2 then
    raise exception 'Parcelamento começa em 2 vezes.';
  end if;
  if p_parcelas > 36 then
    raise exception 'No máximo 36 parcelas.';
  end if;

  select * into v_cabeca from contas_avulsas where id = p_cabeca_id;
  if not found then raise exception 'Compra não encontrada.'; end if;

  if not is_tenant_member(v_cabeca.tenant_id) then
    raise exception 'Sem permissão nesta compra.';
  end if;

  if v_cabeca.forma_pagamento is distinct from 'cartao_credito' then
    raise exception 'Só compra no cartão se parcela por aqui.';
  end if;
  if v_cabeca.parcela_total <> 1 or v_cabeca.parcela_de_avulsa_id is not null then
    raise exception 'Esta compra já está parcelada.';
  end if;
  if v_cabeca.estorno_de_avulsa_id is not null then
    raise exception 'Estorno não se parcela.';
  end if;
  if v_cabeca.status <> 'aprovada' then
    raise exception 'Compra já baixada não se parcela.';
  end if;

  -- O valor que veio na cabeça é o TOTAL da compra; ele vira a primeira
  -- parcela e as outras saem daqui.
  v_total := v_cabeca.valor;
  v_base  := trunc(v_total / p_parcelas, 2);
  -- O que sobrou da divisão vai na primeira, convenção das operadoras.
  v_resto := v_total - (v_base * p_parcelas);

  update contas_avulsas
     set valor = v_base + v_resto,
         parcela_numero = 1,
         parcela_total = p_parcelas
   where id = p_cabeca_id;

  v_data := coalesce(v_cabeca.data_compra, current_date);

  for n in 2..p_parcelas loop
    insert into contas_avulsas (
      tenant_id, codigo, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, data_pagamento, data_pagamento_primeira,
      aprovada_em, aprovada_por, criado_por,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id,
      -- Uma competência por parcela: o gatilho da fatura faz o resto.
      data_compra,
      parcela_numero, parcela_total, parcela_de_avulsa_id
    ) values (
      v_cabeca.tenant_id, public.gerar_codigo_avulsa(v_cabeca.tenant_id),
      v_cabeca.empresa_id, v_cabeca.descricao, v_base, v_cabeca.natureza,
      -- As três datas são reescritas pelo gatilho da fatura; entram aqui
      -- só porque a inserção acontece antes dele.
      v_data, v_data, v_data,
      v_cabeca.aprovada_em, v_cabeca.aprovada_por, v_cabeca.criado_por,
      v_cabeca.fornecedor_id, v_cabeca.cliente_id, v_cabeca.job_id,
      v_cabeca.plano_conta_tipo_id, v_cabeca.plano_conta_subtipo_id,
      'cartao_credito', v_cabeca.cartao_credito_id,
      (v_data + make_interval(months => (n - 1)::int))::date,
      n, p_parcelas, p_cabeca_id
    );

    v_criadas := v_criadas + 1;
  end loop;

  -- Copia o rateio da cabeça para todas as irmãs de uma vez. Sem isso a
  -- parcela some da coluna Regional da Conciliação enquanto a primeira
  -- aparece nela.
  insert into contas_avulsas_regionais (
    tenant_id, conta_avulsa_id, regional_id, percentual
  )
  select v_cabeca.tenant_id, filha.id, r.regional_id, r.percentual
    from contas_avulsas filha
    join contas_avulsas_regionais r on r.conta_avulsa_id = p_cabeca_id
   where filha.parcela_de_avulsa_id = p_cabeca_id;

  return v_criadas;
end;
$function$;

revoke execute on function public.parcelar_compra_cartao(uuid, smallint) from public;
grant  execute on function public.parcelar_compra_cartao(uuid, smallint) to authenticated;
