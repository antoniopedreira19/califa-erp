-- Padroniza o catalogo freelancer_cargos: unifica duplicatas que
-- diferem apenas por caixa, acento, espaco, barra, erro de digitacao
-- ou variante masculina/feminina. Decidido em 04/11/2026 a partir do
-- modal "Gerenciar cargos" com 108 entradas, varias quase iguais.
--
-- freelancer_contratos.cargo e TEXT (snapshot), nao FK: renomear o
-- catalogo nao atualiza contratos antigos. Entao a migracao faz os
-- dois lados — backfill nos contratos e limpeza no catalogo — numa
-- so transacao, pra planilha e autocomplete convergirem.
--
-- Grupo 1 (caixa/acento/espaco/barra/typo): automatico.
-- Grupo 2 (genero): "Produtor" / "Produtora" / "PRODUTOR(A)" / etc
-- viram "Produtor(a)". Cargos especificos com "produtor" no nome
-- (Produtor Master, Produtor Artistico, Produtor Geral Recife,
-- Produtora Executiva, Produtora de Conteudo, Produtora Master SSA,
-- Produtor Musical) FICAM separados — sao funcoes distintas.
-- Grupo 3 (DA vs Diretor de Arte, BI vs Analista de BI, PMP vs PMO):
-- NAO entra aqui, decisao pendente.

BEGIN;

-- 1. Remove espaco a direita de qualquer cargo em contratos ("DIRETOR
-- DE ARTE " e "PRODUTOR " foram vistos, mas aplica geral).
UPDATE freelancer_contratos
SET cargo = TRIM(cargo)
WHERE cargo IS NOT NULL AND cargo <> TRIM(cargo);

-- 2. Backfill: contratos com nome antigo passam a usar o canonico.
UPDATE freelancer_contratos SET cargo = 'Diretor de Arte'
  WHERE cargo IN ('DIRETOR DE ARTE', 'DIRETOR(A) DE ARTE');

UPDATE freelancer_contratos SET cargo = 'Diretor de Criação'
  WHERE cargo = 'Diretor Criação';

UPDATE freelancer_contratos SET cargo = 'Assistente de Produção'
  WHERE cargo = 'Assistente de produção';

UPDATE freelancer_contratos SET cargo = 'Auxiliar de Serviços Gerais'
  WHERE cargo = 'Auxiliar de Serviço Gerais';

UPDATE freelancer_contratos SET cargo = 'Assistente de Planejamento / Comercial'
  WHERE cargo = 'Assistente de Planejamento/ Comercial';

UPDATE freelancer_contratos SET cargo = 'Redator / Planejamento'
  WHERE cargo = 'Redator/ Plenejamento';

UPDATE freelancer_contratos SET cargo = 'Analista de Conteúdo / Filmmaker'
  WHERE cargo = 'Analista de Conteúdo/ Fillmaker';

UPDATE freelancer_contratos SET cargo = 'Estagiária Social Media / Krafton'
  WHERE cargo = 'Estagiaria Social Media/ Krafton';

UPDATE freelancer_contratos SET cargo = 'Mídia'
  WHERE cargo = 'Midia';

UPDATE freelancer_contratos SET cargo = 'Social Media'
  WHERE cargo = 'SOCIAL MEDIA';

UPDATE freelancer_contratos SET cargo = 'Produção'
  WHERE cargo = 'PRODUÇÃO';

UPDATE freelancer_contratos SET cargo = 'Controller'
  WHERE cargo = 'CONTROLLER';

UPDATE freelancer_contratos SET cargo = 'Gerente de Projetos'
  WHERE cargo = 'GERENTE DE PROJETOS';

UPDATE freelancer_contratos SET cargo = 'Gerente de Projetos Júnior'
  WHERE cargo = 'Gerente de Projetos Junior';

UPDATE freelancer_contratos SET cargo = 'Editor'
  WHERE cargo = 'editor';

UPDATE freelancer_contratos SET cargo = 'Produtor Master'
  WHERE cargo = 'PRODUTOR MASTER';

UPDATE freelancer_contratos SET cargo = 'Produtor Artístico'
  WHERE cargo = 'PRODUTOR ARTÍSTICO';

UPDATE freelancer_contratos SET cargo = 'Produtor Musical'
  WHERE cargo = 'produtor musical';

UPDATE freelancer_contratos SET cargo = 'Apoio Administrativo RH'
  WHERE cargo = 'APOIO ADMINISTRATIVO RH';

UPDATE freelancer_contratos SET cargo = 'Live Seller'
  WHERE cargo = 'LIVE SELLER';

UPDATE freelancer_contratos SET cargo = 'Manager'
  WHERE cargo = 'MANAGER';

UPDATE freelancer_contratos SET cargo = 'Recrutador'
  WHERE cargo = 'RECRUTADOR';

UPDATE freelancer_contratos SET cargo = 'Revisora'
  WHERE cargo = 'REVISORA';

UPDATE freelancer_contratos SET cargo = 'Roteirista'
  WHERE cargo = 'ROTEIRISTA';

UPDATE freelancer_contratos SET cargo = 'Social Creator'
  WHERE cargo = 'SOCIAL CREATOR';

-- Grupo 2: unifica genero em "Produtor(a)".
UPDATE freelancer_contratos SET cargo = 'Produtor(a)'
  WHERE cargo IN ('Produtor', 'PRODUTOR', 'Produtora', 'produtora', 'PRODUTOR(A)');

-- 3. Catalogo: apaga as variantes cujo canonico JA EXISTE no catalogo.
DELETE FROM freelancer_cargos WHERE nome IN (
  -- Grupo 1
  'DIRETOR DE ARTE',
  'DIRETOR(A) DE ARTE',
  'Diretor Criação',
  'Assistente de produção',
  'Auxiliar de Serviço Gerais',
  'Assistente de Planejamento/ Comercial',
  'Redator/ Plenejamento',
  'Analista de Conteúdo/ Fillmaker',
  'Estagiaria Social Media/ Krafton',
  'Midia',
  'SOCIAL MEDIA',
  'PRODUÇÃO',
  'CONTROLLER',
  'GERENTE DE PROJETOS',
  'Gerente de Projetos Junior',
  'PRODUTOR MASTER',
  -- Grupo 2
  'Produtor',
  'PRODUTOR',
  'Produtora',
  'produtora',
  'PRODUTOR(A)'
);

-- 4. Catalogo: renomeia as variantes cujo canonico NAO EXISTE no catalogo
-- (so tem a versao "errada", entao basta ajustar o nome).
UPDATE freelancer_cargos SET nome = 'Editor'              WHERE nome = 'editor';
UPDATE freelancer_cargos SET nome = 'Produtor Artístico'  WHERE nome = 'PRODUTOR ARTÍSTICO';
UPDATE freelancer_cargos SET nome = 'Produtor Musical'    WHERE nome = 'produtor musical';
UPDATE freelancer_cargos SET nome = 'Apoio Administrativo RH' WHERE nome = 'APOIO ADMINISTRATIVO RH';
UPDATE freelancer_cargos SET nome = 'Live Seller'         WHERE nome = 'LIVE SELLER';
UPDATE freelancer_cargos SET nome = 'Manager'             WHERE nome = 'MANAGER';
UPDATE freelancer_cargos SET nome = 'Recrutador'          WHERE nome = 'RECRUTADOR';
UPDATE freelancer_cargos SET nome = 'Revisora'            WHERE nome = 'REVISORA';
UPDATE freelancer_cargos SET nome = 'Roteirista'          WHERE nome = 'ROTEIRISTA';
UPDATE freelancer_cargos SET nome = 'Social Creator'      WHERE nome = 'SOCIAL CREATOR';

COMMIT;
