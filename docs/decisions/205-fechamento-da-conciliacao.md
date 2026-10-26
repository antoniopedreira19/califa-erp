# 205 — O fechamento da conciliação com o banco: trava o caixa da conta até reabrir

**Data:** 2026-10-21
**Status:** aceita e implementada em 21/10/2026 (task 029, fase 4).
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seções 6 e
4.1, item 12, da especificação: o fechamento "Trava até reabrir"; protótipo,
`fecharPeriodo`, `reabrirPeriodo`, `bloqueado` e `diaCompleto` em `main.jsx`,
`BannerDoFechamento` e `ReabrirDialog` em `banco.jsx` e o cadeado de
`AbaExtrato` em `titulos.jsx`); e no M4.2, opção B, em 21/10/2026.
**Migrations:** `20261021800001_fechamento_da_conciliacao.sql`,
`20261021800002_lancamento_respeita_o_fechamento.sql` e
`20261021800003_fechamento_vira_decisao_205.sql`.
**Número:** nasceu como 203, reservada no índice para a conciliação. Antes do
push, o `main` já tinha uma decisão 203 de outra frente, publicada em paralelo;
quem ainda não tinha publicado mudou, e esta virou a 205. As duas primeiras
migrations já estavam aplicadas e citam a 203 no texto; a terceira só troca os
dois comentários que o banco guarda.
**Revê:** a decisão 120 (cancelar e estornar a baixa ganham o limite do
fechamento).

## O problema

Com o extrato do banco importado e conciliado (decisões 198 a 202), nada
impedia que uma baixa, um cancelamento ou uma troca de data mexessem num dia
que o financeiro já tinha conferido com o banco. O Extrato e o DFC de um mês
"batido" podiam mudar por baixo, sem ninguém saber. A decisão 120 deixava o
cancelar sem limite de data "até existir o processo de conciliação que marca
um período como conferido".

## A regra

### Até onde dá para fechar e quando o botão liga

1. **O fechamento é por conta**, até um dia: o **último dia completo** dos
   extratos importados. Para cada importação, o dia completo é o fim do
   período, se o arquivo foi gerado depois dele, ou a véspera, se foi gerado no
   mesmo dia (no dia de Brasília). Vale o maior entre as importações.
2. **"Fechar a conciliação até dd/mm/aaaa"**, na barra da Conciliação
   automática, só liga com as três condições:
   - nenhuma linha do banco até esse dia está pendente (sem lançamento ligado e
     não ignorada);
   - nenhum lançamento da conta até esse dia, num dia que o extrato cobre por
     inteiro, está sem linha do banco;
   - a diferença de saldo nesse dia é zero: o saldo do banco é o saldo
     informado (LEDGERBAL) da importação mais recente menos as linhas depois do
     dia; o do sistema é o saldo inicial da conta mais os lançamentos até o dia
     (o mesmo cálculo do `calcularSaldoAnterior`).
3. **As condições são do banco** (`condicoes_do_fechamento`), e a tela liga o
   botão pela mesma função que `fechar_conciliacao` confere: o botão e a
   recusa nunca divergem. Desligado, a dica do botão diz o texto do protótipo e
   o que falta ("11 linhas do banco até 20/10 sem conciliar; 3 lançamentos sem
   linha no extrato do banco; o saldo de 20/10 não bate (diferença de
   R$ 142,11)").
4. **Uma linha ignorada até o dia impede o fechamento pelo saldo**, a não ser
   que ela se anule com outra no mesmo dia: o banco a tem e o sistema não. É o
   cálculo do protótipo.

### A trava (M4.2, opção B do Tiago)

5. **Com a conciliação fechada, o caixa da conta até o dia não muda.** Um
   gatilho em `lancamentos_financeiros` recusa, com "Período fechado até
   dd/mm: reabra a conciliação para mudar esse lançamento.":
   - o **insert** com data até o fechamento da conta (a baixa, o estorno, a
     transferência, os juros, o lançamento pela regra);
   - o **delete** de lançamento com data até lá (o cancelamento da baixa, o
     desfazer);
   - o **update** que troca a data, o valor, a natureza, a conta, o centro de
     custo (tipo e subtipo) ou o vínculo com o banco (`extrato_linha_id`),
     olhando a data e a conta de antes e as de depois.
6. **Fica livre o que não é caixa:** job, regional, empresa, descrição,
   fornecedor, cliente, origem, título, fatura. Por isso a emissão da NF de um
   recebimento antes da nota (`emitir_faturamento` e `cancelar_faturamento`,
   que trocam a origem, o título e a empresa) continua funcionando num período
   fechado. A opção A, que travava qualquer mudança, impediria isso.
7. **O gatilho pega todos os caminhos:** as 32 funções que gravam na tabela e a
   escrita direta que a policy `lancamentos_modify` (FOR ALL) permite. A conta
   de cartão (conta-espelho) não tem extrato nem fechamento, e o gatilho não
   age nela.
8. **As linhas do banco também travam** (`extrato_linhas`): conciliar, ignorar
   e desfazer linha com data até o fechamento são recusados, e
   `desfazer_conciliacao` confere antes de mexer (o desfazer da baixa nascida na
   conciliação cancela a baixa pela tela depois dele). O extrato que traz um
   movimento **novo** até o dia fechado é recusado ("O arquivo traz um
   movimento novo de dd/mm/aaaa, e a conciliação desta conta está fechada até
   dd/mm: reabra a conciliação para importar este extrato."). Reimportar o
   mesmo arquivo continua valendo: a linha repetida não entra.
9. **O que o fechamento protege é o caixa** (o Extrato e o DFC). O DRE, por
   competência, não fica travado; esse fechamento é outro (pendência da
   especificação, seção 11).

### Na tela

10. **A faixa do fechamento**, no topo das três abas da conta (Extrato,
    Títulos e Conciliação automática), com o texto do protótipo:
    - **fechada:** "Conciliação fechada até dd/mm/aaaa · por {quem} em
      dd/mm/aaaa. O caixa desta conta até essa data não muda (o Extrato e o
      DFC): baixa, cancelamento, estorno e troca de data ou de centro de custo
      pedem reabrir o período. O DRE, por competência, tem fechamento próprio."
      e "Reabrir o período"; com mais de um evento, a linha do histórico;
    - **reaberta:** "Período reaberto em dd/mm/aaaa por {quem}: “motivo”. Os
      lançamentos até dd/mm/aaaa voltaram a poder mudar. Feche de novo quando
      terminar.", o histórico e "Fechar de novo até dd/mm/aaaa".
11. **O histórico** (especificação, seção 6.4): "fechada até 19/10 em
    20/10/2026 · reaberta em 21/10/2026 por {quem}: “motivo” · fechada até 20/10
    em 21/10/2026".
12. **Reabrir o período** pede o motivo, com pelo menos 10 caracteres ("Explique
    o motivo (pelo menos 10 caracteres)."), na tela e no banco.
13. **O cadeado no Extrato:** na coluna Banco, a marca das linhas até o dia
    fechado ganha o cadeado pequeno do protótipo (✓, ⚠ ou ○), com a dica
    "Conciliado e travado: o período está fechado até dd/mm/aaaa".
    - **Uma diferença deliberada do protótipo:** lá o cadeado só aparece no ✓,
      porque todas as linhas do exemplo estão no período do extrato. Aqui ele
      vai em toda linha até o dia fechado, porque o banco trava todas elas,
      inclusive as de antes do primeiro extrato importado.
14. **O popup de baixa** (título a pagar, recebimento, imposto e lote): com a
    conta e a data num período fechado, o aviso vermelho do protótipo ("A
    conciliação da {conta} está fechada até dd/mm/aaaa. Baixa com data até lá
    só entra reabrindo o período (na faixa do topo da Conciliação).") e o
    Confirmar recusa antes de tudo: "Período fechado até dd/mm/aaaa: use uma
    data depois, ou reabra a conciliação." No cartão nada sai da conta, e a
    trava não vale. Os outros popups (desembolso, fatura, devolução de verba,
    transferência) não avisam antes: o banco recusa com a mensagem da trava.
15. **Nas ações da Conciliação automática**, desfazer, corrigir a baixa e
    cancelar a baixa sem linha no banco com data até o fechamento avisam antes
    de chamar, com a mensagem da trava (protótipo: `bloqueado`).
16. **Com um fechamento ativo, só se fecha mais adiante.** O botão diz
    "Conciliação fechada até dd/mm/aaaa" (desligado) enquanto o último dia
    completo dos extratos for o do fechamento; com um extrato novo, volta a
    "Fechar a conciliação até {o dia novo}", e o fechamento anterior vira
    histórico. Para voltar atrás, reabre-se.
    - **Uma diferença deliberada do protótipo:** lá o botão fica desligado
      enquanto houver um fechamento ativo, porque o exemplo só tem um extrato.
      Fechar o dia seguinte reabrindo com motivo todo dia não teria sentido.

## Como ficou no banco

- `conciliacao_fechamentos` (M4.1): `ate`, `fechado_em`, `fechado_por`,
  `reaberto_em`, `reaberto_por`, `motivo_reabertura` (10 a 1.000 caracteres) e
  `ativo`. Um ativo por conta (índice único parcial); as linhas inativas são o
  histórico. Leitura de admin e financeiro pela RLS; sem escrita para
  `authenticated` (só as funções); nada para `anon`.
- Funções, todas `SECURITY DEFINER`:
  - `condicoes_do_fechamento(conta)`: até onde dá para fechar e as três
    condições, para a tela;
  - `fechar_conciliacao(conta, até)` (M4.3): confere o papel, o dia completo,
    o fechamento ativo e as três condições, e audita `conciliacao.fechada`;
  - `reabrir_conciliacao(conta, motivo)` (M4.3): motivo com pelo menos 10
    caracteres; audita `conciliacao.reaberta` com o motivo;
  - a trava: `_conciliacao_fechada_ate`, `_exige_periodo_aberto` e os
    gatilhos `trg_lancamento_respeita_o_fechamento` (em
    `lancamentos_financeiros`, tabela de outro módulo, M4.2 B) e
    `trg_extrato_linha_respeita_o_fechamento`.
- `desfazer_conciliacao` ganhou só a conferência do fechamento no começo.

## Como foi conferido

- **No banco, em transações desfeitas no fim**, como administrador:
  - a Conta Teste hoje: fechável até 20/10, com 11 linhas pendentes, 3
    lançamentos sem linha e R$ 142,11 de diferença; o fechar recusado por cada
    uma, e "Dá para fechar só até 20/10…" para o dia 21/10; o GP recusado;
  - num estado fechável montado na transação (as linhas ignoradas, as duas
    baixas de 19/10 ligadas, a baixa de 16/10 tirada do período coberto e um
    extrato com o saldo do dia): o fechar até 20/10; "já está fechada" de novo;
    o insert de 19/10, o delete, a troca de valor, a de data para fora do
    período e a de 15/10 para 18/10 recusados; a troca de descrição, de job e
    de regional e o mesmo centro aceitos; o desfazer da linha e o "tirar
    ignorada" recusados; a reimportação da linha repetida aceita e a linha
    nova recusada; o reabrir com motivo curto recusado e com motivo certo
    aceito, e a troca de valor aceita depois; "não está fechada" de novo; a
    auditoria `conciliacao.fechada` e `conciliacao.reaberta`;
  - o fechamento mais adiante (de 20/10 para 21/10): o de 20/10 virou
    histórico, e a auditoria guarda o `antes_ate`;
  - uma linha ignorada até o dia impede o fechamento pelo saldo.
- **Testes:** `lib/conciliacao/fechamento.test.ts` (o botão e as três
  condições, o fechamento mais adiante, a mensagem da trava, a linha do
  histórico no dia de Brasília); o dia completo já estava em
  `conciliacao/motor-da-conta.test.ts`.
- **No navegador, na Conta Teste**, logado como administrador: o botão
  "Fechar a conciliação até 20/10/2026" desligado com a dica dos três motivos,
  os mesmos números do banco. Os estados fechado e reaberto foram vistos com o
  fechamento simulado em memória na tela real (`?simular_fechamento=`, código
  temporário retirado antes do commit), porque fechar a Conta Teste de verdade
  exigiria cancelar a baixa da PP-00245, que não é dos títulos de teste: a
  faixa nas três abas, o cadeado nas linhas até 20/10, "Conciliação fechada até
  20/10/2026" e "Reabrir o período" na barra, o "Corrigir a baixa" de 17/10
  recusado com a mensagem da trava, o popup do "Conferir" da PP-00102 (20/10,
  Conta Teste) com o aviso vermelho e o Confirmar recusado, o reabrir com
  motivo curto recusado na tela e com motivo certo levado ao banco (que
  respondeu "A conciliação desta conta não está fechada."), e o "Fechar de
  novo" levado ao banco (que respondeu "11 linhas do banco até 20/10 sem
  conciliar…"). Lado a lado com o protótipo ("Simular fechado até 19/10"), o
  mesmo texto, as mesmas cores e o mesmo cadeado. Nada foi gravado.

## Pendências

1. **O fechamento do DRE por competência** é outro (especificação, seção 11):
   este trava só o caixa.
2. **Os popups de desembolso, fatura, devolução de verba e transferência** não
   avisam antes; o banco recusa com a mensagem da trava.
3. **O fechamento de verdade, pela tela, não foi feito** na Conta Teste (ver
   "Como foi conferido"): o caminho de sucesso foi conferido no banco.
