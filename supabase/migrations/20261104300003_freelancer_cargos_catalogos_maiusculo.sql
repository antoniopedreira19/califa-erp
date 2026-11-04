-- Primeira letra de cada palavra em maiusculo no cargo "Adm de Obras
-- e catalogos" (unica entrada do catalogo com palavra em minuscula
-- que nao e preposicao nem sigla). Decidido em 04/11/2026.

BEGIN;

UPDATE freelancer_cargos
SET nome = 'Adm de Obras e Catalogos'
WHERE nome = 'Adm de Obras e catalogos';

UPDATE freelancer_contratos
SET cargo = 'Adm de Obras e Catalogos'
WHERE cargo = 'Adm de Obras e catalogos';

COMMIT;
