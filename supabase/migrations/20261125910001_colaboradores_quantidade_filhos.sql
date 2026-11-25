-- Nova coluna `quantidade_filhos` em colaboradores: quantos filhos a pessoa
-- tem, informado junto com o toggle `possui_filhos` no form de cadastro
-- (RH pediu em 25/11/2026). Não gera dependentes na base — é um número solto
-- pra análise. Quando o RH quiser registrar nome e data de cada filho,
-- continua usando a tabela `dependentes`.
--
-- Regra de integridade: se possui_filhos=true, a quantidade pode ser >=1 ou
-- continuar NULL (RH ainda não perguntou); se possui_filhos=false ou NULL,
-- quantidade_filhos precisa ser NULL — não faz sentido "sem filho, 3 filhos".

ALTER TABLE public.colaboradores
  ADD COLUMN IF NOT EXISTS quantidade_filhos smallint
    CHECK (
      quantidade_filhos IS NULL
      OR (quantidade_filhos BETWEEN 1 AND 20)
    );

ALTER TABLE public.colaboradores
  DROP CONSTRAINT IF EXISTS chk_colaboradores_qtd_filhos_coerente;
ALTER TABLE public.colaboradores
  ADD CONSTRAINT chk_colaboradores_qtd_filhos_coerente
  CHECK (
    quantidade_filhos IS NULL
    OR possui_filhos IS TRUE
  );

COMMENT ON COLUMN public.colaboradores.quantidade_filhos IS
  'Quantos filhos a pessoa tem. Só preenchido quando possui_filhos=true. Opcional — pode ficar NULL mesmo com possui_filhos=true, quando o RH não perguntou a quantidade.';
