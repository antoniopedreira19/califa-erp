# 159 — O produtor deixa a errata pronta para envio, e o GP a envia ao financeiro

**Data:** 2026-10-08
**Status:** implementada e testada pela tela em 08/10/2026 (migration
`20261008600001`).
**Quem decidiu:** Tiago, em 08/10/2026, a partir do protótipo interativo
(https://claude.ai/artifact/FzgtNYAGhSUXcqNK4kecKC, v1). As quatro
perguntas com recomendação seguiram a recomendação; a quinta (avisar o GP
fora da página do job) ficou para a fase de notificações.
**Revê:** quem registra errata — o `jobs.criar_errata` incluía o produtor
desde o começo, mas a tela nunca lhe mostrou o botão.

## A ideia em uma frase

Quando quem faz a errata é o **produtor**, ela tem duas etapas: ele corrige
a planilha e deixa a errata **pronta para envio**, com a descrição
opcional; um **GP** (ou o administrador) abre a mesma errata, pode mexer na
planilha e corrigir ou escrever a descrição — obrigatória para ele — e a
envia ao financeiro.

## Como era antes

- O produtor não via "Realizar errata": a tela só o mostrava a quem podia
  mexer no job, administrador e GP (`quemPodeMexer`).
- O servidor e o banco deixavam passar: `jobs.criar_errata` tinha o
  produtor, e nem a action nem `registrar_errata_do_job` olhavam o papel.
  Uma chamada direta registrava a errata.
- O rascunho da errata só existia na memória da tela. Confirmar registrava
  a errata, mudava o faturamento previsto e devolvia o job ao mural de
  abertura de uma vez.

## O que mudou

| | Produtor | GP e administrador |
|---|---|---|
| Botão na Planilha Interna | "Realizar errata" (novo para ele) | "Realizar errata", como antes |
| Botão da barra da errata | **Deixar pronta para envio** | **Confirmar errata**, como antes |
| Descrição no pop-up | **opcional** | obrigatória (5 caracteres ou mais) |
| O que acontece ao confirmar | a errata fica salva no job; **nada muda** no orçado, no faturamento previsto nem no mural do financeiro | a errata é registrada e vai ao financeiro |
| Com errata pronta no job | faixa "Errata pronta para envio" com **Editar errata** e **Descartar**; o botão vira "Editar errata pronta" | a mesma faixa com **Revisar e enviar** e **Descartar**; o botão vira "Revisar errata pronta" |

### As respostas do Tiago (08/10/2026)

1. **Uma errata pronta por job.** Enquanto ela existe, "Realizar errata"
   abre ela — o produtor continua dela, e o GP a revisa. O banco garante
   pelo índice único parcial, e `registrar_errata_do_job` recusa errata
   nova enquanto houver pronta parada.
2. **O GP pode mexer na planilha da errata pronta antes de enviar**, além
   da descrição. O envio grava o que o GP confirmou.
3. **Qualquer produtor, GP ou administrador edita ou descarta a pronta**,
   como já é com a PP (decisão 136). Quem grava a pronta por último passa a
   ser quem a preparou. Descartar pede confirmação e fica no histórico (a
   linha vira `descartada`; nada é apagado).
4. **O envio para faturamento fica travado com errata pronta parada**:
   "Este job tem uma errata pronta para envio. Envie-a ao financeiro ou
   descarte-a na Planilha Interna antes de enviar para faturamento." A
   barra mostra o motivo, e a action `enviarJobParaFaturamento` confere de
   novo.
5. **Aviso ao GP fora da página do job** — fica para a fase de
   notificações. Por enquanto o GP vê a faixa na Planilha Interna e a linha
   "Pronta para envio" no card de Erratas (aba Informações do Job).

## Detalhes

- **A faixa** fica no topo da Planilha Interna, acima da barra de
  ferramentas: quem preparou, quando, o resumo ("1 linha alterada · 1
  linha nova"), a descrição (ou "Sem descrição: o GP escreve no envio.") e
  o valor do job antes e depois, na conta do momento em que foi deixada
  pronta. Some enquanto a errata está aberta — quem fala no rodapé é a
  barra dela.
- **A barra da errata aberta a partir da pronta** diz "Errata pronta em
  edição" (produtor) ou "Errata pronta para envio" (GP), com "Preparada
  por … em …". O "Descartar" da barra vira **Fechar**: sai sem guardar o
  que mudou agora, e a pronta continua como estava. Descartar a pronta é
  pela faixa.
- **No pop-up do GP** o campo já vem com a descrição do produtor, com
  "Escrita por … Você pode corrigir antes de confirmar."; sem descrição,
  "… deixou a errata sem descrição. Escreva antes de confirmar."
- **As travas da errata valem para a pronta**: job aberto, mês já enviado
  para faturamento, linha com PP no financeiro, save, A · Repasse
  concluído, BV confirmado na troca de tipo. O produtor fica sabendo na
  hora que uma linha não entra. No envio tudo é conferido de novo, com o
  job de então (`montarErrata`, que as duas actions usam).
- **O card de Erratas** mostra a pronta no topo, com o selo "Pronta para
  envio" e "Aguardando o envio por um GP", e, na errata enviada a partir
  dela, "· preparada por …" ao lado do autor (quem enviou).
- **O financeiro não vê a pronta** — ela não foi enviada. A errata que ele
  recebe é a do GP, com o GP como autor, como antes.
- **Freelancer** continua sem errata.

## Banco

`20261008600001_errata_pronta_para_envio.sql`:

- `jobs_erratas_prontas` — a pronta: `conteudo` (o formato que vai à
  action), `descricao` opcional, `resumo`, o par antes/depois de custo,
  valor do job e faturamento previsto, `preparada_por/em`, e o destino:
  `situacao` `pronta` → `enviada` (com `errata_id`, `enviada_por/em`) ou
  `descartada` (com `descartada_por/em`). RLS para administrador, GP e
  produtor; `GRANT select, insert, update` para `authenticated`, nada para
  `anon`, sem DELETE. Gatilho `errata_pronta_guarda`: depois de sair de
  `pronta` a linha não muda mais, e só GP ou administrador a dá por
  enviada.
- `jobs_erratas.preparada_por` — quem preparou a errata que o GP enviou.
- `registrar_errata_do_job` — confere o papel (só GP e administrador),
  consome a pronta na mesma transação (`errata_pronta_id`) e recusa errata
  nova com pronta parada.

## Permissões

- `jobs.criar_errata` — **administrador e GP** (o produtor saiu).
- `jobs.preparar_errata` — administrador, GP e produtor (novo).

A matriz em Administração › Permissões mostra as duas linhas: "Enviar
errata ao financeiro" e "Deixar errata pronta para envio".

## Teste (08/10/2026, TES-1014/26)

Pela tela, com o **Produtor Teste Claude** (`claude.produtor.teste`) e o
administrador, no servidor do worktree:

- produtor: "Realizar errata", linha nova "Frete teste 159" de R$ 100,
  "Deixar pronta para envio" sem descrição — faixa no topo, job intacto no
  banco (R$ 9.464,40, 3 linhas, nenhuma errata), envio para faturamento
  travado com o texto da resposta 4;
- produtor: "Editar errata", R$ 120 e descrição — a pronta atualizada;
- administrador: "Revisar e enviar", a mesma linha na planilha, o campo da
  descrição vindo com o texto do produtor (vazio, o botão trava),
  "Confirmar errata" — a pronta como `enviada`, a errata com o autor e
  "preparada por Produtor Teste Claude", o job em R$ 9.631,42 e no mural;
- outra pronta descartada pela faixa (`descartada`, job intacto);
- recusas: o produtor registrando errata pela action ("Você não tem
  permissão") e no banco; a segunda pronta no mesmo job; errata do GP por
  cima da pronta; a pronta com linha que tem PP no financeiro; mexer numa
  pronta já enviada (gatilho).

Fechado com a revisão da abertura (foto nº 2 do job, recebimento e
impostos nas mesmas datas). **Ficou no TES-1014/26:** a linha "Frete teste
159" de R$ 120 em LOGÍSTICA (valor do job R$ 9.631,42), a errata e as duas
prontas (uma enviada, uma descartada).

## Fora desta decisão

- Aviso ao GP fora da página do job (lista de Jobs, Home, notificação).
- O GP deixar a errata pronta para outro GP enviar.
- Mostrar "preparada por" nas telas do financeiro.
