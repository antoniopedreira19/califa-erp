# 134 — Regional só de folha: a AMBEV some da produção

**Data:** 2026-09-30
**Decidido por:** Tiago
**Status:** aceita — etapa 1 entregue; etapa 2 (modelo definitivo) aguarda
respostas do Tiago
**Migration:** `20260930300001_regional_so_de_folha.sql`

---

## 1. O problema

No "Novo projeto", o campo **Regionais** da Agência California oferecia
AMBEV ao lado de NE, NO, RJ, SP e SS. O Tiago viu o print e pediu para
corrigir: *"Isso não faz sentido."*

A AMBEV não é unidade de negócio. É a regional criada em 25/09/2026 para
abrigar a equipe que o cliente AMBEV indica e reembolsa todo mês, mas que
a California contrata na própria folha. Nas palavras do Tiago:

> Esse caso se trata de uma demanda de projetos da AMBEV (cliente) onde
> demandam que utilizemos uma equipe terceirizada indicada por eles para
> realizar o trabalho, onde é demandado que essa equipe seja contratada na
> nossa folha de pagamento. […] eles nos pagam com o valor referente a seus
> salários (mensal) […] Mas os reconhecemos como um custo operacional dos
> projetos onde estão envolvidos.
>
> […] a produção não pode ver essa regional como uma opção a ser
> selecionada ao criar projetos. Esse nunca pode ser o caso.

O formulário lista toda regional **ativa** da empresa. Não havia como dizer
"ativa para o RH, mas não para projeto".

O que havia no banco em 30/09/2026:

| Onde | Linhas com a AMBEV |
|---|---|
| `colaboradores_alocacoes` | 11 (todos CLT, 100% nela, sem outra alocação) |
| `folhas_pagamento_alocacoes` | 10 (folha 09/2026, status "enviada", sem título ainda) |
| projetos, vínculos de regional, orçamentos, jobs | 0 |
| títulos, lançamentos, contas avulsas, faturamento | 0 |

A descoberta do RH já previa o caso (`docs/modulos/rh/00-descoberta.md`
§6.5): a coluna "Empresa Detalhe" da planilha (AMBEV para conta dedicada,
CREATORS para squad) ficou fora do MVP, com a nota de que voltaria como
**dimensão da alocação**. Sem ela, a conta dedicada virou regional.

## 2. Por que não desativar

`ativo = false` tiraria a AMBEV do projeto, mas também do RH e da folha:
as telas `rh/colaboradores/[id]` e `rh/folhas/[competencia]` filtram por
`ativo`. As 11 alocações e as 10 linhas em aprovação perderiam a regional
na tela, a dias do pagamento de 02/10.

## 3. A regra (etapa 1)

| Regional | RH, folha, financeiro | Projeto, orçamento, job |
|---|---|---|
| Unidade de negócio (SP, NE…) | Sim | Sim |
| Só de folha (AMBEV) | Sim | **Nunca** |

- **`regionais.disponivel_em_projetos`** (boolean, padrão `true`). Só a
  AMBEV está com `false`.
- **Telas que deixam de oferecer:** formulário do projeto (novo e edição),
  editor do job e os filtros dos relatórios de Rentabilidade e Faturamento.
  Os dois relatórios são de job, e regional só de folha nunca tem job.
- **Validação da action:** `validarMarcasERegionais` recusa, com mensagem
  no campo.
- **Trava no banco:** `ck_regional_disponivel_em_projetos`, disparada em
  `projetos`, `projeto_regionais`, `orcamentos` e `jobs` (`before insert or
  update of regional_id`). O editor de job grava `regional_id` sem conferir
  nada, e a regra não pode depender de cada action lembrar dela. Só dispara
  quando a regional **muda**: uma linha antiga que fica como está passa.
- **Continua igual:** o RH aloca na AMBEV, a folha rateia nela, e o
  financeiro a vê nos rateios de contas a pagar e a receber, no fluxo de
  caixa e nos desembolsos.

Mensagens: "Esta regional é só de folha de pagamento e não pode ser usada
em projetos." (projeto) e "… em jobs." (editor do job).

## 4. O que ficou de fora

- **Campo na administração** para marcar outra regional como só de folha.
  Por ora só a AMBEV precisa, e a etapa 2 deve aposentá-la.
- **A etapa 2**, abaixo.

## 5. Etapa 2 — o modelo definitivo (em aberto)

A proposta, a validar com o Tiago:

- Os 11 passam para a regional onde de fato atuam.
- A alocação ganha **"custo dedicado ao cliente"** (a dimensão prevista no
  §6.5 da descoberta do RH).
- O título da folha nasce com o cliente AMBEV. A coluna
  `contas_avulsas.cliente_id` já existe.
- O reembolso entra como receita do mesmo cliente.
- A regional AMBEV é aposentada. A CREATORS, se aparecer, segue o mesmo
  caminho.

Restrições conhecidas:

- **Não mexer antes do pagamento de 02/10/2026.** Trocar a alocação com as
  10 linhas em aprovação mudaria o rateio dos títulos.
- **Mexe no cadastro do RH, que é da frente do Antonio** (alocação e geração
  da folha). Precisa ser combinado com ele.

Perguntas que definem o desenho:

1. Como a AMBEV paga o reembolso: numa nota mensal separada ou embutido no
   orçamento de cada job?
2. O reembolso cobre só o salário, ou também encargos (INSS, FGTS, férias,
   13º) e uma margem?
3. Em que regional essas 11 pessoas atuam de fato?
