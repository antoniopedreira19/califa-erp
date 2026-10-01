-- Motivo: adiciona a role 'colaborador' ao enum app_role, pre-requisito para
-- o subsistema de Férias (ver docs/modulos/rh/25-ferias.md §9 e
-- docs/modulos/rh/26-ferias-modelo-de-dados.md §1.1).
--
-- 'colaborador' é a role INICIAL de todo colaborador ativo com acesso ao sistema.
-- Dá acesso APENAS à página /perfil (próprios dados, próprias férias).
-- RLS específica é controlada pela função is_colaborador_proprio (criada na
-- migration seguinte, ferias_fundacao).
--
-- Separada em migration própria porque ALTER TYPE ADD VALUE precisa commit
-- antes de qualquer uso do novo valor (restrição do Postgres).

alter type public.app_role add value if not exists 'colaborador';
