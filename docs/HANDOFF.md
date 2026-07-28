# Handoff — California ERP

Documento para dar continuidade ao projeto em uma nova sessão de trabalho.

**Última atualização** (2026-07-28): card "Totais" da versão reescrito a partir do design `Totais da Versao.dc.html` (Claude Design) — agora espelha Orçado × Planejado por agrupamento e fecha em resultado operacional / resultado geral. Veio depois da migração para catálogo global de categorias (Fase G', 27/07): `versoes_orcamento_categorias` substituída por `categorias` (tenant-wide), CRUD em `/categorias` gerenciado pelo hub `/cadastros`, import agnóstico de categoria.

## 0. LEIA PRIMEIRO — ação pendente no início da sessão

Antes de qualquer coisa:

1. **`docs/PERFORMANCE.md` é obrigatório**. Toda mudança em `app/(app)/**` ou `lib/supabase/**` passa pelo checklist do guia. Já custamos 2 regressões severas por não respeitar isso — não repita. `CLAUDE.md` também tem as regras não-negociáveis no topo.

2. **Diagnóstico de perf em andamento**: os commits recentes adicionaram `console.log("[<contexto>.timing]", ...)` **temporário** em 3 arquivos pra investigar por que a navegação orçamento→versão ficou lenta. Depois do próximo teste do user em prod, coletar os logs em **Vercel → Functions → Runtime Logs** filtrando por:
   - `[importacao.preview.timing]` — [`app/(app)/orcamentos/[id]/versoes/importar-actions.ts`](../app/(app)/orcamentos/[id]/versoes/importar-actions.ts)
   - `[orcamento.detail.timing]` — [`app/(app)/orcamentos/[id]/page.tsx`](../app/(app)/orcamentos/[id]/page.tsx)
   - `[versao.detail.timing]` — [`app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx`](../app/(app)/orcamentos/[id]/versoes/[versaoId]/page.tsx)

   Uma vez que o gargalo real for identificado, **REMOVER esses timings** (blocos `console.log` marcados com `// TEMPORÁRIO`) e commitar como cleanup.

3. **Fixes de perf aplicados neste ciclo (não regride):**
   - `prefetch={false}` nos `<Link>` das listas de versão, orçamento, cliente e fornecedor.
   - Página do orçamento não usa mais embed pesado pra calcular totais de versões — trocado por query agregada.
   - `force-dynamic` permanece nas pages autenticadas (**não remova** — funciona como freio de prefetch descontrolado, ver `docs/PERFORMANCE.md` seção G).

## 1. Onde estamos

**Deploy:** projeto no Vercel (`calif-erp`), branch `main`. Domínio de produção: `https://www.sistemacalifa.com.br`.
Backend: Supabase project `avlwxyknvhlzvnysbzrg` (`https://avlwxyknvhlzvnysbzrg.supabase.co`).
Admin cadastrado: `antonio@pevetech.com.br` (role `administrador` no tenant `agencia-california`).

**Local (Git):** working tree limpo, sincronizado com `origin/main`. O `b2003f7`, que estava segurado, subiu junto com o card de Totais.

> **O projeto saiu de `~/Downloads` e mora em `~/Documents/California/Califa-ERP`.** O macOS protege `~/Downloads` via TCC (Transparency, Consent & Control); no meio da sessão de 28/07 a permissão caiu e **todo** acesso ao diretório passou a dar `Operation not permitted` — inclusive `git`, que falha logo no `getcwd()` com a mensagem enganosa `Unable to read current working directory`. O dev server continuou servindo normalmente porque já tinha os arquivos abertos, o que mascara o problema. Se reaparecer, o sintoma é esse e a saída é a pasta, não a ferramenta. `~/Documents` também é protegida por TCC — se um dia der o mesmo, mova para `~/Projects`.

**Últimos commits relevantes desta sessão:**
- `HEAD` — Espelho orçado × planejado no card de Totais
- `b2003f7` — Alinha a grade entre grupos e detalha a rentabilidade
- `a665450` — Documenta performance como regra transversal (PERFORMANCE.md + CLAUDE.md + memória)
- `7b994f1` — perf: prefetch=false nas listas + query agregada + timing granular temp
- `b4b1c30` — Preview do import: mostra planejado + rentabilidade + timing debug temp
- `75e978c` — Fix pós-review Fase G (Number coerção planejado + rentab tempo real no drawer)

**Migrations aplicadas no Supabase (via MCP):**

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
20260729000001  categorias_globais
```

**Todas as migrations aplicadas.** Última: `20260729000001_categorias_globais` (fase G').

## 2. O que já está pronto (Tasks 001 – 004)

### Task 001 — Fundação
- `tenants`, `profiles`, `tenant_members`, `audit_events` com RLS.
- Helpers `is_tenant_member`, `is_tenant_admin`, `current_tenant_ids`.
- Trigger `handle_new_user` popula `profiles` no signup.
- RPC `log_audit_event` (SECURITY DEFINER).
- Middleware protegendo rotas privadas + `requireSession()`.
- Tela de login com identidade California.
- Layout interno + sidebar com transição contínua.

### Task 002 — Cadastros
- `clientes` (PJ) e `fornecedores` (PF/PJ).
- CPF/CNPJ opcional com validação de dígito no app.
- Hub `/cadastros` com cards (contagem de ativos).
- Listagens com busca, filtros por status, soft-delete (inativar/reativar).
- Auditoria em criar/editar/inativar.

### Task 003 — Orçamentos
- `orcamentos` com FK para cliente e responsável (profile), enum de status.
- Auto-geração de código `ORC-NNNN`.
- Rename cosmético: `gp_responsavel_id` → `responsavel_id`.
- Detalhe do orçamento com metadata compacta + drawer editar + card de versões.

### Task 004 — Versões, itens, importação, categoria e planejado
- `versoes_orcamento`, `versoes_orcamento_grupos`, `versoes_orcamento_itens`.
- Regras de banco: um grupo por (versão, nome) case-insensitive, uma versão aprovada por orçamento (unique parcial), `total_orcado` GENERATED (valor × qtd × dias/meses).
- ALTER em `orcamentos`: `versao_aprovada_id`, `aprovado_em`, `aprovado_por`.
- UI: criar/duplicar/cancelar versão, CRUD de grupos, CRUD de itens (drawer).
- Página `/orcamentos/[id]/versoes/[versaoId]` com layout de planilha (grupos → itens) + card de totais.
- **Cálculos corretos**: Honorários = (A+B+D) × %, Impostos = (B+C+Honor) × taxa/(1-taxa) (gross-up), Faturamento = total + honor + imposto.
- Helper compartilhado `lib/calculos/versao-totais.ts` — card e export usam o mesmo cálculo.
- Export XLSX via ExcelJS replicando layout da planilha padrão.
- **Fase F — Importação de planilha**: drawer com upload/preview/confirmar, parser da aba "Oficial", bucket privado `orcamento-importacoes`, tabela `orcamento_importacoes` com warnings JSONB.
- **Fase G — Categoria por versão + PLANEJADO**:
  - Tabela `versoes_orcamento_categorias` (escopo por versão, mesmo padrão de grupos). Botão "Nova categoria" no header ao lado de "Novo grupo".
  - Item ganha `categoria_id` (opcional) + 4 campos planejados (`valor_unitario_planejado`, `quantidade_planejada`, `dias_meses_planejado`, `total_planejado` GENERATED).
  - Drawer de item tem dropdown de categoria e bloco Planejado (fundo azul).
  - Tabela de itens tem 13 colunas (orçado + planejado + categoria + bloco Rentabilidade em R$ e %) — ver bloco abaixo.
  - Card de totais reescrito depois (ver bloco "Card Totais — espelho orçado × planejado" abaixo).
  - Parser lê col B (categoria) e cols I-K (planejado); confirmarImportacao cria categorias em bulk.
  - Duplicar versão copia categorias (com map old→new) e campos planejados.
  - Helper `calcularTotaisPlanejados` em `lib/calculos/versao-totais.ts`.
- **Fase G' — Catálogo global de categorias**: substituiu `versoes_orcamento_categorias` (por versão) por `categorias` (tenant), com CRUD em `/categorias` gerenciado pelo hub `/cadastros`. Todos os membros criam/editam; só admin inativa/reativa. Import não lê mais categoria da planilha; classificação é feita pelo GP no drawer de item. Duplicação de versão preserva categoria_id.

### Alinhamento da grade + coluna de rentabilidade (`b2003f7`, 28/07)

Arquivo: [`itens-table.tsx`](<../app/(app)/orcamentos/[id]/versoes/[versaoId]/itens-table.tsx>).

**Problema:** cada grupo renderiza sua própria `<table>`. Em layout automático, as colunas eram medidas pelo conteúdo de cada card — um grupo com item de nome curto ("teste") gerava coluna ITEM estreita, outro com nome longo gerava coluna larga, e os blocos ORÇADO / PLANEJADO saíam desalinhados entre os cards.

**Solução:** `table-fixed` + `<ColunasFixas />` (um `<colgroup>`) com larguras **em porcentagem**, não em px. Como todos os cards têm a mesma largura, a mesma proporção alinha todos os grupos em qualquer versão, e a grade acompanha o container em vez de estourar. `LARGURA_MINIMA` (`min-w-[1060px]`) é o piso: abaixo disso o card rola na horizontal em vez de espremer as colunas de moeda.

- Larguras em px foram tentadas primeiro e **estouraram a largura do card**, empurrando o bloco de rentabilidade para fora da área visível. Não volte para px.
- Verificado por medição: nos 9 grupos da versão importada, as bordas dos blocos ficam todas na mesma posição.

**Rentabilidade:** o bloco `RESULTADO` (1 coluna) virou `RENTABILIDADE` (2 colunas): `R$` e `%`. O percentual é sobre o **orçado** (`rentabilidade / orcado`).

- O cálculo **reusa `calcularTotaisPlanejados`** de [`versao-totais.ts`](../lib/calculos/versao-totais.ts) via o helper local `rentabilidadeDe(orcado, planejado)` — mesma fórmula e mesma semântica de travessão do card de Totais. Uma primeira versão duplicou a regra localmente; foi trocada de propósito. **Não reintroduza o cálculo inline** — a grade e o card de Totais não podem divergir.
- Componente `CelulasRentabilidade` é compartilhado entre a linha existente e a linha nova (draft).
- Decisão de layout: "% dentro do bloco" foi implementado como **sub-coluna**, não como segunda linha dentro da célula. Motivo técnico: a altura fixa de linha (`ALTURA_LINHA = h-9`) sustenta o alinhamento da trilha de lixeiras que vive fora do card; empilhar duas linhas na célula quebraria esse alinhamento.
- `colSpan` do estado vazio e do rodapé "Novo item" passaram de 12 para 13.

### Card "Totais" — espelho orçado × planejado (28/07)

Arquivo: [`totais-card.tsx`](<../app/(app)/orcamentos/[id]/versoes/[versaoId]/totais-card.tsx>). Origem: design `Totais da Versao.dc.html` (opção `5a`) no projeto Claude Design `d509845b-dfa3-486b-ab22-c4918e449aee`.

O card antigo tinha duas colunas (subtotais por tipo · composição da fatura). Agora tem **três camadas de leitura**:

1. **Tabela de agrupamentos** — uma linha por grupo com Orçado, Planejado, Rentab. R$ e %, fechando em "Total dos custos". `TotaisCard` passou a receber `grupos` como prop (a page já carregava a lista; não há query nova).
2. **Fechamento do orçado por tipo de custo** — A/B/C/D → total → honorários → impostos → faturamento previsto.
3. **Resultado** — faturamento − impostos − custo planejado = **resultado operacional**, decomposto no bloco "Composto por" (honorários + rentabilidade), e **resultado geral** = resultado operacional ÷ faturamento em destaque.

**As bandas de cor são literalmente as mesmas da grade de itens** (`#f1f0ec`/`#282828`, `#e8f0fd`/`#2f6fdb`, emerald) — é o ponto do design: a vista de Totais tem que "rimar" com a tela de edição. Se mexer nas cores de um, mexa no outro.

Decisões que fogem do mock — todas deliberadas, não são bugs:

- **Sem planejado lançado** (`totalPlanejado === 0`), resultado operacional e resultado geral mostram travessão. O mock assume planejado preenchido; seguir o mock ao pé da letra daria `faturamento − impostos − 0`, que lê como lucro fantasma de ~84% numa versão recém-criada. O `%` por grupo segue a convenção que já existia na grade (`—` quando o grupo não tem planejado).
- **No bloco "Composto por", os dois valores ficam em preto** (pedido do user, 28/07) — as duas parcelas do resultado operacional se leem juntas. Prejuízo (`rentabilidade < 0`) continua em `text-california-red`.
- **A linha de honorários exibe a taxa configurada da versão** (`percentual_honorarios`), no mesmo formato da rentabilidade (`R$ 520,00 · 13,0%`). É a mesma taxa que aparece em "Honorários (13%)" na coluna da esquerda — **não** é honorários ÷ faturamento.
- `agruparPorGrupo` monta um `Map` numa passada só pelos itens, em vez de um `filter` por grupo (a lista pode ter centenas de linhas).

### UI polish
- Componentes reusáveis: `Dialog` + `DrawerContent`, `ConfirmDialog`, `Select` (Radix), `Popover`, `Calendar`, `DatePicker`, `MaskedInput` (telefone/CPF/CNPJ), `no-spinner` utility.
- Fonte display **Fraunces** para títulos (cara de agência).
- Sidebar com transição contínua (largura px animável, slot fixo de ícone, opacidade do label).
- Logo do urso California (`public/brand/logo-icon.png`) + favicons.

## 3. Próximos passos (em ordem de prioridade)

### 🟢 Prioridade 1 — Fluxo de convite de usuário (código feito, faltam ajustes no Dashboard)

**Estado:** código implementado. Falta apenas: (a) colar o template atualizado no Supabase Dashboard e (b) validar URL Configuration.

**O que já foi feito no código:**

1. ✅ Página [`app/(auth)/definir-senha/page.tsx`](../app/(auth)/definir-senha/page.tsx):
   - Valida sessão no mount (`supabase.auth.getUser()`); se não houver, redireciona para `/login?reason=convite_expirado`.
   - Form com senha + confirmar senha (mín 8 chars, iguais).
   - Submete via `supabase.auth.updateUser({ password })`.
   - Sucesso → `/home`. Erro de sessão → mensagem clara.
   - Mesma identidade visual do login (brand-side + form-side, cores California).

2. ✅ Callback [`app/api/auth/callback/route.ts`](../app/api/auth/callback/route.ts):
   - Passou a suportar dois fluxos: `?code=...` (PKCE tradicional) **e** `?token_hash=...&type=invite&next=...` (links de e-mail customizados).
   - Em qualquer erro de troca de token → redireciona para `/login?reason=convite_expirado`.

3. ✅ Template [`docs/email-templates/magic-link-invite.html`](email-templates/magic-link-invite.html):
   - `{{ .ConfirmationURL }}` substituído por `{{ .SiteURL }}/api/auth/callback?token_hash={{ .TokenHash }}&type=invite&next=/definir-senha`.
   - Assim o link do e-mail cai direto no nosso domínio, verifica o token, e vai para `/definir-senha`.

4. ✅ Login: reconhece `?reason=convite_expirado` e mostra mensagem.

**O que ainda precisa ser feito manualmente no Supabase Dashboard:**

1. **Authentication → Email Templates → "Invite user"**:
   - Colar o HTML atualizado de `docs/email-templates/magic-link-invite.html`.

2. **Authentication → URL Configuration**:
   - `Site URL`: `https://www.sistemacalifa.com.br` (usada por `{{ .SiteURL }}` no template — precisa apontar para prod).
   - `Redirect URLs` (adicionar todas):
     ```
     https://www.sistemacalifa.com.br/api/auth/callback
     https://www.sistemacalifa.com.br/definir-senha
     http://localhost:3000/api/auth/callback
     http://localhost:3000/definir-senha
     ```

3. **Para testar em dev local**, o template usa `{{ .SiteURL }}` (que é o Site URL de produção). Duas opções:
   - Testar apenas no Vercel após deploy.
   - Ou, durante teste local, trocar `{{ .SiteURL }}` por `http://localhost:3000` no Dashboard temporariamente.

**Como testar (fluxo completo):**
1. Deploy dos commits novos para Vercel (ou testar em local com Site URL ajustada).
2. Colar template no Dashboard e salvar URL Configuration.
3. Supabase Dashboard → Authentication → Users → **Invite user** com um e-mail de teste.
4. Verificar entrega via Resend.
5. Clicar no link → deve cair em `/definir-senha` já com sessão ativa (email visível no topo do form).
6. Definir senha → cai em `/home`.
   - ⚠️ **Atenção:** hoje o convite pelo Dashboard **não cria vínculo em `tenant_members`**. O usuário vai definir a senha, mas ao chegar em `/home` o `requireSession()` vai barrar por `sem_tenant` e mandar de volta pro login. Vincular manualmente via SQL até termos a Task 006 (Admin console) com UI de convite.

**UI de admin para convidar** — ✅ IMPLEMENTADA (antecipada da Task 006):
- Menu **Administração** liberado na sidebar (adminOnly).
- Hub [`app/(app)/admin/page.tsx`](../app/(app)/admin/page.tsx) com card **Usuários** mostrando contagem de vínculos ativos.
- Página [`app/(app)/admin/usuarios/page.tsx`](../app/(app)/admin/usuarios/page.tsx) lista todos os vínculos do tenant (usa `createServiceClient` — autorização feita por `requireAdmin`). Mostra nome, e-mail, papel e status (perfil ativo × vínculo ativo).
- Drawer [`convidar-drawer.tsx`](../app/(app)/admin/usuarios/convidar-drawer.tsx) com form (e-mail, nome opcional, papel).
- Server action [`convidarUsuario`](../app/(app)/admin/usuarios/actions.ts):
  - Valida sessão + admin.
  - Se profile com esse e-mail já existe **sem** vínculo → só cria membership (sem novo e-mail).
  - Se profile já existe **com** vínculo → erro amigável.
  - Se não existe → `admin.inviteUserByEmail(email, { redirectTo: <origin>/api/auth/callback?next=/definir-senha })` + insert em `tenant_members` com role escolhida.
  - Origin é resolvido dinamicamente via headers (`x-forwarded-host`/`host`) — funciona em dev e em prod sem mudar código.
  - Registra `usuario.convidado` ou `usuario.membership_criada` em `audit_events`.
- Schema Zod: [`lib/validations/convite.ts`](../lib/validations/convite.ts).
- Auditoria: [`lib/auth/audit.ts`](../lib/auth/audit.ts) ganhou 4 novas ações (`usuario.convidado`, `usuario.membership_criada`, `usuario.membership_atualizada`, `usuario.reenvio_convite`).

**Ainda no backlog da Task 006 (próximos incrementos):**
- Inativar / reativar membership (soft-delete de vínculo).
- Trocar papel de um membro existente (drawer/dialog).
- Reenviar convite (para user que não ativou).
- Feed de auditoria (audit_events do tenant).
- MFA obrigatório para admin.

### ✅ Fase F da Task 004 — Importação de planilha (implementada)

- Migration `20260726000001_task004_orcamento_importacoes.sql`: tabela
  `orcamento_importacoes` (com warnings JSONB) + bucket privado
  `orcamento-importacoes` + policies em `storage.objects` isolando por tenant
  (path prefix = `tenant_id/orcamento_id/importacao_id-nome.xlsx`).
- Parser [`lib/importacao/parser-oficial.ts`](../lib/importacao/parser-oficial.ts):
  ExcelJS, detecta aba "Oficial" (fallback: primeira aba), acha o header
  procurando keywords (PLANILHA/ITEM/R$/QT/D-M/TT), interpreta grupos
  (A preenchida, B vazia) e itens (B preenchida). Ignora linhas de resumo
  (SUB-TOTAL/TOTAL/IMPOSTO/HONORÁRIOS/FATURAMENTO) e extrai o `%
  honorários` do resumo, aplicando na versão criada. Warnings com
  severidade `ignorada`/`ajuste` acumulam por linha/coluna.
- Server actions [`importar-actions.ts`](../app/(app)/orcamentos/[id]/versoes/importar-actions.ts):
  `previewImportacao` (parse sem persistir) e `confirmarImportacao`
  (reparse + criação da versão em rascunho + grupos + itens em bulk +
  upload no bucket + registro em `orcamento_importacoes` + auditoria).
- UI [`importar-drawer.tsx`](../app/(app)/orcamentos/[id]/versoes/importar-drawer.tsx):
  drawer com upload → tela de preview (grupos, contagens, total bruto,
  warnings destacados) → botão "Criar versão importada" que persiste e
  redireciona pra nova versão. Botão fica ao lado de "Nova versão" no
  card de versões do orçamento.

### 🟡 Prioridade 2 — Fase E da Task 004: Aprovação de versão

Falta fechar o fluxo comercial. Quando o usuário aprova uma versão:
- Server action `aprovarVersao(versaoId)`:
  - Set `versoes_orcamento.status = 'aprovada'`, `aprovado_em = now()`, `aprovado_por = user`.
  - Update `orcamentos.status = 'aprovado'`, `versao_aprovada_id = versaoId`, `aprovado_em`, `aprovado_por`.
  - As outras versões do mesmo orçamento viram `substituida` automaticamente.
  - Registra `versao_orcamento.aprovada` em `audit_events`.
- Trigger opcional no banco pra reforçar a regra (só uma aprovada — já garantido pelo unique parcial, mas trigger cascata para as outras é melhor).
- Botão "Aprovar" no header da versão em `/orcamentos/[id]/versoes/[versaoId]` com `ConfirmDialog`.
- Aviso na página do orçamento quando aprovado ("Crie o job para seguir com a operação").

### 🟡 Prioridade 3 — Task 005: Criação do Job

Docs de referência: [`tasks/005-criacao-job-orcamento-aprovado.md`](../tasks/005-criacao-job-orcamento-aprovado.md).
- Migration `jobs`: FK obrigatórias para `orcamento_id` e `versao_orcamento_aprovada_id`, unique `(tenant_id, orcamento_id)` (um job por orçamento).
- Server action `criarJob(orcamentoId)`: só permite se `orcamento.status = 'aprovado'`; copia dados essenciais; atualiza `orcamentos.status = 'job_criado'`.
- UI: card "Job criado" no orçamento aprovado + página `/jobs/[id]` (placeholder por enquanto).

### 🟢 Prioridade 4 — Backlog

- **Task 006 — Administração** (continuar): inativar/reativar membership, trocar papel, reenviar convite, feed de auditoria.
- **MFA obrigatório** pra admin — configurar no Supabase Dashboard.
- **Regras finais de tributação A/B/C/D**: cálculo simplificado hoje. Refinar depois de reunião com o comercial/financeiro. Ver `lib/calculos/versao-totais.ts`.
- **Botão de aprovar/reprovar orçamento** (transições de status manuais além do que já existe no drawer).

## 4. Arquitetura & convenções (leia antes de codar)

### Regras invioláveis
1. **Performance é feature** — leia [`docs/PERFORMANCE.md`](PERFORMANCE.md) ANTES de tocar `app/(app)/**` ou `lib/supabase/**`. Já pagamos duas regressões severas: `<Link>` sem `prefetch={false}` em listas navegáveis e embed pesado só pra somar totais. Não repita — o guia tem case studies + checklist + anti-padrões proibidos.
2. **RLS ≠ GRANT** — Postgres exige AMBOS. Toda migration nova que cria tabela precisa terminar com `grant select, insert, update on ... to authenticated`. `service_role` já é coberto por `ALTER DEFAULT PRIVILEGES` da migration `20260725000001`. Perdemos horas com isso na Task 001.
3. **Toda tabela operacional tem `tenant_id`** com FK para `tenants` e RLS via `is_tenant_member(tenant_id)`. Policies usam `(select auth.uid())`, não `auth.uid()` direto (evita re-avaliar por linha).
4. **Sem `DELETE` policy** exceto para tabelas efêmeras (itens). Use `status = 'cancelado' / 'inativo'`.
5. **`SUPABASE_SERVICE_ROLE_KEY` só em server actions/route handlers.** Nunca no cliente.
6. **Toda ação sensível vira `audit_events` via RPC `log_audit_event`**.
7. **Antes de mudar código, ler `lib/types.ts`** — os types espelham as tabelas.

### Padrões UI (não reinvente)
- `<ConfirmDialog>` para toda confirmação (não use `window.confirm`).
- `<Dialog>` para modais centrados, `<DrawerContent>` para painéis laterais.
- `<Select>` (Radix) para dropdowns; `<DatePicker>` para datas; `<MaskedInput>` para telefone/CPF/CNPJ.
- Formulários: input numérico usa `className="no-spinner"` e vem sem default.
- Toast/alerta de erro do server action: mostrar como bloco vermelho no topo do form.
- Toda página de detalhe segue: breadcrumb `← Voltar` → header com título+badges+ações → conteúdo em cards.

### Padrões de código
- Server actions em `app/(app)/*/actions.ts`. Cada uma:
  - Chama `requireSession()` primeiro
  - Parseia com Zod
  - Verifica pertencimento ao tenant explicitamente (`.eq('tenant_id', session.activeTenant.id)`)
  - Loga auditoria
  - Chama `revalidatePath` no fim
- Colunas numéricas do Postgres voltam como string do Supabase-js. Sempre converte com `Number(...)`.
- Embeds do PostgREST só funcionam quando a FK vai **direto** para a tabela alvo. Ver `lib/data/members.ts` — `tenant_members.user_id → auth.users` não embuta em `profiles` (faz 2 queries).

### MCP Supabase
- `.mcp.json` na raiz com dois servers: `supabase` (read-only) e `supabase-write` (para migrations).
- Precisa de `SUPABASE_ACCESS_TOKEN` no ambiente. Na máquina macOS do Tiago ele vive em `~/.claude/settings.json`, no bloco `env` (arquivo fora do repositório — nunca commite o valor). Em Windows, variável de sistema via `setx`.
- **Se o MCP responder `Unauthorized` do nada:** o token foi rotacionado e a sessão atual ainda carrega o antigo. O servidor MCP lê a variável **na inicialização da sessão** e não relê o arquivo — abra uma sessão nova. (Aconteceu em 28/07, após rotação do token.)
- Ao aplicar migration nova, **sempre verifique com uma query simulando `antonio` (`set local role authenticated` + JWT claim override)** para pegar problemas de RLS/GRANT antes do frontend.

### Deploy Vercel
Env vars necessárias (documentadas em `.env.example`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (formato novo `sb_publishable_...`)
- `SUPABASE_SERVICE_ROLE_KEY` (formato novo `sb_secret_...`, marcar como Sensitive)
- **NÃO** colocar `SUPABASE_ACCESS_TOKEN` — é só pra MCP local.

## 5. Comandos úteis

```powershell
# Rodar em dev
npm run dev

# Verificações
npx tsc --noEmit
npx next lint
npm run build  # local pode dar erro de _document (bug Next 14 no Win) — Vercel builda ok

# Git
git status
git push origin main  # publica commits pendentes
```

## 6. Contexto operacional

- Usuário do sistema hoje: só **antonio@pevetech.com.br** (admin). Bruno e demais GPs ainda não convidados.
- Tenant único: `Agência California` (slug `agencia-california`, id `d2a02c10-9c7e-4157-8dd5-84bbf5a7044c`).
- SMTP do Resend já configurado no Supabase — envio de e-mail funciona.
- Template do convite: `docs/email-templates/magic-link-invite.html` já customizado com identidade California (mas precisa do ajuste do link — ver Prioridade 1).
- Regras de negócio finais de tributação por tipo A/B/C/D pendentes de validação com o comercial.
