/**
 * Testes da montagem do pedido de aprovação (Apuração, entrega 2). Rodar:
 * node --import tsx --test "app/(app)/financeiro/fiscal/apuracao/aprovacao.test.ts"
 *
 * O que importa: as cotas do IRPJ/CSLL saem do VALOR DA GUIA (não do
 * calculado), a soma dos principais fecha com a guia, cada rateio fecha com
 * o valor do seu título, e o que vem do cliente se limita às decisões dele.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { FiscalEstabelecimento } from "@/lib/types";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { cotasDe, type Guia, type RateioDaGuia } from "@/lib/fiscal/apuracao";
import { r2 } from "@/lib/fiscal/datas";
import {
  apuradoSemCompensacao,
  calculadoParaAGuia,
  montarPedidoDeAprovacao,
  type EntradaDaAprovacao,
  type PedidoDeAprovacao,
} from "./aprovacao";

const EM = "2026-10-02T12:00:00Z";
const MATRIZ: FiscalEstabelecimento = {
  id: "ca-ssa",
  tenant_id: "t",
  empresa_contabil_id: "california",
  nome: "California · Salvador",
  cnpj: "19437976000154",
  papel: "matriz",
  municipio: "Salvador",
  uf: "BA",
  iss_dia: 5,
  iss_retido_dia: 5,
  iss_regra: "prorroga",
  ativo: true,
  ordem: 1,
  observacao: null,
  created_at: EM,
  updated_at: EM,
};
const CAD: CadastroFiscal = { regimes: [], estabelecimentos: [MATRIZ], cnaes: [], feriados: [], parametros: [], receitasAnteriores: [] };

/** Três partes desiguais: o arredondamento tem de fechar na última. */
const RATEIO: RateioDaGuia[] = [
  { empresa_id: "emp-a", empresa_nome: "A", regional_id: "reg-a1", regional_nome: "A1", valor: 3333.33, pct: 33.33 },
  { empresa_id: "emp-a", empresa_nome: "A", regional_id: "reg-a2", regional_nome: "A2", valor: 3333.33, pct: 33.33 },
  { empresa_id: "emp-b", empresa_nome: "B", regional_id: null, regional_nome: null, valor: 3333.34, pct: 33.34 },
];

const guiaIrpj = (apurado: number): Guia => ({
  chave: "irpj|california|2026-T4",
  tributo: "IRPJ",
  titulo: "IRPJ",
  codigo: "2362",
  empresa_contabil_id: "california",
  estabelecimento_id: null,
  local: "Federal · California",
  competencia: "2026-T4",
  rotulo_competencia: "4º trimestre/2026",
  periodo: "trimestral",
  vencimento: "2027-01-29",
  vencimento_motivo: null,
  regra_vencimento: "último dia útil do mês seguinte ao trimestre",
  memoria: [
    { grupo: "base", rotulo: "Faturamento do trimestre", valor: 100000 },
    { grupo: "debito", rotulo: "IRPJ 15%", valor: apurado },
  ],
  apurado,
  saldo_credor_gerado: 0,
  base: 100000,
  rateio: RATEIO,
  avisos: [],
  cotas: cotasDe(apurado, "2026-T4", "Salvador", CAD),
});

const guiaIss = (): Guia => ({
  chave: "iss|ca-ssa|2026-11",
  tributo: "ISS",
  titulo: "ISS próprio",
  codigo: null,
  empresa_contabil_id: "california",
  estabelecimento_id: "ca-ssa",
  local: "Salvador-BA",
  competencia: "2026-11",
  rotulo_competencia: "novembro/2026",
  periodo: "mensal",
  vencimento: "2026-12-07",
  vencimento_motivo: null,
  regra_vencimento: "dia 5 do mês seguinte",
  memoria: [
    { grupo: "debito", rotulo: "NF 10", base: 20000, aliquota: 5, valor: 1000 },
    { grupo: "compensacao", rotulo: "ISS a compensar · NF 7", valor: -150 },
  ],
  apurado: 850,
  saldo_credor_gerado: 0,
  base: 20000,
  rateio: RATEIO.map((r) => ({ ...r, valor: r2((850 * r.pct) / 100) })),
  avisos: [],
  compensacoes: [
    {
      id: "rec-1",
      estabelecimento_id: "ca-ssa",
      nota_id: "n7",
      recebimento_id: "1",
      data: "2026-11-10",
      valor: 150,
      competencia_nota: "2026-10",
      forma: "compensar",
    },
  ],
});

const entrada = (e: Partial<EntradaDaAprovacao>): EntradaDaAprovacao => ({
  valor_guia: 0,
  justificativa: "",
  usar_compensacao: true,
  cota_unica: false,
  juros_pct: null,
  ...e,
});

function montar(g: Guia, e: Partial<EntradaDaAprovacao>, estado: "a_aprovar" | "diferenca" = "a_aprovar", delta = 0): PedidoDeAprovacao {
  const r = montarPedidoDeAprovacao({
    guia: g,
    estado,
    delta,
    aprovacao: estado === "diferenca" ? { data: "2026-11-04", valor_guia: r2(g.apurado - delta) } : null,
    entrada: entrada(e),
    cadastro: CAD,
    hoje: "2027-01-05",
    cidadeDaMatriz: "Salvador",
  });
  if (!r.ok) throw new Error(r.message);
  return r.pedido;
}

/** As duas travas de `aprovar_guia_fiscal`, conferidas no pedido. */
function conferirTravas(p: PedidoDeAprovacao) {
  const principal = r2(p.p_titulos.reduce((s, t) => s + t.principal, 0));
  assert.equal(principal, p.p_valor_guia, "a soma dos principais fecha com o valor da guia");
  for (const t of p.p_titulos) {
    assert.equal(r2(t.principal + t.juros), t.valor, "valor = principal + juros");
    assert.equal(r2(t.rateio.reduce((s, x) => s + x.valor, 0)), t.valor, "o rateio fecha com o valor do título");
    assert.ok(t.rateio.every((x) => x.valor > 0), "nenhuma parte do rateio zerada");
  }
}

describe("IRPJ/CSLL: cotas sobre o valor da guia", () => {
  test("guia diferente do calculado: as cotas saem do valor da guia, com justificativa", () => {
    const g = guiaIrpj(9000);
    const p = montar(g, { valor_guia: 6000.01, justificativa: "A contabilidade incluiu o rendimento de aplicação." });
    assert.equal(p.p_valor_calculado, 9000);
    assert.equal(p.p_valor_guia, 6000.01);
    assert.deepEqual(
      p.p_titulos.map((t) => t.principal),
      cotasDe(6000.01, "2026-T4", "Salvador", CAD).map((c) => c.principal),
    );
    assert.equal(p.p_titulos.length, 3);
    assert.deepEqual(p.p_titulos.map((t) => t.cota_numero), [1, 2, 3]);
    assert.ok(p.p_titulos.every((t) => t.cota_total === 3));
    assert.equal(p.p_cotas?.length, 3);
    conferirTravas(p);
  });

  test("os juros ajustados na 2ª e 3ª cotas entram no título; a 1ª fica sem juros", () => {
    const p = montar(guiaIrpj(9000), { valor_guia: 9000, juros_pct: [5, 1, 2.35] });
    assert.deepEqual(p.p_titulos.map((t) => t.juros_pct), [0, 1, 2.35]);
    assert.equal(p.p_titulos[2].juros, r2((3000 * 2.35) / 100));
    assert.equal(p.p_titulos[0].juros, 0);
    conferirTravas(p);
  });

  test("guia abaixo de R$ 2.000 vira cota única, mesmo com o calculado em três", () => {
    const p = montar(guiaIrpj(9000), { valor_guia: 1500, justificativa: "Prejuízo compensado pela contabilidade." });
    assert.equal(p.p_titulos.length, 1);
    assert.equal(p.p_titulos[0].principal, 1500);
    assert.equal(p.p_titulos[0].juros, 0);
    conferirTravas(p);
  });

  test("cota única: o valor inteiro no 1º vencimento, sem juros", () => {
    const g = guiaIrpj(9000);
    const p = montar(g, { valor_guia: 9000, cota_unica: true, juros_pct: [0, 1, 2.1] });
    assert.equal(p.p_titulos.length, 1);
    assert.equal(p.p_titulos[0].principal, 9000);
    assert.equal(p.p_titulos[0].valor, 9000);
    assert.equal(p.p_titulos[0].vencimento, g.cotas![0].vencimento);
    assert.equal(p.p_titulos[0].cota_total, 1);
    conferirTravas(p);
  });

  test("guia zerada: confirma sem título e sem cair nas cotas do calculado", () => {
    const p = montar(guiaIrpj(9000), { valor_guia: 0, justificativa: "Prejuízo fiscal acumulado zera o trimestre." });
    assert.equal(p.p_titulos.length, 0);
    assert.deepEqual(p.p_cotas, []);
  });

  test("juros fora de 0% a 100% são recusados", () => {
    const r = montarPedidoDeAprovacao({
      guia: guiaIrpj(9000),
      estado: "a_aprovar",
      delta: 0,
      entrada: entrada({ valor_guia: 9000, juros_pct: [0, -1, 2] }),
      cadastro: CAD,
      hoje: "2027-01-05",
      cidadeDaMatriz: "Salvador",
    });
    assert.equal(r.ok, false);
  });
});

describe("Rateio e justificativa", () => {
  test("valor quebrado: cada rateio fecha com o seu título", () => {
    const p = montar(guiaIrpj(7777.77), { valor_guia: 7777.77 });
    assert.equal(p.p_justificativa, null);
    conferirTravas(p);
  });

  test("guia diferente do calculado sem justificativa (ou curta) é recusada", () => {
    for (const justificativa of ["", "curta"]) {
      const r = montarPedidoDeAprovacao({
        guia: guiaIrpj(9000),
        estado: "a_aprovar",
        delta: 0,
        entrada: entrada({ valor_guia: 8000, justificativa }),
        cadastro: CAD,
        hoje: "2027-01-05",
        cidadeDaMatriz: "Salvador",
      });
      assert.equal(r.ok, false);
    }
  });

  test("em curso e aprovada não se aprovam", () => {
    for (const estado of ["em_curso", "aprovada"] as const) {
      const r = montarPedidoDeAprovacao({
        guia: guiaIrpj(9000),
        estado,
        delta: 0,
        entrada: entrada({ valor_guia: 9000 }),
        cadastro: CAD,
        hoje: "2027-01-05",
        cidadeDaMatriz: "Salvador",
      });
      assert.equal(r.ok, false);
    }
  });
});

describe("ISS: compensação do ISS a recuperar", () => {
  test("compensando: vale o apurado e a compensação vai junto", () => {
    const g = guiaIss();
    const p = montar(g, { valor_guia: 850, usar_compensacao: true });
    assert.equal(p.p_valor_calculado, 850);
    assert.deepEqual(p.p_compensacoes, ["rec-1"]);
    assert.equal(p.p_titulos.length, 1);
    assert.equal(p.p_titulos[0].vencimento, g.vencimento);
    conferirTravas(p);
  });

  test("sem compensar: a guia volta ao valor cheio, e a memória sai sem a compensação", () => {
    const g = guiaIss();
    assert.equal(apuradoSemCompensacao(g), 1000);
    assert.equal(calculadoParaAGuia(g, "a_aprovar", 0, false), 1000);
    const p = montar(g, { valor_guia: 1000, usar_compensacao: false });
    assert.equal(p.p_valor_calculado, 1000);
    assert.equal(p.p_justificativa, null);
    assert.deepEqual(p.p_compensacoes, []);
    assert.ok(p.p_memoria.every((m) => m.grupo !== "compensacao"));
    conferirTravas(p);
  });
});

describe("Diferença: o complementar", () => {
  test("cálculo subiu: um título complementar com o que mudou; guarda o apurado inteiro", () => {
    const g = guiaIss();
    // Aprovada antes por 600; hoje o apurado é 850.
    const p = montar(g, { valor_guia: 250 }, "diferenca", 250);
    assert.equal(p.p_diferenca, true);
    assert.equal(p.p_valor_calculado, 850);
    assert.equal(p.p_valor_guia, 250);
    assert.equal(p.p_titulos.length, 1);
    // A complementar vence na data legal da guia original (decisão 145), não 5 dias depois da aprovação.
    assert.equal(p.p_titulos[0].vencimento, g.vencimento);
    assert.equal(p.p_titulos[0].vencimento, "2026-12-07");
    assert.match(p.p_titulos[0].descricao, /complementar/);
    // A trava do banco compara guia com calculado: o texto explica a origem.
    assert.ok((p.p_justificativa ?? "").length >= 10);
    assert.deepEqual(p.p_compensacoes, []);
    conferirTravas(p);
  });

  test("cálculo caiu: registra o saldo, sem título", () => {
    const p = montar(guiaIss(), { valor_guia: 0 }, "diferenca", -100);
    assert.equal(p.p_titulos.length, 0);
    assert.equal(p.p_valor_guia, 0);
    assert.ok((p.p_justificativa ?? "").startsWith("Saldo a compensar"));
  });

  test("complementar diferente do que mudou exige a justificativa da pessoa", () => {
    const r = montarPedidoDeAprovacao({
      guia: guiaIss(),
      estado: "diferenca",
      delta: 250,
      aprovacao: { data: "2026-11-04", valor_guia: 600 },
      entrada: entrada({ valor_guia: 300 }),
      cadastro: CAD,
      hoje: "2027-01-05",
      cidadeDaMatriz: "Salvador",
    });
    assert.equal(r.ok, false);
  });

  test("IRPJ na diferença: um título só, sem cotas", () => {
    const p = montar(guiaIrpj(9000), { valor_guia: 1200 }, "diferenca", 1200);
    assert.equal(p.p_cotas, null);
    assert.equal(p.p_titulos.length, 1);
    assert.equal(p.p_titulos[0].cota_numero, null);
    conferirTravas(p);
  });
});
