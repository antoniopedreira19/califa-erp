-- Duas solicitacoes aprovadas ficaram com cargo 'produtor musical' em minuscula
-- (entrada manual anterior ao catalogo padronizado). Sobe pra 'Produtor Musical'
-- pra alinhar com o catalogo em freelancer_cargos e com o restante das tabelas
-- (contratacoes, freelancer_contratos) que ja usam primeira letra maiuscula.

BEGIN;

UPDATE freelancer_solicitacoes
SET cargo = 'Produtor Musical'
WHERE cargo = 'produtor musical';

COMMIT;
