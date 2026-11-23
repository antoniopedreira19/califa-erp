# 271 — O controle único de NFs: a seção Notas Fiscais e os seis pontos

**Data:** 2026-11-23
**Status:** aceita em 23/11/2026. O ponto 3 está implementado (decisão
[269](269-nf-da-prestacao-entra-no-cadastro-no-envio.md)); os pontos 1, 2 e 6
e a seção Notas Fiscais aguardam a revisão do protótipo e a implementação; o
ponto 5 vai junto com a revisão das retenções; o ponto 4 não pede nada.
**Quem decidiu:** Tiago, sobre o protótipo "Notas Fiscais" da Central
Financeira (v3 a v6, 23/11/2026), com um seletor por ponto:
https://claude.ai/artifact/2JLetfAPvFHaNr9kZJKX5f.
**Relaciona-se com:** [152](152-nf-do-fornecedor-com-cadastro-proprio.md)
(cadastro único de notas), [189](189-prestacao-de-contas-da-verba-documento-a-documento.md)
(prestação da verba), [187](187-pp-de-reembolso.md) (PP de reembolso),
[264](264-desembolso-com-comprovante-e-nf.md) (desembolso, que deixou estes
pontos para cá) e [269](269-nf-da-prestacao-entra-no-cadastro-no-envio.md).

## Onde fica

Uma seção própria na Central Financeira, **Notas Fiscais**
(`/financeiro/notas-fiscais`), com duas abas:

- **Emitidas** — as NFs que as empresas da California emitem (faturamento,
  BV, save, avulsa e o histórico da planilha).
- **Recebidas** — as NFs emitidas contra as empresas da California, de todas
  as origens: PP, desembolso, prestação da verba, folha PJ, avulsas e
  recorrências. É o controle único de NFs.

Cada aba é uma tabela com os dados registrados de cada NF (número, emissão,
emitente ou tomador, CNPJ, origem e documento, valor, situação e
pagamento/recebimento), com filtro por período, por CNPJ e por coluna.

## Os seis pontos

| # | Tema | Decisão |
|---|---|---|
| 1 | NF do PJ (folha) | Entra no cadastro de notas com o **colaborador como emitente**, sem fornecedor espelho. A NF do PJ passa a ter número, emissão e valor no envio; a chave da busca é CNPJ + número. |
| 2 | Avulsas e recorrências | A NF de cada mês entra pelo **título do mês** (o documento da cobrança), no cadastro de notas e com saldo. A avulsa segue a mesma regra, pelo próprio título. |
| 3 | Prestação da verba | A NF entra no cadastro **no envio** da prestação. Implementado na 269. |
| 4 | NF do reembolso | **Fica fora** do cadastro de notas, na PP de reembolso e no desembolso de reembolso: ali a NF só comprova o gasto. Quando a NF sai em nome da California, quem paga é a própria California, por PP ou desembolso ao fornecedor. Em 23/11, as 6 NFs das 54 PPs de reembolso estavam sem tomador da California. |
| 5 | Retenções na aprovação | Retenções e crédito de PIS/COFINS na aprovação do **desembolso e da avulsa**, como na PP. Entra junto com a revisão das retenções, não antes. Em 23/11 havia 0 PPs com retenção na aprovação e 5 baixas com retenção. |
| 6 | NF com erro | **O financeiro corrige** número, emissão, valor e CNPJ da nota enquanto ela não foi registrada. Todos os documentos ligados à nota (PP, desembolso, prestação) acompanham a correção, e fica o registro de quem mudou. Substitui o "rejeita para quem enviou corrigir" que a 264 deixou no desembolso. A correção fica no painel da nota, na aba Recebidas. |

## Em aberto (para a implementação do ponto 6)

- **Qual CNPJ:** só o tomador (como a correção da NF da PP de 07/10) ou
  também o emitente, o que muda o fornecedor da nota e de todos os
  documentos dela.
- **Número que já existe:** quando o número corrigido já é de outra nota do
  mesmo fornecedor, juntar as duas (como a correção da PP faz hoje, com o
  saldo conferido) ou recusar.
- **A correção que a PP já tem** (GP, administrador, financeiro e o produtor
  com a chave, com a PP em avaliação): fica junto com a do controle, ou sai.
- Hoje a correção da PP só atualiza os dados copiados nas outras PPs: o
  desembolso e a prestação com a mesma nota ficam com os dados antigos, e
  apagar a nota antiga falha se um desembolso ainda a usa. A correção do
  ponto 6 cobre os três.
- O texto da tela do desembolso "Registrada no controle de notas (Fiscal ›
  Notas recebidas)" aponta para uma tela que não existe; passa a apontar
  para Notas Fiscais › Recebidas quando ela existir.

## Retrato de 23/11/2026 (produção)

204 notas não registradas: 195 em PPs, 9 em prestações, nenhuma em
desembolso; 75 notas estão em mais de um documento. A correção da NF da PP
foi usada 2 vezes (a última em 26/10).
