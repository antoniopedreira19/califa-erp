# Task 010 — Pedidos de Compra (fase 1: emissão + cancelamento) (2026-07-31)

Fase 1 do fluxo de compras: emitir e cancelar Pedidos de Compra (PP) a partir de itens realizados de job. Fase 2 (aprovação/baixada no financeiro) fica em backlog.

## O que entrou

- **Tabela `pedidos_compra`** (1:1 com `jobs_itens_realizado` via unique constraint) + `pedidos_compra_anexos` (N por PP). Snapshot dos dados no ato da emissão (`servico`, `valor`, `quantidade`, `especificacoes`) — realizado mudar depois **NÃO** altera PP.
- **Sem coluna `status`** por agora — cancelar = hard delete (row + PDF + anexos + `fornecedor_id=null` no realizado). Fase 2 reintroduz status quando entrarem `aprovada`/`baixada`/`reprovada`.
- **Código `PP-NNNNN` sequencial por tenant** via função `gerar_codigo_pp(tenant_id)` com `pg_advisory_xact_lock` (serializa geração concorrente sem penalizar leitura).
- **Bucket privado `pedidos-compra`** com policies por prefix path = `tenant_id` (mesmo padrão de `orcamento-importacoes`).
- **Fluxo 2 fases pra upload**: client faz `supabase.storage.upload` direto pro bucket (evita limite de 4.5 MB do body Vercel), depois `finalizarPedidoCompra` valida paths existentes + persiste rows + gera PDF.
- **PDF via `pdfmake`** (JS puro, serverless-friendly). Layout fiel ao anexo de referência, EXCETO: sem Espécie/Formato/Cores/Meio/Acabamento; sem Prazo Entrega/Local Entrega; assinatura só do responsável do job.
- **UI**: trilha lateral fora do card da tabela (mesmo padrão do `itens-table.tsx` da versão). 3 estados: sem realizado (vazio), com realizado sem PP (ícone `FilePlus`), com PP (ícones `Eye` + `Trash2`).
- **Drawer** com defaults inteligentes: empresa = `job.empresa_id`, prazo = hoje+15 dias, serviço = `item.item`, quantidade = `qtd_realizada`.
- **Permissão**: admin OR responsável do job. Job precisa estar em `aberto` ou `em_producao`.
- **Anexos**: PDF + imagem, 8 MB/arquivo, 25 MB total, obrigatório ≥1 no ato de gerar.
- **Audit**: `pedido_compra.emitida` + `pedido_compra.cancelada`. Denials registram `acao_negada`.

## Migrations aplicadas

```
20260731000003_task010_pedidos_compra.sql
```

## Pontos de atenção pra próxima sessão

- **Case-sensitivity de imports em libs Node-only**: Windows é case-insensitive, Linux (Vercel) é case-sensitive. `pdfmake/src/printer` funciona local mas quebra no Vercel. Fix aplicado: `pdfmake/src/Printer` + `serverComponentsExternalPackages: ["pdfmake", "pdfkit"]` no `next.config.js`. Ao adicionar lib Node-only, **rodar `rm -rf .next && npm run build` local antes de pushar** — typecheck+lint não pegam.
- Fase 2 (fluxo financeiro) está mapeada no HANDOFF `Próximos passos · Prioridade 2`.
