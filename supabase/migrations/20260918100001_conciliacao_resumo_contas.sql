-- =====================================================================
-- Resumo por conta bancária, para a página inicial da Conciliação
-- (decisão 091).
--
-- A conciliação deixa de abrir direto no extrato da primeira conta: passa
-- a ter um hub que lista todas as contas com saldo de hoje e a
-- movimentação do período. Para desenhar essa lista são precisos, por
-- conta: saldo atual, créditos e débitos do período, quantos lançamentos
-- e a data do último movimento.
--
-- Isso NÃO pode virar "puxa `lancamentos_financeiros` inteiro e agrega no
-- Node" — é o anti-padrão que `docs/PERFORMANCE.md` proíbe, e a tabela só
-- cresce. A agregação fica no Postgres e o payload é uma linha por conta
-- (hoje 11).
--
-- `saldo_atual` segue a MESMA regra de `lib/calculos/saldo-conta.ts`: só
-- conta lançamento a partir de `saldo_inicial_data`, e só até hoje —
-- lançamento com data futura não infla o saldo de hoje.
--
-- `security invoker`: as policies de `contas_bancarias` e
-- `lancamentos_financeiros` continuam valendo dentro da função. Ninguém
-- vê conta nem lançamento de outro tenant por aqui.
--
-- Índice: `idx_lanc_conta_data` (tenant_id, conta_bancaria_id,
-- data_movimento) já existe e serve ao join; nenhum índice novo é
-- necessário.
-- =====================================================================

create or replace function public.conciliacao_resumo_contas(
  p_tenant_id uuid,
  p_de date,
  p_ate date
)
returns table (
  conta_id uuid,
  saldo_atual numeric,
  creditos_periodo numeric,
  debitos_periodo numeric,
  lancamentos_periodo integer,
  ultimo_movimento date
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id as conta_id,
    (c.saldo_inicial + coalesce(sum(
      case
        when l.data_movimento >= c.saldo_inicial_data
         and l.data_movimento <= current_date
        then case when l.natureza = 'entrada' then l.valor else -l.valor end
      end
    ), 0))::numeric(14,2) as saldo_atual,
    coalesce(sum(l.valor) filter (
      where l.natureza = 'entrada'
        and l.data_movimento between p_de and p_ate
    ), 0)::numeric(14,2) as creditos_periodo,
    coalesce(sum(l.valor) filter (
      where l.natureza = 'saida'
        and l.data_movimento between p_de and p_ate
    ), 0)::numeric(14,2) as debitos_periodo,
    count(l.id) filter (
      where l.data_movimento between p_de and p_ate
    )::int as lancamentos_periodo,
    max(l.data_movimento) as ultimo_movimento
  from contas_bancarias c
  left join lancamentos_financeiros l
    on l.conta_bancaria_id = c.id
   and l.tenant_id = c.tenant_id
  where c.tenant_id = p_tenant_id
  group by c.id, c.saldo_inicial;
$$;

comment on function public.conciliacao_resumo_contas(uuid, date, date) is
  'Uma linha por conta bancária do tenant: saldo de hoje, créditos/débitos e lançamentos no período, e a data do último movimento. Alimenta a página inicial da Conciliação (decisão 091).';

revoke all on function public.conciliacao_resumo_contas(uuid, date, date) from public;
revoke all on function public.conciliacao_resumo_contas(uuid, date, date) from anon;
grant execute on function public.conciliacao_resumo_contas(uuid, date, date) to authenticated;
