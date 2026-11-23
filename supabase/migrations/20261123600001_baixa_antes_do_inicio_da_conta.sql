-- A baixa com data antes do início da conta no sistema (decisão 270; pedido do
-- Tiago em 16/11/2026, "todas as baixas").
--
-- O problema: toda baixa recusava data anterior a `saldo_inicial_data` ("Data
-- do pagamento é anterior à data do saldo inicial da conta."). O financeiro
-- tem PPs, contas e títulos pagos ou recebidos de verdade antes de a conta
-- começar no sistema (03/11 nas contas do recomeço) e, para escapar do erro,
-- deu baixa com data de novembro (PP-00298 em 16/11, PP-00153 e PP-00301 em
-- 19/11): o saldo do sistema ficou abaixo do banco e o dia não fechava.
--
-- A regra (Tiago, 16/11): o mesmo "Confirmar baixa" aceita a data antiga. O
-- lançamento nasce antes do início, então não entra no saldo nem na
-- conciliação, que contam do início (decisões 211 e 254); no Extrato contínuo
-- ele entra antes do início e o "Ajuste de abertura" se recalcula sozinho
-- (decisão 211, 16/11). A baixa fica "a conciliar com o histórico": a ligação
-- com a linha da planilha que registra o pagamento é feita depois, pela
-- função `ligar_baixa_ao_historico`.
--
-- 1. `_conta_da_baixa` (PP, conta avulsa, título a receber, imposto,
--    recebimento antes da NF) deixa de recusar a data antiga. O
--    `app.baixa_pelo_historico` da decisão 261 perde o efeito e fica sem uso.
-- 2. As cinco baixas que tinham a trava própria (desembolso, estorno de verba,
--    fatura do cartão, PP inteira antiga e estorno de baixa) perdem só esse
--    `if`: o resto de cada corpo é o que está em produção, relido aqui e
--    trocado por expressão regular, com a conferência de que o trecho saiu uma
--    vez só. Transferência e mútuo não são baixa e continuam como estão.
-- 3. `_exige_periodo_aberto`: o fechamento da conciliação trava o período do
--    início da conta até o fechamento. Data antes do início não é desse
--    período; sem esta correção, depois de fechar novembro, nenhuma baixa de
--    outubro entraria (nem a da decisão 261).
-- 4. `ligar_baixa_ao_historico(lançamento, linhas)`: a conciliação do
--    histórico. Liga as linhas da planilha (carga ativa `periodo`, `cauda` ou
--    `so_dre`, sem ligação e sem linha do banco, mesma conta e mesmo dia) a uma
--    baixa antes do início, quando somam o valor dela. Ligada a uma linha
--    `periodo`/`cauda`, a baixa sai do Extrato antes do início (não conta duas
--    vezes); ligada a uma linha `so_dre`, continua contando e a linha passa a
--    mostrar a PP (decisões 211 e 261). Cancelar a baixa solta as linhas
--    (FK `on delete set null`).

-- 1. ---------------------------------------------------------------------------
create or replace function public._conta_da_baixa(p_conta_bancaria_id uuid, p_tenant_id uuid, p_data date, p_rotulo text)
 returns contas_bancarias
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    raise exception 'A conta espelho de um cartão não paga título direto — escolha a forma \"cartão de crédito\".';
  end if;
  if not v_conta.ativo then
    raise exception 'Conta bancária está inativa.';
  end if;
  -- Decisão 270: a data antes do início da conta no sistema vale. O
  -- lançamento fica antes do saldo inicial, fora do saldo e da conciliação.
  return v_conta;
end;
$function$;

-- 2. ---------------------------------------------------------------------------
do $$
declare
  v_nome   text;
  v_oid    oid;
  v_def    text;
  v_novo   text;
  v_achou  int;
  v_trecho constant text :=
    E'\\n[ ]*if p_[a-z_]+ < v_conta[a-z_]*\\.saldo_inicial_data then\\n[ ]*raise exception ''Data do [a-z]+ é anterior à data do saldo inicial da conta\\.'';\\n[ ]*end if;';
begin
  foreach v_nome in array array[
    'dar_baixa_desembolso_parcela',
    'dar_baixa_devolucao_verba',
    'dar_baixa_fatura_cartao',
    'dar_baixa_pp',
    'estornar_valor_da_baixa'
  ] loop
    select p.oid into v_oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nome;
    if v_oid is null then
      raise exception 'Função % não encontrada.', v_nome;
    end if;
    v_def := pg_get_functiondef(v_oid);
    select count(*) into v_achou from regexp_matches(v_def, v_trecho, 'g');
    if v_achou <> 1 then
      raise exception 'Função %: a trava do saldo inicial apareceu % vezes (esperado 1).', v_nome, v_achou;
    end if;
    v_novo := regexp_replace(
      v_def, v_trecho,
      E'\n  -- Decisão 270: a data antes do início da conta vale (fica fora do saldo).'
    );
    execute v_novo;
  end loop;
end;
$$;

-- 3. ---------------------------------------------------------------------------
create or replace function public._exige_periodo_aberto(p_conta_id uuid, p_data date)
 returns void
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_ate    date;
  v_inicio date;
begin
  if p_conta_id is null or p_data is null then return; end if;
  v_ate := public._conciliacao_fechada_ate(p_conta_id);
  if v_ate is null or p_data > v_ate then return; end if;
  -- Decisão 270: o fechamento trava do início da conta no sistema até a data
  -- dele. Antes do início é o período do histórico, fora do saldo.
  select saldo_inicial_data into v_inicio from public.contas_bancarias where id = p_conta_id;
  if v_inicio is not null and p_data < v_inicio then return; end if;
  raise exception 'Período fechado até %: reabra a conciliação para mudar esse lançamento.', to_char(v_ate, 'DD/MM')
    using errcode = '55000';
end;
$function$;

-- 4. ---------------------------------------------------------------------------
create or replace function public.ligar_baixa_ao_historico(p_lancamento_id uuid, p_movimento_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_lanc   public.lancamentos_financeiros%rowtype;
  v_conta  public.contas_bancarias%rowtype;
  v_n      integer;
  v_soma   numeric;
  v_valor  numeric;
begin
  if coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha as linhas da planilha que registram este pagamento.';
  end if;

  select * into v_lanc from public.lancamentos_financeiros where id = p_lancamento_id for update;
  if not found then raise exception 'Baixa não encontrada.'; end if;
  perform public._exige_financeiro_para_baixar(v_lanc.tenant_id);

  if v_lanc.estorno_de_lancamento_id is not null then
    raise exception 'O estorno não se liga à planilha: ligue a baixa que ele estorna.';
  end if;
  if v_lanc.conta_bancaria_id is null then
    raise exception 'Baixa sem conta bancária.';
  end if;
  select * into v_conta from public.contas_bancarias where id = v_lanc.conta_bancaria_id;
  if v_lanc.data_movimento >= v_conta.saldo_inicial_data then
    raise exception 'Baixa a partir de % se concilia com o banco, não com a planilha.',
      to_char(v_conta.saldo_inicial_data, 'DD/MM/YYYY');
  end if;
  if exists (select 1 from public.historico_movimentos where lancamento_id = v_lanc.id) then
    raise exception 'Esta baixa já está ligada a uma linha da planilha.';
  end if;

  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;
  select count(*)::int, coalesce(sum(h.valor), 0)
    into v_n, v_soma
    from public.historico_movimentos h
    join public.historico_cargas c on c.id = h.carga_id
   where h.id = any (p_movimento_ids)
     and h.tenant_id = v_lanc.tenant_id
     and c.situacao = 'ativa'
     and c.tipo in ('periodo', 'cauda', 'so_dre')
     and h.lancamento_id is null
     and h.extrato_linha_id is null
     and h.conta_bancaria_id = v_lanc.conta_bancaria_id
     and h.data = v_lanc.data_movimento;
  if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
    raise exception 'Alguma linha não é da mesma conta e do mesmo dia da baixa, não é de carga ativa ou já está ligada: recarregue a página.';
  end if;

  v_valor := case when v_lanc.natureza = 'entrada' then v_lanc.valor else -v_lanc.valor end;
  if abs(v_soma - v_valor) >= 0.005 then
    raise exception 'As linhas da planilha somam % e a baixa é de %: confira as linhas ou o valor da baixa.',
      public._moeda_br(abs(v_soma)), public._moeda_br(v_lanc.valor);
  end if;

  update public.historico_movimentos
     set lancamento_id = v_lanc.id
   where id = any (p_movimento_ids);
end;
$function$;

revoke all on function public.ligar_baixa_ao_historico(uuid, uuid[]) from public, anon;
grant execute on function public.ligar_baixa_ao_historico(uuid, uuid[]) to authenticated;

comment on function public.ligar_baixa_ao_historico(uuid, uuid[]) is
  'Decisão 270: a conciliação do histórico. Liga linhas da planilha (mesma conta e dia, carga ativa periodo/cauda/so_dre, sem ligação) a uma baixa com data antes do início da conta, quando somam o valor dela.';
