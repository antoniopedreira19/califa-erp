# 148 — A visão agregada salva cada alteração na hora (entrega 1)

**Data:** 2026-10-06
**Quem decidiu:** Tiago — "Vamos salvar por células mesmo para garantir que erros não ocorram, e não hajam interferências quando mais de uma pessoa vir a mexer" (06/10/2026), com o protótipo aprovado no mesmo dia ("Aprovado, pode seguir com a entrega 1") e a criação do orçamento junto na entrega 1.
**Continua:** a correção da duplicação no AMB-P017/26 (nota de 06/10/2026 no `HANDOFF_ORCAMENTO.md`). Aquela correção fechou a porta das cópias; esta tira o salvamento em lote, que era onde ela estava.

## Por quê

Até aqui a agregada guardava tudo na memória da página e mandava de uma vez no "Salvar alterações". Foi esse lote que, em 05/10/2026, recriou os orçamentos novos a cada salvamento (9 orçamentos viraram 45). Com a gravação por célula não sobra nada "por salvar" na página: cada alteração vai sozinha ao banco, pelas mesmas actions e travas da tela da versão, e o que uma pessoa muda numa célula não espera o salvamento de ninguém.

## Como cada coisa grava

| O quê | Como grava |
|---|---|
| Célula do item | `atualizarCampoItem`, ao sair da célula. A tela muda na hora; recusada, a célula volta ao valor de antes e o motivo aparece. |
| "Novo item" (linha de rascunho) | `adicionarItem`, como na versão. |
| Linha em branco do "Criar planilha" e do "Novo grupo" | Fica só na tela até ganhar descrição (sem descrição o banco recusa o item); com a descrição, vira item por `adicionarItem` e a linha passa a ter o id real. |
| Remover e mudar item de lugar | `removerItem` e `moverItem` (decisão 104). |
| Grupo novo | `criarGrupo` na hora, com nome livre: "Novo grupo", "Novo grupo 2"… (o nome é único na versão; no mensal, no mês). |
| Nome do grupo | `renomearGrupo` ao sair do campo ou no Enter, e não a cada tecla. Esc desfaz; campo vazio volta ao nome de antes; nome repetido é recusado e volta. |
| Remover grupo | `removerGrupo`, depois da confirmação. Os itens e os BVs deles saem junto. |
| Importar planilha (card sem planilha) | `importarPlanilhaNaAgregada` → `sobrescreverVersaoComPlanilha`, a importação da tela da versão: registra em `orcamento_importacoes` e descarta o arquivo (decisão 129). Recusada, o diálogo fica aberto com o motivo. |
| Parâmetros do orçamento | `atualizarVersao`, só com `percentual_imposto`, nas travas da versão (internacional, aprovada). Vale só para aquele orçamento. |
| BV | O formulário de BV da versão, gravando direto (`salvarBv`, `cancelarBv`). A lista de BVs de cada item vem do servidor (`bvsPorItem`). |
| Criar orçamento de job | `criarOrcamentoDaAgregada`: ao confirmar o formulário o orçamento nasce gravado, com a v1 vazia. A chave do formulário vai para `orcamentos.chave_rascunho`, e o segundo envio do mesmo formulário é recusado ("Este orçamento já foi criado. Recarregue a página para vê-lo."). Fee, Always On e Mídia Off continuam nascendo só pela tela "Novo orçamento". |

- **O rodapé "Salvar alterações" saiu.** No lugar, o estado da gravação no topo: "Salvando…", "Tudo salvo · 14:35", "Não salvou — a alteração foi desfeita".
- **Sair com gravação a caminho** (voltar, abas da faixa, fechar a aba) pergunta antes: "Ainda salvando".
- **Sem recarregar a página por célula** (`docs/PERFORMANCE.md`): a tela é a referência. Recarrega só depois de criar orçamento, importar, aplicar parâmetros e gravar BV — o que vem calculado do servidor.
- **Orçamento aprovado ou já aberto como job** continua só consulta, como antes. A agregada nunca cria versão nova.
- **Permissão no servidor.** As actions são as da versão, com as checagens delas. `sobrescreverVersaoComPlanilha` passou a conferir `orcamentos.editar` (antes só o botão escondia).
- **Saiu do código:** o salvamento em lote (`salvarOrcamentosDoProjeto`, `salvarAlteracoesDoProjeto`, `_rascunho/salvar-em-lote.ts`) e os tipos do payload dele.

## Armadilha: a planilha chama o editor de dentro de uma transição

A `ItensTable` grava dentro de um `startTransition`. O React embutido no Next 14 marca como transição só o que o adaptador muda **antes** do primeiro `await`, e segura essas mudanças até a gravação voltar. Ao dar nome à linha em branco, a descrição entrava como transição e a troca do id (depois do `await`) não: com as duas na mesma fila, cada render refazia a lista de orçamentos, o efeito do Serviço Interno (decisão 105) rodava de novo e a tela entrava em laço ("Maximum update depth exceeded"). A descrição nunca chegava ao cabeçalho do card nem ao Totais, embora estivesse no banco.

Correção: cada função do adaptador espera um tique (`foraDaTransicao`) antes de mexer no estado — o card e o Totais acompanham a célula na hora —, e o efeito do Serviço Interno só chama o `setState` quando há linha a corrigir.

## Testado no navegador, gravando no banco (TES-P001/26)

- Célula editada, item novo pelo "Novo item" e removido, grupo renomeado (sair do campo e Enter), nome repetido recusado e desfeito, grupo removido.
- "Criar orçamento de job" → `TES-P001/26-24 · ZZ Teste 148 autosave`, com a v1 e a chave; a faixa e o Totais o mostraram sem recarregar.
- "Criar planilha" e "Novo grupo" → grupos no banco; a linha em branco, ao ganhar descrição, virou item com o id real; valores de célula no Totais em 50 ms, antes de a gravação voltar; nenhum aviso de laço depois da correção.
- Parâmetros aplicados (a versão gravou), BV de R$ 20.000,00 no item tipo A (o botão do item passou a "Abrir BV").
- Importação no `TES-P001/26-25 · ZZ Teste 148 importação`, com a exportação interna do "Teste importação 110": 2 grupos e 3 itens, iguais à prévia; registro em `orcamento_importacoes` sem caminho; nada deixado em `envios/`.
- Os dois ZZ 148 ficaram no projeto de teste.

## Entrega 2 (próxima): excluir orçamento completamente vazio

Combinado com o Tiago em 06/10/2026:

- **Vazio** = rascunho, nunca aprovado, sem job e sem item em nenhuma versão. Grupo sem item conta como vazio; a linha em branco que ainda não está no banco não conta.
- **Quem:** quem tem `orcamentos.criar` (administrador, gerente de projeto — `gerente_producao` — e produtor).
- **Onde:** a lixeira no card da agregada, só no orçamento vazio, e "Excluir" no rodapé do "Editar orçamento", ao lado de "Arquivar". Com confirmação e auditoria.
