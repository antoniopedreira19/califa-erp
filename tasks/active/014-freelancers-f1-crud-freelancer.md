# Task 014 — Freelancers (Fase 1, Task 4): CRUD manual de freelancer

## Objetivo

Entregar o ciclo completo de cadastro **manual** de freelancer (sem passar por solicitação, sem contrato — ambos chegam depois). Três telas que resolvem:

1. `/freelancers/novo` — formulário completo pra RH/Financeiro/Admin cadastrar freela.
2. `/freelancers/[id]` — perfil do freelancer com hero, dados organizados e abas (contratos e histórico ficam vazias).
3. `/freelancers/[id]/editar` — mesma UI do novo, pré-preenchida.

Mais o endpoint `/api/freelancers/buscar-por-cpf` pra evitar cadastro duplicado.

## Fora de escopo

- Upload do cartão CNPJ (bucket Storage) — chega na Fase 2 junto com DOCX e PDF.
- Dropdown de cargo no formulário — cargo é do contrato, não da pessoa.
- Lista de contratos no perfil — aba fica vazia (vem na Fase 2).
- Trigger de histórico de alterações — Fase 4.
- Fluxo de solicitação de contratação (GP → RH → link público) — Fase 3.
- Botão "Novo contrato" no perfil — aparece desabilitado com tooltip (ativa na Fase 2).

## Decisões travadas (alinhadas 16/10/2026)

- **Formulário de uma coluna, `max-w-3xl`** — padrão do califa-erp pra formulários verticais. Nada de layout 2 colunas.
- **Dedup por CPF via endpoint, não só na UI.** Quando RH digita um CPF já cadastrado, o form consulta `/api/freelancers/buscar-por-cpf?cpf=` e mostra aviso com link pra abrir cadastro existente. Isso evita duplicata mesmo que a UI falhe.
- **ViaCEP auto-preenche endereço.** Ao sair do campo CEP (`onBlur`), chama `viacep.com.br/ws/{cep}/json/`. Se der certo, preenche rua/bairro/cidade (usuário pode editar depois). Se der erro, não quebra — só não preenche.
- **Permissão de criar/editar freelancer**: `administrador`, `rh`, `financeiro`. Alinhado com a policy do banco. GP/produtor acessam o perfil (SELECT no banco permite) mas **sem botões de ação**.
- **Perfil usa Hero com avatar + nome + chip ação prevista.** Hero é compacto nesta fase (sem KPIs de contrato). Hero rico com valor/mês e tempo de vínculo chega na Fase 2 quando contratos existirem.
- **Abas no perfil**: Dados pessoais (default) · Contratos (placeholder) · Histórico (placeholder). As duas últimas ficam marcadas como "em breve" com texto explicativo.
- **Botão "Editar"** no hero leva pra `/freelancers/[id]/editar`. **"Novo contrato"** fica desabilitado com tooltip "chega na Fase 2".
- **Handle da URL** = `id` puro. Não vou gerar slug nesta task — isso é cosmético, pode ser adicionado depois sem quebrar nada.
- **Audit log** registra criado, editado e inativado (campo `acao_prevista` mudando pra `encerrar` eventualmente — mas não há "inativar freelancer" nesta task; audit cobre as duas primeiras).

## Contexto do ponto de partida

### Já pronto

- Tabela `freelancers` com RLS, policies, 34 colunas, trigger `updated_at` (Task 011).
- Lista `/freelancers/lista` com linha clicável que vai pra `/freelancers/[id]` (hoje 404) — Task 013.
- Botão "Novo freelancer" na lista, hoje desabilitado — Task 013. Esta task **habilita**.
- Tipos `Freelancer`, `TipoPagamentoFreelancer`, `AcaoPrevistaFreelancer`, `OrigemFreelancer` em `lib/types.ts`.
- Padrão de server actions em `app/(app)/clientes/actions.ts` pra espelhar.
- Padrão de página de novo em `app/(app)/clientes/novo/` + `cliente-form.tsx`.
- `MaskedInput`, `MoneyInput`, `DatePicker` em `components/ui`.
- `isValidCpf`, `isValidCnpj`, `formatCpf`, `formatCnpj`, `formatCep`, `onlyDigits` em `lib/utils.ts`.
- `logAuditEvent` com tipagem completa — precisa adicionar `freelancer.criado`, `freelancer.editado`.

### Pontos de atenção

- CPF salvo no banco é só dígitos (`onlyDigits`). Formatação só na UI.
- CNPJ idem.
- CEP idem.
- Celular/telefone: dígitos puros no banco; UI formata.
- `cnpj + razao_social` é par — check constraint no banco já trava. UI valida antes com `fieldErrors` pra UX melhor.
- `origem` da task é `'manual'`.
- `created_by`/`updated_by` populados com `session.profile.id`.

## Escopo (o que a task entrega)

### 1. Arquivos novos

```
app/(app)/freelancers/
├── novo/
│   ├── page.tsx                   # Server: carrega lista de "Outro" dropdowns
│   └── novo-client.tsx            # Client: formulário controlado
├── [id]/
│   ├── page.tsx                   # Server: busca freela + render perfil
│   ├── loading.tsx
│   ├── not-found.tsx
│   └── editar/
│       ├── page.tsx
│       └── editar-client.tsx
├── _components/                   # (compartilhado entre novo e editar)
│   ├── freelancer-form.tsx        # Form controlado (RHF + Zod)
│   ├── cep-input.tsx              # Input com busca ViaCEP
│   ├── hero-freelancer.tsx        # Hero compacto do perfil
│   ├── abas-perfil.tsx            # Tabs horizontais (Dados / Contratos / Histórico)
│   └── bloco-info.tsx             # Card pra agrupar dados no perfil
└── actions.ts                     # Server actions: criar, atualizar

app/api/freelancers/
└── buscar-por-cpf/
    └── route.ts                   # GET ?cpf= → { encontrado: {id,nome_social} | null }

lib/validations/freelancers.ts    # Zod schema do freelancer
```

### 2. Arquivos modificados

- `app/(app)/freelancers/lista/page.tsx` — remover o `disabled` do botão "Novo freelancer" e trocar `title` por link funcional.
- `app/(app)/freelancers/_components/sub-nav.tsx` — garantir que `/freelancers/novo`, `/freelancers/[id]`, `/freelancers/[id]/editar` ativam a aba "Freelancers" (regex já cobre, mas revisar).
- `lib/auth/audit.ts` — adicionar `freelancer.criado`, `freelancer.editado`.

### 3. Schema de validação (Zod)

```ts
// lib/validations/freelancers.ts
export const freelancerSchema = z.object({
  nome_social: z.string().trim().min(2).max(120),
  nome_completo: z.string().trim().max(200).nullable().optional(),
  cpf: z.string().optional().transform(onlyDigits).refine(
    (v) => v === "" || isValidCpf(v),
    { message: "CPF inválido" }
  ).nullable(),
  rg: z.string().trim().max(30).nullable().optional(),
  data_nascimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  email: z.string().email({ message: "Email inválido" }).nullable().optional().or(z.literal("")),
  celular: ... (dígitos),
  cep: ... (8 dígitos),
  rua, numero, complemento, bairro, cidade,
  cnpj: ... (dígitos, válido se preenchido),
  razao_social: ... (max 200),
  tipo_pagamento: z.enum(["conta_bancaria", "pix"]).nullable(),
  banco, agencia, conta, pix_chave,
  cor_raca, identidade_genero, deficiencia, saude_obs, contato_emergencia,
  acao_prevista: z.enum([5 valores]).nullable(),
}).refine(
  (v) => (v.cnpj && v.razao_social) || (!v.cnpj && !v.razao_social),
  { message: "CNPJ e Razão Social devem ser preenchidos juntos", path: ["razao_social"] }
).refine(
  (v) => v.tipo_pagamento !== "pix" || v.pix_chave,
  { message: "Chave PIX é obrigatória", path: ["pix_chave"] }
);
```

### 4. Server actions

```ts
// app/(app)/freelancers/actions.ts
export async function criarFreelancer(formData: FormData): Promise<ActionResult<{ id: string }>>;
export async function atualizarFreelancer(id: string, formData: FormData): Promise<ActionResult>;
```

- Chama `requireSession()`.
- Checa `pode(role, "sidebar.freelancers")` + role in [admin, rh, financeiro].
- Valida com Zod.
- INSERT/UPDATE em `freelancers` com `tenant_id`, `created_by` ou `updated_by`.
- Trata `23505` (duplicate CPF ou CNPJ) com fieldError.
- Trata `23514` (check constraint violado — par CNPJ+razão) com mensagem clara.
- `logAuditEvent` em sucesso.
- `revalidatePath("/freelancers/lista")` e `revalidatePath("/freelancers/[id]")`.
- `redirect("/freelancers/[id]")` no criar; retorna `{ ok: true }` no editar.

### 5. Endpoint `buscar-por-cpf`

Server route `/api/freelancers/buscar-por-cpf`:
- GET com query `?cpf=...`.
- `requireSession()`.
- Normaliza CPF (`onlyDigits`), valida que tem 11 dígitos.
- Busca em `freelancers` por `tenant_id` + `cpf`.
- Retorna `{ encontrado: { id, nome_social } | null }`.

### 6. Formulário (`freelancer-form.tsx`)

- Client component usando `react-hook-form` + `zodResolver`.
- 7 blocos (`<section>`) com título em uppercase pequeno + divisor horizontal entre eles.
- Campos usam `MaskedInput` quando aplicável (CPF, CNPJ, CEP, celular).
- `CepInput` próprio (envolver `MaskedInput`) com busca ViaCEP no `onBlur`.
- Dedup CPF: no `onBlur` do campo CPF, se preenchido e válido, chama `/api/freelancers/buscar-por-cpf`. Se achar, mostra banner acima do form com link pra abrir cadastro existente.
- Submit chama server action; se der `fieldErrors`, mapeia pros campos.

### 7. Perfil (`[id]/page.tsx`)

Layout em sequência:
- `BotaoVoltar reserva="/freelancers/lista"`.
- `HeroFreelancer`: avatar com iniciais, nome social (grande), chip da ação prevista, cidade/CPF/email/celular em linha compacta, ações à direita (Editar + Novo contrato desabilitado).
- `AbasPerfil`: três abas estilo tab-link (reutilizar visual da sub-nav do módulo, mas numa escala menor).
- Conteúdo da aba "Dados pessoais": grid de 2 colunas (desktop) com `BlocoInfo` pra Contato / Endereço / PJ / Pagamento / Diversidade. Cada `BlocoInfo` só aparece se tem pelo menos 1 campo preenchido (evita cards vazios feios).
- Conteúdo das abas "Contratos" e "Histórico": placeholder "chega na Fase 2 / Fase 4".

### 8. Loading e not-found

- `[id]/loading.tsx`: skeleton do hero + um bloco cinza.
- `[id]/not-found.tsx`: página 404 amigável com link pra lista.

## Critérios de pronto

- [ ] 11 arquivos novos criados conforme listagem.
- [ ] 3 arquivos modificados.
- [ ] Botão "Novo freelancer" habilitado na lista → leva pra `/freelancers/novo`.
- [ ] Formulário valida nome_social obrigatório, CPF (quando preenchido), CNPJ (quando preenchido), par CNPJ+razão.
- [ ] CEP busca ViaCEP e auto-preenche rua/bairro/cidade.
- [ ] CPF digitado consulta endpoint e, se achar duplicata, mostra banner com link.
- [ ] Submit cria freelancer e redireciona pro perfil.
- [ ] Perfil mostra hero + abas; aba "Dados pessoais" renderiza só os blocos preenchidos.
- [ ] Botão "Editar" leva pra `/freelancers/[id]/editar` com form pré-preenchido.
- [ ] Submit do editar atualiza e volta pro perfil.
- [ ] GP/produtor conseguem ver o perfil (lendo) mas NÃO veem botão de editar nem novo.
- [ ] Audit log registra `freelancer.criado` e `freelancer.editado`.
- [ ] 404 renderiza quando ID inexistente.
- [ ] Sub-nav mantém aba "Freelancers" destacada em todas as rotas internas (`/novo`, `/[id]`, `/[id]/editar`).
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (015)

Fase 2 começa: migration de `freelancer_contratos` + bucket Storage pra arquivos. É a maior task do módulo até aqui — vai habilitar o resto (DOCX, assinado, distrato, status derivado).
