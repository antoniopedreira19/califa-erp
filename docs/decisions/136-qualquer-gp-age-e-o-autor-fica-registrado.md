# 136 — Qualquer GP age em qualquer job, e quem fez cada envio fica registrado

**Data:** 2026-10-01
**Decidido por:** Tiago
**Status:** aceita — entregue em 01/10/2026, em quatro partes (ver §6)
**Protótipo aprovado:** artifact "Autoria no financeiro" (30/09 e 01/10/2026)

---

## 1. O pedido

Até aqui, só o GP responsável do job (ou um administrador) mexia na
planilha do job e nas PPs. O Tiago pediu o contrário: *"qualquer GP deve
conseguir editar e fazer o envio do orçamento. Caso um GP esteja de férias
ele precisará coordenar com outro"*. Em troca, quem fez cada envio ao
financeiro precisa ficar registrado e aparecer para o financeiro na hora
de interagir com ele — envio e reenvio do job, errata, pedido de save,
envio de PP, prestação de contas, envio para faturamento.

Respostas do Tiago às perguntas do protótipo:

1. **Produtor e PP:** o produtor gera, edita e cancela a PP enquanto ela
   não foi enviada; enviar e reenviar ao financeiro fica com o GP e o
   administrador.
2. **Prestação de contas da verba:** o responsável pela verba, qualquer GP
   ou um administrador.
3. **Devolução do job** (o "Reprovar" da conferência): gravar quando o
   financeiro devolveu e mostrar à produção **"Devolvido pelo Financeiro
   em [data]"**, sem o nome de quem devolveu.
4. **Chats:** mostrar o cargo de quem escreveu ao lado do nome.

## 2. Permissões (parte 1, entregue em 01/10/2026)

| O quê | Até 01/10/2026 | Agora |
|---|---|---|
| Planilha do job: errata, BV, confirmar BV, concluir PPs | Administrador ou o GP responsável do job | Administrador ou **qualquer GP** |
| Gerar, editar e cancelar PP ainda não enviada | Administrador ou o GP responsável | Administrador, **qualquer GP ou o produtor** |
| Enviar e reenviar PP ao financeiro | Administrador ou o GP responsável | Administrador ou **qualquer GP** (recurso novo `jobs.enviar_pp`) |
| Cancelar PP já enviada (em avaliação ou rejeitada) | Administrador ou o GP responsável | Administrador ou **qualquer GP** |
| Prestar contas da verba | Responsável pela verba, GP responsável do job ou administrador | Responsável pela verba, **qualquer GP** ou administrador |

- **Front** (`app/(app)/jobs/[jobId]/carregar-detalhe.ts`): `quemPodeMexer`
  deixou de comparar `jobs.responsavel_id` com o usuário. Errata e BV
  continuam fora do produtor, como já eram na prática (a regra de dono o
  deixava de fora, porque o produtor nunca é o `responsavel_id`). Gerar PP
  segue `jobs.emitir_pp`; enviar segue `jobs.enviar_pp`. A flag nova
  `papelEnviaPP` separa o papel do estado do job: o produtor vê o envio
  fechado com "Só o GP envia PP ao financeiro", e o GP continua
  cancelando PP enviada mesmo com a abertura em revisão.
- **Servidor** (`realizado/actions-pp.ts`): `checarGatesRealizado` confere
  `jobs.emitir_pp` no lugar do dono — o que também fecha a porta das três
  actions que não chamavam `checarPermissao` (prefixo de anexos, envio,
  edição de PP gerada). Envio e reenvio chamam `barrarEnvioPeloPapel`
  (`jobs.enviar_pp`). `cancelarPedidoCompra` aceita o produtor só com a PP
  em `gerada`.
- **Banco:** `enviar_prestacao_verba` troca "GP responsável do job" por
  "qualquer GP" (migration `20261001400001`).
- **Não mudou:** orçamento, envio do job para abertura, save, encerramento
  e envio para faturamento já conferiam só o papel. Os filtros "Meus jobs"
  e "Meus projetos" continuam abrindo pelo GP responsável — escolhem o que
  aparece primeiro, não impedem nada.
- A matriz `jobs.criar_errata` continua com o produtor (o teste
  `lib/permissoes.test.ts` fixa isso); quem o tira da errata é a tela, como
  antes.

Substitui o §5 da decisão 135 ("GP que troca o GP perde a edição do job").

## 3. Registro e telas

### 3.1 Ciclo do job (parte 2, entregue em 01/10/2026)

**Banco** (migration `20261001400002`, só aditiva):

- `jobs.enviado_abertura_por` / `enviado_abertura_em`: o ÚLTIMO envio para
  abertura — o primeiro ou o reenvio. O primeiro continua em
  `created_by`/`created_at`. Preenchido nos 37 jobs: o reenvio sai da
  auditoria (`job.reenviado_para_aprovacao`, 5 jobs), o resto do
  `created_by`.
- `jobs.devolvido_em`: quando o financeiro devolveu. Preenchido em 10 jobs a
  partir de `job.abertura_rejeitada`. A justificativa (`motivo_rejeicao`)
  **deixou de ser apagada no reenvio** — é o que a conferência do reenvio
  mostra.
- `itens_bv.confirmado_por` / `confirmado_em`: quem confirmou o BV. Os 3
  confirmados foram preenchidos pela auditoria (`item_bv.confirmado`).
- `vw_faturamento_pendente` ganhou, no fim, `autor_nome` e `autor_em`: quem
  enviou o job para faturamento, ou quem confirmou o BV.
- O preenchimento desligou o gatilho de `updated_at` de `jobs` e `itens_bv`
  durante o update: nenhuma data de atualização mudou.
- O levantamento apontava que o envio para faturamento aceitava o autor que
  vinha da tela. Não aceita: o gatilho `envio_faturamento_autor` já gravava o
  usuário logado. Só não aparecia em tela nenhuma.

**Telas:**

| Tela | O que mostra agora |
|---|---|
| Fila de abertura | Coluna "Enviado por": nome e quando. Na linha de errata, o autor e a data da errata mais recente (antes a coluna mostrava a criação do job). Na de save, quem pediu. Selo "Reenvio" quando o job voltou depois da devolução. |
| Conferência (pop-up) | Faixa "Enviado por X em data às hora". No reenvio, "Reenviado por X…, depois da devolução", o primeiro envio e uma caixa "Devolvido pelo Financeiro em …" com a justificativa. |
| Reprovar (pop-up) | Diz quem enviou e que qualquer GP corrige; GP responsável e produtor ficam como referência. |
| Tela de abertura | "Enviado por" com data e hora; no reenvio, "Reenviado por" e "Primeiro envio". |
| Recusar save (pop-up) | "Pedido por X em …" no lugar do GP responsável. |
| Job devolvido (produção) e aviso do orçamento | "Devolvido pelo Financeiro em …", sem o nome de quem devolveu. |
| Faturamento (Contas a Receber) | Na linha do job, "Enviado por X · data"; no BV, "BV confirmado por X · data"; na nota já faturada, quem enviou cada job. |
| Faturar (painel) | Faixa "Enviado para faturamento por X em …"; o apoio da descrição cita o nome. |
| Ficha do job (produção e financeiro) | Etapas com data, hora e autor: envio para abertura, abertura, envio para faturamento, encerramento. No topo da página do financeiro, "para faturamento por X em …". |

- `jobJaFoiDevolvido` (`aprovacao-save.ts`) lê `jobs.devolvido_em` em vez
  de depender só da auditoria, que o financeiro não lê inteira.
- O primeiro envio e o "último envio" nascem com milissegundos de
  diferença (um vem do banco, o outro da aplicação). "Reenviado" só vale
  com mais de um minuto entre os dois — um reenvio exige a devolução no
  meio.

### 3.2 PPs (parte 3, entregue em 01/10/2026)

**Banco** (migration `20261001400003`, só aditiva):

- Tabela nova `pedidos_compra_eventos`: um registro por evento da PP —
  emitida, marcada como urgente, urgência retirada, pagamento fora do
  cadastro pedido, enviada, envio desfeito, rejeitada, reenviada, aprovada,
  aprovação desfeita, reprovada depois de aprovada, paga, baixa desfeita,
  cancelada — e da prestação de contas da verba (enviada, reenviada,
  reprovada, aprovada). Cada um com quem (`por`), quando (`em`) e, onde há,
  a justificativa (`motivo`).
- Quem escreve são dois gatilhos (`trg_pp_registra_evento` em
  `pedidos_compra`, `trg_prestacao_verba_registra_evento` em
  `pp_verba_prestacoes`), nas mudanças de status, na urgência e no meio de
  pagamento fora do cadastro. A aplicação só lê: `authenticated` tem
  `select`, sem policy de escrita; `anon`, nada. A RLS repete a da PP (quem
  vê a PP vê o histórico).
- **Por que tabela, e não colunas:** as colunas da PP guardam um evento por
  tipo. O reenvio apaga `rejeitada_*` e `motivo_rejeicao`; a reprovação de
  PP aprovada apaga `aprovada_*`; o reenvio da prestação sobrescreve
  `fechada_*`. O histórico perdia exatamente o que o financeiro precisava
  ver: quem rejeitou, por quê, e quem mandou de volta.
- `enviada_financeiro_em/por` **continuam sendo o primeiro envio**: o chat
  das PPs conta o prazo de pagamento a partir dele. O último envio sai da
  tabela de eventos.
- Preenchimento das 51 PPs (143 eventos): das colunas da PP e, quando a
  auditoria tem o evento daquela PP, da auditoria — que guarda reenvios,
  reprovações e envios desfeitos que as colunas perderam. Muitos eventos da
  auditoria são de PPs de teste já apagadas e ficam de fora. A baixa usa a
  hora da última baixa registrada na auditoria; sem ela, só o dia
  (`so_data`) — as 10 PPs pagas tinham a hora.
- Não havia prestação de contas no banco: o preenchimento dela não gerou
  nada.

**Telas:**

| Tela | O que mostra agora |
|---|---|
| Lista de PPs (Contas a Pagar) | Coluna "Enviada por": nome, data e hora do último envio, e o selo "Reenviada" quando a PP voltou depois de rejeitada. No filtro "Prestações", quem enviou a prestação. "Emissão" continua sendo a geração. |
| Tela da PP · Histórico | Um evento por linha, com dia e hora, na ordem em que aconteceram. A rejeição e a reprovação ficam com a justificativa entre aspas, e continuam lá depois do reenvio. Os eventos da prestação de contas entram no mesmo histórico. |
| Aprovar PP (pop-up) | Faixa "Enviada por X em data às hora" ("Reenviada por" no reenvio) e, embaixo, quem emitiu e o GP responsável do job. |
| Aprovar prestação (pop-up) | Faixa "Prestação enviada por X em …" ("reenviada" no reenvio) e, embaixo, o responsável pela verba e o GP responsável do job. |
| Chat das PPs (card da PP) | O rótulo "Emitida por" virou "Enviada por": o nome ali sempre foi o de quem enviou. |

- Quem pediu o pagamento fora do cadastro aparece no histórico ("Pagamento
  fora do cadastro pedido · X"); o cartão do fora do cadastro não mudou.

### 3.3 Chats (parte 4, entregue em 01/10/2026)

- **Banco** (migration `20261001400004`, só aditiva): `jobs_mensagens`
  ganhou `autor_papel` (o enum `app_role`), o cargo do autor **no momento
  do envio**. Um gatilho BEFORE INSERT (`trg_jobs_mensagens_autor_papel`)
  preenche pelo vínculo do autor com o tenant e ignora o que vier da
  aplicação — ninguém escolhe o próprio cargo. As 3 mensagens que já
  existiam receberam o cargo atual do autor, como combinado no protótipo.
- **Tela:** o balão das mensagens mostra "Nome · Cargo" ("GP Teste Claude ·
  Gerente de Projeto"). "Produção" ou "Financeiro" continua ao lado da hora:
  é o lado de onde a mensagem saiu e define o lado do balão. Vale para a
  Comunicação do job (produção e financeiro) e para o chat das PPs, que usam
  o mesmo balão (`components/chat/balao-pessoa.tsx`).
- O rótulo do cargo é o de `roleLabel` (`gerente_producao` aparece como
  "Gerente de Projeto").

### 3.4 Linha do tempo do "Ver PP" na produção (parte 5, entregue em 01/10/2026)

Protótipo aprovado: artifact "Ver PP na produção" (versões 1 a 3).

A ficha da PP no job (planilha → chip "PPs" do item → "Ver formulário",
`app/(app)/jobs/[jobId]/pps/ver-pp-drawer.tsx`) tinha a própria linha do
tempo, montada das colunas da PP: a rejeição sumia no reenvio e o reenvio
não aparecia. Agora ela lê `pedidos_compra_eventos`:

- um passo por evento, na ordem, com data e hora; depois o passo de agora e
  os que ainda vêm, como antes;
- o que a produção fez leva o nome de quem fez (gerou, enviou, reenviou,
  cancelou, prestou contas); o que o financeiro fez aparece "pelo
  financeiro", **sem o nome** — a mesma regra da devolução do job (Tiago);
- rejeição, reprovação e prestação reprovada com a justificativa entre aspas
  e o **ponto vermelho com X**;
- **urgência e pagamento fora do cadastro ficam de fora** (Tiago): quem os
  vê é o financeiro, no Contas a Pagar — ver a
  [137](137-fora-do-cadastro-visivel-e-pago-pela-remessa.md);
- a verba mostra a prestação passo a passo (envio, reprovação, reenvio,
  aprovação) e termina em "Concluída" quando a prestação foi aprovada sem
  saldo a devolver.

`PedidoCompraNaLista` ganhou `eventos` (obrigatório), carregado em
`carregar-detalhe.ts`. PP sem evento nenhum cai na montagem antiga.

## 4. Como foi testado

**Parte 1 (01/10/2026):**
- Como "GP Teste Claude" (papel GP), no TES-1001/26, cujo responsável é o
  Tiago: a planilha passou a mostrar "Realizar errata", "Concluir PPs",
  "Gerar PP" e "Adicionar BV".
- No servidor, pelo console, como o mesmo GP: `prefixoAnexosPedidoCompra`
  da PP-00088 (TES-1008/26, responsável Tiago) passou pela trava e devolveu
  o caminho — antes, "Apenas o responsável do job ou admin pode gerar PP".
  Nada foi gravado.
- `npm run test:permissoes`: 37 de 39, com as duas falhas antigas do RH
  (`sidebar.rh`). O teste novo do `jobs.enviar_pp` passa.
- O produtor foi testado logado na conferência da parte 3 (ver abaixo).

**Parte 2 (01/10/2026)**, no TES-P001/26, com o "Orçamento de Teste":
- Envio como administrador (TES-1019/26): conferência com "Enviado por
  Tiago Mendonça em 01/10/2026 às 12:47"; reprovação com o texto novo.
- Página do job e aviso do orçamento: "Devolvido pelo Financeiro em
  01/10/2026 às 12:47".
- Reenvio como "GP Teste Claude": fila com "GP Teste Claude" e o selo
  "Reenvio"; conferência com o reenvio, o primeiro envio e a devolução com a
  justificativa; tela de abertura com "Reenviado por" e "Primeiro envio";
  ficha com o envio do GP. Envio cancelado no fim (TES-1019/26 queimado).
- Faturamento: TES-1013/26 "Enviado por GP Teste Claude · 29/09/2026
  01:26" (dado real de um teste anterior), BVs confirmados com o autor da
  auditoria, nota faturada do TES-1001/26 com quem enviou; painel Faturar.
- Ficha: TES-1013/26 (envio, abertura, faturamento) e TES-1009/26
  (encerramento).
- O log da API não teve erro de embed ambíguo depois das FKs novas.
- Recusar save: só pelo código — não há pedido de save pendente nos
  projetos de teste.

**Parte 3 (01/10/2026)**, na PP-00080 (TES-1001/26, TES-P001/26):
- Rejeitada pelo administrador com "Teste da decisão 136: conferir o
  histórico do reenvio." — o gatilho gravou a rejeição com autor e motivo.
- Reenviada pelo "GP Teste Claude" pela tela do job ("Salvar e reenviar
  para avaliação").
- Como administrador: lista com "GP Teste Claude · Reenviada · 01/10/2026 ·
  13:11"; histórico com emissão, envio, rejeição (com a justificativa) e
  reenvio; "Aprovar" com "Reenviada por GP Teste Claude em 01/10/2026 às
  13:11" e "Emitida por Tiago Mendonça · GP responsável do job: Tiago
  Mendonça" (fechado sem aprovar; a PP ficou em avaliação, como estava); o
  card do chat com "Enviada por".
- Pop-up de aprovar prestação: primeiro por uma rota de prévia temporária;
  depois com verba de verdade (abaixo).

**Verba e prestação de ponta a ponta (01/10/2026)**, na PP-00099 (TES-1001/26,
Agrupamento 3 · Item 1, R$ 500,00, emissora Empresa Teste):
- Usuário de teste novo, "Produtor Teste Claude"
  (`claude.produtor.teste@califa-erp.local`, papel Produtor), criado pela
  Admin API com o mesmo pacote do convite da tela de usuários, sem e-mail e
  sem senha. O "Produtor Teste" antigo não serve: foi inserido por SQL, sem
  identidade de login.
- Como produtor: gerou a PP de verba; "Gerar e enviar" e "Enviar ao
  financeiro" vieram travados com "Só o GP envia PP ao financeiro"; chamada
  direta da action pelo console devolveu a mesma recusa do servidor.
- Como "GP Teste Claude": enviou a PP.
- Como administrador: lista com "GP Teste Claude"; histórico com a emissão
  pelo produtor; "Aprovar" com "Enviada por GP Teste Claude … Emitida por
  Produtor Teste Claude"; aprovou e deu baixa pela "Conta Teste" (Empresa
  Teste), PIX.
- Como produtor (responsável pela verba): prestou contas com um recibo de
  R$ 500,00 (sem saldo, sem estorno).
- Como administrador: filtro "Prestações" com "Produtor Teste Claude";
  "Aprovar prestação" com "Prestação enviada por Produtor Teste Claude …
  Responsável pela verba: Produtor Teste Claude · GP responsável do job:
  Tiago Mendonça"; reprovou com justificativa.
- Como "GP Teste Claude", que não é o responsável pela verba: reenviou a
  prestação (regra "qualquer GP" da migration `20261001400001`).
- Como administrador: lista com "GP Teste Claude · Reenviada"; histórico com
  a reprovação e a justificativa mantidas; pop-up com "Prestação reenviada
  por GP Teste Claude"; aprovou. Os 8 eventos ficaram gravados, do
  "emitida" ao "prestacao_aprovada".
- O log da API ficou sem erro (todas as respostas 2xx) depois da tabela
  nova.

**Parte 5 (01/10/2026)**, como "GP Teste Claude", na planilha do TES-1001/26:
- PP-00080: Gerada, Enviada, "Rejeitada pelo financeiro" com a justificativa
  e o ponto vermelho, "Reenviada ao financeiro · GP Teste Claude", Em
  avaliação (agora), Aprovação e Pagamento.
- PP-00099 (verba): Gerada pelo produtor, Enviada pelo GP, Aprovada com o
  pagamento programado, Paga com a hora, a prestação enviada, reprovada,
  reenviada e "Concluída · prestação aprovada pelo financeiro".
- PP-00102 (fora do cadastro): sem o passo do fora do cadastro e sem o
  "Pedido por" no cartão; "Aprovada pelo financeiro" aceso.

**Parte 4 (01/10/2026)**, no TES-1001/26:
- Como "GP Teste Claude", mensagem na Comunicação do job ("Teste da decisão
  136: cargo de quem escreveu no chat.") — o gatilho gravou
  `gerente_producao`, e o balão mostrou "GP Teste Claude · Gerente de
  Projeto".
- Como administrador, na Comunicação do job pelo financeiro: o mesmo balão,
  com "Produção · 01/10 13:18" ao lado da hora. A mensagem de teste ficou no
  chat do TES-1001/26 (não há exclusão de mensagem).
- O chat das PPs não tem mensagem em nenhum job; ele usa o mesmo balão e a
  mesma montagem, conferidos pelo código e pelo verificador de tipos.

## 5. Arquivos (parte 1)

- `lib/permissoes.ts`, `lib/permissoes.test.ts`
- `app/(app)/jobs/[jobId]/carregar-detalhe.ts`, `page.tsx`
- `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`,
  `job-realizado-section.tsx`, `job-item-realizado-table.tsx`
- `app/(app)/jobs/[jobId]/pps/job-pps-section.tsx`
- `app/(app)/financeiro/abertura-de-job/[jobId]/page.tsx`,
  `planilha/planilha-conferencia.tsx`, `app/(app)/financeiro/jobs/[jobId]/page.tsx`
  (só passam `papelEnviaPP={false}`: são telas de leitura)
- `supabase/migrations/20261001400001_prestacao_de_verba_qualquer_gp.sql`

## 6. Partes

1. Permissões — entregue em 01/10/2026.
2. Envio, reenvio e devolução do job; envio para faturamento e BV; ficha do
   job — entregue em 01/10/2026.
3. PPs: histórico completo, lista, aprovar PP e aprovar prestação —
   entregue em 01/10/2026.
4. Chats: cargo de quem escreveu — entregue em 01/10/2026.
5. Linha do tempo do "Ver PP" na produção — entregue em 01/10/2026.
