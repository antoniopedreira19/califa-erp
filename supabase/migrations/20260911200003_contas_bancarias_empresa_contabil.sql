-- =====================================================================
-- contas_bancarias ganha a dimensão contábil: qual PJ é dona da conta.
--
-- A coluna nasce nullable pra permitir o backfill em passos. Vira NOT
-- NULL na migration 20260911200005 depois do backfill fechar.
--
-- A coluna gerencial `empresa_id` fica INTOCADA — é vestígio desde
-- 09/09/2026 (comentário na coluna explica) e é referenciada por 19 RPCs
-- de baixa. Removê-la sai do escopo desta frente.
-- =====================================================================

alter table public.contas_bancarias
  add column empresa_contabil_id uuid references public.empresas_contabeis(id);

create index contas_bancarias_empresa_contabil_id_idx
  on public.contas_bancarias(empresa_contabil_id);

comment on column public.contas_bancarias.empresa_contabil_id is
  'PJ contábil (CNPJ) dona desta conta. Define contabilmente todo lançamento que passa pela conta. Vai virar NOT NULL depois do backfill (20260911200005).';
