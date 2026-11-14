-- Reabilita a trigger de validação de saldo após o import da planilha
-- FeriasPendencias.xlsx (ver migration 20261114200001 + script
-- tmp-importar-pendencias.js).
--
-- O import inseriu 44 lançamentos cobrindo aquisitivos 1819, 1920, 2021
-- e 2324 em 22 colaboradores. Resultado: pendências "vencido sem gozo"
-- caíram de 58 para 20 (12 restantes em aquisitivos 2015-2017 fora do
-- escopo de qualquer planilha disponível).

alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;
