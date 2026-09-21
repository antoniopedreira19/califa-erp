# Task 008 — Jobs + Realizado (2026-07-30 a 2026-07-31)

Tela do job (`/jobs/[jobId]`) ganhou a seção **Realizado** (planilha por grupo com click-to-edit no bloco REALIZADO) e a lista `/jobs` virou tabela real com filtros. Fluxo end-to-end validado em prod: aprovar versão → criar job → aprovar/rejeitar no financeiro → lançar realizado → mudar status → planilha vira read-only em finalizado/cancelado.

## O que entrou

- **Lista `/jobs`**: substitui placeholder. Colunas Código/Nome/Projeto/Cliente/Responsável/Início/Valor/Status. Chips de filtro por status + busca por nome/código (client-side). Linha inteira clicável. Sub-jobs aparecem como linhas separadas com badge `Sub-job → JOB-XXXX`.
- **Extensão `/jobs/[jobId]`**: depois do card Status, nova seção "Planilha do job · v{N}" com link pra versão aprovada. Se status `aguardando_abertura` ou `rejeitado_financeiro`, card cinza informativo no lugar da planilha.
- **Tabela do realizado**: cards de grupo (herda da versão aprovada). Grade com 4 blocos:
  - ORÇADO (RO): R$ Unit / QT / D-M / Total (cinza-escuro)
  - PLANEJADO (RO): R$ Unit / QT / D-M / Total (azul)
  - REALIZADO (edit): R$ Unit / QT / D-M / Total (âmbar `#fef3c7`/`#d97706`)
  - VARIAÇÃO: R$ / % (verde se economia, vermelho se estouro)
  Click-to-edit apenas no bloco REALIZADO. `Enter` confirma, `Esc` cancela, `Blur` autosalva. Subtotal por grupo no tfoot.
- **Regras de edição**:
  - Editar: `job.status ∈ {aberto, em_producao}`. Bloqueado em `finalizado`/`cancelado`/`aguardando`/`rejeitado`.
  - Ownership: `session.activeRole === 'administrador'` OU `job.responsavel_id === session.profile.id`. Financeiro não edita realizado (só consulta).
  - Falha por ownership registra `audit.acao_negada` com metadata da ação tentada.
- **Card de totais do job**: 3 camadas (por grupo, por Tipo A/B/C/D, resumo Honorários/Impostos/Faturamento) + camada 4 com Total Realizado / Variação vs Planejado / Resultado Real (Faturamento − Impostos − Realizado). Verde se ≥ 0, vermelho se < 0.
- **Modelagem**: tabela `jobs_itens_realizado` (1:1 job × item da versão aprovada). Unique parcial `(job_id, item_id)`. `total_realizado` GENERATED. FKs `on delete cascade` (job cancelado não deleta linha; realizado histórico preservado enquanto job existir). Preparada pra virar origem de `pedidos_compra` e `titulos_financeiros` em tasks futuras.
- **Audit**: `job.realizado_atualizado` com metadata `{ item_id, campo, valor_novo, valor_anterior }`.

## Migrations aplicadas

```
20260730000001_task008_jobs_realizado.sql
```

## Commits relevantes

- `4acc3d6` — fix(jobs): PostgREST embed self-referencial de pai retorna array — normaliza pra objeto
- `8123c1d` — ux: header padrão com ícone+kicker+título em todas as páginas + doc
- `3b6df06` — ux: padroniza largura `max-w-7xl` em detalhe/planilha + doc do padrão
- `34e4bb2` — task008 ux: abas Info/Rentabilidade + largura 7xl + colunas do Item/Tipo
- `1787a5c` — task008 fix: reset `finalizado` ref between edits + audit status denial
- `d5042aa` — task008: card de totais do job (Orçado × Planejado × Realizado + resultado real)
- `3fee522` — task008: tabela do realizado com click-to-edit + upsert via server action
- `71f5aec` — task008: migration `jobs_itens_realizado` + type + audit action

## Pontos de atenção pra próxima sessão

- **`finalizado` ref stale** também na `versoes/.../itens-table.tsx` — mesmo bug do `CelulaRealNum` que consertei no realizado (commit `1787a5c`). Aplicar `useEffect(() => { if (editando) finalizado.current = false }, [editando])`.
- Bug esperado: se `criarJob` falhar entre steps do swap principal↔sub-job, DB fica em estado parcial (não é transacional). Recovery é manual via SQL — se acontecer, avisa antes de continuar. Fix pendente em backlog P5.
