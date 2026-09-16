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

### Segunda conferência, geral (16/09/2026, antes do push)

- **Pop-up de encerramento no internacional com save** (JOB-0009, por rota
  temporária já apagada, sem enviar nada): pendências em vermelho (PP-00060, o
  BV da hospedagem, 3 itens), "Falta faturar" com o job ainda não enviado,
  colunas Save usado · Save gerado · Custos do job abertas, cadeia
  internacional em USD e BRL, "Save gerado USD 1.960,78 · R$ 10.000,00" no fim,
  Resultado travado em "Realizada" e o botão desabilitado.
- **Modo "ver" num job finalizado** (JOB-0033 com o estado simulado na mesma
  rota): sem caixa de pendência nem de faturamento, só "Fechar", rodapé
  "Finalizado em 16/09/2026: faturado e encerrado."; a trilha de Encerramento
  mostra "Encerrado · por quem e quando" ao lado da trilha de Faturamento.
- **"Ver envio" do encerramento no JOB-0034 real:** "Totais do trimestre",
  rodapé "O faturamento deste job ainda está em andamento na fila do
  financeiro."
- **Lista de jobs:** selo "Encerrado" violeta no JOB-0034 e "Finalizado" no
  filtro de status. **Visualizar Jobs do financeiro:** selo violeta.
- **Fluxo de caixa do job (financeiro) no JOB-0034 encerrado:** entradas
  previstas de R$ 16.701,88 em 11/2026, 12/2026 e 01/2027 — a
  `vw_fluxo_caixa` enxerga o encerrado.
- **Auditoria `job.finalizado` com usuário**, por simulação desfeita com
  `request.jwt.claims` do Tiago: a nota do saldo grava
  `{"momento": "emissao_da_nota", "faturamento_id": …}` e o encerramento de um
  job já faturado grava `{"momento": "encerramento"}`, os dois com o
  `actor_user_id`. Conferido depois: nenhuma nota nem auditoria restante.
- **Banco, pelas definições:** a fila e as quatro previsões de recebimento do
  fluxo aceitam `encerrado` e `finalizado`; o cronograma de desembolsos segue
  só `aberto`/`em_producao`; nenhuma outra view, função ou policy filtra status
  de job. Migrations registradas no Supabase como `job_status_finalizado`,
  `encerramento_e_finalizado` e `encerrado_na_fila_e_no_fluxo`.
- **Corrigido nesta conferência:** os cards "Jobs com faturamento próximo" da
  home (administrador e GP) contavam `aberto`/`em_producao`, mas a lista que
  eles abrem passou a mostrar `aberto`/`encerrado`. A contagem agora inclui o
  `encerrado` (`lib/home/carregar.ts`). Nenhum job vence nos próximos 7 dias
  hoje, então o número na tela não mudou.
- `tsc`, `next lint` (só o aviso antigo do `multi-select`), `next build` e os
  81 testes limpos de novo.

~~**Não conferido na tela:** o pop-up num job **nacional** com save — não há job
aberto assim no Projeto Teste (o JOB-0007 está aguardando abertura). O card é o
mesmo componente que já abre as colunas de save no internacional.~~ Conferido
no teste real abaixo.

### Teste real de ponta a ponta (16/09/2026, depois do push)

Tudo pelas telas, no Chrome do Tiago: Projeto Teste, Empresa Teste, Conta
Teste e o fornecedor "Teste Alterações Fornecedor 048", reativado pelo
cadastro para isso.

**JOB-0007 (nacional com save) — faturado antes, finalizado no encerramento:**

1. Aberto pelo financeiro (projeto financeiro "Teste · PEVETE-0003/26").
2. **PP normal** PP-00067 (Item 1, R$ 1.500,00, NF anexada) e **PP de verba**
   PP-00068 (Item 2, R$ 800,00), as duas geradas e enviadas de uma vez,
   aprovadas com pagamento em 16/09 e baixadas na Conta Teste por PIX.
3. **Prestação da verba** pela produção: NF de R$ 500,00; aprovada pelo
   financeiro; estorno de R$ 300,00 baixado na Conta Teste. O realizado do
   item caiu de R$ 800,00 para R$ 500,00.
4. **Dois BVs** (Item 5, R$ 3.000,00; Item6, R$ 2.000,00) com o fornecedor de
   teste e alíquota de 10%, confirmados, com nota emitida para o fornecedor e
   recebidos — os dois passaram a `recebido`.
5. Itens marcados, **envio para faturamento** de R$ 252.653,78 (R$ 190.021,74
   próprio + R$ 62.632,04 de save, com os dois itens na mesma parcela), nota
   emitida e título recebido. O job continuou `aberto`.
6. **Pop-up de encerramento** liberado: colunas de save abertas, "Save gerado
   R$ 45.000,00" no fim, Resultado travado em Realizada, sem caixa de
   pendência nem de falta de faturamento.
7. Enviado para encerramento → **`finalizado` direto**, com `encerrado_em`,
   `encerrado_por`, `finalizado_em` e a auditoria `job.finalizado`
   `{"momento": "encerramento"}` por Tiago Mendonça. Selo verde no cabeçalho;
   trilhas "Faturado" e "Encerrado".

**JOB-0034 (mensal, já encerrado) — finalizado na última nota:**

1. Dezembro enviado depois do encerramento (vencimento 18/01/2027).
2. Notas de outubro e de novembro emitidas: o job seguiu `encerrado`.
3. Nota de dezembro → **`finalizado`**, com a auditoria `job.finalizado`
   `{"momento": "emissao_da_nota", "faturamento_id": …}`. A fila ficou sem o
   job. Os três títulos foram recebidos na Conta Teste.

**Conciliação da Conta Teste (16/09/2026):** saldo anterior R$ 93.050,00,
créditos R$ 308.059,42, débitos R$ 2.300,00, saldo final R$ 398.809,42. As nove
linhas trazem o job, o centro de custo e a Empresa Teste — inclusive o
recebimento das notas, que chega ao job pelos itens da nota.

**Fluxo de caixa:** os nove movimentos aparecem no geral da Empresa Teste. No
fluxo do JOB-0007 as entradas são R$ 195.321,74: a parte própria da nota, os
dois BVs e o estorno da verba. Os R$ 62.632,04 do save entram numa linha à
parte, "saldo em save", sem job — é o desenho da decisão 028, que leva esse
dinheiro ao job que consumir o crédito. Nenhuma previsão ficou pendurada nos
dois jobs finalizados.

**Corrigido no caminho (mesmo commit desta seção):**

- **A alíquota do BV não voltava nos diálogos** (decisão 062). As consultas
  do job, do orçamento e da planilha da abertura não traziam
  `percentual_imposto`: o campo reabria vazio, o "Confirmar" pedia a alíquota
  de novo, e salvar o BV sem redigitar gravava a alíquota como nula.
- **A 1ª parcela do envio para faturamento não mostrava a data escolhida**
  (decisão 078). Mudar a "Data de faturamento" levava a data para a parcela
  no estado, mas o campo da parcela seguia vazio (mensal) ou com a data
  antiga (job normal). O envio saía com a data certa; a tela mostrava outra.

## 7. Pendências

- **Fluxo de confirmação do encerramento pelo financeiro** (regra 6) — a
  desenhar depois desta entrega.
- **Card "Jobs prontos pra encerrar" da home do GP:** ainda conta job aberto com
  envio registrado, critério anterior a esta decisão. O certo seria job aberto
  sem PP, BV, verba ou item pendente; o filtro `encerrar_pronto` da lista nunca
  foi implementado. Precisa de definição.
- ~~**Janela entre migration e deploy:** as migrations valem para o app que está
  no ar, que não conhece `finalizado`. Nenhum job aberto está todo faturado
  hoje, então nenhum deveria virar finalizado antes do deploy.~~ Fechada: o
  deploy do `74d4a9a` terminou na Vercel em 16/09/2026.
- ~~**O "Concluir PPs" em lote fura a trava do A · Repasse** (decisão 062).
  `concluirPPsDoJob` marca os itens com um UPDATE só e não passa por
  `aplicarConclusaoDoItem`, onde a trava mora — ao contrário do que diz o
  comentário dela. No teste, o Item6 do JOB-0007 (AR, orçado R$ 15.000,00)
  ficou concluído sem PP nenhuma, e o job encerrou. Falta o Tiago decidir se
  o lote pula esses itens (e diz quais) ou recusa tudo.~~ **Resolvido em
  16/09/2026 — o lote pula e avisa** (opção do Tiago). Ver 062 §6. O Item6 do
  JOB-0007 segue concluído sem PP: o job está finalizado e não se reabre pela
  tela.
- **"Editar registro" num job encerrado ou finalizado:** a aba Abertura do Job
  no financeiro oferece o botão, mas o servidor recusa ("Só job aberto tem
  registro de abertura para editar"). Já era assim com o encerrado antes da
  087.
- O centavo do JOB-0034 (meses R$ 50.105,64 × planilha R$ 50.105,63) é
  arredondamento anterior a esta decisão.
- **Selo "Enviado" do mensal no Visualizar Jobs:** o JOB-0034, com 2 de 3 meses
  enviados, aparece como "Enviado · R$ 33.403,76". É a esteira da decisão 078,
  anterior a esta, e não foi mexida; fica a pergunta se o mês por enviar
  deveria aparecer ali.
