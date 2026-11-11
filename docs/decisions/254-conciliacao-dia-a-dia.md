# 254 — A conciliação dia a dia: a linha do banco com os lançamentos dela, e a correspondência só no mesmo dia

**Data:** 2026-11-11
**Status:** aceita e implementada em 11/11/2026.
**Quem decidiu:** Tiago, de 10 a 11/11/2026, sobre o protótipo interativo "Conciliação dia a dia" (28 versões): opção C (na ordem do extrato), saldo em coluna própria, Status com "Faltando", confirmação ao mover um lançamento de linha, retirar o extrato.
**Revê:** as janelas de data do motor da [199](199-motor-de-correspondencia-e-secoes-do-banco.md); a fila dividida da [234](234-revisao-do-financeiro-pelo-prototipo.md) e a fila por ação da [243](243-conciliacao-automatica-fila-por-acao.md); o período das resolvidas da [239](239-conciliacao-automatica-divisoes-e-periodo-do-extrato.md). O fechamento da [205](205-fechamento-da-conciliacao.md) e o "nada se concilia sozinho" da [244](244-nada-se-concilia-sozinho.md) continuam.

## O problema

O financeiro começou a conciliar pelo sistema e encontrou três coisas:

- **Correspondências erradas.** O motor casava a linha do banco com o título de valor igual em **qualquer data**, e com a baixa de até 3 dias. Numa conta, um PIX único de R$ 60 mil pagou quatro PPs do mesmo fornecedor; três das baixas acabaram ligadas a PIX de outro dia e de mesmo valor, com a data da baixa trocada para a do PIX errado.
- **Um pagamento por vários títulos.** A PP paga junto com outras do mesmo fornecedor ficava "sem linha no banco", porque nenhuma linha tinha o valor dela.
- **Fila grande demais.** A conta inteira numa fila só (centenas de linhas) não dava para conferir.

## Decisão

1. **Um dia por vez.** A aba mostra a barra de dias da conta, com o que falta em cada um. No dia sem pendências, o cadeado toma o lugar do número: clicar fecha a conciliação **até** aquele dia (é o fechamento da 205; o dia anterior com pendência trava o cadeado). "Todos os dias" mostra os dias em aberto juntos.
2. **A correspondência só vale no mesmo dia.** A baixa, o título, a retenção, a soma da mesma contraparte, a linha da planilha e a previsão só são sugeridos para a linha do banco **do dia deles**. O que é de outra data não se perde: a pessoa muda a data dele (item 6) ou o escolhe na linha ("Em outras datas").
3. **O pagamento agrupado.** As baixas do mesmo fornecedor no dia que somam a linha centavo a centavo (de 2 a 6), quando a combinação é única, entram como uma ligação só. A soma de títulos em aberto da mesma contraparte vai de 2 a 6 (era até 4).
4. **A linha do banco com os lançamentos dela.** Cada linha tem ao lado a lista dos lançamentos do sistema que a compõem (baixas já feitas, títulos em aberto, linhas da planilha). O sistema preenche com o que achou; a pessoa retira (×), adiciona e troca no próprio lugar, clicando em qualquer ponto do lado do sistema. **Nada é gravado até o Conciliar.** A lista de escolha tem as mesmas colunas da linha, nas seções "Fecha a conta", "Do mesmo fornecedor", "No dia" e "Em outras datas".
5. **Status em três estados, e a ação é sempre Conciliar.** **Pronto** (a soma fecha, com ou sem ajuste: juros e multa, retenção na fonte, baixa parcial, correção da baixa), **A definir** (a soma não fecha, ou há mais de um lançamento possível, no dia ou em outra data) e **Faltando** (o sistema não tem nada com esse valor).
6. **Mudar a data no próprio lugar**, pelo lápis de "Só no sistema", com o pop-up da aba Títulos: o título em aberto que a aba Títulos já edita (PP, avulso e nota), a **baixa** lançada no dia errado (ainda sem linha do banco) e a **previsão da planilha**. A data ajustada da previsão **sobrevive à carga nova da planilha** (fica guardada pela impressão digital da linha; se a linha mudar na planilha, vale a planilha).
7. **Mover um lançamento que já está em outra linha pede confirmação**, com o lançamento, a linha de onde sai e a linha para onde vai, e como cada uma fica.
8. **O saldo do banco depois de cada linha**, em coluna própria, na ordem do extrato.
9. **Retirar o extrato importado** (arquivo errado, ou recomeçar): só o **último** arquivo da conta; quem pode é quem concilia (admin e financeiro, os mesmos de fechar e reabrir); o **motivo** é obrigatório quando há conciliação a desfazer. As conciliações das linhas dele são desfeitas como no "Desfazer" de cada linha, e o arquivo pode ser importado de novo.
10. **O De/Até sai da aba Conciliação automática**, que não o usava. No Extrato e nos Títulos continua.

## O que fica de fora (decidido)

- **A data do desembolso, da fatura, da guia, do estorno e da transferência em aberto** ainda não muda por aqui: cada um tem regra própria a definir. O lápis deles fica desligado. *Pendente de entrar depois, a pedido do Tiago.*
- **A baixa já feita junto com um título em aberto do mesmo fornecedor** não é reconhecida sozinha: a linha sai "Faltando" e os dois entram pelo "Adicionar lançamento" (o Conciliar dá a baixa no título e liga tudo).
- **Uma PP paga por várias linhas do banco** não tem ação própria nesta tela.
- **As ligações erradas já gravadas** antes desta decisão não são desfeitas por ela: serão revistas com a planilha e os extratos atualizados.

## Como fica no código

- **Motor** (`lib/conciliacao/motor.ts`, `motor-da-conta.ts`): as janelas viraram "no dia"; `pagamentosAgrupados` entrega o grupo no formato da remessa já baixada (id `ag:<linha>`), e o passo 1c o liga. Os testes que afirmavam as janelas antigas foram reescritos; os dados do protótipo da 199 continuam valendo onde ele casava no dia.
- **Tela** (`dia-a-dia.tsx`, `dia-a-dia-tabela.tsx`, no lugar de `fila-dividida.tsx`): a composição de cada linha é estado da tela até o Conciliar, que escolhe a ação de sempre (ligar, baixar e conciliar, corrigir a baixa, regra, par, mútuo, planilha) ou a nova `conciliarMisto` (baixas já feitas + títulos em aberto).
- **Contas puras** (`lib/conciliacao/dia-a-dia.ts`, com teste): os dias da conta, o motivo de não fechar e o saldo por linha. **O saldo parte do saldo do banco que o servidor confere no fechamento** (`condicoes_do_fechamento`: o do último dia completo do extrato) e anda linha a linha; não é uma soma feita na tela a partir do zero.
- **Leitura** (`banco-dados.ts`): a aba traz as linhas **dos dias em aberto inteiros** (do começo da conta, ou do dia seguinte ao último fechado), e não mais só as resolvidas do período do último extrato (239). É o que dá o "N de M linhas conciliadas" do dia e o saldo sem buraco.
- **Ações** (`actions-dia-a-dia.ts`): `conciliarMisto`, `mudarDataDaBaixa`, `mudarDataDaPrevisao`, `previaDeRetirarExtrato` e `retirarExtrato` (em partes: desfaz poucas conciliações por chamada e só então apaga).
- **Banco** (migration `20261111500001_conciliacao_dia_a_dia.sql`, aditiva): `mudar_data_da_baixa` (a mesma `_mudar_data_do_lancamento` que a conciliação já usa ao ligar; período aberto, sem data futura), `historico_previsoes_datas` com `mudar_data_da_previsao` e o gatilho da carga nova, `previa_de_retirar_extrato` e `retirar_extrato`. Auditoria: `baixa.data_alterada`, `historico.previsao_data_alterada` e `extrato.retirado`.

## Regras que valem registrar

- **A baixa não aceita data futura** em `mudar_data_da_baixa`.
- **A baixa conciliada não muda de data** (a data dela é a do banco): desfaz-se a conciliação antes.
- **A linha conciliada por baixas já feitas mais títulos em aberto** (`conciliarMisto`) é gravada como ligação: ao desfazer, a linha solta tudo, e a baixa dada aos títulos naquele momento **continua** (aparece como baixa sem linha, com "Cancelar baixa" no menu). Só títulos, sem baixa anterior, é o "baixar e conciliar" de sempre, que o Desfazer cancela.
- **A baixa parcial pelo lote** só quando o título não tem retenção da aprovação; com retenção, a tela pede para conciliar o título sozinho, pela baixa completa.
- **Retirar o extrato** não passa de dia fechado (reabre-se antes) nem apaga linha com correção de baixa ou IOF de mútuo no histórico.

## Conferido

No Sandbox (Conta Teste), pela tela, em 11/11/2026: importar um extrato de teste; mudar a data de uma baixa de 16/10 para 04/11 e a linha do dia virar Pronto; "Conciliar as 2 prontas" (ligação e regra); conciliar uma linha com uma baixa de outra data mais um título em aberto (a data da baixa foi para a do banco e o título ganhou a baixa); a lista de troca alinhada às colunas; a confirmação de mover (confirmar e cancelar); desfazer; retirar o extrato com 3 conciliações (pede motivo, desfaz e apaga) e sem nenhuma (não pede); importar de novo o mesmo arquivo. No fim o Sandbox voltou ao estado inicial, conferido no banco.

A data da previsão da planilha foi conferida numa transação desfeita (o Sandbox não tem previsões): ajuste gravado, volta à data ajustada ao desligar do banco, linha da carga nova nasce na data ajustada, voltar à data da planilha apaga o ajuste.

**Não conferido pela tela:** fechar o dia pelo cadeado (a Conta Teste não zera as pendências nem bate o saldo; a ação é a `fechar_conciliacao` de sempre) e a baixa parcial com vários títulos na mesma linha.
