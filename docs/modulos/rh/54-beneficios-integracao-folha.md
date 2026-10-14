# 54 — Benefícios: Integração com Folha (Fase 3)

> Spec detalhado da Fase 3 do subsistema de Benefícios. Continua [`50-beneficios.md`](50-beneficios.md), implementa a arquitetura decidida em [ADR 174](../../decisions/174-beneficios-integracao-folha-e-dre.md), e consome a infra da Fase 2 ([`53-beneficios-fechamento-mensal.md`](53-beneficios-fechamento-mensal.md)).

**Status:** aprovado em 2026-10-14. Aguarda implementação.
**Decisões origem:** ADR 174 (§1.1-1.6) + brainstorm 14/10 (B1-B8 em §2 abaixo).
**Entrada:** Fase 2 em produção (tabelas de fechamento, função de cálculo, view do DRE, colunas de vencimento em `beneficios`).
**Saída:** botão "Aplicar descontos" funcional na página da competência da folha + tab Fechamentos read-only em `/rh/beneficios`.

---

## 1. O que a Fase 3 entrega

A Kika, no fim de cada mês, abre `/rh/folhas/[competencia]`. Hoje ela vê 2 checkpoints (PJ gerada + CLT importada) e clica em "Enviar ao financeiro". A partir da Fase 3:

- Aparece um **3º checkpoint**: "Benefícios aplicados".
- Antes de poder enviar, ela clica em "Aplicar descontos", confirma uma vez, e o sistema faz, numa transação atômica:
  1. **Fecha a competência** de benefícios (snapshot em `beneficio_fechamento_mensal` + linhas em `_linha`).
  2. **Reduz `salario_base`** das linhas PJ (`origem='california'`) pelo desconto do colaborador do snapshot. Grava o valor subtraído em `folhas_pagamento.desconto_beneficios` (coluna nova) para auditoria.
  3. **Cria 2 avulsas** (SulAmerica + Bradesco Dental) com valor cheio da fatura (soma de `valor_integral` de todos os vínculos ativos naquela operadora), classificação `05.002 Benefícios`, com FK `beneficio_fechamento_id`.
- Depois disso, o botão "Enviar ao financeiro" habilita e o fluxo segue como hoje.

Também aparece uma **tab nova** em `/rh/beneficios` → **Fechamentos**, read-only, listando todas as competências fechadas com drill-down pra ver o snapshot completo.

**Não entrega:**
- Reconciliação com fatura real da operadora (Kika edita avulsa à mão se vier diferente — ADR 174 §5).
- Edição manual do snapshot (ADR 174 §1.7; brainstorm P2).
- Modal próprio de confirmação (usa `confirm()` nativo, idêntico ao padrão atual).
- Progress bar (só Loader2 no botão).

---

## 2. Decisões travadas no brainstorm (14/10)

Cada letra abaixo responde a uma pergunta aberta deixada pelo ADR 174 ou que surgiu ao desenhar a Fase 3.

- **B1 — Cadastro de fornecedores + FK:** Migration de seed cria SulAmerica + Bradesco Dental como fornecedores mínimos (só nome). Coluna nova `beneficios.fornecedor_id` (FK) é lida pela server action no momento de criar a avulsa; sem lookup por nome. Daniel completa dados bancários/CNPJ pela UI quando necessário.

- **B2 — Qual empresa paga a fatura:** Coluna nova `beneficios.empresa_id` (FK para `empresas`) com default no seed = **Agência California** (`304039bd-509d-4536-aa26-44e7091ee718`). Avulsa gerada herda do catálogo. `regional_id` da avulsa é null (fatura corporativa, sem rateio regional interno).

- **B3 — UI do checkpoint na folha:** Terceiro `CheckpointRow` no grid de `/rh/folhas/[competencia]`, grid passa de `sm:grid-cols-2` → `md:grid-cols-3`. Botão "Aplicar descontos" só aparece quando PJ+CLT verdes. `confirm()` nativo (padrão do projeto). Loader2 enquanto roda. Depois de aplicar: badge verde "☑ Benefícios aplicados · N vínculos · R$ Xk" + botão "Desaplicar" (oculto se qualquer avulsa paga).

- **B4 — UI da tab Fechamentos:** Nova tab em `/rh/beneficios`: `[Colaboradores | Catálogo | Fechamentos]`. Tab Fechamentos lista cronológica com filtro ano. Linha clicável → **página** `/rh/beneficios/fechamentos/[id]` (não drawer; URL compartilhável, consistente com a decisão prévia de migrar colaborador de drawer→página).

- **B5 — Server action = RPC:** Server actions em TypeScript (`aplicarBeneficios`, `desaplicarBeneficios`) são finas; a transação atômica mora em 2 RPCs plpgsql SECURITY DEFINER (`aplicar_fechamento_beneficios`, `desaplicar_fechamento_beneficios`). Motivo: snapshot+folha+avulsa não pode ficar meio-feito; RPC é o padrão (`criar_conta_avulsa`, outras).

- **B6 — Trava do Desaplicar:** Reaplicar não é permitido se qualquer `contas_avulsas.beneficio_fechamento_id = X` tem `pago_em is not null`. Mensagem direciona pro financeiro: *"Não dá pra desaplicar: avulsa Y já foi paga em DD/MM. Pra reverter, estorne a avulsa pelo financeiro primeiro."* UI oculta o botão nessa condição (não só disabled).

- **B7 — Audit events:** `beneficio.fechamento.aplicado` com metadata `{ ano, mes, qtd_vinculos, total_empresa, total_colaborador, avulsas: [{id, operadora, valor}], folha_linhas_afetadas }`. `beneficio.fechamento.desaplicado` com `{ fechamento_id, ano, mes, motivo: 'manual' }`.

- **B8 — Validação de precondição:** Server action valida ANTES de abrir transação:
  - Todo `beneficios.ativo = true` tem `fornecedor_id`, `empresa_id`, `dia_vencimento_fatura` populados.
  - Não existe fechamento vigente (`reaberto_em is null`) pra essa competência.
  - Pelo menos 1 vínculo ativo na competência.
  Mensagens de erro são explícitas e dizem onde consertar. UI espelha via tooltip no botão.

---

## 3. Modelo de dados

### 3.1 Novas colunas em `beneficios`

```sql
alter table public.beneficios
  add column fornecedor_id uuid references public.fornecedores(id) on delete restrict,
  add column empresa_id uuid references public.empresas(id) on delete restrict;

create index idx_beneficios_fornecedor on public.beneficios (fornecedor_id)
  where fornecedor_id is not null;
create index idx_beneficios_empresa on public.beneficios (empresa_id)
  where empresa_id is not null;
```

**Nulidade:** ambas ficam nullable **após a migration de seed** (abaixo), porque o enforcement de "preenchido" é feito pela server action com mensagem amigável, não por `NOT NULL` que daria erro genérico.

### 3.2 Seed inicial

```sql
-- 1. Insere SulAmerica + Bradesco Dental como fornecedores mínimos
insert into public.fornecedores (tenant_id, nome)
values
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, 'SulAmerica Saude'),
  ('d2a02c10-9c7e-4157-8dd5-84bbf5a7044c'::uuid, 'Bradesco Dental');

-- 2. Atualiza catálogo apontando pra fornecedor + empresa (Agência California)
update public.beneficios
set
  fornecedor_id = (select id from public.fornecedores where nome = 'SulAmerica Saude' and tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'),
  empresa_id = '304039bd-509d-4536-aa26-44e7091ee718'
where operadora ilike 'SulAmerica%';

update public.beneficios
set
  fornecedor_id = (select id from public.fornecedores where nome = 'Bradesco Dental' and tenant_id = 'd2a02c10-9c7e-4157-8dd5-84bbf5a7044c'),
  empresa_id = '304039bd-509d-4536-aa26-44e7091ee718'
where operadora ilike 'Bradesco%';
```

**Pré-condição runtime:** Daniel completa dados bancários dos 2 fornecedores pela UI do financeiro antes do primeiro "Aplicar descontos" rodar em produção. Se faltar, a remessa não é gerada (ADR 174 §1.8: a remessa continua só com fornecedor; benefícios são pagos manualmente pelo PDF).

### 3.3 Nova coluna em `folhas_pagamento`

```sql
alter table public.folhas_pagamento
  add column desconto_beneficios numeric(10, 2) not null default 0
    check (desconto_beneficios >= 0);

comment on column public.folhas_pagamento.desconto_beneficios is
  'Valor subtraído do salario_base ao aplicar o fechamento mensal de benefícios (Fase 3). salario_base armazena o valor LÍQUIDO (pós-desconto); esta coluna existe para auditoria e para a reversão em "Desaplicar". Só populado em linhas com origem=''california'' (PJ gerada). Linhas CLT (origem=''contabilidade'') ficam sempre em 0.';
```

### 3.4 Nova coluna em `contas_avulsas`

```sql
alter table public.contas_avulsas
  add column beneficio_fechamento_id uuid references public.beneficio_fechamento_mensal(id) on delete restrict;

create index idx_contas_avulsas_beneficio_fechamento
  on public.contas_avulsas (beneficio_fechamento_id)
  where beneficio_fechamento_id is not null;

comment on column public.contas_avulsas.beneficio_fechamento_id is
  'Avulsa de operadora de benefício (SulAmerica/Bradesco) gerada pelo fechamento mensal da Fase 3. Permite rastrear a fatura ao snapshot (quem contribuiu com quanto). Null em todas as outras avulsas.';
```

**`on delete restrict` deliberado:** apagar um fechamento com avulsa referência quebra integridade. "Desaplicar" apaga a avulsa primeiro (via RPC), depois deleta o fechamento linha, depois marca cabeçalho como reaberto.

### 3.5 RPC `aplicar_fechamento_beneficios`

Assinatura:

```sql
create or replace function public.aplicar_fechamento_beneficios(
  p_tenant_id uuid,
  p_ano int,
  p_mes int
)
returns table (
  fechamento_id uuid,
  qtd_vinculos int,
  total_empresa numeric,
  total_colaborador numeric,
  folha_linhas_afetadas int,
  avulsas jsonb
)
language plpgsql
security definer
as $$
...
$$;
```

**Lógica (em transação implícita de função):**

1. **Precondições**:
   - Permissão: `is_tenant_admin(p_tenant_id) OR is_tenant_rh(p_tenant_id)` → senão `raise exception 'permissao_negada'`.
   - Benefícios ativos sem `fornecedor_id`/`empresa_id`/`dia_vencimento_fatura` → `raise exception 'catalogo_incompleto: %', nome_do_beneficio`.
   - Fechamento vigente já existe pra essa competência → `raise exception 'competencia_ja_aplicada'`.
   - Nenhum vínculo ativo → `raise exception 'nenhum_vinculo_ativo'`.

2. **Insere cabeçalho** em `beneficio_fechamento_mensal` (`fechado_por = auth.uid()`).

3. **Insere linhas** com `insert ... select` da `fn_beneficios_calcular_fechamento(p_tenant_id, p_ano, p_mes)`. Captura `qtd_vinculos` = count.

4. **Reduz salário PJ**:
   ```sql
   update folhas_pagamento fp
   set salario_base = fp.salario_base - sub.desc_total,
       desconto_beneficios = sub.desc_total
   from (
     select l.colaborador_id, sum(l.valor_colaborador) as desc_total
     from beneficio_fechamento_linha l
     where l.fechamento_id = v_fechamento_id
     group by l.colaborador_id
   ) sub
   where fp.colaborador_id = sub.colaborador_id
     and fp.competencia_ano = p_ano
     and fp.competencia_mes = p_mes
     and fp.origem = 'california';
   -- GET DIAGNOSTICS folha_linhas_afetadas = ROW_COUNT;
   ```

5. **Cria 1 avulsa por operadora** chamando `criar_conta_avulsa` existente:
   ```sql
   for r_op in
     select
       b.fornecedor_id,
       b.empresa_id,
       b.operadora,
       b.dia_vencimento_fatura,
       b.vencimento_mes_seguinte,
       sum(l.valor_integral) as valor_cheio,
       count(*) as qtd_vinculos_op
     from beneficio_fechamento_linha l
     join beneficios b on b.id = l.beneficio_id
     where l.fechamento_id = v_fechamento_id
     group by b.fornecedor_id, b.empresa_id, b.operadora, b.dia_vencimento_fatura, b.vencimento_mes_seguinte
   loop
     v_data_venc := case
       when r_op.vencimento_mes_seguinte
         then make_date(p_ano, p_mes, 1) + interval '1 month' + (r_op.dia_vencimento_fatura - 1)
         else make_date(p_ano, p_mes, r_op.dia_vencimento_fatura)
     end::date;
     v_descricao := format('Benefícios %s · competência %s/%s', r_op.operadora, lpad(p_mes::text, 2, '0'), p_ano);
     perform criar_conta_avulsa(jsonb_build_object(
       'tenant_id', p_tenant_id,
       'empresa_id', r_op.empresa_id,
       'fornecedor_id', r_op.fornecedor_id,
       'descricao', v_descricao,
       'valor', r_op.valor_cheio,
       'data_prevista_pagamento', v_data_venc,
       'natureza', 'despesa',
       'plano_conta_subtipo_id', (select id from plano_contas_subtipos where codigo = '05.002' limit 1),
       'beneficio_fechamento_id', v_fechamento_id,
       'competencia', make_date(p_ano, p_mes, 1)
     ));
   end loop;
   ```

6. **Retorna** `fechamento_id`, totais e `avulsas` jsonb com `[{id, operadora, valor}]` pra server action logar audit.

**Nota de implementação:** se `criar_conta_avulsa` RPC não aceitar `beneficio_fechamento_id` no `p_dados` hoje, adicionar o campo na RPC existente (mudança aditiva ao schema interno dela — não quebra chamadas existentes que não enviam). Decidir no momento com base no diff da RPC atual.

### 3.6 RPC `desaplicar_fechamento_beneficios`

```sql
create or replace function public.desaplicar_fechamento_beneficios(
  p_fechamento_id uuid
)
returns void
language plpgsql
security definer
as $$
...
$$;
```

**Lógica:**

1. Carrega `v_f = select * from beneficio_fechamento_mensal where id = p_fechamento_id` + check de permissão (admin/rh do tenant).
2. Se `v_f.reaberto_em is not null` → `raise exception 'ja_reaberto'`.
3. Se existe `select 1 from contas_avulsas where beneficio_fechamento_id = p_fechamento_id and pago_em is not null limit 1` → `raise exception 'avulsa_ja_paga: %', codigo_da_avulsa`.
4. **Reverte folha**: `update folhas_pagamento set salario_base = salario_base + desconto_beneficios, desconto_beneficios = 0 where competencia_ano = v_f.ano and competencia_mes = v_f.mes and origem = 'california' and desconto_beneficios > 0`.
5. **Apaga avulsas**: `delete from contas_avulsas where beneficio_fechamento_id = p_fechamento_id`.
6. **Apaga linhas**: `delete from beneficio_fechamento_linha where fechamento_id = p_fechamento_id` (ou deixa pelo cascade do passo 7).
7. **Marca cabeçalho reaberto**: `update beneficio_fechamento_mensal set reaberto_em = now(), reaberto_por = auth.uid() where id = p_fechamento_id`.
   - **Decisão:** marca reaberto em vez de deletar o cabeçalho, pra manter histórico "foi aplicado em X, reaberto em Y".
   - A view `vw_dre_despesa_pessoal_ajustada_mensal` já filtra `reaberto_em is null`, então some do DRE automaticamente.

### 3.7 GRANTs

```sql
grant execute on function public.aplicar_fechamento_beneficios(uuid, int, int) to authenticated;
grant execute on function public.desaplicar_fechamento_beneficios(uuid) to authenticated;
```

As RPCs são SECURITY DEFINER com check interno de permissão; `authenticated` chama via server action.

---

## 4. Server actions (TypeScript)

Arquivo novo: `lib/actions/beneficios/fechamento.ts`.

### 4.1 `aplicarBeneficios({ ano, mes })`

```typescript
export async function aplicarBeneficios({
  ano,
  mes,
}: { ano: number; mes: number }): Promise<
  | { ok: true; fechamentoId: string; totalEmpresa: number; totalColaborador: number; qtdVinculos: number; avulsas: Array<{ id: string; operadora: string; valor: number }> }
  | { ok: false; message: string }
> {
  const supabase = await createClient();
  const { tenantId } = await getActiveTenant();

  const { data, error } = await supabase.rpc("aplicar_fechamento_beneficios", {
    p_tenant_id: tenantId,
    p_ano: ano,
    p_mes: mes,
  });

  if (error) {
    // Mensagens customizadas pros raise exception conhecidos
    const msg = error.message;
    if (msg.includes("permissao_negada")) return { ok: false, message: "Você não tem permissão para aplicar benefícios." };
    if (msg.includes("competencia_ja_aplicada")) return { ok: false, message: `A competência ${mes}/${ano} já está aplicada. Desaplique antes de reaplicar.` };
    if (msg.includes("catalogo_incompleto")) return { ok: false, message: `Catálogo de benefícios incompleto: ${msg.split("catalogo_incompleto: ")[1]}. Edite em /rh/beneficios → Catálogo.` };
    if (msg.includes("nenhum_vinculo_ativo")) return { ok: false, message: `Nenhum vínculo ativo na competência ${mes}/${ano}.` };
    console.error("[beneficios.aplicar]", error);
    return { ok: false, message: "Erro ao aplicar descontos de benefícios. Veja o log do servidor." };
  }

  const row = data[0];
  await logAuditEvent({
    acao: "beneficio.fechamento.aplicado",
    tenantId,
    entidadeTipo: "beneficio_fechamento_mensal",
    entidadeId: row.fechamento_id,
    metadata: {
      ano,
      mes,
      qtd_vinculos: row.qtd_vinculos,
      total_empresa: row.total_empresa,
      total_colaborador: row.total_colaborador,
      folha_linhas_afetadas: row.folha_linhas_afetadas,
      avulsas: row.avulsas,
    },
  });

  revalidatePath(`/rh/folhas/${ano}-${String(mes).padStart(2, "0")}`);
  revalidatePath("/rh/beneficios");

  return {
    ok: true,
    fechamentoId: row.fechamento_id,
    totalEmpresa: row.total_empresa,
    totalColaborador: row.total_colaborador,
    qtdVinculos: row.qtd_vinculos,
    avulsas: row.avulsas,
  };
}
```

### 4.2 `desaplicarBeneficios({ fechamentoId })`

```typescript
export async function desaplicarBeneficios({
  fechamentoId,
}: { fechamentoId: string }): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = await createClient();
  const { tenantId } = await getActiveTenant();

  // Busca ano/mes antes pro revalidate
  const { data: f } = await supabase
    .from("beneficio_fechamento_mensal")
    .select("ano, mes")
    .eq("id", fechamentoId)
    .single();

  const { error } = await supabase.rpc("desaplicar_fechamento_beneficios", {
    p_fechamento_id: fechamentoId,
  });

  if (error) {
    const msg = error.message;
    if (msg.includes("permissao_negada")) return { ok: false, message: "Sem permissão." };
    if (msg.includes("ja_reaberto")) return { ok: false, message: "Esta competência já foi reaberta." };
    if (msg.includes("avulsa_ja_paga")) {
      const codigo = msg.split("avulsa_ja_paga: ")[1];
      return { ok: false, message: `Não dá pra desaplicar: avulsa ${codigo} já foi paga. Estorne a avulsa pelo financeiro primeiro.` };
    }
    console.error("[beneficios.desaplicar]", error);
    return { ok: false, message: "Erro ao desaplicar. Veja o log do servidor." };
  }

  await logAuditEvent({
    acao: "beneficio.fechamento.desaplicado",
    tenantId,
    entidadeTipo: "beneficio_fechamento_mensal",
    entidadeId: fechamentoId,
    metadata: { fechamento_id: fechamentoId, ano: f?.ano, mes: f?.mes, motivo: "manual" },
  });

  if (f) revalidatePath(`/rh/folhas/${f.ano}-${String(f.mes).padStart(2, "0")}`);
  revalidatePath("/rh/beneficios");

  return { ok: true };
}
```

---

## 5. UI

### 5.1 Checkpoint na folha

Arquivo modificado: `app/(app)/rh/folhas/_components/checklist-competencia.tsx`.

- Grid externo passa de `sm:grid-cols-2` → `md:grid-cols-3`.
- Novo `CheckpointRow` após CLT:
  - `rotulo="Benefícios aplicados"`
  - `detalhe` quando feito: `"145 vínculos · R$ 110.5k"` (valor_integral total do snapshot vigente).
  - `detalhe` quando não feito: `"Nenhuma competência fechada ainda"`.
  - `acao` quando `podeEditar && temPj && temClt && !temBenef`: `<BotaoAplicarBeneficios ano mes />`.
  - `acao` quando `podeEditar && temBenef && !temAvulsaPaga`: `<BotaoDesaplicarBeneficios fechamentoId />` (secundário, outline).
- `podeEnviar` ganha dependência: `temPj && temClt && temBenef && rascunhosAEnviar > 0`.
- Tooltip no botão "Enviar ao financeiro" quando falta: "Aplique os descontos de benefícios antes de enviar."

**Novos componentes:**
- `app/(app)/rh/folhas/_components/botao-aplicar-beneficios.tsx` — client component, `confirm()` nativo, chama `aplicarBeneficios`, `Loader2` enquanto roda, trata erro em `setErro`.
- `app/(app)/rh/folhas/_components/botao-desaplicar-beneficios.tsx` — client component, `confirm()` com texto de aviso, chama `desaplicarBeneficios`.

**Texto do confirm do Aplicar:**

> "Aplicar descontos de benefícios à competência MM/AAAA?
>
> Isso vai:
> • Reduzir R$ XX,XX das linhas PJ (apenas colaboradores com vínculo ativo).
> • Gerar 2 avulsas: SulAmerica R$ YY,YY (vence DD/MM) e Bradesco R$ ZZ,ZZ (vence DD/MM).
> • Marcar a competência como fechada em Benefícios.
>
> Depois disso, não dá pra reaplicar sem desaplicar primeiro."

Os valores no texto do confirm vêm de uma **função de preview** (`previsualizarAplicacao(ano, mes)`) que chama `fn_beneficios_calcular_fechamento` sem gravar — pra Kika ver o que vai acontecer antes de confirmar. Essa função pode já existir como `fn_beneficios_calcular_fechamento`, só precisa de um wrapper client-side que soma os totais.

### 5.2 Tab Fechamentos em `/rh/beneficios`

Arquivo modificado: `app/(app)/rh/beneficios/page.tsx` — adiciona 3ª tab "Fechamentos".

Arquivo novo: `app/(app)/rh/beneficios/_components/tab-fechamentos.tsx`.

**Layout:**

```tsx
<div className="space-y-4">
  <div className="flex items-center justify-between">
    <SelectAno value={ano} onChange={setAno} options={anosDisponiveis} />
  </div>

  <div className="rounded-xl border bg-card shadow-soft">
    <table>
      <thead>
        <tr><th>Competência</th><th>Status</th><th>Fechado em</th><th>Por</th><th>Empresa</th><th>Colaborador</th><th>Vínculos</th></tr>
      </thead>
      <tbody>
        {fechamentos.map(f => (
          <LinhaClicavel href={`/rh/beneficios/fechamentos/${f.id}`}>
            <td>{labelCompetencia(f.ano, f.mes)}</td>
            <td><BadgeStatus reabertoEm={f.reaberto_em} /></td>
            <td>{formatDate(f.fechado_em)}</td>
            <td>{f.fechado_por_nome}</td>
            <td>{brl(f.total_empresa)}</td>
            <td>{brl(f.total_colaborador)}</td>
            <td>{f.qtd_vinculos}</td>
          </LinhaClicavel>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

- Linha clicável completa (padrão do projeto; memória `feedback_ui_linha_clicavel`).
- Empty state quando não há fechamentos no ano: "Nenhuma competência fechada em {ano}. Fechamentos são criados pela página da folha mensal."

### 5.3 Página de detalhe `/rh/beneficios/fechamentos/[id]`

Server component. Arquivo novo: `app/(app)/rh/beneficios/fechamentos/[id]/page.tsx`.

```
Breadcrumb: Benefícios › Fechamentos › Outubro/2026

PageHeader
  Título: Outubro/2026
  Subtítulo: Fechado em 14/11 10:32 por Daniel G.
  Status chip: ☑ Aplicado  (ou  ⟲ Reaberto em DD/MM por X)
  Ações: [Desaplicar] (oculto se avulsa paga ou já reaberto)

KPIs (3 cards): Custo empresa | Custo colaborador | Valor integral (bruto)

Cards por operadora (horizontal flex):
  ┌─ SulAmérica ──────────────┐  ┌─ Bradesco Dental ─┐
  │ 145 vínculos              │  │ 37 vínculos         │
  │ Integral:   R$ 110.500,00 │  │ Integral:  R$ 962,00│
  │ Empresa:    R$ 56.300,00  │  │ Empresa:   R$ 0,00  │
  │ Colab.:     R$ 54.200,00  │  │ Colab.:    R$ 962,00│
  │ Vencimento: 05/11/2026    │  │ Vencimento: 29/11/26│
  │ [Ver avulsa gerada →]     │  │ [Ver avulsa gerada →]│
  └───────────────────────────┘  └─────────────────────┘

Tabela de linhas (filtro por operadora + busca por nome):
  Colaborador | Benefício | Operadora | Modo custeio | Idade | Titular | Deps | Integral | Empresa | Colab. | Qtd deps
  ... (uma linha por beneficio_fechamento_linha)
```

- Tabela usa o mesmo padrão da aba Colaboradores: filtros no header, scroll vertical com `table-fixed`.
- "Ver avulsa gerada →" é um `<Link href={/financeiro/contas-a-pagar/avulsa/${avulsaId}}>` com `prefetch={false}` (padrão).

---

## 6. Queries novas (`lib/queries/beneficios.ts`)

- `listarFechamentos(tenantId, ano)` → lista pra tab, com join em `profiles` pra pegar `fechado_por_nome` e agregados.
- `obterFechamento(fechamentoId)` → cabeçalho + agregados por operadora + linhas, pra página de detalhe.
- `temAvulsaPaga(fechamentoId)` → bool, usado pra decidir se botão Desaplicar aparece.
- `obterFechamentoVigenteDaCompetencia(tenantId, ano, mes)` → cabeçalho + totais, usado pelo checklist da folha pra mostrar "☑ Benefícios aplicados · 145 · R$ 110.5k".
- `previsualizarAplicacao(tenantId, ano, mes)` → chama `fn_beneficios_calcular_fechamento` sem gravar, agrega por operadora. Usado pelo texto do `confirm()`.

---

## 7. Audit

Dois eventos novos reconhecidos pelo `log_audit_event`:

- `beneficio.fechamento.aplicado` metadata: `{ ano, mes, qtd_vinculos, total_empresa, total_colaborador, folha_linhas_afetadas, avulsas: [{ id, operadora, valor }] }`.
- `beneficio.fechamento.desaplicado` metadata: `{ fechamento_id, ano, mes, motivo: 'manual' }`.

Nenhum enum de audit precisa ser alterado — o `acao` é texto livre, convenção `<entidade>.<verbo>` já estabelecida.

---

## 8. Tipos (`lib/types.ts`)

Adicionar:

```ts
export interface AplicarBeneficiosResult {
  fechamentoId: string;
  totalEmpresa: number;
  totalColaborador: number;
  qtdVinculos: number;
  avulsas: Array<{ id: string; operadora: string; valor: number }>;
}

export interface FechamentoRow extends BeneficioFechamentoMensal {
  fechado_por_nome: string | null;
  total_empresa: number;
  total_colaborador: number;
  valor_integral: number;
  qtd_vinculos: number;
}

export interface FechamentoDetalhe {
  cabecalho: FechamentoRow;
  por_operadora: Array<{
    operadora: string;
    qtd_vinculos: number;
    valor_integral: number;
    valor_empresa: number;
    valor_colaborador: number;
    avulsa_id: string | null;
    avulsa_codigo: string | null;
    avulsa_vencimento: string | null;
    avulsa_pago_em: string | null;
  }>;
  linhas: BeneficioFechamentoLinha[];
}
```

---

## 9. Ordem de migrations

Fase 3 é 2 migrations (podem viver no mesmo PR, aplicadas em ordem):

**Migration 1 — Schema e seed:** `2026MMDD000001_beneficios_fase3_schema.sql`
1. ALTER `beneficios` ADD `fornecedor_id`, `empresa_id`.
2. ALTER `folhas_pagamento` ADD `desconto_beneficios`.
3. ALTER `contas_avulsas` ADD `beneficio_fechamento_id` + índice.
4. INSERT em `fornecedores` (SulAmerica + Bradesco Dental).
5. UPDATE em `beneficios` populando `fornecedor_id` + `empresa_id`.
6. COMMENT ON em todas as colunas novas.

**Migration 2 — RPCs:** `2026MMDD000002_beneficios_fase3_rpcs.sql`
1. CREATE OR REPLACE `aplicar_fechamento_beneficios`.
2. CREATE OR REPLACE `desaplicar_fechamento_beneficios`.
3. (Se necessário) ALTER à RPC `criar_conta_avulsa` pra aceitar `beneficio_fechamento_id` no `p_dados`.
4. GRANT execute pros 2 novos.

Mudança destrutiva: **zero**. Tudo aditivo.

---

## 10. Verificação pós-migration (via MCP)

- [ ] `beneficios` tem `fornecedor_id` e `empresa_id` populados em TODAS as linhas `ativo = true`.
- [ ] `fornecedores` tem 2 linhas novas (SulAmerica Saude + Bradesco Dental).
- [ ] `folhas_pagamento.desconto_beneficios` existe com default 0 e check `>= 0`.
- [ ] `contas_avulsas.beneficio_fechamento_id` existe com FK pra `beneficio_fechamento_mensal` e `on delete restrict`.
- [ ] `aplicar_fechamento_beneficios(tenant, ano, mes)` existe; `grant execute` pra `authenticated`.
- [ ] `desaplicar_fechamento_beneficios(fechamento_id)` existe; `grant execute` pra `authenticated`.
- [ ] Teste end-to-end em desenvolvimento com 1 competência de teste:
  - Aplicar → cabeçalho criado, N linhas criadas, folha reduzida, 2 avulsas criadas, audit gravado.
  - Desaplicar antes de pagar → salario_base volta, avulsas somem, cabeçalho vira reaberto.
  - Tentar aplicar sem fornecedor_id → erro `catalogo_incompleto`.
  - Tentar aplicar 2x → erro `competencia_ja_aplicada`.
  - Marcar avulsa como paga → tentar desaplicar → erro `avulsa_ja_paga`.

---

## 11. Review Focus

Classes de input e falhas que a spec implica mas que nenhum teste automatizado garante.

1. **Dependente incluído durante o mês**: ADR 174 §1.5 — vigência começa no 1º dia da competência seguinte. O snapshot da Fase 2 já conta deps com `data_inicio <= último dia do mês`. Verificar que, ao aplicar outubro, deps criados em outubro **com vigência outubro** entram; deps com vigência novembro NÃO entram. **Pinado em §10 teste manual.**

2. **Colaborador com vínculo iniciando no meio do mês**: `data_inicio = 2026-10-15` deve entrar no snapshot de outubro (regra atual: ativo se `data_inicio <= último dia do mês`). Confirmar que a Fase 2 trata esse caso (não houve mudança aqui; mas é fácil ter regressão).

3. **Vínculo encerrando no meio do mês**: `data_fim = 2026-10-15`. Pela regra `data_fim > primeiro dia do mês`, ele AINDA entra em outubro. Isso é intencional (Kika disse: desligamento no meio do mês paga o mês cheio). Validar.

4. **Fornecedor existe mas sem CNPJ/dados bancários**: aplicar deve rodar normalmente (`criar_conta_avulsa` já aceita fornecedor incompleto hoje). A remessa é que não gera. Confirmar que a avulsa aparece em Contas a Pagar e Daniel pode pagar manualmente.

5. **Edição do catálogo DEPOIS do fechamento**: mudar `percentual_empresa_titular` de 60 → 70 depois de aplicar outubro. Snapshot de outubro NÃO muda (imutável). Snapshot de novembro usa o novo valor. **Pinado em teste manual.**

---

## 12. O que fica fora da Fase 3

- **Reconciliação automática com fatura real** da operadora (ADR 174 §5).
- **Encargos CLT** (INSS, FGTS, IRRF) — rota pela contabilidade.
- **Benefícios de sócio** (fora do catálogo, 50-beneficios.md §3).
- **Remessa de pagamento** pros 2 fornecedores novos (ADR 174 §1.8: pagamento manual pelo PDF até Daniel decidir incluir benefícios na remessa).
- **Fase 4 (DRE)**: a view `vw_dre_despesa_pessoal_ajustada_mensal` já existe desde a Fase 2; a tela do DRE que consome essa view é outra fase.

---

## 13. Critério de pronto

Fase 3 pronta quando:

- [ ] 2 migrations aplicadas em produção via MCP (schema + RPCs).
- [ ] Checklist §10 todo verde.
- [ ] `lib/types.ts` + `lib/actions/beneficios/fechamento.ts` + `lib/queries/beneficios.ts` adicionados/atualizados.
- [ ] UI do checkpoint na folha funcionando: aplicar/desaplicar/habilitar "Enviar".
- [ ] Tab Fechamentos em `/rh/beneficios` listando + página de detalhe funcionando.
- [ ] 1 competência real aplicada em produção com Daniel conferindo os valores contra a fatura antes do primeiro pagamento.
- [ ] `tsc`, `lint`, `build` limpos.
- [ ] Commits em `main`, sem push automático (padrão do projeto).
