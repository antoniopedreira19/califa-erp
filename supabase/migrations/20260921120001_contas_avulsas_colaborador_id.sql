-- =====================================================================
-- contas_avulsas ganha colaborador_id
-- =====================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
--
-- A migration 20260921100001 removeu colaboradores.fornecedor_id, o atalho
-- que a rotina aprovarLinhaFolha (app/(app)/financeiro/contas-a-pagar/
-- actions-folhas.ts) usava pra saber pra quem depositar quando a folha
-- aprovada materializava contas_avulsas. Sem esse atalho, a rotina
-- perdeu a informação de destinatário: contas_avulsas nascia com
-- fornecedor_id=null e nem fornecedor, nem colaborador — órfã.
--
-- Isso não é problema só do CNAB: qualquer forma de pagamento (banco,
-- cheque, PIX manual) precisa saber pra quem está pagando. A folha
-- aprovada precisa carregar essa informação.
--
-- A solução limpa é adicionar contas_avulsas.colaborador_id — a coluna
-- que já era o Blocker 3 do módulo pgto-remessa. Ela vira o companion
-- de folha_id: quando a origem é folha, colaborador_id aponta pra quem
-- recebe. Sem duplicar o dado bancário (que vai viver em colaboradores),
-- sem forçar colaborador a ser fornecedor.
--
-- Também aproveita pra expor a coluna em vw_a_pagar, pra que o
-- gerador CNAB (próxima fase) consiga descobrir o destinatário sem ter
-- que consultar contas_avulsas de novo. Padrão idêntico ao que a view
-- já faz com fornecedor_id e cliente_id.
--
-- Registrado como ADR 002 do módulo pgto-remessa em
-- docs/modulos/pgto-remessa/02-decisoes.md.
--
-- O QUE MUDA
--
--   • contas_avulsas ganha coluna colaborador_id (uuid, nullable, FK
--     com ON DELETE RESTRICT — colaborador com histórico financeiro
--     não pode ser deletado, só inativado).
--   • Índice parcial em colaborador_id (only where not null).
--   • vw_a_pagar recriada expondo colaborador_id (NULL nas origens que
--     não são contas_avulsas, coluna real em contas_avulsas).
--   • Comment na coluna explica quando ela é preenchida.
--
-- O QUE FICA
--
--   • Nenhum backfill. Registros antigos (0 hoje) ficam com null.
--   • CHECK que impeça colaborador_id + fornecedor_id + cliente_id
--     preenchidos ao mesmo tempo NÃO é adicionado agora: o fluxo de
--     folha grava fornecedor_id=null naturalmente, e um CHECK aqui
--     poderia impactar migrations futuras que a gente ainda não desenhou.
--     Fica como decisão explícita — se aparecer bug, entra depois.
--   • Nenhuma outra tabela é tocada.
--
-- Aditiva do começo ao fim.
-- =====================================================================

alter table public.contas_avulsas
  add column if not exists colaborador_id uuid
    references public.colaboradores(id) on delete restrict;

comment on column public.contas_avulsas.colaborador_id is
  'Destinatário do pagamento quando a origem é folha ou repasse direto '
  'a colaborador. Complementa (não substitui) fornecedor_id/cliente_id: '
  'no fluxo de folha, colaborador_id é preenchido e fornecedor_id fica '
  'null. Adicionado em 2026-09-21 pelo módulo pgto-remessa (ADR 002).';

create index if not exists idx_contas_avulsas_colaborador
  on public.contas_avulsas (colaborador_id)
  where colaborador_id is not null;

-- ---------------------------------------------------------------------
-- vw_a_pagar: adiciona colaborador_id na projeção
-- ---------------------------------------------------------------------

-- colaborador_id vai NO FINAL da projeção pra preservar a ordem
-- existente das colunas (fornecedor_id, cliente_id, job_id, aprovada_em,
-- aprovada_por). Postgres não permite reordenar colunas em CREATE OR
-- REPLACE VIEW — só adicionar novas ao final. Colocar no fim mantém a
-- migration não-destrutiva.
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

-- GRANT sobre view segue o do usuário owner. Nada a fazer.
