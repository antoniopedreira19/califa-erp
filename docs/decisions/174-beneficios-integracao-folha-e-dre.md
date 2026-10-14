# 174 — Benefícios: integração com folha mensal e tratamento no DRE

**Data:** 2026-10-14
**Status:** aceita; Fase 2 e Fase 3 implementadas (2026-10-14).
**Revisão (2026-10-14):** §1.1 ajustado após feedback do usuário — "Aplicar descontos" não cria mais avulsas. O portão único RH→Financeiro é o "Enviar ao financeiro" (que também gera as avulsas de operadora). Motivo: RH é 100% rascunho até confirmar envio; evita avulsa aparecer em Contas a Pagar enquanto a Kika ainda está revisando. Ver §1.1 revisado abaixo + plano `docs/modulos/rh/56-beneficios-fase-3-plano-de-execucao.md` + migration `20261014000004`.
**Quem decidiu:** Daniel, em sessão de brainstorm (14/10/2026).
**Contexto:** continua [`docs/modulos/rh/50-beneficios.md`](../modulos/rh/50-beneficios.md). Fase 1 (visualização) já em produção; esta decisão fecha a arquitetura das Fases 2 (fechamento mensal) e 3 (integração com folha + DRE).
**Migrations previstas:** criadas no início da Fase 2 e da Fase 3 (ainda sem código).

Hoje a Kika calcula o desconto de benefício fora do sistema e digita o líquido manualmente em cada linha da folha PJ. Também cadastra à mão todo mês uma avulsa para a SulAmerica e outra para o Bradesco com o valor da fatura cheia. Esta decisão congela como automatizar os dois passos sem quebrar o fluxo atual da folha (ver decisão [132](132-folha-paga-pela-remessa-com-o-liquido.md)) e sem distorcer o DRE.

---

## 1. O que fica decidido

### 1.1 Fluxo da folha ganha um terceiro checkpoint

A página da competência da folha (`/rh/folhas/[competencia]`) hoje tem dois checkpoints: **PJ gerada** e **CLT importada**. Ganha um terceiro **"Benefícios aplicados"**, só habilitado quando os dois primeiros estão verdes.

```
☑ PJ gerada              ☑ CLT importada          ☐ Benefícios aplicados
181 linhas · R$ 1.6M     22 linhas · R$ 450k      [+ Aplicar descontos]
                                                              │
                                                              ↓
                                    [Enviar ao financeiro]
```

Clicar em **"Aplicar descontos"** faz, numa transação:

1. **Fechar a competência de benefícios** (grava snapshot em `beneficio_fechamento_mensal` + `beneficio_fechamento_linha`).
2. **Reduzir `salario_base`** de cada linha PJ (`origem = 'california'`) pelo valor do desconto do colaborador no snapshot. Grava o valor subtraído em coluna nova `desconto_beneficios` para auditoria.
3. **Marca a competência como "Benefícios aplicados ✓"**.

**Portão único RH→Financeiro:** o "Enviar ao financeiro" é o que cria as duas avulsas em `contas_avulsas` (uma por operadora, valor cheio da fatura, subtipo `002 Benefícios`, FK `beneficio_fechamento_id`). Isso roda no mesmo instante em que as linhas PJ+CLT da folha viram títulos. **Enquanto a Kika não enviar, o financeiro não vê nada de benefícios** — RH é 100% rascunho até a confirmação final. Precondição: o fechamento tem que estar vigente, senão o Enviar falha pedindo pra aplicar antes.

Botão **"Desaplicar"** reverte tudo enquanto nenhuma avulsa foi paga. Se o Enviar ainda não rolou, não há avulsa pra apagar — só reverte folha + marca reaberto. Depois do Enviar com avulsa paga, a reversão exige estorno pelo financeiro primeiro.

### 1.2 CLT fica totalmente fora do desconto

A contabilidade já aplica o desconto de benefícios no PDF "Relação Geral dos Líquidos" (ver [docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md](../superpowers/specs/2026-10-06-folha-dois-fluxos-design.md)). Linhas de `folhas_pagamento` com `origem = 'contabilidade'` **nunca** têm `salario_base` modificado por "Aplicar descontos" — já estão com o líquido correto.

O benefício dessas pessoas **ainda conta** para a fatura da operadora, porque a SulAmerica cobra todos os colaboradores juntos (PJ e CLT) numa fatura única. A diferença é só no desconto: PJ é descontado pela California (via Aplicar), CLT já veio descontado da contabilidade.

### 1.3 Pagamento único por operadora

A California recebe um boleto por mês de cada operadora. O sistema reflete isso: **uma avulsa por fornecedor por competência**, com o valor total da fatura. Nenhum rateio por colaborador no financeiro — o detalhamento (quem contribuiu com quanto) fica no snapshot `beneficio_fechamento_linha`, acessível via FK `beneficio_fechamento_id` da avulsa.

Vencimentos padrão:
- SulAmerica: dia **5 do mês seguinte** à competência
- Bradesco Dental: dia **29 do mês seguinte** à competência

Configurável no cadastro de cada benefício do catálogo via colunas novas `beneficios.dia_vencimento_fatura (int)` e `beneficios.vencimento_mes_seguinte (bool, default true)`.

### 1.4 Conta pagadora é problema do financeiro

O sistema não decide qual CNPJ da California paga a avulsa. A avulsa é criada normalmente; o financeiro escolhe conta bancária na hora da baixa, como já faz hoje em qualquer avulsa.

### 1.5 Corte de inclusão de dependente

Dependente incluído em qualquer dia de uma competência vigora a partir do **1º dia da competência seguinte**. Já implementado via `SeletorCompetenciaForm` no modal de "Novo Dependente" e "Incluir em plano", com default na próxima competência.

Caso a Kika queira retroagir (ex.: cadastrar dep em outubro para vigorar em setembro, pra reconciliar com fatura antiga), o campo aceita qualquer competência passada ou futura.

### 1.6 Nenhum dependente menor de 19 anos no Especial

Regra operacional confirmada por Daniel: nenhum dependente abaixo de 19 anos vai ser cadastrado no plano SulAmerica Especial. Essa faixa não existe no catálogo oficial do Especial (começa em 19-23). Como é regra operacional, **não há trava técnica** — o sistema aceitaria se tentasse, mas simplesmente não vai acontecer. Documentado aqui pra evitar que alguém reabra essa discussão.

### 1.7 Snapshot congela ao aplicar (não é cálculo ao vivo)

Hoje o cálculo de benefícios é dinâmico — toda vez que a tela abre, roda `fn_beneficios_custo_mensal`. Isso é bom pra visualização, mas inseguro pra financeiro: se a Kika mexer no catálogo depois de aplicar, os valores das competências anteriores mudariam.

A partir do "Aplicar", a competência vira snapshot. Benefícios editados depois **não afetam** competências já aplicadas. Pra atualizar, usa-se "Desaplicar" → mexe → "Aplicar de novo".

---

## 2. Tratamento no DRE (ponto mais sensível)

A California paga ~R$ 110 mil/mês de boleto SulAmerica. Desse total, só **~R$ 56 mil é despesa real** (parte que a empresa custeia). Os outros ~R$ 54 mil são repasse: dinheiro que a California desconta dos colaboradores e repassa pra operadora. Contabilmente, repasse não é despesa — é dinheiro de terceiros passando pela empresa.

Discutidas 3 arquiteturas pra registrar isso:

- **(A)** 1 avulsa única R$ 110k classificada como "Benefícios". Simples, bate com boleto, mas DRE infla despesa de benefícios.
- **(B.1)** 2 avulsas por operadora (R$ 56k Benefícios + R$ 54k Repasse). DRE preciso mas Kika paga 2 títulos pra 1 boleto.
- **(B.2)** Rateio de plano de contas dentro da mesma avulsa. Mudança estrutural grande em `contas_avulsas` (hoje aceita 1 subtipo só), semanas de trabalho fora de escopo.
- **(B.3)** 1 avulsa única no banco (igual A), **DRE aplica ajuste via view SQL**. Pagamento simples, DRE preciso, zero conta nova.

**Decisão: B.3.**

### 2.1 Lançamento no banco (sem mudança)

Igual opção A:

- `contas_avulsas` recebe 1 linha por operadora com valor cheio, subtipo `05.002 Benefícios`
- `folhas_pagamento` sai com `salario_base` já líquido (depois do desconto)

### 2.2 Ajuste no DRE (via view)

Criar view `vw_dre_despesa_pessoal_ajustada_mensal` que faz:

```
valor_dre_pessoal     = valor_bruto_pessoal     + repasse_colaborador_do_mes
valor_dre_beneficios  = valor_bruto_beneficios  - repasse_colaborador_do_mes
```

O `repasse_colaborador_do_mes` vem de `beneficio_fechamento_linha` (soma de `valor_colaborador` da competência fechada).

Resultado: linha "Benefícios" do DRE mostra só a parte empresa (R$ 56k), linha "Pessoal" mostra o bruto (porque o colaborador ganhou o salário cheio, mesmo tendo descontado parte pra benefícios). Soma total continua batendo com saída de caixa.

### 2.3 Camadas do DRE futuro

Quando o módulo DRE for implementado, a tela consome **uma única view agregadora** (`vw_dre_mensal`), que por baixo faz `UNION ALL` de views especializadas por natureza:

```
vw_dre_mensal (mestra consumida pela tela)
├── vw_dre_receita_mensal
├── vw_dre_impostos_sobre_venda_mensal
├── vw_dre_despesa_pessoal_ajustada_mensal   ← esta decisão
├── vw_dre_despesa_marketing_mensal
└── (etc)
```

Padrão consistente com `vw_a_pagar`, `vw_fluxo_caixa` e outras agregadoras já no projeto. Nenhuma lógica contábil mora em código TypeScript.

---

## 3. Quatro âncoras pra garantir que o DRE respeite a regra

Nenhum sistema impede tecnicamente que alguém, meses depois, construa o DRE lendo `contas_avulsas` direto e ignore o ajuste. Em vez disso, deixa-se a regra em 4 pontos físicos pra tornar o esquecimento improvável:

1. **View no banco** (`vw_dre_despesa_pessoal_ajustada_mensal`) — artefato físico criado junto da Fase 2, mesmo antes de qualquer DRE existir.
2. **`COMMENT ON VIEW`** explicando a regra do repasse e apontando pra este ADR.
3. **Este ADR** — ponto canônico de referência.
4. **Nota no `CLAUDE.md`**: "DRE de Despesa com Pessoal/Benefícios: sempre consumir `vw_dre_despesa_pessoal_ajustada_mensal`. Ver ADR 174." Adicionado quando a view existir pra referenciar algo real.

Também: a seção "Fase 4 — Integração com DRE" do spec `docs/modulos/rh/50-beneficios.md` referencia este ADR.

---

## 4. Pré-requisitos pra implementar

Antes de ligar Fase 2 em produção:

- **Cadastrar SulAmerica e Bradesco como fornecedores** (manual pela UI do financeiro ou migration de seed). O ID desses fornecedores alimenta as colunas `beneficios.fornecedor_id` novas (ou lookup por nome na hora de criar a avulsa). Decidir na implementação da Fase 3.
- **Validação em produção da Fase 1**: Daniel confirmou (14/10) que o cálculo da Fase 1 bate com a planilha real.

---

## 5. O que fica fora desta decisão

- **Reconciliação automática** entre snapshot calculado e fatura real que chega da operadora. A Kika edita o valor da avulsa à mão se o boleto vier diferente (ex.: ajuste contratual, diferença de dias). Rara divergência; não vale automatizar.
- **Encargos CLT** (INSS, FGTS, IR Retido) — continuam fora, repassados pela contabilidade por outros circuitos.
- **13º salário, férias, rescisão** — já têm fluxos próprios ou não envolvem benefícios da forma modelada aqui.
- **Benefícios de sócio** — sócios estão fora do subsistema (ver `50-beneficios.md` §3).

---

## 6. Ordem de implementação

1. **Fase 2** — Fechamento mensal (pré-requisito).
   - 2 tabelas novas (`beneficio_fechamento_mensal`, `_linha`)
   - 2 colunas em `beneficios` (dia/mês de vencimento)
   - View `vw_dre_despesa_pessoal_ajustada_mensal`
   - UI: botão "Fechar competência" em `/rh/beneficios`
   - Spec detalhado: `docs/modulos/rh/53-beneficios-fechamento-mensal.md`
2. **Cadastro de fornecedores**: SulAmerica + Bradesco (precondição manual antes da Fase 3)
3. **Fase 3** — Botão "Aplicar descontos" na folha
   - Coluna `contas_avulsas.beneficio_fechamento_id`
   - Coluna `folhas_pagamento.desconto_beneficios`
   - Server actions: `aplicarBeneficios(ano, mes)` + `desaplicarBeneficios(ano, mes)`
   - UI: checkpoint na página da competência da folha
   - Spec detalhado: `docs/modulos/rh/54-beneficios-integracao-folha.md`
4. **Linha no CLAUDE.md** apontando pra view (quando a view existir).

Fases 2 e 3 em branches/PRs separados.
