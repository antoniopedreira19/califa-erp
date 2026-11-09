-- =============================================================================
-- 20261109950001 — As datas do fluxo de caixa de cada job (decisão 248)
-- =============================================================================
-- O "Exibir" do Resultado de Job (e do Visualizar Jobs, a mesma lista) ganha
-- as colunas Prazo de pagamento e Data de recebimento. As duas saem do fluxo
-- de caixa do job, e a lista lê o tenant inteiro: descer as linhas cruas da
-- `vw_fluxo_caixa` para cada job é o que `docs/PERFORMANCE.md` proíbe. Esta
-- view devolve uma linha por job, como a `vw_fluxo_caixa_job_totais`, com o
-- mesmo recorte do job (título de avulsa, recorrente e desembolso só entra
-- depois da baixa, `soDepoisDaBaixa` em `fluxo-do-job.ts`).
--
-- • `pagamento_data_media`: a data média dos pagamentos do job, ponderada
--   pelo valor — o que já saiu da conta (na data do pagamento), as PPs em
--   aberto (no vencimento) e o cronograma de desembolsos ainda sem PP (na data
--   prevista). É a mesma conta do card "Pagamento" do fluxo de caixa do job.
--   Sem impostos: o cronograma de impostos nem está na `vw_fluxo_caixa`, e o
--   estorno de recebimento (`titulo_estorno`) não é pagamento.
-- • `recebimento_proximo`: a próxima data prevista de recebimento (título em
--   aberto ou previsão da abertura), sem o consumo de save, que não é dinheiro.
-- • `recebimento_ultimo`: a data do último recebimento do cliente (baixa de
--   título ou recebimento antes da NF).
--
-- A média é em dias inteiros; meio dia arredonda para a data mais tardia,
-- como `dataMediaPonderada` (lib/calculos/prazos-do-job.ts).
--
-- Sem `security_invoker`, como a `vw_fluxo_caixa_job_totais` e a própria
-- `vw_fluxo_caixa`: quem lê filtra o tenant. GRANT de select para
-- `authenticated`, nada para `anon`.
--
-- Mudança ADITIVA: só uma view nova.
-- =============================================================================

create view public.vw_fluxo_caixa_job_datas as
select
  v.tenant_id,
  v.job_id,
  (date '2000-01-01' + round(
      sum(abs(v.valor) * (v.data_evento - date '2000-01-01'))
        filter (where v.natureza = 'saida'::natureza_lancamento
                  and coalesce(v.origem_lancamento, '') <> 'titulo_estorno')
      / nullif(sum(abs(v.valor))
        filter (where v.natureza = 'saida'::natureza_lancamento
                  and coalesce(v.origem_lancamento, '') <> 'titulo_estorno'), 0)
  )::int) as pagamento_data_media,
  min(v.data_evento) filter (
    where v.natureza = 'entrada'::natureza_lancamento
      and v.classe in ('titulo', 'previsao')
      and v.origem_tipo not like '%save_consumido'
  ) as recebimento_proximo,
  max(v.data_evento) filter (
    where v.natureza = 'entrada'::natureza_lancamento
      and v.classe = 'movimento'
      and v.origem_lancamento in ('titulo_baixa', 'recebimento_antes_nf')
  ) as recebimento_ultimo
from public.vw_fluxo_caixa v
where v.job_id is not null
  and not (v.classe = 'titulo' and v.origem_tipo = any (array['avulsa', 'recorrente', 'desembolso']))
group by v.tenant_id, v.job_id;

comment on view public.vw_fluxo_caixa_job_datas is
  'As datas do fluxo de caixa de cada job (decisão 248): a data média dos pagamentos (prazo de pagamento) e a próxima e a última data de recebimento. Uma linha por job, com o recorte da vw_fluxo_caixa_job_totais.';

revoke all on public.vw_fluxo_caixa_job_datas from public, anon, authenticated;
grant select on public.vw_fluxo_caixa_job_datas to authenticated;
