# 043 — Descrição do projeto e descritivo do job viram obrigatórios

**Data:** 2026-09-03
**Decidido por:** Tiago

Dois campos de texto livre que nasceram opcionais e, na prática, são a
única explicação que o resto da empresa recebe sobre o que foi contratado.
Ambos passam a ser exigidos — cada um em um formulário só.

---

## 1. Descrição do projeto

Formulário de projeto (`/orcamentos/novo` e o drawer de edição). O rótulo
perdeu o "Opcional" e ganhou o asterisco vermelho.

Vale para **criar e editar**: é o mesmo formulário e o mesmo
`projetoSchema`. Consequência prática — projeto antigo sem descrição só
salva depois de ganhar uma. Eram **12 dos 18 projetos** na data desta
decisão.

## 2. Descritivo do job

Só no modal **"Enviar job para abertura"**, que é onde a produção entrega o
job ao financeiro. Era o único campo editável opcional do modal; agora tem
asterisco, entra na conta do botão "Confirmar dados" e é validado pelo
`aberturaJobSchema` no servidor.

Nenhuma outra tela ganhou obrigatoriedade: o descritivo aparece na
conferência do financeiro, no detalhe do job e no diálogo da fila, mas em
todas elas é leitura.

## 3. Por que o banco não mudou

`projetos.descricao` e `jobs.observacoes` **seguem nullable**. Os registros
anteriores a esta decisão não têm o texto — 12 projetos e 27 dos 30 jobs —
e um `NOT NULL` exigiria backfill, que é inventar conteúdo para dado de
gente. A regra vale daqui pra frente e é imposta no Zod, ou seja, no
servidor: o navegador só antecipa o realce.

Mesmo desenho da obrigatoriedade de Regional e Final previsto no projeto
(30/07/2026) e da `data_evento` no job (27/08/2026): coluna nullable,
regra no Zod.

## 4. Onde está

- `lib/validations/projetos.ts` — `descricao` sem `.optional()`, sem o
  `transform` para `null`, com `min(1)`.
- `lib/validations/abertura-job.ts` — `observacoes` idem.
- `app/(app)/orcamentos/projeto-form.tsx` — `required` no `Field` e realce
  de erro no `Textarea`.
- `app/(app)/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]/enviar-job-modal.tsx`
  — `observacoes` entra em `CampoObrigatorio` e em `faltamCampos`; o
  `Campo` troca `opcional` por `obrigatorio`.
