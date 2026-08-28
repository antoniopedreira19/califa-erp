/**
 * Testa as funções puras de `lib/relatorios/rentabilidade.ts`.
 *
 * Sem framework de teste no projeto — segue o padrão de `scripts/conferir-save.ts`:
 * um `assert()` local, contagem de falhas, exit 1 em caso de erro.
 *
 * Rodar com: npx tsx scripts/testar-rentabilidade.ts
 */
import {
  agregarBases,
  agruparEComputar,
  classificarRentBadge,
  THRESHOLD_RENT_VERDE,
} from "../lib/relatorios/rentabilidade";
import {
  parseFiltros,
  filtrosParaQueryString,
} from "../app/(app)/relatorios/rentabilidade/parse-filtros";
import type { LinhaJobRentabilidade } from "../lib/types";

let falhas = 0;
function assert(rotulo: string, cond: boolean, extra?: string) {
  if (!cond) {
    falhas += 1;
    console.log(`  FALHA  ${rotulo}${extra ? ` — ${extra}` : ""}`);
  } else {
    console.log(`  ok     ${rotulo}`);
  }
}

const linha = (over: Partial<LinhaJobRentabilidade>): LinhaJobRentabilidade => ({
  job_id: "j1", tenant_id: "t", empresa_id: "e", regional_id: null,
  cliente_id: "c1", marca_id: null, job_codigo: "J-001", job_nome: "Job 1",
  data_abertura_financeiro: "2026-01-01",
  faturamento_previsto: 0, imposto_previsto: 0,
  faturamento_realizado: 0, imposto_realizado: 0,
  custo_realizado: 0, bv_realizado: 0,
  ...over,
});

console.log("\n=== 1. agregarBases · modo previsto ===");
{
  const r = agregarBases(
    [
      linha({ faturamento_previsto: 100000, imposto_previsto: 20000, custo_realizado: 60000, bv_realizado: 5000 }),
      linha({ faturamento_previsto: 50000, imposto_previsto: 10000, custo_realizado: 30000, bv_realizado: 2000 }),
    ],
    "previsto",
  );
  assert("faturamento soma", Math.abs(r.faturamento - 150000) < 0.01);
  assert("imposto soma", Math.abs(r.imposto - 30000) < 0.01);
  assert("custo soma", Math.abs(r.custo - 90000) < 0.01);
  assert("bv soma", Math.abs(r.bv - 7000) < 0.01);
  // Result.Op = 150000 - 30000 - (90000 - 7000) = 37000
  assert("resultOp", Math.abs((r.resultadoOperacional ?? 0) - 37000) < 0.01);
  // Rent% = 37000 / 150000 = 24,666...
  assert("rentGeral", Math.abs((r.resultadoGeral ?? 0) - 24.6667) < 0.01);
}

console.log("\n=== 2. agregarBases · modo realizado usa colunas realizadas ===");
{
  const r = agregarBases(
    [linha({ faturamento_realizado: 80000, imposto_realizado: 16000, custo_realizado: 50000, bv_realizado: 3000 })],
    "realizado",
  );
  assert("faturamento realizado", Math.abs(r.faturamento - 80000) < 0.01);
  assert("imposto realizado", Math.abs(r.imposto - 16000) < 0.01);
  // Result.Op = 80000 - 16000 - (50000 - 3000) = 17000
  assert("resultOp realizado", Math.abs((r.resultadoOperacional ?? 0) - 17000) < 0.01);
}

console.log("\n=== 3. Grupo sem custo devolve resultadoGeral null ===");
{
  const r = agregarBases([linha({ faturamento_previsto: 10000 })], "previsto");
  assert("sem custo → resultOp null", r.resultadoOperacional === null);
  assert("sem custo → resultGeral null", r.resultadoGeral === null);
}

console.log("\n=== 4. Grupo faturamento zero devolve resultadoGeral null ===");
{
  const r = agregarBases(
    [linha({ custo_realizado: 5000 })], // sem faturamento
    "previsto",
  );
  assert("fat 0 → resultGeral null", r.resultadoGeral === null);
}

console.log("\n=== 5. agruparEComputar agrupa por cliente e ordena por faturamento desc ===");
{
  const linhas = [
    linha({ job_id: "a", cliente_id: "c1", faturamento_previsto: 100, custo_realizado: 50 }),
    linha({ job_id: "b", cliente_id: "c2", faturamento_previsto: 200, custo_realizado: 100 }),
    linha({ job_id: "c", cliente_id: "c1", faturamento_previsto: 50, custo_realizado: 20 }),
  ];
  const grupos = agruparEComputar(linhas, "cliente", "previsto", (id) => `Cliente ${id}`);
  assert("2 grupos", grupos.length === 2);
  assert("primeiro é c2 (maior fat)", grupos[0].chave === "c2");
  assert("c1 tem 2 jobs", grupos.find((g) => g.chave === "c1")?.jobs.length === 2);
  assert("c1 fat total 150", Math.abs((grupos.find((g) => g.chave === "c1")?.bases.faturamento ?? 0) - 150) < 0.01);
  // Rep% de c2 = 200/350 × 100 ≈ 57,14%
  assert("rep% c2", Math.abs((grupos.find((g) => g.chave === "c2")?.representatividadePct ?? 0) - 57.14) < 0.1);
}

console.log("\n=== 6. Rent% do grupo NÃO é média dos jobs (recalcula das bases) ===");
{
  // Job A: fat 100, custo 10 → Rent 90%
  // Job B: fat 100, custo 90 → Rent 10%
  // Grupo: fat 200, custo 100 → Rent 50% (NÃO 50% média coincidente; testa via imposto)
  // Vamos usar imposto pra garantir que a diferença apareça:
  // Job A: fat 100, imp 20, custo 10, bv 0 → resOp 70, rent 70%
  // Job B: fat 100, imp 20, custo 50, bv 0 → resOp 30, rent 30%
  // Grupo: fat 200, imp 40, custo 60, bv 0 → resOp 100, rent 50%
  // Média dos rents = (70 + 30)/2 = 50% (coincide neste caso; troca:
  // Job A: fat 200, imp 40, custo 20, bv 0 → resOp 140, rent 70%
  // Job B: fat 100, imp 20, custo 50, bv 0 → resOp 30, rent 30%
  // Grupo: fat 300, imp 60, custo 70, bv 0 → resOp 170, rent 56,67%
  // Média = 50%, diferença 6,67% — teste captura.
  const linhas = [
    linha({ job_id: "a", cliente_id: "c1", faturamento_previsto: 200, imposto_previsto: 40, custo_realizado: 20 }),
    linha({ job_id: "b", cliente_id: "c1", faturamento_previsto: 100, imposto_previsto: 20, custo_realizado: 50 }),
  ];
  const grupos = agruparEComputar(linhas, "cliente", "previsto", (id) => id);
  const c1 = grupos[0];
  // Recalculado: 170 / 300 = 56,67% (não a média 50%)
  assert("rent% recalculado", Math.abs((c1.bases.resultadoGeral ?? 0) - 56.6667) < 0.01);
}

console.log("\n=== 7. Badge thresholds ===");
assert("20% ou mais é verde", classificarRentBadge(THRESHOLD_RENT_VERDE) === "verde");
assert("25% é verde", classificarRentBadge(25) === "verde");
assert("15% é laranja", classificarRentBadge(15) === "laranja");
assert("0% é laranja", classificarRentBadge(0) === "laranja");
assert("-5% é vermelho", classificarRentBadge(-5) === "vermelho");

console.log("\n=== 8. parseFiltros defaults ===");
{
  const anoAtual = new Date().getFullYear();

  const f = parseFiltros({});
  assert("ano default = corrente", f.ano === anoAtual);
  assert("trimestres vazio", f.trimestres.length === 0);
  assert("visao default = cliente", f.visao === "cliente");
  assert("modo default = previsto", f.modo === "previsto");
  assert("compararAno null", f.compararAno === null);
  assert("faturamentoMinimo null", f.faturamentoMinimo === null);
}

console.log("\n=== 9. parseFiltros lê multi-select CSV e coerce ===");
{
  const f = parseFiltros({
    ano: "2026",
    trimestre: "Q1,Q3",
    cliente: "c1,c2",
    modo: "realizado",
    visao: "marca",
    comparar: "2025",
    fatmin: "1000000",
  });
  assert("ano parsed", f.ano === 2026);
  assert("2 trimestres", f.trimestres.length === 2);
  assert("Q1 presente", f.trimestres.includes("Q1"));
  assert("2 clientes", f.clientesIds.length === 2);
  assert("modo realizado", f.modo === "realizado");
  assert("visao marca", f.visao === "marca");
  assert("compararAno 2025", f.compararAno === 2025);
  assert("faturamentoMinimo 1000000", f.faturamentoMinimo === 1000000);
}

console.log("\n=== 10. filtrosParaQueryString roundtrip ===");
{
  const original = parseFiltros({
    ano: "2026", trimestre: "Q1", cliente: "c1", modo: "realizado", visao: "job",
  });
  const qs = filtrosParaQueryString(original);
  const parsed = parseFiltros(Object.fromEntries(new URLSearchParams(qs)));
  assert("roundtrip ano", parsed.ano === original.ano);
  assert("roundtrip trimestres", parsed.trimestres.join(",") === original.trimestres.join(","));
  assert("roundtrip modo", parsed.modo === original.modo);
  assert("roundtrip visao", parsed.visao === original.visao);
}

console.log(`\n${falhas === 0 ? "OK" : "FALHOU"}: ${falhas} erro(s)`);
process.exit(falhas === 0 ? 0 : 1);
