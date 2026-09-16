# 087 — Faturamento e encerramento correm separados, e o job fica finalizado quando os dois terminam

**Data:** 2026-09-16
**Decidido por:** Tiago
**Migrations:** `20260916170001_job_status_finalizado.sql`,
`20260916170002_encerramento_e_finalizado.sql`,
`20260916170003_encerrado_na_fila_e_no_fluxo.sql`
**Design:** canvas "Encerramento e Faturamento"
(https://claude.ai/artifact/XgM5eaVPRHwNR7Z7ddwswP), páginas "Job normal ·
JOB-0033", "Job mensal · JOB-0034" e "Fechamento: internacional e save".

Revê a [008](008-encerramento-do-job.md) §1 e a
[034](034-encerramento-exige-a-nota-emitida.md), e fecha a pendência que a 034
deixou em aberto.

---

## 1. O problema

Até aqui o job seguia uma fila única: abrir → produzir → enviar para
faturamento → emitir todas as notas → encerrar. O encerramento só existia
depois do envio (008 §1) e travava enquanto houvesse saldo a faturar (034),
porque o job encerrado saía da `vw_faturamento_pendente` e levava o saldo
junto, sem caminho de volta.

Na prática a produção fecha o que é dela antes de o financeiro emitir a última
nota — e às vezes o financeiro fatura antes de a produção fechar. Nas palavras
do Tiago (14/09/2026): *"o faturamento não irá travar o encerramento, e quando
ambos forem feitos, o job será finalizado."*

Medido em 16/09/2026, os quatro jobs já enviados para faturamento travavam
pelo saldo: JOB-0010 (R$ 21.076,81), JOB-0029 (R$ 31.918,72), JOB-0033
(R$ 113.896,60) e JOB-0034 (R$ 16.701,88). O JOB-0033, por exemplo, não tinha
nenhuma PP em aberto — travava por 1 BV, 6 itens sem marcação e pela nota.

## 2. A regra (respostas do Tiago, 16/09/2026)

1. **Os status deixam de ser lineares.** O job pode ser faturado sem estar
   encerrado e encerrado sem estar faturado. **Finalizado** é o status de
   quando as duas coisas terminaram.
2. **O job encerrado entra na fila de faturamento como os outros jobs.**
3. **No mensal, o encerramento não espera o envio dos meses** (leitura b). E no
   job normal também não espera o envio para faturamento: *"ambos os botões e
   processo ficarão disponíveis"*. Consequência confirmada: o envio para
   faturamento continua aceito depois do encerramento.
4. **O que continua travando é só o que é da produção:** PP em aberto (gerada,
   em avaliação, aprovada e rejeitada — 083), BV não recebido, verba de
   produção não concluída (081 §7) e item de custo sem marcação (052). O saldo a
   faturar sai das travas.
5. **Nota cancelada não tira o job de finalizado.** O envio para faturamento é o
   mesmo; se uma nota for cancelada, o financeiro emite outra em Contas a
   Receber.
6. **O "Enviar job para encerramento" vai virar um pedido que o financeiro
   confirma.** Hoje ele encerra na hora (e está em produção desde 14/08/2026,
   `c233ad5`). O fluxo de confirmação será desenhado depois desta entrega.

E três pedidos de tela:

- **Ver o envio para faturamento e o envio para encerramento**, no job normal e
  no mensal.
- **O resumo de fechamento vira o card de Totais do fim da Planilha Interna**,
  com o realizado — que no encerramento já está completo —, adaptado ao
  internacional e ao save (colunas de save abertas e o total no fim).
- **A descrição da nota fiscal pode ser longa:** campo e pop-up maiores.
- A largura das telas é a atual, aprovada na [085](085-a-tela-principal-ocupa-a-largura-do-layout.md).

## 3. Banco

### O status `finalizado` e quem o grava

- `job_status` ganhou `finalizado` (migration sozinha).
- `jobs.encerrado_em`, `jobs.encerrado_por` (FK para `profiles`, com índice) e
  `jobs.finalizado_em`.
- `job_esta_faturado(job)`: o enviado para faturamento cobre o faturamento
  previsto (5 centavos de folga — no JOB-0034 os meses somam R$ 50.105,64 e o
  job R$ 50.105,63) e nenhuma parcela tem saldo sem nota emitida (piso de um
  centavo). Job com faturamento previsto zero está faturado por definição.
- **Quem grava `finalizado` é o banco, em dois momentos só:**
  - no encerramento, se o job já estiver faturado — gatilho BEFORE UPDATE em
    `jobs` troca o `encerrado` pedido por `finalizado`;
  - na emissão da nota que zera o saldo de um job encerrado — gatilho AFTER
    INSERT em `faturamento_itens`, que não mexe na `emitir_faturamento`
    (alterada no mesmo dia pela decisão 086).
- Não há gatilho no cancelamento da nota (regra 5).
- As três funções são `security definer` e nenhuma é executável por `anon` ou
  `authenticated`.

### Fila, fluxo de caixa e cancelamento

- `vw_faturamento_pendente`: o braço de job aceita `aberto`, `encerrado` e
  `finalizado` (o finalizado entra para a nota cancelada e reemitida). O braço
  de BV nunca filtrou status de job.
- `vw_fluxo_caixa`: as quatro partes de **recebimento** previsto de job
  (previsão de recebimento, parcela enviada sem nota, e as duas partes de save)
  passam a valer para encerrado e finalizado. A previsão de recebimento já some
  quando o envio existe, então nada conta em dobro. O **cronograma de
  desembolsos** fica só com aberto e em produção: job encerrado não tem PP em
  aberto nem item sem marcação.
- `cancelar_faturamento`: a nota com save consumido por job encerrado não se
  cancela; vale também para finalizado.

As três foram trocadas por trechos exatos na definição do banco (padrão da
20260915150003 e da 20260916110001), com contagem de âncoras.

## 4. Tela

### A barra do job ganha duas trilhas

Job já aberto (normal e mensal), com a mesma largura da barra de antes:

| Trilha | O que mostra | Ação |
|---|---|---|
| **Faturamento** (normal) | A enviar / Na fila do financeiro / Faturado parcial / Faturado / Sem faturamento, com data do envio, parcelas e quanto já saiu em nota | "Enviar job para faturamento" ou "Ver envio" |
| **Faturamento** (mensal) | A barra por mês de sempre (078), com o resumo "N de 3 meses enviados" | "Ver todos os meses", "Enviar faturamento de <mês>" |
| **Encerramento** | "N pendências" com o resumo de cada uma, ou "Liberado"; depois, "Encerrado · enviado em DD/MM/AAAA por <nome>" | "Enviar job para encerramento" (desabilitado com pendência) ou "Ver envio" |

Antes da abertura (aguardando ou devolvido) a barra continua com uma linha.

### O envio para encerramento

Moldura do "Enviar job para abertura" (`sm:max-w-5xl`, cabeçalho e rodapé
fixos, miolo que rola). Dentro: a caixa vermelha das pendências, quando houver;
o aviso amarelo do que falta faturar — *"Falta faturar — mas isso não trava o
encerramento"* —; e o `JobTotaisCard` com `somenteRealizada` (o seletor
Planejada/Realizada vira o rótulo "Realizada") e `colunasSaveAbertas`. No
mensal o card é o "Totais do trimestre". O "Ver envio" é o mesmo diálogo, só
leitura, com quem enviou e quando.

⚠️ **O número do fechamento muda.** O resumo de antes não somava o BV na margem;
o card soma. No JOB-0033: R$ 95.950,00 (64,9%) no resumo antigo, R$ 100.450,00
(67,9%) no card. Saem do fechamento a linha "Faturamento previsto na abertura"
e o aviso de divergência entre valor enviado e faturamento — depois do envio não
há errata (034 §5), então a divergência não se forma.

### Ver envio para faturamento e a descrição da nota

- O job normal ganhou o pop-up que o mensal já tinha ("Envio de outubro").
  Os dois usam o mesmo componente (`envio-faturamento-ui.tsx`).
- Pop-up com 640 px (era 512) e a descrição em `text-sm`.
- Formulário de envio com 620 px (era 512), campo da descrição com 8 linhas
  (eram 3) e contador de caracteres — o limite de 2.000 já existia.

### Selo do status

Um lugar só, `jobStatusBadgeClasses` em `lib/types.ts` (eram cinco cópias):
Aberto azul · **Encerrado violeta** (era verde) · **Finalizado verde**. O violeta
é a cor que a marca de status já tinha na lista de jobs do financeiro. O
cabeçalho do job no financeiro, que mostrava todo status em azul, passou a
usar o mesmo selo, e o "Aguardando encerramento" dele agora aparece para o job
aberto já todo faturado — antes era qualquer job enviado.

### Consequências no resto do sistema

- `jobEstaCongelado` inclui `finalizado`; `jobAceitaEnvioParaFaturamento`
  (aberto e encerrado) substitui o `status === "aberto"` do envio.
- A exceção do save da [028](028-save-entre-jobs.md) §11 saiu do
  `encerrarJob`: ela existia porque o encerramento exigia envio.
- As confirmações do envio não prometem mais o que deixou de valer ("depois
  disso o job fica pronto para ser encerrado"; "os outros meses seguem
  editáveis" num job encerrado).
- Home do GP: "Jobs prontos pra enviar pra faturamento" conta também o
  encerrado; "Jobs com faturamento próximo" e o filtro da lista idem.
- Lista de jobs, funil do orçamento e "Visualizar Jobs" do financeiro
  conhecem `finalizado`.

## 5. A pendência da 034 está fechada

A 034 deixou em aberto dois jobs encerrados com saldo antes da trava:
JOB-0027 (R$ 30.073,32) e JOB-0009 (R$ 149,12). Em 16/09/2026:

- a auditoria mostra que eram testes do Tiago — o JOB-0009 antigo ("Teste
  Orçamento 2", encerrado em 14/08), o JOB-0027 ("Consome o Save", teste de
  errata, save e envio, encerrado em 31/08) e também o JOB-0023 ("C · Só save",
  faturamento zero, 27/08);
- os três foram apagados da tabela `jobs`, sem envio, parcela, nota, título ou
  PP restante, e os códigos foram reaproveitados (o JOB-0009 de hoje é outro
  job);
- e, com a regra 2, o job encerrado continua na fila — o risco que criou a
  pendência deixou de existir.

**Fechada como sem objeto** (Tiago, 16/09/2026).

## 6. Conferência (16/09/2026)

Pelas telas, no Chrome do Tiago, Projeto Teste:

- **JOB-0033 (normal):** trilha Faturamento "Faturado parcial · R$ 1,00 de
  R$ 113.897,60 em nota emitida"; "Ver envio" com 640 px, a descrição, a
  parcela e "NF TESTE-ESTEIRA · R$ 1,00 (14/09)"; trilha Encerramento "2
  pendências" com o botão desabilitado. Barra com 101 px de altura.
- **JOB-0034 (mensal):** meses com a situação, "1 de 3 meses enviados";
  formulário de novembro com 620 px, campo de 8 linhas e "0 de 2.000
  caracteres"; "1 pendência" (3 itens).
- **Encerramento real do JOB-0034** com novembro e dezembro por enviar: "Concluir
  PPs" marcou os 3 itens → "Liberado" → diálogo com o aviso dos meses e o
  "Totais do trimestre" travado em "Realizada" → enviado. No banco: `encerrado`,
  `encerrado_em` e `encerrado_por` gravados, `finalizado_em` nulo, auditoria
  `job.encerrado` com `finalizado: false`, e a parcela de outubro **continuou na
  fila**. Cabeçalho com o selo violeta; "Ver envio" com quem e quando.
- **Envio de novembro depois do encerramento:** aceito (vencimento 18/12/2026),
  fila com as duas parcelas, job ainda `encerrado`. No financeiro: selo
  "Encerrado" violeta, "Enviado" na situação, sem "Aguardando encerramento".
- **Trava no servidor:** `encerrarJob` chamado pelo console no JOB-0033 recusou
  por "1 BV não recebido e 6 itens de custo sem dizer se ainda sai PP" — sem
  citar os R$ 113.896,60 a faturar.

Por simulação no banco, numa transação desfeita (sem nota real):

- JOB-0033 encerrado com saldo → `encerrado`; nota parcial → `encerrado`; nota
  do saldo → **`finalizado`** com `finalizado_em`; nota cancelada depois →
  continua `finalizado`, e a parcela volta à fila.
- JOB-0033 faturado ainda aberto → `aberto` e fora da fila; ao encerrar →
  **`finalizado`** direto.
- Conferido depois: nenhuma nota simulada nem auditoria restante.

`tsc`, `next lint`, `next build` e os 81 testes limpos.

## 7. Pendências

- **Fluxo de confirmação do encerramento pelo financeiro** (regra 6) — a
  desenhar depois desta entrega.
- **Card "Jobs prontos pra encerrar" da home do GP:** ainda conta job aberto com
  envio registrado, critério anterior a esta decisão. O certo seria job aberto
  sem PP, BV, verba ou item pendente; o filtro `encerrar_pronto` da lista nunca
  foi implementado. Precisa de definição.
- **A auditoria `job.finalizado` gravada pelos gatilhos** só foi conferida no
  código: a simulação roda sem usuário, e nenhum job real ficou finalizado.
- **Janela entre migration e deploy:** as migrations valem para o app que está
  no ar, que não conhece `finalizado`. Nenhum job aberto está todo faturado
  hoje, então nenhum deveria virar finalizado antes do deploy.
- O centavo do JOB-0034 (meses R$ 50.105,64 × planilha R$ 50.105,63) é
  arredondamento anterior a esta decisão.
