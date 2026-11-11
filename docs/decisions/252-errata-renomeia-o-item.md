# 252 — A errata renomeia o item que já existe na planilha do job

**Data:** 2026-11-10
**Status:** aceita e implementada em 10/11/2026 (migration `20261110800001`); testada no Sandbox em 11/11/2026.
**Quem decidiu:** Tiago, em 10/11/2026, a partir do relato de que "não está sendo possível modificar o nome de itens em Editar planilha". A regra que ele tinha em mente: o nome muda, mas só com a errata aprovada pelo financeiro.
**Revê:** a [162](162-organizar-a-planilha-do-job-na-errata.md), que renomeava só o agrupamento. Completa a [226](226-linha-vermelha-fora-da-errata-e-versao-aprovada-com-as-erratas.md) (o orçamento lê o job) e a [191](191-item-da-planilha-no-pdf-da-pp.md) (o item no PDF da PP).

## O problema

No "Editar planilha" (a errata do GP), só a linha nova tinha o nome editável. A célula do item de uma linha que já existia era selecionada, ganhava a moldura, mas não abria. O banco também não tinha como gravar: `registrar_errata_do_job` corrigia valores, tipo e planejado da linha existente, e nunca o `item`. Não era regressão: a renomeação nunca tinha sido feita. A 191 já supunha que existisse ("se uma errata renomear a linha, o PDF já emitido continua com o nome antigo").

## As respostas do Tiago

| Pergunta | Resposta |
|---|---|
| Onde o nome muda? | Na **errata do GP**, que vai ao financeiro como toda errata. No "Editar planilha" do financeiro o nome não abre. |
| Onde o nome novo vale? | **No job e no orçamento**, com o de → para gravado no histórico dos dois. |
| Linha com PP enviada ao financeiro? | **Não muda de nome.** |
| Linha com PP só gerada? | **Muda**, depois de um pop-up que lembra que o item já tem PP e que o campo "Item" dela muda junto. |
| Linha cancelada ou travada pelo save? | Não abre (como os valores). |
| Errata que só renomeia? | Volta ao mural do financeiro como toda errata, com "Nenhum valor alterado" (a marca da 162). |
| Dica na linha renomeada | A pastilha "renomeado", com o nome de antes na dica. |

## A regra

1. **A célula do item abre na errata** (Enter, digitar ou duplo clique, como as outras), na linha que já existia. Não abre em: "Editar planilha" do financeiro, linha cancelada, linha travada pelo save, linha com PP que **chegou ao financeiro**. "Chegou" é `ppChegouAoFinanceiro`: qualquer status que não seja gerada ou cancelada, ou seja em avaliação, aprovada, paga e **rejeitada**. A PP cancelada não conta.
2. **Linha com PP enviada:** a célula selecionada mostra o cadeado com "nome travado". A dica explica que a linha tem PP enviada ao financeiro.
3. **Linha com PP gerada:** ao confirmar o nome, abre o pop-up "Este item já tem PP". Ele diz quais PPs são, o nome de → para, e que o PDF é refeito com o nome novo. Botões: "Renomear" e "Voltar".
4. **O nome vazio ou igual ao atual não muda nada.** Nome com mais de 200 caracteres é recusado na própria linha. Nome repetido é aceito: a planilha já tem itens com o mesmo nome em agrupamentos diferentes (191).
5. **A renomeação é organização, não valor.** Ela entra como `item_renomeado` na estrutura da errata, junto das mudanças da 162. O rodapé e o pop-up dizem "1 item renomeado". A errata que só renomeia devolve o job ao mural com "Nenhum valor alterado".
6. **Ao registrar a errata**, o nome é gravado em `jobs_itens_orcado.item`. O orçamento mostra o nome novo, porque a versão aprovada é lida do job desde a 226; a versão do cliente não é regravada. O histórico da planilha do job e o "Histórico" do orçamento (186, mesma reconstrução) voltam ao nome de antes nos momentos anteriores e marcam a linha com "renomeada" e o de → para.
7. **A PP gerada:** a ficha e o formulário já liam o item da linha. O PDF dela é refeito depois do registro (`refazerPdfsDasPPsGeradas`). Se o PDF falhar, a errata não volta atrás: a falha fica no log, e o próximo PDF refeito dela sai com o nome novo.
8. **Errata pronta para envio (159):** o nome novo vai junto (`estrutura.itens_renomeados`) e volta quando ela é reaberta. A pronta gravada antes desta decisão não tem o campo.
9. **Modelo mensal:** a linha renomeada conta como organização do mês dela. Mês já enviado para faturamento não muda.

## Onde mora

- Regra comum: `lib/calculos/organizacao-errata.ts` (`item_renomeado` em `mudancasDeEstrutura`, `resumoDaEstrutura`, `erroDoNomeDoItem`), com testes.
- Rascunho: `errata-rascunho.ts` (`nomes`, `editarNome` na linha existente, `nomeSalvoDe`, `itens_renomeados` no payload).
- Tela: `job-item-realizado-table.tsx` (o editor da célula, `ppsDoNomePorLinha`, o pop-up), `errata-confirmar-dialog.tsx` ("Item renomeado").
- Servidor: `actions-errata.ts` confere linha, cancelada, save e PP enviada antes de chamar o banco; manda `item_nome` com o nome novo na linha alterada; chama `refazerPdfsDasPPsGeradas` (`actions-pp.ts`).
- Banco: `registrar_errata_do_job` ganhou o bloco "itens renomeados", com as travas de nome vazio, linha cancelada ou de outro job e PP enviada. O resto da função é o corpo da `20261103600001`.
- Histórico: `lib/calculos/historico-da-planilha.ts` (`renomeada`, `itemDe`) e `historico-da-planilha.tsx`. O card do chat do job: `lib/data/job-chat.ts`.

## Como foi conferido

- **No Sandbox, de ponta a ponta (11/11/2026)**, como `admin@sandbox.local` no TES-1029/26 (P-0006/26):
  - Item 1 de outubro (PP-00572 aprovada) não abre e mostra "nome travado".
  - Item 2 de outubro (só a PP-00575, cancelada) foi renomeado sem pop-up.
  - Item 2 de novembro (PP-00729 gerada) abriu o pop-up e foi renomeado.
  - A errata "Teste da decisão 252" foi registrada com "Nenhum valor muda" e os dois "Item renomeado". No banco ficaram os dois nomes e o de → para em `jobs_erratas.estrutura`.
  - O PDF da PP-00729 foi refeito no mesmo segundo e traz o nome novo.
  - O Histórico do job mostra as duas linhas "renomeada", com o de → para na dica; a versão de 03/11 está com os nomes antigos.
  - O orçamento mostra os nomes novos, e o "Aprovada pelo cliente" do Histórico dele mostra os antigos.
- **Achado no teste:** depois do "Renomear" do pop-up, a seleção descia e, na última linha do grupo, abria um "Novo item" vazio. Agora a seleção fica no item renomeado.
- **Comportamento que já existia:** Enter numa célula que não abre (a travada, por exemplo) desce para a linha de baixo, e Enter que confirma o nome da última linha do grupo abre o "Novo item", como nos valores.
- Antes, em 10/11: a tela foi conferida em rascunho descartado no 2GB-1002/26 (produção), e a função do banco numa transação desfeita.
