# 155 — O save que vem com o job é aprovado na abertura

**Data:** 2026-10-07
**Status:** aceita e implementada (07/10/2026). Revista em 17/10/2026 (o save no cartão "Dados da produção") e em 19/10/2026 (o bloco no idioma das Previsões, quem consome o crédito e as planilhas em pop-up — ver a nota no fim de "O que mais mudou junto").
**Quem decidiu:** Tiago, em 07/10/2026, a partir de dois protótipos interativos.
- **Como era:** https://claude.ai/artifact/WQ24E5vp7Vemqmw9GzNi6J.
- **A proposta:** https://claude.ai/artifact/THxGXFBhLM1w8UyAFdmk9Y, versão 3, com o atalho da origem abrindo em pop-up.
- **Revisão de 19/10/2026:** "Planilhas do save" (https://claude.ai/artifact/Cn4T8TLKD3Vz9FQLVUfs6L) e "Save na Abertura" (https://claude.ai/artifact/AtKiRyEVgWMfAz7vAyorkG, opção B, aprovada).

**Revê:** a [099 §2](099-aprovacao-de-save.md), itens 2 e 6, para os saves que vêm com o envio do job.
**Migration:** `20261007950001_save_aprovado_na_abertura.sql`.

## O problema

Até aqui, o save marcado no orçamento seguia com o envio, mas o pedido de aprovação só nascia no "Sim, abrir job". Cada linha virava um pedido na faixa Saves da fila. Cada pedido se aprovava numa revisão da abertura própria, que gravava de novo as previsões e o registro.

O financeiro conferia os números na abertura, abria o job e depois fazia mais uma revisão por linha. Com o save do orçamento inteiro ([decisão 154](154-save-do-orcamento-inteiro.md)), um orçamento de 10 linhas virava 10 revisões.

## A regra

1. **A aprovação mora no formulário da abertura.** O bloco "Saves deste job" fica logo depois das Previsões e, desde 19/10/2026, fala o idioma delas:
   - blocos de resumo no topo: o save gerado, o consumo e o saldo do cliente antes → depois;
   - o selo do modo inteiro, quando há;
   - uma tabela só, com uma faixa por tipo e as linhas dele embaixo, recolhidas em 3 quando passam de 5, e a linha de Soma;
   - uma caixa por tipo presente, **na faixa do tipo**: **"Aprovar save gerado"** e **"Aprovar consumo de save"**.
2. **Sem as caixas presentes marcadas, "Abrir job no financeiro" não libera.** O rodapé diz o que falta: "Marque “Aprovar save gerado” para abrir o job.", "Marque “Aprovar consumo de save”…" ou "Marque a aprovação dos saves…". A Server Action confere o mesmo, antes de qualquer escrita, e recusa com a mesma mensagem.
3. **Abrir o job aprova os pedidos.** A confirmação diz "Os N saves deste job ficam aprovados.", mostra a linha "Saves aprovados com a abertura" e o botão "Sim, abrir job e aprovar os saves" (no singular com um save). Os pedidos nascem e são aprovados numa transação só:
   - situação `aprovado`;
   - momento `abertura`, ou `reenvio` para o job devolvido;
   - decididos por quem abriu.
   Nada vai para a faixa Saves, e não há revisão por save.
4. **Recusar um save antes de abrir é o "Reprovar job" de hoje.** O job volta para a produção, que corrige o save no job devolvido e reenvia (decisões 057 e 128). Não existe recusa de linha dentro da abertura.
5. **Saldo do cliente no bloco:** "antes" é o disponível do cliente somando os OUTROS jobs dele, já com o consumo deste job reservado; "depois" = antes + crédito. No exemplo do protótipo: R$ 8.000,00 → R$ 22.800,00 (escolha do Tiago). Para cada job de origem, na Soma do consumo: "Saldo do {código}: Y → sobram Z", com o saldo de antes deste consumo. No job aberto, só "Pago com o saldo do {código}" (19/10/2026): o saldo de antes não se reconstrói depois que outros jobs consomem da mesma origem.
6. **A planilha do job de origem abre em pop-up.** Um atalho "Visualizar planilha de origem do save ({código})", no mesmo visual do "Visualizar planilha interna", fica logo abaixo dele na coluna da direita. Ele abre a Planilha Interna do outro job em leitura. Desde 19/10/2026 ela só é lida quando o pop-up abre (`lerPlanilhaEmLeitura`), em vez de por streaming a cada visita. Só existe quando o job consome save.
7. **No job aberto, o bloco aparece em leitura** (desde 19/10/2026):
   - "Aprovados com a abertura · {data} · {nome}" no cabeçalho e, na faixa de cada tipo, o selo da situação dos pedidos ("Aprovado com a abertura", "Aguardando aprovação" ou "Recusado");
   - no job que gerou save, o bloco "Livre do crédito" (o `disponivel` da `vw_saves_por_job`, com o consumido e o reservado embaixo) e a faixa "Consumido por" com os jobs de consumo aprovado.
8. **A errata de save do job já aberto (`job_aberto`) não muda.** Ela segue para a faixa Saves e para a revisão da abertura.

## O que mais mudou junto

- **Envio do GP:** o formulário e a confirmação ganharam a linha "Consumo de save", com os jobs de origem. Antes só o save gerado aparecia, e o job pago inteiro por save chegava com "Faturamento previsto R$ 0,00" sem explicação. O texto do crédito passou a "Fica disponível para outros jobs quando o financeiro abrir o job.".
- **Conferência da fila:** "São aprovados junto com a abertura do job, no formulário de abertura. Se algum não deveria ser save, use Reprovar." Antes dizia "Não são aprovados aqui…".
- **Linha da fila:** marca "Orçamento inteiro em save", "Orçamento inteiro pago pelo saldo do {código}" ou "N linhas com save".
- **Pop-up de save da linha, no job ainda não aberto:** "O financeiro aprova junto com a abertura do job."

⚠️ **O save no cartão "Dados da produção" (2026-10-17).** O cartão da coluna da direita da abertura (e do job aberto) mostrava o faturamento previsto e o valor total, mas não o save — que o envio da produção mostra logo abaixo do valor total. Agora, separadas por um traço, entram as mesmas duas linhas do envio, cada uma só quando passa de zero: **"Total gerado em save"** (o orçado das linhas vivas em save, `totalGeradoEmSave` em `dados.ts` — o mesmo `totais.save.totalSaveGerado` do envio, sobre a cópia do job) e **"Consumo de save"** (a soma de `save_consumido`, o `saveConsumido` que o formulário já recebia). Grafite do SAVE (`blocos.ts`), a cor do envio. Pedido do Tiago, 17/10/2026.

⚠️ **Conferir e aprovar o save no idioma das Previsões (2026-10-19).** O Tiago não gostou da tabela do bloco e aprovou a opção B do protótipo "Save na Abertura", com as escolhas que ele tinha feito no "Planilhas do save":
- **O bloco:** blocos de resumo no topo, como os quatro das Previsões; uma tabela só, com uma faixa por tipo, onde fica a caixa de aprovação (o lugar de "Parcelas fecham com o faturamento"), e a linha de Soma de cada tipo. Saíram as colunas Tipo, Save, Faturamento da linha e Situação: a linha que gera mostra "na nota R$ X" ao lado, a que consome mostra de onde vem o saldo. As linhas têm a textura do save da planilha (`SAVE.hachura` e `SAVE.linhaConsome`).
- **Quem consome o crédito:** no job aberto que gerou save, a faixa "Consumido por" lista os jobs que já consumiram — consumo aprovado (`saves_aprovacoes`, tipo `consome`, situação `aprovado`, com este job nas origens), com a data de abertura e o valor. Só os consumidos; o reservado entra no número do bloco "Livre do crédito", que é o `disponivel` da view.
- **As planilhas em pop-up:** o ícone na ponta de cada linha abre a planilha do outro job — a de origem, ou a de quem consome. O "Visualizar planilha interna" também abre num pop-up, em vez de trocar de aba (decisão 111) ou navegar até ela; na aprovação de um save, a linha do pedido vem em destaque. Os pop-ups abrem com o Resultado dos Totais em "Planejada" (`resultadoInicial`, até o `PainelResultado`). No job mensal, abrem no **Trimestre**, com os meses empilhados e os "Totais do trimestre"; na Mídia Off, na **Campanha**. A régua e o "Abrir {mês}" trocam o mês dentro do próprio pop-up (`mesNoLugar`), sem navegar: um link de mês sairia da abertura e levaria o que já foi preenchido. A primeira versão (0dc567ab) mostrava a planilha corrida, sem régua; o Tiago perguntou se era a visão do trimestre e não era — corrigido no mesmo dia.
- **Atalhos só com o título:** "Visualizar planilha interna" perdeu o resumo embaixo, e o da origem passou a "Visualizar planilha de origem do save ({código})".
- **Leitura sob demanda:** a planilha de cada pop-up só é lida quando ele abre (`lerPlanilhaEmLeitura`, mesma trava da página: administrador ou financeiro). Com a lista de quem consome, carregar as planilhas junto com a página seria uma planilha inteira por consumidor a cada visita.

## Onde mora

- **Banco:** `save_aprovar_na_abertura(job, momento, números)`, com SECURITY DEFINER e execução só para `authenticated`. Ela chama `save_enviar_pendentes` (papel, status e uma linha por pedido) e depois `decidir_pedido_save(…, 'aprovar', null, null, 'manter', null)` para cada pedido. Com totais nulos e revisão `manter`, os números do job e a revisão da abertura não mudam: o financeiro já os contava desde o envio.
- **Se a aprovação falhar,** nada fica gravado. A action cai no caminho de antes (`save_enviar_pendentes`): os pedidos vão para a faixa Saves, e a mensagem manda aprová-los por lá.
- **Server Action:** `abrirJobNoFinanceiro(jobId, payload, { gera, consumo })`. A auditoria `save.pedido.aprovado` leva `{ na: "abertura", momento, quantidade }`.
- **Telas:**
  - os dados do bloco vêm de `abertura-de-job/saves-da-abertura.ts`;
  - os pop-ups de planilha (a do próprio job, a de origem e a de quem consome) são `abertura-de-job/[jobId]/planilha-em-leitura.tsx`, com a leitura em `abertura-de-job/planilha-em-leitura-actions.ts` (até 19/10/2026, `planilha-da-origem.tsx`, removido);
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

## Testado de ponta a ponta (19/10/2026, dev do worktree, administrador)

Pelo fluxo real da tela, no TES-P001/26, orçamento "ZZ Teste 155 save na abertura":

- **Orçamento:** Brindes (R$ 5.000,00) marcada para gerar save; Transporte (R$ 3.000,00) consumindo R$ 2.000,00 do TES-1001/26. A versão foi aprovada e o envio criou o **TES-1030/26**, com "Empresa: Empresa Teste" abaixo do Projeto e "Total gerado em save" e "Consumo de save" no resumo.
- **Reservado:** com o TES-1030/26 aguardando abertura, o TES-1001/26 mostrou "Livre do crédito R$ 6.000,00 · R$ 2.000,00 consumidos por 2 jobs · R$ 2.000,00 reservados".
- **Abertura:**
  - o bloco mostrou save gerado R$ 5.000,00, consumo R$ 2.000,00 e saldo do cliente R$ 58.500,00 → R$ 63.500,00;
  - os dois pop-ups (planilha interna e TES-1001/26) abriram em leitura, com "Planejada" nos Totais; o BV do TES-1001/26 abriu só em consulta;
  - a trava andou caixa por caixa: "Marque a aprovação dos saves…", depois "Marque “Aprovar consumo de save”…", e liberou com as duas;
  - a confirmação listou "2 · crédito R$ 5.000,00 · consumo R$ 2.000,00 do TES-1001/26".
- **Banco:** TES-1030/26 `aberto`; dois pedidos `aprovado` com momento `abertura` (o de consumo com o TES-1001/26 nas origens); auditoria `save.pedido.aprovado` com `{ na: "abertura", quantidade: 2 }`, antes de `job.aberto_no_financeiro`.
- **Depois:**
  - o TES-1030/26 mostrou "Aprovado com a abertura" nas duas faixas e "Livre do crédito R$ 5.000,00";
  - o TES-1001/26 passou a "R$ 4.000,00 consumidos por 3 jobs", sem reservado, com o TES-1030/26 em "Consumido por" (aberto em 19/10/2026), e o pop-up dele abriu daquela linha.
- **Mensal e Mídia Off:** no TES-1002/26 (Always On), o pop-up abriu no Trimestre, com os três meses e os "Totais do trimestre", e trocou de mês dentro dele; no TES-1026/26 (Mídia Off), abriu na Campanha.
