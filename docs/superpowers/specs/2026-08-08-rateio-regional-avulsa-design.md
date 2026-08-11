# Rateio de Regional em Contas Avulsas (e Recorrentes) — Design

**Data:** 2026-08-08
**Autor:** Antonio + Claude
**Status:** Aguardando revisão do Antonio antes do plano de implementação.

## 1. Contexto

O módulo de contas avulsas (Task 012) e recorrentes (Task 013) hoje registra apenas o `job_id` opcional na conta. Não há forma de saber a qual **regional** um gasto pertence quando não tem job (aluguel, folha, tarifa, imposto). E não há forma de **dividir um gasto entre múltiplas regionais** (ex: um contrato que atende NE e SP, rateado 50/50 pra custo).

Sem isso, o DRE por regional (roadmap financeiro) fica furado — gastos administrativos ficam num limbo "sem regional atribuída".

## 2. Objetivo

Introduzir **rateio de regional** obrigatório em conta avulsa (1 ou mais linhas somando 100%) e no template recorrente (que replica pra cada instância gerada). Preservar a semântica de "1 baixa = 1 lançamento no banco" — o rateio é metadata contábil, não afeta o extrato.

Entrega:

1. 2 tabelas filhas novas: `contas_avulsas_regionais` e `contas_avulsas_recorrentes_regionais`.
2. Trigger de banco valida `SUM(percentual) = 100.00` em cada operação.
3. Bloco "Rateio de regional" no drawer de criar/editar avulsa e recorrente.
4. Card "Rateio" nas páginas de detalhes.
5. Badge visual "Rateado" na conciliação quando o lançamento veio de conta com >1 linha.
6. Extensão das actions de criar/editar pra receber e persistir o array de rateio.
7. Extensão do cron pra copiar rateio do template pra cada instância gerada.

## 3. Decisões arquiteturais

Todas fechadas em conversa com Antonio antes de escrever esta spec.

### 3.1. Percentual, não valor absoluto

Cada linha do rateio guarda `percentual numeric(5,2)` (0.01 a 100.00). O valor em R$ é derivado (`total × percentual / 100`) na hora de renderizar/calcular.

Motivo: **contas recorrentes reajustam**. Aluguel sobe de R$ 3.000 pra R$ 3.100 — com percentual, rateio 50/50 se ajusta sozinho pra R$ 1.550/R$ 1.550. Com valor absoluto, o rateio fica quebrado e o usuário precisa reeditar. Zero manutenção com percentual.

Arredondamento em N regionais iguais: última linha ganha o saldo. Ex: R$ 3.000 dividido em 3 partes de 33.33% cada = R$ 999,90 + R$ 999,90 + R$ 1.000,20 (última pega o resto pra fechar em R$ 3.000,00). Renderização faz isso; banco só armazena os 3 percentuais.

### 3.2. Tabelas filhas separadas (uma pra avulsa, outra pra template)

Modelagem 1:N clássica. Alternativa rejeitada: coluna `rateio jsonb`. JSONB dificulta agregação por regional (o DRE futuro faz `GROUP BY regional_id`), quebra integridade referencial (regional deletada não aparece no CHECK), e complica o trigger de validação de soma.

### 3.3. Trigger de banco valida `SUM(percentual) = 100.00`

CHECK inline não funciona porque a validação depende de outras rows da mesma tabela. Trigger `AFTER INSERT OR UPDATE OR DELETE FOR EACH STATEMENT` roda ao fim da transação, computa a soma por `conta_avulsa_id` afetado, e faz `RAISE EXCEPTION` se não fecha 100.

Tolerância: `abs(sum - 100.00) < 0.01` — cobre arredondamento acumulado (33.33 × 3 = 99.99).

### 3.4. Se tem job, trava 100% na regional do job

Ao selecionar job no drawer, `regional_id` = `job.regional_id`, `percentual` = 100.00, campo desabilitado. Se o usuário quer ratear, precisa remover o job primeiro.

Motivo: 90% dos casos com job são "gasto do job específico, 100% da regional dele". Permitir ratear com job introduz cenários confusos ("o job é de Salvador mas 30% caiu em SP?"). Simples e coerente.

### 3.5. Regional obrigatória sempre (mínimo 1 linha)

Não existe conta sem regional. Se não tem job, o usuário adiciona manualmente pelo menos 1 regional (100% ou dividida). Se quiser categorizar contas administrativas centrais, cria regional "Sede" ou "Corporativo" no cadastro `/cadastros/regionais`.

Motivo: relatório de custo por regional só funciona se toda conta cair em alguma. Deixar opcional cria buraco no DRE ("por que R$ 45.000 do mês não tem regional?").

### 3.6. Template guarda o rateio; cron copia pra cada instância

Template recorrente carrega as linhas de rateio como parte do desenho. Toda instância que o cron gera copia o rateio do template pra `contas_avulsas_regionais`. Se o usuário edita o rateio no template, instâncias já geradas ficam intactas — só as próximas nascem com o novo rateio (mesma regra da edição de valor definida na Task 013).

### 3.7. Conciliação não muda — 1 baixa = 1 lançamento

Rateio é metadata contábil, não movimento bancário. `lancamentos_financeiros` continua ganhando 1 linha por baixa. O extrato bancário mostra 1 linha por pagamento — natural, o dinheiro sai de uma conta só.

Único ajuste na tela de conciliação: badge visual "Rateado" na linha do lançamento quando a conta origem tem >1 linha de rateio. Clicar mostra popover com breakdown.

### 3.8. PP fora de escopo desta entrega

PP tem `job_id NOT NULL` obrigatório — herda a regional do job direto (via join na hora de rodar relatório). Não precisa de tabela filha nesta iteração. Se futuramente aparecer necessidade de ratear PP entre regionais, adiciona `pedidos_compra_regionais` seguindo o mesmo padrão.

## 4. Modelagem de dados

### 4.1. `contas_avulsas_regionais`

```sql
create table public.contas_avulsas_regionais (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  conta_avulsa_id   uuid not null references public.contas_avulsas(id) on delete cascade,
  regional_id       uuid not null references public.regionais(id) on delete restrict,
  percentual        numeric(5,2) not null,
  created_at        timestamptz not null default now(),

  constraint chk_avulsa_rateio_percentual_range
    check (percentual > 0 and percentual <= 100),
  constraint uniq_avulsa_regional
    unique (conta_avulsa_id, regional_id)
);

create index idx_avulsa_rateio_conta on public.contas_avulsas_regionais(conta_avulsa_id);
create index idx_avulsa_rateio_tenant on public.contas_avulsas_regionais(tenant_id);
create index idx_avulsa_rateio_regional on public.contas_avulsas_regionais(regional_id);

alter table public.contas_avulsas_regionais enable row level security;

create policy avulsa_rateio_select on public.contas_avulsas_regionais
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy avulsa_rateio_insert on public.contas_avulsas_regionais
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy avulsa_rateio_update on public.contas_avulsas_regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy avulsa_rateio_delete on public.contas_avulsas_regionais
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_regionais to authenticated;
```

**`on delete cascade` da conta_avulsa** — deletar a conta apaga o rateio junto. Coerente com o hard delete de conta pendente existente.

### 4.2. `contas_avulsas_recorrentes_regionais`

Espelha 4.1 pro template:

```sql
create table public.contas_avulsas_recorrentes_regionais (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete restrict,
  recorrente_id     uuid not null references public.contas_avulsas_recorrentes(id) on delete cascade,
  regional_id       uuid not null references public.regionais(id) on delete restrict,
  percentual        numeric(5,2) not null,
  created_at        timestamptz not null default now(),

  constraint chk_rec_rateio_percentual_range
    check (percentual > 0 and percentual <= 100),
  constraint uniq_rec_regional
    unique (recorrente_id, regional_id)
);

create index idx_rec_rateio_recorrente on public.contas_avulsas_recorrentes_regionais(recorrente_id);
create index idx_rec_rateio_tenant on public.contas_avulsas_recorrentes_regionais(tenant_id);
create index idx_rec_rateio_regional on public.contas_avulsas_recorrentes_regionais(regional_id);

alter table public.contas_avulsas_recorrentes_regionais enable row level security;

create policy rec_rateio_select on public.contas_avulsas_recorrentes_regionais
  for select to authenticated using (public.is_tenant_member(tenant_id));
create policy rec_rateio_insert on public.contas_avulsas_recorrentes_regionais
  for insert to authenticated with check (public.is_tenant_member(tenant_id));
create policy rec_rateio_update on public.contas_avulsas_recorrentes_regionais
  for update to authenticated
  using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
create policy rec_rateio_delete on public.contas_avulsas_recorrentes_regionais
  for delete to authenticated using (public.is_tenant_member(tenant_id));

grant select, insert, update, delete on public.contas_avulsas_recorrentes_regionais to authenticated;
```

### 4.3. Trigger de validação `SUM(percentual) = 100.00`

Uma função + 2 triggers (uma pra cada tabela):

```sql
create or replace function public.enforce_rateio_soma_100_avulsa()
returns trigger
language plpgsql
as $$
declare
  v_conta_id uuid;
  v_soma numeric(7,2);
begin
  -- Coleta os conta_avulsa_id afetados na statement
  if tg_op = 'DELETE' then
    v_conta_id := old.conta_avulsa_id;
  else
    v_conta_id := new.conta_avulsa_id;
  end if;

  select coalesce(sum(percentual), 0)
    into v_soma
    from public.contas_avulsas_regionais
   where conta_avulsa_id = v_conta_id;

  -- Se ficou zero (todos deletados durante edição), aceita — final da transação
  -- valida se o INSERT posterior fecha 100.
  if v_soma > 0 and abs(v_soma - 100.00) >= 0.01 then
    raise exception 'Rateio de regional da conta % soma %, deve ser 100.00.',
      v_conta_id, v_soma
      using errcode = 'P0001';
  end if;

  return null;
end;
$$;

create constraint trigger trg_avulsa_rateio_soma
  after insert or update or delete on public.contas_avulsas_regionais
  deferrable initially deferred
  for each row execute function public.enforce_rateio_soma_100_avulsa();
```

**Constraint trigger `DEFERRABLE INITIALLY DEFERRED`** — dispara só no `COMMIT` da transação. Isso permite que o server action apague todas as linhas e insira as novas dentro da mesma transação sem violar temporariamente (`sum = 0` durante a operação intermediária é tolerado; só quando dá `COMMIT` a soma final é validada).

**Aceita `v_soma = 0`** — cobre o caso em que o server action deleta todas antes de inserir as novas. Se der commit com sum = 0 (edição sem inserir nada), o server action garante em código que sempre tem pelo menos 1 linha. Bug potencial: usuário externo (via API) que só deleta e não insere criaria conta sem rateio. Aceito como trade-off pra permitir edição em 2 fases (delete + insert). Se aparecer, adicionar validação em `commit` no server action (contagem >= 1 antes de finalizar transação).

Função + trigger análogos pra `contas_avulsas_recorrentes_regionais`.

## 5. Regras de negócio

### 5.1. Criar conta avulsa com rateio (`criarContaAvulsa`)

Server action `criarContaAvulsa` recebe novo parâmetro:

```ts
rateio: Array<{ regional_id: string; percentual: number }>
```

Validações Zod:

```ts
rateio: z.array(z.object({
  regional_id: z.string().uuid("Selecione a regional."),
  percentual: z.number().min(0.01, "Percentual mínimo 0.01.")
                       .max(100, "Percentual máximo 100."),
})).min(1, "Adicione pelo menos uma regional.")
   .refine(
     (a) => Math.abs(a.reduce((s, r) => s + r.percentual, 0) - 100) < 0.01,
     { message: "A soma dos percentuais deve ser 100.00.", path: ["rateio"] },
   )
   .refine(
     (a) => new Set(a.map((r) => r.regional_id)).size === a.length,
     { message: "Cada regional só pode aparecer uma vez.", path: ["rateio"] },
   )
```

Server action:
1. Zod parse (inclui validação de soma e duplicatas).
2. Gate `admin | financeiro`.
3. Valida cada `regional_id` pertence ao tenant e está ativa (SELECT bulk).
4. Se `input.job_id` está preenchido: valida `rateio.length === 1 && rateio[0].regional_id === job.regional_id && rateio[0].percentual === 100`. Se não bate, retorna erro (não deveria acontecer se a UI está correta — defesa em profundidade).
5. INSERT `contas_avulsas` (fluxo existente).
6. INSERT bulk `contas_avulsas_regionais` na mesma transação.
7. Audit `conta_avulsa.criada` com metadata `rateio_count`.

### 5.2. Editar conta avulsa pendente (`editarContaAvulsa`)

Server action recebe o array completo de rateio (não delta):

**Estratégia "delete all + insert all"** dentro de uma transação:
1. Compara linhas atuais com input. Se idênticas → não faz nada (evita histórico ruidoso).
2. Caso mudou: `DELETE FROM contas_avulsas_regionais WHERE conta_avulsa_id = ?` + `INSERT` bulk das novas. Trigger deferred valida no commit.
3. Registra mudança em `contas_avulsas_historico`:
   - 1 row consolidada: `campo_alterado = 'rateio'`, `valor_anterior = JSON string das linhas antigas`, `valor_novo = JSON string das linhas novas`.
   - Renderização na tela de detalhes traduz o JSON pra "NE 50% → NE 60%, SP 50% → SP 40%".

### 5.3. Job selecionado bloqueia rateio manual

Quando `input.job_id !== null`, o server action ignora `input.rateio` e inserta uma única linha `(job.regional_id, 100.00)`. UI garante o mesmo (Zod não valida esse cross-field porque exige embed do job).

Se o usuário selecionava um rateio e depois marca job, o rateio é substituído.

### 5.4. Criar template recorrente com rateio (`criarContaRecorrente`)

Assinatura análoga:

```ts
rateio: Array<{ regional_id: string; percentual: number }>
```

Validações e fluxo idênticos ao 5.1, mas gravando em `contas_avulsas_recorrentes_regionais`.

### 5.5. Editar template recorrente (`editarContaRecorrente`)

Só edita template (nunca instâncias já geradas — decisão da Task 013). Estratégia delete-all + insert-all na filha `contas_avulsas_recorrentes_regionais`.

### 5.6. Cron copia rateio pra cada instância gerada

Modificar `gerar_ocorrencias_recorrentes()` (RPC do cron):

Após o INSERT em `contas_avulsas` (linha existente que retorna `v_nova_id`), adicionar:

```sql
insert into public.contas_avulsas_regionais (
  tenant_id, conta_avulsa_id, regional_id, percentual
)
select
  v_template.tenant_id, v_nova_id, r.regional_id, r.percentual
from public.contas_avulsas_recorrentes_regionais r
where r.recorrente_id = v_template.id;
```

Trigger de soma é `DEFERRED`, então a transação do cron valida no commit. Se o rateio do template estiver quebrado (não deveria), erro sobe pra o log do cron sem gerar instância.

### 5.7. Baixa e conciliação não mudam

`darBaixaAvulsa` continua igual. `lancamentos_financeiros` ganha 1 linha só. Rateio permanece na conta origem, não migra pro lançamento (a query de DRE futuro faz `JOIN` com `contas_avulsas_regionais` via `lancamentos_financeiros.conta_avulsa_id`).

### 5.8. Estorno de baixa não mexe no rateio

Estornar baixa faz o lançamento reverso mas mantém a conta avulsa e seu rateio intactos. Ao rebaixar (após corrigir), rateio segue o mesmo — sem retrabalho.

### 5.9. Regional inativa

Se a regional referenciada por uma linha do rateio for **inativada** (`ativo=false` em `regionais`), a linha continua válida — histórico intocado. Mas o dropdown do drawer não mostra inativas pra novos rateios. Se o usuário editar uma conta cuja regional atual está inativa, a linha atual continua exibindo a regional (rótulo com "(inativa)") mas não permite mais salvar essa linha sem trocar por uma ativa.

## 6. Server actions + Zod

Arquivo modificado: `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` (`criarContaAvulsa`, `editarContaAvulsa`).

Arquivo modificado: `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts` (`criarContaRecorrente`, `editarContaRecorrente`).

Arquivo modificado: `lib/validations/conta-avulsa.ts` e `lib/validations/conta-recorrente.ts` — schemas ganham `rateio` array.

Arquivo modificado: `supabase/migrations/20260807000004_gerar_recorrentes.sql` — o cron. Mas migrations aplicadas não se modificam. Nova migration `20260808000002_gerar_recorrentes_v2.sql` faz `CREATE OR REPLACE FUNCTION` com o bloco novo de copiar rateio.

## 7. UI

### 7.1. Bloco "Rateio de regional" no drawer

Componente reutilizável `<RateioRegionalEditor>`:

```tsx
<RateioRegionalEditor
  linhas={rateio}
  onChange={setRateio}
  regionais={regionaisAtivas}
  jobRegionalId={jobSelecionado?.regional_id}
  disabled={!!jobSelecionado}
/>
```

Layout:

```
Rateio de regional *
──────────────────────────────
[Select regional ▼]   [ 50.00 ] %   [✖]
[Select regional ▼]   [ 50.00 ] %   [✖]
[ + Adicionar regional ]

Total: 100.00%  ✓
```

- Cada linha: `<Combobox>` de regional ativa (busca) + input numérico (0.01-100) + botão remover.
- Ao adicionar linha: percentual sugerido = restante pra fechar 100.
- Última linha tem indicador visual "auto-calcular" — ao mudar as outras, ela recomputa.
- Total renderizado embaixo em verde (100.00%) ou vermelho (≠ 100). Botão Confirmar do drawer fica desabilitado se ≠ 100.
- Se `disabled` (job selecionado): renderiza 1 linha readonly com "Regional do job — 100%" + hint pt-BR: "Regional herdada do job. Para ratear, remova o job."

Novos arquivos:
- `app/(app)/financeiro/contas-a-pagar/rateio-regional-editor.tsx` — componente reutilizável.

### 7.2. Card "Rateio de regional" nas páginas de detalhes

**Página `/avulsa/[id]`**:

```
Rateio de regional
──────────────────
Nordeste       50.00%   R$ 1.500,00
São Paulo      50.00%   R$ 1.500,00
                        ─────────────
Total 100.00%           R$ 3.000,00
```

Se só 1 linha 100%, mostrar simplificado: `Regional: Nordeste (100%)`.

**Página `/recorrente/[id]`**:

Mesmo card. Mostra o rateio do template (não das instâncias geradas).

### 7.3. Badge "Rateado" na conciliação

Na tela `/financeiro/conciliacao`, na coluna Descrição do lançamento com origem `avulsa_baixa` ou `avulsa_baixa_estornada` ou `avulsa_estorno`, quando o `conta_avulsa_id` referenciar uma conta com `count(contas_avulsas_regionais) > 1`, adicionar badge `[Rateado]` cinza pequeno ao lado da descrição.

Ao **hover** ou **click** no badge, popover mostra:

```
Rateio:
  Nordeste       50.00%   R$ 1.500,00
  São Paulo      50.00%   R$ 1.500,00
```

Implementação: query da conciliação já busca `conta_avulsa_id`. Adicionar embed:

```ts
.select(`
  ..., 
  conta_avulsa:contas_avulsas(
    rateio:contas_avulsas_regionais(percentual, regional:regionais(nome))
  )
`)
```

Se `conta_avulsa.rateio.length > 1`, renderiza badge.

## 8. RLS + GRANTs + Auditoria

Padrão do projeto:
- Ambas tabelas com RLS `is_tenant_member(tenant_id)`.
- Gate `admin | financeiro` no server action.
- COM DELETE policy nas 2 tabelas (rateio se apaga em edição).

Trigger de validação vale pra service_role também (sem bypass) — força consistência independente de quem faz o INSERT.

Novos audit actions:
- `conta_avulsa.rateio_alterado` (metadata: `rateio_anterior`, `rateio_novo`) — logado em `editarContaAvulsa` quando o rateio muda.
- `conta_recorrente.rateio_alterado` (idem).

Auto-log via `contas_avulsas_historico`:
- Registra `campo_alterado = 'rateio'`, com JSON stringificado de antes/depois. Renderização na tela de detalhes traduz pra formato humano.

## 9. Storage

Nenhum — rateio é dado tabular, sem anexos.

## 10. Migrations

### 10.1. `20260808000001_contas_avulsas_regionais.sql`

- CREATE TABLE `contas_avulsas_regionais` + índices + RLS + GRANT.
- CREATE TABLE `contas_avulsas_recorrentes_regionais` + índices + RLS + GRANT.
- CREATE FUNCTION `enforce_rateio_soma_100_avulsa()` + CREATE FUNCTION `enforce_rateio_soma_100_recorrente()`.
- 2 constraint triggers DEFERRABLE INITIALLY DEFERRED.

### 10.2. `20260808000002_gerar_recorrentes_v2.sql`

- CREATE OR REPLACE FUNCTION `gerar_ocorrencias_recorrentes()` com o bloco adicional de copiar rateio do template pra `contas_avulsas_regionais` da instância gerada.

## 11. Fora de escopo desta entrega

- **DRE por regional** — relatório em si é fase futura. Esta entrega prepara a base.
- **Rateio dinâmico por período** — se um contrato muda de rateio ao longo do ano (mês 1-6 = 50/50, mês 7-12 = 70/30). Fase futura. Hoje edição do template só afeta instâncias futuras.
- **Rateio em PP** — PP tem job obrigatório, herda 100% da regional do job por join. Se aparecer necessidade real de ratear PP, adiciona `pedidos_compra_regionais` na mesma linha.
- **Import em massa** — usuário digita manualmente cada rateio. Import via planilha (útil pra migrar dados históricos) fica pra fase futura.
- **Rateio por outro eixo** (empresa, cliente, produto) — só regional. Se aparecer necessidade, expande a modelagem.

## 12. Impacto no código existente

Arquivos a **modificar**:
- `lib/validations/conta-avulsa.ts` — `rateio` no schema.
- `lib/validations/conta-recorrente.ts` — `rateio` no schema.
- `app/(app)/financeiro/contas-a-pagar/actions-avulsas.ts` — `criarContaAvulsa` e `editarContaAvulsa` aceitam rateio.
- `app/(app)/financeiro/contas-a-pagar/actions-recorrentes.ts` — `criarContaRecorrente` e `editarContaRecorrente` aceitam rateio.
- `app/(app)/financeiro/contas-a-pagar/conta-avulsa-drawer.tsx` — usa `<RateioRegionalEditor>`, passa `regionais`, respeita `job.regional_id`.
- `app/(app)/financeiro/contas-a-pagar/conta-recorrente-drawer.tsx` — idem.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/page.tsx` — carrega rateio, passa pro card. Passa `regionais` pro drawer editar.
- `app/(app)/financeiro/contas-a-pagar/recorrente/[id]/page.tsx` — idem.
- `app/(app)/financeiro/contas-a-pagar/page.tsx` — passa `regionais` pra lista/drawer de criar.
- `app/(app)/financeiro/conciliacao/page.tsx` — embed do rateio na query.
- `app/(app)/financeiro/conciliacao/conciliacao-list.tsx` — badge "Rateado" + popover.
- `lib/types.ts` — tipos `ContaAvulsaRateio`, `ContaAvulsaRecorrenteRateio`.
- `lib/auth/audit.ts` — 2 novas audit actions.

Arquivos a **criar**:
- 2 migrations SQL.
- `app/(app)/financeiro/contas-a-pagar/rateio-regional-editor.tsx` — componente reutilizável.
- `app/(app)/financeiro/contas-a-pagar/avulsa/[id]/rateio-card.tsx` — card de detalhes (também usado em `/recorrente/[id]`).

## 13. Riscos e mitigação

- **Trigger de soma dispara errado** — testes SQL manuais das 3 operações (INSERT bulk, UPDATE parcial, DELETE + INSERT) antes de aprovar migration.
- **Regional deletada quebra conta antiga** — FK `on delete restrict` impede DELETE se houver rateio referenciando. Cadastro de regional já usa soft delete (`ativo=false`), então DELETE real é raro.
- **Race condition editando ao mesmo tempo** — 2 usuários editam a mesma conta em paralelo. O `delete-all + insert-all` do editar sobrescreve o outro. Aceito como trade-off (financeiro single-user). Se preocupar, `SELECT FOR UPDATE` no início da transação.
- **Job com regional inativa** — job antigo cuja regional foi inativada. Ao criar avulsa com job, ainda passa (trigger não valida `ativo`). Aceito: histórico. Se a regional do job estiver `ativo=false`, mostrar hint pt-BR "Regional do job está inativa. Considere reativar ou criar sem job." — não bloqueia.
- **Cron falha ao copiar rateio** — se o rateio do template estiver quebrado (shouldn't happen, trigger deferred pega), instância não é criada. Log em `cron.job_run_details`. Mitigação: trigger DEFERRED garante que INSERT no template sempre valida no commit — impossível ter template salvo com rateio inválido.

## 14. Decisões travadas em conversa

1. ✅ Rateio guarda percentual (não valor absoluto).
2. ✅ Tabelas filhas separadas (não JSONB).
3. ✅ Trigger DEFERRABLE INITIALLY DEFERRED valida `SUM = 100.00`.
4. ✅ Job trava 100% na regional do job (não permite ratear com job).
5. ✅ Regional obrigatória sempre (mínimo 1 linha).
6. ✅ Template guarda rateio; cron copia pra cada instância.
7. ✅ Conciliação não muda (1 baixa = 1 lançamento) + badge "Rateado".
8. ✅ Edição do template afeta só instâncias futuras.
9. ✅ PP fora de escopo (fase futura se aparecer necessidade).
10. ✅ Percentual arredondado com "última pega a sobra" na renderização.

---

**Próximo passo:** Antonio revisa esta spec. Se aprovada, invoco `writing-plans` pra gerar o plano de implementação passo a passo.
