# 109 — Dias/meses do orçado pode ser zero, e não trava a aprovação

**Data:** 2026-09-27
**Decidido por:** Tiago
**Migration:** `20260927100001_dias_meses_zero_no_orcado`

---

## 1. O problema

A planilha da agência usa D/M 0 para marcar item bonificado. Na planilha
"[INT] BUDWEISER - FESTIVAIS 2026 - MADA - ZPL.xlsx", aba Página9, o
"Motion (Bonificado 100%)" é R$ 3.000 × 1 × 0: aparece na planilha, mas
não soma no TOTAL.

O ERP não aceitava D/M zero no orçado (CHECK `itens_dias_meses_positivo`),
então o parser trocava o 0 por 1, com aviso. A versão importada nascia com
**R$ 155.775,00** de orçado, contra os **R$ 152.775,00** do TOTAL da
própria planilha.

## 2. A regra

O D/M do orçado segue a mesma regra que a quantidade já seguia desde
15/09/2026 (decisão 078):

| Onde | Regra |
|---|---|
| Item novo, criado no sistema | nasce com **QT 1 e D/M 1** (sem mudança) |
| Edição na planilha da versão, agregada e editor do orçamento | aceita **zero**; negativo continua recusado ("Dias/meses não pode ser negativo.") |
| Importação (nacional, internacional, mensal e planilha do projeto) | **zero entra como zero**, sem aviso; vazio ou ilegível vira 1; negativo vira 1 com aviso |
| Aprovação da versão | **não trava** por QT ou D/M zero |
| Abertura do job | o **financeiro** analisa o item com QT ou D/M zero na conferência da abertura |

Palavras do Tiago: *"caso isso seja modificado manualmente ou uma planilha
seja importada com zero, a versão poderá ser aprovada normalmente"*, e
*"esse papel ficará para análise do financeiro no momento de abertura"*.

## 3. O que não mudou

- **R$ unitário orçado zerado continua travando** o "Salvar orçamentos" do
  editor e a aprovação da versão (decisão 011).
- O **planejado** já aceitava QT e D/M zero.
- A **PP** continua exigindo QT e D/M maiores que zero
  (`pp_quantidade_positiva`, `pedidos_compra_dias_meses_positivo`): os
  fatores da PP são do GP, não são copiados do orçado.
- A errata do job já aceitava D/M zero.

## 4. Onde está

- Banco: `itens_dias_meses_positivo` (> 0) deu lugar a
  `itens_dias_meses_nao_negativo` (>= 0) em `versoes_orcamento_itens`.
  Nenhuma linha mudou; nenhuma função do banco compara ou divide por
  `dias_meses` (conferido em `pg_proc`).
- Validação: `lib/validations/itens.ts` (`dias_meses_orcado` passou de
  `positive` para `nonnegative`).
- Importação: `lib/importacao/parser-oficial.ts` (nacional e
  `numeroDaLinha`, do internacional). O `parser-projeto.ts` já mantinha o
  zero; quem recusava era o banco.
- Texto das regras no drawer de importação da versão
  (`importar-drawer.tsx`).
- Teste: `lib/importacao/dias-meses-zero.test.ts`.
