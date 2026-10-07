# 155 — O save que vem com o job é aprovado na abertura

**Data:** 2026-10-07
**Status:** aceita e implementada (07/10/2026).
**Quem decidiu:** Tiago, em 07/10/2026, a partir de dois protótipos interativos.
- **Como era:** https://claude.ai/artifact/WQ24E5vp7Vemqmw9GzNi6J.
- **A proposta:** https://claude.ai/artifact/THxGXFBhLM1w8UyAFdmk9Y, versão 3, com o atalho da origem abrindo em pop-up.

**Revê:** a [099 §2](099-aprovacao-de-save.md), itens 2 e 6, para os saves que vêm com o envio do job.
**Migration:** `20261007950001_save_aprovado_na_abertura.sql`.

## O problema

Até aqui, o save marcado no orçamento seguia com o envio, mas o pedido de aprovação só nascia no "Sim, abrir job". Cada linha virava um pedido na faixa Saves da fila. Cada pedido se aprovava numa revisão da abertura própria, que gravava de novo as previsões e o registro.

O financeiro conferia os números na abertura, abria o job e depois fazia mais uma revisão por linha. Com o save do orçamento inteiro ([decisão 154](154-save-do-orcamento-inteiro.md)), um orçamento de 10 linhas virava 10 revisões.

## A regra

1. **A aprovação mora no formulário da abertura.** O bloco "Saves deste job · N" fica logo depois das Previsões e traz:
   - o resumo por tipo;
   - o selo do modo inteiro, quando há;
   - as linhas, recolhidas em 3 quando passam de 5;
   - uma caixa por tipo presente: **"Aprovar save gerado"** e **"Aprovar consumo de save"**.
2. **Sem as caixas presentes marcadas, "Abrir job no financeiro" não libera.** O rodapé diz o que falta: "Marque “Aprovar save gerado” para abrir o job.", "Marque “Aprovar consumo de save”…" ou "Marque a aprovação dos saves…". A Server Action confere o mesmo, antes de qualquer escrita, e recusa com a mesma mensagem.
3. **Abrir o job aprova os pedidos.** A confirmação diz "Os N saves deste job ficam aprovados.", mostra a linha "Saves aprovados com a abertura" e o botão "Sim, abrir job e aprovar os saves" (no singular com um save). Os pedidos nascem e são aprovados numa transação só:
   - situação `aprovado`;
   - momento `abertura`, ou `reenvio` para o job devolvido;
   - decididos por quem abriu.
   Nada vai para a faixa Saves, e não há revisão por save.
4. **Recusar um save antes de abrir é o "Reprovar job" de hoje.** O job volta para a produção, que corrige o save no job devolvido e reenvia (decisões 057 e 128). Não existe recusa de linha dentro da abertura.
5. **Saldo do cliente no bloco:** "antes" é o disponível do cliente somando os OUTROS jobs dele, já com o consumo deste job reservado; "depois" = antes + crédito. No exemplo do protótipo: R$ 8.000,00 → R$ 22.800,00 (escolha do Tiago). Para cada job de origem: "usa X · saldo Y · sobram Z", com o saldo de antes deste consumo.
6. **A planilha do job de origem abre em pop-up.** Um atalho "Visualizar planilha do {código}", no mesmo visual do "Visualizar planilha interna", fica logo abaixo dele na coluna da direita. Ele abre a Planilha Interna do outro job em leitura. Ela chega por streaming (`Suspense`) e não atrasa o formulário. Só existe quando o job consome save.
7. **No job aberto, o bloco aparece em leitura:**
   - as caixas marcadas e travadas, com "Aprovado por {nome} em {data}";
   - a coluna "Situação" com o chip de cada pedido.
8. **A errata de save do job já aberto (`job_aberto`) não muda.** Ela segue para a faixa Saves e para a revisão da abertura.

## O que mais mudou junto

- **Envio do GP:** o formulário e a confirmação ganharam a linha "Consumo de save", com os jobs de origem. Antes só o save gerado aparecia, e o job pago inteiro por save chegava com "Faturamento previsto R$ 0,00" sem explicação. O texto do crédito passou a "Fica disponível para outros jobs quando o financeiro abrir o job.".
- **Conferência da fila:** "São aprovados junto com a abertura do job, no formulário de abertura. Se algum não deveria ser save, use Reprovar." Antes dizia "Não são aprovados aqui…".
- **Linha da fila:** marca "Orçamento inteiro em save", "Orçamento inteiro pago pelo saldo do {código}" ou "N linhas com save".
- **Pop-up de save da linha, no job ainda não aberto:** "O financeiro aprova junto com a abertura do job."

## Onde mora

- **Banco:** `save_aprovar_na_abertura(job, momento, números)`, com SECURITY DEFINER e execução só para `authenticated`. Ela chama `save_enviar_pendentes` (papel, status e uma linha por pedido) e depois `decidir_pedido_save(…, 'aprovar', null, null, 'manter', null)` para cada pedido. Com totais nulos e revisão `manter`, os números do job e a revisão da abertura não mudam: o financeiro já os contava desde o envio.
- **Se a aprovação falhar,** nada fica gravado. A action cai no caminho de antes (`save_enviar_pendentes`): os pedidos vão para a faixa Saves, e a mensagem manda aprová-los por lá.
- **Server Action:** `abrirJobNoFinanceiro(jobId, payload, { gera, consumo })`. A auditoria `save.pedido.aprovado` leva `{ na: "abertura", momento, quantidade }`.
- **Telas:**
  - os dados do bloco vêm de `abertura-de-job/saves-da-abertura.ts`;
  - o pop-up da origem é `abertura-de-job/[jobId]/planilha-da-origem.tsx`;
  - o formulário é `abertura-form.tsx`.

## Testado (07/10/2026, dev do worktree, administrador)

- **TES-1023/26** (TES-P001/26-26, consome R$ 5.000,00 do TES-1007/26):
  - o envio mostrou "Consumo de save · TES-1007/26";
  - a fila mostrou "Orçamento inteiro pago pelo saldo do TES-1007/26";
  - a abertura liberou só com a caixa marcada;
  - a chamada da action mandada pelo console com a caixa desmarcada foi recusada, e o job ficou aguardando, sem pedido;
  - aberto, o pedido nasceu `aprovado` e o saldo do TES-1007/26 foi a R$ 0,00;
  - o job aberto mostrou o aviso "pago com saldo em save".
- **TES-1024/26** (TES-P002/26-06, orçamento inteiro gerando R$ 10.000,00): dois pedidos `aprovado` no "Sim, abrir job", o crédito de R$ 10.000,00 no saldo do cliente e nenhuma faixa Saves.
