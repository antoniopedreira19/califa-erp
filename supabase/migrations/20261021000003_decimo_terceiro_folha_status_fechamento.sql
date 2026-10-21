-- Motivo: adicionar os status de fechamento ao enum da folha de 13o.
-- rascunho (ja existia) -> fechada_parcial_1 (apos fechar 1a parc) ->
-- fechada_parcial_2 (apos fechar 2a parc) -> concluida (quando as duas
-- parcelas estao aprovadas no financeiro).
--
-- Referencia: docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md
--
-- Regra do FLUXO-BANCO: alter type sozinho na migration.

alter type public.decimo_terceiro_folha_status add value if not exists 'fechada_parcial_1';
alter type public.decimo_terceiro_folha_status add value if not exists 'fechada_parcial_2';
alter type public.decimo_terceiro_folha_status add value if not exists 'concluida';
