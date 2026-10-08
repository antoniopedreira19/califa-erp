# Anexo de NF por colaborador PJ no fluxo de folha

Data: 2026-10-07
Status: Design aprovado em brainstorm. Pendente de revisão e aprovação do spec antes do plano de implementação.

## Problema

Colaboradores PJ precisam entregar NF mensal pra receber o pagamento da competência. Hoje isso é feito fora do sistema (WhatsApp/e-mail), com dois efeitos ruins:

1. **Rastreabilidade zero**: ninguém sabe quem já enviou e quem está atrasado sem perguntar.
2. **Risco de aprovação sem NF**: financeiro pode aprovar e gerar `contas_avulsas` pra uma linha PJ cuja NF nunca chegou — depois, na hora de pagar, descobre o problema e trava o pagamento.

Além disso, a California tem **duas janelas de pagamento** com regra temporal:

- **Janela de salários** (dia 03 do mês seguinte à competência): quem entregou NF até dia 25 do mês da competência.
- **Janela de fornecedores** (dia 08 do mês seguinte): quem perdeu o prazo — emite NF só no mês seguinte e cai nessa janela.

A trava no sistema precisa refletir essa realidade: NF é pré-requisito pra pagamento, e a data do upload decide em qual janela a linha entra.

## Escopo

Anexo de NF obrigatório pra linhas de folha com:
- `origem = 'california'` E
- `tipo_contratacao in ('pj', 'mei', 'clt_recibo')` — todas as linhas que a California gera e paga diretamente.

Linhas de `origem = 'contabilidade'` (`clt`, `estagio`, `socio`, parte CLT do híbrido) **não exigem NF** — são folha de pagamento, não prestação de serviço.

## Decisões de design

### D1 — NF por competência, não por linha de folha

Tabela `colaboradores_nf_anexos` indexada por `(colaborador_id, competencia_ano, competencia_mes)`, não por `folha_pagamento_id`. Motivos:

- Colaborador pode anexar NF **antes** do RH gerar a folha PJ. O documento vive por conta própria.
- Se a linha de folha for regenerada (ex: operador apaga e recria), a NF persiste.
- Match na hora da aprovação é um JOIN pela chave de competência.

Unique constraint em `(tenant_id, colaborador_id, competencia_ano, competencia_mes)` → **1 NF por mês por colaborador**.

### D2 — Reenvio sobrescreve, sem histórico no MVP

Se o colaborador fizer upload de novo arquivo pra mesma competência, o anterior é removido (Storage) e substituído. Não guardamos histórico de versões. Se precisar auditoria depois, cria `nf_anexos_historico` como tabela irmã.

Reutilização de `uploaded_at`: a data do **último** upload é a que vale pra decidir a janela de pagamento. Reenviar depois do dia 25 move a linha pra janela de fornecedores, mesmo que o primeiro upload tenha sido no prazo.

### D3 — Trava morde na aprovação da linha, não no envio da competência

- RH pode **enviar a competência inteira** ao financeiro mesmo com NFs faltando — o fluxo não trava aqui.
- Financeiro **não consegue aprovar** linha PJ sem NF: botão "Aprovar" fica disabled no drawer; `aprovarLinhaFolha` retorna erro se tentar via API.
- Linhas CLT/Estagiário/Sócio aprovam normalmente, sem exigência de NF.

Motivo: desacoplar fluxos. O RH termina sua parte quando a folha está correta; o financeiro só aprova o que está pronto pra pagar.

### D4 — Dia 25 do mês da competência define a janela

- Upload com `uploaded_at <= dia 25 do mês da competência (23:59:59)` → **janela de salários** (dia 03 do mês seguinte).
- Upload depois → **janela de fornecedores** (dia 08 do mês seguinte).

A janela é derivada em tempo de leitura — não precisa coluna nova. Uma função helper no servidor devolve `{ janela: 'salarios' | 'fornecedores', data_prevista: '2026-11-03' }`.

**Upload nunca é bloqueado por data.** Mesmo depois do prazo o colaborador anexa; só muda a janela que a linha vai entrar.

### D5 — RH pode anexar como fallback

Nem todo colaborador PJ tem `user_id` vinculado (não acessa o sistema). Pra esses, o RH anexa pelo cadastro do colaborador em `/rh/colaboradores/[id]` — card novo "NF por competência" paralelo ao atual "Documentos".

Permissão separa:
- `rh.nf.anexar_propria` → autenticado com `user_id` vinculado a `colaboradores.user_id`. Vê e anexa só a própria.
- `rh.nf.anexar_qualquer` → `administrador`, `rh`. Pode anexar/substituir pra qualquer colaborador.
- `rh.nf.ver` → `administrador`, `rh`, `financeiro`. Pode baixar e visualizar.

### D6 — Badge "NF anexada" na listagem do RH

Na página `/rh/folhas/[competencia]`, cada linha PJ ganha um badge "NF ✓" ao lado dos existentes (PJ/Recibo/CLT, Híbrido). RH vê de relance quem já entregou e quem falta. Não aparece em linhas CLT/estagio/socio (não exigem NF).

Na listagem do financeiro (`/financeiro/contas-a-pagar` aba Folhas): **não** adicionar badge — o botão de aprovar já comunica (disabled quando falta NF). Evita poluir uma lista que já é densa.

## Modelo de dados

### Migration — tabela `colaboradores_nf_anexos`

```sql
CREATE TABLE public.colaboradores_nf_anexos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  colaborador_id uuid NOT NULL REFERENCES public.colaboradores(id) ON DELETE CASCADE,
  competencia_ano int NOT NULL,
  competencia_mes int NOT NULL CHECK (competencia_mes BETWEEN 1 AND 12),
  arquivo_path text NOT NULL,
  arquivo_nome text NOT NULL,
  arquivo_tamanho_bytes int NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX colaboradores_nf_anexos_competencia_idx
  ON public.colaboradores_nf_anexos (tenant_id, colaborador_id, competencia_ano, competencia_mes);

CREATE INDEX colaboradores_nf_anexos_colab_idx
  ON public.colaboradores_nf_anexos (colaborador_id);

ALTER TABLE public.colaboradores_nf_anexos ENABLE ROW LEVEL SECURITY;

-- SELECT: autenticado do tenant E (dono do colaborador OU RH/admin/financeiro).
-- Como a UI do financeiro precisa ler NFs de todos, a policy aceita qualquer
-- membro do tenant — a diferenciação dono/não-dono fica no app (permissoes.ts).
CREATE POLICY nf_anexos_select ON public.colaboradores_nf_anexos
  FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_insert ON public.colaboradores_nf_anexos
  FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_update ON public.colaboradores_nf_anexos
  FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY nf_anexos_delete ON public.colaboradores_nf_anexos
  FOR DELETE TO authenticated
  USING (public.is_tenant_member(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.colaboradores_nf_anexos TO authenticated;
```

Observação: dono vs não-dono (quem pode UPDATE/DELETE) é validado nas server actions via `checarPermissao` — mantém o padrão do projeto (ex: `colaboradores_salarios` segue o mesmo modelo).

### Storage — bucket `colaboradores-nf`

- Bucket privado.
- Path: `{tenant_id}/{colaborador_id}/{ano}-{mes}.pdf`.
- RLS do bucket segue o padrão `pedidos-compra`: autenticado do tenant pode `insert`/`select`/`delete` no próprio prefixo. Leitura pela app sempre via `createSignedUrl` com expiração curta (10 min).

Migration de Storage via `apply_migration` ou via UI do Supabase (bucket + policies).

### `lib/types.ts`

```typescript
export interface ColaboradorNfAnexo {
  id: string;
  tenant_id: string;
  colaborador_id: string;
  competencia_ano: number;
  competencia_mes: number;
  arquivo_path: string;
  arquivo_nome: string;
  arquivo_tamanho_bytes: number;
  uploaded_by: string;
  uploaded_at: string;
  created_at: string;
  updated_at: string;
}

export type JanelaPagamento = "salarios" | "fornecedores";

export interface NfJanela {
  janela: JanelaPagamento;
  /** ISO yyyy-mm-dd. Dia 03 pra salários, dia 08 pra fornecedores. */
  data_prevista: string;
}
```

### Permissões — `lib/permissoes.ts`

Adicionar:

```typescript
"rh.nf.anexar_propria"   // autenticado com user_id vinculado a algum colaborador
"rh.nf.anexar_qualquer"  // administrador, rh
"rh.nf.ver"              // administrador, rh, financeiro
```

A primeira é especial: não é por role, é por "dono do recurso". A checagem no server action é:

```typescript
async function podeMexerNaNf(session, colaboradorId) {
  if (session.activeRole === "administrador" || session.activeRole === "rh") {
    return true; // alçada ampla via rh.nf.anexar_qualquer
  }
  const { data } = await supabase
    .from("colaboradores")
    .select("user_id")
    .eq("id", colaboradorId)
    .single();
  return data?.user_id === session.profile.id;
}
```

## Fluxos

### Fluxo 1 — Colaborador anexa NF

1. Colaborador loga, vai em `/perfil`.
2. Card **"Nota Fiscal"** (posicionado entre "Dados Bancários" e "Minhas Férias") mostra **sempre a competência atual** (mês vigente, independente da folha PJ ter sido gerada ou não).
3. Estado inicial (sem NF do mês):
   - Título grande: "Outubro/2026".
   - Countdown de dias restantes até 25 do mês da competência.
   - Botão principal **"Anexar NF"** (abre o seletor de arquivo — PDF, 1 arquivo, max 10 MB).
   - Botão secundário **"Ver histórico"** (abre modal/drawer com NFs anteriores).
4. Após anexar (dentro do prazo):
   - "✓ Enviada em DD/MM • nome-do-arquivo.pdf".
   - "Pagamento previsto: 03/MM+1 (janela de salários)".
   - Botão "Substituir" + "Ver histórico".
5. Após anexar (fora do prazo):
   - "✓ Enviada em DD/MM • nome-do-arquivo.pdf".
   - "⚠ Pagamento vai pra janela de fornecedores (08/MM+1)".
   - Botão "Substituir" + "Ver histórico".
6. Alerta de **backlog** (banner em cima do card principal) quando houver competência anterior com folha PJ aberta E sem NF: `⚠ Você tem NF pendente de setembro/2026 — veja no histórico.` com link que abre o histórico direto na linha correspondente.
7. Server action `anexarNfColaborador`:
   - Valida permissão (dono ou RH/admin).
   - Valida competência razoável (`ano >= 2024`, `(ano, mes) <= atual + 2 meses`).
   - Faz upload no Storage (sobrescreve se já existe).
   - UPSERT em `colaboradores_nf_anexos`.
8. Card atualiza: mostra arquivo + "enviada em DD/MM HH:mm" + aviso de janela.

### Fluxo 1b — Histórico de NFs (modal/drawer disparado do card)

Tabela com 1 linha por competência que **tem folha PJ aberta OU já teve NF anexada**, ordenada mais recente primeiro:

| Competência | NF enviada em | Janela | Status da linha | Ação |
| --- | --- | --- | --- | --- |
| Set/2026 | 20/09 | Salários (03/10) | Aprovada | Baixar |
| Ago/2026 | 15/08 | Salários (03/09) | Paga | Baixar |
| Jul/2026 | — | — | Aguardando NF | Anexar |

Status derivado de `folhas_pagamento.status` (`rascunho`/`enviada` → "Aguardando aprovação"; `aprovada` → "Aprovada"; `paga` → "Paga"; sem folha + sem NF → "Aguardando RH gerar").

Botão "Anexar" na linha permite anexar backlog direto do histórico.

### Fluxo 2 — RH anexa pelo cadastro do colaborador

1. RH vai em `/rh/colaboradores/[id]`.
2. Card novo "Notas Fiscais" (visível só pra `pj`, `mei`, `clt_recibo`), lista mesma coisa do `/perfil` do colaborador.
3. RH anexa pelo mesmo server action (passa `colaborador_id` explicito; permissão `rh.nf.anexar_qualquer` libera).

### Fluxo 3 — Financeiro aprova linha PJ

1. Financeiro abre `/financeiro/contas-a-pagar` → aba Folhas → clica numa linha PJ pra abrir drawer.
2. Drawer carrega NF (se existir) via `createSignedUrl`.
3. Bloco "Nota Fiscal" no drawer:
   - **Sem NF**: aviso vermelho "Aguardando colaborador anexar NF. Peça em /perfil ou use a página do colaborador". Botão "Aprovar" disabled com tooltip.
   - **Com NF**: nome do arquivo + "enviada em DD/MM HH:mm por Fulano" + badge "No prazo (janela salários 03/MM+1)" ou "Fora do prazo (janela fornecedores 08/MM+1)" + botão "Baixar PDF". Botão "Aprovar" habilitado.
4. Ao aprovar, `aprovarLinhaFolha` valida de novo no servidor (defense in depth) e segue o fluxo normal de criar `contas_avulsas`.

### Fluxo 4 — RH visualiza quem anexou

1. RH abre `/rh/folhas/[competencia]`.
2. Pra cada linha PJ, badge "NF ✓" (verde) ou "NF —" (muted) ao lado dos badges existentes.
3. Filtro opcional "Só sem NF" (não bloqueante no MVP, decidir se adicionar na implementação).

## Server actions

### `anexarNfColaborador(input)`

```typescript
export async function anexarNfColaborador(input: {
  colaboradorId: string;
  ano: number;
  mes: number;
  arquivoBuffer: ArrayBuffer;
  arquivoNome: string;
}): Promise<ActionResult<{ anexo_id: string }>>;
```

Validações:
- Permissão: dono OU `rh.nf.anexar_qualquer`.
- `arquivoNome` termina em `.pdf` (case-insensitive).
- Tamanho ≤ 10 MB.
- Colaborador tipo in `(pj, mei, clt_recibo)` — não aceita pra tipos que não exigem NF.
- Competência está dentro de uma janela razoável (ex: `ano >= 2024` e `(ano, mes) <= atual + 2 meses`) — evita NF pra competência maluca.

Explicitamente **não valida existência da folha de pagamento**: colaborador pode anexar NF antes do RH gerar (D1). A folha é consultada só na aprovação da linha, não no upload.

Efeitos:
- Hash do arquivo (idempotência não bloqueia reenvio — sempre sobrescreve). Hash só vai em audit metadata.
- Se anexo anterior existe: `supabase.storage.remove([path_antigo])` antes de subir novo.
- Upload no bucket `colaboradores-nf`.
- UPSERT em `colaboradores_nf_anexos` (`onConflict: tenant_id,colaborador_id,competencia_ano,competencia_mes`).
- `logAuditEvent({ acao: "colaborador.nf_anexada", ... })` com `arquivo_hash`, `substituiu_anexo_anterior`, `janela_calculada`.
- `revalidatePath('/perfil')`, `revalidatePath('/rh/folhas/{ano}-{mm}')`, `revalidatePath('/financeiro/contas-a-pagar')`.

### `removerNfColaborador(anexoId)`

Permissão igual acima. Deleta Storage + row. Audit `colaborador.nf_removida`.

### `baixarNfColaborador(anexoId)`

Permissão: `rh.nf.ver` OU dono. Retorna Signed URL com 10 min de validade. Audit `colaborador.nf_baixada` só se chamador não for o dono (interesse auditar quem financeiro/RH baixa).

### Helpers puros

```typescript
// lib/folha/janela-pagamento.ts
export function janelaDaNf(
  uploadedAt: string, // ISO
  competenciaAno: number,
  competenciaMes: number,
): NfJanela;
```

Testável sem DB. Regra: `uploadedAt` <= `25/MM/YYYY 23:59:59 America/Sao_Paulo` → salários (dia 03 do mês seguinte); senão fornecedores (dia 08).

Timezone: converter `uploaded_at` (UTC) pra America/Sao_Paulo antes de comparar.

```typescript
// lib/folha/countdown-nf.ts
export function diasAtePrazoNf(
  hoje: Date,
  competenciaAno: number,
  competenciaMes: number,
): {
  diasRestantes: number;        // negativo se vencido
  vencido: boolean;
  mensagem: string;              // "Faltam 18 dias", "Último dia", "Prazo vencido — vai pra janela de fornecedores (08/11)"
};
```

### Mudança em `aprovarLinhaFolha` (contas-a-pagar/actions-folhas.ts)

Antes do bloco de resolução de plano de contas, adicionar:

```typescript
const exigeNf =
  folha.origem === "california" &&
  ["pj", "mei", "clt_recibo"].includes(colab.tipo_contratacao);
if (exigeNf) {
  const { data: nf } = await supabase
    .from("colaboradores_nf_anexos")
    .select("id, uploaded_at")
    .eq("tenant_id", tenantId)
    .eq("colaborador_id", folha.colaborador_id)
    .eq("competencia_ano", folha.competencia_ano)
    .eq("competencia_mes", folha.competencia_mes)
    .maybeSingle();
  if (!nf) {
    return {
      ok: false,
      message:
        "Linha PJ não pode ser aprovada sem NF anexada. Peça pro colaborador anexar em /perfil, ou anexe no cadastro dele.",
    };
  }
}
```

## UI

### `/perfil` — card "Nota Fiscal" (substitui o placeholder atual)

**Posicionamento:** entre "Dados Bancários" e "Minhas Férias" na página do perfil.

**Estrutura:** card ÚNICO focado no mês vigente (não lista todas as competências — isso vai no histórico). Elementos:

1. **Banner de backlog** (condicional): aparece acima do card quando há competência anterior com folha PJ aberta e sem NF.
2. **Título**: "Outubro/2026" (nome do mês vigente).
3. **Status/countdown** (varia com estado — ver Fluxo 1).
4. **Botão primário**: "Anexar NF" ou "Substituir" (conforme estado).
5. **Botão secundário**: "Ver histórico".

**Queries do server component:**

```typescript
const hoje = new Date();
const anoVigente = hoje.getFullYear();
const mesVigente = hoje.getMonth() + 1;

// NF do mês vigente (pode não existir)
const { data: nfVigente } = await supabase
  .from("colaboradores_nf_anexos")
  .select("arquivo_nome, uploaded_at")
  .eq("colaborador_id", colaboradorId)
  .eq("competencia_ano", anoVigente)
  .eq("competencia_mes", mesVigente)
  .maybeSingle();

// Backlog: folhas PJ anteriores em status != paga que ainda não têm NF.
// Uma query de folhas abertas + uma de NFs já anexadas; merge no server.
const { data: folhasAbertas } = await supabase
  .from("folhas_pagamento")
  .select("competencia_ano, competencia_mes, status")
  .eq("tenant_id", tenantId)
  .eq("colaborador_id", colaboradorId)
  .eq("origem", "california")
  .in("status", ["rascunho", "enviada", "aprovada", "pendente_correcao"])
  .or(`competencia_ano.lt.${anoVigente},and(competencia_ano.eq.${anoVigente},competencia_mes.lt.${mesVigente})`);

const { data: nfsAnexadas } = await supabase
  .from("colaboradores_nf_anexos")
  .select("competencia_ano, competencia_mes")
  .eq("colaborador_id", colaboradorId);

const temBacklog = folhasAbertas.some(
  (f) => !nfsAnexadas.some(
    (n) => n.competencia_ano === f.competencia_ano && n.competencia_mes === f.competencia_mes
  )
);
```

Modal/drawer de histórico carrega o conjunto completo apenas sob demanda (quando o botão é clicado), evitando pagar o custo no render do perfil.

### `/rh/colaboradores/[id]` — card "Notas Fiscais"

Mesmo componente do `/perfil`, só muda a origem do `colaboradorId` (vem do param, não da sessão). Visível só pra `pj`/`mei`/`clt_recibo`. Permissão `rh.nf.anexar_qualquer` controla edição.

### Drawer de revisão da linha (financeiro)

Em `app/(app)/financeiro/contas-a-pagar/revisar-folha-drawer.tsx`, novo bloco "Nota Fiscal" **só pra linhas que exigem NF**. Server action separada carrega a NF (com Signed URL) quando o drawer abre.

### `/rh/folhas/[competencia]` — badge "NF ✓"

Na página, SELECT atual de `folhas_pagamento` ganha um JOIN opcional em `colaboradores_nf_anexos`:

```typescript
.select("id, salario_base, status, origem, motivo_pendencia, colaborador_id, nf:colaboradores_nf_anexos!left(id)")
```

Query filtrada pelo mesmo `(competencia_ano, competencia_mes)` — o Supabase não facilita JOIN com condição em coluna da tabela filha num embed; vai precisar de 2 queries e merge no server component. Pra evitar N+1: 1 query de folhas + 1 query de NFs daquela competência, merge por `colaborador_id`.

`FolhaLinha` ganha campo `tem_nf: boolean`. Componente novo `<SeloNfAnexada />` renderiza quando `tem_nf === true` E a linha exige NF.

## Auditoria

Novos eventos no enum `AuditAction`:

- `colaborador.nf_anexada` — ator, colaborador_id, competência, arquivo_hash, substituiu_anexo_anterior, janela_calculada.
- `colaborador.nf_removida` — ator, colaborador_id, competência.
- `colaborador.nf_baixada` — ator, colaborador_id, competência. Só se ator ≠ dono (RH/financeiro visualizando).

## Testes

- **Helper puro `janelaDaNf`**: fixtures com upload dentro/fora do prazo, upload exatamente 25 às 23:59, 25 às 23:59:59.000, 26 às 00:00:00, timezone brasileiro.
- **Helper puro `diasAtePrazoNf`**: countdown correto em cada dia do mês, mensagem muda nas transições.
- **`anexarNfColaborador`** (manual, requer DB): dono anexa OK; não-dono bloqueado; RH anexa pra outro OK; anexar sem folha PJ bloqueado; reenvio sobrescreve e remove arquivo antigo; auditoria registrada.
- **`aprovarLinhaFolha`** (manual): aprovar PJ sem NF retorna erro; aprovar PJ com NF segue; aprovar CLT sem NF segue (não exige); aprovar híbrido CLT (origem contabilidade) sem NF segue.
- **E2E manual** (6 passos):
  1. RH gera folha PJ outubro.
  2. Colaborador PJ loga, abre /perfil, vê a competência e countdown.
  3. Anexa PDF. Vê badge "No prazo (salários 03/11)".
  4. Financeiro abre drawer da linha dele, vê NF, aprova. `contas_avulsas` criada.
  5. Outro PJ não anexa até dia 26 (teste simulado). Anexa dia 26. Vê badge "Fora do prazo (fornecedores 08/11)". Financeiro aprova OK.
  6. Terceiro PJ não anexa. Financeiro tenta aprovar → erro.

## Rollout

1. Migration de `colaboradores_nf_anexos` + RLS + grants (pelo MCP).
2. Bucket Storage `colaboradores-nf` + policies (pelo MCP ou UI).
3. `lib/types.ts` com os novos tipos.
4. Permissões novas em `lib/permissoes.ts`.
5. Helpers puros `janelaDaNf` + `diasAtePrazoNf` com testes.
6. Server actions `anexarNfColaborador`, `removerNfColaborador`, `baixarNfColaborador`.
7. Trava em `aprovarLinhaFolha` + mensagem.
8. UI `/perfil` card (substitui placeholder).
9. UI `/rh/colaboradores/[id]` card novo.
10. Drawer de revisão: bloco NF.
11. `/rh/folhas/[competencia]`: badge NF.
12. Auditoria: novos eventos no enum.

## Fora de escopo (MVP)

- **Histórico de versões** da NF — reenvio sobrescreve.
- **Rejeição pelo financeiro** — se NF estiver errada, resolve offline.
- **Metadata estruturada da NF** (número, série, data de emissão, valor) — só arquivo.
- **Validação de XML da NFe** — só PDF.
- **Lembretes automáticos** (e-mail, in-app) pros atrasados — próxima iteração.
- **Dashboard de NFs pendentes** pra RH — por enquanto, visual na página da competência serve.
- **Download em lote** pelo financeiro.
- **Vinculação da NF ao título em contas a pagar** além do que já é derivado por competência.

## TBDs

- **TBD-1 — Limite de tamanho do arquivo**: 10 MB é razoável? Confirmar com o financeiro (NF PDF normalmente é < 500 KB, mas comprovantes anexos podem crescer).
- **TBD-2 — Múltiplas NFs por competência**: cenário raro mas possível (ex: colaborador PJ emite 2 NFs no mês por serviços diferentes). MVP aceita só 1 — se virar problema, muda unique constraint.
