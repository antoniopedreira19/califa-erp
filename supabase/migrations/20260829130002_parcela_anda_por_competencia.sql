-- =====================================================================
-- A parcela anda por competência, não por mês de calendário
--
-- Bug pego no primeiro teste de parcelamento, minutos depois de aplicar
-- `20260829130001`.
--
-- Como estava: a parcela n nascia com `data_compra` = data da compra +
-- (n−1) meses, e cada uma escolhia a fatura por conta própria. Parece
-- certo e não é, porque `fatura_aberta_do_cartao` ROLA a compra quando a
-- competência dela já fechou — e aí duas parcelas se encontram.
--
-- Foi o que aconteceu: compra de 28/08 em 3x, com a fatura de setembro já
-- paga.
--
--   parcela 1 → competência 25/09 (paga) → rola → 25/10   ← FC-00001
--   parcela 2 → competência 25/10 (aberta)                ← FC-00001  ✗
--   parcela 3 → competência 25/11 (aberta)                ← FC-00002
--
-- Duas parcelas na mesma fatura e uma fatura sem nenhuma. Uma compra em
-- 3x tem que cair em três faturas SEGUIDAS, quaisquer que sejam elas.
--
-- Como fica: cada parcela é ancorada na competência da ANTERIOR. Depois
-- de inserir a parcela n, o gatilho já escolheu a fatura dela; a data da
-- parcela n+1 passa a ser "o dia seguinte ao fechamento dessa fatura",
-- que é exatamente a primeira data que cai na competência seguinte. Se
-- essa também estiver fechada, o rolamento leva adiante — e a n+2 parte
-- de onde a n+1 realmente parou.
-- =====================================================================

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
  v_ancora   date;
  v_nova_id  uuid;
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
  if v_cabeca.fatura_cartao_id is null then
    raise exception 'A compra ainda não entrou numa fatura. Avise o suporte.';
  end if;

  -- O valor que veio na cabeça é o TOTAL da compra; ele vira a primeira
  -- parcela e as outras saem daqui. O resto da divisão vai na primeira,
  -- convenção das operadoras.
  v_total := v_cabeca.valor;
  v_base  := trunc(v_total / p_parcelas, 2);
  v_resto := v_total - (v_base * p_parcelas);

  update contas_avulsas
     set valor = v_base + v_resto,
         parcela_numero = 1,
         parcela_total = p_parcelas
   where id = p_cabeca_id;

  -- Âncora: o dia seguinte ao fechamento da fatura em que a CABEÇA caiu.
  -- É a primeira data que cai na competência seguinte.
  select fc.competencia_fechamento + 1
    into v_ancora
    from faturas_cartao fc
   where fc.id = v_cabeca.fatura_cartao_id;

  for n in 2..p_parcelas loop
    insert into contas_avulsas (
      tenant_id, codigo, empresa_id, descricao, valor, natureza,
      data_prevista_pagamento, data_pagamento, data_pagamento_primeira,
      aprovada_em, aprovada_por, criado_por,
      fornecedor_id, cliente_id, job_id,
      plano_conta_tipo_id, plano_conta_subtipo_id,
      forma_pagamento, cartao_credito_id,
      data_compra,
      parcela_numero, parcela_total, parcela_de_avulsa_id
    ) values (
      v_cabeca.tenant_id, public.gerar_codigo_avulsa(v_cabeca.tenant_id),
      v_cabeca.empresa_id, v_cabeca.descricao, v_base, v_cabeca.natureza,
      -- As três datas são reescritas pelo gatilho da fatura; entram aqui
      -- só porque a inserção acontece antes dele.
      v_ancora, v_ancora, v_ancora,
      v_cabeca.aprovada_em, v_cabeca.aprovada_por, v_cabeca.criado_por,
      v_cabeca.fornecedor_id, v_cabeca.cliente_id, v_cabeca.job_id,
      v_cabeca.plano_conta_tipo_id, v_cabeca.plano_conta_subtipo_id,
      'cartao_credito', v_cabeca.cartao_credito_id,
      v_ancora,
      n, p_parcelas, p_cabeca_id
    )
    returning id into v_nova_id;

    -- Onde esta parcela REALMENTE caiu — pode ter rolado, se a
    -- competência natural dela já estava fechada. A próxima parte daqui.
    select fc.competencia_fechamento + 1
      into v_ancora
      from contas_avulsas a
      join faturas_cartao fc on fc.id = a.fatura_cartao_id
     where a.id = v_nova_id;

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
