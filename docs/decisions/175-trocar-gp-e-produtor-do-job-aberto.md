# 175 — Trocar o GP e o Produtor Responsáveis do job aberto pela Equipe, e o GP de fora do projeto entrando sozinho nos GPs do projeto

**Data:** 2026-10-15
**Status:** aceita e implementada (15/10/2026).
**Quem decidiu:** Tiago, em 14 e 15/10/2026, sobre o protótipo "Trocar os
responsáveis" (opções 1A e 2A).
**Completa:** a [174](174-equipe-do-job-e-envio-de-pp-pelo-produtor.md) — o
job não se edita depois da abertura, mas os responsáveis se trocam pela
Equipe.
**Revisa:** a regra 3 da [170](170-gp-so-quem-pode-ser-gp.md) — o GP do
orçamento não precisa mais ser GP Responsável do projeto.
**Migration:** `20261015300001_trocar_responsaveis_do_job.sql` — uma
tabela, três funções e um gatilho, aditiva.

## O pedido

> Precisamos criar uma maneira em que o GP possa modificar o produtor
> registrado como responsável atual. […] Talvez seja um ponto que não
> precisa ser enviado ao financeiro, para não atrasar o processo.

O Tiago sugeriu uma errata sem mudança na planilha. A errata devolve o job
ao mural do financeiro e trava o envio para faturamento até a nova
conferência; trocar a pessoa não muda número nenhum. Por isso a troca ficou
no pop-up "Equipe", sem errata. Nas respostas: o GP Responsável também se
troca assim (1), com protótipo antes (2). No protótipo, ele escolheu **1A**
(troca no card, grava no "Salvar", sem confirmação à parte) e **2A** (o novo
GP pode ser qualquer GP, e quem vem de fora entra nos GPs do projeto). E
acrescentou:

> inclusive permita isso quando o GP responsável do projeto for escolhido
> inicialmente também, ainda no estado de orçamento; quando isso ocorrer,
> ele automaticamente deverá ser listado como um dos GPs responsáveis pelo
> projeto.

## A regra

1. **"Trocar" no GP e no Produtor Responsável**, no pop-up "Equipe" do job
   (nos dois cards) e da visão agregada (um ícone em cada célula da tabela
   "Responsáveis pelos jobs", ao passar o mouse na linha).
2. **Quem troca:** o GP ou o administrador — qualquer GP, não só o do job
   (`jobs.trocar_responsaveis`). O produtor e o freelancer veem o cadeado.
3. **Quando:** job aberto ou em produção. Antes da abertura, o GP e o
   produtor se escolhem no envio para abertura (decisão 135); encerrado,
   finalizado e cancelado não mudam mais.
4. **Quem pode ser o novo GP:** qualquer membro ativo com o papel GP ou
   Administrador (decisão 170). A lista mostra os GPs do projeto primeiro e
   os outros depois. **Quem não é GP Responsável do projeto passa a ser** —
   quem estava só na Equipe vira GP.
5. **Quem pode ser o novo produtor:** quem tem o papel Produtor (decisão
   168), os da equipe primeiro.
6. **Grava no "Salvar" do pop-up**, junto com a equipe e a chave. O card
   mostra "No lugar de Fulano · Desfazer" até salvar. Não passa pelo
   financeiro.
7. **A chave "Envia PPs ao financeiro" volta desligada** quando o produtor
   muda (ela é da pessoa, decisão 174). No mesmo "Salvar", o GP pode ligá-la
   para o produtor novo.
8. **Quem sai continua na equipe** pelo que já o punha nela (o produtor do
   orçamento, o GP do projeto). **O orçamento não muda**: ele guarda quem
   estava na abertura. As PPs já geradas também não mudam.
9. **Cada troca vira card na Comunicação do job** ("Produtor Responsável
   trocado · Fulano → Ciclano · por Beltrano"), nas duas telas do job
   (produção e financeiro), e conta como não lida para quem não trocou.
   Fica também na auditoria (`job.responsavel_trocado`).
10. **No orçamento, a mesma lista de GP** (revisa a regra 3 da 170): o campo
    "GP Responsável" do Novo orçamento, do editor, do orçamento novo da
    agregada e do envio para abertura oferece qualquer GP, os do projeto
    primeiro. Escolhido alguém de fora, o campo avisa "Fulano passa a ser GP
    Responsável do projeto ao salvar" (ou "ao enviar"), e ele entra nos GPs
    do projeto quando o orçamento é gravado ou o job é enviado
    (`projeto.gp_incluido` na auditoria). A trava do envio continua: o GP
    gravado que não pode ser GP para o envio (regra 4 da 170).

## Onde mora

- Banco: `jobs_trocas_de_responsavel` (uma linha por troca, só leitura para
  quem vê o job), `trocar_responsavel_do_job` (confere papel, status e a
  pessoa; inclui o GP de fora no projeto; o gatilho da 174 desliga a
  chave), `incluir_gp_no_projeto` (usada pela troca e pelo orçamento) e o
  gatilho `jobs_guarda_troca_de_responsavel`, que barra a escrita direta do
  GP e do produtor de job já aberto ("mudam só pela Equipe do job").
- Equipe: `app/(app)/jobs/_equipe/equipe-dialog.tsx` (o "Trocar") e
  `actions.ts` (`salvarEquipeDoProjeto` recebe `trocas`; a chave pedida se
  compara com o estado DEPOIS da troca, senão ligar a chave do produtor
  novo passaria por "nada mudou"). `JobNaEquipe.aceitaTroca` em
  `lib/data/equipe-do-projeto.ts`.
- Comunicação: `lerTrocasDeResponsavelDoJob`, `trocasDeResponsavelNaoLidas`
  e o card em `montarThreadChat` (`lib/data/job-chat.ts`); ícone `users`.
- Orçamento: `lib/gps-para-escolha.ts` (o tipo `GpParaEscolha`, a lista com
  os grupos e o aviso), `listarGpsParaOrcamento` em `lib/data/members.ts`
  (substitui `listarGpsDoProjeto`), `incluirGpNoProjeto` em
  `lib/data/incluir-gp-no-projeto.ts`, chamada depois de criar e de editar
  o orçamento (`[projetoId]/actions.ts`) e depois do envio e do reenvio
  para abertura (`abertura-actions.ts`).

## Conferido no navegador (15/10/2026)

No projeto de teste TES-P001/26:

- **Como produtor** ("Produtor Teste Claude"): o pop-up "Equipe" do
  TES-1013/26 e da visão agregada sem nenhum "Trocar", só os cadeados. No
  orçamento TES-P001/26-03, a lista de GP com "GPs do projeto" e "Outros
  GPs"; escolhido "GP Teste Claude" (de fora), o aviso "passa a ser GP
  Responsável do projeto ao salvar" e, salvo, ele nos GPs do projeto
  (`projeto.gp_incluido`, origem `orcamento_editado`). Reaberto, ele já
  aparece entre os GPs do projeto, sem aviso. O GP do orçamento voltou ao
  original.
- **Como administrador**, no TES-1013/26: GP trocado para "GP Teste" (de
  fora) e produtor para "Produtor Teste", com a chave ligada para o produtor
  novo no mesmo "Salvar" — gravou as duas trocas, a chave ligada e o "GP
  Teste" nos GPs do projeto; os dois cards apareceram na Comunicação. Pela
  visão agregada, o GP voltou ao original e a chave foi desligada; os jobs
  finalizados (TES-1009 e TES-1027) e o aguardando abertura (TES-1029) sem
  "Trocar". O "Cancelar" com a troca no rascunho não grava nada.
- Os dois GPs de teste saíram dos GPs do TES-P001/26 pelo "Editar projeto".
  O produtor do TES-1013/26 ficou "Produtor Teste": o anterior era um
  administrador, que a lista de produtor não oferece (decisão 168).
- No caminho: o botão "Equipe" repetia o rosto quando o GP é também o
  produtor (aviso de chave duplicada do React), e a linha "No lugar de…"
  cortava nomes longos — os dois corrigidos.

## Números de 15/10/2026

59 jobs abertos ou em produção, todos com o GP entre os GPs do projeto; 16
com o GP também como produtor. 55 pessoas podem ser GP (48 GPs e 7
administradores) e 31 têm o papel Produtor. 60 dos 63 projetos com GP têm
um GP só — com a lista só do projeto (opção 2B, não escolhida), a troca do GP
quase nunca teria para quem.

## Fica de fora

- A troca do GP e do produtor em job ainda aguardando abertura: segue pelo
  envio para abertura.
- Tirar alguém dos GPs do projeto continua pelo "Editar projeto", em
  Orçamentos.
