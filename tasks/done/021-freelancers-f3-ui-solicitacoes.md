# Task 021 — Freelancers (Fase 3, Task 2): UI das solicitações

## Objetivo

Preencher a aba **Solicitações** (`/freelancers/solicitacoes`, hoje placeholder) com UI funcional:

1. **Lista** de solicitações com filtros (status, busca por nome do freela).
2. **Dialog "Nova solicitação"** (GP/produtor/outros pedem).
3. **Popover de detalhes** ao clicar numa linha — mostra todos os dados e os botões conforme role e status.
4. **Ações**: aprovar, rejeitar com motivo, cancelar.
5. **Copiar link público** quando aprovada.
6. **Server actions**: criar, aprovar, rejeitar, cancelar.
7. Audit log em todas as ações.

Fora: chat realtime (Task 022), rota pública (Task 023).

## Fora de escopo

- Chat realtime GP↔RH dentro do popover — **Task 022**.
- RPC `get_freelancer_solicitacao_mensagens_nao_lidas` consumido pra badge "não lidas" — Task 022.
- Rota pública `/form/freelancer-solicitacao/[token]` + endpoint `submit` — **Task 023**.
- Dashboard mostrando solicitações pendentes/minhas — Fase 4.

## Decisões travadas

- **Lista é server component** que consome `freelancer_solicitacoes` com join em `profiles` (solicitante), `jobs` (código+nome) e `freelancers`/`freelancer_contratos` (quando status=cadastrada).
- **Filtros**: chips de status (todos, pendente, aprovada, cadastrada, rejeitada, cancelada) + busca por nome_freela/CPF.
- **Nova solicitação** acessível por botão primário no topo (todos com `sidebar.freelancers` podem criar) → abre dialog.
- **Dialog "Nova"** reusa pickers (JobPicker, CargoPicker) + inputs do form de contrato. CPF do freela opcional. Valor + tipo + datas obrigatórios.
- **Popover** = modal centralizado com dados completos + botões:
  - **Pendente**:
    - Admin/RH/Fin: Aprovar | Rejeitar (com motivo)
    - Solicitante: Cancelar
  - **Aprovada**:
    - Todos com acesso: Copiar link
    - Admin/RH/Fin: ver que o freela ainda não preencheu
  - **Cadastrada**:
    - Link pra `/freelancers/[id]` do freela criado
  - **Rejeitada** / **Cancelada**:
    - Só mostra dados + motivo/data
- **Expiração**: `expira_em` = `aprovado_em + 30 dias`. Após expirar, link não funciona mais; UI mostra "Link expirou" e permite reaprovar (vira pra pendente de novo? Simplificar: só mostra expirado + oferece botão "Reaprovar" que renova por mais 30 dias).
- **Reaprovar** fica pra Task 022 ou 023 — por ora, após expirar, admin/rh pode "cancelar e criar nova". Simplifica.
- **Audit**: `freelancer_solicitacao.criada`, `aprovada`, `rejeitada`, `cancelada`.

## Contexto do ponto de partida

### Já pronto

- Tabela `freelancer_solicitacoes` + enum (Task 020).
- RLS: pendente → solicitante vê, admin/rh/fin veem; INSERT exige `solicitante_id=auth.uid()` e `status=pendente`.
- Pickers JobPicker, CargoPicker reutilizáveis.
- Página stub `/freelancers/solicitacoes/page.tsx` (Task 012).

### Pontos de atenção

- O `cpf_freela` é texto livre na solicitação; o CPF real é confirmado pelo freela depois.
- "Copiar link" só precisa gerar `${origin}/form/freelancer-solicitacao/${token}` — rota ainda não existe (Task 023) mas o link já pode ser gerado e copiado.
- Validação Zod das transições de status fica na server action.

## Escopo

### 1. Arquivos novos

```
lib/validations/freelancer-solicitacoes.ts

app/(app)/freelancers/solicitacoes/
├── actions.ts
└── _components/
    ├── nova-solicitacao-dialog.tsx       # Client: form novo
    ├── solicitacoes-tabela.tsx           # Client: tabela com row clicável
    ├── popover-solicitacao.tsx           # Client: modal com detalhes + ações
    ├── acoes-aprovador.tsx               # Botões aprovar/rejeitar (RH)
    ├── acoes-solicitante.tsx             # Botão cancelar (solicitante)
    ├── copiar-link.tsx                   # Botão + feedback copiado
    └── chip-status-solicitacao.tsx       # Badge por status
```

### 2. Arquivos modificados

- `app/(app)/freelancers/solicitacoes/page.tsx` — passa a renderizar lista real.
- `lib/auth/audit.ts` — 4 ações novas.

### 3. Server actions

- `criarSolicitacao(formData): ActionResult<{ id }>` — valida com Zod, status=pendente, solicitante_id=session.profile.id.
- `aprovarSolicitacao(id): ActionResult` — só admin/rh/fin; marca status=aprovada, aprovado_em=now, expira_em=now+30d.
- `rejeitarSolicitacao(id, motivo): ActionResult` — só admin/rh/fin; marca status=rejeitada, rejeicao_motivo.
- `cancelarSolicitacao(id): ActionResult` — solicitante OU admin/rh/fin; marca status=cancelada.

Cada action: `requireSession`, check role, Zod, UPDATE/INSERT, audit log, `revalidatePath("/freelancers/solicitacoes")`.

### 4. UI da lista

**Header**: PageHeader "Solicitações" + ClipboardList icon + descrição + action "Nova solicitação".

**Filtros**:
- Busca por nome_freela ou CPF (via `?q=`)
- Chips de status (todos / pendente / aprovada / cadastrada / rejeitada / cancelada)

**Tabela** (densa):
Colunas: Freelancer proposto | Job | Cargo | Valor | Solicitante | Data | Status | Ações.

Linha clicável abre popover.

### 5. Popover

Modal centralizado largo (`max-w-2xl`):
- Header com nome do freela + chip de status
- Blocos de info: "Freela proposto" (nome, CPF) · "Job" (código+nome+cargo+valor+tipo+datas+cidade) · "Solicitante" (nome+email+data criação) · "Observações"
- Se status=aprovada: bloco "Link do freelancer" com `CopiarLink` + "Expira em X dias"
- Se status=rejeitada: bloco "Rejeição" com motivo + quem rejeitou + quando
- Se status=cancelada: bloco "Cancelamento" com quem+quando
- Se status=cadastrada: bloco "Resultado" com link pro freelancer criado
- Footer: botões de ação apropriados pro status + role

### 6. Dialog "Nova solicitação"

Dialog com form:
- Nome do freela (texto)
- CPF do freela (MaskedInput, opcional)
- Job (JobPicker — mesmo da Task 017)
- Cargo (CargoPicker)
- Tipo (radio mensal/periodo/diarias)
- Valor (MoneyInput)
- Data início + término
- Cidade (texto)
- Observações (textarea)
- Submit → `criarSolicitacao`, fecha dialog, revalida.

## Critérios de pronto

- [ ] 7+ arquivos criados em `app/(app)/freelancers/solicitacoes/_components/`.
- [ ] Server actions criadas em `actions.ts`.
- [ ] Validation Zod no lugar.
- [ ] `/freelancers/solicitacoes` mostra lista real.
- [ ] Botão "Nova solicitação" abre dialog; submit cria solicitação; aparece na lista.
- [ ] Clicar numa linha abre popover.
- [ ] Pendente: admin/rh/fin veem Aprovar/Rejeitar; solicitante vê Cancelar.
- [ ] Aprovar seta status + aprovado_em + expira_em (30d).
- [ ] Rejeitar pede motivo.
- [ ] Cancelar seta status.
- [ ] Aprovada: botão "Copiar link" copia URL com token.
- [ ] Audit log em criar/aprovar/rejeitar/cancelar.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (022)

Chat realtime no popover: `useEffect` com Supabase Realtime subscription em `freelancer_solicitacao_mensagens`, server action pra enviar mensagem, botão "Marcar como lida" + indicator de não lidas usando a RPC.
