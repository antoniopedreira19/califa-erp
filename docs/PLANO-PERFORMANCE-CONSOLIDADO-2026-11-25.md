# Plano consolidado de performance — ERP California (2026-11-25)

> Esta é a síntese de dois trabalhos independentes:
> - `docs/BRIEFING-SECOND-OPINION-PERFORMANCE-2026-11-25.md` (diagnóstico interno + plano inicial)
> - `CALIFA-AUDITORIA-VERCEL-PLANO-VALIDADO-2026-11-25.md` (revisão externa com acesso direto ao Vercel)
>
> O objetivo deste documento é responder a pergunta: **qual é o melhor caminho para melhorar a performance?**

---

## 1. Convergências — o que os dois trabalhos concordam

| Fato | Status |
|---|---|
| Rotas `/financeiro/contas-a-pagar` (P75 7 s) e `/financeiro/conciliacao` (P75 4,8 s) estão fora do target | Confirmado |
| `/jobs/[jobId]` concentra 31% das invocações e 35% da CPU em 7 dias | Confirmado |
| Memory commitment do Supabase está sob pressão | Confirmado (só o grau divergiu — ver §2) |
| Code evidence: 44 queries em contas-a-pagar; 39 em jobs; `todasAsLinhas` em série; `calcularSaldoAnterior` fora do Promise.all; 113 `router.refresh()` no financeiro; Realtime em 7 client components | Confirmado |
| work_mem = 5 MB era baixo demais para as views pesadas | Confirmado |
| Qualquer mudança deve respeitar RLS, auth e consistência financeira | Confirmado |
| Materializar views só com tolerância explícita a atraso | Confirmado |
| Cache Next só com chave isolando tenant/empresa/role | Confirmado |
| `pg_timezone_names` chamado 3.077× é suspeito e merece investigação | Confirmado |
| DO block anônimo de 87 s é inaceitável em horário comercial | Confirmado |

---

## 2. Correções que a auditoria independente fez no meu diagnóstico

A segunda opinião pegou três erros interpretativos importantes. **Aceito as três correções.**

### 2.1. "Memory usage 33%" estava errado
Meu briefing dizia "RAM 33%". A auditoria apontou: **1,64 / 2,05 GB = 80%**, não 33%. O número 33% que apareceu num screenshot era de **outro contexto** (compute do Vercel Fluid, não do Postgres). O Postgres está em **80% de uso médio** com picos acima do limite — sem folga.

**Impacto na conclusão:** reforça que Opção B (upgrade de compute) é mais justificada do que eu havia colocado.

### 2.2. "Disk IO Balance 99% = esgotado" pode estar invertido
Interpretei como "crédito de IOPS quase esgotado". A auditoria alerta que **99% pode significar o oposto** (saldo disponível). Precisa validar na documentação do Supabase antes de tratar como gargalo.

**Impacto na conclusão:** não cai o diagnóstico de memory pressure (confirmado por 1,28 TB de temp files), mas uma das evidências que eu usei precisa de validação.

### 2.3. Minha "projeção de ganho" era otimista demais
Eu apresentei a tabela da seção 10 do briefing como previsão ("7 s → 2-3 s"). A auditoria corrige: **isso é meta experimental, não previsão**. Nenhum ganho pode ser projetado sem medição comparável.

**Impacto na conclusão:** não prometer percentual. Mediremos antes/depois cada mudança.

---

## 3. Descobertas novas que a auditoria trouxe (e que eu não tinha)

Aqui está o maior valor da segunda opinião: **ela puxou os logs runtime de produção do Vercel** que eu não tinha acesso direto. Encontrou coisas que a análise estática do código não pegaria.

### 3.1. 🚨 Erros ativos P0 — precisam ser atacados ANTES de otimização

| Erro | Ocorrências | Última | Severidade |
|---|---:|---|---|
| **`desembolsos.nf_corrigida: invalid input syntax for type json`** | 147 | 25/11 10:43 | 🔴 P0 — ainda acontecendo |
| `DEP0169 url.parse` (deprecated) | 149 | 24/11 22:19 | 🟡 warning |
| `importacao.sobrescrever.itens: NEW sem job_id` | 55 | 18/11 19:02 | 🟠 verificar se corrigido |
| `boas-vindas.completar: malformed array literal hobbies` | 26 | 24/11 20:02 | 🟠 contrato de tipos |
| `boas-vindas.completar: curiosidade` | 17 | 24/11 21:21 | 🟠 idem |
| `boas-vindas.completar: rg` | 17 | 24/11 21:21 | 🟠 idem |
| `chat.marcar_lido: ON CONFLICT sem constraint` | 13 | 19/11 21:20 | 🟠 integridade |
| `notas-fiscais.leitura: arquivo inválido` | 12 | 23/11 15:52 | 🟡 UX |
| **`financeiro.pp.list: statement timeout`** | 4 | 19/11 20:01 | 🔴 pode indicar query runaway |
| `fluxo-caixa: permission denied _historico_previsoes_pagas` | 4 | 24/11 17:55 | 🟠 autorização mal mapeada |
| `perfil.solicitar.insert: RLS colaboradores_ferias_lancamentos` | 3 | 23/11 18:09 | 🟠 política ou chamada errada |

**130 dos 186 erros runtime das últimas 24h são em `/financeiro/contas-a-pagar`.** Isso muda o quadro. Antes de otimizar a rota, precisa entender se parte do custo de 7 s vem de **retries** desses erros, não apenas de queries pesadas.

### 3.2. Cadência de deploys é um custo invisível
A auditoria rastreou **231 deployments de produção entre 11/11 e 25/11** — 14 dias. Isso é ~16 deploys/dia em produção. Picos: 67 em 23/11, 36 em 16/11.

Dos 231, **26 começam com prefixo `docs:`** (mas o prefixo não garante que o diff seja só documental). Build CPU Minutes custou US$1,18 do consumo total de ~US$7,41 nesse ciclo (~16%).

**Isso não aparecia no meu plano.** Vale atacar — mas só com evidência de que o diff é realmente docs-only.

### 3.3. Logs mostram que 70% dos erros estão em contas-a-pagar
Isso corrobora meu diagnóstico de rota crítica, mas também sugere que os 7 s podem incluir **comportamento de erro/retry** que não é só queries lentas. Precisa separar.

### 3.4. Billing real não foi acessível
A auditoria tentou acessar billing e falhou (404 na API). Portanto **nenhum número financeiro atual é fato confirmado** — só os valores exibidos no painel (consumo ~US$7,41 no ciclo, crédito US$20, excedente US$0).

---

## 4. Divergências metodológicas e qual postura adotar

A segunda opinião é mais cautelosa que a minha. Em pontos específicos:

| Ponto | Minha proposta | Auditoria | Posição final |
|---|---|---|---|
| Executar Prioridade 1 esta semana | Sim, 2 dias de dev | **Não — só Fase 0 (leitura) autorizada** | **Auditoria — primeiro medir, depois intervir** |
| Paralelizar `todasAsLinhas` globalmente | Sim, risco baixo | **Avaliar caso a caso (algumas queries podem não ser concorrência segura)** | **Auditoria** |
| Upgrade de compute condicionado a orçamento | Recomendo se couber ~R$ 300/mês | **Somente com evidência de saturação persistente E aprovação explícita** | **Auditoria** |
| work_mem de 5→8 MB já aplicado | Fiz direto, risco baixo | **Manter provisoriamente, SOMENTE se não houver agravamento; monitorar e preparar rollback** | **Auditoria — monitorar e documentar baseline** |
| Projetar ganho (7 s → 2-3 s) | Apresentei como esperado | **Meta experimental, não previsão** | **Auditoria** |
| Substituir `router.refresh` por `revalidatePath/Tag` em 23 arquivos | Sim, reduz invocações | **Classificar caso a caso: necessário/redundante/substituível. revalidatePath não garante atualização localizada** | **Auditoria** |
| `unstable_cache` em cadastros | Sim, baixa risco | **Cache persistente só após provar equivalência de autorização em todos os acessos — inclusive em hit** | **Auditoria** |

**Posição final geral:** a auditoria está certa em exigir medição antes de intervenção. Meu plano tinha urgência demais embutida pela queixa da usuária. A pressa não deve atropelar método.

---

## 5. Caminho recomendado — ordem de execução (síntese final)

### Fase 0 — AGORA (somente leitura, 1-3 dias)

**O que já foi feito:**
- [x] `work_mem` 5→8 MB aplicado via `ALTER DATABASE postgres SET work_mem = '8MB'` em 2026-11-25 10:32 UTC
- [x] Baseline gravado (295.919 temp files, 1.287 GB, 15,28 M transações)
- [x] ADR 278 e case study §8 documentados

**O que fazer nas próximas 72h:**

1. **Monitorar efetividade do work_mem**
   - Rodar a query de baseline a cada 24h.
   - Alvo: queda ≥ 60% na taxa de temp files por transação.
   - **Rollback preparado:** `alter database postgres set work_mem = '5MB';` (reverte em segundos).
   - Se houver agravamento (OOM, swap sustentado, CPU disparando): rollback imediato, não esperar prazo.

2. **Investigar os 3 erros P0** (não otimização, correção)
   - `desembolsos.nf_corrigida: invalid input syntax for type json` (147 ocorrências, ativo). **Hipótese:** algum campo jsonb recebendo string/number no path errado. Ler o server action, ver o contrato esperado vs. recebido.
   - `financeiro.pp.list: statement timeout` (4 ocorrências). Identificar a query exata via `pg_stat_statements` + `pg_stat_activity` em momento de reprodução. Pode estar inflando o P75 de 7 s de contas-a-pagar.
   - `fluxo-caixa: permission denied _historico_previsoes_pagas`. Identificar se é bug de código (chamando função sem GRANT) ou tentativa de acesso indevido. Não conceder GRANT amplo para "resolver".

3. **Reproduzir o travamento da a produtora com instrumentação**
   - DevTools: Network, Performance tab, heap snapshot, long tasks.
   - Horário certo: ela usa pedidos de compra ~19h. Pegar sessão autorizada com ela.
   - Objetivo: separar "lento no server" de "lento no browser".

4. **Validar interpretação de métricas**
   - "Disk IO Balance 99%": conferir na doc do Supabase se é crédito disponível ou consumido.
   - "Memory usage 1,64/2,05 GB = 80%": confirmar o denominador.
   - Fazer essas correções no ADR 278 e no `docs/PERFORMANCE.md §8`.

5. **Rastrear origem das invocações por rota**
   - `/perfil` 4.000 invocações em 7 dias é muito para 15-20 usuários. Confirmar se tem prefetch RSC não intencional da sidebar ou de algum card.
   - `/jobs/[jobId]` 11.000 invocações — identificar se é uso real ou refetch inflado.
   - Ferramenta: adicionar `console.log` temporário com user_id + timestamp no server component, ou usar Vercel Analytics se disponível.

6. **Entender a cadência de builds**
   - 231 deploys em 14 dias de produção.
   - Dos 26 "docs", **quais** são realmente só documentação? Dos que não são: atacar com `squash` ou "Ignored Build Step".
   - Estimar custo (Build CPU Minutes foi US$1,18 no ciclo).

7. **Correlacionar deploys de 23/11 (67 deploys!) com possível regressão de performance**
   - Picos de deploy coincidem com entregas das decisões 276 (NFs da planilha) e 277 (fiscal 4T).
   - Se P75 de conciliação estava menor em 15/11 e subiu para 4,8 s depois de 23/11, há regressão identificável.

### Fase 1 — DEPOIS da Fase 0 (correções pontuais)

Só autorizar depois que Fase 0 entregar evidências. Candidatos prioritários (ordem sujeita a mudar conforme medição):

- **Corrigir erro JSON em `desembolsos.nf_corrigida`** — bug ativo
- **Investigar e corrigir `statement timeout` em `financeiro.pp.list`** — pode estar inflando o P75 de 7 s
- **Otimizar `public.saldos_dos_dias_em_aberto(uuid)`** (ADR 278 etapa 2) — 53 M blocos, candidato a índice
- **Mover `calcularSaldoAnterior` para o Promise.all principal da conciliação** — fix pontual, não "paralelizar todasAsLinhas globalmente"
- **Avaliar `todasAsLinhas` caso a caso** — quais são seguras para paralelizar (sem dependência de ordem, sem concorrência de write)

Cada mudança: PR pequeno, benchmark antes/depois na tabela da seção 8 da auditoria.

### Fase 2 — Contas a Pagar e Conciliação

Separar carregamento essencial, abas, modais e agregações. Paginação server-side explícita com ordenação determinística.

**Preservar:** sem truncamento PostgREST, totais globais independentes da paginação visual, exportação completa.

**Meta experimental** (não previsão): P75 de contas-a-pagar em 2-3 s, conciliação em 1,5-2 s.

### Fase 3 — Jobs e Perfil

Separar loaders por aba. **`next/dynamic` por si só não adia SQL** (correção importante da auditoria). O ganho vem de não disparar queries de abas não visitadas, não só de não enviar JS.

Classificar cada `router.refresh()` dos 113 do financeiro: necessário / redundante / substituível por update local. **`revalidatePath/Tag` invalidam cache, não garantem atualização localizada nem redução automática de invocações.**

### Fase 4 — Eficiência estrutural

- Cache persistente só com teste de autorização em hit (não só em miss).
- Realtime: benchmark de Broadcast vs. Postgres Changes antes de decidir mudança.
- Materialização só para dados com tolerância a atraso (saldos operacionais ficam fora).
- Política de builds: agrupar pushes, validar diffs docs-only.

### Opção B (upgrade de compute) — reservada

Só autorizar com:
1. Evidência de saturação persistente **após** Fase 0 e Fase 1.
2. Confirmação do preço incremental na conta (não estimativa).
3. Impacto operacional claro.
4. Aprovação explícita.

---

## 6. Política financeira obrigatória (da auditoria)

Adoto integralmente:

- **Aumento de custo autorizado: nenhum** (até revisão).
- Não contratar, redimensionar, ativar add-on, criar sandbox/drain, alterar RAM/disco/IOPS, mudar região, mexer no spend cap.
- Não executar testes de carga em produção.
- Alertas de budget: sugerir 50/75/90% com valor < US$ 200.
- Separar custo bruto, créditos, excedente, taxas fixas e variáveis em qualquer relatório.
- Não desligar monitoramento (Observability) sem entender impacto financeiro.
- Não prometer % de economia sem medição comparável.

---

## 7. O que muda no meu plano original

### ❌ Removido
- "P1 nesta semana" como ação imediata
- Projeções numéricas de ganho ("7 s → 2-3 s") apresentadas como previsão
- Paralelização global de `todasAsLinhas`
- Upgrade pra Medium como recomendação "se couber" — vira condicional a evidência
- "`unstable_cache` em cadastros" como recomendação de baixo risco — vira condicional a validação de autorização

### ✅ Mantido
- Diagnóstico técnico das 5 rotas
- Evidências no código (file:line, Promise.all, router.refresh counts)
- Documentação (ADR 278, case study §8)
- `work_mem` 5→8 MB — mas agora com monitoramento ativo e rollback preparado

### ➕ Adicionado (vindo da auditoria)
- Fase 0 obrigatória antes de qualquer intervenção
- Tratar erros ativos (147 + 4 + 4) como P0, **antes** de otimização
- Investigar cadência de deploys (231/14 dias) como dreno de custo
- Validar interpretação de métricas (Disk IO Balance, memory %)
- Reproduzir travamento da a produtora com instrumentação
- Método SRE/USE: baseline → profiling → hipótese → intervenção isolada → benchmark
- Tabela de medição por PR (ID, SHA, cenário, N, p75/p95, invocações/op, bytes/op, etc.)

---

## 8. Resposta direta à pergunta: qual o melhor caminho?

### Em 72h (Fase 0)
1. Monitorar o `work_mem` já aplicado (está rodando desde hoje).
2. **Corrigir o erro JSON de `desembolsos.nf_corrigida`** — 147 ocorrências em produção é prioridade máxima, não performance.
3. Investigar o `statement timeout` do `financeiro.pp.list` — pode ser que parte dos 7 s venha de retry disso.
4. Reproduzir o travamento da a produtora instrumentado.
5. Validar as métricas que tinha interpretação dúbia.

### Em 1-2 semanas (Fase 1)
Só autorizar após Fase 0. O maior ganho isolado provavelmente estará em:
- Otimizar `saldos_dos_dias_em_aberto` (53 M blocos lidos — candidato claro a índice).
- Mover `calcularSaldoAnterior` pro Promise.all principal.
- Avaliar `todasAsLinhas` caso a caso.

### Em 1 mês (Fase 2-3)
Reestruturar contas-a-pagar e conciliação com paginação server-side. Lazy-load de abas em jobs. Classificação de `router.refresh()`. Cada um com PR pequeno, benchmark, review.

### Decisão sobre Opção B (upgrade)
Só quando houver evidência de que Fase 0 + Fase 1 foram insuficientes. Com `work_mem` + correção dos erros ativos + otimização de `saldos_dos_dias_em_aberto`, é possível que o Small ainda sirva por mais alguns meses.

### O que NÃO fazer
- Não implementar nada da Fase 1 nesta semana.
- Não fazer upgrade sem autorização explícita.
- Não paralelizar `todasAsLinhas` globalmente.
- Não substituir `router.refresh` por `revalidatePath` em massa.
- Não prometer % de ganho ao time.

---

## 9. Conclusão

O melhor caminho é **método antes de pressa**. A auditoria independente está certa: diagnóstico ainda tem lacunas (interpretação de métricas, origem exata do custo, se os erros ativos inflam a latência), e o plano deve ser calibrado por medição real, não por narrativa de urgência.

O `work_mem` aplicado hoje foi uma intervenção aceitável — mas dependente de **monitoramento**, não de "problema resolvido". Se nas próximas 48-72h não houver queda material na taxa de temp files, revertemos e repensamos.

A urgência da a produtora se resolve **tratando os erros P0 primeiro** (JSON inválido, timeout, permission denied), que podem estar inflando a percepção de "sistema caindo", e só depois atacando as otimizações de código. Otimizar uma rota que está retornando erro 500 é otimizar o caminho errado.

**Autorização pendente:** execução da Fase 0 (somente leitura + correção de erros ativos). Nenhuma intervenção estrutural ou aumento de gasto está autorizado até evidência completar.
