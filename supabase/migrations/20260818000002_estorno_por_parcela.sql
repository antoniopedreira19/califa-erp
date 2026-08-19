-- ---------------------------------------------------------------------
-- Estorno da baixa passa a ser POR PARCELA (decisão do Tiago, 18/08/2026)
-- ---------------------------------------------------------------------
--
-- A decisão 016 mudou a unidade de pagamento da PP para a PARCELA:
-- `dar_baixa_pp_parcela` marca uma parcela e só promove a PP a `pago`
-- quando a última cai. O ESTORNO ficou para trás — continuou sendo o
-- `estornar_baixa_pp`, escrito quando uma PP tinha uma baixa só.
--
-- O Tiago fechou a regra em 18/08/2026, respondendo à pergunta que a
-- verificação levantou:
--
--   "As PPs sempre chegarão 'por parcela' no contas a pagar e cada baixa
--    ou estorno deverá ser feito por parcela. Porém, quanto à aprovação,
--    essa deverá ser feita por PP, e criar os títulos referentes a cada
--    parcela em títulos a pagar."
--
-- Aprovação por PP e títulos por parcela já era o comportamento de
-- `aprovar_pp_com_data` — nada muda ali. O que faltava era o estorno.
--
-- ⚠️ O PERIGO QUE ISTO DESARMA. A função antiga pegava
-- `limit 1` dos lançamentos de baixa da PP, criava UM reverso e devolvia
-- a PP a `aprovada` — **sem limpar `pago_em` das parcelas**. Numa PP de 3
-- parcelas pagas, o resultado seria uma PP "aprovada" com as 3 parcelas
-- ainda marcadas como pagas e só um lançamento revertido: dinheiro
-- descrito de duas formas ao mesmo tempo. Ela não tem porta na UI desde
-- a decisão 016, mas é uma função `security definer` com `execute` para
-- `authenticated` — alcançável, portanto. Em vez de deixá-la armada, ela
-- passa a recusar apontando para a substituta.

-- ---------------------------------------------------------------------
-- 1. estornar_baixa_pp_parcela — o estorno na granularidade da baixa
-- ---------------------------------------------------------------------

create or replace function public.estornar_baixa_pp_parcela(
  p_parcela_id uuid,
  p_motivo     text,
  p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parcela    pedidos_compra_parcelas%rowtype;
  v_pp         pedidos_compra%rowtype;
  v_original   lancamentos_financeiros%rowtype;
  v_total      integer;
  v_reverso_id uuid;
  v_descricao  text;
begin
  select * into v_parcela
    from public.pedidos_compra_parcelas where id = p_parcela_id;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  if not public.is_tenant_member(v_parcela.tenant_id) then
    raise exception 'Sem acesso a esta parcela.';
  end if;

  if v_parcela.pago_em is null then
    raise exception 'Esta parcela não está paga.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do estorno.';
  end if;

  select * into v_pp
    from public.pedidos_compra where id = v_parcela.pedido_compra_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  -- O lançamento ATIVO desta parcela. `uniq_baixa_ativa_por_parcela`
  -- (migration 20260818000001) garante que existe no máximo um.
  select * into v_original
    from public.lancamentos_financeiros
   where pedido_compra_parcela_id = p_parcela_id
     and origem = 'pp_baixa';
  if not found then
    raise exception 'Lançamento da baixa desta parcela não encontrado.';
  end if;

  select count(*)::int into v_total
    from public.pedidos_compra_parcelas
   where pedido_compra_id = v_pp.id;

  v_descricao := 'Estorno da baixa de ' || v_pp.codigo
                 || ' ' || v_parcela.numero || '/' || v_total
                 || ' — ' || substring(p_motivo, 1, 180);

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, job_id, pedido_compra_id, pedido_compra_parcela_id,
    estorno_de_lancamento_id, origem, criado_por
  ) values (
    v_original.tenant_id, v_original.empresa_id, v_original.conta_bancaria_id,
    current_date, v_original.valor,
    case when v_original.natureza = 'saida' then 'entrada'::natureza_lancamento
         else 'saida'::natureza_lancamento end,
    v_descricao,
    v_original.plano_conta_tipo_id, v_original.plano_conta_subtipo_id,
    v_original.fornecedor_id, v_original.job_id, v_original.pedido_compra_id,
    v_original.pedido_compra_parcela_id,
    v_original.id, 'pp_estorno', p_criado_por
  )
  returning id into v_reverso_id;

  -- O original sai do índice parcial de baixa ativa: a parcela volta a
  -- poder ser baixada.
  update public.lancamentos_financeiros
     set origem = 'pp_baixa_estornada'
   where id = v_original.id;

  update public.pedidos_compra_parcelas
     set pago_em  = null,
         pago_por = null
   where id = p_parcela_id;

  -- A PP volta de `pago` para `aprovada`: se uma parcela foi estornada,
  -- por definição sobrou parcela em aberto. Simétrico à baixa, que só
  -- promove a `pago` quando a última cai.
  if v_pp.status = 'pago' then
    update public.pedidos_compra
       set status   = 'aprovada',
           pago_em  = null,
           pago_por = null
     where id = v_pp.id;
  end if;

  return v_reverso_id;
end;
$$;

comment on function public.estornar_baixa_pp_parcela(uuid, text, uuid) is
  'Estorna a baixa de UMA parcela de PP: gera o lançamento reverso, '
  'devolve a parcela para em aberto e traz a PP de volta a aprovada. '
  'Decisão do Tiago de 18/08/2026 — baixa e estorno são por parcela; '
  'só a aprovação é por PP.';

revoke execute on function public.estornar_baixa_pp_parcela(uuid, text, uuid) from public;
grant  execute on function public.estornar_baixa_pp_parcela(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2. estornar_baixa_pp (PP inteira) — desarmada
-- ---------------------------------------------------------------------
--
-- Não é `drop`: a função é referenciada por comentários e pelo histórico,
-- e derrubá-la calaria qualquer chamador em vez de avisá-lo. Ela passa a
-- recusar, dizendo o que usar no lugar.

create or replace function public.estornar_baixa_pp(
  p_pp_id      uuid,
  p_motivo     text,
  p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception
    'Estorno de PP inteira foi descontinuado em 18/08/2026 — a baixa e o estorno são por parcela. Use estornar_baixa_pp_parcela(parcela_id, motivo, criado_por).';
end;
$$;

comment on function public.estornar_baixa_pp(uuid, text, uuid) is
  'DESCONTINUADA em 18/08/2026. Estornava a PP inteira e deixava as '
  'parcelas marcadas como pagas. Substituída por '
  'estornar_baixa_pp_parcela.';

-- A função descontinuada ainda tinha `execute` para `public` — herança
-- das 13 funções antigas, anterior ao padrão que a Tela 3.2 adotou. Já
-- que ela foi reescrita aqui, a porta fecha junto. Ela só levanta
-- exceção, então o risco era zero; é higiene.
revoke execute on function public.estornar_baixa_pp(uuid, text, uuid) from public;
grant  execute on function public.estornar_baixa_pp(uuid, text, uuid) to authenticated;
