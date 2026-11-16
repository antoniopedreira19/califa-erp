# Vínculos de Colaborador — Plano de execução

> Companion de [70-vinculos-colaborador.md](70-vinculos-colaborador.md) e [71-vinculos-colaborador-modelo-de-dados.md](71-vinculos-colaborador-modelo-de-dados.md).
>
> Fase 1 dividida em 4 sessões curtas. Ao final, os 5 casos de virada ficam regularizados e a fundação pronta pra Fase 2 (UI).

## Fase 1 — Fundação + 5 casos (sessões S1 a S4)

### S1 — Fundação: tabela + enum + triggers básicos

**Entregável**: migration `20261116100001_vinculos_colaborador_fundacao.sql` aplicada em prod. Tabela `colaborador_vinculos` existe, vazia, com policies/grants/constraints no lugar. Zero impacto comportamental.

**Passos:**
1. Escrever a migration conforme §4.1 do modelo de dados.
2. Aplicar em Sandbox via `mcp__supabase-write__apply_migration`.
3. Rodar query de verificação (listar tabela, enums, policies, indexes criados).
4. Aplicar em prod.
5. Adicionar `ColaboradorVinculo` e `VinculoMotivoEncerramento` em `lib/types.ts`.
6. Adicionar 3 novos valores em `AuditAction` (lib/auth/audit.ts).
7. Commit.

**Checkpoint CP1 — validação com RH**: nada a validar, é fundação invisível. Seguir direto.

**Risco**: baixíssimo. Aditivo puro.

### S2 — Backfill de vínculos ativos

**Entregável**: migration `20261116100002_vinculos_backfill_ativos.sql` aplicada. Todo colaborador ativo do Califa tem 1 vínculo ativo. Ainda nada regenerado em férias.

**Passos:**
1. Escrever migration com guarda de tenant + backup (`_backup_20261116_califa_colaboradores_pre_vinculos`).
2. Insert por SELECT em cima de `colaboradores` ativos.
3. Verificar contagem: `select count(*) from colaborador_vinculos where tenant_id = califa` deve bater com total de ativos (~200 incluindo sócios? ou 197 excluindo?).
4. Confirmar `uniq_colab_vinculo_ativo` não viola nada (1 vínculo por pessoa).
5. Commit.

**Checkpoint CP2 — validação técnica**: backup criado, contagem bate. Sem impacto na UI ainda (trigger de férias ainda não lê do vínculo).

**Risco**: baixo. 1 INSERT em massa, sem DELETE.

### S3 — Trigger de férias usando vínculo

**Entregável**: migration `20261116100003_vinculos_ferias_trigger.sql`. Trigger `fn_gerar_ferias_periodos` usa `fn_data_base_ferias`. Trigger de sincronização colab ↔ vínculo criada.

**Passos:**
1. Escrever `fn_data_base_ferias` (função helper).
2. CREATE OR REPLACE da `fn_gerar_ferias_periodos` trocando `NEW.data_admissao` pela helper.
3. Ajustar lógica interna: aquisitivos pré-data_base viram `pago_rescisao` em vez de deletar.
4. Criar `fn_colab_sincroniza_tipo_do_vinculo_ativo` + trigger.
5. Criar `fn_vinculo_regenera_ferias` + trigger.
6. Aplicar em Sandbox.
7. **Teste crítico no Sandbox**: regenerar aquisitivos de 3 colaboradores escolhidos aleatoriamente, verificar que nada mudou (tipos, datas, status iguais ao antes da trigger).
8. Aplicar em prod.
9. Commit.

**Checkpoint CP3 — validação técnica crítica**: tocar updated_at de `colaboradores` no Sandbox e garantir que todos aquisitivos continuam iguais ao snapshot anterior. Se mudou algo, ROLLBACK e investigar.

**Risco**: **médio-alto**. Trigger central do subsistema de férias. Quebrou → impacta todo cálculo de aquisitivos.

### S4 — 5 casos de virada

**Entregável**: migration `20261116100004_vinculos_viradas_5_casos.sql`. Os 5 colaboradores têm 2 vínculos cada (antigo encerrado + novo ativo). Aquisitivos antigos CLT viraram `pago_rescisao`. Novos aquisitivos PJ começam da data da virada.

**Pré-requisitos**:
- Lista final dos 5 casos confirmada com RH, com datas exatas (P1 e P2 da spec). Nomes e datas ficam no handoff da sessão, não no repo (PII).
- 5º caso identificado (o nome originalmente mencionado na ata foi descartado).

**Passos:**
1. Escrever migration com guarda de tenant + backup de `colaboradores_ferias_periodos` + `colaboradores_ferias_lancamentos`.
2. Pra cada um dos 5:
   - UPDATE no vínculo ativo atual (encerrar com `data_fim = virada - 1` + `motivo_encerramento = rescisao_clt_para_novo_vinculo`).
   - INSERT do novo vínculo (tipo_contratacao novo, data_inicio = virada, vinculo_anterior_id apontando pro antigo).
3. Trigger dispara, regenera aquisitivos pros 5.
4. Verificar no Sandbox pessoa-por-pessoa que:
   - Aquisitivos pré-virada estão em `pago_rescisao`.
   - Aquisitivos pós-virada existem com datas corretas.
   - Lançamentos antigos (CLT) preservados com `periodo_id` ainda válido.
5. Aplicar em prod.
6. Validar na tela `/rh/ferias/[id]` dos 5 que o Card de solicitação atual e o "Períodos disponíveis" refletem o novo cenário.
7. Commit.

**Checkpoint CP4 — validação humana**: mostrar os 5 cards do colaborador em `/rh/ferias/[id]` pro RH confirmar que as datas batem com o acordo rescisório real.

**Risco**: alto pros 5 registros alterados, baixo pros outros. Backup protege rollback.

## Fase 2 — UI de gestão (planejamento, não executado nesta fase)

### S5 — Card de histórico de vínculos

Visualização read-only em `/rh/colaboradores/[id]` e `/rh/ferias/[id]`:
- Lista cronológica dos vínculos (ativo + encerrados).
- Mostra tipo, período, motivo de encerramento, "veio de" (vinculo_anterior).
- Sem actions.

### S6 — Action "Encerrar vínculo e criar novo"

Dialog com form:
- Data da mudança.
- Novo tipo_contratacao.
- Motivo do encerramento do anterior.
- Observação.

Server action:
- Encerra vínculo ativo (`data_fim = mudança - 1`).
- Cria vínculo novo (`data_inicio = mudança`, `vinculo_anterior_id` apontando).
- Audit.

### S7 — Action "Reingresso"

Pra colaborador que tem `status = 'inativo'` + já teve vínculo:
- Reativa o colaborador.
- Cria vínculo novo (sem `vinculo_anterior_id` ou com, dependendo do caso).

Opcional — pode ir pra Fase 2.5 se raridade.

## Fase 3 — Migração das queries (planejamento, não executado)

### S8 — Mapeamento

Varrer `grep -r "tipo_contratacao" app/ lib/` e listar todas as queries que leem `colaboradores.tipo_contratacao`. Classificar por criticidade.

### S9 — Criar view `vw_colaboradores_com_vinculo_ativo`

View que junta `colaboradores` com o vínculo ativo, expondo `tipo_contratacao_vinculo`. Queries podem migrar gradualmente pra consumir essa view.

### S10 — Migrar queries por domínio

Em sessões separadas por domínio:
- S10.1: Férias (já usa indireto via trigger — só auditar)
- S10.2: Folha mensal
- S10.3: Benefícios
- S10.4: Décimo terceiro
- S10.5: DRE + views do financeiro

### S11 — Aposentar `colaboradores.tipo_contratacao`

Depois que todas as queries migraram:
- Remover trigger de sincronização.
- `ALTER TABLE colaboradores DROP COLUMN tipo_contratacao`.
- Migration destrutiva, exige confirmação explícita (regra do CLAUDE.md).

## Checkpoints de validação humana

- **CP1** (fim de S1): nenhuma — fundação invisível.
- **CP2** (fim de S2): técnica — contagem bate.
- **CP3** (fim de S3): técnica crítica — snapshots antes/depois iguais.
- **CP4** (fim de S4): com RH — datas dos 5 casos conferem com o real.
- **CP5** (fim de Fase 2): com RH — RH consegue encerrar/criar vínculo sozinho pela UI.
- **CP6** (fim de Fase 3): técnica — sem query remanescente lendo `colaboradores.tipo_contratacao`.

## Riscos consolidados

| Risco | Mitigação |
|---|---|
| Trigger quebra cálculo de férias de todos | S3 tem checkpoint técnico crítico — validar que snapshot pré/pós é idêntico pros 198 colaboradores onde nada deveria mudar. |
| Loop de triggers (vínculo → colab → férias → vínculo?) | Teste no Sandbox. Função `fn_colab_sincroniza_tipo_do_vinculo_ativo` só faz UPDATE se tipo mudou (evita loop). |
| 5º caso errado | Pré-requisito explícito pra S4: confirmação com RH antes de rodar. |
| RH perde histórico porque a UI não mostra vínculos ainda | Fase 2 resolve. Até lá, consulta via SQL ou spec. |
| Query futura esquecer de usar view e ler `c.tipo_contratacao` que já foi aposentada | S11 só roda depois que grep mostrar zero ocorrências. |

## Métricas de sucesso da Fase 1

- Fase 1 aplicada sem rollback em prod.
- Os 5 colaboradores têm vínculos corretos (verificado por SQL + visualização na tela).
- Pros outros ~198 colaboradores, `select count(*) from colaboradores_ferias_periodos where ...` dá o mesmo número antes e depois (nenhum período foi criado/deletado indevidamente).
- Nenhum ticket de bug ligado a férias nos primeiros 7 dias após aplicação.

## Dependências externas

Nenhuma. Toda mudança é interna ao banco + types do TypeScript.

## Timeline estimada (Fase 1)

- S1: ~1h
- S2: ~1h (inclui validação)
- S3: ~2h (inclui teste crítico no Sandbox)
- S4: ~2h (inclui confirmação com RH)

Total: **~6h de trabalho**, 1 dia útil se concentrado. Fases 2 e 3 são escopos separados, não contados aqui.
