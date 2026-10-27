# Módulo 13º Salário entregue end-to-end (2026-10-21)

> O 13º da California saiu de uma planilha Excel manual (regenerada todo ano, com fórmulas quebradas e envio pro financeiro à mão) e virou um módulo integrado ao ERP: cálculo automático baseado no cadastro, adiantamentos lançados no financeiro em tempo real, fechamento das duas parcelas enviadas pelo mesmo fluxo da folha mensal, histórico auditável por colaborador e por ano. Tudo em uma sessão.

## O que muda pro negócio

A Kika pode fazer a folha de 13º/2026 inteira dentro do ERP: criar, ajustar casos excepcionais, lançar adiantamentos durante o ano, fechar as duas parcelas no final e deixar o financeiro aprovar como já faz com a folha mensal. **A planilha Excel do 13º se aposentou.** O que antes era um arquivo que ninguém auditava e que sobrescrevia o ano anterior virou um registro navegável por ano, com histórico por colaborador no perfil dele, com cálculo correto pelas tabelas vigentes de 10/2026 (não as da planilha antiga, que tinha `#REF!` no INSS e IRRF sobre a 2ª parcela isolada).

## Estado atual (o que existe agora)

- **Página de 13º** em `/rh/decimo-terceiro` lista folhas por ano em cards. Card no hub de RH ("13º Salário") entre Benefícios e Rescisões.
- **Folha de 13º/2026** criada: **206 colaboradores elegíveis** (CLT, CLT Recibo híbrido, PJ, MEI; estagiários e sócios ficam de fora). Status atual: `rascunho`.
- **Fluxo de criação** puxa snapshot do cadastro (nome, CPF, tipo, função, admissão, salário vigente, `valor_recibo` pro híbrido, empresa alocada).
- **Cálculo correto pelas tabelas 10/2026**: INSS (Portaria MPS/MF nº 13/2026), IRRF (Lei 15.191/2025 + dedução simplificada R$ 607,20), redução Lei 15.270/2025 (isenção efetiva até R$ 5k). Teste bate exatamente com planilha-referência (Caroline, 13º bruto R$ 2.250 → INSS R$ 178,18, líquido R$ 2.071,82).
- **Breakdown híbrido** pros 9 colaboradores `clt_recibo` com `valor_recibo > 0`. Tabela mostra linha agrupadora com total, chevron abre duas linhas filhas (Parte CLT com desconto + Parte PJ sem desconto). Adiantamento rateado proporcional.
- **Adiantamentos** em `/rh/decimo-terceiro/{ano}/adiantamentos`. Cada lançamento cria `conta_avulsa` aprovada automática (via service client, plano "Despesa com Pessoal · 13° Salário") e atualiza `total_adiantado` da linha + recalcula a 1ª parcela em tempo real.
- **Fechamento das parcelas** cria linhas em `folhas_pagamento` com `tipo=decimo_terceiro_1a_parcela` (ou `_2a`), `status=enviada`, FK apontando pra linha de origem. Essas linhas aparecem direto em `/financeiro/contas-a-pagar?tab=folhas` pro financeiro aprovar — mesma UI da folha mensal. Trava de NF existente cobre o 13º sem código novo.
- **Edição manual** por linha (dialog com "Ajustar salário" + "Ajustar avos" + obs). Pra retroativo de reajuste, dependentes IR não zerados, afastamento > 15 dias — todos override manual.
- **Histórico por colaborador** no card "13º Salário" em `/rh/colaboradores/[id]`.
- **Exportação XLSX** replicando o layout da planilha-referência (abas CLT e PJ, com 2ª parcela líquida).
- **Filtros + ordenação** na tabela: searchbar por nome (ignora acento), filtro de empresa, filtro de tipo, ordenação clicável em Colaborador/Admissão/Salário.

## Decisões que vão importar amanhã

### Tabelas INSS/IRRF são hard-coded, não vêm do banco

Em `lib/decimo-terceiro/calc.ts`. Toda vez que o governo mudar faixas (Portaria MPS anual) ou sair lei nova, **tem que editar o arquivo + testes**. Procedimento documentado em [ADR 222](../decisions/222-decimo-terceiro-tabelas-10-2026.md). Se esquecer, o cálculo fica errado em silêncio — ninguém testa valor absoluto na UI, só o teste da Caroline captura divergência.

### Snapshot é imutável até "Recalcular folha"

A linha de 13º guarda cópia do cadastro no momento da criação. Mudar `colaboradores_salarios.valor` ou `data_admissao` depois **não** altera a folha sozinho. Isso é intencional (auditoria), mas vale lembrar: se alguém reclamar que "mudei o salário e o 13º não mudou", a resposta é "clicar Recalcular folha".

### Desligados saem da folha de 13º

Filtro de criar folha exclui `data_encerramento <= {ano}-12-31`. Rescisão trata o 13º proporcional desses casos em `/rh/rescisoes`. Se um colaborador for desligado depois da folha criada, "Recalcular folha" **deleta** a linha dele automaticamente (confirmado via backfill — 2 linhas removidas em 10/2026).

### Badge "reajuste" só em quem teve mudança real

A primeira versão disparava em qualquer colaborador com linha em `colaboradores_salarios` com `data_inicio` no ano. Isso pegava admitidos no ano e ajustes administrativos (Álezis "Ajuste em folha 09/2026") — falso positivo. Corrigido: badge só dispara quando há linha no ano **E** linha anterior ao ano. No dataset atual, só 1 colaborador tem reajuste real; o resto é falso positivo que foi silenciado.

### Dependentes IR = 0 por default

Não há coluna `dependentes_ir` no cadastro. Pra considerar, RH edita `salario_editado` como workaround. Impacto: colaboradores com muitos dependentes vão ter IR calculado a mais que o real. Mitigação futura: adicionar o campo no colaborador.

### A folha de 2026 foi criada "cedo demais"

Antes da Fase A (breakdown híbrido) existir. Os 9 CLT_recibo ficaram com `snapshot_valor_recibo = NULL` e `parte_clt_* = NULL`. **Pra popular, basta clicar "Recalcular folha" uma vez.** Depois disso o chevron de expand aparece. Folhas futuras não têm esse problema — nascem já com breakdown.

### Service client no adiantamento é intencional

RH não tem permissão de criar `contas_avulsas` direto (só admin/financeiro). Adiantamento de 13º é responsabilidade do RH mas gera avulsa — resolvido chamando `criar_conta_avulsa` via service client com os carimbos de aprovada preenchidos pelo próprio RH. Se a California quiser que o financeiro aprove os adiantamentos manualmente, isso vira um fluxo em 2 etapas (TODO futuro).

### Documentação do módulo em 3 lugares

- Spec viva: [`docs/modulos/rh/60-decimo-terceiro.md`](../modulos/rh/60-decimo-terceiro.md)
- ADR integração folha de pagamento: [`docs/decisions/220`](../decisions/220-decimo-terceiro-integracao-folha-pagamento.md)
- ADR breakdown híbrido: [`docs/decisions/221`](../decisions/221-decimo-terceiro-breakdown-hibrido.md)
- ADR tabelas 10/2026: [`docs/decisions/222`](../decisions/222-decimo-terceiro-tabelas-10-2026.md)
- Design doc da Parte 1 original (histórico): [`docs/superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md`](../superpowers/specs/2026-10-21-decimo-terceiro-parte-1-design.md)
- Plano de execução da Parte 1 (histórico): [`docs/superpowers/plans/2026-10-21-decimo-terceiro-parte-1.md`](../superpowers/plans/2026-10-21-decimo-terceiro-parte-1.md)

## O que fica pra próxima sessão

### Operacional (curto prazo)

- **Testar o ciclo end-to-end na folha de 2026.** Clicar "Recalcular folha", conferir se os 9 híbridos ganham chevron, fechar 1ª parcela, verificar as 206 linhas aparecendo em Contas a Pagar, financeiro aprovar algumas, voltar e fechar 2ª parcela.
- **Validar com a Kika.** Alguma regra de negócio que não foi capturada? Casos excepcionais que o override manual não resolve bem?

### Próximas features (quando precisar)

- **Campo `dependentes_ir`** no cadastro de colaboradores. Pequena migration + edição no formulário + atualização de 1 parâmetro no `calcularLinhaDecimoTerceiro`. Resolve o IR a mais pros colaboradores com dependentes.
- **Cálculo automático de retroativo de reajuste.** Hoje é override manual. Pode virar automação se definir uma regra única (salário médio ponderado por dias? diferença entre parcelas com salário novo?).
- **Tabela de afastamentos** no sistema. Hoje override manual via `avos_editado`. Vale só se tiver demanda real pra isso.
- **Status automático "concluída"**. Hoje a folha para em `fechada_parcial_2`. Pra virar `concluida` sozinha, teria que observar `folhas_pagamento` originadas e marcar quando todas estiverem pagas. Trigger ou job.
- **Aprovação do adiantamento pelo financeiro** (em vez de criação automática via service client). Vira fluxo 2 etapas: RH lança (status=pendente), financeiro aprova (vira avulsa). Discutível se vale o atrito operacional.

## Rastros técnicos

**Migrations** (todas em `supabase/migrations/`):

```
20261021000001_decimo_terceiro_fundacao.sql
20261021000002_folha_tipo_decimo_terceiro.sql
20261021000003_decimo_terceiro_folha_status_fechamento.sql
20261021000004_decimo_terceiro_hibrido_e_folha_fk.sql
20261021000005_decimo_terceiro_adiantamentos.sql
20261021000006_decimo_terceiro_flag_reajuste.sql
```

**Commits principais** (`git log --author=Antonio --grep='13o\|rh.*card\|rh.*descr\|rh.*coloc\|rh.*voltar' --oneline`):

- `fd2f9290` fundação do banco + tipos
- `044e4a42` lógica pura de cálculo (26 testes verdes depois das correções)
- `f205d940` listagem + criação da folha
- `41d54c02` detalhe + edição + recálculo
- `35fee74a` exportação XLSX
- `64f41ce0` perf fix (recalcular em paralelo)
- `00ae6fb8` fundação Fase A (schema híbrido + enum folha_tipo)
- `2ecb5e18` calc com breakdown híbrido
- `25a1114e` actions populam breakdown
- `dafd6035` UI linha expansível
- `8617aeb3` fechar 1ª/2ª parcela
- `34cef0df` aprovação cai no plano "13° Salário"
- `321bd385` adiantamentos (Parte 2)
- `93f1f5da` histórico no perfil (Parte 5)
- `9ad03f00` rescisão sai da folha (Parte 6)
- `7b6dfb7a` sinalização reajuste (Parte 4)
- `2def267f` filtros + ordenação
- `bc7d88db` 2ª parcela líquida na coluna
- `d2600cc1` fix badge reajuste falso positivo + jargão
- `f5ebb594` nome encurtado + badge híbrido removido + desligados excluídos
- `78772284` tabelas INSS/IRRF 10/2026 + Lei 15.270 (teste da Caroline bate)
- `0e8483c3` botões com loading state + recalcular em batches de 25
