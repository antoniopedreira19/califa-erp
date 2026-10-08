# 148 — A visão agregada salva cada alteração na hora, e o orçamento vazio se exclui

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

## Entrega 2: excluir orçamento completamente vazio (07/10/2026)

Combinado com o Tiago em 06/10/2026; "sem reaproveitar código" em 07/10/2026.

| Ponto | Como ficou |
|---|---|
| Vazio | Em rascunho, nunca aprovado, sem job e sem nenhum item em nenhuma versão. Grupo sem item conta como vazio; a linha em branco que ainda não tem descrição não está no banco e não conta. A regra mora num lugar só: `orcamento_esta_vazio` (banco). |
| Quem | Quem tem `orcamentos.criar` (administrador, gerente de projeto — `gerente_producao` — e produtor). Orçamento arquivado, ou de projeto arquivado, não se exclui: reative antes. |
| Onde | A lixeira do card da agregada, só no orçamento vazio, e "Excluir" no rodapé do "Editar orçamento", ao lado de "Arquivar". Confirmação: "Excluir este orçamento?" — "«nome» não tem nenhum item e sai do projeto. A exclusão não pode ser desfeita." |
| Lixeira ao vivo | A agregada recebe do banco o que vale fora da versão aberta (`orcamentos_excluiveis_do_projeto`: rascunho, sem aprovação, sem job, e as versões que ainda têm item) e confere a versão aberta pelo próprio estado. A lixeira some quando uma linha ganha descrição e volta quando o último item sai, sem recarregar. |
| Exclusão | `excluirOrcamentoVazio` → `excluir_orcamento_vazio` (banco): confere papel, tenant, empresa e regional, arquivamento e o vazio; apaga (versões, grupos, meses e histórico de importação vão em cascata) e grava `orcamento.excluido` na auditoria, com código, nome e projeto — tudo na mesma transação. Na agregada o card sai só depois de o servidor confirmar; na página do orçamento a tela vai para o projeto. |
| Código não volta | `codigos_de_orcamento_usados` guarda todo código que um orçamento já teve (gatilho na criação e na troca de código; carga com os atuais e os da auditoria). O gerador (`gerarCodigoOrcamento`) junta esse registro aos orçamentos de hoje: excluído o `-28`, o próximo é o `-29`. Mesmo modelo dos projetos (decisão 122). |
| Voltar (decisão 108) | A página do orçamento excluído sai do rastro da aba (`esquecerPagina`), e o "Voltar" nunca leva a um "não encontrado". |

**Por que a função roda como dona do banco.** `authenticated` não tem DELETE em `orcamentos` nem em `orcamento_importacoes`, de propósito: ninguém apaga orçamento direto pela API. A primeira versão da função (invoker) foi recusada no teste pela tela; a correção (`20261007990002`) a fez `security definer`, conferindo ela mesma o que a RLS de `orcamentos` conferiria. A única porta para apagar um orçamento continua sendo essa função.

**Banco:** migrations `20261007990001` (registro de códigos, carga, gatilho, `orcamento_esta_vazio`, `orcamentos_excluiveis_do_projeto`, `excluir_orcamento_vazio`) e `20261007990002` (a função como dona). Na carga entraram 238 códigos: os 105 atuais e 133 de orçamentos que já não existem ou de códigos antigos (decisão 114). Em 07/10/2026 havia 8 orçamentos vazios, 7 em projetos reais — nenhum foi apagado; a equipe decide.

**Testado (07/10/2026), no TES-P001/26:**
- No banco, simulando os usuários de teste: o freelancer é recusado pelo papel; o produtor passa pelo papel e é recusado num orçamento com itens.
- Na agregada: o `-28` ("ZZ Teste 148 exclusão A") nasceu com a lixeira; com "Criar planilha" ela continuou (linha em branco); com a linha nomeada sumiu; removido o item, voltou. Excluído pela lixeira: card, faixa e Totais atualizados; versão e grupo apagados; auditoria gravada; código guardado.
- O `-29` ("B") nasceu sem reaproveitar o `-28`; excluído pela gaveta "Editar" da página dele, que só mostra "Excluir" no vazio (o "ZZ Teste 148 autosave", com itens, mostra só "Arquivar").
- O `-30` ("C"), aberto por cliques (Projetos → projeto → orçamento) e excluído pela gaveta: a tela foi ao projeto e o "Voltar" levou a "Projetos", não ao orçamento excluído.
- Pelo console, chamando a action direto: orçamento com itens, orçamento aprovado e projeto errado — as três recusadas.
- Logado como o produtor de teste (`claude.produtor.teste`, 08/10/2026): a agregada mostra o "Criar orçamento de job" e a lixeira só no orçamento vazio; o `-31` ("ZZ Teste 148 produtor A") nasceu pulando os códigos excluídos e saiu pela lixeira; o `-32` ("B") saiu pela gaveta "Editar", aberta por cliques, e o "Voltar" levou a "Projetos"; num orçamento com itens a gaveta mostra só "Arquivar". A auditoria das duas exclusões ficou no nome do produtor.
