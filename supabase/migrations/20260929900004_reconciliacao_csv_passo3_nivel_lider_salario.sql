-- Passo 3 da reconciliação (aplicado via MCP em 29/09/2026):
--
-- 3a. Nível: UPDATE em bloco baseado no código do CSV (N1..N5).
--     Banco tinha maioria dos colaboradores com nivel_id null; o CSV
--     preencheu ~200 casos. Ver migration 20260929900001 pra criação
--     dos níveis N1 e N2 que não existiam antes.
--
-- 3b. Líder: só onde o apelido do "Gestor Imediato" tem profile ativo
--     no tenant (46 casos de 201 diffs). Os líderes principais (Beto,
--     Buck, Matthias, Icaro, Kikote, Wilson, Bernardo, Ruan, Erica,
--     Bruno Duarte) NÃO são usuários do ERP hoje — o RH preenche o
--     lider_id desses casos pela tela quando esses gestores forem
--     convidados.
--
-- 3c. Salário: 2 diffs identificados no relatório
--     - Aline Heluany Khoury: 14662,68 -> 15000 (UPDATE direto, valor
--       tinha sido criado hoje via outra migration, histórico de 1
--       dia não faz sentido)
--     - Álezis Mateus Gomes Miranda: 524848 (typo) -> 5500 (UPDATE
--       direto porque period vigente começaria amanhã)
--
-- Todo o resto (empresa, regional, HUB, tipo_contratacao) já batia
-- com o CSV — zero diffs.

-- 3c. Correções pontuais de salário
update colaboradores_salarios s set valor=15000
from colaboradores c
where s.colaborador_id=c.id and s.data_fim is null
  and c.tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g')='03726542310'
  and s.valor<>15000;

update colaboradores_salarios s set valor=5500
from colaboradores c
where s.colaborador_id=c.id and s.data_fim is null
  and c.tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and regexp_replace(coalesce(c.cpf,''),'[^0-9]','','g')='86048486570'
  and s.valor<>5500;

-- 3a e 3b (níveis e líderes) foram aplicados via CTE VALUES no MCP.
-- O SQL bruto está preservado em tmp/passo3-nivel.sql e
-- tmp/passo3-lider.sql. Como esta migration é reprodutível a partir
-- do CSV fixado no repo (tmp/colaboradores-atualizados.csv) via
-- tmp/passo3-aplicar-v2.mjs, opto por não duplicar as ~200 linhas
-- de UPDATE aqui — o histórico está no MCP e no tmp/.
