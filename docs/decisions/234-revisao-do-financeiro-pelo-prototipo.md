# 234 — A revisão do módulo financeiro pelo protótipo: PO no faturamento, Empresa e Regional no Resultado de Job, e a Conciliação automática como fila dividida

**Data:** 2026-11-03
**Status:** aceita e implementada em 03/11/2026. O "Save do cliente" (3ª opção da nota avulsa) ficou de fora: aguarda a aprovação de um protótipo próprio.
**Quem decidiu:** Tiago, em 03/11/2026, revisando o protótipo interativo do módulo financeiro inteiro ("Como está hoje" × "Como vai ficar"): "Vamos implementar no sistema tudo que fizemos até aqui (todas as modificações que fizemos no protótipo). Utilizaremos a opção E."
**Revê:** a [184](184-faturar-drawer-que-abre-a-nota-e-cnpj-do-tomador.md) (o formulário Faturar), a [202](202-marcas-do-banco-no-extrato-e-nos-titulos.md) (as marcas do banco no Extrato e nos Títulos saem), a [199](199-motor-de-correspondencia-e-secoes-do-banco.md) e a [200](200-acoes-da-conciliacao-automatica.md) (a tela da Conciliação automática), e o "Conciliar em conjunto" da [211](211-importacao-do-historico-da-planilha-financeira.md) (vira "Agrupar lançamentos"). A [207](207-resultado-de-job.md) continua: Resultado de Job e Visualizar Jobs são a mesma lista.
**Migration:** `20261103700001`.

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | PO no faturamento | Nº da PO e anexo da PO, opcionais, no formulário Faturar: na avulsa, logo abaixo do job ou do cliente; na nota de job, abaixo da faixa cliente/empresa/regional, um par por job (e por mês, na planilha mensal) na nota agrupada, já com o que a produção mandou no envio. BV não tem PO |
| D2 | Onde a PO fica | Sempre no registro do faturamento (`faturamentos_po` e `faturamentos_po_anexos`), porque é o formulário de faturamento que se preenche. Na NF em si a PO pode ou não aparecer: depende do cliente. O envio para faturamento não muda |
| D3 | Resultado de Job e Visualizar Jobs | Empresa e Regional depois da Rentabilidade, nas duas visões. Em "Por projeto" a coluna Projeto sai (a faixa do grupo já diz) |
| D4 | O extrato do banco (OFX) só na Conciliação automática | O Extrato perde a coluna Banco (✓ ⚠ ○), a faixa "N lançamentos não batem" e o botão "Importar extrato do banco (OFX)"; os Títulos perdem a faixa verde "já aparecem no extrato" e o sinal nas linhas. O botão de importar vai para o topo da Conciliação automática; a zona "Importar outro extrato" do fim da página sai (a zona grande continua na conta sem extrato) |
| D5 | Planilha de títulos (as quatro telas da 195) | A linha com altura regular: Descrição em até 2 linhas, origem numa linha só; o texto inteiro abre ao passar o mouse, só quando foi cortado. A justificativa da urgência vai para a dica do selo. Na Conciliação › Títulos, a coluna se chama "Fornecedor" |
| D6 | Conciliação automática: a fila dividida | Uma tabela só (Data · Histórico do banco · Valor · Situação · No sistema · Ação), dividida por tipo na ordem do motor, cada divisão com contagem, ⓘ, o botão de todas e recolhível; "Baixas à mão que bateram" e "Conciliados" nascem recolhidas. Clicar na linha abre o detalhe (no sistema, por quê, centro de custo, outros candidatos). Seleção dos prontos e das baixas à mão, com "Conciliar selecionados". No topo, o arquivo numa linha, os avisos em chips e uma faixa com os saldos, o progresso e Fechar/Reabrir |
| D7 | As ações da linha | Um vocabulário só: **Conciliar** (verde, o sistema resolve sozinho), **Revisar** (contorno, abre o pop-up preenchido para conferir), **Lançar ▾** (nada no sistema) e **Cancelar baixa** (só na baixa sem linha no banco que se cancela sozinha). O que cada um faz fica na dica. A lupa (procurar outro título) fica à vista, também na baixa à mão que bateu, na regra e no histórico; o resto vai no ⋯. O ponto de confiança sai (repetia a Situação). O "Corrigir a conta ou a data da baixa" sai: o sistema não edita a baixa, só cancela |
| D8 | Agrupar lançamentos | O "Conciliar em conjunto" vira "Agrupar lançamentos". O sistema acha sozinho o pagamento que o banco fez em partes diferentes das baixas (baixas sem linha no banco × linhas sem correspondência, mesmo sentido, até 7 dias, soma exata, 1 a 4 de cada lado e ao menos 3 no total, a mesma contraparte pela 1ª palavra significativa, combinação única) e o mostra numa divisão própria, com "Conciliar" e "Ajustar o agrupamento". O pop-up novo tem as colunas No sistema × No banco, os totais e o indicador; a action é a mesma (`conciliar_em_conjunto`). No ⋯, "Agrupar lançamentos" dos dois lados |

## Fora desta decisão

- **Save do cliente** (nota avulsa de save, que vira crédito do cliente para os jobs dele). O Tiago respondeu: consumo igual ao save de hoje (o crédito aparece como origem ao lado dos jobs que geraram save), saldo na escolha da origem e no Contas a Receber, tipo fixo em Receita com um subtipo novo "Save". Antes de implementar, ele quer aprovar um protótipo de onde o saldo aparece.
- A PO registrada ainda não aparece em nenhuma tela de leitura da nota: fica gravada para quando a tela de detalhe da NF a mostrar.

## Como fica no código

- PO: `uploadPoPdf` e o campo `pos` do `emitirFaturamento` (`contas-a-receber/actions.ts`); o registro sai depois da RPC `emitir_faturamento`, como o registro fiscal: se falhar, a nota já saiu e o aviso diz que a PO não ficou registrada. O arquivo do envio vai por referência (`envio_anexo_id`, bucket `envios-faturamento`); o anexado no Faturar sobe para `faturamentos-nf`.
- Conciliação automática: `fila-dividida.tsx` (a tabela), `fila-linhas.tsx` (as linhas), `fila-da-conta.tsx` (tipos, ações descritas, topo) e `agrupar-lancamentos.tsx`; `banco-tabela.tsx` ficou com o contrato das ações e as células; as seções antigas, a `TabelaDoBanco` e o `ConjuntoDialog` saíram.
- Extrato: `page.tsx` não lê mais as marcas do banco (uma consulta a menos no Extrato).
