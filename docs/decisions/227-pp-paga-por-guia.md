# 227 — A PP paga por guia: taxa, licença ou alvará de órgão público, sem NF

**Data:** 2026-10-29
**Status:** aceita e implementada (29/10/2026).
**Quem decidiu:** Tiago, em 29/10/2026, depois de uma rodada de protótipo
com os componentes reais
([Guia na PP](https://claude.ai/artifact/Daaz8wUTCWcko6DNBoco3N), versão 5).
**Revê:** a [161](161-pp-por-boleto-ou-chave-aleatoria.md) §1 (o Pagamento
ganha a quarta opção) e §5 (a guia não pede a nota).
**Migration:** `20261029900001_guia_na_pp.sql`.

## O que aconteceu

Licença de filmagem, uso de espaço público e taxas parecidas são pagas por
uma guia que a prefeitura (ou outro órgão) emite. Não há NF nesse
pagamento. A PP paga por boleto exige o boleto e a nota (161 §5), então a
produção não tinha como enviar a PP de uma taxa dessas ao financeiro.

O Tiago decidiu: é PP do job (a taxa é custo do job, não despesa da
empresa), o nome é **"Guia"**, e ela é um meio próprio, não uma opção dentro
de Boleto.

## A regra

1. **O campo Pagamento da PP** passa a ser `Cadastro do fornecedor | Chave
   aleatória | Boleto | Guia`. As quatro opções têm a mesma largura e ocupam
   a linha. Com Guia escolhida: "Taxa, licença ou alvará de órgão público.
   Anexe a guia abaixo, com o tipo Guia."
2. **"Guia" é um tipo de documento do anexo**, depois de Boleto: NF, Recibo,
   Fatura, Boleto, **Guia**, Contrato, Outro. Pede só o número do
   documento, como o boleto. Não é NF nem comprovante fiscal
   (`DOCUMENTO_TIPOS_FISCAIS` não muda): não pede "contra qual CNPJ" e não
   vale como "a nota" da PP paga por boleto.
3. **A guia exige só a guia no envio.** Com Guia escolhida, os anexos do
   formulário e do pop-up de envio mostram "Exigidos no envio: Guia", com ✓
   quando há arquivo do tipo Guia. O envio ao financeiro (e o "Deixar pronta
   para envio", 160) recusa sem ele — "Esta PP é paga por guia: anexe a
   guia, com o tipo Guia." — e **não pede NF**. As demais regras do envio
   (152) seguem: tipo e número de cada documento; se houver NF anexada, os
   dados dela.
4. **A leitura do anexo pela IA (192) reconhece a guia**: tipo e número,
   como nos outros documentos. A guia é o documento de arrecadação de órgão
   público (DAM, DAR, DARE, GRU…); boleto de cobrança de empresa continua
   boleto.
5. **O PDF da PP não muda de desenho** (127): na guia, a linha do PIX vira
   **"Pagamento: Guia"**.
6. **No painel do item**, a PP gerada paga por guia e ainda sem anexo diz
   "Ainda sem a guia: ela entra no envio." no lugar do aviso da nota.

## Onde a regra mora

| Parte | Arquivo |
| --- | --- |
| Meio `guia` e tipo `guia` | migration `20261029900001`: valor `guia` no enum `documento_tipo`; CHECKs `pp_fora_do_cadastro_meio_valido` e `pp_fora_do_cadastro_formato` |
| Tipos e o meio pago pelo anexo | `lib/types.ts`: `MeioForaDoCadastro`, `DOCUMENTO_TIPOS`, `MeioPeloAnexo` / `meioPeloAnexo` |
| Chave aleatória, boleto ou guia | `lib/validations/pagamento-fora-do-cadastro.ts` |
| O campo Pagamento | `pagamento-da-pp-field.tsx` |
| Guia exige a guia, sem NF | `faltaNosAnexosDoEnvio` (servidor, `actions-pp.ts`) e `faltaNosAnexosParaEnviar` + `ExigidosNoEnvio` (`anexos-da-pp.tsx`); o meio passa pelas telas em `pagaPeloAnexo` |
| Foto do pagamento | `lib/data/foto-pagamento-da-pp.ts`: como no boleto, a foto é o cadastro |
| PDF | `lib/pdf/pedido-compra.ts` (`pagamentoPeloAnexo`) |
| Leitura da IA | `lib/ia/ler-nf.ts` (`TIPOS_LIDOS` e o pedido) |
| Remessa | `actions-cnab.ts` recusa a parcela ("pague pela guia anexada"); `titulos-da-remessa.ts` não a lista; `lib/cnab/fora-do-cadastro.ts` |
| Financeiro e Comitê | `components/financeiro/pagamento-fora-do-cadastro.tsx` ("Guia · Pagar pela guia anexada"); `comite/_componentes/consulta-da-pp.tsx` |

## As telas do financeiro

O cartão "Fora do cadastro" mostra "Guia · Pagar pela guia anexada", e a
aprovação do pagamento fora do cadastro continua obrigatória, como no
boleto. Título de PP paga por guia não entra na remessa nem na baixa em
lote. O tipo Guia aparece também na lista dos anexos do financeiro (conta
avulsa e desembolso), que leem a mesma lista de tipos.

## O que ficou de fora

- **O código de barras da guia** (Tiago, 29/10): o protótipo testou a IA
  lendo o código e o sistema conferindo se é de órgão público (começa com 8;
  segmento 1, prefeitura, ou 5, governo; dígitos dos quatro blocos). Fica
  para quando se definir como a guia chega ao Contas a Pagar. Por ora o
  financeiro confere a guia na aprovação.
- **A remessa não paga guia**, como não paga boleto. No arquivo do banco, a
  guia seria o segmento O (tributos e concessionárias), não o J.
- **A coluna Documento** (Extrato e lançamentos) mostra só NF, recibo e
  fatura; a guia não entra nela.
- **A prestação de contas da verba** não oferece o tipo Guia.

## Como foi testado (29/10/2026)

Ver a nota de 29/10/2026 em `docs/handoffs/HANDOFF_JOBS.md`.
