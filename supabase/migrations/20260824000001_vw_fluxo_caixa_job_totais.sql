-- =====================================================================
-- "Visualizar Jobs" — Recebimentos e Custos totais de cada job
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A aba "Visualizar Jobs" ganhou duas colunas novas (design "Abertura de
-- Job - Financeiro", 24/08/2026): Recebimentos e Custos. Cada uma mostra
-- o número MAIS ATUAL do job — o que já foi movimentado, mais o que
-- virou documento, mais o que ainda é só previsão —, e não a previsão da
-- abertura sozinha.
--
-- Essa conta já existe pronta na `vw_fluxo_caixa`: as três classes dela
-- (`movimento`, `titulo`, `previsao`) somadas SÃO exatamente isso, e a
-- view já resolve o abatimento — previsão coberta por PP ou por nota sai
-- da classe `previsao` e reaparece em `titulo`/`movimento`, nunca nas
-- duas. Refazer a conta no TypeScript era o caminho garantido para a
-- lista divergir da aba Fluxo de Caixa do mesmo job.
--
-- O que faltava era o AGREGADO. A lista mostra o tenant inteiro; descer
-- todas as linhas da view para somar no cliente é o embed pesado que
-- `docs/PERFORMANCE.md` proíbe. Esta view devolve uma linha por job —
-- hoje 11 linhas para o tenant todo, contra as centenas de lançamentos
-- que estão por baixo.
--
-- DECISÕES DO TIAGO QUE ESTA VIEW MATERIALIZA (24/08/2026)
--
-- • "Sempre a soma dos 3 pontos do fluxo de caixa: movimentado, título e
--   previsão." É o `sum(valor)` por natureza, sem filtro de classe.
--
-- • "Independente do tempo, sempre com os números mais atualizados,
--   sempre priorizando o que foi realizado, o que se tornou título."
--   Nada de recorte por competência, por mês ou por status do job: a
--   coluna é o total da vida do job. Job encerrado não tem linha de
--   `previsao` na view (ela só projeta job `aberto`/`em_producao`), então
--   sobra o que virou dinheiro ou documento — que é justamente o número
--   mais atualizado dele.
--
-- O `realizado` sai separado porque a coluna traz uma segunda linha com
-- o quanto do total já aconteceu ("62% recebido", "40% realizado"). É o
-- mesmo total, recortado na classe `movimento` — não uma segunda conta.
--
-- O FALLBACK NÃO MORA AQUI. Job sem NENHUMA entrada prevista cai no
-- `jobs.faturamento_previsto`, e job sem curva cai no
-- `jobs.custo_previsto_total` (decisão do Tiago, 24/08/2026). Isso é
-- regra de apresentação da lista e fica em `lib/data/caixa-por-job.ts`:
-- misturar as duas réguas dentro da view contaminaria qualquer outra
-- leitura de fluxo de caixa que venha a usá-la.
--
-- SEM `security_invoker`, como as outras três views do schema — a
-- pendência registrada em 20260817000006 vale igual aqui, e a view não
-- alcança nenhuma tabela que a `vw_fluxo_caixa` já não alcance.
-- =====================================================================

create or replace view public.vw_fluxo_caixa_job_totais as
select
  v.tenant_id,
  v.job_id,
  coalesce(sum(v.valor) filter (where v.natureza = 'entrada'), 0)::numeric(14,2)
    as recebimentos_total,
  coalesce(sum(v.valor) filter (
    where v.natureza = 'entrada' and v.classe = 'movimento'
  ), 0)::numeric(14,2) as recebimentos_realizado,
  coalesce(sum(v.valor) filter (where v.natureza = 'saida'), 0)::numeric(14,2)
    as custos_total,
  coalesce(sum(v.valor) filter (
    where v.natureza = 'saida' and v.classe = 'movimento'
  ), 0)::numeric(14,2) as custos_realizado
from public.vw_fluxo_caixa v
where v.job_id is not null
group by v.tenant_id, v.job_id;

comment on view public.vw_fluxo_caixa_job_totais is
  'Recebimentos e custos totais de cada job: movimento + titulo + previsao '
  'da vw_fluxo_caixa, com o realizado (classe movimento) recortado a parte. '
  'Uma linha por job. Usada pela aba Visualizar Jobs do financeiro.';

grant select on public.vw_fluxo_caixa_job_totais to authenticated;
revoke all on public.vw_fluxo_caixa_job_totais from anon;
