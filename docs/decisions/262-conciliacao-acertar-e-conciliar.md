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

## Revisão de 17/11/2026 — D2: a PP pelo código em qualquer forma e pelo valor e titular

⚠️ **D2 ampliada.** O caso: em 16/11, uma linha de −R$ 4.500,00 de 12/11 foi
conciliada pela linha da planilha "Controller…", que não cita o código da PP.
A D2 só reconhecia a PP pelo código escrito como "PP-00634", então ofereceu a
linha da planilha; a PP-00634 ficou aberta, a baixa foi dada à mão depois e o
pagamento contou duas vezes (corrigido no mesmo dia).

A linha da planilha que é de um título em aberto passa a ser reconhecida, nesta ordem:

1. **Pelo código da PP em qualquer forma:** "PP-00634", "PP00634", "PP 634",
   "PP-634". Com os dados de 17/11, mais 17 linhas da planilha (código sem
   hífen) deixam de ser oferecidas no lugar da PP aberta.
2. **Pela chave do custo fixo** (fornecedor e descrição iguais), como antes.
3. **Pela PP aberta com o mesmo valor e o mesmo titular**, só quando a linha
   não cita PP nenhuma (a que cita uma PP já paga é, em geral, pagamento em
   duplicidade). O titular casa quando o nome mais curto (8 letras ou mais) é
   o começo do outro, em qualquer parte do texto da planilha separada por "|"
   ("Flash App | Fulana de Tal"); a data prevista da PP fica a até 20 dias; e
   o par tem que ser único dos dois lados (uma PP, uma linha). Na dúvida, a
   linha da planilha continua oferecida.

No lugar da linha vem o título, com o aviso de sempre ("A planilha tem este
pagamento como da PP-…"). Código: `lib/conciliacao/planilha-de-titulo.ts`
(com testes em `planilha-de-titulo.test.ts`), usado por
`dia-a-dia-tabela.tsx`.

**Conferido (17/11, na produção, só leitura):** na linha de débito de 16/11 da
California Santander, a busca por "samba" traz só a PP-00384 (em aberto); a
linha "PP00384 - Roda de samba" da planilha, do mesmo dia, não é mais opção.

## Revisão de 23/11/2026 — D11: o cartão do "Lançar avulso" também usa a linha

⚠️ **D11 ampliada (Tiago, 23/11/2026: "Sim, corrija aqui").**

**O caso.** Numa linha de entrada, o "Lançar avulso" abre o Recebimento
avulso, e o primeiro cartão é o "Recebimento antes da NF" (decisão 260, D14).
Escolhido por esse caminho, o cartão:
- vinha com a data de hoje e a conta em branco;
- gravava sem conciliar a linha.

Só o item próprio do ⋯ usava a linha.

**Agora o cartão faz o mesmo que o item do ⋯:**
- a data, a conta e o valor vêm da linha e não se editam;
- o valor acima do saldo a faturar fica em vermelho e o botão não registra;
- **"Registrar e conciliar"** grava e concilia pela mesma action
  (`registrarRecebimentoAntesNfPelaLinha`) e pela mesma função do banco;
- o Desfazer da linha cancela o recebimento (D12).

**O internacional** (o job com câmbio fechado) continua fora da linha, como
no ⋯. Pelo "Lançar avulso", o formulário do câmbio já vem com a data e a
conta da linha, editáveis, e registra como antes. A linha se concilia depois,
pela sugestão do sistema (o bruto com o valor da linha).

**Também confirmado pelo Tiago em 23/11/2026:** o pagamento e o recebimento
avulso continuam **sem job** (regra de 15/09/2026). O custo de job entra pela
planilha e pela PP (ou pelo Job de Pagamentos, decisão 266). O dinheiro do
cliente entra pelo recebimento antes da NF ou pela baixa da NF.

**No código:**
- `aba-banco.tsx`: passa `linhaDoBanco` no `inicial` do Recebimento avulso;
- `recebimento-avulso-dialog.tsx`: registra pela linha quando ela existe e
  não é câmbio;
- `recebimento-antes-nf-dialog.tsx`: os campos da linha (`CampoDaLinha`) e o
  botão "Registrar e conciliar".

Sem migration.

**Conferido no Sandbox (23/11/2026, como admin@sandbox.local, servidor local):**
- linha de R$ 1.500,00 de 06/11 da Conta Teste 253, pelo "Lançar avulso" › cartão "Recebimento antes da NF";
- TET-1002/26 (nota do envio), centro 01 · Receita;
- o formulário veio com 06/11/2026, a Conta Teste 253 e R$ 1.500,00, sem edição;
- "Registrar e conciliar" gravou o recebimento (aguardando, 06/11, na nota do envio) e conciliou a linha (`avulso`);
- o Desfazer cancelou o recebimento ("Conciliação com o banco desfeita") e a linha voltou a pendente;
- nada ficou gravado, e o console e o servidor ficaram sem erro.


## Revisão de 23/11/2026 — D2: a linha da planilha de PP já paga

⚠️ **D2 ampliada (Tiago, 23/11/2026: "Sim, corrija").**

**O caso.** A D2 esconde a linha da planilha de uma PP **em aberto**, e no
lugar dela oferece a PP. Paga a PP, ela sai da lista de títulos, e a linha
da planilha dela voltava a ser oferecida — e proposta pelo motor, que casa a
previsão de mesmo valor no dia — para outra linha do banco de mesmo valor.
No acerto de 17/11, 19 linhas do banco de 09 a 11/11 foram ligadas assim à
planilha de PPs já baixadas e conciliadas noutra linha (PP-00360, PP-00365,
PP-00496…). O caixa ficava certo, mas a PP contava duas vezes e outro item
da planilha ficava sem realizar. Corrigido nos dados em 23/11 (8 religadas a
um item livre de mesmo dia e valor, 11 voltaram a pendentes).

**Agora** a saída da planilha cujas PPs citadas estão **todas pagas** (status
"pago") não é oferecida nem proposta, em nenhum lugar da Conciliação: sai das
previsões e da cauda já no carregamento da conta, antes do motor e da tabela.

**Continua oferecida:**
- a linha que a planilha marca como outro movimento da PP: duplicidade,
  devolução, estorno ou PIX não efetuado ("PAGAMENTO DUPLICADO - PP00288",
  "Devolução de pagamento duplicado…"), e toda entrada;
- a que cita uma PP ainda aberta ao lado de PPs pagas ("PP01028 PP01020 -
  Reembolso", com a PP-01020 aberta);
- a que só cita a numeração antiga da planilha ("PP 25684", cinco dígitos);
- a da PP paga em parte (a parcela aberta continua título e entra pela regra
  de sempre).

**No código:**
- `lib/conciliacao/planilha-de-titulo.ts`: `codigosDePp` e `eDePpPaga`
  (testes em `planilha-de-titulo.test.ts`);
- `app/(app)/financeiro/conciliacao/banco-dados.ts`: `ppsPagasDaPlanilha`
  busca as PPs pagas que a planilha da conta cita (só PP-00001 a PP-09999,
  em partes de 200, junto das outras consultas da conta) e tira as linhas
  delas de `previsoes` e `historico`.

Sem migration.

**Conferido (23/11, na produção, só leitura, California Santander):** as
linhas da planilha das PPs pagas PP-00360, PP-00365, PP-00483, PP-00696 e
PP-00384 não estão mais na página. Continuam: as sem título ("Locação de 106
barricadas"), as devoluções, a do reembolso que cita a PP-01020 aberta e as
da numeração antiga. Console e servidor sem erro novo.

**Fica para decidir:** a baixa à mão, no Contas a Pagar, de PP cuja linha da
planilha já está conciliada com o banco (o mesmo pagamento duas vezes, pelo
outro lado: foram assim as 6 dobras de 19/11).
