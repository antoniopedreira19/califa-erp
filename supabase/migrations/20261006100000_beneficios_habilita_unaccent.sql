-- Migration: habilita extensão unaccent para normalização de nomes.
-- Pré-requisito dos imports 20261006100001 (SulAmerica) e 20261006100002
-- (Bradesco Dental), que usam unaccent para match prefix de colaborador.

create extension if not exists unaccent;
