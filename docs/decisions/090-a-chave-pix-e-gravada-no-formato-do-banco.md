# 090 — A chave PIX é gravada no formato que o banco aceita

**Data:** 2026-09-18
**Decidido por:** Tiago
**Migrations:** nenhuma — a base já estava no formato certo (ver §4).

---

## 1. O problema

Dois relatos no mesmo dia:

1. **A produção não conseguia escolher o tipo de chave.** O campo era um
   `<select>` nativo, e dentro do dialog de cadastro rápido (o "+" do
   fornecedor na PP) o menu do sistema operacional brigava com o foco do
   Radix: abria e não aplicava a escolha.
2. **O formato do que era gravado não servia para pagar.** O plano é
   gerar arquivo de remessa **CNAB** para pagar fornecedor, e o CNAB
   carrega a chave exatamente como o DICT a guarda. Telefone era gravado
   como `11999999999`, sem o `+55`; a chave aleatória ia como a pessoa
   colasse — maiúscula, sem hífen, ou com 35 caracteres.

O segundo é o caro: chave fora do formato não dá erro na hora. Ela é
aceita, fica gravada torta, e volta meses depois como pagamento devolvido,
quando ninguém lembra de onde veio.

## 2. A regra

> **A chave PIX se grava no canônico do DICT, não como foi digitada.** A
> tela mostra no formato de leitura; o banco de dados guarda o que o
> arquivo de pagamento vai levar.

| tipo | grava | exemplo |
|---|---|---|
| CPF | 11 dígitos | `12345678901` |
| CNPJ | 14 dígitos | `12345678000190` |
| Telefone | E.164, com o país | `+5511999999999` |
| E-mail | minúsculas, sem espaço | `financeiro@fornecedor.com.br` |
| Chave aleatória | UUID minúsculo, com hífens | `123e4567-e89b-12d3-a456-426614174000` |

- **A conversão mora em `lib/pix.ts` (2a)**, usada pela gravação e pela
  tela. `normalizarChavePix` produz o canônico; `chavePixParaExibir` faz o
  caminho de volta (só o telefone muda: o `+55` sai, porque a máscara é de
  número brasileiro).
- **O campo diz o que vai ser gravado (2b).** Embaixo da caixa aparece a
  linha do tipo escolhido — "Gravamos com o país na frente (+55)…" — para
  quem digita não se surpreender com o que foi salvo.
- **A aleatória passou a ser validada como EVP (2c):** 32 hexadecimais,
  com ou sem hífens. Antes valia "32 a 36 caracteres alfanuméricos", que
  aceitava chave que o banco recusa.
- **O telefone aceita o `+55` digitado ou não (2d)**: o que conta são os
  10 ou 11 dígitos finais.

## 3. O tipo de chave não é mais um `<select>` nativo

Os dois campos de lista do cadastro de fornecedor — **Tipo de chave** e
**Tipo de conta** — passaram a usar o `Select` do sistema, o mesmo do
resto do ERP. Resolve o relato da produção de raiz: a lista é DOM, dentro
do dialog, e não depende do menu do sistema operacional.

⚠️ **18/09/2026 — não resta nenhum.** O Tiago mandou fazer todos, a
começar pelos de risco. Os 11 `<select>` nativos do sistema viraram
`Select` ou `Combobox`, pela mesma conta da [089](089-lista-longa-se-busca-e-o-codigo-do-cliente-nao-aparece.md):
lista que pode passar de ~15 itens vai de Combobox (com busca), o resto
vai de Select.

| tela | campo | virou | conferido na tela |
|---|---|---|---|
| Cadastro de fornecedor | Tipo de chave, Tipo de conta | Select | ✅ (dentro da PP, como GP) |
| Prestação de contas | Tipo do documento | Select | ❌ — ver abaixo |
| Anexo (PP, conta avulsa, desembolso) | Tipo do documento | Select | ✅ (anexo na PP) |
| Fatura de cartão | Tipo, Subtipo | Combobox | ❌ — ver abaixo |
| Conta avulsa | Parcelas (24) | Combobox | ✅ |
| Cartão de crédito | Empresa do cartão | Select | ✅ |
| Calendário de jobs | Regional, GP | Combobox | ✅ (Regional) |
| Calendário de jobs | Agrupamento, Ordenação | Select | ✅ (Agrupamento) |
| Fluxo de caixa | Conta, período, visão | Select | ✅ |

**Dois não puderam ser abertos na tela, por falta de estado no banco**, e
ficam registrados como tal: **Fechar fatura de cartão** (não existe fatura
de cartão em aberto) e **Prestação de contas** (não existe PP de verba
paga sem prestação já feita). Os dois são Select/Combobox iguais aos que
foram exercitados, no mesmo formato, com `tsc`, `lint` e `build` limpos —
mas ninguém clicou neles.

**Cuidado ao conferir:** o Radix Select renderiza um `<select>` nativo
escondido (`aria-hidden="true"`, `tabIndex="-1"`, `position:absolute`)
para o formulário. Procurar `document.querySelectorAll('select')` acha
esses e dá falso positivo — filtre pelos dois atributos.

**O `<select>` nativo não volta.** A regra está em
`docs/09-identidade-visual-ui.md`: campo de escolha do ERP é `Select` ou
`Combobox`, nunca o menu do sistema operacional.

## 3b. O CPF/CNPJ já é validado por dígito verificador

⚠️ **18/09/2026.** Fica registrado porque a dúvida apareceu e custou uma
apuração: **o dígito verificador do documento JÁ é conferido**, no cadastro
de fornecedor e no de cliente, pelo `isValidCnpj`/`isValidCpf` de
`lib/utils.ts`, chamados dentro dos schemas Zod. Os dois últimos dígitos
do CPF e do CNPJ são calculados a partir dos outros (módulo 11), e é isso
que pega erro de digitação — dois números trocados não fecham a conta.

Conferida a base inteira em 18/09/2026: dos **157 clientes e 30
fornecedores** com documento gravado, **nenhum** tem dígito verificador
errado. Para o CNAB, que leva o CNPJ do favorecido, isso já está de pé —
o que faltava era o formato da chave PIX, que é o assunto desta decisão.

## 4. A base já estava certa

Conferido antes de mexer: os 23 fornecedores com chave PIX estavam todos
no formato (16 CPF/CNPJ só com dígitos, 7 e-mails minúsculos). Não havia
nenhum telefone nem chave aleatória gravados — que são justamente os dois
tipos cujo canônico mudou. **Por isso não houve backfill**: não havia o
que corrigir, só o que impedir daqui para frente.
