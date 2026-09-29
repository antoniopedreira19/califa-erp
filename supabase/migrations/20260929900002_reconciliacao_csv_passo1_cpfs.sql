-- Reconciliação com o CSV atualizado do RH (29/09/2026), Passo 1:
--
-- 1. Preencher CPF nos 20 colaboradores que estavam no banco sem CPF
--    cadastrado. Match feito por nome exato (validado por script
--    Node normalizando acento/case — 20/20 bateram).
--
-- 2. Remover a contratação de teste Antonio Pedreira: colaborador +
--    salário vigente + alocação vigente + desvincular da contratação
--    de origem. A contratação continua existindo (útil pra outros
--    testes), mas com virou_colaborador_id = null e status
--    'contrato_assinado' pra permitir efetivar de novo se quiser.

-- Passo 1.1 — CPFs
update colaboradores set cpf='48410012200' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Bárbara Cândido Pereira de Sousa' and cpf is null;
update colaboradores set cpf='67676733802' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Bianca Barbosa Colares' and cpf is null;
update colaboradores set cpf='37472075405' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Bianka Silva Suarez Solla' and cpf is null;
update colaboradores set cpf='36776975104' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Carina Sousa Marçal' and cpf is null;
update colaboradores set cpf='14928495020' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Douglas Cerqueira Mendes' and cpf is null;
update colaboradores set cpf='82098906110' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Duane Pinto Coelho Cartaxo' and cpf is null;
update colaboradores set cpf='65550503220' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Francisco Arthur Pacheco' and cpf is null;
update colaboradores set cpf='71230723008' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Francisco Jucelio Silva de Araújo' and cpf is null;
update colaboradores set cpf='48290123310' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Gabriel Lucas Freire de Sousa' and cpf is null;
update colaboradores set cpf='88441059500' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='George Silva Lopes' and cpf is null;
update colaboradores set cpf='78948775605' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Giovana Ramos Pacheco Marques' and cpf is null;
update colaboradores set cpf='59059693405' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Isabel Chaves de Moura e Silva Gomes' and cpf is null;
update colaboradores set cpf='67030293770' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Italo Teles Campos de Sá Cavalcante' and cpf is null;
update colaboradores set cpf='45853125100' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Janaína Silva Leal dos Santos' and cpf is null;
update colaboradores set cpf='66111975008' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='João Victor Caetano Sousa' and cpf is null;
update colaboradores set cpf='37548093500' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='José Juscelino de Barros Júnior' and cpf is null;
update colaboradores set cpf='26428785110' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Marcos Vinicius de Souza Santos' and cpf is null;
update colaboradores set cpf='06646991545' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Mateus de Almeida Queiroz' and cpf is null;
update colaboradores set cpf='61950703940' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Pedro Almeida Tavares' and cpf is null;
update colaboradores set cpf='67151315003' where tenant_id='d2a02c10-9c7e-4157-8dd5-84bbf5a7044c' and nome='Wallace Souza Dorea' and cpf is null;

-- Passo 1.2 — Remover contratação de teste Antonio Pedreira
-- id do colaborador: 2d065246-cc77-46e1-ad98-4b9e384533de
-- id da contratação origem: fbf44a27-040e-434a-b2c8-c2a61410495b
update contratacoes
set virou_colaborador_id = null,
    status = 'contrato_assinado',
    efetivada_em = null
where id = 'fbf44a27-040e-434a-b2c8-c2a61410495b';

delete from colaboradores_salarios where colaborador_id = '2d065246-cc77-46e1-ad98-4b9e384533de';
delete from colaboradores_alocacoes where colaborador_id = '2d065246-cc77-46e1-ad98-4b9e384533de';
delete from colaboradores where id = '2d065246-cc77-46e1-ad98-4b9e384533de';
