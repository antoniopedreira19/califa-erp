# 262 — Conciliação automática: acertar a linha e conciliar no fim, centro de custo na linha e fechamento por mês

**Data:** 2026-11-16
**Status:** aceita (protótipo aprovado pelo Tiago em 16/11/2026: "Gostei, agora está funcionando. Aprovado, pode implementar"). Implementada em três partes, as três no sistema.
**Quem decidiu:** Tiago.
**Protótipo:** `.claude/prototipos/conciliacao-dia-a-dia/` (versão 56), com o histórico das versões no `LEIAME.md` de lá.
**Migrations:** parte 1, `20261116950001_conciliacao_acerto_e_centro_na_linha.sql`; parte 2, `20261116960001_conciliacao_reabrir_mes_a_mes.sql`; parte 3, `20261116970001_conciliacao_recebimento_antes_nf_pela_linha.sql`.
**Relacionadas:** [254](254-conciliacao-dia-a-dia.md) (a conciliação dia a dia), [205](205-fechamento-da-conciliacao.md) (o fechamento), [235](235-custos-fixos-como-recorrencias.md) (a chave da recorrência), [251](251-subtipo-unico-completa-o-centro-de-custo.md) (o subtipo único), [256](256-novo-faturamento-e-faturar-unificado.md) e [260](260-faturar-em-pe-e-lista-do-faturamento.md) (o recebimento antes da NF; pendência D16).

## O problema

Na conta real (o acerto da California Santander de 01 a 11/11/2026), a sugestão do sistema vinha pronta na linha e o "Conciliar as N prontas" gravava tudo o que o sistema sugeriu, sem ninguém olhar linha a linha. A linha da planilha de uma PP ou de um custo fixo fechava a conta na hora e deixava o título em aberto: o pagamento contava duas vezes no fluxo de caixa (PP-00808, PP-00426, os custos fixos de novembro).

## Decisões

| # | Tema | Decisão |
|---|---|---|
| D1 | A linha vem vazia | A sugestão do sistema é a **primeira opção do "Adicionar lançamento"**; nada entra sozinho. |
| D2 | A planilha de um título | A linha da planilha que é de uma PP (pelo código) ou de um custo fixo (pela chave da recorrência) **não é oferecida**: no lugar dela vem o título. |
| D3 | O ajuste da diferença | Escolhido pela pessoa, embaixo da linha, em botões amarelos com o i: juros e multa, retenção na fonte, baixa parcial, corrigir a baixa e **"Corrigir o valor do título"** (o custo fixo com valor estimado passa ao valor que o banco pagou). |
| D4 | O acerto guardado | O acerto de cada linha fica **no banco** até a conciliação (escolha do Tiago): sobrevive a recarregar a página e a trocar de computador; outra pessoa do financeiro continua. |
| D5 | Conciliar | "Conciliar" grava só aquela linha; "Conciliar tudo o que foi acertado" grava o resto de uma vez, depois de um resumo. A linha que pede a baixa completa mostra **"Completar"**, com o motivo na dica (o centro de custo que falta, a retenção a conferir, o mútuo…). |
| D6 | Sem a coluna Status | A Ação diz o que falta. Filtros: **Pendentes** (sem lançamento, ou com diferença sem ajuste) · **A completar** · **A conciliar** · Conciliadas. Só no sistema em dois grupos: baixados sem linha (travam o mês) e previstos (não travam). |
| D7 | Débitos e créditos | No quadro do dia: os créditos e os débitos do banco e do sistema, separados, com a diferença de cada um. A tabela ganha a coluna **Subtipo** depois de Tipo. |
| D8 | Centro de custo na linha | Tipo e Subtipo são **dois campos de busca, um de cada vez**, em **qualquer lançamento** (título, baixa já feita, linha da planilha), sem restrição de tipo (pedido do Tiago). A lista começa pelos tipos da direção da linha. O escolhido é do lançamento (vale onde ele aparecer) e é gravado na conciliação. Trocar o tipo deixa o subtipo por escolher, salvo tipo com um só subtipo. |
| D9 | Um pop-up por vez | A lista de lançamentos, o Tipo e o Subtipo nunca ficam abertos juntos. |
| D10 | Fechamento por mês (parte 2) | O dia não fecha mais; o mês fecha ("Fechar outubro") com as condições de hoje no último dia dele, e reabre mês a mês. Na Conciliação automática, a **linha dos meses** (os fechados com cadeado e o "Reabrir" do último, os abertos com o que falta e o "Fechar"); no Extrato e nos Títulos, a faixa "Os meses". |
| D11 | Recebimento antes da NF pela linha (parte 3) | No ⋯ da linha de entrada, "Recebimento antes da NF": a data, o valor e a conta vêm da linha; escolhe o job (ou BV) e o centro de custo; grava e concilia (pendência D16 da 260). O internacional fica no Recebimento avulso. |
| D12 | Desfazer do recebimento pela linha | **Desfaz tudo** (escolha do Tiago em 16/11/2026): o Desfazer da linha cancela o recebimento que ela criou, e a linha volta a pendente, como no "Lançar avulso", na regra e no PIX que voltou. Depois de a nota sair, cancela a baixa da parcela 1, como no avulso. |

## Como funciona (parte 1)

- `conciliacao_acertos` (por linha do banco) e `conciliacao_centros` (por lançamento): rascunho, só leitura direta para admin e financeiro; gravam por `salvar_acerto_da_linha` e `salvar_centro_da_conciliacao`. A tela guarda só o que mudou, 400 ms depois da última mudança, e mostra "Acertos salvos às HH:MM".
- Na conciliação, o centro escolhido vai para a baixa do título (o centro do item da baixa em lote); na baixa já feita, `trocar_centro_dos_lancamentos` (os juros da baixa ficam com o deles); na linha da planilha, `trocar_centro_das_previsoes` (o plano e a sigla do grupo). Auditados.
- "Corrigir o valor do título": `corrigir_valor_do_titulo_pela_linha` (título avulso ou de recorrência, em aberto, linha de pagamento ainda sem conciliação, período aberto; auditado `conta_avulsa.valor_corrigido`) e a baixa pela linha de sempre.
- Limite que vem de antes: na folha, a baixa em lote mantém o centro dela (Despesa com Pessoal), então o centro trocado na linha não vale para a folha.

## Como funciona (parte 2)

- O dia não fecha mais: na barra de dias, o dia sem pendências mostra ✓ (⚠ quando o saldo do dia não bate; ✓ cinza enquanto o extrato do dia não está completo), e o dia fechado sai da barra. Um traço separa os meses.
- **Linha dos meses**, acima da barra de dias: os meses fechados (os 3 últimos, com cadeado; quem fechou na dica), o "Reabrir" do último e cada mês com dia em aberto, com "N de M dias com ✓" e o "Fechar outubro". O botão liga quando o mês não tem nada a fazer; a dica diz o que falta, na ordem: o mês anterior aberto (os meses fecham em ordem), os itens pendentes e os dias deles, o extrato que não chega ao fim do mês e, por último, o saldo do último dia que não bate (`mesesDaConta`, em `lib/conciliacao/dia-a-dia.ts`).
- "Fechar outubro" é o `fechar_conciliacao` até 31/10, sem mudança no banco: as três condições de sempre, olhadas no último dia do mês.
- "Reabrir outubro": `reabrir_mes_da_conciliacao` (motivo de 10 caracteres ou mais, auditado como `conciliacao.reaberta` com `mes_a_mes`). Reabre só outubro: se setembro já tinha sido fechado alguma vez, um registro novo deixa a conta fechada até 30/09 (`reabertura_de` aponta para o registro reaberto, e o histórico diz "Setembro continuou fechado ao reabrir outubro"); se nunca foi, a conta fica toda aberta. O diálogo diz qual dos dois antes do clique. `reabrir_conciliacao` fica no banco, sem uso na tela.
- No Extrato e nos Títulos, a faixa "Os meses": os fechados, cada mês aberto até o de hoje (o reaberto em amarelo, com quem reabriu e o motivo na dica) e "Reabrir outubro" (ou "Fechar outubro de novo", com a conta toda aberta). Na Conciliação automática a faixa sai, e tudo fica na linha dos meses. O i do "Fechamento" explica o que o mês fechado trava e mostra o histórico.
- O fechamento antigo, por dia (só no Sandbox, todos inativos em 16/11/2026), aparece como "Fechado até 19/10".

## Como funciona (parte 3)

- `registrar_recebimento_antes_nf_pela_linha(linha, nota do envio | BV | job, tipo, subtipo)`: trava a linha (de entrada, pendente), chama as funções de sempre (`registrar_recebimento_antes_nf` ou `registrar_recebimento_antes_nf_do_job`, que conferem o saldo, o papel, a conta e o centro, e auditam) com a data, a conta e o valor da linha, e concilia a linha como `avulso` (`conciliar_linha`). Tudo numa transação. Recusa o internacional (a nota do envio de job com câmbio fechado) e a nota do envio em lote, como a lista de escolha.
- O Desfazer: `_cancelamento_da_baixa` devolve o recebimento que ainda espera a nota (`recebimento_antes_nf`), e a tela o cancela pelo `cancelar_recebimento_antes_nf`, com o motivo "Conciliação com o banco desfeita"; o lançamento apagado solta a linha. A linha conciliada diz "Lançado pela linha do banco: Recebimento antes da NF · …".
- A lista de escolha é a mesma do Recebimento avulso (`carregarAlvosDoRecebimentoAntesNf`): a nota do envio esperando nota, o BV e o job sem envio, com o saldo; o valor da linha acima do saldo é recusado antes de gravar.

## Entregas

1. Parte 1 — a tela do dia a dia (D1 a D9).
2. Parte 2 — o fechamento por mês (D10).
3. Parte 3 — o recebimento antes da NF pela linha (D11).
