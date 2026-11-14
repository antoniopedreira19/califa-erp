-- Reabilita a trigger de validação de saldo após o import da planilha
-- 21.22.23.xlsx (ver migration 20261114100001 + script
-- tmp-importar-ferias-21-23.js).
--
-- O import inseriu 28 lançamentos de usufruto/abono em períodos
-- antigos (21/22 e 22/23) de 24 colaboradores com pendência
-- "vencido sem gozo". Resultado: 16 colaboradores regularizados,
-- 11 restaram com pendências residuais (todos em aquisitivos de
-- 2020/2021 ou 2023/2024, fora do escopo da planilha).
--
-- A trigger agora volta a validar INSERTs novos que ultrapassem
-- o direito de 30d por período.

alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;
