-- =====================================================================
-- Cancelar e estornar baixa, nas duas pontas (decisão 120, Tiago,
-- 28/09/2026)
-- =====================================================================
--
-- Até aqui o botão "Estornar baixa" do popup do olho fazia uma coisa só:
-- marcava o lançamento da baixa como `*_estornada`, inseria o reverso com
-- a data de HOJE e devolvia o título para Em aberto / A pagar. Era, na
-- prática, um cancelamento que deixava duas linhas no extrato.
--
-- O Tiago separou as duas ideias:
--
--   * CANCELAR (D12 a) é a ferramenta de corrigir erro. O lançamento da
--     baixa SAI do extrato — sem linha nova —, o título volta ao estado
--     de antes da baixa, e o log de auditoria guarda quem, quando e por
--     quê. Vale para TODAS as baixas, sem exceção (D17.3): título a
--     receber, parcela de PP, conta avulsa (e recorrência), parcela de
--     desembolso, estorno de verba e fatura de cartão. Os estornos
--     registrados naquela baixa saem junto (o protótipo aprovado diz isso
--     no aviso do cancelamento).
--   * ESTORNAR (D11 a) registra uma transação NOVA, com data, conta e
--     valor escolhidos na hora, e o título continua pago. No receber é
--     receita negativa (sai dinheiro, mesmo centro de custo do
--     recebimento); no pagar é despesa negativa. O valor vai até o que a
--     baixa movimentou menos os estornos anteriores. Não existe estorno
--     de baixa no cartão (o fluxo "Estornar compra" cobre isso) nem da
--     fatura de cartão.
--
-- Cartão (D17.3, resposta de 28/09): cancelar desfaz o último passo e
-- mantém o fluxo atual. Pagamento da fatura cancelado devolve a fatura
-- para `fechada`, como se não tivesse sido paga. Item de cartão numa
-- fatura ABERTA sai da fatura; numa fatura fechada ou paga a regra de
-- hoje continua: "reabra a fatura antes".
--
-- Sem trava de data: até existir o processo de conciliação que marca um
-- período como conferido (pendência registrada), cancelar vale sem
-- limite.
--
-- Estrutura:
--
--   * `lancamentos_financeiros.motivo_estorno` — coluna nova, só do
--     estorno. O estorno antigo guardava o motivo dentro da descrição;
--     o novo precisa do motivo limpo para o popup listar.
--   * `_baixa_exige_financeiro` e `_apagar_lancamento_de_baixa` — ajudantes
--     internos, sem EXECUTE para ninguém de fora.
--   * `cancelar_baixa_*` — uma por tipo de baixa, no mesmo par {tipo, id}
--     que as ações da tela já usam.
--   * `estornar_valor_da_baixa` — pelo id do lançamento da baixa viva.
--
-- As funções `estornar_baixa_*` antigas ficam onde estão (a mudança é
-- aditiva); a tela deixa de chamá-las. `estornar_baixa_desembolso_parcela`
-- está quebrada desde a origem (usa `cancelado_em`, coluna que não existe,
-- e insere `desembolso_estorno` sem `estorno_de_lancamento_id`) — fica
-- registrado aqui e na decisão 120, sem tocar nela.
--
-- Permissão: as funções exigem administrador ou financeiro no próprio
-- banco, a mesma régua da ação (`checarGateFinanceiro`). As antigas só
-- pediam membro do tenant.
-- =====================================================================

alter table public.lancamentos_financeiros
  add column if not exists motivo_estorno text;

comment on column public.lancamentos_financeiros.motivo_estorno is
  'Motivo informado no estorno de uma baixa (decisão 120). Só preenchido nas linhas *_estorno criadas por estornar_valor_da_baixa; o estorno antigo guardava o motivo na descrição.';


-- ---------------------------------------------------------------------
-- Ajudantes internos
-- ---------------------------------------------------------------------

create or replace function public._baixa_exige_financeiro(p_tenant_id uuid)
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
    raise exception 'Apenas admin ou financeiro pode cancelar ou estornar uma baixa.'
      using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

revoke all on function public._baixa_exige_financeiro(uuid) from public, anon, authenticated;

-- Apaga o lançamento de uma baixa e os estornos pendurados nele, e devolve
-- os estornos apagados para o log. Quem chama já soltou as FKs que apontam
-- para o lançamento (`titulos_receber.lancamento_id`,
-- `pp_verba_devolucoes.lancamento_id`): as duas são RESTRICT.
create or replace function public._apagar_lancamento_de_baixa(p_lancamento_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_estornos jsonb;
begin
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', e.id,
               'data', e.data_movimento,
               'valor', e.valor,
               'conta_bancaria_id', e.conta_bancaria_id,
               'motivo', coalesce(e.motivo_estorno, e.descricao)
             ) order by e.created_at
           ),
           '[]'::jsonb
         )
    into v_estornos
    from public.lancamentos_financeiros e
   where e.estorno_de_lancamento_id = p_lancamento_id;

  delete from public.lancamentos_financeiros
   where estorno_de_lancamento_id = p_lancamento_id;

  delete from public.lancamentos_financeiros
   where id = p_lancamento_id;

  return v_estornos;
end;
$$;

revoke all on function public._apagar_lancamento_de_baixa(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- Cancelar: título a receber
-- ---------------------------------------------------------------------

create or replace function public.cancelar_baixa_titulo_receber(
  p_titulo_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid;
  v_titulo   titulos_receber%rowtype;
  v_fat      faturamentos%rowtype;
  v_baixa    lancamentos_financeiros%rowtype;
  v_estornos jsonb;
begin
  select * into v_titulo from public.titulos_receber where id = p_titulo_id for update;
  if not found then raise exception 'Título não encontrado.'; end if;

  v_uid := public._baixa_exige_financeiro(v_titulo.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  if v_titulo.status <> 'pago' then
    raise exception 'Este título não está recebido (situação atual: %).', v_titulo.status;
  end if;

  select * into v_baixa
    from public.lancamentos_financeiros
   where titulo_receber_id = p_titulo_id and origem = 'titulo_baixa'
   for update;
  if not found then raise exception 'Lançamento da baixa deste título não encontrado.'; end if;

  select * into v_fat from public.faturamentos where id = v_titulo.faturamento_id;

  update public.titulos_receber
     set status = 'em_aberto',
         pago_em = null,
         pago_por = null,
         conta_bancaria_recebimento_id = null,
         lancamento_id = null
   where id = p_titulo_id;

  -- A baixa marca o BV como recebido quando a última parcela da nota é
  -- paga (`dar_baixa_titulo_com_plano`). Desfeita a baixa, a nota deixa
  -- de estar quitada e o BV volta a confirmado. O segundo ramo cobre o
  -- modelo antigo, em que a própria nota era o BV.
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

  v_estornos := public._apagar_lancamento_de_baixa(v_baixa.id);

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_titulo.tenant_id, 'titulo_receber', v_titulo.id::text,
    'titulo.baixa_cancelada', v_uid,
    jsonb_build_object(
      'numero_nf', v_fat.numero_nf,
      'parcela', v_titulo.numero_parcela,
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_baixa.id,
      'data_movimento', v_baixa.data_movimento,
      'valor', v_baixa.valor,
      'conta_bancaria_id', v_baixa.conta_bancaria_id,
      'estornos_apagados', v_estornos
    )
  );

  return v_baixa.id;
end;
$$;

revoke all on function public.cancelar_baixa_titulo_receber(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_titulo_receber(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Cancelar: parcela de PP
-- ---------------------------------------------------------------------

create or replace function public.cancelar_baixa_pp_parcela(
  p_parcela_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid;
  v_parcela  pedidos_compra_parcelas%rowtype;
  v_pp       pedidos_compra%rowtype;
  v_baixa    lancamentos_financeiros%rowtype;
  v_fatura   faturas_cartao%rowtype;
  v_estornos jsonb;
begin
  select * into v_parcela from public.pedidos_compra_parcelas where id = p_parcela_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_parcela.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  if v_parcela.pago_em is null then
    raise exception 'Esta parcela não está paga.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_parcela.pedido_compra_id;
  if not found then raise exception 'PP não encontrada.'; end if;

  select * into v_baixa
    from public.lancamentos_financeiros
   where pedido_compra_parcela_id = p_parcela_id and origem = 'pp_baixa'
   for update;
  if not found then raise exception 'Lançamento da baixa desta parcela não encontrado.'; end if;

  -- Item de cartão: a regra de hoje, sem mudança (D17.3).
  if v_baixa.papel_na_fatura = 'item' and v_baixa.fatura_cartao_id is not null then
    select * into v_fatura from public.faturas_cartao where id = v_baixa.fatura_cartao_id;
    if v_fatura.status <> 'aberta' then
      raise exception
        'Esta parcela está na fatura %, que já está %. Reabra a fatura (ou cancele o pagamento dela) antes de desfazer esta baixa.',
        v_fatura.codigo, v_fatura.status;
    end if;
  end if;

  update public.pedidos_compra_parcelas
     set pago_em = null, pago_por = null, fatura_cartao_id = null
   where id = p_parcela_id;

  if v_pp.status = 'pago' then
    update public.pedidos_compra
       set status = 'aprovada', pago_em = null, pago_por = null
     where id = v_pp.id;
  end if;

  v_estornos := public._apagar_lancamento_de_baixa(v_baixa.id);

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_pp.tenant_id, 'pedido_compra', v_pp.id::text,
    'pedido_compra.parcela_baixa_cancelada', v_uid,
    jsonb_build_object(
      'pp_codigo', v_pp.codigo,
      'parcela_id', v_parcela.id,
      'parcela_numero', v_parcela.numero,
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_baixa.id,
      'data_movimento', v_baixa.data_movimento,
      'valor', v_baixa.valor,
      'conta_bancaria_id', v_baixa.conta_bancaria_id,
      'fatura', v_fatura.codigo,
      'estornos_apagados', v_estornos
    )
  );

  return v_baixa.id;
end;
$$;

revoke all on function public.cancelar_baixa_pp_parcela(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_pp_parcela(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Cancelar: conta avulsa (e ocorrência de recorrência)
-- ---------------------------------------------------------------------

create or replace function public.cancelar_baixa_avulsa(
  p_conta_avulsa_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid;
  v_avulsa   contas_avulsas%rowtype;
  v_baixa    lancamentos_financeiros%rowtype;
  v_fatura   faturas_cartao%rowtype;
  v_cartao   boolean;
  v_estornos jsonb;
begin
  select * into v_avulsa from public.contas_avulsas where id = p_conta_avulsa_id for update;
  if not found then raise exception 'Conta avulsa não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_avulsa.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  if v_avulsa.status <> 'baixada' then
    raise exception 'Esta conta não está paga (situação atual: %).', v_avulsa.status;
  end if;

  if v_avulsa.estorno_de_avulsa_id is not null then
    raise exception 'Estorno de compra não tem baixa própria para cancelar.';
  end if;

  select * into v_baixa
    from public.lancamentos_financeiros
   where conta_avulsa_id = p_conta_avulsa_id and origem = 'avulsa_baixa'
   for update;
  if not found then raise exception 'Lançamento da baixa desta conta não encontrado.'; end if;

  v_cartao := v_baixa.papel_na_fatura in ('item', 'ajuste') and v_baixa.fatura_cartao_id is not null;

  if v_cartao then
    select * into v_fatura from public.faturas_cartao where id = v_baixa.fatura_cartao_id;
    if v_fatura.status <> 'aberta' then
      raise exception
        'Este item está na fatura %, que já está %. Reabra a fatura (ou cancele o pagamento dela) antes de desfazer esta baixa.',
        v_fatura.codigo, v_fatura.status;
    end if;
  end if;

  update public.contas_avulsas
     set status = 'aprovada',
         pago_em = null,
         pago_por = null,
         conta_bancaria_baixa_id = null,
         fatura_cartao_id = case when v_cartao then null else fatura_cartao_id end
   where id = p_conta_avulsa_id;

  v_estornos := public._apagar_lancamento_de_baixa(v_baixa.id);

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_avulsa.tenant_id, 'conta_avulsa', v_avulsa.id::text,
    'conta_avulsa.baixa_cancelada', v_uid,
    jsonb_build_object(
      'codigo', v_avulsa.codigo,
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_baixa.id,
      'data_movimento', v_baixa.data_movimento,
      'valor', v_baixa.valor,
      'conta_bancaria_id', v_baixa.conta_bancaria_id,
      'fatura', v_fatura.codigo,
      'estornos_apagados', v_estornos
    )
  );

  return v_baixa.id;
end;
$$;

revoke all on function public.cancelar_baixa_avulsa(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_avulsa(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Cancelar: parcela de desembolso
-- ---------------------------------------------------------------------

create or replace function public.cancelar_baixa_desembolso_parcela(
  p_parcela_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid        uuid;
  v_parcela    desembolsos_parcelas%rowtype;
  v_desembolso desembolsos%rowtype;
  v_baixa      lancamentos_financeiros%rowtype;
  v_fatura     faturas_cartao%rowtype;
  v_estornos   jsonb;
begin
  select * into v_parcela from public.desembolsos_parcelas where id = p_parcela_id for update;
  if not found then raise exception 'Parcela não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_parcela.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  if v_parcela.pago_em is null then
    raise exception 'Esta parcela não está paga.';
  end if;

  select * into v_desembolso from public.desembolsos where id = v_parcela.desembolso_id;
  if not found then raise exception 'Desembolso não encontrado.'; end if;

  select * into v_baixa
    from public.lancamentos_financeiros
   where desembolso_parcela_id = p_parcela_id and origem = 'desembolso_baixa'
   for update;
  if not found then raise exception 'Lançamento da baixa desta parcela não encontrado.'; end if;

  if v_baixa.papel_na_fatura = 'item' and v_baixa.fatura_cartao_id is not null then
    select * into v_fatura from public.faturas_cartao where id = v_baixa.fatura_cartao_id;
    if v_fatura.status <> 'aberta' then
      raise exception
        'Esta parcela está na fatura %, que já está %. Reabra a fatura (ou cancele o pagamento dela) antes de desfazer esta baixa.',
        v_fatura.codigo, v_fatura.status;
    end if;
  end if;

  update public.desembolsos_parcelas
     set pago_em = null, pago_por = null
   where id = p_parcela_id;

  if v_desembolso.status = 'pago' then
    update public.desembolsos
       set status = 'aprovada', pago_em = null, pago_por = null
     where id = v_desembolso.id;
  end if;

  v_estornos := public._apagar_lancamento_de_baixa(v_baixa.id);

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_desembolso.tenant_id, 'desembolso', v_desembolso.id::text,
    'desembolso.parcela_baixa_cancelada', v_uid,
    jsonb_build_object(
      'codigo', v_desembolso.codigo,
      'parcela_id', v_parcela.id,
      'parcela_numero', v_parcela.numero,
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_baixa.id,
      'data_movimento', v_baixa.data_movimento,
      'valor', v_baixa.valor,
      'conta_bancaria_id', v_baixa.conta_bancaria_id,
      'fatura', v_fatura.codigo,
      'estornos_apagados', v_estornos
    )
  );

  return v_baixa.id;
end;
$$;

revoke all on function public.cancelar_baixa_desembolso_parcela(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_desembolso_parcela(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Cancelar: estorno de verba (devolução da produção)
-- ---------------------------------------------------------------------

create or replace function public.cancelar_baixa_devolucao_verba(
  p_devolucao_id uuid,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid;
  v_dev      pp_verba_devolucoes%rowtype;
  v_pp       pedidos_compra%rowtype;
  v_baixa    lancamentos_financeiros%rowtype;
  v_estornos jsonb;
begin
  select * into v_dev from public.pp_verba_devolucoes where id = p_devolucao_id for update;
  if not found then raise exception 'Estorno de verba não encontrado.'; end if;

  v_uid := public._baixa_exige_financeiro(v_dev.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  if v_dev.pago_em is null then
    raise exception 'Este estorno de verba não está baixado.';
  end if;

  select * into v_pp from public.pedidos_compra where id = v_dev.pedido_compra_id;

  select * into v_baixa
    from public.lancamentos_financeiros
   where pp_verba_devolucao_id = p_devolucao_id and origem = 'pp_devolucao_verba'
   for update;
  if not found then raise exception 'Lançamento da baixa deste estorno de verba não encontrado.'; end if;

  update public.pp_verba_devolucoes
     set pago_em = null, pago_por = null, lancamento_id = null
   where id = p_devolucao_id;

  v_estornos := public._apagar_lancamento_de_baixa(v_baixa.id);

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_dev.tenant_id, 'pp_verba_devolucao', v_dev.id::text,
    'pp_verba_devolucao.baixa_cancelada', v_uid,
    jsonb_build_object(
      'pp_codigo', v_pp.codigo,
      'pedido_compra_id', v_dev.pedido_compra_id,
      'motivo', btrim(p_motivo),
      'lancamento_apagado', v_baixa.id,
      'data_movimento', v_baixa.data_movimento,
      'valor', v_baixa.valor,
      'conta_bancaria_id', v_baixa.conta_bancaria_id,
      'estornos_apagados', v_estornos
    )
  );

  return v_baixa.id;
end;
$$;

revoke all on function public.cancelar_baixa_devolucao_verba(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_devolucao_verba(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Cancelar: pagamento da fatura de cartão
-- ---------------------------------------------------------------------
-- O pagamento são duas pernas com a mesma origem (`dar_baixa_fatura_cartao`):
-- a saída na conta bancária e a entrada na conta espelho do cartão. As
-- duas saem, e a fatura volta a `fechada` — o estado de antes de pagar.
-- Pares antigos `fatura_cartao_baixa_estornada` + `fatura_cartao_estorno`
-- são histórico de outra baixa e ficam.

create or replace function public.cancelar_baixa_fatura_cartao(
  p_fatura_id uuid,
  p_motivo text
)
returns uuid[]
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid;
  v_fatura   faturas_cartao%rowtype;
  v_perna    record;
  v_ids      uuid[] := '{}';
  v_pernas   jsonb := '[]'::jsonb;
  v_estornos jsonb;
begin
  select * into v_fatura from public.faturas_cartao where id = p_fatura_id for update;
  if not found then raise exception 'Fatura não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_fatura.tenant_id);

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do cancelamento em pelo menos 10 caracteres.';
  end if;

  if v_fatura.status <> 'paga' then
    raise exception 'Só fatura paga tem baixa para cancelar (situação atual: %).', v_fatura.status;
  end if;

  for v_perna in
    select l.* from public.lancamentos_financeiros l
     where l.fatura_cartao_id = p_fatura_id
       and l.origem = 'fatura_cartao_baixa'
     order by l.created_at
     for update
  loop
    v_estornos := public._apagar_lancamento_de_baixa(v_perna.id);
    v_ids := v_ids || v_perna.id;
    v_pernas := v_pernas || jsonb_build_object(
      'id', v_perna.id,
      'conta_bancaria_id', v_perna.conta_bancaria_id,
      'natureza', v_perna.natureza,
      'data_movimento', v_perna.data_movimento,
      'valor', v_perna.valor,
      'estornos_apagados', v_estornos
    );
  end loop;

  if array_length(v_ids, 1) is null then
    raise exception 'A fatura % está paga mas não tem baixa viva para cancelar.', v_fatura.codigo;
  end if;

  update public.faturas_cartao set status = 'fechada' where id = p_fatura_id;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_fatura.tenant_id, 'fatura_cartao', p_fatura_id::text,
    'fatura_cartao.baixa_cancelada', v_uid,
    jsonb_build_object(
      'codigo', v_fatura.codigo,
      'motivo', btrim(p_motivo),
      'valor', v_fatura.valor_cobrado,
      'lancamentos_apagados', v_pernas
    )
  );

  return v_ids;
end;
$$;

revoke all on function public.cancelar_baixa_fatura_cartao(uuid, text) from public, anon;
grant execute on function public.cancelar_baixa_fatura_cartao(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Estornar: transação nova sobre uma baixa viva
-- ---------------------------------------------------------------------
-- A linha nova herda da baixa tudo o que a classifica — empresa, plano de
-- contas, contraparte, job, regional e o vínculo com a origem (título,
-- PP, avulsa, desembolso, verba) —, com a natureza invertida. Só data,
-- conta e valor são escolhidos na hora. As CHECKs do lançamento já
-- aceitam isso: `*_estorno` exige `estorno_de_lancamento_id`, e os
-- índices "uma baixa viva" só olham `*_baixa`.

create or replace function public.estornar_valor_da_baixa(
  p_lancamento_id uuid,
  p_data date,
  p_conta_bancaria_id uuid,
  p_valor numeric,
  p_motivo text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid       uuid;
  v_baixa     lancamentos_financeiros%rowtype;
  v_conta     contas_bancarias%rowtype;
  v_origem    origem_lancamento;
  v_estornado numeric;
  v_saldo     numeric;
  v_valor     numeric := round(p_valor, 2);
  v_novo      uuid;
begin
  select * into v_baixa from public.lancamentos_financeiros where id = p_lancamento_id for update;
  if not found then raise exception 'Baixa não encontrada.'; end if;

  v_uid := public._baixa_exige_financeiro(v_baixa.tenant_id);

  v_origem := case v_baixa.origem
    when 'titulo_baixa'       then 'titulo_estorno'
    when 'pp_baixa'           then 'pp_estorno'
    when 'avulsa_baixa'       then 'avulsa_estorno'
    when 'desembolso_baixa'   then 'desembolso_estorno'
    when 'pp_devolucao_verba' then 'pp_devolucao_verba_estorno'
    else null
  end;
  if v_origem is null then
    raise exception 'Esta baixa não aceita estorno (origem %).', v_baixa.origem;
  end if;

  if v_baixa.papel_na_fatura is not null
     or v_baixa.fatura_cartao_id is not null
     or v_baixa.forma_pagamento = 'cartao_credito' then
    raise exception 'Baixa no cartão não se estorna por aqui: use Estornar compra, na fatura do cartão.';
  end if;

  if p_motivo is null or length(btrim(p_motivo)) < 10 then
    raise exception 'Explique o motivo do estorno em pelo menos 10 caracteres.';
  end if;

  if p_data is null then
    raise exception 'Informe a data do estorno.';
  end if;
  if p_data < v_baixa.data_movimento then
    raise exception 'O estorno não pode ser anterior à baixa (%).', to_char(v_baixa.data_movimento, 'DD/MM/YYYY');
  end if;

  if v_valor is null or v_valor <= 0 then
    raise exception 'Informe o valor do estorno.';
  end if;

  select coalesce(sum(valor), 0) into v_estornado
    from public.lancamentos_financeiros
   where estorno_de_lancamento_id = v_baixa.id;
  v_saldo := v_baixa.valor - v_estornado;
  if v_valor > v_saldo then
    -- Formato brasileiro na mão: o `to_char` com G/D segue o lc_numeric
    -- do servidor, que não é pt-BR.
    raise exception 'O estorno passa do que esta baixa movimentou: sobram R$ % para estornar.',
      translate(to_char(v_saldo, 'FM999,999,990.00'), ',.', '.,');
  end if;

  select * into v_conta from public.contas_bancarias where id = p_conta_bancaria_id;
  if not found then raise exception 'Conta bancária não encontrada.'; end if;
  if v_conta.tenant_id <> v_baixa.tenant_id then
    raise exception 'Conta bancária de outro tenant.';
  end if;
  if v_conta.cartao_credito_id is not null then
    raise exception 'O estorno sai ou entra numa conta bancária, não no cartão.';
  end if;
  if not v_conta.ativo then raise exception 'Conta bancária está inativa.'; end if;
  if p_data < v_conta.saldo_inicial_data then
    raise exception 'Data do estorno é anterior à data do saldo inicial da conta.';
  end if;

  insert into public.lancamentos_financeiros (
    tenant_id, empresa_id, conta_bancaria_id, data_movimento, valor,
    natureza, descricao, plano_conta_tipo_id, plano_conta_subtipo_id,
    fornecedor_id, cliente_id, job_id, regional_id,
    pedido_compra_id, pedido_compra_parcela_id, conta_avulsa_id,
    titulo_receber_id, desembolso_id, desembolso_parcela_id,
    pp_verba_devolucao_id,
    estorno_de_lancamento_id, origem, motivo_estorno, criado_por
  ) values (
    v_baixa.tenant_id, v_baixa.empresa_id, p_conta_bancaria_id, p_data, v_valor,
    case when v_baixa.natureza = 'saida' then 'entrada' else 'saida' end::natureza_lancamento,
    'Estorno · ' || substring(v_baixa.descricao, 1, 180),
    v_baixa.plano_conta_tipo_id, v_baixa.plano_conta_subtipo_id,
    v_baixa.fornecedor_id, v_baixa.cliente_id, v_baixa.job_id, v_baixa.regional_id,
    v_baixa.pedido_compra_id, v_baixa.pedido_compra_parcela_id, v_baixa.conta_avulsa_id,
    v_baixa.titulo_receber_id, v_baixa.desembolso_id, v_baixa.desembolso_parcela_id,
    v_baixa.pp_verba_devolucao_id,
    v_baixa.id, v_origem, btrim(p_motivo), v_uid
  )
  returning id into v_novo;

  insert into public.audit_events (
    tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata
  ) values (
    v_baixa.tenant_id, 'lancamento_financeiro', v_novo::text,
    'lancamento_financeiro.estorno_de_baixa', v_uid,
    jsonb_build_object(
      'baixa_id', v_baixa.id,
      'origem', v_origem,
      'data_movimento', p_data,
      'valor', v_valor,
      'conta_bancaria_id', p_conta_bancaria_id,
      'motivo', btrim(p_motivo),
      'saldo_antes', v_saldo
    )
  );

  return v_novo;
end;
$$;

revoke all on function public.estornar_valor_da_baixa(uuid, date, uuid, numeric, text) from public, anon;
grant execute on function public.estornar_valor_da_baixa(uuid, date, uuid, numeric, text) to authenticated;
