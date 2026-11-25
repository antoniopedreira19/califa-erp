-- Novo campo `localizacao` em colaboradores: onde a pessoa mora
-- fisicamente, independente das regionais de alocação (uma pessoa alocada em
-- Hub pode morar em SP ou NE). Alimenta um filtro novo na listagem de
-- colaboradores e permite análise do RH sobre distribuição geográfica.
--
-- Valores aceitos: SP, NE, NO, RJ, SC, BH, SSB. Aditivo: coluna nova NULLABLE,
-- sem impacto em código existente.
--
-- O backfill dos valores reais (vindo da planilha "NOVAS INFORMAÇÕES" do RH,
-- em 25/11/2026) é aplicado fora do versionamento, direto no banco pelo MCP,
-- porque a planilha contém nome + e-mail pessoal dos colaboradores e não pode
-- entrar no repo (regra PII do CLAUDE.md).

ALTER TABLE public.colaboradores
  ADD COLUMN IF NOT EXISTS localizacao text
    CHECK (localizacao IN ('SP','NE','NO','RJ','SC','BH','SSB'));

COMMENT ON COLUMN public.colaboradores.localizacao IS
  'Onde a pessoa mora fisicamente. Independente da regional de alocação — uma pessoa em Hub pode morar em SP ou NE. Alimenta o filtro da listagem e análise do RH.';

CREATE INDEX IF NOT EXISTS idx_colaboradores_localizacao
  ON public.colaboradores (tenant_id, localizacao)
  WHERE localizacao IS NOT NULL;
