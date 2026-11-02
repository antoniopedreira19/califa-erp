-- =====================================================================
-- Mútuo (decisão 230): a abertura da GoCrazy volta a 30/09
-- =====================================================================
--
-- Em 31/10, um `update` aplicado junto de 20261031100005, e que não está
-- naquele arquivo, somou a guia de 15/10 ao IOF pago da abertura
-- GoCrazy × Community e mudou a nota. Isso foi feito sem o OK do Tiago.
--
-- Com a guia marcada em `mutuos_iof_historico` (20261102100001), a abertura
-- volta ao valor de 30/09 e à nota daquele dia. Aprovado pelo Tiago em
-- 02/11/2026. O total da tela não muda: a guia passa a somar pela marcação.
--
-- Esta migration só vai ao ar junto do código que lê a marcação: sem ele, a
-- tela perde o valor da guia. Sem valores aqui, como a carga da abertura: o
-- repositório é público. A nota muda, e por isso rodar de novo não desconta
-- a guia duas vezes.
-- =====================================================================

update public.mutuos_saldo_abertura a
   set iof_pago = a.iof_pago - g.valor,
       nota = 'Tipo MÚTUO INT 3T 2025 · saiu da Santander GoCrazy em 09/07/2025'
  from public.vw_mutuos_iof_historico g
 where g.tenant_id = a.tenant_id
   and g.pagador_empresa_contabil_id = a.credor_empresa_contabil_id
   and g.com_fornecedor_id = a.devedor_fornecedor_id
   and a.nota like '%IOF até a guia de 15/10%';
