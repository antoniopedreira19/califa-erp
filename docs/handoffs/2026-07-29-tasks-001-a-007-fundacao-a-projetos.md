# Tasks 001 a 007 — Fundação, Cadastros, Orçamentos, Versões, Projetos (2026-07-21 a 2026-07-29)

Consolidado do que foi entregue nas primeiras cinco tasks operacionais do projeto. Cada task tem sua migration versionada aplicada via MCP.

## Task 001 — Fundação

- `tenants`, `profiles`, `tenant_members`, `audit_events` com RLS.
- Helpers `is_tenant_member`, `is_tenant_admin`, `current_tenant_ids`.
- Trigger `handle_new_user` popula `profiles` no signup.
- RPC `log_audit_event` (SECURITY DEFINER).
- Middleware protegendo rotas privadas + `requireSession()`.
- Tela de login com identidade California.
- Layout interno + sidebar com transição contínua.

## Task 002 — Cadastros

- `clientes` (PJ) e `fornecedores` (PF/PJ).
- CPF/CNPJ opcional com validação de dígito no app.
- Hub `/cadastros` com cards (contagem de ativos).
- Listagens com busca, filtros por status, soft-delete (inativar/reativar).
- Auditoria em criar/editar/inativar.

## Task 003 — Orçamentos

- `orcamentos` com FK para cliente e responsável (profile), enum de status.
- Auto-geração de código `ORC-NNNN`.
- Rename cosmético: `gp_responsavel_id` → `responsavel_id`.
- Detalhe do orçamento com metadata compacta + drawer editar + card de versões.

## Task 004 — Versões, itens, importação, categoria e planejado

- `versoes_orcamento`, `versoes_orcamento_grupos`, `versoes_orcamento_itens`.
- Regras de banco: um grupo por (versão, nome) case-insensitive, uma versão aprovada por orçamento (unique parcial), `total_orcado` GENERATED (`valor × qtd × dias/meses`).
- ALTER em `orcamentos`: `versao_aprovada_id`, `aprovado_em`, `aprovado_por`.
- UI: criar/duplicar/cancelar versão, CRUD de grupos, CRUD de itens (drawer).
- Página `/orcamentos/[id]/versoes/[versaoId]` com layout de planilha (grupos → itens) + card de totais.
- **Cálculos corretos**: Honorários = `(A+B+D) × %`, Impostos = `(B+C+Honor) × taxa/(1-taxa)` (gross-up), Faturamento = `total + honor + imposto`.
- Helper compartilhado `lib/calculos/versao-totais.ts` — card e export usam o mesmo cálculo.
- Export XLSX via ExcelJS replicando layout da planilha padrão.
- **Fase F — Importação de planilha**: drawer com upload/preview/confirmar, parser da aba "Oficial", bucket privado `orcamento-importacoes`, tabela `orcamento_importacoes` com warnings JSONB.
- **Fase G — Categoria por versão + PLANEJADO**:
  - Tabela `versoes_orcamento_categorias` (escopo por versão, mesmo padrão de grupos). Botão "Nova categoria" no header ao lado de "Novo grupo".
  - Item ganha `categoria_id` (opcional) + 4 campos planejados (`valor_unitario_planejado`, `quantidade_planejada`, `dias_meses_planejado`, `total_planejado` GENERATED).
  - Drawer de item tem dropdown de categoria e bloco Planejado (fundo azul).
  - Tabela de itens tem 13 colunas (orçado + planejado + categoria + bloco Rentabilidade em R$ e %).
  - Parser lê col B (categoria) e cols I-K (planejado); `confirmarImportacao` cria categorias em bulk.
  - Duplicar versão copia categorias (com map old→new) e campos planejados.
  - Helper `calcularTotaisPlanejados` em `lib/calculos/versao-totais.ts`.
- **Fase G' — Catálogo global de categorias**: substituiu `versoes_orcamento_categorias` (por versão) por `categorias` (tenant), com CRUD em `/categorias` gerenciado pelo hub `/cadastros`. Todos os membros criam/editam; só admin inativa/reativa. Import não lê mais categoria da planilha; classificação é feita pelo GP no drawer de item. Duplicação de versão preserva `categoria_id`.

## Task 007 — Projetos como guarda-chuva de orçamentos

- Nova tabela `projetos` (código formato `AAA-NNNN/YY` — prefixo do cliente + sequencial por cliente/ano + ano 2 dig).
- `clientes` ganha `codigo_curto` (2-6 letras uppercase, único por tenant, backfill das primeiras 6 letras do `nome_fantasia`).
- `orcamentos`: adicionou `projeto_id` NOT NULL, removeu `cliente_id`, `responsavel_id`, `campanha` (subiram pro projeto).
- Cliente e responsável agora vivem no projeto; herdados por embed em orçamentos e jobs.
- Código do orçamento passa a ser `[CODIGO_PROJETO]-NN` (ex: `AMB-0003/26-01`). Códigos antigos `ORC-0001/0002` mantidos.
- Rotas reestruturadas: `/orcamentos` = lista de projetos; `/orcamentos/[projetoId]` = detalhe do projeto (com card de orçamentos); `/orcamentos/[projetoId]/[orcId]` = detalhe do orçamento (com versões); `/orcamentos/[projetoId]/[orcId]/versoes/[versaoId]` = detalhe da versão.
- Sidebar continua com uma entrada só "Orçamentos" — a hierarquia interna é o único que muda.
- Server actions com defense-in-depth: UPDATE de orçamento filtra por `projeto_id` também.
- Backfill criou 1 projeto agrupando os orçamentos existentes.

## Task 007+ — Categorias de Domínio (projeto e orçamento)

- Nova tabela `categorias_dominio` (escopo enum `projeto | orcamento`, tenant-wide).
- Design de tabela única com coluna escopo (não duas tabelas separadas — 1 CRUD, admin unificado, novo escopo = novo enum value).
- `projetos.categoria_id` (FK nullable) + `orcamentos.categoria_id` (FK nullable). Coluna antiga `orcamentos.tipo` (texto livre) removida.
- Admin em `/cadastros/categorias-dominio` (tabs Projeto/Orçamento/Todos).
- Seed inicial no tenant Agência California:
  - Projeto: `Fee`, `Projeto proprietário`, `Ativação`, `Evento`, `Campanha`.
  - Orçamento: `Always On`, `Mídia`, `Evento`, `Influencer`, `Extra`.
- Dropdown "Categoria" (com opção "Sem categoria" usando sentinel `__none__` — Radix não aceita `value=""`) em `ProjetoForm` e `OrcamentoForm`.
- Coluna Categoria em `<ProjetosList>` e `<OrcamentosList>`; metadata em ambas as pages de detalhe.

## Migrations aplicadas

```
20260721000001  task001_fundacao_auth_seguranca
20260721000002  task001_hardening_advisors
20260721000003  task001_grants_authenticated
20260722000001  task002_clientes_fornecedores
20260723000001  task003_orcamentos
20260723000002  rename_gp_responsavel_para_responsavel
20260724000001  task004_versoes_orcamento
20260724000002  task004_grupos_de_itens
20260726000001  task004_orcamento_importacoes
20260728000001  task004_categoria_e_planejado
20260728000002  task007_projetos
20260728000003  categorias_dominio
```

## Commits relevantes

- `c6ccb75` — merge Task 007 (Projetos como guarda-chuva)
- `d199df1` — task007 final review: fix export route + code helpers + drawer refresh + list nav
- `41490d9` — feat(categorias): categorias de domínio pra projeto e orçamento
