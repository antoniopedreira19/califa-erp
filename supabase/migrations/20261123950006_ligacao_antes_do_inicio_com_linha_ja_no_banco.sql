-- 276 / 270 — A baixa antes do início liga também a linha da planilha que já está
-- conciliada com uma linha do banco anterior ao início (23/11/2026; Tiago: "Sim, ajuste").
--
-- O caso: a NF 6151 (Nacional Gás) foi recebida em 02/10 no BB California, antes do
-- início da conta (03/11). A linha da cauda que registra o recebimento (R$ 1.141,31)
-- já está conciliada com a linha do BB de 01/10 (R$ 272.427,10, que paga 11 linhas da
-- planilha) — a troca de carga do 3T (20261123980001) passou a herdar essa ligação
-- pelo conteúdo. `ligar_baixa_ao_historico` só aceitava, antes do início, a linha da
-- planilha sem linha do banco, e a baixa da NF ficou sem ligação. O efeito: o saldo do
-- Extrato antes do início (`extrato_antes_do_inicio`) soma a linha da planilha E a baixa
-- que nenhuma linha registra — o BB fica R$ 1.141,31 maior desde 02/10.
--
-- Antes do início a baixa não entra no Extrato da conta nem na conciliação: a linha
-- do banco anterior ao início continua sendo da planilha, e a ligação só diz que a
-- baixa é aquele recebimento. Por isso a trava passa a aceitar a linha da planilha
-- ligada a uma linha do banco ANTERIOR ao início. A partir do início nada muda (a
-- previsão ligada ao banco continua recusada: lá a linha do banco é de um dono só).
--
-- O resto da função é o da 20261123600006.

create or replace function public.ligar_baixa_ao_historico(p_lancamento_ids uuid[], p_movimento_ids uuid[])
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant     uuid;
  v_uid        uuid;
  v_n          integer;
  v_contas     integer;
  v_datas      integer;
  v_conta      uuid;
  v_data       date;
  v_inicio     date;
  v_antes      integer;
  v_no_banco   integer;
  v_baixas     numeric;
  v_linhas     numeric;
begin
  if coalesce(cardinality(p_lancamento_ids), 0) = 0 then
    raise exception 'Escolha as baixas que a linha da planilha registra.';
  end if;
  if coalesce(cardinality(p_movimento_ids), 0) = 0 then
    raise exception 'Escolha as linhas da planilha que registram este pagamento.';
  end if;

  perform 1 from public.lancamentos_financeiros where id = any (p_lancamento_ids) for update;
  select (array_agg(tenant_id))[1] into v_tenant
    from public.lancamentos_financeiros where id = any (p_lancamento_ids);
  if v_tenant is null then raise exception 'Baixa não encontrada.'; end if;
  v_uid := public._exige_financeiro_para_baixar(v_tenant);

  select count(*)::int,
         count(distinct l.conta_bancaria_id)::int,
         count(distinct l.data_movimento)::int,
         (array_agg(l.conta_bancaria_id))[1],
         min(l.data_movimento),
         count(*) filter (where l.data_movimento < cb.saldo_inicial_data)::int,
         count(*) filter (where l.extrato_linha_id is not null)::int,
         coalesce(sum(case when l.natureza = 'entrada' then l.valor else -l.valor end), 0)
    into v_n, v_contas, v_datas, v_conta, v_data, v_antes, v_no_banco, v_baixas
    from public.lancamentos_financeiros l
    join public.contas_bancarias cb on cb.id = l.conta_bancaria_id
   where l.id = any (p_lancamento_ids)
     and l.tenant_id = v_tenant
     and l.estorno_de_lancamento_id is null
     and not exists (select 1 from public.historico_movimento_baixas b where b.lancamento_id = l.id);
  if v_n <> (select count(distinct x) from unnest(p_lancamento_ids) x) then
    raise exception 'Alguma baixa é estorno, não tem conta ou já está ligada à planilha: recarregue a página.';
  end if;
  if v_contas <> 1 then
    raise exception 'As baixas precisam ser da mesma conta.';
  end if;

  select saldo_inicial_data into v_inicio from public.contas_bancarias where id = v_conta;
  perform 1 from public.historico_movimentos where id = any (p_movimento_ids) for update;

  if v_antes = v_n then
    -- Antes do início da conta: linhas do período, da cauda ou do só DRE, do
    -- mesmo dia das baixas, sem linha do banco ou ligadas a uma linha do banco
    -- também anterior ao início (a 6151: a cauda herdou a linha do BB de 01/10).
    if v_datas <> 1 then
      raise exception 'As baixas precisam ser do mesmo dia.';
    end if;
    if v_no_banco > 0 then
      raise exception 'Alguma baixa já está ligada ao banco: recarregue a página.';
    end if;
    select count(*)::int, coalesce(sum(h.valor), 0)
      into v_n, v_linhas
      from public.historico_movimentos h
      join public.historico_cargas c on c.id = h.carga_id
     where h.id = any (p_movimento_ids)
       and h.tenant_id = v_tenant
       and c.situacao = 'ativa'
       and c.tipo in ('periodo', 'cauda', 'so_dre')
       and (h.extrato_linha_id is null
            or exists (select 1 from public.extrato_linhas e
                        where e.id = h.extrato_linha_id
                          and e.conta_bancaria_id = v_conta
                          and e.data < v_inicio))
       and h.conta_bancaria_id = v_conta
       and h.data = v_data
       and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
    if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
      raise exception 'Alguma linha não é da mesma conta e do mesmo dia das baixas, não é de carga ativa ou já está ligada: recarregue a página.';
    end if;
  elsif v_antes = 0 then
    -- A partir do início da conta: a baixa já conciliada com o banco e as
    -- previsões da planilha do mesmo pagamento, de qualquer dia (a NF
    -- recebida líquida, que a planilha lança pelo bruto e pelas retenções).
    if v_no_banco <> v_n then
      raise exception 'A partir de % a baixa só se liga à planilha depois de conciliada com o banco.',
        to_char((select saldo_inicial_data from public.contas_bancarias where id = v_conta), 'DD/MM/YYYY');
    end if;
    select count(*)::int, coalesce(sum(h.valor), 0)
      into v_n, v_linhas
      from public.historico_movimentos h
      join public.historico_cargas c on c.id = h.carga_id
     where h.id = any (p_movimento_ids)
       and h.tenant_id = v_tenant
       and c.situacao = 'ativa'
       and c.tipo = 'previsao'
       and h.extrato_linha_id is null
       and h.conta_bancaria_id = v_conta
       and not exists (select 1 from public.historico_movimento_baixas b where b.historico_movimento_id = h.id);
    if v_n <> (select count(distinct x) from unnest(p_movimento_ids) x) then
      raise exception 'Alguma linha não é previsão da planilha da mesma conta, já está ligada ao banco ou já está ligada a uma baixa: recarregue a página.';
    end if;
  else
    raise exception 'As baixas precisam estar todas antes ou todas depois do início da conta.';
  end if;

  if abs(v_linhas - v_baixas) >= 0.005 then
    raise exception 'As linhas da planilha somam % e as baixas, %: confira as linhas ou os valores das baixas.',
      public._moeda_br(abs(v_linhas)), public._moeda_br(abs(v_baixas));
  end if;

  insert into public.historico_movimento_baixas (historico_movimento_id, lancamento_id, tenant_id, ligado_por)
  select distinct m.id, l.id, v_tenant, v_uid
    from unnest(p_movimento_ids) as m(id)
   cross join unnest(p_lancamento_ids) as l(id);
end;
$function$;

revoke all on function public.ligar_baixa_ao_historico(uuid[], uuid[]) from public, anon;
grant execute on function public.ligar_baixa_ao_historico(uuid[], uuid[]) to authenticated;

comment on function public.ligar_baixa_ao_historico(uuid[], uuid[]) is
  'Decisão 270: a conciliação do histórico. Antes do início da conta: liga baixas às linhas da planilha (período, cauda, só DRE) da mesma conta e do mesmo dia, sem linha do banco ou com linha do banco também anterior ao início. A partir do início: liga baixas já conciliadas com o banco às previsões da planilha da mesma conta, de qualquer dia. Nos dois casos as somas precisam bater.';
