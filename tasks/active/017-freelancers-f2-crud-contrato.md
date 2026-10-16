# Task 017 — Freelancers (Fase 2, Task 3): CRUD de contrato (dados, sem arquivos)

## Objetivo

Entregar as telas de criação e edição de **contrato de freelancer**, só com os dados. Nenhum anexo, nenhuma geração de DOCX, nenhum upload — tudo isso vem na Task 018.

Entregas:

1. `/freelancers/contratos/novo` com formulário completo (pré-seleção opcional de freelancer via `?freelancer=<id>`).
2. `/freelancers/contratos/[id]` pra editar dados.
3. Aba **Contratos** no perfil do freelancer preenchida com a lista real.
4. Botão **"Novo contrato"** no perfil ativo (vai pra `/freelancers/contratos/novo?freelancer=<id>`).
5. Server actions `criarFreelancerContrato` e `atualizarFreelancerContrato`.
6. Pickers compartilhados: Job, Responsável, Cargo.

## Fora de escopo

- **Minuta DOCX** (botão "Gerar minuta DOCX") — Task 018.
- **Upload do PDF assinado** — Task 018.
- **Distrato** (solicitar, gerar minuta, upload do assinado, aplicar antecipação) — Fase 4.
- Lista `/freelancers/lista` passando a usar a view com status + cargo + 4 cards de análise — Task 018.
- Hero rico com valor/mês e tempo de vínculo no perfil — pode entrar aqui ou na Task 018.

## Decisões travadas

- **Form de contrato não cria freelancer**. Se o usuário acessar `/freelancers/contratos/novo` sem `?freelancer=<id>`, aparece um picker de freelancer existente no topo do form. Cadastro de freelancer é fluxo separado (Task 014). Isso evita um "mega form" que faz tudo e desencoraja duplicata.
- **Freelancer pré-selecionado via query string** (`?freelancer=<id>`): quando o usuário clica em "Novo contrato" dentro do perfil, o form já vem com freelancer travado (readonly). Botão "Trocar freelancer" permite voltar atrás.
- **Job é obrigatório** no banco quando `origem_sistema='califa_erp'` (check constraint da Task 015). UI sempre força o preenchimento — não existe caminho de criar contrato novo sem job.
- **Jobs disponíveis no picker**: todos do tenant exceto `status in ('cancelado','rejeitado_financeiro')`. Status "finalizado" permanece visível porque permite contratar freela retroativo pra um job que fechou (importar legado, por exemplo).
- **Responsável** vem de `profiles` com role in {`administrador`, `rh`, `financeiro`, `gerente_producao`, `produtor`}. Filtragem é feita na query do server component que carrega o form — não é um dropdown aberto a qualquer usuário.
- **Cargo** vem de `freelancer_cargos` ativos. Combobox tem busca; se o cargo não está na lista, usuário precisa criar via dialog "Gerenciar cargos" na aba Freelancers. Não permitir texto livre nesta task — mantém o catálogo útil.
- **Valor** é obrigatório, mínimo 0. UI usa `MoneyInput` existente.
- **Datas**: início e término opcionais (permite stub). Validação: término ≥ início (check no banco também).
- **Tipo** (mensal/periodo/diarias) obrigatório — controla a redação do DOCX, mesmo que o DOCX só venha na Task 018.
- **Observações**: textarea livre.
- **Status_real** não aparece no form de novo contrato — nasce com `true` default. Edição pode trocar via toggle no perfil do contrato (ou em Fase 4 via botão "Encerrar").
- **nome_job** é snapshot: preenchido automaticamente a partir do job escolhido no momento do submit. Não editável pelo usuário — se trocar o job, o nome_job acompanha. Em editar, se trocar o job, nome_job atualiza também.
- **origem_sistema** sempre `'califa_erp'` em contratos criados pelo form. Legados vêm pela Fase 5.

## Contexto do ponto de partida

### Já pronto

- Tabela `freelancer_contratos` com constraints, RLS, bucket Storage (Task 015).
- View `freelancers_com_status` que já traz dados do contrato ativo (Task 016).
- Catálogo `freelancer_cargos` com 65 cargos seed + dialog de CRUD (Task 013).
- Perfil `/freelancers/[id]` com aba Contratos como placeholder (Task 014).
- Botão "Novo contrato" no hero do perfil, hoje desabilitado (Task 014).
- `Combobox` reusável (`components/ui/combobox.tsx`).
- `MoneyInput`, `DatePicker` em `components/ui`.

### Novo que precisa nascer

- `JobPicker` (combobox com busca por nome + código do job).
- `ResponsavelPicker` (combobox com nome + email do responsável, filtrado por role).
- `CargoPicker` (combobox com nome do cargo + mensagem "Não achou? Vá na aba Freelancers → Gerenciar cargos").
- `ContratoForm` client component.
- Server actions pra criar/atualizar contrato.
- Spec de validação Zod em `lib/validations/freelancer-contratos.ts`.

### Pontos de atenção

- `jobs.tenant_id` restringe visibilidade — a query do server component filtra por tenant ativo.
- `profiles` não tem FK direto pra `tenant_members`; preciso fazer join com `tenant_members` pra filtrar os profiles do tenant ativo.
- Reaproveitar `AcaoPrevistaBadge` não serve (status é outro conceito); criar `StatusBadge` entra na Task 018, não aqui.
- Audit: `freelancer_contrato.criado` e `freelancer_contrato.editado` em `lib/auth/audit.ts`.

## Escopo

### 1. Arquivos novos

```
lib/validations/freelancer-contratos.ts

app/(app)/freelancers/_components/
├── job-picker.tsx                    # Combobox de job
├── responsavel-picker.tsx            # Combobox de usuário
└── cargo-picker.tsx                  # Combobox de cargo

app/(app)/freelancers/contratos/
├── novo/
│   └── page.tsx                      # Server: carrega opções, renderiza form
├── [id]/
│   ├── page.tsx                      # Server: carrega contrato + opções
│   ├── loading.tsx
│   └── not-found.tsx
└── _components/
    ├── contrato-form.tsx             # Client: form controlado
    └── contratos-do-freelancer.tsx   # Server: lista no perfil

app/(app)/freelancers/contratos/actions.ts  # Server actions
```

### 2. Arquivos modificados

- `app/(app)/freelancers/[id]/page.tsx` — a aba "Contratos" passa a renderizar `<ContratosDoFreelancer freelancerId={...} />` em vez do placeholder.
- `app/(app)/freelancers/_components/hero-freelancer.tsx` — botão "Novo contrato" vira `<Link>` ativo com href `/freelancers/contratos/novo?freelancer=<id>`.
- `app/(app)/freelancers/_components/abas-perfil.tsx` — aceita `contratos` como prop (não mais placeholder fixo).
- `lib/auth/audit.ts` — adicionar `freelancer_contrato.criado`, `freelancer_contrato.editado`.
- `app/(app)/freelancers/_components/sub-nav.tsx` — garantir que a aba "Freelancers" acende em `/freelancers/contratos/*`.

### 3. Validation (Zod)

```ts
// lib/validations/freelancer-contratos.ts
export const contratoSchema = z.object({
  freelancer_id: z.string().uuid(),
  job_id: z.string().uuid({ message: "Escolha um job" }),
  responsavel_id: z.string().uuid().nullable().optional().or(z.literal("")),
  cargo: z.string().min(2).max(100).nullable().optional().or(z.literal("")),
  tipo: z.enum(["mensal", "periodo", "diarias"]),
  valor: z.coerce.number().min(0, { message: "Valor deve ser positivo" }),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("")),
  data_termino: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("")),
  cidade: z.string().max(100).nullable().optional().or(z.literal("")),
  observacoes: z.string().max(1000).nullable().optional().or(z.literal("")),
}).refine(
  (v) => !v.data_inicio || !v.data_termino || v.data_termino >= v.data_inicio,
  { message: "Data de término deve ser igual ou posterior à data de início", path: ["data_termino"] }
);
```

### 4. Server actions

- `criarFreelancerContrato(formData: FormData): Promise<ActionResult<{ id: string }>>`
  - requireSession
  - podeEscrever (admin/rh/financeiro)
  - Zod parse
  - Busca `job.nome` a partir do `job_id` → `nome_job` snapshot
  - INSERT com `tenant_id`, `origem_sistema='califa_erp'`, `created_by`
  - Audit log `freelancer_contrato.criado`
  - revalidatePath `/freelancers/[freelancer_id]` + `/freelancers/lista`
  - redirect pro `/freelancers/contratos/[id]` novo (ou volta pro perfil do freela)
- `atualizarFreelancerContrato(id: string, formData: FormData): Promise<ActionResult>`
  - idem acima mas UPDATE
  - Se `job_id` mudou, re-sync `nome_job`
  - revalidatePath

### 5. Novos picker components

Cada picker é um client component wrapper do `Combobox`:

- **JobPicker**: `{ items: Array<{ id, codigo, nome }>; value; onChange }`. Items vêm pré-carregados do server (não busca dinâmica — jobs do tenant cabem em 1 request pra tela).
- **ResponsavelPicker**: `{ items: Array<{ id, nome, email, role }>; value; onChange }`.
- **CargoPicker**: `{ items: Array<FreelancerCargo>; value; onChange }`. Nota no footer da lista: "Não achou? Vá em Freelancers → Gerenciar cargos".

### 6. UI do form

Container `max-w-3xl`, seções:

1. **Freelancer** (readonly se veio por `?freelancer=`, com link "Trocar"; combobox senão).
2. **Job** (JobPicker obrigatório; mostra código e nome).
3. **Dados do contrato**: cargo (CargoPicker), tipo (radio ou select), valor (MoneyInput), data_inicio, data_termino, cidade.
4. **Responsável** (ResponsavelPicker).
5. **Observações** (textarea).

Rodapé: Cancelar + Salvar.

### 7. Lista de contratos no perfil

Componente `ContratosDoFreelancer` server que:
- Busca contratos do freelancer ordenados por data_inicio DESC.
- Renderiza tabela compacta ou lista de cards com: nome_job (do contrato ou do job), código do job, cargo, valor + tipo, data_inicio → data_termino, status_real (badge), link "Abrir".
- Empty state: "Nenhum contrato ainda. Clique em Novo contrato pra começar."

## Critérios de pronto

- [ ] Pasta `app/(app)/freelancers/contratos/` com 4+ arquivos de page/loading/not-found.
- [ ] 3 pickers novos em `_components/`.
- [ ] `ContratoForm` client component.
- [ ] Server actions criadas.
- [ ] Validation Zod no lugar.
- [ ] Botão "Novo contrato" no perfil ativo e levando pra rota com `?freelancer=`.
- [ ] Aba Contratos do perfil mostra lista real (empty state quando vazio).
- [ ] Audit log `freelancer_contrato.criado` e `freelancer_contrato.editado`.
- [ ] Sub-nav mantém "Freelancers" ativo em `/freelancers/contratos/*`.
- [ ] GP/produtor NÃO veem botão "Novo contrato" nem conseguem submeter (RLS trava INSERT).
- [ ] Criar + editar contrato funciona, incluindo quando trocar job (nome_job snapshot atualiza).
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (018)

Minuta DOCX + upload do PDF assinado + Lista com badges de status + 4 cards de análise rápida.
