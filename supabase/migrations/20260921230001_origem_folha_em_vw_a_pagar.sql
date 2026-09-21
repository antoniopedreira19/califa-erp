-- =====================================================================
-- Origem "folha" separada de "avulsa" na vw_a_pagar
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- Feedback de UX: quando a folha é aprovada e materializa contas_avulsas
-- (via aprovarLinhaFolha), a linha aparecia como "AVULSO" na coluna
-- Origem da tela Contas a Pagar. Semanticamente errado — folha e avulsa
-- são conceitos diferentes, e o gestor precisa distinguir na hora de
-- decidir o que exportar em remessa.
--
-- A distinção existe no banco desde o ADR 002: contas_avulsas.folha_id
-- IS NOT NULL quando a linha nasceu de uma folha aprovada. Basta o
-- CASE da view refletir isso — nenhuma coluna nova, nenhum backfill.
--
-- Também aproveita pra relaxar o CHECK de cnab_remessas_itens.origem_tipo
-- pra aceitar 'folha' como valor válido — senão a server action de
-- geração de remessa quebra na hora de gravar um item vindo de folha.
--
-- Aditiva do começo ao fim.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. vw_a_pagar: CASE de 3 braços em vez de 2
-- ---------------------------------------------------------------------

create or replace view public.vw_a_pagar as
 SELECT 'pp'::text AS origem_tipo,
    par.id AS origem_id,
    pp.tenant_id,
    pp.empresa_id,
    par.data_pagamento AS data_prevista,
    par.valor::numeric(14,2) AS valor,
    'saida'::natureza_lancamento AS natureza,
    (((((('PP '::text || pp.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(pp.servico, 1, 150) AS descricao,
    pp.fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    pp.aprovada_em,
    pp.aprovada_por,
    NULL::uuid AS colaborador_id
   FROM pedidos_compra_parcelas par
     JOIN pedidos_compra pp ON pp.id = par.pedido_compra_id
     JOIN LATERAL ( SELECT count(*)::integer AS total
           FROM pedidos_compra_parcelas x
          WHERE x.pedido_compra_id = par.pedido_compra_id) tot ON true
  WHERE (pp.status = ANY (ARRAY['aprovada'::pp_status, 'pago'::pp_status])) AND par.pago_em IS NULL
UNION ALL
 SELECT
        CASE
            WHEN a.folha_id IS NOT NULL THEN 'folha'::text
            WHEN a.recorrente_id IS NOT NULL THEN 'recorrente'::text
            ELSE 'avulsa'::text
        END AS origem_tipo,
    a.id AS origem_id,
    a.tenant_id,
    a.empresa_id,
    COALESCE(a.data_pagamento, a.data_prevista_pagamento) AS data_prevista,
    a.valor,
    a.natureza,
    a.descricao,
    a.fornecedor_id,
    a.cliente_id,
    a.job_id,
    a.aprovada_em,
    a.aprovada_por,
    a.colaborador_id
   FROM contas_avulsas a
  WHERE a.status = 'aprovada'::conta_avulsa_status
UNION ALL
 SELECT 'desembolso'::text AS origem_tipo,
    par.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    par.data_pagamento AS data_prevista,
    par.valor,
    'saida'::natureza_lancamento AS natureza,
    (((((('Desembolso '::text || d.codigo) || ' '::text) || par.numero) || '/'::text) || tot.total) || ' — '::text) || "substring"(d.descricao, 1, 150) AS descricao,
    d.fornecedor_id,
    d.cliente_id,
    d.job_id,
    d.aprovada_em,
    d.aprovada_por,
    NULL::uuid AS colaborador_id
   FROM desembolsos_parcelas par
     JOIN desembolsos d ON d.id = par.desembolso_id
     JOIN LATERAL ( SELECT count(*)::integer AS total
           FROM desembolsos_parcelas x
          WHERE x.desembolso_id = par.desembolso_id) tot ON true
  WHERE (d.status = ANY (ARRAY['aprovada'::desembolso_status, 'pago'::desembolso_status])) AND par.pago_em IS NULL
UNION ALL
 SELECT 'pp_devolucao_verba'::text AS origem_tipo,
    d.id AS origem_id,
    d.tenant_id,
    d.empresa_id,
    d.data_pagamento AS data_prevista,
    d.valor,
    'entrada'::natureza_lancamento AS natureza,
    (('Estorno de verba '::text || pp.codigo) || ' — '::text) || "substring"(pp.servico, 1, 140) AS descricao,
    NULL::uuid AS fornecedor_id,
    NULL::uuid AS cliente_id,
    pp.job_id,
    NULL::timestamp with time zone AS aprovada_em,
    NULL::uuid AS aprovada_por,
    NULL::uuid AS colaborador_id
   FROM pp_verba_devolucoes d
     JOIN pedidos_compra pp ON pp.id = d.pedido_compra_id
  WHERE d.pago_em IS NULL;

-- ---------------------------------------------------------------------
-- 2. cnab_remessas_itens: aceitar 'folha' no CHECK de origem_tipo
-- ---------------------------------------------------------------------

alter table public.cnab_remessas_itens
  drop constraint if exists chk_cnab_itens_origem_tipo;

alter table public.cnab_remessas_itens
  add constraint chk_cnab_itens_origem_tipo
    check (origem_tipo in ('pp', 'avulsa', 'recorrente', 'desembolso', 'folha'));
