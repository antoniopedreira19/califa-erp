# Modal "Solicitar férias" + abono combinado end-to-end

**Data:** 2026-10-27
**Status:** Design (aguardando aprovação do dono)

## Intenção

Substituir o drawer lateral de "Solicitar férias" por um modal centralizado com melhor visual, cobrindo os 3 tipos de solicitação (férias puras, férias + venda de dias, só venda) e implementando end-to-end o `abono_combinado` que hoje tem bug latente no backend (não gera folha correta).

## Por quê

O drawer atual tem 2 problemas:

1. **Visual**: cheio de campos empilhados num espaço lateral estreito; sem hierarquia clara; input de datas apertado; CLT que quer vender junto das férias **não tem opção** (só PJ puro vê `abono_avulso`).
2. **Backend latente**: `abono_combinado` existe no enum do banco e `criar-folhas-pagamento.ts` até tenta criar 2 folhas (uma de férias + uma de abono), mas o `calcular-valores.ts` retorna `valor_abono=0` pra esse tipo — a 2ª folha nasceria com `salario_base=0`. Ninguém pegou porque não existe abono combinado em produção, mas quando um CLT quiser usar o fluxo normal da CLT (tirar 20 + vender 10), o sistema vai gerar título errado.

O modal unifica os 3 cenários num lugar só, resolve o cálculo e evita o bug acordar no futuro.

## Metas

- Modal centralizado substituindo o drawer lateral em `/perfil` quando o colaborador clica "Solicitar férias".
- 3 tipos de solicitação no mesmo form:
  - **Férias (dias de folga)** — `usufruto`, todos os tipos de contratação (exceto sócio, que já é filtrado antes)
  - **Férias + vender parte** — `abono_combinado`, todos
  - **Só vender dias** — `abono_avulso`, só PJ (modelo California)
- **A mesma UI de 3 tipos entra também em `lancar-direto-form.tsx`** (form do RH em `/rh/ferias`). Fluxo é o mesmo; muda só quem lança e quem aprova. O RH não precisa de aprovação (lançamento direto já entra como `aprovado`).
- Visual claro: cards de tipo clicáveis (não dropdown), seções distintas, resumo em tempo real do que vai ser solicitado.
- Backend que persiste `abono_combinado` corretamente:
  - Nova coluna `dias_abono int DEFAULT 0 CHECK (dias_abono >= 0)` em `colaboradores_ferias_lancamentos`
  - Cálculo correto quando tipo = `abono_combinado`: `valor_ferias = diario × dias_folga` + `valor_abono = diario × dias_abono`
  - `dias` persistido = total consumido do saldo = `dias_folga + dias_abono`
- **Limpar o legado `"misto"`** do código. Nunca existiu no banco (enum tem só `usufruto`/`abono_combinado`/`abono_avulso`/`abono_excepcional`); era placeholder no schema do action que remapeava pra `usufruto` no insert. Vai pro lixo.

## Não-metas

- Mudar o fluxo pós-solicitação (RH aprova, cria folhas, financeiro aprova). Esse fluxo foi todo mexido na iteração anterior; não toca.
- Adicionar `abono_excepcional` como opção visível. Hoje é só semântica interna (venda > 10 dias por acordo); se o colab pedir 15 dias de abono combinado, aparece **warning** mas segue como `abono_combinado`. RH decide depois se vira `abono_excepcional` manualmente.
- Mudar o schema do `data_inicio`/`data_fim` para `abono_avulso` (hoje é "período de referência" sem bloco real de folga). Mantém.
- Implementar edição/cancelamento da solicitação pelo modal — fluxo existente continua pelo botão da lista.
- Suporte offline, draft salvo, histórico de solicitações.

## Anti-metas

- Validar `dias_abono <= 10` como regra dura. CLT clássico vende até 10, mas PJ California tem outros acordos; forçar o limite vira ticket pro RH mudar o campo todo dia. Validação é **warning** quando passa de 10.
- Travar a solicitação quando `data_inicio` cai em sábado/domingo. É regra operacional do RH, não da UI. UI só valida data futura (>= hoje + 5 dias) e saldo.
- Deixar o modal grande demais que precise de scroll vertical em desktop padrão (1366px). Design tem que caber na primeira dobra pra não ter que rolar antes de ver "Enviar".
- Backend que aceita `tipo='abono_combinado'` com `dias_abono=0`. Isso é inconsistente — se é combinado, tem que ter abono. Validation server: `dias_abono > 0` quando `tipo = 'abono_combinado'`.

## Restrições

- Banco pelo ciclo do MCP (`docs/FLUXO-BANCO.md`): ler → migration → `apply_migration` → conferir → commit.
- `lib/types.ts` à mão — campo `dias_abono` em `ColaboradorFeriasLancamento` no mesmo commit da migration.
- Strings pt-BR com acentuação completa em qualquer string renderizada (CLAUDE.md "Ortografia em português").
- Nenhum PII em teste/fixture (CLAUDE.md).
- Framework de teste: `node --test` + `tsx` (padrão do projeto).
- Reusar o action existente `solicitarFerias` em `app/(app)/perfil/actions.ts` — expandir, não substituir.
- Dialog/Modal do shadcn já disponível em `components/ui/dialog.tsx`. Usar o padrão existente.
- Preservar comportamento atual pros 2 tipos existentes (`usufruto`, `abono_avulso`): a mesma solicitação feita hoje continua funcionando igual depois.
- Audit via `logAuditEvent` padrão do projeto.
- A regra `permiteAbonoAvulso = tipoContratacao === "pj"` permanece pra `abono_avulso`. **Nova regra**: `abono_combinado` disponível pra todos (exceto sócio, que já é filtrado antes do form abrir).

## Modelo de dados

### Migration

Adiciona coluna + atualiza check constraint existente de valores coerentes:

```sql
-- Motivo: suportar abono_combinado end-to-end — colab informa dias_folga
-- (data_inicio..data_fim) + dias_abono separado. Hoje o campo não existe
-- e o cálculo trata abono_combinado como usufruto puro, gerando bug latente
-- (2ª folha com salario_base=0).
-- Spec: docs/superpowers/specs/2026-10-27-solicitar-ferias-modal-abono-combinado-design.md

ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD COLUMN IF NOT EXISTS dias_abono int NOT NULL DEFAULT 0
  CHECK (dias_abono >= 0);

COMMENT ON COLUMN public.colaboradores_ferias_lancamentos.dias_abono IS
  'Dias que o colaborador vende dentro do bloco de férias (só aplica a tipo=abono_combinado). Pra outros tipos sempre 0. O campo dias (existente) é o TOTAL consumido do saldo (dias_folga + dias_abono).';

-- Garante que dias_abono só é > 0 em abono_combinado
ALTER TABLE public.colaboradores_ferias_lancamentos
  ADD CONSTRAINT chk_dias_abono_so_combinado
  CHECK (
    (tipo = 'abono_combinado' AND dias_abono > 0)
    OR (tipo <> 'abono_combinado' AND dias_abono = 0)
  );
```

**Backfill**: nenhum lançamento existente em produção tem `tipo='abono_combinado'` (confirmado por recon anterior, enum existe mas nunca foi usado). Logo o check constraint passa sem backfill.

### Semântica dos campos

Pra `abono_combinado`:
- `data_inicio` + `data_fim` = bloco de dias de folga (ex: 01/01 a 20/01 = 20 dias)
- `dias` = total consumido do saldo = `dias_folga + dias_abono` (ex: 20 + 10 = 30)
- `dias_abono` = parte vendida (ex: 10)
- Trigger existente `fn_valida_saldo_periodo` continua valendo (soma dias <= dias_direito do período)

Pra `usufruto`, `abono_avulso`, `abono_excepcional`:
- `dias_abono = 0` (sempre)
- `dias` = `data_fim - data_inicio + 1` (comportamento atual)

### Cálculo de valores (nova lógica em `calcular-valores.ts`)

```ts
// Nova assinatura — aceita dias_abono opcional
export async function calcularValoresLancamento(
  colaboradorId: string,
  dataInicio: string,
  tipo: FeriasLancamentoTipo,
  dias: number,            // total: dias_folga + dias_abono
  diasAbono: number = 0,   // novo parâmetro, só != 0 em abono_combinado
  salarioBaseOverride?: number,
): Promise<ValoresLancamento | null>
```

Lógica:
```
diario = salario / 30
diasFolga = dias - diasAbono  // pra abono_combinado; igual a dias nos outros tipos

usufruto:
  valor_ferias = diario * dias
  valor_abono = 0
  valor_um_terco = valor_ferias / 3

abono_avulso | abono_excepcional:
  valor_ferias = 0
  valor_abono = diario * dias
  valor_um_terco = valor_abono / 3

abono_combinado:
  valor_ferias = diario * diasFolga
  valor_abono = diario * diasAbono
  valor_um_terco = valor_ferias / 3   // 1/3 só sobre férias (parte folga); abono não tem 1/3

valor_total = valor_ferias + valor_abono + valor_um_terco
```

Nota: a decisão de "1/3 só sobre férias" em `abono_combinado` segue a CLT (abono pecuniário não dá direito ao 1/3 constitucional). Se o RH quiser mudar essa semântica, é decisão de produto futura.

## UI

### Trigger

Botão "Solicitar férias" existente em `card-minhas-ferias.tsx` abre o modal (não o drawer). Mesmo botão, mesma condição de habilitado/desabilitado (`semSaldoNemAbono`).

### Layout do modal

**Tamanho**: `max-w-2xl` (fica confortável em desktop; fullscreen mobile via responsive do Dialog).

**Estrutura top-down**:

1. **Header**
   - Título: "Solicitar férias"
   - Descrição: "A solicitação precisa ser feita com pelo menos 5 dias de antecedência. Depois do envio, o RH recebe sua solicitação para aprovar."

2. **Seção "Como você quer solicitar?"** — 3 cards clicáveis em grid (`grid-cols-1 md:grid-cols-3`), cada um com:
   - Ícone (lucide-react)
   - Título do tipo
   - Descrição curta (1 linha)
   - Estado selecionado = borda `california-red` + fundo claro

   **Cards:**
   - **Férias** (ícone `Palmtree`): "Tirar dias de folga"
   - **Férias + venda** (ícone `Split`): "Tirar parte, vender o resto" — só mostra se o colaborador tem período com saldo
   - **Só venda** (ícone `DollarSign`): "Vender dias sem tirar folga" — só mostra se `tipoContratacao === "pj"`

3. **Seção "Período aquisitivo"** — só aparece se tipo = usufruto ou abono_combinado
   - Select com os períodos disponíveis (igual ao atual)
   - Linha de contexto embaixo: "Precisa começar até: DD/MM/AAAA"

4. **Seção "Datas"** — sempre aparece
   - 2 columns: Data de início | Data de fim
   - DatePickers com `dateDisabled` (hoje + 5 dias; data_fim >= data_inicio)

5. **Seção "Quantos dias quer vender?"** — só aparece se tipo = `abono_combinado`
   - Input numeric, 1-30
   - Linha de contexto: "Até 10 dias é padrão. Acima disso vira acordo com a empresa (RH avalia)."

6. **Resumo** — card cinza claro no rodapé, atualiza em tempo real:
   - Pra usufruto: "20 dias de folga · Saldo após: X dias"
   - Pra abono_combinado: "20 dias de folga + 10 vendidos = 30 dias · Saldo após: X dias" + warning âmbar se vender > 10
   - Pra abono_avulso: "N dias vendidos" + warning âmbar se > 10
   - Se o total excede saldo: destaca em vermelho

7. **Footer** — alinhado à direita
   - Botão "Cancelar" (ghost)
   - Botão "Enviar solicitação" (primary vermelho California)
   - Botão primary desabilitado quando faltar campo obrigatório ou saldo insuficiente

### Comportamento

- Trocar de tipo zera `periodo_id`, `data_inicio`, `data_fim`, `dias_abono` (não arrasta valores inválidos pro novo tipo).
- Fechar o modal (overlay click, Esc, Cancelar) reseta o form completamente.
- Submit chama `solicitarFerias(payload)` com shape ampliado:
  ```ts
  {
    tipo: "usufruto" | "abono_avulso" | "abono_combinado",  // "misto" vira "abono_combinado"
    periodo_id: string | null,
    data_inicio: string,
    data_fim: string,
    dias_abono: number,  // 0 exceto quando tipo=abono_combinado
    observacao: string | null,
  }
  ```

### Guard rails de UI

- Erro de rede/validation volta como banner vermelho no topo do form (padrão atual).
- `fieldErrors` do server destaca o campo correspondente.
- Loading state no botão "Enviando..." (padrão atual).

## Fluxos

### 1) Férias puras (usufruto) — comportamento atual preservado

1. Colab seleciona card "Férias"
2. Escolhe período + datas
3. Submit → `tipo='usufruto'`, `dias_abono=0`, `dias = fim - ini + 1`
4. RH aprova (fluxo existente) → cria 1 folha de férias com `tipo_folha_ferias='usufruto'`

### 2) Só vender (abono_avulso, só PJ) — comportamento atual preservado

1. Colab seleciona card "Só venda"
2. Escolhe datas (período de referência)
3. Submit → `tipo='abono_avulso'`, `dias_abono=0`, `periodo_id=null`
4. RH aprova (fluxo existente) → cria 1 folha de abono

### 3) Férias + venda (abono_combinado) — NOVO fluxo end-to-end

1. Colab seleciona card "Férias + venda"
2. Escolhe período + datas de folga (ex: 01/01 a 20/01 = 20 dias)
3. Preenche "quantos dias quer vender" (ex: 10)
4. Resumo mostra: "20 dias de folga + 10 vendidos = 30 dias · Saldo após: 0 dias"
5. Submit → `tipo='abono_combinado'`, `dias=30`, `dias_abono=10`, `periodo_id=<id>`
6. RH aprova via `aprovarLancamento` (ação existente, com ajuste pra chamar o novo `calcularValoresLancamento` com `diasAbono`)
7. `criar-folhas-pagamento.ts` já tá preparado — cria 2 folhas:
   - Folha de férias: `tipo_folha_ferias='usufruto'`, `salario_base = valor_ferias + valor_um_terco`
   - Folha de abono: `tipo_folha_ferias='abono'`, `salario_base = valor_abono`
8. Financeiro aprova as 2 folhas separadas (iteração anterior)

## Validações do server

Em `solicitarFerias` (`app/(app)/perfil/actions.ts`):

- Adicionar `dias_abono: z.number().int().min(0).max(30)` no schema (default 0).
- Renomear/adicionar o literal `"abono_combinado"` no enum do `tipo` do schema (hoje aceita `"misto"` mas mapeia pra `usufruto` no insert — mudança quebra isso).
- `superRefine`:
  - `tipo='abono_combinado'` requer `periodo_id` + `dias_abono > 0`
  - `tipo != 'abono_combinado'` requer `dias_abono = 0`
  - `tipo='abono_avulso'` requer `periodo_id = null`
  - `tipo in ('usufruto', 'abono_combinado')` requer `periodo_id`
- Validação de saldo: `diasOcupados + dias <= dias_direito` (onde `dias` já inclui `dias_abono`).
- **Remover** o mapeamento `dados.tipo === "misto" ? "usufruto" : dados.tipo` no insert — persistir o tipo real (`abono_combinado`).
- Restrição `abono_avulso` só pra PJ se mantém; `abono_combinado` disponível pra todos.

## Permissões e RLS

Nenhuma mudança. Policies existentes de `colaboradores_ferias_lancamentos` cobrem:
- Colab insere próprio em `pendente_aprovacao`
- RH aprova
- Financeiro vê os aprovados (via policy adicionada na iteração anterior)

## Ordem de execução sugerida

1. **Migration** — adiciona coluna `dias_abono` + check constraint. Aditivo, backfill vazio. Atualiza `lib/types.ts`.
2. **`calcular-valores.ts`** — aceita `diasAbono` opcional, trata `abono_combinado`. Testes dos 4 ramos.
3. **Action do colaborador `app/(app)/perfil/actions.ts`** — expande schema + mata `"misto"` + lógica de insert com tipo real. Testes do schema.
4. **Action do RH `app/(app)/rh/ferias/actions.ts`** — expande `lancarDiretoPeloRh` pra aceitar `tipo='abono_combinado'` + `dias_abono`; ajusta `aprovarLancamento` pra passar `dias_abono` do lançamento pro `calcularValoresLancamento`.
5. **Shared UI component `_components/solicitar-ferias-form.tsx`** — form reusável com os 3 cards de tipo + campos condicionais + resumo. Não é um modal nem drawer — só o form. Recebe props que indicam `permiteAbonoAvulso` (true pra PJ) e `modo` (`"colaborador"` ou `"rh"` — diferenças pequenas: RH não tem "antecedência mínima" e o botão submit diz "Lançar" em vez de "Enviar solicitação").
6. **`solicitar-ferias-modal.tsx` em `/perfil`** — wraps `SolicitarFeriasForm` num `Dialog` centralizado. Substitui `solicitar-ferias-drawer.tsx` (deleta). Atualiza o call site em `card-minhas-ferias.tsx`.
7. **`lancar-direto-form.tsx` em `/rh/ferias`** — reusa `SolicitarFeriasForm` com `modo="rh"`. Mantém o container atual (que já expõe o form) — só troca o conteúdo pelo componente compartilhado. UI consistente entre as duas telas.
8. **Smoke manual** — simular os 3 fluxos em `/perfil` E em `/rh/ferias/lancar-direto`.

Backend (1-4) pode ir num bloco. UI compartilhado (5) isolado. Integrações (6-7) em paralelo depois do 5.

## Pontos abertos (para o dono decidir)

- **Nome do campo no DB**: `dias_abono` ou `dias_vendidos`? Minha preferência: `dias_abono` por consistência com o resto da modelagem (`valor_abono`, `tipo=abono_*`). **Decido como `dias_abono` se não houver objeção.**
- **1/3 constitucional em `abono_combinado`**: só sobre férias (parte folga) ou também sobre abono? Decido como "só sobre férias" seguindo CLT. Se o RH quiser diferente, é decisão de produto futura.
- **Limite de dias de abono**: hoje tem warning > 10, sem bloqueio. Mantém.

## O que fica a cargo do construtor

- Formato visual exato dos cards (padding, hover, shadow).
- Nome e cor exata dos ícones lucide (`Palmtree`, `Split`, `DollarSign` são sugestões).
- Granularidade dos testes do schema do action (`solicitarSchema`).
- Reaproveitamento de componentes compartilhados (`DatePicker`, `Label`, badges) — padrão do projeto.
- Transição visual quando troca de tipo (collapse/expand animado ou simples re-render).

## Decisões incorporadas após builder-check

Pelo dono:
- `lancarDiretoPeloRh` **entra no escopo**. RH ganha a mesma UI de 3 tipos. Fluxo é o mesmo, só muda quem lança/aprova.
- `"misto"` morre no código (nunca chegou ao banco).

Pelo construtor (minhas calls):
- Enum `ferias_lancamento_tipo` já tem `abono_combinado` em produção (confirmado via MCP). Nenhum `ALTER TYPE ... ADD VALUE` necessário.
- Fluxo híbrido `clt_recibo + abono_combinado`: mantém comportamento atual (RH ajusta valor CLT manualmente quando recibo chega). Resolver separação CLT fica pra iteração futura — caso extremamente raro.
- `fn_valida_saldo_periodo` continua certa: vender dias consome saldo (regra CLT clássica). UX do resumo diz isso explícito ("Saldo após: X dias").
- `valor_um_terco` em `abono_combinado` é só sobre `valor_ferias` (parte folga), seguindo a CLT. Abono pecuniário não gera 1/3 constitucional.
- Testes de `calcular-valores.ts` usam `salarioBaseOverride` (padrão existente) pra não depender de Supabase mockado.
- CHECK constraint `(tipo='abono_combinado' AND dias_abono>0) OR (tipo<>'abono_combinado' AND dias_abono=0)` é seguro pra rollout em etapas: todos lançamentos pré-existentes têm `dias_abono=0` (DEFAULT) e `tipo != 'abono_combinado'`.

## Referências

- `docs/FLUXO-BANCO.md` — ciclo da migration
- `docs/decisions/097-folha-mensal-em-duas-camadas.md`
- `docs/modulos/rh/25-ferias.md` §4.4 §4.5 §F3 (tipos de abono)
- `docs/modulos/rh/26-ferias-modelo-de-dados.md` §2 (enums de ferias_lancamento_tipo)
- `app/(app)/perfil/solicitar-ferias-drawer.tsx` — form atual do colaborador (vira modal + componente shared)
- `app/(app)/perfil/actions.ts` — server action do colaborador a modificar
- `app/(app)/rh/ferias/actions.ts` — `lancarDiretoPeloRh` e `aprovarLancamento` a modificar
- `app/(app)/rh/ferias/lancar-direto-form.tsx` — form do RH que vai reusar o novo componente shared
- `lib/ferias/calcular-valores.ts` — cálculo que tem bug latente em `abono_combinado`
- `lib/ferias/criar-folhas-pagamento.ts` — já cria 2 folhas (só precisa receber valores corretos)
- `supabase/migrations/20261002000004_ferias_lancamentos.sql` — tabela que recebe a coluna nova
