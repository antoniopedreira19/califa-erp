# Página do colaborador em férias: documentos por folha e envio com data

**Data:** 2026-11-26
**Status:** Design curto (aguardando aprovação)

## Intenção

Alinhar a página de detalhes do lançamento de férias (`/rh/ferias/[id]`) e o bloco de aviso da aba People do financeiro com o modelo já implementado no kanban `/rh/ferias?tab=fluxo`: documentos por folha (NF do colaborador **ou** recibo da contabilidade do RH), em vez de "NF genérica". Dar ao RH o botão de anexar recibo e um envio ao financeiro com data de pagamento editável.

## Por quê

O print que motivou essa task mostra Thais (CLT puro) com a mensagem "Aguardando o colaborador anexar a NF". CLT não emite NF — quem anexa é o RH, com o recibo da contabilidade. A lógica correta por tipo de contratação **já existe** desde a implementação do kanban (2026-10-27):

- `folhas_pagamento` nasce com `origem = 'california' | 'contabilidade'` e `tipo_folha_ferias = 'usufruto' | 'abono'` ([lib/ferias/criar-folhas-pagamento.ts](lib/ferias/criar-folhas-pagamento.ts)).
- Anexo contábil vai em `folhas_pagamento.anexo_url`; NF do colaborador vai em `colaboradores_nf_anexos` com escopo `ferias_usufruto` / `ferias_abono`.
- `enviarProFinanceiro(lancamentoId)` ([app/(app)/rh/ferias/actions.ts:847](app/(app)/rh/ferias/actions.ts#L847)) é a action viva hoje — propaga `folhas_pagamento.status = 'rascunho' → 'enviada'` e muda `colaboradores_ferias_lancamentos.status` pra `enviado_financeiro`. Hoje exige `status = 'nf_anexada'`.
- `anexarReciboContabilFolhaFerias` + `gerarUrlUploadReciboContabil` em [actions-pagamentos.ts](app/(app)/rh/ferias/actions-pagamentos.ts) existem mas **nenhuma UI atual as chama** — ficaram órfãs depois que o kanban foi substituído pela aba Solicitações (2026-11-13).
- `data_pagamento_prevista` é calculada por `fn_calcular_vencimento_ferias(data_inicio)` — a regra "2 dias antes do início" que o Antonio citou, já viva.
- Trigger `fn_sincroniza_status_lanc_por_nf` vira `aprovado → nf_anexada` quando QUALQUER anexo entra em `colaboradores_nf_anexos` com escopo de férias. Não cobre o caso CLT (que precisa de `folhas_pagamento.anexo_url`, não de `colaboradores_nf_anexos`).

Consequência: CLT puro fica preso em `aprovado` pra sempre — nunca vira `nf_anexada` porque não emite NF, e `enviarProFinanceiro` recusa `aprovado`. É esse exatamente o estado da Thais no print.

O que ficou de fora: a página `/rh/ferias/[id]` e o bloco de aviso em `people-list.tsx` do financeiro continuam com texto fixo de PJ. Não existe UI pra anexar recibo. `enviarProFinanceiro` não aceita trocar a data no envio.

## Metas

1. **Página `/rh/ferias/[id]`: bloco "Documentos" por lançamento.** Substitui o bloco único de NF por uma lista de slots, um por folha gerada do lançamento:
   - PJ (origem `california`): "NF de férias" ou "NF de abono" → status mostra "Aguardando colaborador anexar no perfil" (sem botão pro RH).
   - CLT (origem `contabilidade`): "Recibo da contabilidade" ou "Recibo de abono California" → botão **Anexar** pro RH, abrindo um dialog novo `DialogAnexarReciboContabil` (não existe UI hoje).
   - Quando o doc existe: ícone + nome do arquivo + data + link pra abrir (signed URL).
2. **`DialogAnexarReciboContabil` (criado nessa task).** Campo `Input type="file"` (accept `application/pdf`) + campo `Input type="number"` (valor líquido, em reais). Ao confirmar: chama `gerarUrlUploadReciboContabil({ folha_id })` → PUT direto no bucket com o blob → `anexarReciboContabilFolhaFerias({ folha_id, valor_liquido, anexo_url })`. Mostra `erro` inline se qualquer passo falhar. Fecha e `router.refresh()` no sucesso.
3. **Botão "Enviar ao financeiro" no bloco Documentos.** Só habilita quando todas as folhas do lançamento têm seu anexo próprio (ver §Enviabilidade). Dispara `enviarProFinanceiro(lancamentoId, { dataPagamento? })`.
4. **Diálogo de envio com data editável (`DialogConfirmarEnvioFinanceiro`).** Antes de disparar a action, abre dialog com `Input type="date"` pré-preenchido com o `min(data_pagamento_prevista)` das folhas em rascunho. RH pode trocar.
5. **`enviarProFinanceiro` ganha gate novo e parâmetro de data.** Assinatura muda pra `enviarProFinanceiro(lancamentoId, opts?: { dataPagamento?: string })`. Aceita `status in ('aprovado', 'nf_anexada')` (CLT fica em `aprovado` pra sempre — não espera trigger de NF). Antes de mudar status, valida que **todas** as folhas-filhas estão anexadas (regra em §Enviabilidade). Se `dataPagamento` veio, aplica em `folhas_pagamento.data_pagamento_prevista` antes do UPDATE de status.
6. **`people-list.tsx` do financeiro: tooltip dinâmica.** Troca o texto fixo "Aguardando o colaborador anexar a NF" por uma mensagem que leve em conta a `origem` da folha:
   - `california` sem NF → "Aguardando o colaborador anexar a NF."
   - `contabilidade` sem recibo → "Aguardando o RH anexar o recibo da contabilidade."
7. **Página `/rh/ferias/[id]`: hint do status `aprovado`** vira dinâmica pela mesma regra do item 6 (hoje é fixa em "Aguardando colaborador anexar a NF.").

## Não-metas

- **Mudar o kanban.** Ele já faz tudo isso certo. Essa task só espelha na página individual.
- **Novo enum, nova tabela, novo papel no schema.** O desenho atual (`origem` + `anexo_url` + `colaboradores_nf_anexos`) já dá conta.
- **Renomear o status `nf_anexada`.** É label interno; a UI já vai mostrar texto diferente. Renomear enum é destrutivo, não compensa.
- **Ler PDF por IA pra extrair valor líquido.** RH continua digitando no `ModalAnexarRecibo` atual (igual no kanban).
- **Novo botão de anexo pra NF do colaborador na página do RH.** NF é anexada pelo próprio colab no `/perfil` — o RH só vê o status (idem kanban).
- **Fluxo de rescisão / 13º.** Esses são escopos próprios com suas migrations; essa task é só férias.

## Anti-metas

- **Botão "Enviar" por folha individual nessa página.** Igual ao kanban: só o lançamento inteiro de uma vez. Enviar só a parte PJ enquanto espera o CLT já foi recusado antes, não voltamos.
- **Duplicar o modal/ação de anexo de recibo.** O `ModalAnexarRecibo` em `botao-recibo.tsx` fica único; a página `[id]` importa e reusa.
- **Edição livre do valor líquido depois de enviar.** Se o RH se enganou, cancela a folha pelo caminho existente e refaz — não abrimos caminho curto novo.

## Restrições

- Banco pelo ciclo do MCP (`docs/FLUXO-BANCO.md`). Única alteração: `enviarFolhasFerias` aceita `dataPagamento` opcional; não precisa migration — `data_pagamento_prevista` já existe.
- `lib/types.ts` à mão (sem tipos gerados).
- Strings pt-BR com acento (`"Anexar"`, `"Recibo da contabilidade"`, `"Aguardando"`).
- Nenhum PII em arquivo versionado.
- Reusa `shadcn/ui` Dialog, Button e `Input type="date"` nativo (padrão do projeto).
- Mesma paleta: Palmtree em `california-red`, sky/amber nos badges de status.

## Modelo de dados

**Nenhuma mudança estrutural.** Tudo já existe:

- `folhas_pagamento.anexo_url` — recibo contábil (CLT).
- `folhas_pagamento.salario_base` — valor líquido do recibo (RH digita ao anexar).
- `folhas_pagamento.data_pagamento_prevista` — data que o item 4 vai editar.
- `colaboradores_nf_anexos` — NF do colaborador (PJ), escopo `ferias_usufruto` / `ferias_abono`.
- `fn_calcular_vencimento_ferias(data_inicio)` — "2 dias antes" via RPC.

## Enviabilidade (regra pura, testável)

Função `lancamentoEnviavel(folhas, nfs): { ok: true } | { ok: false, falta: string[] }`:

- Pra cada folha do lançamento (status `rascunho`):
  - Se `origem = 'california'`: precisa ter linha em `colaboradores_nf_anexos` com `escopo_tipo = ferias_<tipo_folha_ferias>` e `escopo_id = lancamento_id`.
  - Se `origem = 'contabilidade'`: precisa ter `anexo_url IS NOT NULL`.
- `ok` sse todas as folhas atendem. `falta` lista descrições human-readable (ex: "Recibo da contabilidade do usufruto", "NF de férias") pra UI reportar no tooltip do botão desabilitado.

Vive em `lib/ferias/lancamento-enviavel.ts`, usada no `enviarProFinanceiro` (backend) e pelo bloco de documentos (frontend).

## Backend

### `enviarProFinanceiro` ganha gate novo e `dataPagamento?`

Em `app/(app)/rh/ferias/actions.ts`:

- Assinatura: `enviarProFinanceiro(lancamentoId, opts?: { dataPagamento?: string })`.
- Gate antigo (`status === 'nf_anexada'`) troca por: aceita `status in ('aprovado', 'nf_anexada')` **e** `lancamentoEnviavel(folhas, nfs).ok === true`.
- Quando `opts.dataPagamento` presente: valida com Zod (`^\d{4}-\d{2}-\d{2}$`), UPDATE em `folhas_pagamento.data_pagamento_prevista` pras folhas em rascunho do lançamento antes do UPDATE de status.
- Audit `ferias.lancamento.enviado_financeiro` ganha `data_pagamento?: string` no metadata quando trocada.
- Idempotência mantida: `enviado_financeiro` continua devolvendo `{ ok: true, id }` sem mexer.

## UI

### Página `/rh/ferias/[id]`: componente novo `BlocoDocumentosLancamento`

Substitui o bloco atual que renderiza NF única (hoje em `page.tsx:570-589`). Server component que busca:

- `folhas_pagamento` do lançamento (todas, incluindo pagas pra mostrar histórico).
- `colaboradores_nf_anexos` do lançamento.

Render:

```
┌─ Documentos ────────────────────────────────┐
│ Progresso: 2/3 documentos anexados          │
│                                             │
│ ✓ Recibo da contabilidade (usufruto, CLT)   │
│   recibo-maria-nov.pdf · 24/11/2026         │
│                                             │
│ ✓ NF de férias (usufruto, PJ)               │
│   nf-45201.pdf · 23/11/2026                 │
│                                             │
│ ⏳ Recibo de abono California (abono, CLT)   │
│   Aguardando RH anexar     [ Anexar ]       │
│                                             │
│ [Enviar ao financeiro]  (desabilitado se    │
│                         algum doc faltar)   │
└─────────────────────────────────────────────┘
```

Botão "Anexar" (contabilidade sem anexo) abre `DialogAnexarReciboContabil` novo. Botão "Enviar ao financeiro" abre `DialogConfirmarEnvioFinanceiro` novo.

### Dialog `DialogAnexarReciboContabil`

`max-w-md`. Campos:

- `Input type="file"` com `accept="application/pdf"` — RH escolhe o PDF do recibo.
- `Input type="number"` (step 0.01, min 0.01) — "Valor líquido do recibo (R$)". Pode vir pré-preenchido com `salario_base` atual.

Submissão (`handleAnexar`):

1. `gerarUrlUploadReciboContabil({ folha_id })` → `{ signed_url, path }`.
2. `fetch(signed_url, { method: 'PUT', body: file })`.
3. `anexarReciboContabilFolhaFerias({ folha_id, valor_liquido, anexo_url: path })`.
4. Qualquer erro → `setErro(message)` + mantém dialog aberto. Sucesso → fecha, `router.refresh()`.

### Dialog `DialogConfirmarEnvioFinanceiro`

Simples, `max-w-md`:

```
Enviar ao financeiro

Serão enviadas N folha(s) com valor total de R$ X.XXX,XX.

Data de pagamento: [ 2026-12-20 ]   ← input date
Default: 2 dias antes do início das férias.

[Cancelar]  [Confirmar envio]
```

`defaultValue` do input = `min(folhas.data_pagamento_prevista)` (string ISO). Ao confirmar: chama `enviarProFinanceiro(lancamentoId, { dataPagamento })`.

### Hint dinâmica no status

Função helper pequena em `page.tsx`:

```ts
function hintAprovado(folhas, nfs): string {
  const pendentes = folhas.filter(/* sem anexo */);
  if (pendentes.length === 0) return "Pronto pra enviar ao financeiro.";
  const porOrigem = agrupaPorOrigem(pendentes);
  if (porOrigem.contabilidade > 0 && porOrigem.california > 0)
    return "Aguardando RH anexar recibo e colaborador anexar NF.";
  if (porOrigem.contabilidade > 0)
    return "Aguardando RH anexar o recibo da contabilidade.";
  return "Aguardando colaborador anexar a NF.";
}
```

Substitui o `hint` fixo em `statusInfo.aprovado.hint`.

### Aba People do financeiro

Em [app/(app)/financeiro/contas-a-pagar/people-list.tsx:518](app/(app)/financeiro/contas-a-pagar/people-list.tsx#L518): tooltip hoje é fixa. Troca por função que escolhe entre dois textos pela `origem` da linha (o componente já tem o dado da folha disponível).

## Testes

- `lancamento-enviavel.test.ts` (novo): função pura. Casos: (1) PJ só com NF anexada → ok; (2) PJ sem NF → falta NF; (3) CLT com anexo_url → ok; (4) CLT sem anexo_url → falta recibo; (5) híbrido completo → ok; (6) híbrido só NF → falta recibo; (7) híbrido só recibo → falta NF.
- `hint-aprovado.test.ts` (novo): função pura do texto do hint. 4 casos (0 pendentes, só CLT, só PJ, ambos).
- Teste de integração manual no `/rh/ferias/[Thais-lancamento-id]`:
  1. Ver bloco Documentos com 1 slot CLT pendente.
  2. Clicar "Anexar" → dialog abre → selecionar PDF + valor líquido → confirmar.
  3. Slot passa pra ✓, botão Enviar ao financeiro habilita.
  4. Clicar Enviar → dialog abre com data 2 dias antes.
  5. Trocar data → confirmar → `folhas_pagamento.status = 'enviada'`, `data_pagamento_prevista` nova.
  6. Verificar que `/financeiro/contas-a-pagar` aba People mostra o item com a data trocada.

## Decisões já tomadas (não precisam voltar)

- `estagio` segue o mesmo caminho do `clt` (folha `contabilidade`, RH anexa recibo). Já é o comportamento atual do backend.
- `socio` continua fora do fluxo (filtrado na origem).
- Nome do botão: **"Anexar"** quando falta; **"Ver"** quando anexado (abre o PDF via signed URL, mesmo helper que o kanban usa).
- Default do input de data: `min(data_pagamento_prevista)` das folhas do lançamento. Em lançamento híbrido com 4 folhas, a mais próxima manda (todas as 4 ficam com a mesma data após o envio).
- Ordem dos slots: pela `origem` ('contabilidade' antes, 'california' depois) e dentro, por `tipo_folha_ferias` ('usufruto' antes, 'abono' depois). Mesma ordem do kanban.
- Aprovação única do financeiro pra todo o lote: já é o comportamento existente, não muda.

## O que fica pro builder

- Nomes finais dos arquivos (`BlocoDocumentosLancamento.tsx`, `DialogConfirmarEnvio.tsx`): à sua escolha, seguindo o padrão `kebab-case` dos vizinhos (`botao-recibo.tsx`, `modal-detalhe-solicitacao.tsx`).
- Estilo do progresso (barra vs texto "N/M"): seguir o que o kanban já usa pra manter visual consistente.
- Microcopy exata dos tooltips e empty state: pt-BR com acento; seguir o tom seco e direto do resto do RH.
