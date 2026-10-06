-- =====================================================================
-- Modelo de planilha "midia_off" (decisão 147)
--
-- A Mídia Off ganhou planilha própria: por mês, com a campanha inteira,
-- um card por meio (grade de inserções por dia para TV e rádio; período
-- para OOH, DOOH e portais) e a conta da mídia (veículo + honorários). A
-- decisão 131 deixou a categoria "Mídia Off" pronta e travada como "em
-- breve", com modelo_planilha = 'nacional' só porque o enum precisava de
-- um valor, e combinou o caminho: o valor novo do enum numa migration
-- SOZINHA (um valor de enum não pode ser usado na mesma transação em que
-- é criado) e, depois, a troca do modelo da categoria com o "em breve"
-- desligado.
--
-- Esta migration só cria o valor. Ninguém o usa ainda: a categoria só
-- passa para 'midia_off' na migration que libera a Mídia Off, junto do
-- código. Aditivo.
-- =====================================================================

alter type public.categoria_modelo_planilha add value if not exists 'midia_off';
