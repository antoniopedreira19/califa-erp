# Férias — RH cancela lançamento e edita período solicitado

**Data:** 2026-11-26
**Status:** Design curto (aguardando aprovação)

## Intenção

Dar duas capacidades novas ao RH na gestão de férias:

1. **Cancelar um lançamento** em qualquer fase antes de ele virar título a pagar — desfaz o pedido, libera os dias do aquisitivo e permite que o colaborador solicite de novo.
2. **Editar o período solicitado** (data de início/fim e aquisitivo escolhido) **enquanto o pedido ainda não foi aprovado pelo RH** — útil quando o colaborador digitou errado.

## Por quê

Hoje:
- **Reprovar** existe ([actions.ts:375](app/(app)/rh/ferias/actions.ts#L375)) mas só funciona em `status = pendente_aprovacao` e exige motivo de pelo menos 5 caracteres. Não cobre `aguardando_gestor` (aguardando líder), nem casos pós-aprovação RH quando o RH descobre que algo precisa ser desfeito.
- **Editar** não existe. Se o colaborador pôs a data errada, o único caminho é reprovar e esperar ele refazer — ciclo chato pro colaborador e pro líder.

A California opera com volume baixo de férias por mês mas com alta visibilidade (gerente de projetos vendo a tela do RH, líderes recebendo notificação por engano etc.). Erro operacional de data é comum.

## Metas

1. **Ação nova `cancelarLancamento`** disponível pro RH quando o status é um de: `aguardando_gestor`, `pendente_aprovacao`, `aprovado`, `nf_anexada`. Status vira `cancelado`. Motivo é **opcional** (`observacao`, campo curto).
2. **Remover `reprovarLancamento`** (não há dado histórico — zero lançamentos com status `reprovado` no banco). Botão "Reprovar" vira "Cancelar" nos dois lugares que usam.
3. **Cancelar em `aprovado` ou `nf_anexada` também apaga as folhas de pagamento** que nasceram no momento da aprovação (`criarFolhasDePagamentoDeFerias` gera folhas em rascunho). Sem isso, as folhas ficam órfãs no financeiro.
4. **Ação nova `editarPeriodoLancamento`** disponível pro RH quando status é `aguardando_gestor` ou `pendente_aprovacao`. Permite trocar `data_inicio`, `data_fim`, `dias` e, se necessário, `periodo_id` (o aquisitivo vinculado).
5. **Dialogs novos:** `DialogCancelarLancamento` (confirmação + textarea opcional) e `DialogEditarPeriodo` (form com date pickers + select de aquisitivo).
6. **Botões** nos dois lugares onde o RH vê a solicitação:
   - Modal `ModalDetalheSolicitacao` (tabela de Solicitações em `/rh/ferias?tab=fluxo`).
   - Card `CardSolicitacaoAtiva` na página individual `/rh/ferias/[id]`.
7. **Label visual:** status `cancelado` já é renderizado como "Cancelado" ([page.tsx:498](app/(app)/rh/ferias/[id]/page.tsx#L498)). Rever pra "Cancelada" (feminino, acompanha "a solicitação").
8. **Audit:** `ferias.lancamento.cancelado` com `{ status_anterior, folhas_apagadas: N }` no metadata. `ferias.lancamento.periodo_editado` com `{ de: {...}, para: {...} }`.

## Não-metas

- **Editar período depois da aprovação do RH.** Fluxo correto é cancelar e refazer — o botão "Lançar direto" já serve. Mexer nas folhas de pagamento recalculando valores é mudança 3x maior e sensível (parte CLT já pode ter ido pra contabilidade).
- **Editar tipo** (`usufruto` ↔ `abono_combinado` etc.). A mudança de tipo altera a estrutura do cálculo; segue o mesmo princípio de "cancele e refaça".
- **Editar `dias_abono`** independentemente. Já deriva do tipo + dias totais.
- **Permitir colaborador editar o próprio lançamento.** A edição é ação exclusiva do RH — colaborador cancela (cancelamento próprio não é escopo dessa task).
- **Preservar histórico de edições.** Audit guarda a mudança; não precisa de modelo versionado na tabela.
- **Mexer em folhas já enviadas ao financeiro.** Status `enviado_financeiro` sai do escopo do cancelamento — cai no fluxo do financeiro cancelar o título.
- **Backfill de `reprovado` → `cancelado` no enum.** Zero linhas com esse status no banco; deletar o valor `reprovado` do enum é destrutivo e desnecessário. Fica no enum, não usamos.

## Anti-metas

- **Cancelar sem apagar as folhas filhas quando status era `aprovado`/`nf_anexada`.** Isso deixaria entradas órfãs em `folhas_pagamento` que aparecem no financeiro sem contexto.
- **Permitir cancelamento em `enviado_financeiro` por atalho.** Se foi enviado, a conta a pagar já tá na mesa do financeiro — cancela lá.
- **Fazer edição "cirúrgica" que mude só uma coluna sem revalidar.** Toda edição rechega `data_fim >= data_inicio`, `dias = diff + 1`, `data_inicio` dentro do aquisitivo escolhido.

## Restrições

- Banco pelo ciclo do MCP, mas **nenhuma migration** — o status `cancelado` já existe no enum, as colunas de período já são editáveis.
- `lib/types.ts` à mão (nada muda aqui).
- Strings pt-BR com acento.
- shadcn/ui `Dialog`, `Input type="date"`, `Select`, `Textarea`.
- Reusa `assertRh`, `carregarLancamento`, `logAuditEvent`, `revalidatePath` existentes.
- Nova feature de cancelamento **não dispara nada** no financeiro além do delete das folhas em rascunho vinculadas (`folhas_pagamento.status = 'rascunho' AND lancamento_ferias_id = X` → DELETE). Audit cobre.

## Modelo de dados

**Nenhuma mudança.** O status `cancelado` já é valor válido do enum `ferias_lancamento_status`. Período é editável direto nas colunas `data_inicio`, `data_fim`, `dias`, `periodo_id`.

## Backend

### `cancelarLancamento(lancamentoId, opts?: { observacao?: string }): Promise<ActionResult>`

Em `app/(app)/rh/ferias/actions.ts`. Substitui `reprovarLancamento`.

- Valida `assertRh`.
- Lê `carregarLancamento`. Se não existir, erro.
- Rejeita se `status === 'enviado_financeiro'` ou `status === 'concluido'` ou `status === 'cancelado'` (idempotente nesse último: devolve `{ ok: true, id }`).
- `UPDATE colaboradores_ferias_lancamentos SET status='cancelado', motivo_reprovacao=observacao, aprovado_por=NULL, aprovado_em=NULL WHERE id=?`. Reusa a coluna `motivo_reprovacao` pra guardar a observação do cancelamento — evita adicionar coluna nova pra um texto opcional. Comentar no código: "mesma coluna serve pra observação de cancelamento — reprovar e cancelar são operacionalmente a mesma coisa nessa versão".
- Se status era `aprovado` ou `nf_anexada`: `DELETE FROM folhas_pagamento WHERE lancamento_ferias_id=? AND status='rascunho'`. Conta `N` apagadas pro audit.
- Audit `ferias.lancamento.cancelado` com `{ status_anterior, folhas_apagadas: N, observacao? }`.
- `revalidatePath('/rh/ferias', '/perfil', '/financeiro/contas-a-pagar')`.

### `editarPeriodoLancamento(input): Promise<ActionResult>`

Schema (Zod, em `lib/ferias/editar-periodo-schema.ts` pra ser testável):

```ts
export const editarPeriodoSchema = z.object({
  lancamento_id: z.string().uuid(),
  data_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  data_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodo_id: z.string().uuid().nullable(),
});
```

Validação (função pura testável em `lib/ferias/validar-periodo-editado.ts`):
- `data_fim >= data_inicio`.
- `dias = calcularDiasCorridos(data_inicio, data_fim)` (reusa helper ou inlina — count de dias corridos inclusive).
- Se `periodo_id` presente: `data_inicio` dentro de `[aquisitivo_inicio, data_limite_gozo]` do período; `dias <= dias_direito - dias_ocupados_de_outros_lancamentos`.

Action:
- `assertRh`.
- `carregarLancamento`. Exige `status in ('aguardando_gestor','pendente_aprovacao')`. Fora disso, erro: "Só é possível editar o período antes da aprovação do RH."
- Lê aquisitivo se `periodo_id != null` pra validar limites.
- `UPDATE colaboradores_ferias_lancamentos SET data_inicio=?, data_fim=?, dias=?, periodo_id=? WHERE id=?`.
- `dias_abono` **não muda** nessa action (segue a regra do tipo original).
- Audit `ferias.lancamento.periodo_editado` com `{ de: {data_inicio, data_fim, dias, periodo_id}, para: {...} }`.
- `revalidatePath` nos mesmos lugares.

### Deleta `reprovarLancamento` + `reprovarSchema`

Zero uso em produção (dado real + grep mostra só o call site da UI).

## UI

### `DialogCancelarLancamento`

Novo client component em `app/(app)/rh/ferias/dialog-cancelar-lancamento.tsx`. Usado pelo modal e pelo card.

Props:
```ts
{ aberto: boolean; lancamentoId: string; statusLancamento: FeriasLancamentoStatus; onFechar: () => void; onCancelado?: () => void; }
```

Conteúdo:
- Título "Cancelar solicitação".
- Texto: "Essa ação volta os dias do aquisitivo pro colaborador. Ele poderá solicitar de novo." Se `statusLancamento in ('aprovado','nf_anexada')`: aviso amber "Essa solicitação já tinha folhas de pagamento em rascunho — elas serão removidas."
- `<Textarea>` "Observação (opcional)".
- Rodapé: "Voltar" + "Confirmar cancelamento" (primário california-red).
- Chama `cancelarLancamento(lancamentoId, { observacao: texto || undefined })`. Fecha + `router.refresh()` no sucesso.

### `DialogEditarPeriodo`

Novo client component em `app/(app)/rh/ferias/dialog-editar-periodo.tsx`.

Props:
```ts
{
  aberto: boolean;
  lancamentoId: string;
  dataInicioAtual: string;
  dataFimAtual: string;
  periodoIdAtual: string | null;
  tipoLancamento: FeriasLancamentoTipo; // mostra read-only, pra orientar
  aquisitivosDisponiveis: Array<{ id: string; rotulo: string; saldo: number }>;
  onFechar: () => void;
}
```

Conteúdo:
- Título "Editar período".
- Read-only: "Tipo: {tipoLancamento_label}" (pra orientar — se precisar mudar tipo, cancela e refaz).
- `<Select>` "Período aquisitivo" com opções da prop (pode manter o atual).
- `<Input type="date">` "Data de início".
- `<Input type="date">` "Data de fim".
- Legenda calcula: "Dias: N" (atualiza ao mudar datas).
- Rodapé: "Cancelar" + "Salvar" (primário).
- Chama `editarPeriodoLancamento(...)`. Mostra erro de validação inline.

### Botões nos dois lugares

**Modal `ModalDetalheSolicitacao` ([modal-detalhe-solicitacao.tsx](app/(app)/rh/ferias/modal-detalhe-solicitacao.tsx)):**
- Remove o modo `modoReprovar` interno e a textarea de motivo embutida.
- Botão "Reprovar" vira "Cancelar", abre `DialogCancelarLancamento`.
- Novo botão "Editar período" (só quando `status in (aguardando_gestor, pendente_aprovacao)`). Abre `DialogEditarPeriodo`.

**Card `CardSolicitacaoAtiva` na página `/rh/ferias/[id]`:**
- Área de ações no rodapé: quando status permite, "Cancelar" + "Editar período".
- "Cancelar" visível em `aguardando_gestor, pendente_aprovacao, aprovado, nf_anexada`.
- "Editar período" visível em `aguardando_gestor, pendente_aprovacao`.

**Label do status:** troca `"Cancelado"` → `"Cancelada"` em [page.tsx:498](app/(app)/rh/ferias/[id]/page.tsx#L498) (e qualquer outro lugar que renderize o label). Status `reprovado` fica `"Reprovado"` sem uso (ou também vira "Cancelada" preventivamente — vou fazer isso pra consistência).

## Testes

- `validar-periodo-editado.test.ts` (função pura, novo): data_fim < data_inicio → erro; dias fora do aquisitivo → erro; happy path → ok.
- `editar-periodo-schema.test.ts` (Zod, novo): formato errado → falha; happy path → ok.
- Teste de integração manual:
  1. Solicitação `aguardando_gestor` da Fabiane (ou qualquer outra) → clicar "Cancelar" no modal → status vira `cancelado` na lista.
  2. Solicitação `aguardando_gestor` → "Editar período" → trocar data_inicio +1 → salvar → datas mudam, dias recalcula.
  3. Solicitação `aprovado` com folhas em rascunho → "Cancelar" → status vira `cancelado` + folhas somem do financeiro.
  4. Solicitação `enviado_financeiro` → "Cancelar" não aparece no card.

## Decisões já tomadas (não precisam voltar)

- **Observação do cancelamento vai na coluna `motivo_reprovacao`** — reusa coluna existente, evita adicionar `observacao_cancelamento` só pra isso. Comentar no código.
- **`dias_abono` não entra na edição** — tipo do lançamento é readonly; abono vem do tipo.
- **Delete das folhas em rascunho é parte do cancelamento** quando status era `aprovado`/`nf_anexada` — não pede confirmação extra; já está no aviso do dialog.
- **Status `reprovado` fica morto no enum** — não há dado nem uso; remover no banco é destrutivo pra zero ganho.
- **"Cancelar" não dispara notificação** — não temos hub de notificação; colaborador descobre quando voltar à tela de perfil.
- **Botões nos dois lugares (modal + card)** — RH usa os dois fluxos (lista + detalhe); forçar um só gera atrito.

## O que fica pro builder

- Ordem dos botões no rodapé do card/modal (visual).
- Microcopy exata das mensagens de erro de validação.
- Se usar `Select` do shadcn (gotcha do SelectItem value="" da memória): usar sentinel "atual" quando `periodo_id` for null.
