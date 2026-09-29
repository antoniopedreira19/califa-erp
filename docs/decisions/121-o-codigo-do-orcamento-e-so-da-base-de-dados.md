# 121 — O código do orçamento é só da base de dados; na tela, o código é o do job

**Data:** 2026-09-29
**Decidido por:** Tiago
**Migration:** nenhuma.

---

## 1. A regra

Nas palavras do Tiago, em 29/09/2026:

> Percebi que a produção estava se confundindo com os códigos diferentes. O
> único que tem alguma importância para eles é o do job que já estará
> aberto, que é necessário enviar para abertura no financeiro.

E, sobre as telas do financeiro:

> O código do orçamento só serve para a base de dados, não serve para o
> controle interno e só causaria confusão.

Por isso, **o código do orçamento (`TES-P002/26-01`) não aparece em nenhuma
tela nem arquivo do sistema**. O código continua gravado em
`orcamentos.codigo`, único por tenant, e segue ordenando as listas. Ninguém
mais o digita nem o lê.

As respostas que fecharam o desenho:

| Pergunta | Resposta |
|---|---|
| Na lista "Orçamentos do projeto", o que a coluna Código mostra? | O código do **job vivo** do orçamento. Clicar nele abre o job, e o resto da linha continua abrindo o orçamento. |
| E o orçamento sem job? | Travessão. |
| E o orçamento que só tem job cancelado? | Travessão também: o número do job cancelado morreu (TES-P001/26-12, com o TES-1010/26 cancelado). |
| A coluna troca de nome para "Job"? | Não. Continua "Código". |
| Só a lista, ou todo lugar? | **Todo lugar**, inclusive o financeiro. |

## 2. O job vivo

É o job não cancelado mais recente do orçamento (`jobVivoDoOrcamento`, em
`lib/calculos/funil.ts`). O código do job nasce no envio para abertura, com o
status `aguardando_abertura`, antes de o financeiro abrir. Por isso ele já
aparece na lista desde o envio.

Quando o financeiro devolve o job e a produção reenvia, ele mantém o mesmo
código. Quando o envio é cancelado, o job cancelado deixa de contar. No
TES-P002/26-02, por exemplo, o TES-1011/26 foi cancelado e o TES-1012/26 é o
job vivo.

## 3. Onde o código do orçamento saiu

| Onde | Antes | Agora |
|---|---|---|
| Lista "Orçamentos do projeto" | TES-P002/26-01 | Código do job vivo, ou "—" |
| Cabeçalho da página do orçamento | Linha com o código acima do nome | Só o nome; o "Ver job" ao lado leva ao job |
| Abas da faixa do projeto (módulo Orçamentos) e balão do Voltar | "código · nome" | Só o nome, na mesma ordem de antes |
| "Editar orçamento" | Código no título e campo **editável** "Código" | Título sem código. O campo saiu, e o "Projeto" travado ocupa o lugar dele, como na criação |
| Pop-ups de aprovação e de envio para abertura | "Orçamento X" | Nome do orçamento |
| Visão agregada: cartões, Totais, modal de importação e mensagens de erro | Código real, ou o previsto nos novos | Nome; o cálculo do código previsto saiu |
| "Novo orçamento de job" da agregada | "O código será gerado quando…" | "O orçamento será criado quando…" |
| Ficha do job, "Orçamento aprovado" (jobs e financeiro) | "X · Teste 1 - V1" | "Teste 1 - V1" |
| Card de abertura no chat do job | "Criado a partir do orçamento X · v1" | "Criado a partir do orçamento “Teste 1” · v1" |
| **PDF da PP**, que vai ao fornecedor | "Orçamento: X", sem o código do job | **"Job: TES-1008/26"** |
| Planilhas exportadas (versão e projeto) | "X · nome" na A1 e nos títulos das seções; código no nome do arquivo | Nome; o nome do arquivo usa o nome do orçamento, sem acento |
| Gaveta de importação do projeto | Código na prévia, no resultado e nas mensagens | Nome e versão vigente |
| Financeiro: conferência e abertura do job | "Vem do orçamento X", "Orçamento de origem X" | Nome do orçamento |

## 4. O que não mudou

- **A importação não depende do código.** Ela reconhece o orçamento pelo
  identificador oculto `orc:<uuid>` da planilha exportada; o título da seção
  é só texto de apoio.
- **Nenhuma busca usava o código do orçamento.** As buscas são por código de
  projeto e de job.
- **O banco não muda.** O código segue sendo gerado na criação
  (`gerarCodigoOrcamento`) e fica na auditoria (`orcamento.criado`), que só o
  administrador vê.
- **Os códigos de projeto e de job continuam onde estavam.**

## 5. Junto: o "Editar projeto" em pop-up (opção C)

Na mesma entrega, o "Editar projeto" deixou de ser um drawer de 512 px e
virou um pop-up centralizado sobre a página. O pop-up tem a largura do
cartão do "Novo projeto" (`max-w-3xl`), então os campos ficam do mesmo
tamanho da criação.

No pé do formulário, na mesma linha, ficam o Status e o Arquivar/Reativar à
esquerda e o Cancelar e o Salvar à direita. Para isso, o `ProjetoForm` ganhou
o `rodapeEsquerda`. O Tiago escolheu entre quatro desenhos no protótipo de
28–29/09/2026.

## 6. Revisão de 29/09/2026: o PDF da PP fica só com o código do job (decisão 126)

A linha "Projeto", que ficava logo abaixo do "Job", também saiu do PDF da
PP. Nas palavras do Tiago: "Deveria ser o código do Job". As 47 PPs que já
existiam foram refeitas com o modelo novo. Ver a decisão 126.
