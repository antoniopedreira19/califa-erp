-- =====================================================================
-- "Todas as PPs deste item já foram geradas" — o marco por item
-- Decisão 052 (04/09/2026)
--
-- Até aqui o sistema não tinha como saber se um item da planilha ainda
-- ia gerar mais Pedidos de Produção. A previsão de custo do job chutava:
-- bastava UMA PP do item ser aprovada para o planejado INTEIRO daquele
-- item sair do Cronograma de desembolsos, mesmo que outras PPs ainda
-- fossem sair. A conta ficava curta até a última PP chegar.
--
-- O marco arruma isso. Ele é uma resposta de quem produz, não um cálculo:
-- "não sai mais PP deste item". Enquanto ele não vem, a previsão continua
-- ancorada no planejado; depois dele, o item passa a valer o que as PPs
-- dizem. Quem grava é a Planilha Interna do job — no formulário da PP
-- (pergunta obrigatória) ou no botão do painel "Destrinchar realizado".
--
-- Duas colunas, aditivas, na âncora do realizado:
--   pps_concluidas_em  — quando foi marcado (null = item em aberto)
--   pps_concluidas_por — quem marcou; é o que a faixa verde do painel
--                        mostra junto da data
--
-- Reabrir o item é apagar as duas: acontece quando alguém gera mais uma
-- PP num item marcado, e fica registrado no chat da Comunicação.
-- =====================================================================

alter table public.jobs_itens_realizado
  add column if not exists pps_concluidas_em timestamptz,
  add column if not exists pps_concluidas_por uuid
    references public.profiles(id) on delete set null;

-- FK com índice, como toda FK deste projeto: sem ele, apagar um profile
-- varre a tabela inteira.
create index if not exists idx_jobs_itens_realizado_pps_concluidas_por
  on public.jobs_itens_realizado (pps_concluidas_por);

-- A `vw_fluxo_caixa` filtra por "marcado ou não" ao montar o abatimento
-- da curva, sempre dentro de um job.
create index if not exists idx_jobs_itens_realizado_job_concluidas
  on public.jobs_itens_realizado (job_id)
  where pps_concluidas_em is not null;

comment on column public.jobs_itens_realizado.pps_concluidas_em is
  'Quando alguem confirmou que todas as PPs deste item ja foram geradas. Null = item em aberto, e a previsao de custo dele segue ancorada no planejado (decisao 052).';

comment on column public.jobs_itens_realizado.pps_concluidas_por is
  'Quem confirmou que nao sairao mais PPs deste item. Apagado junto com a data quando o item e reaberto para uma PP nova.';
