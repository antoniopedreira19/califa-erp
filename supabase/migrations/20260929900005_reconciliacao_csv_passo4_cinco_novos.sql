-- Passo 4 da reconciliação (aplicado via MCP em 29/09/2026):
-- Cria os 5 colaboradores que estão no CSV do RH mas não existiam
-- no DB por CPF. Cada um vem com salário vigente e alocação vigente
-- (mesma data de admissão pra as duas linhas), tudo em CTE única.
--
-- Os 5 novos:
--   - Leonardo Farroco Santos (California HUB, Manager de Compras N4)
--   - Amanda Pereira Kapazi (CCH HUB, Comercial/Growth N5)
--   - Davi Feitosa Pereira (CCH Agency, Filmmaker N5)
--   - Joao Victor Garcia Thomaz (CCH Agency, Planejamento N/A)
--   - Lethicia Silva Araruna (CCH, Gerente de Projetos N/A, sem CC no CSV)
--
-- Só o Leonardo tem lider_id preenchido (Quinho — único gestor mapeado
-- desses 5 que tem profile ativo no tenant).

with novos as (
  insert into colaboradores (
    tenant_id, nome, cpf, cnpj, email, email_pessoal, telefone, razao_social,
    tipo_contratacao, funcao, nivel_id, area, data_nascimento, data_admissao,
    status, lider_id, created_by
  )
  values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','Leonardo Farroco Santos','11000005800','11000002400100',
    'colaborador_058@exemplo.com','pessoal_058@exemplo.com','11000002400',
    'EMPRESA 058 EXEMPLO LTDA','pj','Manager de Compras','7f2fdfe1-05cd-4c76-8bc6-7cee5c7400c7',
    'CSC (adm/rh/jur)','1995-07-04','2026-09-22','ativo',
    '93ce308f-3027-4c41-b44b-ec1e3f8dbb52','ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','Amanda Pereira Kapazi','11000012600','11000002400100',
    'colaborador_126@exemplo.com','pessoal_126@exemplo.com','11000002400',
    'EMPRESA 126 EXEMPLO LTDA','pj','Comercial/Growth','4c4e932a-a2a3-4b1d-9f85-2dcb98f8cedb',
    'GROWTH','1998-06-05','2026-09-23','ativo',
    null,'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','Davi Feitosa Pereira','11000014600','11000002400100',
    'colaborador_146@exemplo.com','pessoal_146@exemplo.com','00000000000',
    'EMPRESA 146 EXEMPLO LTDA','pj','Filmmaker','4c4e932a-a2a3-4b1d-9f85-2dcb98f8cedb',
    'CONTEUDO','2001-06-27','2026-09-21','ativo',
    null,'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','Joao Victor Garcia Thomaz','11000017100','11000002400100',
    'colaborador_171@exemplo.com','pessoal_171@exemplo.com','11000002400',
    'EMPRESA 171 EXEMPLO LTDA','pj','Planejamento Estrategico',null,
    'CRIACAO','1995-02-08','2026-09-28','ativo',
    null,'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c','Lethicia Silva Araruna','11000017600','11000002400100',
    null,'pessoal_176@exemplo.com','11000002400',
    'EMPRESA 176 EXEMPLO LTDA','pj','Gerente de Projetos',null,
    'PROJETOS','1994-08-18','2026-10-01','ativo',
    null,'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381')
  returning id, nome, cpf, data_admissao
),
salarios as (
  insert into colaboradores_salarios (tenant_id, colaborador_id, valor, data_inicio, motivo, created_by)
  select 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', n.id,
    case n.cpf
      when '11000005800' then 14000
      when '11000012600' then 14000
      when '11000014600' then 6000
      when '11000017100' then 14000
      when '11000017600' then 13000
    end,
    n.data_admissao,
    'Cadastro inicial (import CSV RH 2026-09-29)',
    'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'
  from novos n
  returning colaborador_id
),
alocacoes as (
  insert into colaboradores_alocacoes (tenant_id, colaborador_id, empresa_id, regional_id, usa_rateio_empresa, data_inicio, created_by)
  select 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c', n.id,
    case n.cpf
      when '11000005800' then '304039bd-509d-4536-aa26-44e7091ee718'::uuid
      else '1703fd52-a36c-4701-816c-a0bcc868351d'::uuid
    end,
    case n.cpf
      when '11000014600' then 'be58f1de-d2ff-4cd2-aca6-434e696bfba1'::uuid
      when '11000017100' then 'be58f1de-d2ff-4cd2-aca6-434e696bfba1'::uuid
      else null
    end,
    case n.cpf
      when '11000014600' then false
      when '11000017100' then false
      else true
    end,
    n.data_admissao,
    'ba2e2ba1-1ba0-4e3d-99de-5d9d89877381'
  from novos n
  returning colaborador_id
)
select
  (select count(*) from salarios) as salarios_criados,
  (select count(*) from alocacoes) as alocacoes_criadas;
