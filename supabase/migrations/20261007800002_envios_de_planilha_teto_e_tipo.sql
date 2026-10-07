-- Teto e tipo da pasta de envios da importação de planilha (Tiago,
-- 07/10/2026; continua a 20261007800001).
--
-- O bucket `orcamento-importacoes` não tinha limite: o teto de 10 MB e o
-- .xlsx/.xlsm valiam só na tela (`lib/importacao/limites.ts`), e quem
-- subisse direto pelo Storage mandava qualquer arquivo, de qualquer tamanho.
--
-- Aplicada DEPOIS do deploy do código que manda o tipo pela extensão do
-- arquivo (`app/(app)/orcamentos/_importacao/enviar-planilha.ts`). Até lá,
-- o navegador mandava o tipo que o sistema operacional informa, e um .xlsx
-- sem tipo conhecido seria recusado.
--
-- Altera a configuração de um bucket que já existe. Autorizada pelo Tiago
-- em 07/10/2026.

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroEnabled.12'
  ]
where id = 'orcamento-importacoes';
