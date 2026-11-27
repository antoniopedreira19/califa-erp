-- ============================================================================
-- Decisão 284 (27/11/2026): "Apólice" entre os tipos de documento do anexo.
--
-- O financeiro está lançando pagamentos de seguro (seguradora emite apólice
-- + boleto, nunca NF de serviço), e o sistema pedia NF em todas as superfícies
-- de anexo (PP, conta avulsa, desembolso). Mesmo padrão da decisão 178
-- (fatura de locação): o fornecedor não emite NF, então o tipo do documento
-- precisa existir e contar como comprovante fiscal.
--
-- O que muda no banco, e só isto: o valor `apolice` no enum `documento_tipo`,
-- logo depois de `fatura`. É aditivo: nenhuma linha muda.
--
-- Como a apólice se comporta é regra do app (lib/types.ts): ela entra em
-- DOCUMENTO_TIPOS_FISCAIS — vale como comprovante da despesa, como a
-- fatura e o recibo; pede só o número; entra na coluna Documento e vale como
-- "a nota" da PP paga por boleto (decisão 161). Não é NF: não entra no
-- cadastro de notas (decisão 152) nem no fiscal (não gera crédito de
-- PIS/COFINS).
--
-- Sem tabela, função ou policy nova: GRANT e RLS ficam como estão.
-- ============================================================================

alter type public.documento_tipo add value if not exists 'apolice' after 'fatura';

comment on type public.documento_tipo is
  'Que documento o anexo é. Acrescentar valor aqui é aditivo — o enum começou no conjunto mínimo que o time nomeou (28/08/2026). "fatura" entrou na decisão 178 (15/10/2026). "apolice" entrou na decisão 284 (27/11/2026).';
