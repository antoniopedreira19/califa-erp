-- =============================================================================
-- CNAEs de faturamento: atualização pela planilha de impostos de 19/11/2026
--
-- Racional
-- • O Tiago mandou a planilha "IMPOSTOS SIST THIAGO" atualizada (abas MATRIZ,
--   SP, FOR, GO MATRIZ e HITLAB), a mesma fonte da carga inicial do cadastro
--   fiscal (20261002100001). Comparada linha a linha com `fiscal_cnaes` da
--   produção: nenhuma alíquota mudou e nenhum CNAE saiu. Entram 4 linhas:
--     - 73.11-4-00 · Agências de publicidade na California · Salvador,
--       California · São Paulo e California · Fortaleza: ISS 2%, PIS 1,65%,
--       COFINS 7,6% (lucro real, não cumulativo). A GoCrazy · Santo André já
--       tinha esse CNAE, com os mesmos valores.
--     - 90.01-9-02 · Produção musical na Hitlab · Salvador: ISS 5%, PIS 0,65%,
--       COFINS 3% (lucro presumido, cumulativo, igual aos outros 4 da Hitlab).
-- • O que a planilha nova muda e o banco NÃO acompanha (fica como está):
--     - Aba HITLAB: CSLL, IR e adicional viraram números (2,88%, 4,8% e 3,2%).
--       São 32% × 9%, 15% e 10%: já saem dos parâmetros `presuncao_servicos`,
--       `csll`, `irpj` e `irpj_adicional`. Nada a mudar.
--     - Aba HITLAB: o título e o quadro de vencimentos vieram copiados da GO
--       MATRIZ (ISS no dia 20). A Hitlab é de Salvador e segue com o ISS no
--       dia 5, como a California · Salvador, até o Tiago dizer o contrário.
--     - Aba GO MATRIZ: o 73.11-4-00 aparece duas vezes (linhas 7 e 17), com
--       os mesmos valores. Entra uma vez só: já está no banco.
-- • Vigência a partir de 01/01/2026, a mesma das outras linhas da carga
--   inicial: a nota registrada com data anterior a hoje também acha o CNAE.
--
-- Só aditiva e só na produção (tenant agencia-california): nenhuma linha
-- existente muda. O Sandbox já lista os dois códigos (cópia de 16/11,
-- 20261116300001). Idempotente: NOT EXISTS por CNPJ + código + subitem
-- aberto. A tabela já tem RLS, policies, GRANT e índices desde a criação.
-- Auditoria: um `fiscal_cnae.criado` por linha, como o "CNAE novo" da tela de
-- Cadastros › Impostos, com origem nesta migration.
-- =============================================================================

with novos (estabelecimento, codigo, descricao, aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo) as (
  values
    ('California · Salvador',  '73.11-4-00', 'Agências de publicidade', 2.0000, 1.6500, 7.6000, false),
    ('California · São Paulo', '73.11-4-00', 'Agências de publicidade', 2.0000, 1.6500, 7.6000, false),
    ('California · Fortaleza', '73.11-4-00', 'Agências de publicidade', 2.0000, 1.6500, 7.6000, false),
    ('Hitlab · Salvador',      '90.01-9-02', 'Produção musical',        5.0000, 0.6500, 3.0000, true)
),
inseridos as (
  insert into public.fiscal_cnaes (
    tenant_id, estabelecimento_id, codigo, subitem, descricao,
    aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo,
    vigencia_inicio, vigencia_fim, ativo
  )
  select
    t.id, e.id, n.codigo, null, n.descricao,
    n.aliquota_iss, n.aliquota_pis, n.aliquota_cofins, n.cumulativo,
    date '2026-01-01', null, true
  from novos n
  join public.tenants t on t.slug = 'agencia-california'
  join public.fiscal_estabelecimentos e on e.tenant_id = t.id and e.nome = n.estabelecimento
  where not exists (
    select 1 from public.fiscal_cnaes c
    where c.estabelecimento_id = e.id
      and c.codigo = n.codigo
      and c.subitem is null
      and c.ativo
      and c.vigencia_fim is null
  )
  returning id, tenant_id, estabelecimento_id, codigo, subitem, descricao,
            aliquota_iss, aliquota_pis, aliquota_cofins, cumulativo, vigencia_inicio
)
insert into public.audit_events (tenant_id, entidade_tipo, entidade_id, acao, actor_user_id, metadata)
select
  i.tenant_id, 'fiscal_cnae', i.id::text, 'fiscal_cnae.criado', null,
  jsonb_build_object(
    'origem', 'migration 20261119300001',
    'motivo', 'planilha de impostos atualizada em 19/11/2026',
    'estabelecimento', e.nome,
    'codigo', i.codigo,
    'subitem', i.subitem,
    'descricao', i.descricao,
    'aliquota_iss', i.aliquota_iss,
    'aliquota_pis', i.aliquota_pis,
    'aliquota_cofins', i.aliquota_cofins,
    'cumulativo', i.cumulativo,
    'vigencia_inicio', i.vigencia_inicio
  )
from inseridos i
join public.fiscal_estabelecimentos e on e.id = i.estabelecimento_id;
