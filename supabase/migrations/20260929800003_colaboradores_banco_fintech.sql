-- Relaxa a constraint colaboradores_banco_formato pra aceitar o padrão
-- "fintech" (Nubank, C6, Neon etc.): banco_codigo + tipo_conta preenchidos
-- sem agência e conta formais — o meio de recebimento é a chave PIX.
--
-- Descoberto em 29/09/2026 tentando efetivar uma contratação onde o
-- candidato preencheu Nubank + PIX (CPF) sem agência/conta. A tabela
-- `contratacoes` já aceitava esse formato (não tem constraint), então
-- a validação da `colaboradores` estava mais restritiva que a origem
-- do dado — impossível efetivar candidatos de fintechs.
--
-- Passa a permitir 3 casos:
--   1. Tudo NULL (colaborador sem banco cadastrado)
--   2. Banco tradicional completo (com agência e conta)
--   3. Fintech: banco_codigo + tipo_conta, agencia e conta NULL
--
-- Não destrutivo: só amplia o conjunto de linhas aceitas. Linhas
-- existentes que passavam continuam passando.

alter table colaboradores
  drop constraint if exists colaboradores_banco_formato;

alter table colaboradores
  add constraint colaboradores_banco_formato check (
    -- 1) Tudo NULL
    (
      banco_codigo is null
      and agencia is null
      and agencia_dv is null
      and conta is null
      and conta_dv is null
      and tipo_conta is null
    )
    or
    -- 2) Banco tradicional completo
    (
      banco_codigo ~ '^[0-9]{3}$'
      and agencia ~ '^[0-9]{1,5}$'
      and (agencia_dv is null or agencia_dv ~ '^[0-9X]$')
      and conta ~ '^[0-9]{1,12}$'
      and conta_dv ~ '^[0-9X]$'
      and tipo_conta is not null
    )
    or
    -- 3) Fintech (só banco_codigo + tipo_conta; recebimento via PIX)
    (
      banco_codigo ~ '^[0-9]{3}$'
      and agencia is null
      and agencia_dv is null
      and conta is null
      and conta_dv is null
      and tipo_conta is not null
    )
  );
