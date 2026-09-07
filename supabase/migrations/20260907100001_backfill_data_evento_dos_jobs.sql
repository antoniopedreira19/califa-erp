-- =====================================================================
-- Backfill: job sem data de evento passa a valer pela data de fim
-- Decisão do Tiago (07/09/2026), na implementação do Calendário de Jobs
--
-- POR QUE
-- -------
-- `jobs.data_evento` só virou obrigatória no envio do job em 27/08/2026.
-- Os jobs anteriores nasceram sem ela: 24 dos 31 do tenant, sendo 18 dos
-- 25 que o financeiro já abriu.
--
-- O Calendário de Jobs (aba nova em Abertura de Job) tem como eixo a
-- visão "Eventos no mês" — a data de evento é o que vira marca na grade.
-- Com 18 de 25 jobs sem ela, agosto/2026 mostraria 2 marcas e setembro
-- 5: a tela nasceria vazia e passaria a impressão de que o dado sumiu.
--
-- A decisão foi preencher a data de evento com a data de FIM prevista
-- ("essa build atual é de teste; quando for para produção todo job terá
-- uma data de evento, então vamos simular isso enquanto testamos").
--
-- O QUE ISSO SIGNIFICA
-- --------------------
-- A data preenchida aqui NÃO se distingue depois de uma informada pela
-- produção — é a mesma coluna, sem marca de procedência. Foi a escolha
-- consciente: uma coluna a mais só para carimbar dado de teste não se
-- paga. Job novo continua chegando com a data de evento de verdade, e
-- ela substitui esta na primeira edição.
--
-- Aditivo: só preenche o que estava vazio, não sobrescreve nenhuma data
-- informada. Todos os 24 têm `data_fim_prevista`, então nenhum fica de
-- fora.
-- =====================================================================

update public.jobs
   set data_evento = data_fim_prevista
 where data_evento is null
   and data_fim_prevista is not null;
