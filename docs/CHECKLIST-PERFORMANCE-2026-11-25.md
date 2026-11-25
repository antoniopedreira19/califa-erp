# Checklist de Performance — ERP California

**Base:** síntese de `BRIEFING-SECOND-OPINION-PERFORMANCE-2026-11-25.md` + `CALIFA-AUDITORIA-VERCEL-PLANO-VALIDADO-2026-11-25.md` + `PLANO-PERFORMANCE-CONSOLIDADO-2026-11-25.md`.

**Regra:** executar em ordem. Só passar para o próximo item quando o atual estiver com status ✅ **ou** com decisão explícita de pular/postergar registrada.

**Legenda de status:** ⬜ não iniciado / 🟡 em andamento / ✅ concluído / ⏭️ pulado (com justificativa)

---

## Bugs ativos em produção (correção antes de otimização)

### ✅ 1. Corrigir `desembolsos.nf_corrigida: invalid input syntax for type json`

- **Evidência original:** 147 ocorrências nas últimas 24h, última em 25/11 10:43:47 UTC.
- **Causa raiz identificada:** bug de serialização do `supabase-js` — `.contains("documentos", [{ tipo: "desembolso" }])` em `app/(app)/financeiro/desembolsos/dados.ts:233`. O array de objetos JavaScript era convertido via `String()` resultando em `[object Object]` literal na URL enviada ao PostgREST. Prova nos logs: `documentos=cs.%7B%5Bobject+Object%5D%7D`.
- **Fix aplicado em 2026-11-25:** adicionado `JSON.stringify()` ao redor do filtro, alinhando com o padrão já existente em `saves-da-abertura.ts:207`.
- **Impacto real do bug:** zero travamento visível (código tratava o erro com `?? []`). Efeito silencioso: histórico de "NF corrigida" nunca aparecia em desembolsos quando houvesse; 147 erros 400/dia poluindo logs.
- **Verificação:** typecheck limpo. Em 24h pós-deploy: zero ocorrências do cluster `[desembolsos.nf_corrigida]` nos logs do Vercel. Confirmar antes de marcar como fechado em definitivo.

### ✅ 2. Investigar `financeiro.pp.list: statement timeout` (4 ocorrências)

- **Evidência original:** última em 19/11 20:01, antes do fix de RLS aplicado em 23/11 pela migration `20261120100001_rls_acesso_empresa_e_colegas_uma_vez.sql`.
- **Resultado da investigação:**
  - Nos últimos 7 dias, foram 3 timeouts (57014) no Postgres — **nenhum em `pedidos_compra`**. Todos no `public.historico_dre()` (query de DRE histórico, max 7,9 s). Ver [case study §9 a ser criado em docs/PERFORMANCE.md].
  - Nas últimas 24h, GET /rest/v1/pedidos_compra: 3.615 hits, média 295 ms, p75 245 ms, p95 1,69 s. **Não há timeout dessa query no período.**
  - Os 4 timeouts originais do `pp.list` (last 19/11) foram eliminados pela migration de RLS do case study §7. Ganho: lista de 1000 PPs saiu de 1,07 s → 150 ms.
- **O que ficou em aberto (novo alvo):** `public.historico_dre()` com max 7,9 s e `/rest/v1/vw_fluxo_caixa_job_*` com média 2,3 s. Esses entram em itens separados abaixo se forem priorizados. P75 de 7 s do `/financeiro/contas-a-pagar` no Vercel é soma do overhead da tela (44 queries em paralelo), não timeout de query isolada.
- **Não fazer:** reabrir este item sem nova evidência de timeout no `pedidos_compra`.

### ⬜ 3. Investigar `fluxo-caixa: permission denied _historico_previsoes_pagas` (4 ocorrências)

- **Evidência:** última em 24/11 17:55. Função chamada sem GRANT para o role.
- **Como investigar:**
  - [ ] Ver no código quem chama `_historico_previsoes_pagas`.
  - [ ] Ver no banco qual role tem/falta GRANT.
  - [ ] Decidir: é bug de chamada (chamou função errada) ou falta GRANT legítimo.
- **Critério de ✅:** diagnóstico documentado, correção planejada separadamente.
- **Não fazer:** não conceder GRANT amplo para "resolver" sem entender.

### ⬜ 4. Corrigir cluster de erros de `boas-vindas.completar` (60 ocorrências agregadas)

- **Evidência:** 26 (hobbies malformed array) + 17 (curiosidade) + 17 (rg) + 13 (colaboradores_banco_formato). Última em 24/11 21:21.
- **Padrão:** contrato de tipos entre frontend e Postgres quebrou (campos jsonb/array).
- **Como investigar:**
  - [ ] Ver o form de boas-vindas (`app/(app)/_boas-vindas/`).
  - [ ] Ver como esses campos são serializados no server action.
  - [ ] Confirmar se foi corrigido entre 24/11 e hoje ou se ainda acontece.
- **Critério de ✅:** diagnóstico do padrão (provavelmente um só, repetido em 4 campos) + fix em PR separado.

### ⬜ 5. Corrigir `chat.marcar_lido: ON CONFLICT sem constraint correspondente` (13 ocorrências)

- **Evidência:** última em 19/11 21:20.
- **Como investigar:**
  - [ ] Ver o server action de marcar leitura de chat.
  - [ ] Ver se o `ON CONFLICT` cita colunas que não têm UNIQUE/PRIMARY KEY no banco.
- **Critério de ✅:** fix em PR separado ou confirmação de que já foi corrigido.

### ⬜ 6. Investigar `perfil.solicitar.insert: RLS colaboradores_ferias_lancamentos` (3 ocorrências)

- **Evidência:** última em 23/11 18:09.
- **Como investigar:**
  - [ ] Ver o fluxo de solicitar férias pelo perfil.
  - [ ] Ver a policy de INSERT na tabela.
  - [ ] Decidir: é bug de código (role errado) ou policy mal escrita.
- **Critério de ✅:** diagnóstico documentado.
- **Não fazer:** não relaxar RLS para "resolver".

---

## Monitoramento e validação do que já foi mexido

### ⬜ 7. Monitorar efetividade do `work_mem = 8MB` aplicado em 25/11 10:32 UTC

- **Baseline gravado:** 295.919 temp files, 1.287 GB, 15.279.520 transações.
- **Como medir:**
  - [ ] Rodar diariamente por 3 dias a query de baseline (está no ADR 278).
  - [ ] Calcular: `(temp_files_novos) / (transacoes_novas)` em cada janela.
  - [ ] Comparar com taxa histórica (temp_files ÷ transações antes da mudança).
- **Alvo:** queda ≥ 60% na taxa de criação de temp files por transação.
- **Rollback preparado:** `alter database postgres set work_mem = '5MB'; select pg_reload_conf();` — 30 segundos.
- **Critério de rollback imediato (sem esperar prazo):**
  - OOM no compute
  - Swap sustentado > 500 MB
  - CPU média subindo acima de 60%
  - Qualquer agravamento percebido pelos usuários
- **Critério de ✅:** 72h com taxa de temp files reduzida ≥ 60% e sem agravamentos.

### ⬜ 8. Validar interpretação das métricas do dashboard do Supabase

- **Métricas com dúvida:**
  - [ ] `Disk IO Balance 99%`: confirmar se é crédito disponível ou consumido (doc do Supabase).
  - [ ] `Memory usage 1,64 / 2,05 GB`: confirmar se é 80% (correto) e não 33% (meu erro inicial).
  - [ ] `Memory commitment SEVERE`: entender exatamente o que o Supabase considera.
- **Critério de ✅:** definições registradas no ADR 278 com link para doc oficial.

### ⬜ 9. Reproduzir o travamento da a produtora com instrumentação

- **Por quê:** separar "lento no server" (queries) de "lento no browser" (hydration, DOM, extensões).
- **Como:**
  - [ ] Agendar sessão de 15 min com a a produtora, dado o horário habitual dela (~19h).
  - [ ] DevTools aberto: Network, Performance (gravando), Memory (snapshot).
  - [ ] Pedir pra ela usar o fluxo que trava (abrir pedido de compra, aprovar, anexar NF).
  - [ ] Capturar: waterfall HTTP, long tasks no main thread, heap size, payload RSC.
- **Critério de ✅:** trace salvo com classificação do travamento (server / browser / rede).

### ⬜ 10. Rastrear origem das invocações excessivas

- **Evidências:**
  - `/perfil`: 4.000 invocações / 7 dias com 15-20 usuários = ~3 hits/user/dia. É muito.
  - `/jobs/[jobId]`: 11.000 invocações — confirmar que é uso real, não refetch.
- **Como:**
  - [ ] Olhar `components/sidebar.tsx`: `<Link href="/perfil">` tem `prefetch={false}`?
  - [ ] Olhar `components/sidebar.tsx`: outros Links em listas sem `prefetch={false}`?
  - [ ] Adicionar `console.log("[/perfil]", userId, Date.now())` temporário em `app/(app)/perfil/page.tsx` por 24h (só server side, sem PII).
  - [ ] Classificar: navegação real × prefetch × refetch após mutação.
- **Critério de ✅:** 60%+ das invocações classificadas; se há prefetch excessivo, lista de fixes pontuais pronta.

---

## Entender onde está o custo real

### ⬜ 11. Correlacionar deployments com regressões de performance

- **Fato:** 231 deployments de produção entre 11/11 e 25/11 (14 dias). Pico de 67 em 23/11.
- **Como:**
  - [ ] Listar deploys de 23/11 (coincide com entregas das decisões 276 e 277).
  - [ ] Para cada SHA, ver se tocou em `app/(app)/financeiro/` ou `app/(app)/jobs/`.
  - [ ] Cruzar com P75 de rota por deployment (se o Vercel expõe isso) ou com janelas de 2h antes/depois do deploy.
- **Critério de ✅:** se alguma regressão identificada, SHA do culpado nomeado.

### ⬜ 12. Analisar cadência e custo de builds

- **Fato:** Build CPU Minutes custou US$1,18 no ciclo recente (~16% do total do Vercel).
- **Como:**
  - [ ] Dos 26 deploys com prefixo `docs:`, quantos são realmente só documental (git diff)?
  - [ ] Avaliar política de "Ignored Build Step" para diffs confirmadamente docs-only.
  - [ ] Avaliar `squash` de commits em branch de feature antes do merge.
- **Critério de ✅:** proposta de política de build escrita, não aplicada.
- **Não fazer:** não desligar previews necessários, hotfix ou gate de segurança.

### ⬜ 13. Obter billing real da Vercel e do Supabase (ciclo atual e anterior)

- **Lacuna atual:** a auditoria não conseguiu confirmar valor da fatura por API (404). Só valores exibidos.
- **Como:**
  - [ ] Exportar Usage da Vercel por projeto, produto, dia e ambiente.
  - [ ] Pegar invoice do Supabase: compute, disco, egress, storage, Realtime.
  - [ ] Comparar ciclo atual com anterior.
- **Critério de ✅:** planilha com custo real por categoria, dois ciclos comparados.
- **Não fazer:** não ativar add-on pago pra conseguir dados.

---

## Otimizações do banco (candidatas de alto ROI)

### ⬜ 14. Otimizar `public.saldos_dos_dias_em_aberto(p_conta_id uuid)`

- **Evidência:** 1.549 chamadas, 347 ms média, máx 2,52 s, **53 milhões de blocos lidos** (o maior consumidor de I/O relativo).
- **Como:**
  - [ ] `pg_get_functiondef()` para ler a função.
  - [ ] `EXPLAIN (ANALYZE, BUFFERS)` com `p_conta_id` real em sessão com role `authenticated` adequado.
  - [ ] Identificar: falta índice? CTE força scan? Subquery correlacionada?
  - [ ] Propor migration com índice composto ou reescrita.
- **Critério de ✅:** migration aplicada, média cai para < 50 ms, `shared_blks_read` cai > 80%.
- **Risco:** baixo (comparar resultado antes/depois).

### ⬜ 15. Investigar `storage.search` (máx 20,2 s)

- **Evidência:** 3.186 chamadas, média 442 ms, máx 20,2 s, 87 M blocos.
- **Hipótese:** é o que faz a a produtora sentir que travou ao listar anexos de pedidos de compra.
- **Como:**
  - [ ] Ver se há índice nas colunas usadas no `storage.objects` (bucket_id, name, path).
  - [ ] Ver o padrão de uso: listar pasta grande? Recursivo?
  - [ ] No código, ver se há como pré-filtrar antes de chamar `.list()`.
- **Critério de ✅:** causa raiz identificada; se for falta de índice no storage, migration proposta.

### ⬜ 16. Investigar `pg_timezone_names` chamada 3.077 vezes

- **Evidência:** 621 ms média, 1.909 s total, 3,68 M linhas devolvidas. Suspeita de ser introspecção do PostgREST.
- **Como:**
  - [ ] Verificar `application_name` e `role` dessas chamadas no `pg_stat_activity` ou logs.
  - [ ] Se for PostgREST: ver se há config pra desabilitar introspecção (`PGRST_DB_PREPARED_STATEMENTS`, `PGRST_DB_CHANNEL`).
- **Critério de ✅:** origem identificada; decisão documentada.

### ⬜ 17. Bloquear execução manual de scripts pesados em horário comercial

- **Evidência:** DO block anônimo de 87 segundos (auditoria RLS impersonando 14 usuários) rodou em produção.
- **Como:**
  - [ ] Combinar com equipe: nenhum `DO $$ ... $$` manual em horário de expediente.
  - [ ] Avaliar se há como restringir via role separado para operações de auditoria (ex.: `auditor_role` sem GRANT durante o dia).
- **Critério de ✅:** regra documentada e aceita.

---

## Otimizações de código (as duas rotas críticas)

### ⬜ 18. Mover `calcularSaldoAnterior` para o Promise.all principal da conciliação

- **Evidência:** `app/(app)/financeiro/conciliacao/page.tsx:196-201` — roda fora do Promise.all principal quando aba é Extrato.
- **Como:**
  - [ ] Discriminar `aba === "extrato"` dentro do Promise.all (como já é feito para `aba === "titulos"` na linha 136).
  - [ ] Garantir que `saldoAnterior` fica disponível para a derivação subsequente.
- **Critério de ✅:** PR com benchmark antes/depois (medir P75 da rota com mesmo conjunto de dados).
- **Risco:** baixo.

### ⬜ 19. Avaliar `todasAsLinhas()` caso a caso

- **Evidência:** `lib/supabase/todas-as-linhas.ts:39-45` itera em série. 6 chamadas em `/financeiro/contas-a-pagar`.
- **Como:**
  - [ ] Para cada uma das 6 chamadas (PPs, baixas, estornos, fornecedores, outras empresas, CNAB):
    - É order-sensitive? Pode paralelizar páginas?
    - Qual a cardinalidade típica? Passa de 1000?
  - [ ] Se a maioria passa de 1000, propor variante paralela da função (manter a antiga para quem precisa de ordem).
- **Critério de ✅:** para cada chamada, decisão registrada (paralelizar ou manter).
- **Não fazer:** não paralelizar globalmente sem análise.

### ⬜ 20. Classificar os 113 `router.refresh()` em `app/(app)/financeiro/`

- **Evidência:** `grep -r "router\.refresh" app/(app)/financeiro/` retornou 113 ocorrências.
- **Como:**
  - [ ] Para cada ocorrência, classificar:
    - **Necessário** (precisa re-render completo da rota porque múltiplas áreas mudam)
    - **Redundante** (já há update local; pode remover)
    - **Substituível por `revalidatePath`/`revalidateTag`** (só uma parte mudou)
  - [ ] Começar pelos piores ofensores: `aba-banco.tsx` (15), `aba-titulos.tsx` (7), `titulos-pagar-list.tsx` (5), `pp-tela.tsx` (5), `revisar-folha-drawer.tsx` (4), `fechamento.tsx` (2).
- **Critério de ✅:** planilha com classificação; PR aplicando as mudanças seguras.
- **Alerta:** `revalidatePath/Tag` não garante atualização localizada e não necessariamente reduz invocações.

### ⬜ 21. Lazy-load de abas em `/jobs/[jobId]` com `next/dynamic`

- **Evidência:** `carregar-detalhe.ts` tem 2.245 linhas, 39 queries estáticas. Abas não são lazy.
- **Como:**
  - [ ] Identificar abas raramente visitadas: `comunicacao`, `erratas`, `mídia-off` (só em jobs de mídia).
  - [ ] Separar loader por aba (importante: `next/dynamic` sozinho não adia SQL; precisa separar a query também).
  - [ ] Manter o tab principal (planilha) carregando no SSR.
- **Critério de ✅:** PR com benchmark antes/depois do P75.
- **Risco:** médio (precisa testar hidratação da aba lazy).

---

## Otimizações estruturais (com validação obrigatória)

### ⬜ 22. Avaliar `unstable_cache` em cadastros estáveis

- **Candidatos:** `fornecedores`, `categorias`, `plano_de_contas`, `empresas`, `cliente_portais`, `fiscal_cnpj_da_pp_por_regional`, `comite_config`.
- **Pré-requisito obrigatório:**
  - [ ] Provar equivalência de autorização em HIT (não só em miss).
  - [ ] Revogação de permissão invalidar imediatamente o cache.
  - [ ] Teste entre tenants e entre papéis dentro do mesmo tenant.
- **Como:**
  - [ ] Chave: `{tenant_id}:{nome_cadastro}:{role}` (não apenas `{tenant_id}`).
  - [ ] Invalidação via `revalidateTag` em todos os CRUDs do cadastro.
  - [ ] TTL conservador (1-5 min).
- **Critério de ✅:** cadastros com ≤ 1 query/render após primeiro miss; zero vazamento entre tenants/roles em teste explícito.
- **Não fazer:** cache compartilhado de saldos, pagamentos, dados financeiros ou pessoais.

### ⬜ 23. Avaliar materialização de `vw_saves_por_job` e outras views pesadas

- **Pré-requisito obrigatório:**
  - [ ] Combinar com time de produção: tolerância a atraso de X min aceita?
  - [ ] Garantir que decisão operacional não depende de saldo desatualizado.
- **Como:**
  - [ ] `CREATE MATERIALIZED VIEW ... WITH DATA`.
  - [ ] `REFRESH MATERIALIZED VIEW CONCURRENTLY` via pg_cron a cada X min.
  - [ ] Documentar atraso aceito na doc da feature.
- **Critério de ✅:** queries que lêem a view caem para < 10 ms.

### ⬜ 24. Avaliar redução/mudança de Realtime

- **Evidência:** Realtime lê todo o WAL — 3,5 M execuções, 27.388 s acumulados (maior consumidor isolado de CPU do banco).
- **Candidatos a sair/virar polling:**
  - [ ] `notificacoes_dismissed`: polling a cada 60 s já basta?
  - [ ] `jobs_mensagens`: UX aceita delay de 30 s?
  - [ ] `freelancer_solicitacao_mensagens`: idem?
- **Alternativa:** Realtime Broadcast (sem WAL) para chat; Postgres Changes só para o que precisar.
- **Como:**
  - [ ] Benchmark comparando os dois antes de decidir.
  - [ ] Nunca polling indiscriminado substituindo Realtime sem medir.
- **Critério de ✅:** decisão com dados; redução mensurável do consumo de WAL.

### ⬜ 25. Agregar RPCs do `carregar-detalhe.ts` — só se os itens 14-24 não resolveram

- **Risco:** alto. RPCs grandes são difíceis de manter, podem quebrar RLS por composição.
- **Como:** só avaliar se depois de 1-24 o P75 de `/jobs/[jobId]` ainda estiver > 1 s.
- **Pré-requisito:** avaliação de SECURITY INVOKER, grants, search_path e RLS por função composta.
- **Critério de ✅:** decisão documentada (fazer ou não fazer).

---

## Decisão de infraestrutura (último recurso)

### ⬜ 26. Upgrade de compute Supabase (Small → Medium, +~$60/mês)

- **Condição única para autorizar:**
  - [ ] Itens 7, 14, 15 (otimizações do banco) e 18-21 (otimizações de código) aplicados.
  - [ ] Memory commitment SEVERE ainda persistir.
  - [ ] P75 das rotas críticas ainda > 2 s.
  - [ ] Aprovação explícita do orçamento.
- **Pré-execução:**
  - [ ] Confirmar preço incremental real na conta (não estimativa).
  - [ ] Planejar janela de reinício do compute.
  - [ ] Notificar usuários.
- **Critério de ✅:** `Memory commitment` sai de SEVERE; P75 cai em todas as rotas em pelo menos 15%.

### ⬜ 27. Configurar alertas de budget

- **Como:**
  - [ ] Vercel: alertas em 50%, 75%, 90% de um valor menor que US$ 200.
  - [ ] Supabase: Spend Cap configurado (atual: ativo, limita disco a 8 GB).
  - [ ] Separar em qualquer relatório: custo bruto, créditos, excedente, taxas fixas e variáveis.
- **Critério de ✅:** alertas ativos e testados com valor dummy.

---

## Governança do processo

### ⬜ 28. Para cada PR da lista acima, preencher tabela de medição

| Campo | Valor |
|---|---|
| ID / hipótese | |
| SHA baseline | |
| SHA candidato | |
| Cenário medido | |
| N (amostras) | |
| P50 / P75 / P95 antes | |
| P50 / P75 / P95 depois | |
| Invocações/op | |
| Queries/op | |
| Bytes/op | |
| CPU/op | |
| Erros funcionais | |
| Testes de RLS/autorização | |
| Rollback testado | |
| Aprovação | |

### ⬜ 29. Atualizar `docs/PERFORMANCE.md` com case study novo ao fim de cada bloco

- Case studies devem documentar: sintoma, diagnóstico, fix, aprendizado.
- Seguir padrão dos 8 case studies existentes.

### ⬜ 30. Reavaliar este checklist ao fim de cada bloco de 5 itens

- Ajustar prioridade conforme medições reais.
- Nenhum item é intocável — se dados mostrarem que um item não ajuda, pular e documentar por quê.

---

## Restrições que valem para todos os itens

- Nenhuma mudança pode comprometer RLS, autenticação ou autorização.
- Nenhuma mudança pode introduzir inconsistência financeira.
- Nenhuma mudança pode restabelecer limites de registros que ocultem dados.
- Decisões arquiteturais documentadas em `docs/decisions/` devem ser respeitadas.
- `service_role` só pode ser usado no servidor.
- Nenhum aumento de custo sem aprovação explícita por item.
- Nenhum teste de carga em produção sem aprovação.
- Logs não podem conter PII, tokens, valores financeiros ou parâmetros SQL sensíveis.

---

## Próximo item a iniciar

**Item 1 — Corrigir `desembolsos.nf_corrigida: invalid input syntax for type json`.**

147 ocorrências em produção, ainda ativo no deployment atual, afeta fluxo de desembolso. Não é performance, é bug — mas tem precedência sobre qualquer otimização porque:

1. Pode estar inflando a latência das rotas vizinhas via retry.
2. Polui os logs e esconde outros erros.
3. Risco financeiro: desembolso é operação crítica.
