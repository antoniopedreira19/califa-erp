# Task 018 — Freelancers (Fase 2, Task 4): minuta DOCX + upload PDF assinado

## Objetivo

Fechar o fluxo documental da Fase 2:

1. **Geração da minuta DOCX** do contrato pelo RH (via endpoint que roda `docx` + `extenso`).
2. **Upload do PDF assinado** pelo RH/Admin/Financeiro.
3. UI na página do contrato (`/freelancers/contratos/[id]`) com bloco "Arquivos" dedicado:
   - Botão "Gerar minuta DOCX" (ou "Regenerar")
   - Link pra baixar minuta (quando existe)
   - Input de upload pra PDF assinado
   - Link pra baixar assinado (quando existe)

A geração do DOCX reutiliza fielmente o template do AgCaliforniaRH (`lib/contrato-docx.ts` deles), adaptado pros nossos tipos.

## Fora de escopo

- Lista `/freelancers/lista` passando a usar `freelancers_com_status` com badges — **Task 019**.
- 4 cards de análise rápida — Task 019.
- Hero rico no perfil com valor/mês e tempo de vínculo — Task 019 ou 022.
- Distrato — Fase 4 (Task 023).
- Fluxo de solicitação — Fase 3 (Tasks 020–022).

## Decisões travadas

- **DOCX via `docx` npm** (mesma lib do AgCaliforniaRH). Instalado como `docx@^9.11.0`.
- **`extenso@^3.0.0`** já instalado; usa pra escrever o valor por extenso (ex: "cinco mil reais").
- **Minuta é gerada sob demanda**, não automática. Botão "Gerar minuta DOCX" chama endpoint. Isso evita gerar DOCX pra contratos que vão ser editados dezenas de vezes antes do envio.
- **Minuta sobrescreve** a anterior quando regenerada — não guarda versões (overkill pra MVP).
- **Upload do PDF assinado** aceita só `.pdf`. Tamanho máximo 10 MB.
- **PDF assinado também sobrescreve** o anterior. Audit log registra as substituições.
- **Paths no bucket `freelancer-arquivos`**:
  - Minuta: `{tenant_id}/contratos/{contrato_id}/minuta.docx`
  - Assinado: `{tenant_id}/contratos/{contrato_id}/assinado.pdf`
  - Mesma estrutura decidida na Task 015. Sobrescrita natural: Supabase Storage retorna 200 em upsert.
- **Minuta só pode ser gerada** se o freelancer tem **pelo menos nome e CPF** (regra do contrato). Senão o DOCX nasce com `___` em campos obrigatórios. Botão fica desabilitado com tooltip "Preencha pelo menos nome e CPF do freelancer".
- **URLs pra download são assinadas** (`createSignedUrl`), com expiração de 1 hora. Nunca servir URL público direto — buckets são privados.
- **Permissão**: `administrador`, `rh`, `financeiro` geram e sobem. GP/produtor só baixam (leem via RLS).

## Contexto do ponto de partida

### Já pronto

- Tabela `freelancer_contratos` com `minuta_url`, `arquivo_url` nullable (Task 015).
- Bucket `freelancer-arquivos` com RLS (Task 015).
- `extenso@^3.0.0` já em dependências.
- `docx@^9.11.0` acabou de ser adicionado.
- `next.config.js` com `serverComponentsExternalPackages: ["pdfmake", "pdfkit", "docx"]` — docx entra na lista.
- Página `/freelancers/contratos/[id]` com form (Task 017) — precisa adicionar bloco Arquivos acima do form.

### Pontos de atenção

- `docx` é Node-only — rodar só em route handlers (`/app/api`).
- O template do AgCaliforniaRH (`lib/contrato-docx.ts`) usa helpers que precisam vir junto (`meseseDias`, `composeEndereco`, `UF_POR_CIDADE`). Vou verificar se existem no `califa-erp/lib/utils.ts`; se não, criar inline.
- O `extenso` do AgCaliforniaRH é `v2`; aqui tem `v3`. API é compatível pra `mode: "currency"` mas vou validar na implementação.
- Upload com FormData multipart — route handler aceita diretamente.
- Audit: `freelancer_contrato.minuta_gerada`, `freelancer_contrato.assinado_enviado` em `lib/auth/audit.ts`.

## Escopo

### 1. Arquivos novos

```
lib/freelancer-contrato-docx.ts            # Gera DOCX do contrato
app/api/freelancers/contratos/[id]/
├── gerar-minuta/route.ts                  # POST: gera DOCX, upload, grava minuta_url
├── enviar-assinado/route.ts               # POST multipart: upload PDF, grava arquivo_url
└── baixar/[tipo]/route.ts                 # GET: signed URL pra minuta ou assinado
app/(app)/freelancers/contratos/_components/
└── bloco-arquivos.tsx                     # Client component com botões/inputs
```

### 2. Arquivos modificados

- `app/(app)/freelancers/contratos/[id]/page.tsx` — renderiza `<BlocoArquivos />` acima do form.
- `lib/auth/audit.ts` — 2 valores novos.
- `lib/utils.ts` — adicionar `meseseDias` e `composeEndereco` se não existirem. `UF_POR_CIDADE` em `lib/types.ts` se não existir.
- `next.config.js` — já atualizado com `docx` em serverComponentsExternalPackages.

### 3. UI do bloco Arquivos

```
┌─ Arquivos ────────────────────────────────┐
│                                           │
│  Minuta (DOCX)                            │
│  [Gerar minuta]  [Baixar]  (ou "Nenhuma  │
│                               gerada")    │
│                                           │
│  Assinado (PDF)                           │
│  [Escolher arquivo]  [Baixar]            │
└───────────────────────────────────────────┘
```

Fica num card compacto. Botões ganham estado de pending via `useTransition`.

### 4. Lógica das rotas

#### POST `/api/freelancers/contratos/[id]/gerar-minuta`
- requireSession, podeEscrever.
- Busca contrato + freelancer. Valida que freelancer tem nome + CPF.
- Chama `gerarFreelancerContratoDocx({ freelancer, contrato })` → Buffer.
- Upload no Storage em `{tenant_id}/contratos/{contrato_id}/minuta.docx` com `upsert: true`.
- UPDATE `freelancer_contratos.minuta_url` com path.
- Audit `freelancer_contrato.minuta_gerada`.
- Retorna JSON `{ ok: true, path }`.

#### POST `/api/freelancers/contratos/[id]/enviar-assinado`
- Multipart form: arquivo PDF.
- requireSession, podeEscrever.
- Valida: `application/pdf`, ≤ 10 MB.
- Upload no Storage em `{tenant_id}/contratos/{contrato_id}/assinado.pdf` com `upsert: true`.
- UPDATE `freelancer_contratos.arquivo_url`.
- Audit `freelancer_contrato.assinado_enviado`.
- Retorna `{ ok: true, path }`.

#### GET `/api/freelancers/contratos/[id]/baixar/[tipo]`
- `tipo` ∈ (`minuta`, `assinado`).
- requireSession + is_tenant_member (RLS do bucket cobre).
- Resolve path a partir do contrato.
- `createSignedUrl` com 60 min de validade.
- Redirect pro URL assinado.

## Critérios de pronto

- [ ] 4 arquivos novos criados.
- [ ] Página do contrato mostra bloco Arquivos acima do form.
- [ ] "Gerar minuta DOCX" desabilitado se faltar nome ou CPF do freela; ativo caso contrário.
- [ ] Clique → DOCX gerado, upload no bucket, `minuta_url` populado, botão "Baixar" aparece.
- [ ] Upload de PDF assinado funciona; `arquivo_url` populado; botão "Baixar" aparece.
- [ ] Baixar minuta e assinado funciona (URL assinado).
- [ ] GP/produtor **conseguem baixar** mas **não veem botões de gerar/subir**.
- [ ] Audit log em ambas as ações.
- [ ] `npm run typecheck` passa.
- [ ] `npm run lint` passa.

## Próxima task (019)

Lista com status: `/freelancers/lista` passa a consumir `freelancers_com_status`, mostra colunas Cargo e Status com badges, 4 cards de análise rápida no topo (Na ativa / Em dia / Irregular / Encerrados), chips de status (além dos de ação prevista).
