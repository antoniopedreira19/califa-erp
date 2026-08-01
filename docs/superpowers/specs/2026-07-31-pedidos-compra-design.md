# Pedido de Compra — Geração + Cancelamento (Fase 1)

**Data**: 2026-07-31
**Status**: Aprovado, aguardando plano de implementação
**Antecessores**: Task 008 (Realizado), Task 009 (Empresas), Task fornecedor-dados-completos

## Objetivo

Entregar a primeira parte do fluxo financeiro operacional: a partir de um item com realizado lançado no job, gerar um Pedido de Compra (PP) formal com PDF impresso, anexos obrigatórios (NF/recibo/comprovante) e cancelamento simples (hard delete). Prepara terreno pra "Caixa de Entrada de PPs" no financeiro, que fica pra fase 2.

## Decisões chave

### Cardinalidade e modelagem

- **1:1 entre item_realizado e PP** — cada linha da planilha do realizado gera no máximo uma PP. Se precisar dividir custo entre fornecedores (split), a solução hoje é lançar múltiplas linhas de realizado no mesmo item na versão. Split real (1 realizado → N PPs) fica pra fase futura se surgir necessidade.
- **`fornecedor_id` no `jobs_itens_realizado`** — quando a PP é gerada, o realizado "aprende" quem é o fornecedor. Se a PP for cancelada, o campo volta pra `null`.
- **Sem coluna `status`** por agora — cancelar = **hard delete** (row + PDF + anexos). Fase 2 (fluxo financeiro) reintroduz status quando entrarem os estados `aprovada`/`baixada`/`reprovada`.
- **Snapshot dos dados** — `servico`, `valor`, `quantidade`, `especificacoes` são gravados no momento da emissão. Se o realizado mudar depois, a PP não muda (PP é documento formal, imutável até cancelamento).

### Código do PP

- Formato `PP-NNNNN` (5 dígitos), **sequencial por tenant**.
- Gerado por função Postgres com `SELECT ... FOR UPDATE` pra evitar race conditions em geração concorrente.

### Permissões

Mesma regra do editar realizado (Task 008): **admin** ou **responsável do job** (`job.responsavel_id = auth.uid()`). Outros roles: botão não aparece e server action rejeita com `audit.acao_negada`.

### Status editável do job

PP pode ser gerada/cancelada apenas quando `job.status ∈ {aberto, em_producao}`. Bloqueada em `finalizado`, `cancelado`, `aguardando_abertura`, `rejeitado_financeiro`.

### PDF

- Biblioteca **`pdfmake`** — puramente JS, serverless-friendly, tabelas nativas, rock-solid em produção brasileira. Descartado `puppeteer` (Chrome no Vercel = cold start pesado) e `@react-pdf/renderer` (JSX mais verbose pra layouts formais com faixas/borders).
- Logo California embed do `public/brand/logo-icon.png` como base64.
- Fonte: Helvetica (default do pdfmake), sem custom fonts pra manter o bundle enxuto.

### Anexos

- **Múltiplos anexos, obrigatório ≥ 1** no ato de gerar.
- Tipos aceitos: PDF + imagem (JPEG/PNG/WEBP).
- **8 MB por arquivo, 25 MB total por PP** — folga pra NF-e (~500KB) + comprovante fotográfico (~3 MB) sem estourar limites.

## Componentes da entrega

### 1. Migration `20260731000003_task010_pedidos_compra.sql`

```sql
-- =====================================================================
-- Task 010 fase 1 — Pedidos de Compra (emissão + cancelamento)
-- Ver spec: docs/superpowers/specs/2026-07-31-pedidos-compra-design.md
-- =====================================================================

-- 1. jobs_itens_realizado ganha fornecedor_id
alter table public.jobs_itens_realizado
  add column if not exists fornecedor_id uuid
    references public.fornecedores(id) on delete restrict;

create index if not exists idx_realizado_fornecedor
  on public.jobs_itens_realizado(fornecedor_id);

-- 2. pedidos_compra (1:1 com item_realizado)
create table if not exists public.pedidos_compra (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  codigo                text not null,

  -- vinculos
  item_realizado_id     uuid not null references public.jobs_itens_realizado(id) on delete restrict,
  job_id                uuid not null references public.jobs(id) on delete restrict,
  fornecedor_id         uuid not null references public.fornecedores(id) on delete restrict,
  empresa_id            uuid not null references public.empresas(id) on delete restrict,

  -- snapshot dos dados no momento da emissao
  servico               text not null,
  quantidade            numeric(12,3) not null,
  especificacoes        text,
  valor                 numeric(14,2) not null,
  prazo_pagamento       date not null,

  -- artefato
  pdf_path              text not null,

  -- auditoria
  emitida_por           uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uniq_pp_por_item_realizado unique (item_realizado_id),
  constraint uniq_pp_codigo_por_tenant  unique (tenant_id, codigo),
  constraint pp_servico_nao_vazio       check (length(trim(servico)) > 0),
  constraint pp_quantidade_positiva     check (quantidade > 0),
  constraint pp_valor_positivo          check (valor > 0)
);

create index if not exists idx_pp_tenant on public.pedidos_compra(tenant_id);
create index if not exists idx_pp_job on public.pedidos_compra(job_id);
create index if not exists idx_pp_fornecedor on public.pedidos_compra(fornecedor_id);
create index if not exists idx_pp_empresa on public.pedidos_compra(empresa_id);

drop trigger if exists trg_pp_updated_at on public.pedidos_compra;
create trigger trg_pp_updated_at
before update on public.pedidos_compra
for each row execute function public.set_updated_at();

-- 3. Anexos (N por PP)
create table if not exists public.pedidos_compra_anexos (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete restrict,
  pedido_compra_id      uuid not null references public.pedidos_compra(id) on delete cascade,
  arquivo_path          text not null,
  arquivo_nome_original text not null,
  arquivo_tamanho_bytes bigint not null,
  arquivo_mimetype      text not null,
  created_by            uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint anexo_tamanho_positivo check (arquivo_tamanho_bytes > 0)
);

create index if not exists idx_pp_anexos_pp on public.pedidos_compra_anexos(pedido_compra_id);
create index if not exists idx_pp_anexos_tenant on public.pedidos_compra_anexos(tenant_id);

-- 4. RLS + GRANTs
alter table public.pedidos_compra enable row level security;
alter table public.pedidos_compra_anexos enable row level security;

create policy pp_select on public.pedidos_compra
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy pp_insert on public.pedidos_compra
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy pp_update on public.pedidos_compra
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy pp_delete on public.pedidos_compra
  for delete to authenticated using (public.is_tenant_member(tenant_id));

create policy pp_anexos_select on public.pedidos_compra_anexos
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy pp_anexos_insert on public.pedidos_compra_anexos
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy pp_anexos_delete on public.pedidos_compra_anexos
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.pedidos_compra to authenticated;
grant select, insert, delete on public.pedidos_compra_anexos to authenticated;

-- 5. Bucket privado + policies em storage.objects
insert into storage.buckets (id, name, public)
values ('pedidos-compra', 'pedidos-compra', false)
on conflict (id) do nothing;

-- Policies: usuario so ve/escreve arquivos com prefix path do tenant do qual e membro
drop policy if exists pp_storage_select on storage.objects;
create policy pp_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists pp_storage_insert on storage.objects;
create policy pp_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

drop policy if exists pp_storage_delete on storage.objects;
create policy pp_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pedidos-compra'
    and public.is_tenant_member((split_part(name, '/', 1))::uuid)
  );

-- 6. Sequencial PP-NNNNN por tenant (funcao com lock)
create or replace function public.gerar_codigo_pp(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prox integer;
  v_codigo text;
begin
  -- Lock advisory por tenant pra serializar geracoes concorrentes.
  perform pg_advisory_xact_lock(hashtext('pp_seq_' || p_tenant_id::text));

  select coalesce(max(cast(substring(codigo from '^PP-(\d+)$') as integer)), 0) + 1
    into v_prox
    from public.pedidos_compra
    where tenant_id = p_tenant_id
      and codigo ~ '^PP-\d+$';

  v_codigo := 'PP-' || lpad(v_prox::text, 5, '0');
  return v_codigo;
end;
$$;

grant execute on function public.gerar_codigo_pp(uuid) to authenticated;
```

### 2. Types em `lib/types.ts`

```ts
export interface PedidoCompra {
  id: string;
  tenant_id: string;
  codigo: string;                    // PP-NNNNN
  item_realizado_id: string;
  job_id: string;
  fornecedor_id: string;
  empresa_id: string;
  servico: string;
  quantidade: number;
  especificacoes: string | null;
  valor: number;
  prazo_pagamento: string;           // ISO date
  pdf_path: string;
  emitida_por: string | null;
  created_at: string;
  updated_at: string;
}

export interface PedidoCompraAnexo {
  id: string;
  tenant_id: string;
  pedido_compra_id: string;
  arquivo_path: string;
  arquivo_nome_original: string;
  arquivo_tamanho_bytes: number;
  arquivo_mimetype: string;
  created_by: string | null;
  created_at: string;
}

export const PP_ANEXO_MIMETYPES_ACEITOS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const PP_ANEXO_TAMANHO_MAX_BYTES = 8 * 1024 * 1024;     // 8 MB
export const PP_ANEXOS_TAMANHO_TOTAL_MAX_BYTES = 25 * 1024 * 1024;  // 25 MB
```

### 3. Auditoria — `lib/auth/audit.ts`

Adicionar 2 actions ao union `AuditAction`:
- `pedido_compra.emitida` — metadata `{ pp_codigo, valor, fornecedor_id, item_realizado_id, job_id }`
- `pedido_compra.cancelada` — metadata `{ pp_codigo, item_realizado_id, job_id }`

### 4. Helper — `lib/codigos/pedidos-compra.ts`

```ts
export async function gerarCodigoPP(supabase: SupabaseClient, tenantId: string): Promise<string> {
  const { data, error } = await supabase.rpc("gerar_codigo_pp", { p_tenant_id: tenantId });
  if (error) throw new Error(`Falha ao gerar codigo PP: ${error.message}`);
  return data as string;
}
```

### 5. Server actions — `app/(app)/jobs/[jobId]/realizado/actions-pp.ts`

```ts
// Fase 1 (client upload direto pro bucket precisa saber onde escrever)
reservarPedidoCompra(itemRealizadoId) → { ok: true, pp_id, upload_prefix } | { ok: false, message }

// Fase 2 (client já uploadeou anexos direto pro bucket; envia metadata)
finalizarPedidoCompra(pp_id, dados, anexos_uploaded) → { ok: true, codigo } | { ok: false, message }

cancelarPedidoCompra(ppId)              → { ok: true } | { ok: false, message }
signedUrlPdf(ppId)                      → { ok: true, url } | { ok: false, message }
signedUrlAnexo(anexoId)                  → { ok: true, url } | { ok: false, message }
```

**Por que 2 fases?** Anexos podem somar 25 MB, e o body de server actions no Vercel é limitado a 4.5 MB. Solução: client faz upload direto pro Supabase Storage (via `supabase.storage.from().upload()` do lado cliente), autorizado por RLS no `storage.objects`. A server action nunca vê os bytes dos arquivos — só os paths já persistidos.

**Fluxo detalhado `reservarPedidoCompra(itemRealizadoId)`:**

1. `requireSession()`.
2. Load `item_realizado` + join `job` filtrado por tenant. Se não existe → erro.
3. Gate status do job: `∈ {aberto, em_producao}`. Se não → `acao_negada` + erro.
4. Gate ownership: admin OR responsável do job. Se não → `acao_negada` + erro.
5. Reject se `total_realizado === 0`.
6. Reject se PP já existe pro item.
7. Reserva `pp_id = crypto.randomUUID()` (não persiste no DB ainda — só devolve).
8. Return `{ ok: true, pp_id, upload_prefix: "${tenant_id}/${job_id}/${pp_id}/anexos/" }`.

**Fluxo detalhado `finalizarPedidoCompra(pp_id, dados, anexos_uploaded)`:**

Client já subiu N arquivos pra `${tenant}/${job}/${pp_id}/anexos/${anexo_id}-${nome}`. Envia array `anexos_uploaded: [{anexo_id, path, nome_original, tamanho_bytes, mimetype}]`.

1. `requireSession()` + ownership + status check (repete gates — defense in depth).
2. Zod validate `dados` (fornecedor, empresa, prazo, serviço, quantidade, especificações).
3. Zod validate `anexos_uploaded`:
   - array ≥ 1
   - cada path começa com `${tenant_id}/${job_id}/${pp_id}/anexos/`
   - cada mimetype ∈ `PP_ANEXO_MIMETYPES_ACEITOS`
   - cada tamanho ≤ 8 MB
   - soma ≤ 25 MB
4. Verifica que cada arquivo REALMENTE existe no bucket (`supabase.storage.from('pedidos-compra').list(prefix)`) — evita metadata forjada.
5. `gerarCodigoPP(supabase, tenantId)` → `PP-NNNNN`.
6. INSERT `pedidos_compra` com o `pp_id` reservado, `pdf_path = ''` placeholder.
7. INSERT bulk em `pedidos_compra_anexos`.
8. Carrega dados enriquecidos (`empresa`, `fornecedor`, `job`, `projeto`, `orcamento`, `cliente`, `responsavelNome`).
9. `renderPedidoCompraPDF({...})` → `Buffer`.
10. Upload PDF → `${tenant}/${job}/${pp_id}/pp-${codigo}.pdf` (server-side, tamanho pequeno).
11. UPDATE `pedidos_compra.pdf_path`.
12. UPDATE `jobs_itens_realizado.fornecedor_id`.
13. Audit `pedido_compra.emitida`.
14. `revalidatePath("/jobs/${jobId}")`.
15. Return `{ ok: true, codigo }`.

**Rollback em falha no `finalizar`:**
- Se render PDF falhar → DELETE row `pedidos_compra` (cascade limpa anexos) + `storage.remove([...anexos_paths])` + (não subiu PDF ainda).
- Se upload PDF falhar → DELETE row + limpa anexos do bucket.
- Se UPDATE pdf_path falhar → DELETE PDF + row.
- Se anexos_uploaded veio adulterado (paths não existem no bucket) → erro sem persistir nada.

**"Reservar" sem persistir cria arquivos órfãos se o user fechar o drawer?** Sim. Mitigação:
- Client acumula uploads durante a sessão do drawer; se user fecha sem finalizar, tem uma **função de limpeza** que roda no `useEffect` cleanup do drawer chamando `abortarReserva(pp_id)` — server action que apenas roda `storage.remove(prefix)` recursivamente. Best-effort (se o browser fechar antes, os órfãos ficam).
- Job diário (fase 2, não agora) faz garbage collection de arquivos com > 24h sem row correspondente. Fica registrado como dívida técnica.

**Fluxo `cancelarPedidoCompra`:**

1. `requireSession()` — autenticado.
2. Load `item_realizado` + join `job` (`select ... jobs!inner(...)`) filtrado por tenant. Se não existe → erro.
3. Gate de status do job: `job.status ∈ {aberto, em_producao}`. Se não, `acao_negada` audit + erro.
4. Gate de ownership: `activeRole === 'administrador' OR job.responsavel_id === session.profile.id`. Se não, `acao_negada` audit + erro.
5. Reject se `total_realizado === 0`.
6. Reject se PP já existe (unique constraint pega, mas checa antes pra mensagem amigável).
7. Zod validate formData:
   - `fornecedor_id` uuid obrigatório, pertence ao tenant, `status = 'ativo'`
   - `empresa_id` uuid obrigatório, pertence ao tenant, `ativo = true`
   - `prazo_pagamento` ISO date, ≥ hoje
   - `servico` texto não vazio (max 500)
   - `quantidade` numeric > 0
   - `especificacoes` opcional (max 2000)
   - `anexos` array ≥ 1, cada arquivo com mimetype e size validados; soma ≤ 25 MB
8. Chama `gerarCodigoPP(supabase, tenantId)` → `PP-NNNNN`.
9. INSERT `pedidos_compra` (pdf_path = `''` placeholder).
10. Upload dos anexos → `pedidos-compra/{tenant}/{job}/{pp_id}/anexos/{anexo_id}-{sanitized_name}`. Nomes sanitizados (regex `/[^a-zA-Z0-9._-]/g` → `_`).
11. INSERT bulk em `pedidos_compra_anexos`.
12. Carrega dados enriquecidos pro PDF: `empresa`, `fornecedor`, `job` (com `responsavel:profiles`), `projeto` (com `cliente`), `orcamento`.
13. Chama `renderPedidoCompraPDF({...})` → `Buffer`.
14. Upload PDF → `pedidos-compra/{tenant}/{job}/{pp_id}/pp-{codigo}.pdf`.
15. UPDATE `pedidos_compra.pdf_path`.
16. UPDATE `jobs_itens_realizado.fornecedor_id`.
17. Audit `pedido_compra.emitida`.
18. `revalidatePath("/jobs/${jobId}")`.
19. Return `{ ok: true, pp_id, codigo }`.

**Rollback em caso de falha após INSERT** (importante — DB não é transacional com Storage):
- Se upload de anexo falhar → deletar row `pedidos_compra` + qualquer anexo já subido.
- Se render PDF falhar → deletar row + anexos + arquivos do bucket.
- Se update de path falhar → mesma coisa.
- Sempre limpa tudo em caso de erro, retorna mensagem com contexto.

**Fluxo `cancelarPedidoCompra`:**
1. Session + ownership check.
2. Load PP + anexos filtrado por tenant.
3. Gate status do job (mesma regra).
4. Coletar todos os paths (PDF + N anexos).
5. `supabase.storage.from('pedidos-compra').remove([...paths])`.
6. DELETE `pedidos_compra` (cascade limpa anexos).
7. UPDATE `jobs_itens_realizado.fornecedor_id = null` no mesmo tenant.
8. Audit `pedido_compra.cancelada`.
9. Revalidate.

**`signedUrlPdf` / `signedUrlAnexo`:**
- Session + ownership check (qualquer membro do tenant que vê o job pode baixar).
- Load do path via id.
- `supabase.storage.from('pedidos-compra').createSignedUrl(path, 3600)` → 1h TTL.
- Return URL.

### 6. UI — extensão de `job-item-realizado-table.tsx`

**Adicionar trilha lateral fora do card** (mesmo padrão do `itens-table.tsx` da versão):

- `<div ref={wrapperRef} className="relative">` já envolve a tabela; adicionar `<div className="absolute left-full ml-2">` com os ícones.
- `React.useLayoutEffect` mede o topo do `<tbody>` pra alinhar a trilha.
- Cada linha renderiza um `<PPActionsCell>` com 3 estados possíveis (Nenhum / Gerar / Ver+Cancelar).

**Novo componente `pp-actions-cell.tsx`:**

```tsx
interface Props {
  itemRealizadoId: string;
  totalRealizado: number;
  pp: PedidoCompra | null;
  editable: boolean;
}
```

- Se `totalRealizado === 0` → renderiza `<div className="h-9" />` (mantém altura, sem ícones).
- Se `!pp` E `editable` → botão `<FilePlus>` que abre `<GerarPPDrawer>`.
- Se `pp` → 2 botões: `<Eye>` (abre signed URL do PDF em nova aba) + `<Trash2>` (com `ConfirmDialog` "Cancelar PP?" — action = `cancelarPedidoCompra`).
- Read-only (`!editable`): mostra só `<Eye>` se `pp` existe, senão nada.

**Passar `pp` do server component:**
- Em `page.tsx`, adicionar query pro `Promise.all` novo:
  ```ts
  supabase.from("pedidos_compra").select("*, anexos:pedidos_compra_anexos(id, arquivo_nome_original)")
    .eq("job_id", raw.id)
    .eq("tenant_id", session.activeTenant.id)
  ```
- Montar `Map<item_realizado_id, PedidoCompra>` e passar pra `<JobRealizadoSection>` → `<JobGrupoCard>` → `<JobItemRealizadoTable>`.

### 7. UI — Drawer `gerar-pp-drawer.tsx`

Client component. Estrutura:

```
DrawerContent
  DialogHeader: "Gerar Pedido de Compra"
  Body (form):
    Read-only header:
      Item: {item.item}
      Valor realizado: R$ X
    Section "Fornecedor & Empresa":
      Select fornecedor (busca por nome, filtra ativos)
      Select empresa (default = job.empresa_id)
      DatePicker prazo_pagamento (default = hoje + 15 dias, min = hoje)
    Section "Serviço":
      Input servico (default = item.item, obrigatório)
      Input quantidade (default = item.quantidade_realizada, decimal)
      Textarea especificacoes (opcional)
    Section "Anexos":
      DropZone com file picker (multiple, accept="application/pdf,image/*")
      Lista de anexos selecionados (nome + tamanho + botão X)
      Validação inline: mimetype + tamanho por arquivo + soma total
    Botões: Cancelar (fecha drawer) | Gerar PP (submit)
```

Componentes reutilizáveis: `<Select>` (Radix, sentinel `__none__` proibido pra fornecedor/empresa que são obrigatórios), `<DatePicker>` (padrão do projeto: `side="bottom"`, `avoidCollisions={false}`, `w-[300px]`, `<Calendar fixedWeeks>`).

**Upload de anexos (2 fases):**
1. Ao abrir drawer: chama `reservarPedidoCompra(itemRealizadoId)` → recebe `pp_id` + `upload_prefix`.
2. Cada arquivo selecionado: `supabase.storage.from('pedidos-compra').upload(upload_prefix + anexo_id + '-' + sanitized_name, file, { upsert: false })` direto do cliente. Barra de progresso opcional.
3. Client valida MIME e tamanho **antes do upload** (evita subir arquivo grande que server vai rejeitar).
4. Ao clicar "Gerar PP": chama `finalizarPedidoCompra(pp_id, dados_form, anexos_uploaded[])`.
5. Se user fechar drawer antes de finalizar: cleanup do `useEffect` chama `abortarReserva(pp_id)` (best-effort).

**Adiciona ação `abortarReserva(pp_id)`** ao arquivo `actions-pp.ts` — apenas remove tudo do bucket sob o prefix. Não afeta DB (nada foi persistido).

**Estado de submit**: `useTransition` + botão desabilitado enquanto pending; barra de progresso opcional pra uploads (nice-to-have, MVP sem).

**Fechamento**: após `{ ok: true }`, drawer fecha, `router.refresh()`.

### 8. Renderizador de PDF — `lib/pdf/pedido-compra.ts`

```ts
export async function renderPedidoCompraPDF(dados: {
  pp: Pick<PedidoCompra, "codigo" | "servico" | "quantidade" | "especificacoes" | "valor" | "prazo_pagamento" | "created_at">;
  empresa: Empresa;
  fornecedor: Fornecedor;
  job: Pick<Job, "nome" | "produto">;
  projeto: Pick<Projeto, "codigo">;
  orcamento: Pick<Orcamento, "codigo">;
  cliente: Pick<Cliente, "nome_fantasia">;
  responsavelNome: string;
}): Promise<Buffer>
```

**Estrutura pdfmake (docDefinition):**

```ts
{
  pageSize: "A4",
  pageMargins: [30, 30, 30, 30],
  content: [
    // 1. Header 2-cols
    columnsHeader({ empresa, ppCodigo }),

    // 2. Grid metadata (Cliente/Fornecedor/Emissão | Produto/Orçamento/Projeto | Título/Campanha)
    gridMetadata({ cliente, fornecedor, job, projeto, orcamento, emissaoDate }),

    // 3. Faixa cinza escuro "SOLICITAMOS POR ORDEM DO SACADO, O SEGUINTE SERVIÇO"
    faixaTitulo("SOLICITAMOS POR ORDEM DO SACADO, O SEGUINTE SERVIÇO"),

    // 4. Grid serviço + quantidade + prazo pagto
    gridServico({ servico, quantidade, prazoPagto }),

    // 5. Especificações (condicional)
    ...(especificacoes ? [faixaTitulo("ESPECIFICAÇÕES DO SERVIÇO"), textoLivre(especificacoes)] : []),

    // 6. Faixa "DADOS PARA FATURAMENTO DA COBRANÇA"
    faixaTitulo("DADOS PARA FATURAMENTO DA COBRANÇA"),
    gridFaturamento({ empresa }),

    // 7. Faixa "DADOS BANCARIOS DO FORNECEDOR PARA PAGAMENTO"
    faixaTitulo("DADOS BANCARIOS DO FORNECEDOR PARA PAGAMENTO"),
    gridBancarios({ fornecedor }),

    // 8. Faixa Valor destacada
    faixaValor({ valor }),

    // 9. Faixa "DADOS DO FORNECEDOR"
    faixaTitulo("DADOS DO FORNECEDOR"),
    gridFornecedor({ fornecedor }),

    // 10. Assinaturas (footer 2-cols)
    assinaturas({ fornecedorNome: fornecedor.razao_social || fornecedor.nome, empresaNome: empresa.razao_social, responsavelNome }),
  ],
  defaultStyle: { font: "Helvetica", fontSize: 8 },
}
```

**Helpers reutilizáveis** dentro do mesmo arquivo (faixaTitulo, gridMetadata, etc). Cada um é uma função pura que recebe dados e retorna nodes do pdfmake.

**Logo California**: ler `public/brand/logo-icon.png` no build-time (import como base64) e passar pro pdfmake como `{ image: base64, width: 50 }`.

**Format helpers**: currency BRL (`R$ X.XXX,XX`), data (`dd/mm/aaaa`), formatCNPJ, formatCEP — reutilizar de `lib/utils.ts` se existirem, senão inline no arquivo do PDF (não escapa do escopo).

### 9. Storage — bucket `pedidos-compra`

Bucket privado. Layout:

```
{tenant_id}/{job_id}/{pp_id}/pp-{codigo}.pdf
{tenant_id}/{job_id}/{pp_id}/anexos/{anexo_id}-{sanitized_original_name}
```

Policies em `storage.objects` isolam por tenant via prefix do path (mesmo padrão do bucket `orcamento-importacoes`).

Signed URLs geradas via server actions, TTL 3600s (1h).

## Performance (checklist obrigatório)

- ✅ Query única no `page.tsx` do job pra buscar PPs (não N+1); adiciona ao `Promise.all` existente.
- ✅ Migration com GRANT explícito pra `authenticated` + índices em FKs (tenant, job, fornecedor, empresa, pp_id nos anexos).
- ✅ Policies RLS usam `is_tenant_member(tenant_id)` (padrão do projeto).
- ✅ Sequencial PP via função com advisory lock — evita race sem penalizar leitura.
- ✅ PDF gerado uma vez, armazenado. Consulta subsequente é signed URL do bucket (não regera).
- ✅ Anexos limitados (8 MB/arquivo, 25 MB total) — evita uploads grandes que estourariam limite serverless.
- ✅ Upload de anexos direto do cliente pro Supabase Storage (não passa pelo Vercel, evita limite de 4.5 MB do body).

## Auditoria

- `pedido_compra.emitida` — `{ pp_codigo, valor, fornecedor_id, item_realizado_id, job_id }`
- `pedido_compra.cancelada` — `{ pp_codigo, item_realizado_id, job_id }`
- `acao_negada` — quando ownership/status gate bloqueia, com metadata `{ acao_tentada, motivo, contexto }`

## Fora de escopo (fase 2+)

- **Fluxo do financeiro** — caixa de entrada `/financeiro/pedidos-compra`, aprovar/reprovar/baixar. Vai reintroduzir coluna `status` + regras de cancelamento diferenciadas por status.
- **Edição da PP após emitida** — só cancelar+regerar.
- **Envio automático por email** pro fornecedor.
- **Integração com contas a pagar / DRE** — depende do fluxo financeiro.
- **Múltiplas PPs por item** (split entre fornecedores) — se surgir necessidade, remove unique constraint e evolui UI.
- **Assinatura digital / carimbo temporal** — hoje é PDF simples, com espaço pra assinatura física.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Race condition na geração de código concorrente | Função Postgres com `pg_advisory_xact_lock` — serializa por tenant, não bloqueia leitura. |
| Falha entre upload de anexo e insert de row | Rollback explícito na server action — limpa tudo em caso de erro. |
| PDF grande estoura runtime Vercel (10s hobby, 60s pro) | PDF de PP é pequeno (~50KB), render < 500ms; sem risco. |
| Anexo malicioso (ex: HTML disfarçado de PDF) | Validação de mimetype server-side (magic bytes seria overkill hoje; MIME confiável no MVP). |
| PP órfão se realizado é editado depois | Snapshot dos dados na tabela — PP mantém valores da emissão. Se realizado mudar, uma nova PP pode ser gerada só se a atual for cancelada primeiro. |
| Storage vaza tenant | Policies em `storage.objects` filtram por prefix path = tenant_id. Signed URL só emitida após ownership check. |

## Testes manuais (aceitação)

1. Job em `aberto`, item com realizado > 0 → trilha lateral mostra ícone "Gerar PP".
2. Abrir drawer → todos os defaults corretos (fornecedor vazio, empresa = job.empresa, prazo = hoje+15, serviço = item.item, quantidade = qtd_realizada).
3. Tentar submeter sem fornecedor → erro visível.
4. Tentar submeter sem anexo → erro visível.
5. Anexar 1 PDF válido + 1 imagem → submit → drawer fecha → trilha muda pra "Ver / Cancelar".
6. Clicar "Ver" → PDF abre em nova aba com layout fiel ao PDF anexo (menos os campos removidos).
7. Conferir PDF: dados da empresa/fornecedor/job/valor/prazo corretos, assinatura do responsável do job.
8. Verificar `jobs_itens_realizado.fornecedor_id` populado no banco.
9. Cancelar PP → confirm dialog → PDF some do bucket, anexos somem, row apagada, `fornecedor_id` volta pra null.
10. Como GP não-responsável → botão nem aparece; tentar via URL/console → server action rejeita com `acao_negada`.
11. Job em `finalizado` → botão não aparece; tentar via forjada requisição → server action rejeita.
12. Anexo > 8 MB → rejeitado no client + no server.
13. Anexos somando > 25 MB → rejeitado.
14. 2 usuários gerando PP simultaneamente em jobs diferentes do mesmo tenant → códigos sequenciais sem duplicata (`PP-00001`, `PP-00002`).
15. Audit `pedido_compra.emitida` e `pedido_compra.cancelada` gravados corretamente.
