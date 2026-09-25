# 107 — A coluna Save nasce recolhida, e só abre sozinha onde já há save

**Data:** 2026-09-25
**Decidido por:** Tiago
**Migration:** nenhuma.

---

## 1. O problema

A coluna Save abria sozinha em muito mais planilhas do que as que usam save:

- **Orçamento e job** abriam a coluna também quando o **cliente** tinha
  saldo de save disponível em outros jobs. Em cliente que já usou save
  alguma vez, isso é quase todo orçamento e todo job, mesmo sem nenhuma
  linha gerando ou consumindo crédito.
- **A agregada do financeiro** (`/financeiro/projetos/[id]`) mostrava a
  coluna sempre, sem liga-desliga (nota de 2026-09-01 do
  `HANDOFF_FINANCEIRO`).

## 2. A regra

Ao abrir qualquer planilha (orçamento, job ou financeiro), a coluna Save
**nasce recolhida na alça lateral**, com o rótulo "SAVE" na vertical. Ela
só nasce **aberta** quando o próprio orçamento ou job já tem save:

| Planilha | Nasce aberta quando |
|---|---|
| Versão do orçamento (inclusive a mensal) | alguma linha da versão gera ou consome save, **ou** a versão é "Orçamento de save" |
| Agregada do orçamento | alguma linha de algum orçamento da tela gera ou consome save |
| Planilha interna do job (produção e financeiro) | alguma linha do job gera ou consome save, ou tem recusa de save ainda não retirada |
| Agregada de jobs (produção e financeiro) | algum job do projeto gera ou consome save |
| Conferência da abertura (financeiro) | alguma linha do job gera ou consome save |

- **O saldo do cliente em outros jobs não abre mais a coluna.** Ele segue
  oferecido no pop-up de save de cada linha, como antes.
- **O "Orçamento de save" abre a coluna** mesmo antes da primeira linha:
  nele todo item novo nasce em save.
- **O estado é da tela, não é gravado.** Quem recolhe ou abre a coluna
  pela alça ou pelo menu "Exibir" vê o estado mudar só até sair da página.
- **O financeiro ganhou o liga-desliga.** A agregada dele passou a ter o
  menu "Exibir" com o item Save, e a conferência da abertura ganhou a alça
  (antes, sem save, a coluna nem existia ali). O motivo da regra de
  01/09 (ver por que faturamento previsto e valor do job divergem) segue
  atendido: quando há save, a coluna abre sozinha.
- **O serviço Interno continua sem coluna e sem alça** (decisão 105). A
  conferência da abertura passou a ler `investimento_interno` do serviço
  do orçamento para respeitar isso.

## 3. Onde está no código

- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/planilha-versao.tsx`
- `app/(app)/jobs/[jobId]/realizado/job-realizado-section.tsx`
- `app/(app)/jobs/projeto/[projetoId]/planilhas-do-projeto.tsx` (a prop
  `saveSempreVisivel` saiu)
- `app/(app)/financeiro/projetos/[projetoId]/page.tsx`
- `app/(app)/financeiro/abertura-de-job/[jobId]/planilha/page.tsx` e
  `planilha-conferencia.tsx`

A agregada do orçamento (`editor-agregado.tsx`) já seguia a regra e não
mudou.
