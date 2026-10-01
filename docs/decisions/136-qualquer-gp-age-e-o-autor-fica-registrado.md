# 136 — Qualquer GP age em qualquer job, e quem fez cada envio fica registrado

**Data:** 2026-10-01
**Decidido por:** Tiago
**Status:** aceita — em entrega por partes (ver §6)
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

## 3. Registro e telas (partes 2 a 4)

A preencher a cada parte entregue.

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
- O produtor não foi testado logado (não há usuário de teste com esse papel
  que entre); a regra dele foi conferida pelo código e pela matriz.

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
   job no financeiro — a fazer.
3. PPs: histórico completo, lista, aprovar PP e aprovar prestação — a fazer.
4. Chats: cargo de quem escreveu — a fazer.
