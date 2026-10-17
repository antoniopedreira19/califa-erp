-- Decisão 187 (17/10/2026) — PP de reembolso, parte 1 de 2.
--
-- O comprovante mais comum de um reembolso de despesa é o cupom fiscal
-- (NFC-e) do restaurante, do posto ou da loja. Ele entra como tipo próprio
-- do anexo da PP — o mesmo tipo proposto no protótipo da "nota depois do
-- pagamento" (16/10), que ainda aguarda aprovação para a PP normal.
--
-- Nesta decisão o tipo só é oferecido nos comprovantes do reembolso. As
-- listas de tipo da PP normal, a conferência da NF e o módulo fiscal não
-- mudam: o fiscal só registra anexos do tipo nota_fiscal.
--
-- Valor novo em enum fica sozinho na migration: ele não pode ser usado na
-- mesma transação em que é criado (docs/FLUXO-BANCO.md).

alter type public.documento_tipo add value if not exists 'cupom_fiscal';
