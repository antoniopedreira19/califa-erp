-- Unifica "BI" (8 contratos) com "Analista de BI" (10): sao o mesmo
-- cargo. Decidido em 04/11/2026, extensao da padronizacao do catalogo.
-- "Community Manager/BI" e "Analista de BI" seguem separados (hibrido
-- vs principal).

BEGIN;

UPDATE freelancer_contratos SET cargo = 'Analista de BI' WHERE cargo = 'BI';
DELETE FROM freelancer_cargos WHERE nome = 'BI';

COMMIT;
