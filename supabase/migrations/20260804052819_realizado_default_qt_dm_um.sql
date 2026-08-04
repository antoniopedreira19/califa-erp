-- =====================================================================
-- Realizado: QT e D/M nascem com 1, não 0.
--
-- `total_realizado` é coluna gerada (unitário × QT × D/M). Com os defaults
-- em 0, preencher só o R$ unitário deixava o total em 0 — o usuário tinha
-- que digitar 1 nas duas colunas pra "destravar" o cálculo. Com o default
-- em 1, lançar o unitário já produz o total esperado.
--
-- Não há UPDATE nas linhas existentes: nenhuma tem QT ou D/M zerados, e
-- mexer nelas alteraria valor realizado já lançado.
-- =====================================================================

alter table public.jobs_itens_realizado
  alter column quantidade_realizada set default 1,
  alter column dias_meses_realizado set default 1;
