# Férias de ponta a ponta + folha prevista no fluxo de caixa (2026-10-27)

> Férias saiu do estado "quase pronto, mas abono combinado era placeholder e clt_recibo pagava a mais" e virou subsistema fechado: três tipos reais (usufruto, abono avulso, abono combinado), base de cálculo correta pra cada tipo de contratação, e colaborador PJ híbrido deixando de ser pago em cima do salário cheio. Paralelo: folha mensal aprovada agora empurra sozinha a próxima competência e a folha ainda não aprovada passa a aparecer no fluxo de caixa como previsão — o financeiro para de descobrir no dia 25 que falta registrar a folha do mês.

## O que muda pro negócio

- **Férias**: colaborador PJ híbrido (`clt_recibo`) deixa de ser pago sobre o salário cheio — o sistema paga só a parte RPA, a parte CLT fica com a contabilidade. Abono combinado deixou de ser "um botão que não fazia o que prometia" e virou cálculo real (dias de folga + dias de abono, cada um com valor próprio e 1/3 só sobre o usufruto).
- **Solicitação de férias**: o colaborador agora solicita pelo /perfil num modal centralizado (não é mais drawer) com os três tipos lado a lado, saldo visível e data fim calculada; o RH usa a MESMA tela pra lançar direto (modo=rh). Uma UI, dois contextos.
- **Folha mensal**: ao aprovar a folha do mês, o sistema (1) grava a data de previsão de pagamento, (2) empurra a folha ainda não aprovada pro fluxo de caixa como linha prevista, (3) cria a folha do mês seguinte vazia. O financeiro deixa de precisar "lembrar" de abrir a próxima folha.
- **Freelancers**: GP/produtor passa a ler os freelas dos quais é responsável — antes RLS filtrava por tenant só, agora inclui `responsavel_id`.

## Estado atual (o que existe agora)

- **Férias — três tipos reais**: usufruto / abono avulso / abono combinado. A coluna `dias_abono` entrou em `colaboradores_ferias_lancamentos` com check constraint (combinado exige `dias_abono > 0` e menor que `dias`; outros exigem `dias_abono = 0`). `calcularValoresLancamento` recebe `diasAbono` e distribui o cálculo: `valor_ferias = diário × diasFolga`, `valor_abono = diário × diasAbono`, `valor_um_terco = valor_ferias / 3` (abono pecuniário não gera 1/3). Função reusada em simulação (modal), aprovação (preview) e gravação final.
- **Férias — base por tipo de contratação**: `calcularValoresLancamentoAuto` + `buscarSalarioParaFolha` escolhem a base automaticamente. `clt_recibo` → usa `parteRpa` (valor_recibo). Outros → `valorTotal`. A parte CLT do híbrido fica fora do sistema (contabilidade pagada no holerite).
- **Férias — UI compartilhada**: `app/(app)/_components/solicitar-ferias-form.tsx` é o componente único usado pelo colaborador (/perfil) e pelo RH (/rh/ferias → lançar direto). Prop `modo` controla copy/validação. Modal centralizado (não é drawer).
- **Férias — aprovação com preview**: a confirmação de aprovar mostra o cálculo em tempo real (valor férias + 1/3 + abono + total), usando a mesma função do backend. Ação "Mover para análise" foi removida — fluxo direto solicitado → aprovado (ou devolvido).
- **Férias — card no /perfil**: "Minhas férias" lista as próprias solicitações do colaborador (não só o saldo do período ativo).
- **Folha — previsão no fluxo de caixa** (decisão 218): a folha ainda não aprovada aparece como `linha_tipo = 'previsto'` em `vw_fluxo_de_caixa_matriz`, com data = `data_prevista_pagamento` da folha. Quando aprova, vira linha real da contas-a-pagar.
- **Folha — mês seguinte automático**: aprovar a folha do mês N dispara INSERT da folha do mês N+1 vazia, pronta pra receber lançamentos. Zero clique.
- **Freelancers**: policy `freelancers_select` ganha `responsavel_id = (select auth.uid())` como alternativa a `is_tenant_member`. GP vê os freelas que lidera. Hero reorganizado + card do contrato mostra responsável + fluxo único de solicitar novo contrato (removido "trocar freela").
- **Solicitações**: busca não envia query string vazia + X do campo deixou de duplicar + modal scrolla pro botão Enviar aparecer no viewport + banner redundante escondido no fluxo pré-travado + filtro de busca passou a bater em texto quando o CPF é vazio.
- **Auditoria**: três migrations antigas de setembro ficaram com autor = Antonio por engano; agora apontam pro usuário do Tiago (quem efetivamente conduziu). Uma conta de login criada no teste de 18/09 (sem vínculo nenhum) foi apagada.
- **Conciliação**: saldos iniciais de BB California e California Santander em 01/10 fixados em R$ 0,00 (decisão 211 A5).

## Decisões que vão importar amanhã

- **Base do clt_recibo é parteRpa, nunca valorTotal.** `calcularValoresLancamentoAuto` já faz isso automaticamente — mas se alguém chamar `calcularValoresLancamento` direto sem passar `salarioBaseOverride` pro híbrido, vai calcular em cima do salário cheio e o pagamento sai dobrado. Guard-rail: a doutrina do módulo é "sempre `Auto` quando tiver `tipo_contratacao` na mão". Documentado no header do arquivo.
- **1/3 sobre abono pecuniário é zero.** CLT: abono não gera 1/3 constitucional. Em `abono_combinado`, `valor_um_terco = valor_ferias / 3`, não `(valor_ferias + valor_abono) / 3`. Se alguém "corrigir" isso achando que é bug, o cálculo quebra o padrão legal.
- **O preview da aprovação chama o MESMO backend.** Modal e server action usam a mesma função pura (`calcularValoresLancamento` com `salarioBaseOverride`). Divergência entre o que a UI mostra e o que grava = bug grave. Nunca duplicar fórmula no cliente.
- **`SolicitarFeriasForm` com prop `modo` é intencional** — não "quebrar em dois" na próxima refactor. Copy, validação e lista de tipos divergem o suficiente pra justificar o switch mas pouco o suficiente pra não valer duas telas.
- **Modal substituiu Drawer no /perfil pra solicitar férias** porque drawer baixo cortava o PopoverContent do DatePicker. Padrão novo: formulário curto com DatePicker → modal centrado, não drawer lateral. Já previsto no CLAUDE.md como armadilha Radix.
- **Folha prevista no fluxo de caixa é view, não gravação** — nada é persistido antes da aprovação. Isso quer dizer que remover a `data_prevista_pagamento` da folha ou cancelar a folha remove automaticamente a linha de previsão. Não precisa limpar coisa nenhuma.
- **Rescisões ficou alinhada mas não implementada.** A conversa cobriu toda a arquitetura (migration + enum folha_tipo com `rescisao` + tabela `rescisoes` + função `fn_calcular_rescisao` + 2 folhas pra CLT/3 pra clt_recibo). Nada foi codado — a próxima sessão começa pela migration. Spec na seção "O que fica pra próxima sessão".
- **PII**: nenhuma migration dessa sessão lida com dado pessoal real. O hook de pre-commit rodou limpo nas 7 migrations.

## O que fica pra próxima sessão

- **Objetivo**: **Gestão de Rescisões** — redesenhar `/rh/rescisoes` seguindo o padrão da aba Pagamentos de férias. Hoje a tela lista colaboradores inativos nos últimos 90 dias e manda a RH criar manual em Contas a Pagar — "totalmente inútil" nas palavras do usuário.

- **Por onde começar**: migration. Replicando o padrão de férias:
  1. `alter type folha_tipo add value 'rescisao'`.
  2. `alter table folhas_pagamento add column subtipo text` (`null` | `'trct'` | `'fgts_rescisorio'`).
  3. `alter table folhas_pagamento add column anexos jsonb not null default '[]'` (array tipado: `{tipo, url, uploaded_at, uploaded_by}`).
  4. Tabela `rescisoes` (colaborador, data_demissao, tipo_rescisao, verbas detalhadas: saldo_salario, folgas_pendentes, ferias_meses+valor, 1/3, 13o_meses+valor, descontos jsonb, total_a_pagar).
  5. Função SQL `fn_calcular_rescisao(colaborador_id, data_demissao)` retorna JSON com todas as verbas. Regra dos 15 dias pra avos (13º e férias proporcionais). Férias combina avos do aquisitivo em curso + dias pendentes de aquisitivos anteriores (/30).

- **Arquitetura das folhas por tipo de vínculo** (já alinhada):

  | Tipo | Folhas geradas |
  |---|---|
  | PJ puro | 1 folha (calculada, paga ao colaborador) |
  | CLT puro | 2 folhas: 1 TRCT (RH anexa PDF do TRCT, paga ao colaborador) + 1 FGTS (RH anexa guia GFD, paga à CAIXA) |
  | CLT recibo (híbrido) | 3 folhas: 1 PJ sobre valor_recibo + 1 TRCT + 1 FGTS |
  | Estagiário | 1 folha (sem FGTS) |

- **Parser do TRCT**: formato padrão governamental (Instrução Normativa SRT 15/2010) com rubricas numeradas — 50 (saldo salário), 63 (13º prop), 65 (férias prop), 68 (1/3), 69 (aviso prévio), 70 (13º AP), 71 (férias AP), 106 (VT), 112.1/112.2 (INSS), 115.x (outros). V1 pode entregar extração automática do líquido/bruto/deduções com confirmação visual pro RH antes de salvar. Fallback manual se parser falhar.

- **O que já está pronto pra suportar**:
  - `folhas_pagamento` com `tipo` enum, `anexo_url`, `data_prevista_pagamento`, origem (`california`/`contabilidade`).
  - `calcularValoresLancamentoAuto` + `buscarSalarioParaFolha` dividem salário em `parteRpa`/`parteClt` pro clt_recibo — reusar na rescisão.
  - `fn_calcular_vencimento_ferias` já funciona pra calcular data de vencimento (2 dias antes, exceto sáb/dom) — generalizar pra qualquer folha.
  - Bucket `recibos` existe e tem policies pra RH anexar PDF.

## Rastros técnicos

Migrations aplicadas nesta sessão:

```
20261026700005_folha_tipo_ferias_coluna.sql
20261026700006_vw_people_tipo_folha_ferias.sql
20261026700007_ferias_policy_so_aprovado.sql
20261027100001_saldo_inicial_da_california_santander_em_01_10.sql
20261027100002_folha_prevista_no_fluxo_de_caixa.sql
20261027100003_folha_do_mes_seguinte_nasce_sozinha.sql
20261027100004_autor_das_auditorias_de_migration.sql
20261027100005_apaga_conta_sem_vinculo_criada_por_teste.sql
20261027700003_ferias_lancamentos_dias_abono.sql
20261027700004_ferias_lancamentos_dias_total_combinado.sql
20261027900001_freelancers_rls_gp_responsavel_le.sql
```

ADR relacionada: `docs/decisions/218-folha-prevista-no-fluxo-de-caixa.md`.

Commits relevantes (ordem cronológica desta sessão, mais antigo primeiro):

- `34353c56` — fix(conciliacao): saldos iniciais BB/Santander em 01/10 (dec 211 A5)
- `8f182b7f` — feat(ferias): coluna tipo_folha_ferias + criar 2 folhas no abono combinado
- `67da2dbe` — fix(people): aba habilita CLT/13 + drawer pula soma pra ferias + policy ferias
- `15e4684c` — feat(fluxo): folha ainda não aprovada entra no fluxo de caixa como previsão (dec 218)
- `d10d80e2` — feat(folha): aprovação grava data da previsão e folha do mês seguinte nasce sozinha
- `9e0bdefc` — docs: spec e plan do modal solicitar ferias + abono combinado
- `07db9751` — feat(ferias): coluna dias_abono + check constraint pra abono_combinado
- `b9043e90` — feat(ferias): calcular-valores suporta diasAbono em abono_combinado
- `9d737a58` — feat(perfil): solicitarFerias aceita abono_combinado real com dias_abono
- `f586bc1b` — feat(rh/ferias): lancarDiretoPeloRh aceita abono_combinado + aprovar passa dias_abono
- `f0ccf1c0` — feat(ferias): componente shared SolicitarFeriasForm com 3 cards de tipo
- `25b83d80` — feat(perfil): modal centralizado substitui drawer de solicitar ferias
- `99b46335` — feat(rh/ferias): lancar-direto reusa SolicitarFeriasForm com modo=rh
- `7ee371b2` — fix(ferias): reconcilia periodoId quando lista muda + limpa imports stale
- `949a0342` — fix(solicitacoes): busca sem query string e sem X duplicado
- `ce32accd` — fix(auditoria): autor de três auditorias de migration passa a ser Tiago
- `f63b6874` — fix(auth): apaga conta de login criada por engano num teste de 18/09
- `4c8f4d0f` — fix(solicitacoes): filtro de busca ignorava texto por match vazio no CPF
- `dceb9352` — feat(freelancers): fluxo unico de solicitar novo contrato e responsavel no card
- `a9fadea9` — novo contrato de solicitação - tirar trocar freela
- `fabd8d66` — feat(freelancers): GP/produtor le freelas dos quais e responsavel
- `a4752330` — fix(solicitacoes): modal scrolla internamente pro botao Enviar ficar visivel
- `8323d7b1` — fix(solicitacoes): esconde banner redundante no fluxo pre-travado
- `47ca447d` — feat(ferias): modal mais compacto + saldo visivel + data fim calculada
- `6a0965e0` — feat(perfil): card Minhas ferias mostra solicitacoes do colaborador
- `ef9277d2` — feat(ferias): remove 'Mover para analise' do fluxo de aprovacao
- `bd726ae0` — feat(rh/ferias): confirmacao de aprovar mostra calculo dos valores
- `82545e2e` — fix+ux(rh/ferias): clt_recibo usa parteRpa + hero de pendentes + label Hibrido
