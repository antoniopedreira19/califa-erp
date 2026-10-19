# Task 022 — Freelancers (Fase 3, Task 3): rota pública + endpoint submit atômico

## Objetivo

Fechar o fluxo end-to-end da Fase 3:

1. Rota pública `/form/freelancer-solicitacao/[token]` — freelancer preenche dados pessoais **sem login**.
2. Endpoint `/api/public/freelancer-solicitacao/[token]/submit` — processa o form, cria `freelancer` (dedup por CPF) + `freelancer_contrato` (origem=califa_erp) atomicamente e marca a solicitação como `cadastrada`.
3. Middleware liberando a rota pública.
4. Página de confirmação após submit.
5. Audit log do cadastramento (identificado como "fluxo público").

## Fora de escopo

- **Chat realtime** no popover das solicitações — fica pra **Task 023** (próxima e última da Fase 3).
- Upload de cartão CNPJ pelo link público — fluxo administrativo via `/freelancers/[id]/editar` depois.
- Reenviar link quando expira — simplificar: usuário RH cria nova solicitação se precisar.

## Decisões travadas

- **Service client no endpoint**: rota pública não tem session Supabase, então o endpoint usa `createServiceClient()` (bypassa RLS) pra ler a solicitação pelo token, criar o freelancer e o contrato. Sanitização e validação de token são feitas na mão.
- **Validação do token**: 
  - Formato: 32 chars hex (do `gen_random_bytes(16)`).
  - Existência: tem que haver 1 solicitação ativa com esse token.
  - Status: tem que ser `aprovada`.
  - Expiração: `expira_em > now()`.
  - Qualquer violação → página de erro específica (expirado / inválido / já usado / rejeitado / cancelado).
- **Form público** reutiliza boa parte do `FreelancerForm` mas em versão simplificada: só dados do freelancer (sem o selector de ação prevista). CPF é opcional *se* a solicitação já veio com CPF; caso contrário é obrigatório.
- **Dedup por CPF**: se já existe `freelancer` com esse CPF no tenant, o endpoint **reutiliza** e só cria o contrato novo. UI avisa o freela que o cadastro já existia e os dados foram atualizados.
- **Transação atômica**: INSERT freelancer (ou SELECT se dedup) + INSERT contrato + UPDATE solicitação. Service client não oferece transação cliente-side; vou chamar uma função SQL `cadastrar_freelancer_via_solicitacao()` que faz tudo numa transação server-side. Simplifica muito.
- **Link expirado**: página mostra "Este link expirou" com info do solicitante. Pede pra entrar em contato.
- **Rota pública no middleware**: adicionar `/form/freelancer-solicitacao/` como prefix em `lib/supabase/middleware.ts`.
- **Página de confirmação**: `/form/freelancer-solicitacao/[token]/concluido` — mostra agradecimento + resumo do que foi criado.

## Contexto do ponto de partida

### Já pronto

- Tabela `freelancer_solicitacoes` com `token`, `expira_em`, `status`, `freelancer_id`, `contrato_id` (Task 020).
- Tabela `freelancers` com dedup por CPF via unique index parcial (Task 011).
- Tabela `freelancer_contratos` com check `origem='califa_erp' => job_id NOT NULL` (Task 015).
- Server client `createServiceClient()` em `lib/supabase/server.ts`.
- Zod schema de freelancer em `lib/validations/freelancers.ts` (reutilizável).
- `isValidCpf`, `onlyDigits`, `formatCpf` em `lib/utils.ts`.

### Pontos de atenção

- Service client ignora RLS — qualquer bug no endpoint pode vazar dados. Validação de token é a única defesa; precisa ser rígida.
- `nome_job` do contrato vem do snapshot do `jobs.nome` no momento do submit (não da solicitação; a solicitação já apontava pro mesmo job via `job_id`, mas o nome pode ter mudado).
- Precisa de função SQL `cadastrar_freelancer_via_solicitacao` com SECURITY DEFINER pra fazer tudo numa transação. SET search_path = public pra segurança.

## Escopo

### 1. Arquivos novos

```
supabase/migrations/
└── 20261016000005_freelancers_f3_rpc_cadastrar_via_solicitacao.sql

app/(public)/form/freelancer-solicitacao/[token]/
├── page.tsx                        # Server: valida token, renderiza form ou erro
├── form-client.tsx                 # Client: form controlado
├── concluido/page.tsx              # Confirmação pós-submit
└── layout.tsx                      # Layout público mínimo (sem sidebar)

app/api/public/freelancer-solicitacao/[token]/submit/
└── route.ts                        # POST: valida token, chama RPC
```

### 2. Arquivos modificados

- `lib/supabase/middleware.ts` — adicionar `/form/freelancer-solicitacao/` como rota pública.
- `lib/auth/audit.ts` — valor `freelancer.cadastrado_via_solicitacao`.

### 3. Função SQL `cadastrar_freelancer_via_solicitacao`

Assinatura:
```sql
cadastrar_freelancer_via_solicitacao(
  p_token text,
  p_freelancer jsonb,    -- payload com todos os campos do freelancer
) returns table (
  freelancer_id uuid,
  contrato_id uuid,
  freelancer_ja_existia boolean
)
```

Lógica (dentro de uma função plpgsql, security definer, `SET search_path = public`):
1. Resolve `solicitacao` por token com lock FOR UPDATE.
2. Valida status=aprovada e expira_em > now.
3. Resolve nome do job (`jobs.nome` do `solicitacao.job_id`).
4. Tenta encontrar freelancer existente por `(tenant_id, cpf)` se CPF preenchido.
5. Se não achar, INSERT em freelancers com `origem='form_publico'`.
6. Se achar, UPDATE em freelancers com dados novos (deixa opcional — por enquanto só atualiza o email/celular se vieram preenchidos; para o nome mantém o do primeiro cadastro).
7. INSERT em freelancer_contratos com dados da solicitação + nome_job snapshot.
8. UPDATE solicitação pra status=cadastrada, freelancer_id, contrato_id.
9. Retorna os ids e `freelancer_ja_existia`.

### 4. Validação do form público

Reutiliza o `freelancerSchema` em `lib/validations/freelancers.ts`, com uma diferença: CPF obrigatório **se** a solicitação não trouxe CPF. Isso vai como argumento adicional no server-side.

### 5. Páginas

- `page.tsx` do token:
  - Chama service client (sem session), busca solicitação pelo token.
  - Se não existir, 404.
  - Se status != aprovada: mostra mensagem apropriada.
  - Se expirada: mensagem específica.
  - Se ok: renderiza `FormClient` com dados pré-preenchidos (nome_freela e cpf_freela da solicitação).
- `form-client.tsx`:
  - Form simplificado do FreelancerForm (sem ação prevista, sem cards do PJ obrigatório — mas aceita).
  - Submit chama endpoint `/api/public/...`.
  - No sucesso, redireciona pra `concluido`.

- `concluido/page.tsx`: página simples de agradecimento.

- `layout.tsx` do `(public)/form/freelancer-solicitacao`: wrapper enxuto sem sidebar.

### 6. Endpoint

- POST com FormData.
- Valida token (regex 32 hex), extrai do path.
- Zod valida payload (freelancerSchema).
- Chama RPC via service client.
- Audit log `freelancer.cadastrado_via_solicitacao` (metadata: solicitacao_id, freelancer_id, ja_existia).
- Retorna `{ ok, freelancer_id, contrato_id, ja_existia }`.

## Critérios de pronto

- [ ] Migration aplicada; função RPC existe e tem SECURITY DEFINER.
- [ ] Middleware libera `/form/freelancer-solicitacao/`.
- [ ] Link gerado na Task 021 abre a página pública.
- [ ] Status não-aprovada / expirado mostra mensagem.
- [ ] Submit cria freelancer + contrato + marca solicitação como cadastrada.
- [ ] Se CPF já existia no tenant, reutiliza o freelancer.
- [ ] Audit log registra o cadastramento público.
- [ ] Página concluido mostra confirmação.
- [ ] GP vê a solicitação como `cadastrada` com link pro freelancer criado.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (023)

Chat realtime no popover de solicitações: subscription Supabase Realtime na tabela `freelancer_solicitacao_mensagens`, envio de mensagem via server action, botão "Marcar como lida" + badge de não lidas usando a RPC já criada na Task 020.
