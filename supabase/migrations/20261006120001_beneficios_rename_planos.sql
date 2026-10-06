-- Migration: renomeia 2 benefícios do catálogo para nomes curtos
-- - 'SulAmerica Direto Nacional' → 'SulAmerica Direto'
-- - 'SulAmerica Especial 100'    → 'SulAmerica Especial'
-- - Bradesco Dental fica como está.
-- Idempotente: usa WHERE pelo nome atual.

update public.beneficios
   set nome = 'SulAmerica Direto'
 where nome = 'SulAmerica Direto Nacional';

update public.beneficios
   set nome = 'SulAmerica Especial'
 where nome = 'SulAmerica Especial 100';
