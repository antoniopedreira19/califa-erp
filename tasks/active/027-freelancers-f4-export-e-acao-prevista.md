## Task 027 — Freelancers (Fase 4, Task 3): Export XLSX + toggle de ação prevista inline

## Objetivo

Dois utilitários que faltavam na lista:

1. **Export XLSX** da lista corrente de freelancers (respeita filtros aplicados).
2. **Toggle inline de "ação prevista"** direto na coluna da tabela — abre popover compacto, muda o valor sem sair da lista.

## Fora de escopo

- Histórico via trigger + aba Histórico — **Task 026** (volta quando MCP reconectar).
- Pool de notificações dismissed — ficou fora, pode entrar na 028.

## Decisões travadas

- **Export** via `exceljs` (já instalado). Server action retorna buffer via `arrayBuffer()`; client cria `Blob` + download. Alternativa seria route handler, mas action+Blob funciona bem pra arquivos pequenos (até 10k linhas tranquilo).
- **Toggle inline**: popover com 6 opções (5 ações + "Sem decisão"). Click na opção salva via server action e revalida.
- **Permissão**: só admin/rh/financeiro editam ação prevista. GP/produtor veem badge mas não trocam.
- **Export** disponível pra qualquer tenant_member (todos podem exportar o que veem).

## Arquivos

### Novos
- `app/(app)/freelancers/lista/_components/exportar-button.tsx` — Client component que chama a action e baixa o buffer.
- `app/(app)/freelancers/lista/_components/toggle-acao-prevista.tsx` — Popover client com as 6 opções.
- `app/(app)/freelancers/lista/export-action.ts` — Server action que roda a query (respeita filtros) e monta o XLSX.

### Modificados
- `app/(app)/freelancers/actions.ts` — adiciona `atualizarAcaoPrevista(id, acao)`.
- `app/(app)/freelancers/lista/page.tsx` — adiciona botão Exportar no header.
- `app/(app)/freelancers/lista/_components/lista-client.tsx` — Troca `AcaoPrevistaBadge` por `ToggleAcaoPrevista` quando podeEditar.
- `lib/auth/audit.ts` — valor `freelancer.acao_prevista_alterada`.

## Critérios de pronto

- [ ] Botão Exportar no PageHeader da lista.
- [ ] Click → gera XLSX e baixa (nome: `freelancers-YYYY-MM-DD.xlsx`).
- [ ] Toggle inline funciona pra admin/rh/fin; outros veem badge só-leitura.
- [ ] Mudança revalida a lista e os cards.
- [ ] Audit log em cada mudança.
- [ ] typecheck e lint passam.
