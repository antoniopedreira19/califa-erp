-- =====================================================================
-- RH — colaborador ganha RG, endereço completo, razão social e natureza PJ
-- =====================================================================
--
-- Contexto: fluxo de Contratação (task 007) precisa desses campos pra
-- montar o contrato PJ. Ao efetivar a contratação, os dados migram
-- pro colaborador. Também servem pra colaboradores criados diretamente
-- (fluxo antigo) que precisem completar o cadastro.
--
-- Decisões (task 007, 2026-09-29):
--   9.  RG entra no cadastro (obrigatório app-level, nullable no banco
--       pros 204 legados).
--   10. Endereço completo entra no cadastro (7 campos). Complemento é
--       opcional; resto é obrigatório app-level pra PJ (bate com o
--       modelo de contrato California 2025).
--   12. 5 naturezas de PJ: mei, me, ltda, eireli, slu. Enum criado aqui.
--
-- Também adiciona razao_social (nome empresarial da pessoa jurídica —
-- diferente do nome fantasia do colaborador).
--
-- Todos nullable no banco. Régua "está preenchido?" fica no schema Zod
-- + no helper de pendências (Nível 2 pra endereço/RG; Nível 1 pra
-- razao_social + pj_natureza quando tipo é PJ).
-- =====================================================================

-- Enum novo
create type public.pj_natureza as enum (
  'mei',
  'me',
  'ltda',
  'eireli',
  'slu'
);

comment on type public.pj_natureza is
  'Natureza jurídica do PJ do colaborador. EIRELI foi extinta pela Lei 14.195/2021 mas ainda existem CNPJs vigentes; SLU é o substituto pros novos. ME é enquadramento fiscal (LC 123/2006), mantido por conveniência do RH.';

-- Colunas novas
alter table public.colaboradores
  add column if not exists rg           text,
  add column if not exists razao_social text,
  add column if not exists pj_natureza  public.pj_natureza,
  add column if not exists cep          text,
  add column if not exists logradouro   text,
  add column if not exists numero       text,
  add column if not exists complemento  text,
  add column if not exists bairro       text,
  add column if not exists cidade       text,
  add column if not exists uf           text;

-- CHECKs de formato
alter table public.colaboradores
  add constraint chk_colaboradores_cep_formato
  check (cep is null or cep ~ '^[0-9]{8}$');

alter table public.colaboradores
  add constraint chk_colaboradores_uf_formato
  check (uf is null or uf ~ '^[A-Z]{2}$');

alter table public.colaboradores
  add constraint chk_colaboradores_rg_limite
  check (rg is null or length(rg) between 1 and 20);

comment on column public.colaboradores.rg is
  'RG do colaborador. Texto livre porque RG varia por estado (não tem formato nacional). Obrigatório no cadastro novo desde 2026-09-29.';
comment on column public.colaboradores.razao_social is
  'Razão social (nome empresarial) da pessoa jurídica do colaborador. Obrigatório quando tipo_contratacao é pj ou clt_recibo.';
comment on column public.colaboradores.pj_natureza is
  'Natureza jurídica do PJ. Determina o texto usado no contrato — ver lib/rh/naturezas-pj.ts.';
comment on column public.colaboradores.cep is
  'CEP só dígitos, 8 caracteres. Sem hífen.';
comment on column public.colaboradores.uf is
  'UF em 2 letras maiúsculas (AC, AL, AM, ..., TO).';
