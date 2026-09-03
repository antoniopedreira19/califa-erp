-- ---------------------------------------------------------------------------
-- PP nasce GERADA, e só depois é enviada ao financeiro (02/09/2026).
--
-- Até aqui "Gerar PP" gravava a PP direto em `em_avaliacao`: gerar e enviar
-- eram o mesmo clique. Decisão do Tiago (02/09/2026): a PP passa a nascer
-- como rascunho do job — status `gerada` — e o envio ao financeiro vira uma
-- ação separada, por PP, ao lado de editar, ver e cancelar.
--
-- Esta migration só acrescenta o valor ao enum. O resto (colunas de envio,
-- fim do teto por PP, realizado sem PP gerada) fica na migration seguinte:
-- `ALTER TYPE ... ADD VALUE` não deixa o valor novo ser usado na mesma
-- transação em que foi criado.
--
-- Aditiva: nenhuma linha muda. As 17 PPs existentes continuam onde estão.
-- ---------------------------------------------------------------------------

alter type public.pp_status add value if not exists 'gerada' before 'em_avaliacao';
