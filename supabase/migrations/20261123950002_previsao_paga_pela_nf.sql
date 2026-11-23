-- A previsão da planilha paga pela NF do sistema (decisão 276, 23/11/2026;
-- continuação das 20261123600004–600006 e da 20261123950001).
--
-- O problema: a NF recebida pelo líquido (o cliente retém ISS, PIS, COFINS,
-- CSLL e IR) chega ao banco num valor só, e a planilha lança o bruto e uma
-- linha por retenção, às vezes noutro dia. A regra (b) de
-- `_historico_previsoes_pagas` casa a previsão com a linha do banco pela
-- conta, pelo dia e pelo valor: não casa, e a receita da NF sai do DRE do
-- histórico (foi o caso da NF 6116, ligada à mão pela 600006). Com a carga
-- das NFs da planilha (decisão 276), cada recebimento delas passa a ser a
-- baixa de um título, e o caso vira regra.
--
-- A regra (c), nova: a previsão de recebimento (REC, entrada) que cita o
-- número da NF e é do job dela — o job da planilha do item
-- (`job_planilha_chave`) ou o job da planilha ligado ao job do sistema da
-- nota (`historico_jobs.job_id`) — e as retenções na fonte que citam a NF
-- ("Imposto retido na fonte …", "ISS retido na fonte") contam como pagas
-- quando todos os títulos da NF estão pagos. Só quando o número da NF é de
-- uma nota emitida só, e só quando os recebimentos que citam a NF não passam
-- do valor dela (a previsão maior cita a NF por engano: fica de fora).
--
-- As linhas da regra (c) saem das regras (b) e as linhas do banco das baixas
-- dessas NFs não casam com outra previsão por coincidência de valor.
-- O fluxo de caixa usa a mesma função (`_historico_previsoes_pagas(null)`):
-- a previsão paga pela NF sai dele também.
--
-- Mudança aditiva: só a função; nada é gravado.

create or replace function public._historico_previsoes_pagas(p_tenant_id uuid)
 returns setof uuid
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with nf_paga as (
    -- (c) As NFs emitidas com todos os títulos pagos.
    select f.id, f.tenant_id, ltrim(f.numero_nf, '0') as numero, f.valor_total,
           array_agg(distinct fi.job_planilha_chave) filter (where fi.job_planilha_chave is not null) as chaves,
           array_agg(distinct fi.origem_id) filter (where fi.origem_tipo in ('job', 'save') and fi.origem_id is not null) as jobs
      from public.faturamentos f
      join public.faturamento_itens fi on fi.faturamento_id = f.id
     where f.status = 'emitido'
       and (p_tenant_id is null or f.tenant_id = p_tenant_id)
       and exists (select 1 from public.titulos_receber t where t.faturamento_id = f.id and t.status <> 'cancelado')
       and not exists (select 1 from public.titulos_receber t where t.faturamento_id = f.id and t.status = 'em_aberto')
       and not exists (
         select 1 from public.faturamentos g
          where g.tenant_id = f.tenant_id
            and g.status = 'emitido'
            and g.id <> f.id
            and ltrim(g.numero_nf, '0') = ltrim(f.numero_nf, '0'))
     group by f.id
  ), prev_nf as (
    -- As previsões soltas que citam alguma NF.
    select m.id, m.tenant_id, m.carga_id, m.valor, m.grupo, m.job_chave, m.descricao,
           public._numeros_de_nf(concat_ws(' ', m.descricao, m.documento, m.observacao, m.parcela)) as nfs
      from public.historico_movimentos m
      join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
     where (p_tenant_id is null or m.tenant_id = p_tenant_id)
       and m.extrato_linha_id is null
       and m.valor <> 0
       and concat_ws(' ', m.descricao, m.documento, m.observacao, m.parcela) ~* '(N\.?F|NOTA)'
       and not exists (select 1 from public.historico_movimento_baixas hb where hb.historico_movimento_id = m.id)
  ), casa as (
    select p.id as prev_id, n.id as fat_id, p.valor, (p.grupo = 'REC' and p.valor > 0) as rec
      from prev_nf p
      join nf_paga n on n.tenant_id = p.tenant_id and n.numero = any (p.nfs)
     where (
             p.grupo = 'REC' and p.valor > 0 and p.job_chave is not null
             and (
               p.job_chave = any (coalesce(n.chaves, array[]::text[]))
               or exists (
                 select 1 from public.historico_jobs hj
                  where hj.carga_id = p.carga_id
                    and hj.chave = p.job_chave
                    and hj.job_id = any (coalesce(n.jobs, array[]::uuid[])))
             )
           )
        or (p.valor < 0 and upper(unaccent(coalesce(p.descricao, ''))) ~ 'RETID[OA]S? NA FONTE')
  ), nf_ok as (
    select c.fat_id
      from casa c
      join nf_paga n on n.id = c.fat_id
     group by c.fat_id, n.valor_total
    having bool_or(c.rec)
       and coalesce(sum(c.valor) filter (where c.rec), 0) <= n.valor_total + 0.01
  ), pela_nf as (
    select distinct c.prev_id from casa c where c.fat_id in (select fat_id from nf_ok)
  ), prev as (
    -- As previsões ainda soltas: sem linha do banco e sem ligação.
    select m.id, m.conta_bancaria_id, m.data, m.valor, m.aba, m.linha
      from public.historico_movimentos m
      join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
     where (p_tenant_id is null or m.tenant_id = p_tenant_id)
       and m.extrato_linha_id is null
       and m.valor <> 0
       and not exists (select 1 from public.historico_movimento_baixas hb where hb.historico_movimento_id = m.id)
       and m.id not in (select prev_id from pela_nf)
  ), banco as (
    -- As linhas do banco conciliadas só com lançamentos do sistema (fora as
    -- das baixas das NFs da regra c).
    select e.id, e.conta_bancaria_id, e.data, e.valor
      from public.extrato_linhas e
      join public.contas_bancarias cb on cb.id = e.conta_bancaria_id and (p_tenant_id is null or cb.tenant_id = p_tenant_id)
     where e.data >= cb.saldo_inicial_data
       and e.ignorada_em is null
       and exists (select 1 from public.lancamentos_financeiros l where l.extrato_linha_id = e.id)
       and not exists (
         select 1 from public.historico_movimentos h
           join public.historico_cargas c on c.id = h.carga_id and c.situacao = 'ativa'
          where h.extrato_linha_id = e.id)
       and not exists (
         select 1 from public.historico_movimento_baixas hb
           join public.lancamentos_financeiros l on l.id = hb.lancamento_id
          where l.extrato_linha_id = e.id)
       and not exists (
         select 1 from public.lancamentos_financeiros l
           join public.titulos_receber t on t.id = l.titulo_receber_id
          where l.extrato_linha_id = e.id
            and t.faturamento_id in (select fat_id from nf_ok))
  ), b1 as (
    -- Pela linha do banco: mesma conta, dia e valor, uma a uma.
    select p.id as prev_id, b.id as banco_id
      from (select prev.*, row_number() over (partition by conta_bancaria_id, data, valor order by aba, linha, id) as k from prev) p
      join (select banco.*, row_number() over (partition by conta_bancaria_id, data, valor order by id) as k from banco) b
        on b.conta_bancaria_id = p.conta_bancaria_id and b.data = p.data and b.valor = p.valor and b.k = p.k
  ), lanc as (
    -- As baixas das linhas do banco que não casaram inteiras.
    select l.id, b.conta_bancaria_id, b.data,
           case when l.natureza = 'entrada' then l.valor else -l.valor end as v
      from banco b
      join public.lancamentos_financeiros l on l.extrato_linha_id = b.id
     where b.id not in (select banco_id from b1)
  ), b2 as (
    -- Baixa a baixa: mesma conta, dia da linha do banco e valor da baixa.
    select p.id as prev_id
      from (select prev.*, row_number() over (partition by conta_bancaria_id, data, valor order by aba, linha, id) as k
              from prev where prev.id not in (select prev_id from b1)) p
      join (select lanc.*, row_number() over (partition by conta_bancaria_id, data, v order by id) as k from lanc) x
        on x.conta_bancaria_id = p.conta_bancaria_id and x.data = p.data and x.v = p.valor and x.k = p.k
  )
  -- (a) ligada a uma baixa já conciliada com o banco.
  select b.historico_movimento_id
    from public.historico_movimento_baixas b
    join public.historico_movimentos m on m.id = b.historico_movimento_id
    join public.historico_cargas c on c.id = m.carga_id and c.situacao = 'ativa' and c.tipo = 'previsao'
    join public.lancamentos_financeiros l on l.id = b.lancamento_id
   where (p_tenant_id is null or b.tenant_id = p_tenant_id)
     and m.extrato_linha_id is null
     and l.extrato_linha_id is not null
  union
  select prev_id from b1
  union
  select prev_id from b2
  union
  -- (c) pela NF paga (decisão 276).
  select prev_id from pela_nf;
$function$;

revoke all on function public._historico_previsoes_pagas(uuid) from public, anon, authenticated;
