-- Passo 5 (destrutivo, aprovado 29/09/2026): apaga todo histórico de
-- salário dos colaboradores ativos, deixando apenas a linha vigente
-- (que já tem o valor do CSV importado nesta reconciliação).
--
-- Contexto: 5 colaboradores ficaram com histórico depois da folha
-- 09/2026 duplicar linhas com o mesmo valor. O RH decidiu que a
-- planilha importada é a única fonte-verdade de salário — histórico
-- anterior (inclusive um aumento por mérito real da Isadora Pinheiro:
-- 9000 -> 12000) foi descartado por decisão explícita.
--
-- 6 linhas afetadas:
--   Álezis: 2023 -> 29/09 (5500) + 29/09 -> 29/09 (5248,48 typo)
--   Aline: 2024 -> 29/09 (15000)
--   Ana Almeida: 2026 -> 29/09 (12000)
--   Ana Pereira: 2026 -> 29/09 (8000)
--   Isadora: 2025 -> 24/09 (9000) — perde o aumento por mérito
--
-- Regra futura: cada import de folha deve substituir a linha vigente
-- do colaborador, não empilhar linha nova com o mesmo valor.

delete from colaboradores_salarios s
using colaboradores c
where s.colaborador_id=c.id
  and c.tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and c.status='ativo'
  and s.data_fim is not null;
