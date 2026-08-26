# 023 — O save fatura num job e vale em outro

**Data:** 2026-08-24
**Status:** aceita
**Contexto:** planilha do orçamento (`/orcamentos/.../versoes/[versaoId]`),
Planilha Interna do job (`/jobs/[jobId]`) e fila de faturamento
(`/financeiro/contas-a-receber`), com efeito nas telas consolidadas de
projeto e no encerramento do job. Brief de design:
`docs/design-briefs/2026-08-24-save-brief.md`. Regras definidas pelo Tiago
em 24/08/2026.

## O problema

O cliente fecha um orçamento com a agência e, na prática, não usa todas as
linhas dele naquele projeto. O valor dessas linhas **não se perde**: é
faturado assim mesmo e fica guardado como crédito para um projeto
seguinte. A operação chama isso de "dar um save".

O sistema não tinha onde guardar isso. `faturamento previsto` e `valor do
job` sempre andaram juntos, calculados pela mesma passagem de
`calcularTotaisVersao`. O save é justamente o caso em que os dois precisam
divergir.

## A mudança em três frases

1. Uma linha pode ser marcada como **save**: ela sai da base do **valor do
   job** e permanece na base do **faturamento**.
2. Uma linha pode **consumir save** de outro job: ela sai da base do
   **faturamento** e entra na base do **valor do job**.
3. Por causa disso, **honorários e imposto passam a ser calculados duas
   vezes**, em bases independentes — uma para cada um dos dois números.

Nada disso muda `REGRAS_TIPO_CUSTO` (decisão 003). O save é uma alavanca
**ortogonal** ao tipo de custo: a linha em save continua sendo A, B ou C
para efeito de honorários e imposto. Um orçamento sem nenhuma linha em
save produz exatamente os números de hoje.

## 1. A linha em save sai do valor do job e fica no faturamento

O cliente paga por ela agora. O serviço não acontece neste projeto, então
ela não compõe o que este job entrega.

## 2. A linha que consome sai do faturamento e entra no valor do job

O serviço acontece aqui. Mas ele já foi cobrado no job de origem, e a
agência não cobra duas vezes.

## 3. Honorários e imposto passam a ter duas bases

Esta é a parte que muda o motor de cálculo, e é a razão de a decisão
existir.

Cada linha passa a ter **dois valores efetivos**:

```
base de faturamento = total orçado − quanto ela consome de save
base de valor do job = está em save ? 0 : total orçado
```

O fechamento inteiro — subtotais por tipo, honorários, imposto em
gross-up, principal — roda **uma vez com cada base**.

### O exemplo, célula a célula

Honorários 10%, imposto 19,53%.

**Job A.** R$ 50.000 tipo B que serão usados + R$ 30.000 tipo B em save.
**Job B.** R$ 15.000 tipo B normais + R$ 30.000 consumindo o save de A.

| | Job A | Job B | Soma |
|---|---:|---:|---:|
| Principal que fatura | 80.000,00 | 15.000,00 | |
| Honorários | 8.000,00 | 1.500,00 | |
| Imposto | 21.357,52 | 4.004,54 | |
| **Faturamento previsto** | **109.357,52** | **20.504,54** | **129.862,06** |
| Principal no valor do job | 50.000,00 | 45.000,00 | |
| Honorários | 5.000,00 | 4.500,00 | |
| Imposto | 13.348,45 | 12.013,61 | |
| **Valor do Job** | **68.348,45** | **61.513,61** | **129.862,06** |

**As duas somas dão o mesmo número, exatamente.** Não é arredondamento
feliz: é a invariante do desenho. O cliente compromete o mesmo total que a
agência fatura, só que distribuído em jobs diferentes. Se um dia deixar de
fechar, a conta está errada.

O que o Job A fatura a mais — R$ 11.009,07 de honorário e imposto sobre a
linha em save — é exatamente o que o Job B precisa a mais no valor do job.

## 4. O saldo é o principal; a receita que migra é o faturamento cheio

São **dois números para a mesma linha**, e os dois são verdadeiros.

| | Valor | O que é |
|---|---:|---|
| **Saldo em save** | 30.000,00 | O crédito que o cliente tem a gastar |
| **Receita que migra** | 41.009,07 | O que a nota do Job A cobriu por causa dela |

O saldo é **só o principal**. O que o cliente tem guardado é o custo do
serviço, não a nota cheia — honorário e imposto são da operação de faturar,
não do serviço que ficou por fazer.

A receita que migra é o **faturamento cheio que a linha gerou na origem**,
porque é esse o dinheiro que existe. Ela é rateada **proporcionalmente ao
consumo do principal**: se o Job B usar R$ 25.000 dos R$ 30.000 — 83,33% —,
migram **R$ 34.174,23** e o resto continua com A até alguém consumir.

## 5. Todos os tipos aceitam save, mas o saldo não significa a mesma coisa

Qualquer tipo de custo pode ser marcado: A, AR, B, C, D, F e FI.

Mas em **A, D, F e FI** o principal não passa pela California — o cliente
paga o fornecedor direto (`fatura: false` na decisão 003). Numa linha tipo
A de R$ 30.000 em save, o saldo de R$ 30.000 é **compromisso do cliente**,
não caixa da agência. E a receita que migra é só a fatia de honorário e
imposto: **R$ 3.728,10** — R$ 3.000,00 de honorário e R$ 728,10 de imposto
sobre ele.

A fórmula produz isso sozinha, sem regra especial, porque `fatura: false`
zera a contribuição do principal. **A assimetria é real e precisa aparecer
na tela**: "saldo em save" quer dizer coisas diferentes conforme o tipo.

## 6. Uma linha de save é de um job só

A alocação é **exclusiva**: uma linha em save é reservada para um único job
consumidor. Dentro dele, pode ser rateada entre **vários itens**.

Um item consumidor pode ser pago **só em parte** por save. Um item de
R$ 40.000 puxando R$ 30.000 entra no valor do job pelos R$ 40.000 cheios e
na base do faturamento pelos R$ 10.000 que sobraram.

A alocação acontece na **planilha do job consumidor**: ao marcar um item
como consumidor, um seletor lista os saves disponíveis do cliente.

O save é **consumível desde a abertura do job de origem**, antes de a nota
sair. O ERP já trata `faturamento_previsto` como compromisso desde a
abertura, e esperar a nota criaria uma fila que a operação não tem como
cumprir. O seletor mostra o estado — "faturado" ou "a faturar" — para quem
quiser esperar.

> ⚠️ **Aguardando confirmação do Tiago** (24/08/2026): este parágrafo é
> recomendação, não decisão fechada. Se o save só puder ser consumido
> depois da nota emitida, esta seção muda e a fatia 3 ganha uma trava.

## 7. A sobra volta ao encerrar o job consumidor

Se o job alocado não gastar tudo, a sobra **se desprende no encerramento** e
volta ao saldo disponível do cliente, livre para outro job.

O resumo de fechamento mostra **"Saldo em save devolvido ao cliente"**.
Devolução silenciosa é como o dinheiro some da vista de todo mundo.

## 8. O save é do cliente

Qualquer job futuro do mesmo cliente pode consumir, **mesmo em outro
projeto**. O saldo **sobrevive ao encerramento do job de origem** — é do
cliente, não do job.

Origem e consumidor **podem ter percentuais diferentes**. A receita que
migra é a que a origem faturou; o valor do job do consumidor usa os
percentuais dele. Quando diferem, a soma deixa de fechar exata, e a
diferença aparece como conciliação — o seletor avisa antes de alocar.

## 9. Linha em save não tem custo

O serviço não aconteceu ali. Então, no job de origem, a linha em save:

| | |
|---|---|
| Planejado | zerado e travado |
| Pedido de Produção | não gera |
| BV | não aceita |
| Rentabilidade | fica de fora |
| Orçado | **continua cheio** — é ele que está sendo faturado |

O custo nasce no job que consumir.

## 10. Orçamento de save inteiro

Uma chave no cabeçalho da versão faz **toda linha nova nascer marcada**. O
job resultante tem **valor do job zero** e faturamento cheio, e o saldo
inteiro fica disponível para o cliente.

É a segunda porta de entrada do save, e reaproveita o fluxo orçamento →
versão → aprovação → job que já existe. Não há tipo de job novo nem
máquina de estados nova.

A chave é **default de linha nova, não trava**: uma linha pode ser
desmarcada depois.

## 11. Job com faturamento zero encerra sem faturar

Um job 100% pago por save tem faturamento previsto zero. Hoje isso o
prenderia para sempre: `enviarJobParaFaturamento` recusa valor zero, e a
decisão 008 §1 só deixa encerrar quem foi enviado.

**Exceção explícita:** job com faturamento previsto zero **e** consumo de
save encerra direto. Não há nota a emitir — ela saiu no job de origem.

## Por que o saldo não leva honorários e imposto

A alternativa era um saldo de R$ 41.009,07 — o faturamento cheio da linha.
Ela foi descartada: o crédito que o cliente tem a gastar é o **custo do
serviço**, não a nota. Se o saldo levasse o honorário embutido, o cliente
compraria menos serviço com o mesmo crédito, ou a agência abriria mão do
honorário do job que executar.

Com o saldo em R$ 30.000, o Job B recalcula honorário e imposto sobre a
linha nos **seus** percentuais, do lado do valor do job — e o cliente paga
o honorário **uma vez só**, no Job A.

## O que NÃO mudou

- `REGRAS_TIPO_CUSTO` e a decisão 003 — as sete linhas da matriz seguem
  idênticas.
- BV, Pedidos de Produção, errata, esteira do faturamento e encerramento
  continuam como estavam para qualquer job sem save.
- O fechamento de um orçamento sem linha em save dá **exatamente** os dois
  números de hoje.
- A planilha exportada ao cliente continua mostrando o total cheio: ela lê
  um terceiro fechamento, calculado como se o save não existisse.

## Onde a regra mora

| Arquivo | O quê |
|---|---|
| `lib/calculos/versao-totais.ts` | Os dois fechamentos, o rateio da receita e o efeito por item na errata |
| `lib/calculos/bv-planilha.ts` | Exclusão da linha em save da rentabilidade |
| `versoes_orcamento_itens.em_save`, `jobs_itens_orcado.em_save` | A marca |
| `jobs_itens_orcado.save_consumido` | Quanto a linha consome |
| `versoes_orcamento.save_por_padrao` | A chave do orçamento de save |
| `jobs_saves`, `jobs_saves_consumos`, `vw_saves` | O crédito, o consumo e o saldo |
| `faturamento_itens.origem_tipo = 'save'` | A separação dentro da nota |

## O que ficou de fora, de propósito

- **Save entre clientes diferentes.** O crédito é do cliente.
- **Uma linha de save consumida por mais de um job.** A alocação é
  exclusiva.
- **Validade ou expiração do saldo.** Não foi decidido. Se aparecer, é
  decisão nova.
- **Devolução de saldo ao cliente em dinheiro.**
- **Marcar ou desmarcar save por errata.** A marca congela na abertura;
  mexer nela depois obrigaria a cancelar PPs e BVs e zerar o planejado
  dentro da errata, que é feature própria e não efeito colateral.
  ⚠️ **Aguardando confirmação do Tiago** (24/08/2026) — é recomendação,
  não decisão fechada.

## ⚠️ Nota de 2026-08-26 — o que o design mudou

O design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
`69342d83`) trouxe a dinâmica mais perto da operação, e o Tiago fechou os
pontos em aberto. **Onde esta nota diverge do texto acima, é ela que
vale.**

### 1. O saldo é do JOB, não da linha

A §6 dizia que uma linha de save era alocada a um único job consumidor.
Não é mais assim. **O consumo sai do saldo do job de origem**; as linhas
que geraram o saldo continuam visíveis — são o detalhe do pop-up ("Saldo
do JB-0031 formado por Pós-produção R$ 20.000 · Trilha sonora R$ 6.000 ·
Estúdio R$ 12.000") — mas quem tem saldo é o job.

**Uma linha consumidora pode beber de vários jobs ao mesmo tempo.** No
design, a Produção de vídeo de R$ 20.000 é paga por JB-0031 (R$ 14.000) e
JB-0028 (R$ 6.000). Na planilha aparece o código da maior origem com um
`+1`.

### 2. Acabou a alocação exclusiva

O saldo de um job é **conta corrente do cliente**: qualquer orçamento ou
job dele consome até zerar. A sobra de R$ 10.000 do JB-0031 fica livre
para o próximo, seja ele qual for.

### 3. Rascunho não segura saldo

O consumo nasce no orçamento, que pode estar em rascunho. Ele aparece na
tela e conta nos totais **daquele orçamento** desde o primeiro momento —
mas só abate o disponível do job de origem **quando a versão é aprovada**.
Até lá é reserva: avisa, não impede. Dois rascunhos podem apontar para o
mesmo saldo, e quem aprovar primeiro leva.

### 4. Na abertura, o consumo é copiado para o job

Como os itens. A versão aprovada fica intocada — é o que o cliente
aprovou — e a linha da versão é marcada como substituída para não contar
duas vezes.

### 5. No job, gerar E consumir save são Errata

Isto **reverte** a recomendação que estava em "O que ficou de fora".
Depois da abertura, marcar uma linha como save e criar ou mexer num
consumo alteram o faturamento previsto e o valor do job — exatamente o
que a errata existe para registrar. Os dois passam por ela, com o "antes"
e o "depois" dos dois números.

### 6. Consumo parcial confirmado

O design pedia que o consumo fechasse exato com o orçado da linha. O
Tiago manteve a regra da §6: um item de R$ 40.000 pode puxar R$ 30.000, e
os R$ 10.000 restantes seguem faturados normalmente.

### 7. Um centavo do design

O design mostra faturamento previsto de R$ 39.865,78. A conta correta dá
**R$ 39.865,79** — o design arredondou o gross-up para baixo. O número do
sistema é o da conta.

### Onde isso está implementado

| Arquivo | O quê |
|---|---|
| `lib/calculos/versao-totais.ts` | Os três fechamentos, os dois deltas da errata e os helpers de receita |
| `scripts/conferir-save.ts` | Prova a conta contra o design E contra esta decisão |
| `supabase/migrations/20260826000001_save_marca_e_padrao.sql` | `em_save`, `save_consumido`, `save_por_padrao`, e as travas de planejado e BV |
| `supabase/migrations/20260826000002_save_consumos.sql` | `saves_consumos`, `vw_saves_por_job`, `vw_saves_linhas` e as invariantes do consumo |

## ⚠️ Nota de 2026-08-24 — o que ainda precisa do Tiago

Dois pontos desta decisão estão escritos como **recomendação** e esperam
confirmação: o momento em que o save vira consumível (§6) e a errata poder
marcar ou desmarcar save (acima). Nenhum dos dois trava o design; os dois
travam a implementação.

Fora da decisão, há **um item destrutivo** na implementação, que pela régua
do `docs/FLUXO-BANCO.md` não se aplica sozinho: substituir o CHECK
`chk_fat_item_origem` em `faturamento_itens` para aceitar a origem `save`.
O CHECK novo é estritamente mais permissivo e a tabela tem 2 linhas, mas
substituição de constraint exige confirmação explícita.
