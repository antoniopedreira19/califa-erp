/**
 * Confere o fechamento com SAVE contra as duas fontes que o definem:
 *
 *  1. o design `Orcamento - Versao com Save.dc.html` (projeto Claude Design
 *     `69342d83`), que traz a planilha da Vega Alimentos fechada;
 *  2. a decisão `docs/decisions/023-save-entre-jobs.md`, com o par Job A /
 *     Job B e a invariante das duas somas iguais.
 *
 * Roda com `npx tsx scripts/conferir-save.ts`. Sem infraestrutura de teste
 * no projeto, é este script que sustenta a conta — a decisão 023 diz que a
 * invariante "soma dos faturamentos = soma dos valores de job" é testável,
 * e é aqui que ela é testada.
 */
import { blocosDoItem, somarBlocosDosItens } from "../lib/calculos/bv-planilha";
import {
  calcularTotaisVersao,
  calcularEfeitoDaMudanca,
  receitaDeFaturamentoDaLinha,
  receitaSaveMigrada,
  type ItemParaTotais,
} from "../lib/calculos/versao-totais";

let falhas = 0;

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Tolerância de 2 centavos: o design arredonda o gross-up para baixo em
 *  alguns campos, e a diferença não é erro de conta. */
function conferir(rotulo: string, obtido: number, esperado: number, tol = 0.02) {
  const ok = Math.abs(obtido - esperado) <= tol;
  if (!ok) falhas += 1;
  const delta = obtido - esperado;
  console.log(
    `  ${ok ? "ok  " : "FALHA"} ${rotulo.padEnd(38)} ${brl(obtido).padStart(13)}` +
      (ok ? "" : `   esperado ${brl(esperado)} (delta ${brl(delta)})`),
  );
}

// ---------------------------------------------------------------- design
console.log("\n=== 1. Design: Vega Alimentos · honorários 12% · imposto 19,53% ===");

const VEGA: ItemParaTotais[] = [
  { tipo_custo: "A", total_orcado: 6000 },                        // Consultoria de marca
  { tipo_custo: "B", total_orcado: 10000 },                       // Direção de arte
  { tipo_custo: "B", total_orcado: 20000, save_consumido: 20000 },// Produção de vídeo
  { tipo_custo: "B", total_orcado: 12000, em_save: true },        // Pós-produção
  { tipo_custo: "B", total_orcado: 6000, em_save: true },         // Trilha sonora
];

const v = calcularTotaisVersao(VEGA, 12, 19.53);

conferir("Total dos custos", v.subtotalGeral, 54000);
conferir("Save usado (B)", v.save.saveUsado.B, 20000);
conferir("Save gerado (B)", v.save.saveGerado.B, 18000);
conferir("Custos do job (B)", v.save.custosDoJob.B, 10000);
conferir("Custos do job (A)", v.save.custosDoJob.A, 6000);
conferir("Total save usado", v.save.totalSaveUsado, 20000);
conferir("Total save gerado", v.save.totalSaveGerado, 18000);
conferir("Total custos do job", v.save.totalCustosDoJob, 16000);
conferir("Orçado p/ rentabilidade", v.orcadoParaRentabilidade, 36000);
// A receita do save tem que ser a MESMA que `receitaDeFaturamentoDaLinha`
// daria somando as duas linhas em save (12.000 + 6.000, tipo B, 12%/19,53%).
conferir(
  "Receita do save (as duas linhas)",
  v.save.receita,
  receitaDeFaturamentoDaLinha(12000, "B", 12, 19.53) +
    receitaDeFaturamentoDaLinha(6000, "B", 12, 19.53),
);
// E o faturamento previsto tem que ser EXATAMENTE a receita do save mais
// o fechamento sobre os custos do job sozinhos — é a invariante que
// permite materializar a receita do save em `jobs` sem ela divergir.
const soCustos = calcularTotaisVersao(
  [
    { tipo_custo: "A", total_orcado: 6000 },
    { tipo_custo: "B", total_orcado: 10000 },
  ],
  12,
  19.53,
);
conferir(
  "Faturamento = receita do save + custos do job",
  v.save.receita + soCustos.faturamentoPrevisto,
  v.faturamentoPrevisto,
  0.005,
);
conferir("Honorários (faturamento)", v.faturamento.honorarios, 4080);
conferir("Impostos (faturamento)", v.faturamento.imposto, 7785.78);
conferir("Faturamento previsto", v.faturamentoPrevisto, 39865.78);
conferir("Honorários (valor do job)", v.job.honorarios, 4320);
conferir("Impostos (valor do job)", v.job.imposto, 8329.43);
conferir("Valor do Job", v.valorJob, 48649.43);

// Resultado do painel: 48.649,43 − 8.329,43 − 30.000 = 10.320,00
conferir("Resultado operacional", v.valorJob - v.imposto - 30000, 10320);

// A linha consumidora entra no valor do job por 27.836,46 (pop-up).
conferir(
  "Linha consumidora no valor do job",
  receitaDeFaturamentoDaLinha(20000, "B", 12, 19.53),
  27836.46,
);

console.log(
  `  ${v.save.itensEmSave} linhas geram save · ${v.save.itensConsumindoSave} consomem` +
    `  (design: 3 linhas com save)`,
);
if (v.save.itensEmSave + v.save.itensConsumindoSave !== 3) falhas += 1;

// -------------------------------------------------------------- decisão
console.log("\n=== 2. Decisão 023: Job A / Job B · honorários 10% · imposto 19,53% ===");

const A = calcularTotaisVersao(
  [
    { tipo_custo: "B", total_orcado: 50000 },
    { tipo_custo: "B", total_orcado: 30000, em_save: true },
  ],
  10,
  19.53,
);
const B = calcularTotaisVersao(
  [
    { tipo_custo: "B", total_orcado: 15000 },
    { tipo_custo: "B", total_orcado: 30000, save_consumido: 30000 },
  ],
  10,
  19.53,
);

conferir("Job A · faturamento previsto", A.faturamentoPrevisto, 109357.52);
conferir("Job A · valor do job", A.valorJob, 68348.45);
conferir("Job A · saldo em save", A.save.totalSaveGerado, 30000);
conferir("Job B · faturamento previsto", B.faturamentoPrevisto, 20504.54);
conferir("Job B · valor do job", B.valorJob, 61513.61);

const somaFat = A.faturamentoPrevisto + B.faturamentoPrevisto;
const somaJob = A.valorJob + B.valorJob;
console.log(`\n  soma faturamento  ${brl(somaFat).padStart(13)}`);
console.log(`  soma valor do job ${brl(somaJob).padStart(13)}`);
const invariante = Math.abs(somaFat - somaJob) < 0.005;
console.log(`  ${invariante ? "ok   " : "FALHA"} A INVARIANTE: as duas somas são iguais`);
if (!invariante) falhas += 1;

// -------------------------------------------------------- compatibilidade
console.log("\n=== 3. Compatibilidade: sem nenhuma linha em save ===");

const SEM_SAVE: ItemParaTotais[] = [
  { tipo_custo: "B", total_orcado: 50000 },
  { tipo_custo: "AR", total_orcado: 12345.67 },
  { tipo_custo: "A", total_orcado: 9000 },
  { tipo_custo: "C", total_orcado: 4200 },
  { tipo_custo: "D", total_orcado: 1500 },
  { tipo_custo: "F", total_orcado: 800 },
  { tipo_custo: "FI", total_orcado: 333.33 },
];
const s = calcularTotaisVersao(SEM_SAVE, 10, 19.53);

conferir("honorários faturamento = job", s.faturamento.honorarios, s.job.honorarios, 0);
conferir("imposto faturamento = job", s.faturamento.imposto, s.job.imposto, 0);
conferir("valor do job = bruto", s.valorJob, s.bruto.total, 0);
conferir("orçado p/ rentab. = subtotal", s.orcadoParaRentabilidade, s.subtotalGeral, 0);
console.log(`  faturamento previsto ${brl(s.faturamentoPrevisto)} · valor do job ${brl(s.valorJob)}`);

// ------------------------------------------------------------- extremos
console.log("\n=== 4. Extremos ===");

const tudoSave = calcularTotaisVersao(
  [
    { tipo_custo: "B", total_orcado: 40000, em_save: true },
    { tipo_custo: "AR", total_orcado: 10000, em_save: true },
  ],
  10,
  19.53,
);
conferir("Orçamento de save · valor do job", tudoSave.valorJob, 0, 0);
console.log(`  ...e fatura ${brl(tudoSave.faturamentoPrevisto)} · bruto ${brl(tudoSave.bruto.total)}`);
if (!(tudoSave.faturamentoPrevisto > 0)) falhas += 1;
if (!(tudoSave.bruto.total > 0)) falhas += 1;

const tudoConsumido = calcularTotaisVersao(
  [{ tipo_custo: "B", total_orcado: 40000, save_consumido: 40000 }],
  10,
  19.53,
);
conferir("Job 100% pago por save · faturamento", tudoConsumido.faturamentoPrevisto, 0, 0);
console.log(`  ...e vale ${brl(tudoConsumido.valorJob)} de job`);

// Consumo PARCIAL (decisão 023 §6, confirmada em 24/08/2026): item de
// 40.000 puxando 30.000 -> 10.000 seguem faturados.
const parcial = calcularTotaisVersao(
  [{ tipo_custo: "B", total_orcado: 40000, save_consumido: 30000 }],
  10,
  19.53,
);
conferir("Consumo parcial · base faturável", parcial.faturamento.base, 10000, 0);
conferir("Consumo parcial · base do job", parcial.job.base, 40000, 0);

// ------------------------------------------------------- receita do save
console.log("\n=== 5. Receita da linha e rateio ===");
const rB = receitaDeFaturamentoDaLinha(30000, "B", 10, 19.53);
const rA = receitaDeFaturamentoDaLinha(30000, "A", 10, 19.53);
conferir("Receita da linha · tipo B", rB, 41009.07);
conferir("Receita da linha · tipo A", rA, 3728.1);
conferir("Rateio 25.000/30.000", receitaSaveMigrada(rB, 30000, 25000), 34174.23);
conferir("Rateio consumo cheio", receitaSaveMigrada(rB, 30000, 30000), rB, 0);

// ------------------------------------------------ linearidade da errata
console.log("\n=== 6. A soma dos efeitos por item fecha com o total ===");
const efeitos = VEGA.reduce(
  (acc, it) => {
    const e = calcularEfeitoDaMudanca(
      { total: 0, tipoCusto: it.tipo_custo },
      {
        total: Number(it.total_orcado ?? 0),
        tipoCusto: it.tipo_custo,
        emSave: it.em_save === true,
        saveConsumido: Number(it.save_consumido ?? 0),
      },
      12,
      19.53,
    );
    return {
      fat: acc.fat + e.faturamentoPrevisto,
      job: acc.job + e.valorJob,
    };
  },
  { fat: 0, job: 0 },
);
conferir("Σ efeitos = faturamento previsto", efeitos.fat, v.faturamentoPrevisto, 0.005);
conferir("Σ efeitos = valor do job", efeitos.job, v.valorJob, 0.005);

// ------------------------------------------------- rentabilidade
console.log("\n=== 7. Rentabilidade: gera sai, consome entra ===");

// Mesma assimetria do valor do job (decisão 023 §9): a linha que GERA
// save é venda sem execução e não tem custo com que comparar; a que
// CONSOME acontece aqui, tem custo, e entra na conta normalmente.
const blocos = [
  // normal: 10.000 orçado, 8.000 planejado
  blocosDoItem(
    { tipo_custo: "B", total_orcado: 10000, total_planejado: 8000 },
    null,
    0,
    19.53,
  ),
  // GERA save: 30.000 orçado, planejado zerado pelo trigger
  blocosDoItem(
    { tipo_custo: "B", total_orcado: 30000, total_planejado: 0, em_save: true },
    null,
    0,
    19.53,
  ),
  // CONSOME save: 20.000 orçado, 16.000 planejado — linha normal para a
  // rentabilidade, porque o serviço acontece aqui.
  blocosDoItem(
    { tipo_custo: "B", total_orcado: 20000, total_planejado: 16000 },
    null,
    0,
    19.53,
  ),
];
const soma = somarBlocosDosItens(blocos);

conferir("Coluna ORÇADO segue cheia", soma.orcado, 60000, 0);
conferir("Base da rentabilidade sem o save", soma.orcadoRentabilidade, 30000, 0);
conferir("Custo planejado", soma.planejado.bruto, 24000, 0);
conferir(
  "Rentabilidade = 30.000 − 24.000",
  soma.orcadoRentabilidade - soma.planejado.bruto,
  6000,
  0,
);
console.log(
  `  a linha que gera save sai (30.000 fora da base) e a que consome entra (20.000 dentro)`,
);

console.log(
  falhas === 0
    ? "\n✓ Todas as conferências passaram.\n"
    : `\n✗ ${falhas} conferência(s) falharam.\n`,
);
process.exit(falhas === 0 ? 0 : 1);
