# RH: subsistema de férias usável de ponta a ponta (2026-10-02)

> O módulo de Férias saiu do papel e virou operação real. Da fundação (tabelas + enums + policies) ao /rh/ferias com Painel, Quadro e Solicitações, passando pelo /perfil do colaborador e pelo cálculo de rescisão. Também importamos o histórico real da planilha do RH (203 colaboradores, 279 lançamentos consolidados) e eliminamos 90% dos "falsos vencidos" do Quadro. A performance saiu de 15,6s pra 1,5s depois da task 009.

## O que muda pro negócio

- RH **para de digitar na planilha**: solicitação, aprovação, lançamento retroativo e cálculo de rescisão rodam no sistema.
- Colaborador vê saldo e solicita férias no próprio `/perfil` (sem pedir pelo WhatsApp).
- O Quadro mostra a situação real: quem tá apto, em alerta (próximo do limite), vencido. Antes era planilha com 61 colunas que ninguém olhava.
- Rescisão sai calculada em segundos (saldo + proporcional + 1/3), com link pra lançar o título em Contas a Pagar.
- A planilha histórica virou verdade dentro do sistema: cada ativo tem o que já gozou importado como lançamento aprovado consolidado.

## Estado atual (o que existe agora)

- **Fundação do banco** (S1-S2): `colaboradores_ferias_periodos`, `colaboradores_ferias_lancamentos`, enums de status (`apto`, `em_alerta`, `vencido`, `regularizado`, `incompleto`, `nao_habilitado`, `pago_rescisao`), triggers que geram todos os períodos aquisitivos desde admissão até hoje+2 anos.
- **210 colaboradores ativos com períodos gerados**. Sócios **excluídos** do subsistema por migration dedicada (não têm direito a férias; 63 períodos deletados, 3 pessoas).
- **1031 períodos** no banco, distribuição real: 619 incompletos (futuros), 202 regularizados, 103 aptos, 12 em alerta, **20 vencidos** (todos legítimos — pessoas que de fato têm passivo em aberto).
- **Import histórico** (planilha `historico_real_ferias.xlsx`): 203/214 colaboradores da planilha casados com o banco (194 exatos + 9 aproximados: typos "Oliverira", espaços duplos, apelidos como "Deco" e "Kika"). 279 lançamentos consolidados (status `aprovado`, `tipo=usufruto`, `lancado_direto_por_rh=true`). Data fictícia dos lançamentos = `concessivo_inicio + 183 dias` (meio do concessivo, Opção A).
- **11 nomes "ativos" na planilha que não existem no banco** (prováveis desligados que a planilha não atualizou). Lista parkeada em `tmp/hist-sem-match.txt` pra RH revisar.
- **Fluxos ponta a ponta**:
  - Colaborador: `/perfil` → "Solicitar férias" → pendente.
  - RH: `/rh/ferias` tab "Solicitações" → aprova / reprova / move pra análise.
  - RH: lançamento retroativo via modal do colaborador (hero duplo quando há 2 períodos ativos).
  - Rescisão: `/rh/rescisoes` lista desligados dos últimos 90 dias + calcula verbas via `fn_calcular_meses_rescisao`.
- **PDF de recibo PJ** gera 3 modelos (férias+abono / só férias / só abono) com `pdfmake`.
- **Cron de alertas automáticos** criado em S8, **removido em 2026-10-03** junto com o subsistema de notificações (ver handoff do dia 03). A geração de alertas vai renascer no hub central de notificações futuro.
- **Performance** (task 009): o Quadro saiu de **15,6s → 1,5s** (10×) e o modal de detalhe de **16s → 0,9s**. 4 ondas aplicadas:
  - Onda 1: consolida 12 policies RLS duplicadas + indexa 17 FKs.
  - Onda 2: paraleliza queries + `select` específico (deixou de usar `select("*")`).
  - Onda 3: modal via state local no cliente (sem round-trip RSC).
  - Onda 3.5: filtros do Quadro 100% client-side (nav instantânea).
- **UI do /rh/ferias**: tabs `Painel → Quadro → Solicitações` (removida a tab Calendário em 2026-10-02; Rescisões virou rota própria `/rh/rescisoes`). KPIs no Painel (não acima das tabs).

## Decisões que vão importar amanhã

- **"Regra dos avós" aplicada no cálculo de rescisão** (`fn_calcular_meses_rescisao`): 12 avós por período completo + proporcional do atual se o colaborador trabalhou ≥ 15 dias no mês da demissão. É regra California, confirmada com Kika em 2026-09-30. Não é CLT pura.
- **`data_limite_gozo = aquisitivo_fim + 11 meses`** (não `concessivo_fim`). Decisão contábil: o colaborador precisa ter **começado** as férias até essa data, não terminado. Usar `concessivo_fim` dava "em alerta" tarde demais. Confirmada em 2026-10-02 (migration `20261002000008`).
- **Sócios fora do subsistema**: migration `20261002000012` fez `fn_gerar_ferias_periodos` retornar cedo se `tipo_contratacao = 'socio'` e deletou os 63 períodos existentes dos 3 sócios (nenhum tinha lançamento). Decisão: **sócio não é empregado nem prestador, não gera férias**. Se um dia um sócio virar colaborador CLT, abrir caso específico.
- **Import histórico usou "ponto médio do concessivo" (Opção A)** como data fictícia dos lançamentos antigos (`concessivo_inicio + 183 dias`). Alternativas descartadas: data atual (viajaria no tempo), data do aquisitivo (fora da janela), 1º dia do concessivo (todos colidiam). Observação do lançamento marca: *"Importação histórica consolidada (xlsx) — data fictícia no meio do concessivo"*.
- **Trigger de validação de saldo bloqueou dupla contagem** no import. 2 colaboradores (Italo Teles, Janaína Silva) tinham o mesmo período no xlsx com 2 lançamentos somando 45d (regra CLT: 30 + 15). O script consolidou pra 30d único + registra no resumo. Pode haver 15d "perdidos" nesses casos — se o RH detectar, lança manualmente.
- **Quadro agora omite "Em curso"/incompleto por default no modal** (mostra como colapsável). Decisão de UX: o RH só olha o período acionável (apto/em_alerta/vencido). Passados regularizados ficam colapsados acima do hero; futuros em curso colapsados abaixo.
- **Hero duplo quando há 2+ períodos acionáveis** (regra dos avós do colaborador): o modal mostra 1 card grande por período em vez de 1 hero gigante. Já visto em prod com Philipe Carneiro (4 períodos vencidos 2020-2023).
- **`fn_calcular_meses_rescisao` foi preservada** na limpeza das notificações (2026-10-03). Ela é usada pelo /rh/rescisoes, não só pelas notificações. Não dropar sem avisar.

## O que fica pra próxima sessão

Já aconteceu (ver handoffs seguintes):

- **Task 010 — Vínculo colaborador ↔ usuário** entregue em 2026-10-02 → [`2026-10-02-rh-vinculo-colab-usuario.md`](2026-10-02-rh-vinculo-colab-usuario.md).
- **Redesign /perfil + cleanup de notificações** entregue em 2026-10-03 → [`2026-10-03-perfil-redesign-e-cleanup-notificacoes.md`](2026-10-03-perfil-redesign-e-cleanup-notificacoes.md).

Pendências ainda abertas no módulo de férias:

- **Dobra CLT**: hoje a California não aplica dobra (CLT art. 137) — se um colaborador CLT atinge vencido, é passivo trabalhista que o RH negocia fora. Se um dia aplicar, o cálculo entra em `fn_calcular_meses_rescisao` e no card de rescisão.
- **Benefícios recorrentes no cálculo de rescisão** zerados por padrão (F9). RH deduz manualmente ao lançar em Contas a Pagar. Vai amarrar quando o subsistema de benefícios existir.
- **Alertas automáticos no Quadro** (concessivo em alerta, concessivo liberado) vão renascer no hub central de notificações (ver `docs/pendencias/hub-central-notificacoes.md`). O cron antigo foi removido.
- **11 "ativos" sem match no banco** da planilha de histórico. RH precisa revisar `tmp/hist-sem-match.txt` e decidir caso a caso (desligados antigos? Admissões não cadastradas?).
- **20 vencidos legítimos** no Quadro — Philipe (4 períodos 2020-2023), João Victor Caetano, Bernardo, Felipe Berber, Mina, etc. Lista completa documentada em `docs/modulos/rh/40-historico-ferias-importado.md`.

## Rastros técnicos

Migrations aplicadas nessa sessão:

```
20261002000001  ferias_role_colaborador                   (adiciona 'colaborador' ao enum app_role)
20261002000002  ferias_fundacao                           (tabelas colaboradores_ferias_periodos + user_id em colaboradores)
20261002000003  ferias_backfill_periodos                  (gera períodos pra todos os ativos)
20261002000004  ferias_lancamentos                        (tabela de lançamentos + trigger de validação de saldo)
20261002000005  ferias_notificacoes_e_funcoes             (REMOVIDA em 2026-10-03)
20261002000006  ferias_bucket_recibos                     (bucket Storage pros PDFs de recibo PJ)
20261002000007  ferias_cron_alertas_automaticos           (REMOVIDA em 2026-10-03)
20261002000008  ferias_data_limite_gozo                   (data_limite_gozo = aquisitivo_fim + 11 meses)
20261002000009  ferias_cron_usa_data_limite_gozo          (REMOVIDA em 2026-10-03)
20261002000010  rh_perf_consolida_policies                (task 009 Onda 1a: 12 policies → 1 por tabela/comando)
20261002000011  rh_perf_indices_fks                       (task 009 Onda 1b: 17 índices em FKs)
20261002000012  ferias_exclui_socios                      (sócios saem do subsistema; 63 períodos deletados)
```

Commits relevantes (mais antigos primeiro):

```
6d8a3c2  feat(rh): subsistema de férias — S2 lançamentos, notificações, cálculo de rescisão
c30eb3b  feat(rh): subsistema de férias — S3 página /perfil + role colaborador
3441bd2  feat(rh): subsistema de férias — S4 solicitação pelo colaborador
4ae426f  feat(rh): subsistema de férias — S5 /rh/ferias com Painel + Solicitações
0a8654a  feat(rh): subsistema de férias — S6 tabs Quadro + Calendário + lançar direto
140f4ff  feat(rh): subsistema de férias — S7 cálculo PJ + gerador de recibo PDF
490a447  feat(rh): subsistema de férias — S8 notificações visíveis + cron + rescisões
0a2a419  feat(rh): subsistema de férias — Passo 1 do redesign (data_limite_gozo)
df18a5b  feat(rh): subsistema de férias — Passo 2 do redesign (Quadro estilo Acompanhamento)
63346e3  feat(rh): subsistema de férias — Passo 3 do redesign (modal + timeline horizontal)
2eeabd7  feat(rh): subsistema de férias — Passo 4 do redesign (/perfil polido)
7a82581  perf(rh): task 009 Onda 1 — consolida policies RLS + indexa FKs
74e72b2  perf(rh): task 009 Onda 2 — paraleliza queries + select específico
d2a6b35  perf(rh): task 009 Onda 3 — modal via state local em vez de query param
2a3b46f  perf(rh): task 009 Onda 3.5 — filtros do Quadro 100% client-side
fc0abca  refactor(rh): remove tab Calendário e move Rescisões pra /rh/rescisoes
7f63d65  feat(rh): exclui sócios do subsistema de férias
b86710d  feat(rh): /ferias vira dashboard — KPIs e notificações no Painel
07991f3  feat(rh): modal e form de férias com foco na situação atual
```

Scripts auxiliares do import histórico (fora do repo, em `tmp/`):

- `tmp/hist-passo1-casamento.mjs` — casa nomes planilha↔banco (203 matches).
- `tmp/hist-passo3-gerar-sql.mjs` — gera SQL de inserção dos 279 lançamentos.
- `tmp/hist-matches-confirmados.json` — resultado persistido do casamento.
- `tmp/hist-sem-match.txt` — 11 nomes da planilha que não casaram, pra revisão RH.

Documentação complementar:
- Spec viva do subsistema: `docs/modulos/rh/25-ferias.md`.
- Modelo de dados: `docs/modulos/rh/26-ferias-modelo-de-dados.md`.
- Plano de execução: `docs/modulos/rh/27-ferias-plano-de-execucao.md`.
- Nota do import histórico: `docs/modulos/rh/40-historico-ferias-importado.md`.
