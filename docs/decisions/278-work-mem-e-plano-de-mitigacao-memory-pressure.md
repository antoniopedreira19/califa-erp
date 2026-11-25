# 278 — `work_mem` 5 → 8 MB e plano de mitigação do Memory commitment SEVERE sem subir compute

**Data:** 2026-11-25
**Status:** Etapa 1 aplicada em 2026-11-25 10:32 UTC (`alter database postgres set work_mem = '8MB'`). Etapas 2 a 5 em aberto, a serem executadas conforme capacidade.
**Quem decidiu:** Antonio, em 25/11/2026, diante de reclamação de uma produtora (perfil `produtor`, módulo de Pedidos de Compra) de travamento recorrente ao usar a tela. Confirmado o diagnóstico de pressão de memória no Supabase e escolhido o caminho sem custo (Opção A) antes do upgrade de compute (Opção B, reservada para quando couber orçamento).

## 1. O que se viu

a produtora era a única reportando "o sistema cai". Nos logs do Supabase das últimas 24h, nada de erro do lado dela: 3.633 respostas `200`, 13 `201`, 20 `204`, nenhuma `4xx`/`5xx`, latência p95 ~200 ms, máximo absoluto 921 ms. 99% das chamadas vêm do SSR do Next (user-agent `node`); do browser dela, só 3 requisições (todas uploads de NF em Pedidos de Compra).

O que apareceu foi no dashboard de Observability do próprio Supabase:

- **Memory commitment: 1,65 GB — marcador SEVERE**, com picos acima da linha-limite.
- **Disk IO Balance: 99%** (crédito de IOPS quase esgotado no gp3 de 2 GB).
- Compute atual: **Small** (2 vCPU compartilhado, 2 GB RAM, 2 GB disco gp3 3000 IOPS, região sa-east-1).

No banco, via `pg_stat_statements` e `pg_stat_database`:

- **1.287 GB em temp files acumulados** e **295.919 arquivos temporários** criados desde 2026-07 — a prova de que queries pesadas estão vazando `work_mem` pra disco. Cache hit ratio é 100% (índices OK), então o gargalo não é falta de índice: é memória de trabalho insuficiente.
- Top consumidoras de I/O: `public.saldos_dos_dias_em_aberto(p_conta_id)` (53 M blocos lidos em 1.549 chamadas, média 347 ms, máx 2,5 s), `public.orcamento_esta_vazio(p_orcamento_id)` (11.378 chamadas, máx 5,17 s), `storage.search` (máx 20,1 s), `public.trava_do_cancelamento_do_job(p_job_id)` (máx 4,96 s), `public.registrar_alteracao_do_financeiro(p_job_id, p)` (máx 6,72 s).
- Um `do $f$` anônimo de auditoria de RLS (impersona 14 usuários + `hashtext` de todas as tabelas do schema `public`) rodou duas vezes desde 17/11 e levou até **87 segundos** cada rodada. Trava o DB inteiro quando roda.
- `work_mem` global estava em **5 MB**; `shared_buffers` em 512 MB; `effective_cache_size` em 1,5 GB (compatível com Small).
- Pool de conexões folgado (6/90), então não é esgotamento de pool: é pressão de memória levando ao despejo pra disco e ao gargalo de IOPS.

Por que o perfil de produtor é quem mais sente: o fluxo de Pedidos de Compra com upload de NF toca `storage.search` + RLS + RPCs pesadas em sequência rápida; cada render SSR do app dispara ~30 endpoints em paralelo (`jobs`, `pedidos_compra`, `saves_aprovacoes`, `jobs_itens_orcado`, `jobs_mensagens`, `jobs_chat_leituras`, `vw_saves_por_job`, `comite_*`, `fiscal_*`, `empresas_socio_de_custos`, `jobs_alteracoes_financeiro`, etc.). Quando o DB está em memory pressure, `storage.search` sobe de 441 ms pra 20 s e o browser aparenta ter congelado. Outros perfis (financeiro) sentem o mesmo, com menos frequência.

## 2. Decisão

Começar pela **Opção A (sem custo)** e segurar a **Opção B (upgrade de compute = +~$60/mês, Medium 4 GB RAM)** para quando couber no orçamento. O Team ($599/mês) foi avaliado e descartado: é sobre SSO, SOC2, HIPAA e PrivateLink, não sobre capacidade. O add-on de compute está dentro do Pro.

## 3. O que foi feito (Etapa 1)

Em 2026-11-25 10:32 UTC:

```sql
alter database postgres set work_mem = '8MB';
```

Via MCP com o role `postgres`. O Supabase gerenciado bloqueia `ALTER SYSTEM` global (erro `42501: permission denied to set parameter "work_mem"`); `ALTER DATABASE` passa e persiste em `pg_db_role_setting`. Afeta conexões NOVAS; o pool do PostgREST recicla naturalmente ao longo de 1-2 h. Zero downtime, zero reinício.

**Pior caso teórico de RAM** com o novo valor: 90 conexões × 8 MB × 2 operações = 1,44 GB, ainda dentro dos 2 GB. Na prática fica muito abaixo porque a maioria das queries não precisa de `work_mem` cheio.

**Rollback:** `alter database postgres set work_mem = '5MB';` — reverte em segundos.

## 4. Baseline gravado (pra medir impacto em 24-48 h)

| Métrica | Valor em 2026-11-25 10:32 UTC |
|---|---|
| `work_mem` | 5 MB → **8 MB** |
| `temp_files` acumulado | 295.919 |
| `temp_bytes` acumulado | 1.287 GB |
| Transações totais (`xact_commit + xact_rollback`) | 15.279.520 |
| Compute | Small — 2 GB RAM, 2 GB disk gp3, 3.000 IOPS, 125 MB/s |
| Disk IO Balance no dashboard | 99% |
| Memory commitment | SEVERE |

Query de reavaliação:

```sql
select
  now() as momento,
  (select setting from pg_settings where name='work_mem') as work_mem_atual,
  temp_files - 295919 as temp_files_desde_mudanca,
  pg_size_pretty(temp_bytes - 1382058590208) as temp_bytes_desde_mudanca,
  xact_commit + xact_rollback - 15279520 as transacoes_desde_mudanca
from pg_stat_database
where datname='postgres';
```

Alvo: queda ≥ 60% na taxa de criação de temp files por transação. Se não cair, sobe `work_mem` pra 10-12 MB. Se cair como esperado, avança pra Etapa 2.

## 5. Próximas etapas (não iniciadas)

| # | Ação | Prazo | Custo |
|---|---|---|---|
| 2 | Otimizar `public.saldos_dos_dias_em_aberto(p_conta_id)` (53 M blocos lidos; maior consumidora de I/O relativo). `EXPLAIN (ANALYZE, BUFFERS)` com um `p_conta_id` real + índice composto ou reescrita. | Esta semana | 0 |
| 3 | Otimizar `public.orcamento_esta_vazio(p_orcamento_id)` — 11.378 chamadas, máx 5 s; deveria ser `EXISTS` simples. | Esta semana | 0 |
| 4 | Investigar `public.trava_do_cancelamento_do_job(p_job_id)` — 6.823 chamadas, máx 5 s. | Próximas semanas | 0 |
| 5 | Materializar `vw_saves_por_job` com refresh periódico; agregar as ~10 queries do dashboard de job numa `get_job_dashboard(job_id)` para cortar o volume de endpoints do SSR. | Próximas semanas | 0 (dev) |
| B | Upgrade de compute Small → Medium (+~$60/mês): RAM 2 → 4 GB, permite `work_mem` 16-32 MB com folga. 2 cliques no painel. | Quando couber | +~R$ 300/mês |

## 6. Regra operacional nova

**Não rodar scripts pesados manualmente no banco em horário comercial.** O `do $f$` anônimo de auditoria de RLS trava o DB por ~1 min quando executa; já aconteceu 2x desde 17/11. Esse tipo de script fica pra noite ou fim de semana, sempre.

Para a a produtora (e quem repetir o relato): orientar a **limpar cache do navegador + logout/login** após a mudança, porque conexões antigas podem estar presas no estado anterior com `work_mem = 5 MB`.
