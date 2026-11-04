-- Unifica "DA" (25 contratos) com "Diretor de Arte" (56): sao o mesmo
-- cargo, DA era so abreviacao. Decidido em 04/11/2026, extensao da
-- padronizacao do catalogo (migration 20261104300001).
-- "DA/Motion" fica separado — hibrido, decisao pendente.

BEGIN;

UPDATE freelancer_contratos SET cargo = 'Diretor de Arte' WHERE cargo = 'DA';
DELETE FROM freelancer_cargos WHERE nome = 'DA';

COMMIT;
