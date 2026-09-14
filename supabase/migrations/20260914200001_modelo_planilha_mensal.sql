-- =====================================================================
-- Modelo de planilha MENSAL — o valor no enum
--
-- Os serviços Fee e Always On são contratos recorrentes, faturados mês a
-- mês. A California fecha cada regional numa planilha em que cada mês é um
-- bloco próprio (aba SUL de "INTERNA - DRE + Planilhas Ânima 2026.xlsx").
-- No ERP isso vira um modelo de planilha próprio, escolhido pela
-- categoria — o mesmo mecanismo da decisão 072 (internacional).
--
-- Sozinho nesta migration de propósito: um valor novo de enum não pode
-- ser usado na mesma transação em que é criado (docs/FLUXO-BANCO.md). A
-- categoria que o usa vem na migration seguinte.
--
-- Decisão 076. Aditivo.
-- =====================================================================

alter type public.categoria_modelo_planilha add value if not exists 'mensal';
