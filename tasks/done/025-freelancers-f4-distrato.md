# Task 025 — Freelancers (Fase 4, Task 2): Distrato (antecipação de término)

## Objetivo

Entregar o fluxo completo de distrato — antecipação do término de contrato quando o freelancer não vai mais trabalhar o período previsto.

Fluxo:
1. **GP solicita** o distrato: informa data proposta + motivo. Isso só grava os campos de solicitação; não muda o contrato ainda.
2. **RH gera minuta DOCX de distrato** com os dados do contrato + proposta.
3. Assinatura offline (eSignature ou papel).
4. **RH faz upload do PDF assinado**. Esse upload **aplica** a antecipação:
   - Preserva o `data_termino` original em `data_termino_original` (snapshot).
   - Atualiza `data_termino` pro `distrato_data_proposta`.
   - Marca `status_real = false` (freelancer não trabalha mais a partir desse ponto).
5. Alternativamente, qualquer um com permissão pode **cancelar o pedido** (volta pros valores anteriores de distrato).

Audit log em cada passo.

## Fora de escopo

- UI de "revisão do distrato" por parte do RH — ele só gera minuta e aplica. Negociação acontece no chat da solicitação (não existe nesse fluxo), ou offline. Simplificar.
- Alertas automáticos quando o distrato está aberto há muito tempo — Fase 4 Task 027.

## Decisões travadas

- **Campos já existem** em `freelancer_contratos` (Task 015): `data_termino_original`, `distrato_minuta_url`, `distrato_arquivo_url`, `distrato_data_proposta`, `distrato_motivo`, `distrato_solicitado_em`, `distrato_solicitado_por`.
- **Quem solicita**: qualquer um com acesso ao contrato (admin/rh/fin/gp/produtor). Admin/rh/fin podem solicitar e aplicar; gp/produtor só solicitam.
- **Quem gera minuta e aplica**: só admin/rh/fin.
- **Aplicação da antecipação**: função SQL `aplicar_distrato_de_contrato(contrato_id)` que roda numa transação. Precisa:
  1. Carregar contrato + ler `distrato_arquivo_url` (deve estar preenchido).
  2. Backup `data_termino_original = coalesce(data_termino_original, data_termino)` (não sobrescreve se já existia).
  3. `data_termino = distrato_data_proposta`.
  4. `status_real = false`.
- **Cancelamento**: zerа `distrato_*` + `status_real = true` + remove PDF/DOCX do storage. Via server action/endpoint.
- **Template DOCX do distrato**: simples. Reusa alguns helpers do `freelancer-contrato-docx.ts` (meseseDias é interno; `extenso` + `formatCurrency`). Vou criar `lib/freelancer-distrato-docx.ts` com template mínimo (adaptado do AgCaliforniaRH).
- **Audit**: `freelancer_contrato.distrato_solicitado`, `distrato_minuta_gerada`, `distrato_aplicado`, `distrato_cancelado`.

## Contexto do ponto de partida

### Já pronto

- Tabela com campos de distrato (Task 015).
- Bucket `freelancer-arquivos` com paths `{tenant_id}/contratos/{contrato_id}/distrato-minuta.docx` e `distrato-assinado.pdf`.
- `BlocoArquivos` na página de contrato (Task 018) — vou adicionar um bloco separado pra distrato.
- Função SQL `set_updated_at`.

### Novo que precisa nascer

- Função SQL `aplicar_distrato_de_contrato`.
- `lib/freelancer-distrato-docx.ts`.
- 4 route handlers: solicitar, gerar-minuta, enviar-assinado (aplica), cancelar.
- `BlocoDistrato` client component.
- Validation Zod da solicitação.

## Escopo

### 1. Arquivos novos

```
supabase/migrations/
└── 20261016000006_freelancers_f4_rpc_aplicar_distrato.sql

lib/freelancer-distrato-docx.ts
lib/validations/freelancer-distrato.ts

app/api/freelancers/contratos/[id]/distrato/
├── solicitar/route.ts            # POST: grava solicitação (quem/quando/motivo/data)
├── cancelar/route.ts             # POST: limpa campos de distrato
├── gerar-minuta/route.ts         # POST: gera DOCX e salva no bucket
└── enviar-assinado/route.ts      # POST multipart: salva PDF e chama RPC

app/(app)/freelancers/contratos/_components/
└── bloco-distrato.tsx            # UI do distrato
```

### 2. Arquivos modificados

- `app/(app)/freelancers/contratos/[id]/page.tsx` — renderiza `<BlocoDistrato />` abaixo do `BlocoArquivos`.
- `lib/auth/audit.ts` — 4 valores novos.

### 3. UI do bloco distrato

Estados visuais:
- **Sem distrato aberto**: botão "Solicitar distrato" (todos). Form inline com data + motivo.
- **Solicitado (sem minuta)**:
  - Mostra data proposta + motivo + quem/quando.
  - Admin/rh/fin: botão "Gerar minuta DOCX" + "Cancelar distrato".
  - Solicitante: botão "Cancelar distrato".
- **Minuta gerada (sem assinado)**:
  - Botão "Baixar minuta" + "Regenerar minuta" + "Enviar PDF assinado" (admin/rh/fin).
  - Botão "Cancelar distrato" (admin/rh/fin).
- **Aplicado** (distrato_arquivo_url preenchido):
  - Mostra "Distrato aplicado em X" + data antiga vs nova.
  - Botão "Baixar assinado" + "Baixar minuta".
  - Sem botão de cancelar (seria desfazer histórico — fica fora).

## Critérios de pronto

- [ ] Migration da RPC aplicada.
- [ ] Template DOCX de distrato funciona.
- [ ] GP consegue solicitar distrato + cancelar o próprio pedido.
- [ ] RH gera minuta, faz upload do assinado → antecipação aplica (data_termino_original preserva data antiga, data_termino = proposta, status_real = false).
- [ ] Audit log registra os 4 eventos.
- [ ] UI reflete os 4 estados corretamente.
- [ ] `npm run typecheck` e `lint` passam.
