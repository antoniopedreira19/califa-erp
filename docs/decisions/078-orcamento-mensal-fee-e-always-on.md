# 078 — Fee e Always On: um orçamento por trimestre, dividido em meses

**Data:** 2026-09-14
**Status:** aceita — entrega 1 de 3 (orçamento)
**Contexto:** `categorias_dominio`, `versoes_orcamento_meses` (nova),
`versoes_orcamento_grupos.mes_id`, a tela da versão do orçamento e o
formulário do orçamento. Pedido do Tiago em 12/09/2026, com a planilha
`INTERNA - DRE + Planilhas Ânima 2026.xlsx` (aba SUL) e o design
`Planilha Fee e Always On` (canvas aprovado em 14/09/2026).

## O problema

Fee e Always On são contratos recorrentes, faturados mês a mês. A California
controla cada regional numa planilha em que cada mês é um bloco inteiro —
equipe e verbas que mudam de um mês para o outro, com orçado, planejado e
realizado próprios. No ERP não havia onde pôr isso: a versão do orçamento é
uma lista só de grupos e itens.

## As decisões (Tiago, 12–14/09/2026)

1. **Um orçamento por trimestre civil**, com 1 a 3 meses. É como o controle
   de jobs de 2026 já trabalha ("ÂNIMA EDUCAÇÃO | JAN, FEV E MAR" é um job,
   com uma linha de faturamento por mês). Foram descartados: um orçamento
   com todos os meses e vários envios à abertura (quebraria "um job ativo
   por orçamento", que o banco garante), e um job anual com rateio na
   abertura (o envio para faturamento é único e travaria errata e save do
   ano inteiro).
2. **O serviço decide a categoria.** Serviço Fee só aceita a categoria Fee;
   Always On, a Always On. E essas categorias só valem para os seus
   serviços. A relação é o campo `categorias_dominio.servico_exclusivo_id`,
   nunca o nome.
3. **Quem escolhe a planilha é a categoria**, pelo enum `modelo_planilha`
   (valor novo `mensal`) — o mesmo mecanismo da [072](072-orcamento-internacional.md).
4. **O período é obrigatório e cabe num trimestre.** Início e fim no mesmo
   trimestre civil, de qualquer ano (trimestre futuro vale). Os meses
   nascem dos meses que o período cobre.
5. **Os meses se editam** ("Editar meses"): adicionar só meses do mesmo
   trimestre; apagar é permitido, mas o orçamento nunca fica sem mês. **O
   período acompanha os meses**, mantendo o dia digitado quando o mês da
   ponta continua.
6. **Mudar o período para outro trimestre** só com as versões sem itens — e
   aí os meses são refeitos. No mesmo trimestre, os meses ficam como estão.
7. **"Copiar itens de outro mês" só para mês vazio.** Copia grupos e itens
   (orçado e planejado); BV e save ficam no mês de origem.
8. **Trocar a categoria de/para Fee ou Always On pede confirmação.** Entrando
   no mensal, os grupos existentes vão para o primeiro mês; saindo, **só o
   primeiro mês permanece** — o resto é apagado, em todas as versões.
9. **Os 5 orçamentos que já tinham serviço Fee/Always On com categoria
   nacional ficam como estão.** A trava só confere o par quando serviço ou
   categoria mudam.
10. **Na visão agregada do projeto o orçamento mensal é só consulta**: soma
    no total do contrato, mas o editor de lá não conhece meses. Também não
    se cria Fee/Always On por lá.
11. Visual: régua de meses (Trimestre + um bloco por mês); o mês abre a
    planilha e os Totais dele; o Trimestre abre os meses empilhados e os
    Totais do trimestre. "Ano consolidado" em tabela foi rejeitado; o
    limite de faturamento e a "conta para sobra" da planilha saíram.

## O modelo de dados

```
versoes_orcamento ─┬─ versoes_orcamento_meses (1..3, mesmo trimestre)
                   └─ versoes_orcamento_grupos ── mes_id ──┘
                            └─ versoes_orcamento_itens (herdam o mês pelo grupo)
```

- **O mês entra no grupo, não no item.** Pôr nos dois criaria duas fontes
  para a mesma informação.
- **O mês é linha própria** porque existe vazio (o trimestre nasce com os
  meses antes de qualquer grupo).
- FK composta `(versao_orcamento_id, mes_id)` garante que o mês do grupo é
  da mesma versão, sem trigger.
- Trigger `versoes_orcamento_meses_mesmo_trimestre` mantém os meses no
  mesmo trimestre.
- ⚠️ **Nome de grupo**: `uniq_grupo_nome_por_versao` virou parcial (grupo
  sem mês) e ganhou `uniq_grupo_nome_por_mes` (grupo com mês). Troca de
  índice autorizada pelo Tiago em 14/09/2026; nenhum dado apagado, e o
  índice antigo manteve o nome que o tratamento de erro procura.
- Trigger `orcamento_servico_e_categoria_coerentes` trava o par serviço ×
  categoria no banco, só quando um dos dois muda.

## As contas

O fechamento de cada mês é o nacional, com os percentuais da versão. O
trimestre soma os meses — com percentuais iguais, é a mesma conta sobre
todos os itens, e o resumo do topo da versão (Valor do Job, Resultado Op.,
Rentab.) continua saindo de `calcularTotaisVersao` sobre a versão inteira.
Nenhuma função de cálculo mudou.

## Transações

Adicionar, apagar e copiar mês, e a troca de modelo, mexem em mais de uma
tabela: vão por RPC (`adicionar_mes_na_versao`, `remover_mes_da_versao`,
`copiar_mes_da_versao`, `trocar_modelo_mensal_do_orcamento`), todas
SECURITY INVOKER. O período novo é calculado em TypeScript
(`periodoQueAcompanhaOsMeses`, com testes) e gravado junto.

## O que ainda não existe (próximas entregas)

- **Entrega 2:** abertura e planilha do job por mês (errata e save travando
  por mês, competência pré-preenchida no trimestre).
- **Entrega 3:** um envio para faturamento por mês, feito pelo GP quando o
  cliente valida (enviar já autoriza), barra de faturamento no rodapé do
  job, devolução pelo financeiro, fluxo de caixa mês a mês, encerramento
  com todos os meses faturados.
- **Depois:** exportação e importação de planilha do modelo mensal.

Até lá, para orçamento mensal: o envio para abertura é recusado no
servidor, "Exportar" fica desabilitado (e as rotas recusam), a importação é
recusada, e o seletor de exportação do projeto não o lista.

## Migrations

- `20260914200001_modelo_planilha_mensal.sql` — valor `mensal` no enum.
- `20260914200002_categorias_fee_always_on.sql` — `servico_exclusivo_id`,
  categorias Fee e Always On (nascem inativas), trava da categoria cobre o
  vínculo.
- `20260914200003_meses_da_versao_do_orcamento.sql` — tabela dos meses,
  `mes_id` no grupo, troca do índice de nome.
- `20260914200004_rpcs_dos_meses_do_orcamento.sql` — as quatro RPCs.
- `20260914200005_ativa_fee_always_on_e_trava_servico.sql` — ativa as
  categorias e cria a trava do par serviço × categoria.
- `20260914200006_comentarios_decisao_077.sql` — as quatro de cima foram
  aplicadas citando "Decisão 076"; no mesmo dia outra frente publicou a 076
  no main, e esta regravou os comentários com 077.
- `20260914200007_comentarios_decisao_078.sql` — a 077 também estava em uso
  no mesmo dia (pagamento urgente da PP, já aplicada no banco). O Tiago
  decidiu que ela fica com a 077 e esta passa a ser a 078; os comentários
  do banco foram regravados de novo.
