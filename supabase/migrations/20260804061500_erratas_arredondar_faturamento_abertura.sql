-- =====================================================================
-- `faturamento_abertura` guardava o valor cheio da conta, enquanto
-- `jobs.valor_total` é gravado com 2 casas. O card de Erratas compara os
-- dois, e a diferença de precisão fazia o mesmo delta aparecer como
-- "+R$ 1.391,99" no cabeçalho e "+R$ 1.392,00" na linha da errata.
--
-- Dinheiro fica com 2 casas em todo lugar. Idempotente: só toca no que
-- ainda não está arredondado.
-- =====================================================================

update public.jobs
set faturamento_abertura = round(faturamento_abertura, 2)
where faturamento_abertura is not null
  and faturamento_abertura <> round(faturamento_abertura, 2);

update public.jobs_erratas
set custo_orcado_antes = round(custo_orcado_antes, 2),
    custo_orcado_depois = round(custo_orcado_depois, 2),
    faturamento_antes = round(faturamento_antes, 2),
    faturamento_depois = round(faturamento_depois, 2);

update public.jobs_erratas_itens
set total_de = round(total_de, 2),
    total_para = round(total_para, 2),
    efeito_faturamento = round(efeito_faturamento, 2);
