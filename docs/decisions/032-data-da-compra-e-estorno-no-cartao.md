# 032 — A data da compra, o estorno, e a fatura credora

**Data:** 2026-08-29
**Decidido por:** Tiago

Fecha as pontas que a [031](031-a-fatura-do-cartao-e-a-conta-que-paga-varias-empresas.md)
deixou abertas e acrescenta o estorno.

---

## 1. Quem escolhe a fatura é a data da compra

A compra passou a ter `data_compra`. Vazio continua sendo hoje.

Antes ela escolhia a fatura por `current_date` — o dia em que era
**lançada**. Serve enquanto o financeiro lança no mesmo ciclo, e mente
assim que ele lança com atraso: a compra de 20/09 registrada em 02/10
caía na fatura de outubro.

Compra retroativa cuja competência já fechou **não volta para dentro da
fatura fechada**: ela rola para a competência aberta seguinte. A fatura
fechada já virou contabilidade e a diferença dela já foi classificada no
fechamento; reabrir seria desfazer isso.

## 2. As seis funções de baixa perderam a trava de empresa

A [031](031-a-fatura-do-cartao-e-a-conta-que-paga-varias-empresas.md)
derrubou a FK composta e limpou duas funções. As outras seis saíram
agora, com a regra enunciada por inteiro:

> "Jobs sempre estarão associados a empresas, e os faturamentos e NFs
> também, visto que sempre serão emitidas por uma empresa. Porém, as
> contas em si não são específicas de uma empresa."

A empresa é do **documento**. A conta bancária e o cartão são o cano por
onde o dinheiro passa.

## 3. O estorno aponta para a compra

Devolução de compra, cancelamento de assinatura, cobrança indevida
reconhecida pela operadora: o cartão recebe crédito. Antes a única saída
era o ajuste do fechamento — que é para IOF e anuidade, e não deixa
rastro de qual compra foi desfeita.

**O estorno aponta para a compra**, como a devolução de verba aponta para
a PP. Dessa ligação ele **herda** empresa, plano de contas, job,
fornecedor e cliente — herda em vez de perguntar, porque estorno com
plano de contas diferente do da compra não se anula no DRE, e anular é a
única razão de ele existir.

Ele vive em `contas_avulsas` como coluna (`estorno_de_avulsa_id`) e não
como tabela nova, ao contrário da devolução de verba: o estorno precisa
entrar numa fatura, e o que entra em fatura é avulsa. Tabela à parte
obrigaria toda query de fatura a unir duas fontes para somar.

O sinal mora em `natureza` (`entrada`), nunca no valor.

**Estornar compra já paga é o caso normal**, não a exceção — você compra
em setembro e devolve em outubro. O crédito cai na fatura aberta do dia
do estorno.

**Estorno parcial é permitido**, somando: o teto é o valor da compra
menos o que já foi estornado dela, checado no banco.

### ⚠️ Para quem for implementar o parcelamento

O estorno aponta para a **compra**, de propósito — nunca para a parcela.
Uma compra em 3x estornada por inteiro gera **um** estorno do valor
cheio, e as parcelas já pagas **continuam pagas**; o crédito cai na
fatura aberta do dia e abate o que vier. É como a operadora faz. Se o
parcelamento re-apontar o estorno para a parcela, isso quebra.

## 4. Fatura credora fecha e não vira título

Se os estornos cobrirem as compras do mês, a fatura fecha em zero ou
negativa. Nesse caso **nada desce para Títulos a Pagar**: não há o que
pagar. O saldo credor fica na conta do cartão e abate sozinho a próxima
fatura, que é o que a operadora faz — e combina com o cartão ser um razão
contínuo, não uma conta que zera todo mês.

`dar_baixa_fatura_cartao` recusa pagar fatura credora, com a mensagem
dizendo o porquê.

---

## 5. A fatura volta atrás (29/08/2026, mesma sessão)

```text
aberta  ⇄  fechada  ⇄  paga
        reabrir     estornar a baixa
```

**Reabrir apaga** os lançamentos do fechamento — eles são derivados,
nascem inteiros a partir dos itens, e nenhum é dinheiro que saiu do
banco. **Estornar contra-lança**, porque aí o dinheiro saiu. Fatura paga
não reabre direto: estorna primeiro. Motivo obrigatório nos dois, e vai
para a auditoria.

## 6. Compra parcelada (29/08/2026, mesma sessão)

Cada parcela é uma avulsa irmã, não uma linha de tabela de parcelas: no
cartão a parcela **é** a linha da fatura daquele mês.

⚠️ A parcela anda por **competência**, não por mês de calendário. Espaçar
por mês fazia duas parcelas caírem na mesma fatura quando a primeira
rolava por competência fechada.

O estorno aponta para a **cabeça** e o teto é o **total do grupo** — a
compra em 3x estornada por inteiro é um crédito só, e as parcelas já
pagas continuam pagas.

---

## 7. PP paga no cartão (29/08/2026, mesma sessão)

A fatura passa a ter duas fontes de item: conta avulsa e parcela de PP.

**A forma é escolhida na aprovação, pelo financeiro** — quem abre a PP é a
produção, que não decide por onde o dinheiro sai.

⚠️ **E o plano de contas também**, quando é cartão. Na PP normal ele é
escolhido na baixa; no cartão não existe baixa individual, então tem que
vir antes — senão o fechamento não teria como classificar o lançamento.

**Uma parcela, uma fatura, pela data dela.** A PP de 30/60/90 dias vira
três itens em três faturas, pelo prazo que a produção negociou. Duas
parcelas podem cair na mesma fatura quando a competência de uma já foi
paga, e está certo: aqui as datas vêm negociadas de fora, e a regra é
respeitá-las — diferente do parcelamento da compra avulsa, onde o sistema
gera as datas e por isso garante competências distintas.

**Estorno de parcela de PP fica de fora**: devolução de fornecedor numa PP
no cartão entra como ajuste do fechamento. A PP já tem devolução de verba,
que é outra coisa.

---

## O que ficou em aberto

- **Exportação contábil** — junto com a exportação das contas, quando o
  layout do sistema do contador estiver definido, para sair tudo de uma
  vez. Não fazer por partes.
- **Teste ponta a ponta da errata**, combinado para uma sessão conjunta.

## Onde está escrito

`docs/handoffs/HANDOFF_FINANCEIRO.md`, nas notas de 29/08/2026.
