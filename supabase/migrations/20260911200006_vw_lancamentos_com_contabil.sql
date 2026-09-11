-- =====================================================================
-- View helper: lançamento financeiro já com a PJ contábil resolvida por
-- join via conta bancária. Uso: relatórios que precisam segmentar por
-- contábil sem lembrar do join. Telas transacionais devem continuar
-- consultando lancamentos_financeiros direto (perf).
-- =====================================================================

create or replace view public.vw_lancamentos_com_contabil as
select
  lf.*,
  cb.empresa_contabil_id,
  ec.razao_social  as empresa_contabil_razao_social,
  ec.nome_fantasia as empresa_contabil_nome_fantasia,
  ec.cnpj          as empresa_contabil_cnpj
from public.lancamentos_financeiros lf
join public.contas_bancarias  cb on cb.id = lf.conta_bancaria_id
join public.empresas_contabeis ec on ec.id = cb.empresa_contabil_id;

grant select on public.vw_lancamentos_com_contabil to authenticated;
