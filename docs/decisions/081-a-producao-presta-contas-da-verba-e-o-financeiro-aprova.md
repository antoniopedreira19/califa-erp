# 081 — A produção presta contas da verba, e o financeiro aprova

**Data:** 2026-09-15
**Status:** aceita
**Contexto:** PP de verba de produção depois de paga — aba de PPs do job,
aprovação e Títulos a Pagar em Contas a Pagar, chat de PPs. Pedido do Tiago
em 14/09/2026; design "Prestação de Contas da Verba" aprovado em duas rodadas
de respostas (0a · 1b · 2a · 3a · 4a · 5a · 6a · 7a · 8a · 9a · 10a e depois
1a · 2a · 3b · 4a · 5a · 6a · 7a), e a 8a da gravação do estorno. A verba
nasceu na frente do Antonio (26/08/2026); a mudança foi alinhada com ele.

## Como era

- Quem prestava contas era o **financeiro**, na tela da PP em Contas a
  Pagar: digitava o valor gasto e anexava notas soltas.
- A prestação nascia **fechada e imutável**, e a devolução do saldo nascia
  no mesmo instante, com a data do dia — sem ninguém conferir.
- Nada avisava que uma verba paga estava sem prestação, e nada travava.

## A regra

### 1. Quem presta contas e onde

- A **produção**, na **aba de PPs do job** — e só lá (1b). A planilha
  interna e a ficha da PP mostram a situação em leitura, com "Preste contas
  na aba de PPs" (5a).
- Pode prestar: o **responsável pela verba**, o **responsável do job** ou um
  **administrador** (6a). A função do banco checa.
- Só depois que a verba está **paga** (todas as parcelas).

### 2. O que se envia

- **Uma prestação por verba**, com quantos documentos forem precisos (7a).
- Cada documento é **NF ou recibo** (3b) e leva o **valor que comprova**
  (4a). O gasto é a **soma**; não se digita à parte.
- O gasto **nunca passa da verba** (5a). O excedente precisa de uma PP nova,
  que passa pela aprovação normal.
- Enviada, a prestação **não se retira**; só se corrige depois de reprovada
  (7a).

### 3. A conferência no financeiro (2a)

- A prestação chega na aba **Pedidos de Produção**, filtro **Prestações**, e
  abre na tela cheia da PP: pedido de um lado, **documentos da prestação**
  no meio (numerados), dossiê à direita com cada documento e valor.
- **Reprovar** pede motivo (mín. 10 caracteres) e devolve à produção, que
  abre a correção com os documentos e valores enviados.
- **Aprovar** guarda os documentos e valores conferidos
  (`documentos_na_aprovacao`, como a decisão 070 faz com a PP) e, havendo
  saldo, cria o **estorno de verba** com a **data prevista** escolhida no
  pop-up (2a da segunda rodada). Sem saldo, a verba vai direto para
  concluída.
- O **realizado do item** passa a descontar o saldo **na aprovação** — antes
  descontava no fechamento, antes de alguém conferir.

### 4. O estorno do saldo (3a, 6a, 8a)

- Chama-se **Estorno de verba** e fica em **Títulos a Pagar**.
- Nas telas é **despesa negativa**: aparece como −R$, abate "Em aberto" e as
  outras somas, e já nasce no **centro de custo da PP**.
- No banco continua **valor positivo** e, na baixa, **entrada** (8a): é o
  dinheiro voltando, como o extrato mostra, e a conciliação segue batendo.
  Afrouxar a regra de valor positivo dos lançamentos foi recusado.

### 5. A situação da verba (9a)

Uma camada por cima do status "pago" da PP — o status da PP **não muda**, e
quem lê "pago" (fluxo de caixa, encerramento) continua lendo:

> **Aguardando prestação → Prestação em avaliação → (Prestação reprovada ↺)
> → Devolução pendente → Concluída**

- **Títulos a Pagar:** o título pago da verba mostra a situação, e o filtro
  **Aguardando prestação** junta as sem prestação e as reprovadas (4a da
  segunda rodada).
- **Aba de PPs do job:** o mesmo filtro, o chip na linha e o botão **Prestar
  contas** / **Corrigir prestação** na trilha.
- **Chat de PPs:** cartões recolhidos de prestação enviada, reprovada e
  aprovada.

### 6. Devolução total, sem documento (15/09/2026)

Pedido do Tiago no mesmo dia: a verba que não teve gasto nenhum também se
presta, e volta inteira.

- Na gaveta de prestar contas, **"Não houve gasto — a verba volta inteira"**
  esconde os documentos e envia a prestação **sem documento**, com gasto
  R$ 0,00.
- O caminho no financeiro é o mesmo: conferir, reprovar com motivo ou aprovar
  com a data prevista. Aprovada, o **estorno de verba é a verba inteira**.
- Reprovada, a correção abre de novo com "não houve gasto" marcado — a
  produção pode manter ou trocar por documentos.
- O banco não aceita as duas coisas misturadas: "sem gasto" com documento é
  recusado, e prestação sem documento só vai com "sem gasto" marcado.

### 7. A trava no encerramento do job (10a, 15/09/2026)

- O job **não encerra** enquanto houver verba paga que não fechou:
  prestação por enviar, em avaliação ou reprovada, ou estorno do saldo por
  baixar. Só a verba **Concluída** libera — prestação aprovada e, quando
  sobrou saldo, o estorno baixado (o dinheiro de volta na conta).
- A verba ainda sem baixa não muda: ela já travava como PP sem baixa
  (decisão [008](008-encerramento-do-job.md)).
- O resumo de fechamento lista cada verba com a situação dela, na mesma
  caixa das PPs, BVs e saldo a faturar, e diz o caminho: a produção presta
  contas na aba de PPs, o financeiro aprova e dá baixa no estorno.
- O servidor refaz a conta em `encerrarJob`; se a leitura das verbas falhar,
  o job não encerra.
- Sem mudança de banco: a situação é a mesma `situacaoDaVerba` das telas.

**Conferido em 15/09/2026** (JOB-0029 · PP-00062, verba de R$ 100,00, baixas
na Conta Teste): antes da verba nova, com PP-00058 e PP-00061 concluídas,
nenhuma linha de verba no resumo. Paga a PP-00062, o resumo e o
`encerrarJob` chamado pelo console listaram "PP-00062 (aguardando
prestação)"; com a prestação enviada, "(prestação em avaliação)"; aprovada,
"(devolução pendente)"; baixado o estorno, a linha sumiu da tela e da
mensagem do servidor. O caso em que **só** a verba trava não foi exercitado:
o JOB-0029 tem outras pendências (PPs, BV, nota e marcação dos itens).

## Banco

- `20260915150001_verba_prestacao_com_aprovacao.sql` — `status`, autoria da
  reprovação e da aprovação, `documentos_na_aprovacao`; `valor` e tipo
  obrigatório (NF/recibo) no documento; as policies de INSERT direto saem.
  Supunha as tabelas vazias — conferido: nenhuma prestação, documento ou
  devolução existia.
- `20260915150002_verba_prestacao_rpcs.sql` — `enviar_prestacao_verba`,
  `aprovar_prestacao_verba`, `reprovar_prestacao_verba`; **remove**
  `fechar_prestacao_verba_pp`; o realizado desconta só prestação aprovada;
  rótulos "Estorno de verba" na baixa e no estorno da baixa.
- `20260915150003_estorno_de_verba_nas_views.sql` — o mesmo rótulo em
  `vw_a_pagar` e `vw_fluxo_caixa`, trocado sobre a definição que estava no
  banco (colunas, natureza e GRANTs iguais).
- `20260915170001_verba_devolucao_total_sem_documento.sql` — o gasto da
  prestação aceita zero, e `enviar_prestacao_verba` ganha `p_sem_gasto`
  (a assinatura antiga sai; a Server Action é a única chamada).
- `fechada_em` / `fechada_por` ficaram com o nome e passaram a significar
  "enviada (a última vez)".

## Conferido em 15/09/2026 (Projeto Teste · JOB-0029 · PP-00058)

Tudo pelos fluxos da tela, com a Conta Teste nas baixas:

- **Baixa da verba** (R$ 1.000,00): o título passou a "Aguardando prestação"
  em Títulos a Pagar (filtro com contagem) e na aba de PPs do job.
- **Envio pela produção:** com NF de R$ 700,00 e recibo de R$ 400,00 a gaveta
  travou ("O gasto passa da verba em R$ 100,00", botão desabilitado);
  corrigido para R$ 200,00, a prestação saiu. No banco: em avaliação, dois
  documentos com tipo, valor e caminho certos, realizado do item ainda sem
  desconto, auditoria do envio.
- **Conferência:** filtro "Prestações" com Enviada em, Verba, Gasto e Saldo;
  tela cheia com os documentos numerados, o dossiê com cada valor e o rodapé
  de reprovar e aprovar. Reprovar só liberou com 10 caracteres.
- **Correção:** a PP voltou ao filtro como "Prestação reprovada", com
  "Corrigir prestação"; a gaveta abriu com o motivo e os documentos
  preenchidos. Trocado o recibo por outro de R$ 250,00 e reenviada — a NF
  manteve o mesmo registro, e o recibo antigo saiu do banco e do Storage.
- **Aprovação:** o pop-up mostrou gasto, estorno de −R$ 50,00, data prevista e
  centro de custo. Criou o estorno para 22/09, guardou os documentos
  conferidos, baixou o realizado do item de R$ 5.500,00 para R$ 5.450,00 e pôs
  "Estorno de verba" como entrada prevista no fluxo de caixa. Em Títulos a
  Pagar: −R$ 50,00, "Devolução pendente", e o "Em aberto" abatido.
- **Baixa do estorno:** o centro de custo da PP veio preenchido; o lançamento
  entrou como entrada de R$ 50,00 em Custo Operacional. A verba ficou
  "Concluída" em Títulos a Pagar, na aba de PPs, no painel da planilha e na
  ficha da PP, e o dossiê mostra "Devolvido em 15/09/2026".
- **Servidor por fora da tela** (transação desfeita): GP Teste e Freelancer
  Teste foram recusados ao enviar e ao aprovar; o responsável pela verba
  (Financeiro Teste) passou pela permissão. Soma acima da verba, boleto, valor
  zero, prestação sem documento, reprovar uma reprovada e aprovar uma
  reprovada — todos recusados com a mensagem certa.
- **Chat de PPs:** os cartões da prestação aparecem no fio, recolhidos com
  código e valor.
- **Ajuste que o teste pediu:** "Aguardando prestação" e "Devolução pendente"
  invadiam a coluna Ação em tela estreita; os dois chips quebram linha agora.

**Não conferido:** verba parcelada (a prestação só abre com todas as parcelas
pagas — regra que veio de 26/08 e não mudou) e as permissões pela tela com um
usuário que não é administrador (só pelo banco, simulando o login).

## Conferido em 15/09/2026 — devolução total (Projeto Teste · JOB-0029 · PP-00061)

Verba de R$ 300,00 gerada, aprovada e baixada na Conta Teste pelas telas:

- **Gaveta:** enviar sem documento e sem marcar foi recusado ("Anexe ao menos
  um documento — NF ou recibo."). Marcado "Não houve gasto", os documentos
  somem e o envio sai: "Devolução total de PP-00061 enviada ao financeiro.".
  No banco: em avaliação, gasto R$ 0,00, R$ 300,00 a devolver, nenhum
  documento, auditoria com `sem_gasto`. A PP deixou o filtro "Aguardando
  prestação" e perdeu o botão.
- **Financeiro:** o filtro "Prestações" mostrou Gasto R$ 0,00 e Saldo
  R$ 300,00; a tela cheia, "Sem gasto" no meio e no dossiê. O pop-up disse
  "sem gasto: a verba volta inteira" e estorno de −R$ 300,00.
- **Aprovação** com data prevista 22/09: estorno de R$ 300,00 criado,
  documentos conferidos gravados como lista vazia, e o realizado do item
  caiu de R$ 5.750,00 para R$ 5.450,00.
- **Baixa do estorno** na Conta Teste: entrada de R$ 300,00. A verba ficou
  "Concluída" em Títulos a Pagar e na aba de PPs; o estorno, "Devolvido".
- **Servidor por fora da tela** (transação desfeita): "sem gasto" com
  documento e lista vazia sem marcar foram recusados com a mensagem certa.
- **Ajuste que o teste pediu:** o aviso de erro continuava na gaveta depois
  de marcar "não houve gasto"; agora some na troca.

## O que ficou de fora

- **Prazo para prestar contas** (8a).
