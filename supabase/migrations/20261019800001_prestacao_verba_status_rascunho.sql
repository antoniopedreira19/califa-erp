-- ===========================================================================
-- Prestação de contas da verba: o status "rascunho" (decisão 189)
-- ===========================================================================
-- A produção passa a anexar os documentos um a um, salvos no banco antes do
-- envio — e desde que a PP foi enviada ao financeiro, mesmo antes de a verba
-- ser paga. A prestação nasce no primeiro documento salvo, como rascunho, e
-- só vai ao financeiro no envio único do fim (versão A do protótipo aprovado
-- em 19/10/2026).
--
-- Valor novo de enum fica sozinho na migration: ele não pode ser usado na
-- mesma transação em que é criado (docs/FLUXO-BANCO.md). As funções que o
-- usam estão na migration seguinte.
--
-- Aditivo: as prestações que já existem (todas aprovadas em 19/10/2026) não
-- mudam. Quem lê a prestação trata o rascunho como "ainda não enviada"
-- (`situacaoDaVerba` e a fila do financeiro, no código).

alter type public.pp_verba_prestacao_status add value if not exists 'rascunho' before 'em_avaliacao';
