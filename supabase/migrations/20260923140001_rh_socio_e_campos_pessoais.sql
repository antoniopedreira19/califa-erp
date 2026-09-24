-- =====================================================================
-- RH — adiciona 'socio' ao enum de contratação + campos pessoais no colaborador
-- =====================================================================
--
-- Decisões travadas em 2026-09-23:
--   1. Alguns colaboradores são sócios da agência (CEO, Diretor Criação);
--      não são PJ nem CLT no sentido tradicional. Ganham valor próprio no
--      enum pra ficar rastreável na folha e nos relatórios.
--   2. CSV de import da Kika trás data de nascimento e área. Modelo antigo
--      não tinha essas colunas — adiciono nullable pra caber sem quebrar
--      cadastros já feitos.
-- =====================================================================

alter type public.tipo_contratacao add value if not exists 'socio';

alter table public.colaboradores
  add column if not exists data_nascimento date,
  add column if not exists area text;

comment on column public.colaboradores.data_nascimento is
  'Data de nascimento do colaborador. Nullable — cadastro rápido pode omitir e completar depois.';
comment on column public.colaboradores.area is
  'Área organizacional (DIGITAL, CRIAÇÃO, PRODUÇÃO, CSC, etc). Texto livre por enquanto; se virar categorização formal, vira tabela própria.';
