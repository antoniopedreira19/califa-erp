# 284 — "Apólice" entre os tipos de documento do anexo, para pagamentos de seguro

**Data:** 2026-11-27
**Status:** aceita e implementada (27/11/2026).
**Quem decidiu:** Antonio, em 27/11/2026, a partir do relato de que a equipe
está lançando pagamentos de seguro e o sistema fica pedindo NF.
**Revê:** nada. Espelha a [178](178-fatura-revisao-sem-nf-e-previa-da-pp.md) §1
("Fatura" entre os tipos de documento).
**Migration:** `20261127100001_documento_tipo_apolice.sql`.

## O que aconteceu

O financeiro começou a lançar pagamentos de seguro e esbarrou em NF
obrigatória nas quatro superfícies de anexo (PP, conta avulsa, desembolso,
prestação de verba). A seguradora **não emite NF de serviço** — emite
**apólice + boleto** —, e a lista de tipos não tinha opção que casasse: ou
marcavam como "Outro", que não vale como comprovante fiscal e não passa
no envio por boleto (decisão 161 §5 + 178 §1), ou tentavam "Recibo" / "Fatura"
e ficavam com rótulo errado no dossiê e na Conciliação.

A situação é idêntica à da decisão 178 (locação de banheiros químicos em
15/10/2026): fornecedor que emite fatura, não NF. A receita já está
desenhada — basta adicionar mais um valor ao enum.

## A regra

1. **"Apólice" é um tipo de documento do anexo**, entre Fatura e Boleto:
   NF, Recibo, Fatura, **Apólice**, Boleto, Guia, Contrato, Outro.
   - Pede só o **número do documento** (número da apólice), como a fatura
     e o recibo. Não é NF: não abre os dados da nota, não entra no cadastro
     de notas (decisão 152) nem no fiscal (não gera crédito de PIS/COFINS).
   - Vale como **comprovante da despesa** (`DOCUMENTO_TIPOS_FISCAIS`):
     entra na coluna Documento e vale como "a nota" da PP paga por boleto
     (161 §5 + 178 §1). Boleto + apólice passa no envio.
   - Aparece também na lista dos anexos do financeiro (conta avulsa e
     desembolso), que leem a mesma lista de tipos.
   - A **prestação de contas da verba** continua só NF ou recibo (a trava é
     da função `enviar_prestacao_verba`, que não mudou).
2. **CNPJ do anexo:** por estar em `DOCUMENTO_TIPOS_FISCAIS`, a apólice
   herda a regra da decisão 156 (revisada em 178) — no envio da PP ela pede
   "contra qual CNPJ foi emitida". É o CNPJ do segurado, uma das PJs da
   gestão (California, Hitlab, GoCrazy).
3. **Fiscal:** a apólice **não gera crédito de PIS/COFINS** e **não entra
   na apuração**. Fica fora do módulo fiscal, como a fatura.

## O que não muda

- Os anexos antigos marcados "Recibo", "Fatura" ou "Outro" ficam como estão:
  o tipo não se adivinha pelo nome do arquivo. Quem quiser trocar troca no
  envio ou na edição.
- A trava do envio (decisão 152) é a mesma: anexo, tipo e número; os dados
  da NF só no arquivo NF.
- A prestação de contas da verba (decisão 189) segue só NF ou recibo.

## Onde a regra mora

| Parte | Arquivo |
| --- | --- |
| Lista de tipos, rótulo e comprovantes | `lib/types.ts` (`DOCUMENTO_TIPOS`, `documentoTipoLabel`, `DOCUMENTO_TIPOS_FISCAIS`) |
| "A nota" da PP por boleto | `actions-pp.ts` (`faltaNosAnexosDoEnvio`) e `anexos-da-pp.tsx` (`faltaNosAnexosParaEnviar`) — consomem `DOCUMENTO_TIPOS_FISCAIS` |
| CNPJ do documento | `lib/fiscal/cnpj-da-pp.ts` (`documentoTemCnpj`) — consome `DOCUMENTO_TIPOS_FISCAIS` |
| Coluna Documento (Conciliação) | `lib/data/lancamento-linha.ts` — consome `DOCUMENTO_TIPOS_FISCAIS` |
| Enum no banco | `public.documento_tipo` (valor `apolice`) |

## Como foi testado (27/11/2026)

- Migration aplicada pelo MCP; enum conferido pelo MCP:
  `nota_fiscal, recibo, fatura, apolice, boleto, guia, contrato, outro, cupom_fiscal, orcamento`.
- `lib/types.ts` atualizado: `DOCUMENTO_TIPOS` com `apolice` depois de
  `fatura`; `documentoTipoLabel("apolice") = "Apólice"`;
  `DOCUMENTO_TIPOS_FISCAIS` passa a incluir `apolice`.
- Como `DOCUMENTO_TIPOS_FISCAIS` é consumido por `faltaNosAnexosDoEnvio`,
  `faltaNosAnexosParaEnviar`, `documentoTemCnpj` e a coluna Documento da
  Conciliação, a apólice passa a contar como "a nota" automaticamente nas
  quatro superfícies (PP, conta avulsa, desembolso, extrato).

## Pendências

- Nenhuma. Se a seguradora emitir NF (seguros de vida em grupo via
  corretora, por exemplo), o fluxo normal de NF continua valendo.
