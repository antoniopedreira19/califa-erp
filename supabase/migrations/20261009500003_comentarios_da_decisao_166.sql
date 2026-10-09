-- ============================================================================
-- Decisão 166 (09/10/2026): só os comentários das colunas.
--
-- O regime e o CNAE do fornecedor nasceram como "decisão 165" nas migrations
-- 20261009500001 e 20261009500002, já aplicadas. Antes do push, a varredura
-- dos worktrees achou a 165 em uso por outra frente (filtro por coluna nas
-- listas, criada antes), e a desta entrega passou a ser a 166 — a mais nova
-- move. As duas migrations ficam como foram aplicadas; esta só corrige o
-- número nos comentários das colunas, que vivem no banco.
-- ============================================================================

comment on column public.fornecedores.regime_tributario is
  'Regime tributario da pessoa juridica: lucro_real, lucro_presumido, simples ou mei (decisao 166, 09/10/2026). normal = legado "Lucro Real ou Presumido", gravado ate 09/10/2026; nao se escolhe mais e trava a geracao de PP ate a revisao do cadastro.';

comment on column public.fornecedores.cnae is
  'Subclasse do CNAE 2.3 (7 digitos, sem pontuacao), obrigatoria na pessoa juridica pelo schema do servidor (decisao 166, 09/10/2026). Nula = cadastro anterior a 09/10/2026 ou pessoa fisica; PP de PJ sem CNAE nao e gerada.';
