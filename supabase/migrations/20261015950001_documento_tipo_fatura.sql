-- ============================================================================
-- Decisão 178 (15/10/2026): "Fatura" entre os tipos de documento do anexo.
--
-- Uma produtora anexou a fatura de locação de banheiros químicos de uma PP
-- e marcou "Recibo", porque a lista não tinha opção melhor: na locação de
-- bens móveis o fornecedor emite fatura, não nota fiscal de serviço. O
-- Tiago pediu a opção "Fatura", genérica; o contrato de locação continua no
-- "Contrato", que já existe.
--
-- O que muda no banco, e só isto: o valor `fatura` no enum
-- `documento_tipo`, logo depois de `recibo`. É aditivo: nenhuma linha
-- muda, e os anexos antigos marcados "Recibo" ou "Outro" ficam como estão
-- (não se adivinha o tipo pelo nome do arquivo).
--
-- O enum é de cinco tabelas de anexo: as da PP, da PP a emitir, da conta
-- avulsa, do desembolso e da prestação de verba. Nas quatro primeiras o
-- tipo novo aparece na lista sozinho (as telas leem `DOCUMENTO_TIPOS`). A
-- prestação de verba continua só NF ou recibo: a trava é da função
-- `enviar_prestacao_verba`, que não muda.
--
-- Como a fatura se comporta é regra do app (lib/types.ts): ela vale como
-- comprovante da despesa, como o recibo — pede só o número, entra na
-- coluna Documento e vale como "a nota" da PP paga por boleto (decisão
-- 161). Não é NF: não entra no cadastro de notas (decisão 152) nem no
-- fiscal.
--
-- Sem tabela, função ou policy nova: GRANT e RLS ficam como estão.
-- ============================================================================

alter type public.documento_tipo add value if not exists 'fatura' after 'recibo';

comment on type public.documento_tipo is
  'Que documento o anexo é. Acrescentar valor aqui é aditivo — o enum começou no conjunto mínimo que o time nomeou (28/08/2026). "fatura" entrou na decisão 178 (15/10/2026).';
