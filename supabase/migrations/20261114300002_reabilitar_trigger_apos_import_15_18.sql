-- Reabilita a trigger de validação de saldo após o import de 15.18.xlsx
-- (ver 20261114300001 + tmp-importar-15-18.js).
--
-- 11 lançamentos inseridos cobrindo aquisitivos 1516/1617/1718 em 6
-- colaboradores (Selma, Cristiana, Matthias, Natalia, Luana, Andre).
-- Resultado: pendências "vencido sem gozo" nos aquisitivos 2015-2017
-- caíram de 12 para 1 (só Selma 2015/2016 — ela foi admitida antes do
-- escopo da planilha, não aparece lá).

alter table public.colaboradores_ferias_lancamentos
  enable trigger trg_ferias_lancamentos_valida_saldo;
