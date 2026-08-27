# Save — o que olhar no teste ponta a ponta

**Data:** 2026-08-26
**Combinado com o Tiago:** quando o Save estiver todo implementado, rodar
um teste completo no navegador — criar projeto, orçamentos, aprovar, abrir
job, faturar, dar baixa e encerrar — e corrigir o que aparecer.

Este arquivo existe porque alguns pontos **não puderam ser verificados
enquanto se implementava**, e outros são armadilhas conhecidas. É a lista
do que merece atenção extra naquele dia.

---

## 1. O que ficou SEM verificação nenhuma

### 1.1 A trava do teto do save na emissão da nota

`emitir_faturamento` recusa faturar mais save do que o job gerou. **Não
consegui exercitar isso**: a RPC começa com `is_tenant_member`, que
depende de `auth.uid()`, e a conexão do MCP roda sem JWT — as tentativas
morrem em "Sem acesso a este tenant".

**No teste:** emitir uma nota com item de save maior que o saldo gerado e
conferir que a mensagem nomeia o job e os dois valores. Depois emitir
dentro do teto e conferir que a nota sai com **dois itens**
(`origem_tipo` `job` e `save`) na mesma parcela do envio.

### 1.2 O portão do cancelamento

Não cancelar nota cujo save já foi consumido por job **encerrado**. Mesmo
motivo: não deu para chamar a RPC daqui.

**No teste:** consumir o save num job, encerrar esse job, e tentar
cancelar a nota de origem. Tem que recusar. Com o job consumidor ainda
aberto, tem que deixar cancelar.

### 1.3 A data original no fluxo de caixa do job consumidor

Verifiquei a atribuição do save com dado temporário, mas a classe que
preserva a data original é a **`movimento`** (a baixa realizada), e para
exercitá-la é preciso uma baixa de verdade.

**No teste:** dar baixa numa nota com save, depois abrir um job que
consuma esse save, e conferir que o fluxo do job consumidor mostra o
dinheiro **na data da baixa** — anterior à abertura dele. Atenção: a
classe `previsao` empurra data passada para amanhã, e isso é regra
antiga, não do save. Só a `movimento` guarda a data real.

---

## 2. Armadilhas conhecidas

### 2.1 Job 100% pago por save não consegue ser enviado para faturamento

Faturamento previsto zero, e `enviarJobParaFaturamento` recusa valor zero.
A decisão 023 §11 criou a exceção (encerra sem faturar), **mas ela ainda
não foi implementada**.

**No teste:** montar esse job e tentar encerrar. Hoje deve travar.

### 2.2 Consumo criado depois do envio para faturamento

`jobs_envio_faturamento.valor_faturado` é cópia congelada. Mexer no save
depois do envio faz os dois números divergirem. A trava está prevista na
spec e **ainda não foi implementada**.

**No teste:** enviar um job para faturamento e depois tentar mexer no save
dele.

### 2.3 NF agrupada e o ponto cego que já existia

`lib/data/faturamento-por-job.ts:47` e
`app/(app)/financeiro/abertura-de-job/consumo.ts:41` leem
`faturamentos.origem_id`, que é nulo em nota agrupada desde a decisão 017.
É bug anterior ao save, e o save **agrava**.

**No teste:** emitir uma nota agrupada que cubra dois jobs, um deles com
save, e ver se a esteira reconhece os dois.

### 2.4 A sobra do save ao encerrar o job consumidor

Decisão 023 §7: a sobra volta ao saldo do cliente e o resumo de fechamento
mostra "Saldo em save devolvido ao cliente". **Ainda não implementado.**

### 2.5 Somar fluxos de job não dá o fluxo da empresa

A linha de save encolhe conforme é consumida, então o total da empresa
não muda — mas o dinheiro em save que ainda não foi consumido aparece
**sem job**. Quem somar só os fluxos por job vai achar menos que o
consolidado, e a diferença é exatamente o save ainda não gasto.

---

## 3. Dado de teste que ficou no banco

- **JOB-0002**, linha "DA" marcada como save, com a errata
  `Save: "DA" vira crédito` no histórico. Deixado de propósito para o
  Tiago ver a feature funcionando.
- **TESTE-0003/26-07 · Teste Abas Versoes, v4**, linha "3" marcada como
  save no orçamento.

Os dois foram avisados na hora. Tudo o mais que criei durante a
implementação foi feito em bloco que se desfaz sozinho, e conferido
depois com contagem zero.
