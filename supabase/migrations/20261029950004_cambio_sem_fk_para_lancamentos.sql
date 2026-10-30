-- =============================================================================
-- O câmbio no recebimento sem FK nova para lançamentos (decisão 229, parte 4)
-- =============================================================================
-- A parte 2 ligou `iof_lancamento_id` e `tarifa_lancamento_id` a
-- `lancamentos_financeiros` por FK. Com três FKs entre as duas tabelas, o
-- PostgREST não sabe mais qual usar nos embeds sem nome
-- (`lancamento:lancamentos_financeiros(...)` em Contas a Receber e
-- `antes_nf:recebimentos_antes_nf(id)` em `lib/data/baixas-do-documento.ts`)
-- e a consulta inteira falha. As duas FKs saem; as colunas ficam, guardadas
-- pela função que as grava (`registrar_recebimento_antes_nf_cambio`) e
-- limpas pela que cancela (`cancelar_recebimento_antes_nf`).
--
-- As FKs nasceram nesta mesma entrega, minutos antes, sem nenhum dado.
-- =============================================================================

alter table public.recebimentos_antes_nf
  drop constraint if exists recebimentos_antes_nf_iof_lancamento_id_fkey,
  drop constraint if exists recebimentos_antes_nf_tarifa_lancamento_id_fkey;
