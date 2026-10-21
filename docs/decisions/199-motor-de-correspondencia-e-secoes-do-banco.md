# 199 — O motor de correspondência, o vínculo "conciliado" e as seções da Conciliação automática

**Data:** 2026-10-21
**Status:** aceita; entrega 3A implementada em 21/10/2026 (task 029, fase 3):
o motor, o vínculo e as seções para ver. As ações de cada linha chegam com a
entrega 3B (decisão 200) e a automação na importação com a 3C (decisão 201).
**Quem decidiu:** Tiago, no protótipo "Conciliação com o banco", versão
**Alternativa** (`docs/handoffs/2026-10-21-conciliacao-com-o-banco/`, seções
4.5 e 4.6 da especificação), e nos pontos M3.3 e M3.8 de 21/10/2026 (opção A
nos dois).
**Migrations:** `20261021700001_extrato_importado.sql` e
`20261021700002_vw_extrato_linhas.sql`.

## O problema

Com o extrato do banco importado (decisão 198), falta dizer, para cada linha,
o que o sistema tem para ela — a baixa já feita, o título ainda em aberto, a
remessa, a tarifa — e guardar que a linha foi conciliada.

## A regra

### O motor

1. **O motor é o `casar` do protótipo**, portado para
   `lib/conciliacao/motor.ts` como função pura, e roda nas linhas do banco
   ainda sem solução, da tentativa mais certa para a menos certa:
   1. a baixa feita à mão que bate (mesmo valor e sinal, até 3 dias);
   2. 1b. a que diverge (até R$ 1 ou 1%, até 3 dias);
   3. saiu e voltou (a devolução e a saída de mesmo valor no mesmo dia);
   4. o título pelo valor exato, por pontos (base 60; data igual +20, até 3
      dias +15, até 7 +5, mais de 20 −25; forma igual +10, o boleto aceita a
      guia; o CNPJ do histórico igual ao do título +30): **alta** com 90 ou
      mais e sem empate;
   5. 3a. linhas iguais em número igual ao de títulos empatados: cada linha
      paga um;
   6. 3b. a retenção na fonte que explica o banco ter menos;
   7. a remessa que soma centavo a centavo;
   8. 4b. de 2 a 4 títulos da mesma contraparte que somam a linha;
   9. juros e multa no boleto e na guia;
   10. a regra do histórico;
   11. sem correspondência.
2. **"Certo" é confiança alta com centro de custo.** O que precisa de
   decisão fica para alguém.
3. **Uma diferença deliberada do protótipo:** a remessa só casa com uma
   linha de **saída** do banco; no protótipo ela não conferia o sinal.
4. **A baixa e os juros dela são um valor só** (decisão 196, condição do
   Tiago): o passo 1/1b compara o total que saiu da conta com o banco.

### O que o motor recebe do sistema

5. **Os títulos** são os da aba Títulos (`carregarTitulosDaConciliacao`),
   montados como a planilha os monta, e só os que mexem nesta conta
   (`efeitoNaConta` diferente de zero: a transferência de outras contas e o
   rendimento de outra aplicação ficam de fora). O id é a chave da linha da
   planilha (`pagar|pp|<id>`…). A forma prevista vira o vocabulário do
   histórico (transferência é "ted", o imposto é "guia"); o título sem data
   conta como de hoje, como no saldo previsto. O CNPJ é o do fornecedor ou
   do cliente do título.
6. **As remessas** da conta (`cnab_remessas` "gerado") casam só quando todos
   os itens ainda têm o título em aberto e sem baixa. O total é a soma do que
   cada item pagou — o líquido, decisão 145. O título que está numa remessa
   que ainda casa não casa sozinho.
7. **Os lançamentos da conta ainda sem linha do banco** chegam juntados como
   o banco os mostra: a baixa e os juros dela; as partes de uma guia de
   imposto (decisão 141); e as baixas dos itens de uma mesma remessa, no
   mesmo dia — o banco debita a remessa inteira numa linha só.
8. **As regras do histórico** (`extrato_regras`): as da conta antes das de
   todas as contas, e o padrão mais longo antes do mais curto. A semente
   criou "TAR" → 04 · Custo Fixo · Tarifa bancária e "IOF" → 11 · Despesa
   com Juros nas contas que tinham empresa no cadastro (a California
   Santander e a Conta Teste): a regra lança com uma empresa, e a conta não
   tem mais empresa desde 09/09/2026. As outras contas ganham regra pelo
   "Lembrar como regra" (entrega 3B).

### O vínculo "conciliado" (M3.3, opção A)

9. **Conciliado é ter a linha:** `lancamentos_financeiros.extrato_linha_id`,
   com FK para `extrato_linhas` (`on delete restrict`) e índice. Várias
   baixas numa linha só (remessa, soma de títulos, guia com rateio, a baixa e
   os juros dela). Não há coluna de status.
10. **Só a aba Banco liga.** Um gatilho recusa gravar `extrato_linha_id`
    vindo direto do usuário ("A conciliação com o banco só muda pela aba
    Banco da Conciliação."); só as funções da conciliação gravam.

### Cancelar a baixa conciliada (M3.8, opção A — com uma correção)

11. A especificação supunha que cancelar uma baixa conciliada quebraria a FK.
    **Não quebra:** a FK mora no lançamento e aponta para a linha; apagar o
    lançamento não viola o `restrict`, que protege a **linha**. O risco real
    era outro: apagar só uma parte (a baixa sem os juros, uma baixa da
    remessa) deixaria a linha "conciliada" com um valor que não bate mais.
12. Por isso a opção A virou um gatilho **depois do apagar**: quando um
    lançamento ligado some, os outros ligados à mesma linha se desligam, e a
    linha volta a pendente com `sem_auto` (não se resolve mais sozinha). O
    cancelar de hoje continua como está.

### As seções

13. **A ordem do protótipo** (`AbaBancoRecomendada`): a baixa que não bate
    (vermelho); as baixas feitas à mão que bateram (azul, aberta); prontos
    para baixar e conciliar; conferir antes (com os grupos de linhas iguais e
    o "Trocar…"); uma linha e vários títulos; saiu e voltou; pelas regras do
    histórico; sem correspondência; conciliados (recolhida). Cada uma com o
    contador e recolhível; as vazias somem.
14. **As colunas**: Data · Histórico do banco · Crédito · Débito · Situação ·
    No sistema (com a segunda linha cinza do motivo) · Ação, no MESMO
    `colgroup` e com `table-fixed` em todas as seções e no "sem linha no
    banco" — as colunas ficam na mesma vertical. A Ação tem três vagas fixas
    (a ação, a lupa e o ignorar).
15. **"Baixa no sistema, sem linha no banco"**, embaixo das seções: os
    lançamentos da conta, em dias que o extrato já cobre por inteiro (o dia
    em andamento não conta, decisão 198), que nenhuma linha pendente usou.
16. **As linhas que a aba mostra**: as pendentes de qualquer data e as
    resolvidas do período aberto no topo. O título sugerido tem a etiqueta e
    o ⓘ da planilha.

## Entrega 3A: só ver

As ações de cada linha (baixar e conciliar, corrigir a baixa, ignorar,
desfazer, lançar pela regra) chegam com a entrega 3B: a célula Ação fica com
as vagas vazias, e uma nota na aba diz que, até lá, a baixa continua pela aba
Títulos.

## Como foi conferido

- Testes: `lib/conciliacao/motor.test.ts` roda o motor sobre os dados do
  protótipo e confere a contagem da especificação (`regra:alta 5,
  sugestao:alta 40, diferenca:media 2, combinacao:alta 2, par:alta 2,
  divergencia:media 1, sem_par 1, sugestao:media 3, ja_lancado:alta 1,
  soma:alta 1`) e o resultado linha a linha contra o `casar` do protótipo;
  mais os grupos, a soma 4b com uma e com duas combinações, a remessa só na
  saída, a baixa com juros e a correção da baixa.
  `conciliacao/motor-da-conta.test.ts`: o agrupamento como no banco, o dia
  completo, o texto da linha resolvida, a remessa que ainda casa, o título
  sem data, as seções e o "sem linha no banco".
- No banco, numa transação desfeita: o usuário direto não liga a linha (o
  gatilho recusa).
- No navegador, na Conta Teste, com o OFX montado: a PIX de R$ 100,40 contra
  a baixa de R$ 100,00 da PP-00245 na seção vermelha; a de R$ 3.000,00 da
  PP-00261 em "feitas à mão que bateram"; R$ 300,00 e R$ 4.000,00 em
  "Conferir antes" (12 dias depois da data prevista); o PIX de R$ 250,00 que
  voltou; a tarifa e o IOF pelas regras; R$ 6.000,00 e R$ 99,50 sem
  correspondência; o estorno de verba de R$ 1.263,60 de 19/10 em "sem linha
  no banco". Lado a lado com o protótipo, as mesmas colunas e cores.

## Riscos encontrados (fora deste módulo, para decidir)

1. **`authenticated` grava direto em `lancamentos_financeiros`.** A policy
   `lancamentos_modify` é `FOR ALL` para quem acessa a empresa: um membro
   pode alterar valor, data ou conta de um lançamento pelo PostgREST, sem
   passar pelas RPCs da baixa. A conciliação só travou a coluna dela
   (`extrato_linha_id`). Fechar o resto é mexer na tabela de outro módulo.
2. **Lançamento sem empresa e sem transferência fica invisível** pela RLS de
   `lancamentos_financeiros`. Importa para o "Saiu e voltou" (M3.6), que
   estava aprovado com empresa nula: resolvido na decisão 200, com o ramo da
   devolução bancária na policy de leitura (Tiago, 21/10/2026).
