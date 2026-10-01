# 27 — Plano de Execução do Subsistema Férias

> Como o subsistema vai sair do papel. Fatiamento em sessões, dependências, critérios de "pronto" e riscos conhecidos. Precede a abertura da primeira migration.
>
> Base: [`25-ferias.md`](25-ferias.md) (spec) + [`26-ferias-modelo-de-dados.md`](26-ferias-modelo-de-dados.md) (banco).

## 1. Filosofia

- **1 sessão = 1 commit no mínimo, 1 PR no máximo.** Cada sessão deve ir ao `main` ao final do dia.
- **Backend antes de UI.** O banco com triggers e policies dá o chão pra UI confiar. Nenhuma UI é construída sem a camada de dados pronta e verificada via MCP.
- **UI em camadas de valor crescente.** Primeiro o colaborador vê o próprio saldo (valor imediato), depois solicita, depois o RH aprova, depois gera recibo, depois rescisão. Cada camada dá valor sozinha.
- **Testes manuais com `antonio@pevetech.com.br` + 1 colaborador real** antes de cada merge. Build + typecheck limpos não garantem que o campo chega à tela (CLAUDE.md).
- **Nenhuma sessão termina com dívida de spec.** Mudança de regra descoberta durante a implementação volta pra [`25-ferias.md`](25-ferias.md) no mesmo commit.

## 2. Visão macro: 8 sessões

```
S1 ─ Banco: fundação (role + enums + periodos + trigger)
S2 ─ Banco: lançamentos + notificações + funções
      ↓
S3 ─ UI: /perfil + role colaborador + card "Minhas férias" (read-only)
      ↓
S4 ─ UI: /perfil form de solicitação (write do colaborador)
      ↓
S5 ─ UI: /rh/ferias — Painel + Solicitações (aprovar/reprovar)
      ↓
S6 ─ UI: /rh/ferias — Quadro + Calendário
      ↓
S7 ─ Backend: cálculo PJ + gerador de PDF (3 modelos)
      ↓
S8 ─ UI + Backend: /rh/ferias — Rescisões + cron automático + import histórico
```

Estimativa total: **8 sessões** de 4-6h cada. Dependências lineares — não dá pra paralelizar sem retrabalho. Pode compactar S3+S4 ou S5+S6 se o dia render.

## 3. Sessão a sessão

### S1 — Fundação do banco (role + períodos aquisitivos)

**Objetivo**: colocar role `colaborador` no enum, criar a tabela de períodos, trigger de geração automática e backfill dos 209 ativos.

**Entregáveis**:
1. Migration `20261002XXXXXX_ferias_fundacao.sql`:
   - `alter type app_role add value 'colaborador'`
   - Helper `is_colaborador_proprio(uuid)`
   - 4 enums (`ferias_periodo_status`, `ferias_lancamento_tipo`, `ferias_lancamento_status`, `ferias_notificacao_tipo`)
   - Tabela `colaboradores_ferias_periodos` + policies + GRANTs + índices
   - Função `fn_gerar_ferias_periodos` + trigger em `colaboradores`
2. Migration `20261002XXXXXX_ferias_backfill_periodos.sql`:
   - `UPDATE colaboradores SET data_admissao = data_admissao WHERE data_admissao IS NOT NULL AND status = 'ativo';` → dispara trigger pros 209 ativos
   - Query de verificação: `SELECT colaborador_id, count(*) FROM colaboradores_ferias_periodos GROUP BY 1 HAVING count(*) < 5` → vazio.
3. Atualização de `lib/types.ts` com os 4 enums novos como union types.

**Verificação pós (via MCP)**:
- `select count(*) from colaboradores_ferias_periodos` → 5 × 209 = 1045.
- `select status, count(*) from colaboradores_ferias_periodos group by 1` → distribuição razoável (muitos "apto" + alguns "incompleto").
- Policies ativas via `pg_policies`.
- GRANT via `information_schema.role_table_grants`.

**Pronto quando**:
- MCP confirma 1045 períodos criados.
- Advisors do Supabase sem alertas vermelhos.
- Nenhum colaborador ativo ficou sem período.

**Riscos**:
- Trigger pode ser lento com 209 colaboradores de uma vez. Monitorar.
- Se algum colaborador ativo tem `data_admissao = null`, não vai gerar período. Precisa decidir: aborta o backfill ou pula? **Decisão**: pula com warning no console da migration.

**Fora do escopo desta sessão**: UI, lançamentos, notificações.

---

### S2 — Lançamentos + notificações + funções de cálculo

**Objetivo**: completar a camada de dados. Depois dessa sessão, qualquer UI pode escrever.

**Entregáveis**:
1. Migration `20261003XXXXXX_ferias_lancamentos.sql`:
   - Tabela `colaboradores_ferias_lancamentos` + policies (4: RH all, colab read, colab insert, colab cancel) + GRANTs + índices
   - Funções `fn_set_updated_at`, `fn_valida_saldo_periodo`, `fn_recalcular_status_periodo`
   - Triggers de updated_at + validação de saldo
2. Migration `20261003XXXXXX_ferias_notificacoes.sql`:
   - Tabela `colaboradores_ferias_notificacoes` + policies + GRANTs + índices
   - Função helper `fn_criar_notificacao_ferias`
   - Função `fn_calcular_meses_rescisao` (regra dos avós)
3. Atualização de `lib/types.ts` com os tipos TS das novas tabelas.

**Verificação pós (via MCP)**:
- Insert manual de um lançamento-teste no colaborador do antonio → trigger de validação roda, status atualiza.
- Chamar `fn_calcular_meses_rescisao` com um colaborador real → bate com cálculo manual.
- Policy do colaborador: criar um lançamento via SELECT com JWT do antonio como colaborador → só aparece o próprio.

**Pronto quando**:
- Insert válido passa; insert com dias > saldo é bloqueado pela trigger.
- `fn_calcular_meses_rescisao` para a Rafaela (admissão 2024-11-01, demissão 2026-09-30) retorna **23 meses** (12 vencidos + 11 proporcionais; setembro conta porque trabalhou 30 dias) — se a planilha diz 21, documentar a divergência pra discutir com RH.
- Advisors Supabase limpos.

**Riscos**:
- A divergência da Rafaela (23 vs 21 da planilha) pode significar que o RH considera o aquisitivo em curso diferente. Caso seja divergência real, **para a sessão e volta pra spec** antes de continuar.

**Fora do escopo**: cron jobs (ficam pra S8), import histórico.

---

### S3 — Role colaborador + `/perfil` com saldo (read-only)

**Objetivo**: dar ao colaborador acesso ao próprio perfil com visão clara das férias. Nada de solicitação ainda.

**Entregáveis**:
1. Rota `/perfil` acessível a toda role autenticada (não só colaborador).
2. **Guard de layout**: se `activeRole === 'colaborador'`, esconde sidebar/footer de app, mostra só o conteúdo de `/perfil`. Rotas protegidas redirecionam pra `/perfil`.
3. Card "Dados pessoais" (header com foto, nome, função, tipo contratação, admissão).
4. Card "Dados bancários" (reusa componente já existente).
5. Card "**Minhas férias**":
   - Hero: saldo total + status atual (badge) + próximo vencimento com dias restantes.
   - Lista dos períodos aquisitivos em timeline vertical (barra de progresso dias usufruídos/dias_direito, status, data-limite).
   - Lista de histórico de lançamentos passados (data, dias, tipo, status).
   - **Sem botão "Solicitar" ainda** — vem em S4.
6. Mudança no fluxo de **convite ao efetivar contratação**: ao criar o `tenant_members`, papel inicial = `colaborador` (hoje é `membro` genérico).
7. Atualização da sidebar/header para destacar "/perfil" como alvo do ícone do usuário no footer.

**Verificação manual**:
- Criar user de teste, atribuir role `colaborador`, logar → vê apenas `/perfil`, sem sidebar.
- Tentar acessar `/rh/colaboradores` como `colaborador` → redireciona.
- Logado como `antonio` (admin), ícone do footer leva a `/perfil` com sidebar normal.
- Card "Minhas férias" mostra dados reais do próprio colaborador.

**Pronto quando**:
- Autoserviço read funciona pra 3+ colaboradores testados.
- Role `colaborador` isolada visualmente e por policy.

**Riscos**:
- Convite PR altera fluxo de efetivação já em uso. Fazer com flag opcional (`?role=colaborador`) no primeiro deploy pra não quebrar efetivações em andamento.

---

### S4 — Solicitação de férias pelo colaborador

**Objetivo**: fechar o loop de autoserviço. Colaborador pede, RH recebe.

**Entregáveis**:
1. Botão "Solicitar férias" no card de `/perfil`, só habilitado se há período `apto` com saldo > 0.
2. Drawer de solicitação:
   - Select de período aquisitivo (default: mais antigo com saldo).
   - DatePicker de início + fim (ou dias — qual é melhor UX?).
   - Select de tipo: `usufruto` / `abono_avulso` (só PJ) / `misto`.
   - Observação opcional.
   - Validações client: data início ≥ hoje + 5 dias, dias ≤ saldo do período, data fim > data início.
3. Server action `solicitarFerias`:
   - `requireSession`
   - Zod parse
   - Validações de servidor (reaplica tudo + checa saldo no banco)
   - Insert em `colaboradores_ferias_lancamentos` com `status = 'pendente_aprovacao'`
   - Insert em `colaboradores_ferias_notificacoes` pros destinatários: RH do tenant + líder direto (se houver)
   - Audit event
   - `revalidatePath('/perfil')`
4. Cancelamento pela própria tela (botão em lançamentos com status pendente ou aprovado-futuro).

**Verificação manual**:
- Colaborador com saldo cria solicitação → aparece no banco com status pendente.
- Solicitação com dia-1 vira erro visível (validação).
- Notificação chega pros RH (ainda não há UI de leitura, verificar via SQL).

**Pronto quando**:
- Daniel/Antonio consegue solicitar como colaborador-teste; notificação cai pro `antonio` admin.

**Riscos**:
- UX do form: data vs dias. **Decisão**: ir com datas (início/fim), mostrar dias calculados abaixo. Mais natural pro usuário.

---

### S5 — `/rh/ferias` com Painel + Solicitações

**Objetivo**: RH começa a usar. KPIs no topo, fila de solicitações pra agir.

**Entregáveis**:
1. Rota `/rh/ferias` (protegida: admin + rh).
2. Header com 4 KPIs clicáveis (aguardando / em alerta / vencidas / em férias hoje). KPIs usam queries agregadas no server component.
3. **Tab Painel** (default):
   - Resumo de 3-4 solicitações mais recentes.
   - "Retornando esta semana" (query de lançamentos aprovados com `data_fim between today and today+7`).
   - "Concessivo vencendo" top 5 (query ordenada por `concessivo_fim`).
   - Mini-stats visuais.
4. **Tab Solicitações**:
   - Fila de todos os lançamentos com status filtrado (default: `pendente_aprovacao`).
   - Filtros: status, tipo, empresa, regional, busca por colaborador.
   - Ações inline: Aprovar / Reprovar (motivo obrigatório via dialog) / Em análise.
5. Server actions `aprovarLancamento`, `reprovarLancamento`, `moverParaAnalise`:
   - Update status.
   - Cria notificação pro colaborador (aprovada/reprovada/em_analise).
   - Audit event.
   - Se aprovado + tipo = usufruto/abono_combinado/abono_avulso: zera recibo URL (vai gerar em S7).
6. Painel de notificações do RH embutido no header (ícone com badge, dropdown com últimas 10).

**Verificação manual**:
- Antonio aprova solicitação feita em S4 → colaborador recebe notificação, status muda.
- Reprovação exige motivo.
- KPIs refletem estado real.

**Pronto quando**:
- Fluxo colaborador-solicita → RH-aprova fecha ponta a ponta.
- Antonio consegue limpar a fila sem SQL.

**Riscos**:
- Performance dos KPIs com 1045+ períodos: fazer 1 query agregada por KPI, não embeds. Checklist de PERFORMANCE.md.

---

### S6 — `/rh/ferias` com Quadro + Calendário

**Objetivo**: substituir a visão panorâmica da planilha. Agora o RH pode largar a planilha.

**Entregáveis**:
1. **Tab Quadro**:
   - Lista densa: nome, tipo, status (badge), saldo, próximo vencimento, última atualização.
   - Filtros globais (empresa, regional, tipo, status, busca).
   - Linha inteira clicável → abre drawer lateral.
   - Drawer: timeline dos 5 períodos aquisitivos com barra de progresso, histórico de lançamentos, ações rápidas ("Lançar direto", "Ver recibos", "Calcular rescisão" — este abre S7).
2. **Tab Calendário**:
   - Visualização mês atual (default) com cada colaborador que tem lançamento aprovado como barra colorida no período.
   - Navegação por mês + botão "ano inteiro".
   - Click numa barra → mostra detalhe do lançamento.
   - Filtros reaproveitam da Tab Quadro.
3. **Lançar direto pelo RH** (dentro do drawer):
   - Mesmo form da solicitação mas com todos os tipos + flag `lancado_direto_por_rh = true` + status direto em `aprovado`.
4. Painel de notificações do subsistema (`/rh/ferias?tab=notificacoes`):
   - Lista completa com filtros por tipo + status (lida/não lida).
   - Marcar como lida.

**Verificação manual**:
- Antonio vê quadro completo de 209 colaboradores com filtros + ordenação.
- Calendário mostra as férias aprovadas de outubro corretamente.
- Lançamento direto cria registro aprovado + notificação pro colaborador.

**Pronto quando**:
- A planilha pode ser arquivada (opcional — o Kika/Mari/Maria decidem).

**Riscos**:
- Calendário é componente visual novo. Avaliar: shadcn/ui não tem timeline. **Decisão**: construir grid simples (dias × colaboradores filtrados) com Tailwind, sem lib externa. Se virar complexo, considerar `@fullcalendar/react`.

---

### S7 — Cálculo PJ + gerador de recibo PDF

**Objetivo**: valor automático pra PJ. Fim da conta manual.

**Entregáveis**:
1. Função de cálculo (TS, server-side):
   - `calcularValoresLancamento(colaboradorId, periodoId, tipo, dias)` → retorna { valor_base, valor_ferias, valor_um_terco, valor_abono, valor_total }
   - Puxa salário vigente do colaborador.
   - Aplica fórmulas da §4.6 da spec.
2. Trigger automática na aprovação (S5 → agora completa): ao aprovar lançamento de PJ, chama `calcularValoresLancamento` e grava os valores no `colaboradores_ferias_lancamentos`.
3. Gerador de PDF com `pdfmake` (lib já em uso no projeto, Task 010):
   - Template "Só férias" (fiel ao `_MODELO FÉRIAS.pdf`).
   - Template "Só abono" (fiel ao `MODELO ABONO.pdf`).
   - Template "Combinado" (duas seções no mesmo PDF).
   - Logo California no header.
   - Dados fixos empresa (CALIFORNIA FILMES E PUBLICIDADE LTDA + CNPJ).
4. Server action `gerarRecibo(lancamentoId)`:
   - Monta documento PDF.
   - Upload direto pro Supabase Storage (bucket `recibos-ferias`).
   - Grava `recibo_url` e `recibo_gerado_em` no lançamento.
   - Audit event.
5. Botão "Gerar recibo" + "Baixar recibo" no drawer do lançamento (RH) e no `/perfil` do colaborador (próprio).

**Verificação manual**:
- Gerar recibo pra 3 PJs reais em cada formato.
- Comparar visual com os PDFs modelo.
- Colaborador baixa o próprio recibo.

**Pronto quando**:
- 3 templates idênticos aos modelos.
- Colaborador PJ baixa recibo em 1 clique.

**Riscos**:
- Bucket Storage novo: criar via migration, policies RLS (`recibos-ferias/<colaborador_id>/<lancamento_id>.pdf` com policy que colaborador só lê os próprios).
- Modelo "combinado" ainda pendente de confirmação com RH (§12 D1-parcial). Assumir montagem simples das duas seções; se RH quiser diferente, ajusta.

---

### S8 — Rescisão + cron + import histórico

**Objetivo**: fechar o módulo. Rescisão automática, alertas automáticos, histórico migrado.

**Entregáveis**:
1. **Tab Rescisões** em `/rh/ferias`:
   - Lista de colaboradores com desligamento pendente/recente.
   - Click → tela de cálculo preenchida automaticamente (`fn_calcular_meses_rescisao`).
   - Campos editáveis: observação, descontos manuais (zerados por default por F9).
   - Botão "Gerar título em contas_avulsas" → cria avulsa com motivo "Rescisão - Férias e proporcionais".
   - Se PJ: gera recibo junto.
2. Migration `20261010XXXXXX_ferias_cron.sql`:
   - 6 `pg_cron` jobs listados em §7 do modelo-de-dados.
   - Testar com `select cron.schedule(...)`.
3. Migration de dados `20261010XXXXXX_ferias_import_historico.sql`:
   - Script Node em `tmp/` lê aba "Planejador de Férias" da planilha → gera INSERTs em `colaboradores_ferias_lancamentos` com `status = 'concluido'` e `lancado_direto_por_rh = true`.
   - Dry-run primeiro → aprovação → aplica.
   - Match por nome (padrão já usado nos 2 imports anteriores).
4. **Timezone fix**: ajustar queries de "hoje" nos crons pra `America/Sao_Paulo` (dívida conhecida §10 do modelo).

**Verificação manual**:
- Rescisão da Rafaela bate com a planilha (ou documenta divergência).
- Crons rodam em sandbox com data mockada (ou aguarda 1 dia e verifica).
- Histórico importado aparece corretamente no `/perfil` dos colaboradores.

**Pronto quando**:
- Rescisão sai do Excel.
- Alertas automáticos geram notificações no dia certo.
- 2024-2026 de histórico está no banco.

**Riscos**:
- Import de histórico pode trombar com constraints (ex.: lançamento com `periodo_id = null` que não é abono_avulso). Script precisa sanitizar.
- Testar cron pode exigir mock de `current_date` ou aguardar passagem de dia. **Mitigação**: criar função helper `fn_rodar_crons_para_data(date)` só pra testes.

## 4. Checkpoints com validação humana

Marcos onde o Daniel/Antonio precisa aprovar antes de seguir:

| Checkpoint | Após sessão | O que validar |
|---|---|---|
| CP1 — Banco pronto | S2 | Períodos backfillados corretamente. Rescisão da Rafaela faz sentido ou expõe divergência. |
| CP2 — Autoserviço | S4 | Colaborador-teste consegue ver saldo e solicitar sem ajuda. |
| CP3 — RH operacional | S6 | Kika/Mari conseguem usar `/rh/ferias` sem a planilha pelo menos pra operações cotidianas. |
| CP4 — Valor automático | S7 | Recibo PJ gerado é aceito pelo RH como substituto do manual. |
| CP5 — Fim | S8 | Alertas chegam, rescisão sai automática, histórico está lá. |

## 5. Dependências externas

Nada bloqueia o começo. Durante o percurso:

- **S3 depende**: fluxo de convite atual (`efetivarContratacao`) estar bem entendido pra ajustar o papel inicial.
- **S5/S6 depende**: componentes de UI já existentes (Combobox, Drawer, ConfirmDialog) continuarem estáveis.
- **S7 depende**: `pdfmake` já configurado (verificar `next.config.js serverComponentsExternalPackages`).
- **S8 depende**: `pg_cron` extension ativa no projeto. Verificar com `list_extensions` via MCP antes de S8.

## 6. Riscos macro do subsistema

1. **Regra de rescisão divergente da planilha**. Mitigação: validar na S2 antes de construir a UI em cima. Se diverge, para e alinha com RH.
2. **Convite + role colaborador quebrar efetivações em andamento**. Mitigação: feature flag ou rollback plan documentado.
3. **Performance do painel RH com 209 colaboradores + 1045 períodos**. Mitigação: `docs/PERFORMANCE.md` como checklist em S5/S6; queries agregadas, não embeds.
4. **Modelos de recibo variarem por empresa**. Mitigação: perguntar ao RH antes de S7 (pendência D1 ainda aberta).
5. **Timezone de cron**. Mitigação: dívida reconhecida na §10 do modelo-de-dados, resolver em S8 explicitamente.

## 7. Fora do escopo deste plano

Fica pra depois do MVP:

- Férias coletivas.
- Notificação por e-mail.
- Fluxo de "primeiro acesso" com termo.
- Integração com benefícios (TotalPass, saúde) na rescisão — vira trabalho do subsistema Benefícios.
- Encargos CLT automáticos.
- Holerite PDF.

## 8. Métricas de sucesso

Depois de S8 em produção, considerar o módulo bem-sucedido se:

- Kika/Mari/Maria param de abrir a planilha pra operação cotidiana.
- Pelo menos 50% das solicitações entram via `/perfil` (vs lançamento direto do RH).
- Nenhum concessivo vence sem alerta prévio.
- Rescisões saem do Excel.
- Antonio (admin) nunca precisa rodar SQL pra consertar estado inconsistente.

## 9. Próximo passo imediato

**Começar S1** quando você der o ok. Primeiro item concreto: escrever a migration `ferias_fundacao.sql` seguindo o §8 do [`26-ferias-modelo-de-dados.md`](26-ferias-modelo-de-dados.md).

Antes de abrir a migration, só uma coisa a confirmar com você: **nome do bucket Storage pra recibos**. Sugestão: `recibos-ferias`. Ok?
