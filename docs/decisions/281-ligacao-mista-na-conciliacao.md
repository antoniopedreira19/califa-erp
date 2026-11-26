# 281 — A ligação mista: o PIX que paga títulos do sistema e itens só da planilha

**Data:** 2026-11-26
**Status:** aceita e implementada em 26/11/2026 (testada no Sandbox; push com o OK do Tiago).
**Quem decidiu:** Tiago, no plano da conciliação das 3 contas (26/11/2026, "Ok"),
e na resposta "Sim, comece" à etapa 2 do plano.
**Relaciona-se com:** [262](262-conciliacao-acertar-e-conciliar.md) (a conciliação
dia a dia e o misto de sempre), [270](270-baixa-antes-do-inicio-da-conta.md)
(a ligação baixa × planilha, `historico_movimento_baixas`) e
[276](276-nf-presa-ao-job-da-planilha.md) (a regra das previsões pagas).

## O problema

A linha do banco se conciliava com lançamentos do sistema (`conciliar_linha`) **ou**
com linhas da planilha (`conciliar_linha_pelo_historico`), nunca com os dois. Um PIX
que paga a PP-00303 junto com três itens de numeração antiga da planilha (WRM,
R$ 61.131, 23/11) não tinha saída:

- ligar tudo à planilha deixa a PP aberta no Contas a Pagar (conta duas vezes);
- dar baixa só na PP deixa a linha do banco sem fechar.

Na California Santander eram 19 linhas assim em 26/11, mais 11 das baixas feitas à
mão em 19/11 em PIX que também pagaram itens só da planilha.

## A decisão

1. `conciliada_como` ganha **`misto`**.
2. **`conciliar_linha_mista(linha, lançamentos, linhas da planilha)`**: as travas das
   duas funções de hoje juntas (o lançamento da conta e sem linha; a linha da planilha
   da cauda ou das previsões ativas, da conta, solta e desde o início da conta) e a
   soma dos dois lados igual à linha do banco. A data dos lançamentos passa à do banco,
   como na ligação.
3. Em seguida, **a baixa de cada PP se liga à linha da planilha que cita a PP**
   (`historico_movimento_baixas`). Sem isso, a PP contaria duas vezes no DRE com
   previsões: numa linha mista a regra (b) das previsões pagas não vale (ela só olha a
   linha conciliada só com lançamentos). O par só sai quando há **uma** linha da
   planilha da conta, solta, de mesmo valor, que cita a PP, a até 31 dias; senão a
   linha concilia e a tela avisa quais PPs ficaram sem o par.
4. **Desfazer:** solta os dois lados, devolve as datas e apaga os pares que a linha
   criou. Não cancela baixa nenhuma (como a ligação): a baixa feita na hora volta a
   "Só no sistema".
5. **A baixa cancelada fora da conciliação** (`lancamento_desliga_a_linha`) e **a carga
   desfeita** (`_historico_apagar_linhas`) soltam o outro lado da linha mista.

## Na tela

- No "Adicionar lançamento" da linha, a lista não separa mais planilha do resto: as
  duas aparecem juntas.
- A linha com planilha e baixas ou títulos, com a soma batendo e sem ajuste,
  concilia pelo "Conciliar" e pelo "Conciliar tudo o que foi acertado". Os títulos em
  aberto ganham a baixa com os dados do banco antes (o misto de sempre).
- Com ajuste (juros, retenção, parcial), a linha pede a baixa completa do título antes
  e a linha da planilha depois.
- A linha conciliada mostra "Sistema e planilha: “…” e N linhas da planilha".

## Testes (Sandbox, Conta Teste, linha de −R$ 6.000 de 20/10)

| Caso | Resultado |
|---|---|
| Título em aberto (PP-00576) + item só da planilha, pela ação | misto; PP paga; par com a linha "PP-00576" da planilha; regra (a) conta a linha como paga |
| Desfazer pela tela | linha pendente, os dois lados soltos, par apagado, baixa em "Só no sistema" |
| Baixa já feita + item da planilha, montada na tela e "Conciliar" | misto, par certo |
| Baixa com ISS retido (líquido 760) + item de 5.240 | misto; par com a linha de 760 |
| Baixa cancelada com a linha mista | linha pendente, planilha solta, par apagado, PP volta a aprovada |

A carga de teste do Sandbox foi desfeita no fim.

## Migration

`20261126300001_ligacao_mista_na_conciliacao.sql` (aditiva: nenhuma linha estava
como `misto`; os caminhos das outras formas de conciliar ficam iguais).
