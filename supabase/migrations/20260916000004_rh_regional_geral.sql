-- =====================================================================
-- RH — Fase 3: regionais "GERAL <empresa>" nas 3 empresas reais do tenant
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- No MVP do módulo RH, colaboradores são alocados no par (empresa,
-- regional) via colaboradores_alocacoes.regional_id NOT NULL — mesma
-- regra que jobs e orçamentos já usam para regional. Mas alguns
-- colaboradores transversais (backoffice, financeiro, TI) não têm
-- regional específica na planilha atual da California — ficam com CC
-- vazio (Cristiana Kika, Marina Gordano, Fabia Nepomuceno, etc.).
--
-- Para manter a consistência arquitetural e não abrir exceção "regional
-- nullable" que quebra o resto do sistema, cada empresa real do tenant
-- ganha uma regional dedicada que abriga esses perfis transversais.
--
-- Por que os nomes têm sufixo por empresa
--
-- A tabela regionais tem DUAS constraints únicas hoje:
--   • idx_regionais_empresa_nome — UNIQUE (empresa_id, nome)
--   • uniq_regional_nome_por_tenant — UNIQUE (tenant_id, lower(nome))
--
-- A segunda impõe nome ÚNICO POR TENANT, não por empresa. Todas as
-- regionais existentes obedecem (NE, SP, NO, RJ, SS, Doca, Agency,
-- Hitlab — cada nome existe uma vez só no tenant). Uma tentativa de
-- criar "GERAL" nas três empresas viola essa constraint na segunda
-- linha inserida.
--
-- Solução: sufixar com o nome da empresa. As regionais aparecem na UI
-- como "GERAL California", "GERAL CCH" e "GERAL Hitlab" — auto-
-- explicativas para RH, e não quebram convenção do sistema.
--
-- Dependência:
--   • public.empresas   — já existe (Task 009)
--   • public.regionais  — já existe (Task 001+, hierarquia consolidada
--                          em 20260908000001)
--
-- Escopo:
--   • Cria "GERAL California" em Agência California
--   • Cria "GERAL CCH" em CCH
--   • Cria "GERAL Hitlab" em Hitlab
--
-- Fora do escopo:
--   • "Empresa Teste" (dev/QA) é ignorada de propósito.
--
-- Idempotente: `on conflict do nothing` no unique (empresa_id, nome)
-- protege re-execução. O outro unique (tenant, lower(nome)) não pega
-- porque cada nome nasce distinto.
--
-- Aditivo do começo ao fim: nenhuma tabela é modificada, nenhuma linha
-- existente é tocada.
--
-- Ver docs/modulos/rh/03-modelo-de-dados.md — seção "Regionais 'GERAL'".
-- =====================================================================

insert into public.regionais (tenant_id, nome, empresa_id, ativo)
select
  e.tenant_id,
  'GERAL ' || e.nome_fantasia,
  e.id,
  true
from public.empresas e
where e.tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'
  and e.nome_fantasia in ('Agência California', 'CCH', 'Hitlab')
on conflict (empresa_id, nome) do nothing;
