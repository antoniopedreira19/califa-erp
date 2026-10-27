# 221 — 13º Salário: INSS/IRRF 10/2026 e Lei 15.270 hard-coded, substituição anual

**Data:** 2026-10-21
**Status:** aceita; implementado em `lib/decimo-terceiro/calc.ts`.
**Quem decidiu:** Daniel + Antonio em sessão de implementação, depois de divergência de R$ 1,55 entre o cálculo do sistema e a planilha-referência "13o_salario_2a_parcela_descontos_10-2026.xlsx".
**Contexto:** continua [`docs/modulos/rh/60-decimo-terceiro.md`](../modulos/rh/60-decimo-terceiro.md), §5.3.

Esta decisão congela como as tabelas de INSS e IRRF do 13º são armazenadas (hard-coded em TypeScript) e como vão ser atualizadas quando as faixas mudarem (anualmente ou quando sair legislação nova).

---

## O problema

Faixas de INSS e IRRF mudam todo ano por conta de reajustes do salário mínimo e leis novas. O 13º sofre direto:

- **INSS**: aumenta o teto e as faixas conforme o salário mínimo sobe. Em 10/2026 passou a vigorar a Portaria MPS/MF nº 13/2026 com faixas 1.621 / 2.902,84 / 4.354,27 / 8.475,55 (anteriormente eram 1.518 / 2.793,88 / 4.190,83 / 8.157,41).
- **IRRF**: Lei 15.191/2025 alterou a tabela progressiva mensal. Também passou a aplicar automaticamente a **dedução simplificada de R$ 607,20** (opcional em folha de pagamento mensal, obrigatória no cálculo oficial se maior que soma INSS + dependentes).
- **Lei 15.270/2025**: criou redução adicional no IRRF pra 13º bruto até R$ 7.350:
  - Até R$ 5.000: dedução de R$ 312,89 (isenção efetiva).
  - R$ 5.000,01 a R$ 7.350: dedução = MAX(0, 978,62 − 0,133145 × bruto).

A primeira versão do cálculo foi baseada numa planilha anterior (`Décimo terceiro 2026.xlsx`) que usava faixas antigas e tinha erros documentados (`#REF!` no INSS, IRRF aplicado sobre a 2ª parcela isolada em vez do 13º integral). Depois a California mandou a planilha-referência correta pra 10/2026 e apareceu divergência de R$ 1,55 no INSS da Caroline (R$ 179,73 vs R$ 178,18).

### Opções consideradas

| Opção | O que seria |
|---|---|
| **A — Tabela no banco** | Criar `fiscal_tabelas_13` com faixas por vigência. RH edita quando mudar. |
| **B — Lib externa** | Usar lib tipo `brasil-folha` ou similar que já conhece as tabelas vigentes. |
| **C — Hard-coded + substituição anual** (decidida) | Faixas em `lib/decimo-terceiro/calc.ts` como constantes. Quando mudarem, PR edita o arquivo + testes. |

---

## O que fica decidido

### 1. Hard-coded em `calc.ts` com nomenclatura `INSS_2026` / `IRRF_2026`

As constantes carregam o ano no nome. Em 2027, nova constante `INSS_2027` será adicionada e a função `calcularInss2026` vira `calcularInss2027` (ou se transforma em `calcularInss(base, ano)` escolhendo a tabela por ano, decisão da próxima vez).

```ts
const INSS_2026 = [
  { teto: 1621.00, aliquota: 0.075, deducao: 0 },
  { teto: 2902.84, aliquota: 0.09, deducao: 24.32 },
  { teto: 4354.27, aliquota: 0.12, deducao: 111.40 },
  { teto: 8475.55, aliquota: 0.14, deducao: 198.49 },
];
```

### 2. IRRF considera dedução simplificada mensal e Lei 15.270

```ts
const DESCONTO_SIMPLIFICADO = 607.20;        // Lei 15.191/2025
const DEDUCAO_POR_DEPENDENTE = 189.59;

const LEI_15270 = {
  isencaoAte: 5000,
  transicaoAte: 7350,
  reducaoIsencao: 312.89,
  reducaoConstante: 978.62,
  reducaoCoeficiente: 0.133145,
};
```

Fórmula do IRRF do 13º:

```
deducaoUsada = MAX(INSS + dependentes × 189,59, 607,20)
baseIR = MAX(0, 13º_bruto − deducaoUsada)
irTabela = aplicar tabela progressiva em baseIR

se 13º_bruto ≤ 5000: reducao = 312,89
senao se 13º_bruto ≤ 7350: reducao = MAX(0, 978,62 − 0,133145 × bruto)
senao: reducao = 0

IRRF = MAX(0, irTabela − reducao)
```

### 3. Dependentes default 0

Hoje não há coluna `dependentes_ir` em `colaboradores`. Até existir, o cálculo assume 0 dependentes (resultado conservador — IR maior). Pra considerar, o RH ajusta `salario_editado` como workaround ou aguarda a adição do campo numa próxima pass.

### 4. Testes com valor real da planilha-referência

O teste "linha Caroline (CLT 3000, 9 meses)" afirma `INSS=178.18, IRRF=0, líquido=2.071,82` — valores extraídos diretamente da planilha-referência. Se o cálculo divergir disso, o teste quebra.

---

## Por que não A (tabela no banco)

- Tabela de faixas muda em média 1 vez por ano. Criar tabela + UI de edição + migration pra atualizar é 10x mais trabalho que mudar 4 linhas em um arquivo TypeScript.
- Mudança nas faixas é um evento auditado (Portaria oficial do MPS). Rastrear no git — "quem alterou, quando, qual Portaria" — é mais limpo que histórico em tabela.
- A regra de aplicação (dedução simplificada, Lei 15.270) é código, não dado. Mesmo se as faixas fossem em tabela, a Lei 15.270 continuaria em código. Melhor manter os dois juntos.

## Por que não B (lib externa)

- Dependência externa pra lógica tributária crítica. Se a lib atrasar em atualizar as tabelas, o cálculo da California atrasa junto.
- Lei 15.270 é novidade de 2025 — libs populares podem não tratar.
- O cálculo é simples (3 funções em 100 linhas); o custo de manter próprio é baixo.

## O custo da decisão

- **Precisa de PR anual** (ou quando sair legislação nova) atualizando `calc.ts` + testes. Procedimento documentado abaixo em "Como atualizar quando mudar a tabela".
- **Pode esquecer**: se a Portaria sair em janeiro e ninguém lembrar de atualizar, o cálculo fica errado em silêncio. Mitigação: adicionar lembrete no HANDOFF.md todo ano em dezembro.
- **Dependentes só com workaround**: colaboradores com muitos dependentes vão ter IR calculado a mais. RH precisa editar `salario_editado` como ajuste manual até existir campo próprio.

## Como atualizar quando mudar a tabela

Quando sair Portaria nova (ex.: para 2027):

1. **Adicionar nova constante** em `lib/decimo-terceiro/calc.ts`:

   ```ts
   const INSS_2027 = [
     { teto: X, aliquota: 0.075, deducao: 0 },
     // ...
   ];
   const IRRF_2027 = [
     { teto: X, aliquota: 0, deducao: 0 },
     // ...
   ];
   ```

2. **Renomear ou parametrizar funções**: `calcularInss2026` → `calcularInss(base, ano)` que escolhe a tabela certa internamente. Ou criar `calcularInss2027` paralelo e trocar o chamador. A primeira opção escala melhor.

3. **Atualizar testes** com um caso-sanidade da nova tabela (idealmente copiando de uma planilha-referência oficial).

4. **Verificar Lei 15.270**: a lei pode ser revogada, estendida ou alterada. Confirmar vigência antes de manter.

5. **Rodar "Recalcular folha" em folhas abertas** depois do deploy, pra propagar as faixas novas (snapshot só rebusca quando o Recalcular roda).

## Fatos pra conferir se mudar depois

- Teto INSS 10/2026 = R$ 8.475,55 → desconto máximo R$ 988,09.
- Dedução simplificada R$ 607,20 só vale se maior que INSS + dependentes × R$ 189,59. Pros CLTs baixos (até ~R$ 4.000 de 13º bruto) o simplificado quase sempre domina; pros altos, o INSS passa a dominar.
- Lei 15.270: isenção efetiva até R$ 5.000. Pra 13º bruto nessa faixa, IRRF é sempre 0 (mesmo que a tabela calcule algo, a redução absorve). Pra faixa 5k–7,35k, redução decresce linearmente conforme bruto sobe.
- Caroline de referência: salário R$ 3.000, 9 meses, 0 dependentes → 13º bruto R$ 2.250, INSS R$ 178,18, IRRF R$ 0, líquido R$ 2.071,82.
