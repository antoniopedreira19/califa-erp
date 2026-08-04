-- =====================================================================
-- "Finalizado" passa a se chamar "Encerrado".
--
-- É o destino do botão "Enviar job para encerramento" do design. O fluxo
-- de encerramento em si ainda não existe, então o botão fica desabilitado
-- e nenhuma transição leva a este status por enquanto — ele segue no enum
-- esperando o fluxo ser construído.
--
-- Rename em vez de valor novo: nenhum job estava em 'finalizado', e o
-- conceito é o mesmo, só mudou o nome.
-- =====================================================================

alter type job_status rename value 'finalizado' to 'encerrado';
