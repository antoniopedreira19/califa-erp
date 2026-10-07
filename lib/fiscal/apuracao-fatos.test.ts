/**
 * Testes da montagem das NFs de fornecedor para a Apuração (decisão 152,
 * 07/10/2026): a nota é do cadastro, conta UMA vez pelo total mesmo
 * cobrindo mais de uma PP, e os pagamentos de cada PP vão na primeira nota
 * dela, com o código e o job da PP que pagou.
 * Rodar: node --import tsx --test lib/fiscal/apuracao-fatos.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { montarFatos } from "./apuracao-fatos";

type Entrada = Parameters<typeof montarFatos>[0];
type NotaDoBanco = Entrada["notasFornecedor"][number];

const CADASTRO: Entrada["cadastro"] = {
  regimes: [],
  estabelecimentos: [],
  cnaes: [],
  feriados: [],
  parametros: [],
  receitasAnteriores: [],
};

const job = (id: string) => ({
  id,
  codigo: id.toUpperCase(),
  nome: `Job ${id}`,
  empresa_id: "emp",
  regional_id: null,
  empresa: { nome_fantasia: "California", razao_social: null },
  regional: null,
});

const pp = (id: string, codigo: string, status: string, j = "j1") => ({ id, codigo, status, job: job(j) });

function nota(parcial: Partial<NotaDoBanco> & Pick<NotaDoBanco, "id" | "anexos">): NotaDoBanco {
  return {
    numero: parcial.id.toUpperCase(),
    data_emissao: "2026-10-05",
    valor: "10000.00",
    tomador_estabelecimento_id: "ssa",
    iss_retido_aliquota: null,
    credito_pis_cofins_retirado: false,
    credito_pis_cofins_motivo: null,
    registrada_na_pp_id: null,
    fornecedor: { nome: "Produtora Alfa", razao_social: null },
    ...parcial,
  };
}

const montar = (notasFornecedor: NotaDoBanco[], pagamentos: Entrada["pagamentos"] = []) =>
  montarFatos({
    cadastro: CADASTRO,
    notas: [],
    jobs: [],
    recebimentos: [],
    notasFornecedor,
    pagamentos,
    aprovacoes: [],
  }).fatos.notasFornecedor;

test("a nota que cobre duas PPs conta uma vez, pelo total, com o ISS retido guardado nela", () => {
  const [n] = montar([
    nota({
      id: "n1",
      iss_retido_aliquota: "5.0000",
      registrada_na_pp_id: "a",
      anexos: [
        { created_at: "2026-10-05T10:00:00Z", pp: pp("a", "PP-00139", "aprovada") },
        { created_at: "2026-10-09T10:00:00Z", pp: pp("b", "PP-00140", "pago", "j2") },
      ],
    }),
  ]);
  assert.equal(n.id, "n1");
  assert.equal(n.valor, 10000);
  assert.equal(n.pp, "PP-00139, PP-00140");
  assert.deepEqual(n.pp_ids, ["a", "b"]);
  assert.deepEqual(n.aliquotas_aprovacao, { ISS: 5 });
  // O job é o da PP que registrou a nota.
  assert.equal(n.job.job_id, "j1");
});

test("só conta a nota com ao menos uma PP aprovada ou paga", () => {
  const notas = montar([
    nota({ id: "em-avaliacao", anexos: [{ created_at: "2026-10-05T10:00:00Z", pp: pp("a", "PP-1", "em_avaliacao") }] }),
    nota({ id: "cancelada", anexos: [{ created_at: "2026-10-05T10:00:00Z", pp: pp("b", "PP-2", "cancelada") }] }),
    nota({
      id: "reprovada-e-outra",
      registrada_na_pp_id: "c",
      anexos: [
        { created_at: "2026-10-05T10:00:00Z", pp: pp("c", "PP-3", "rejeitada") },
        { created_at: "2026-10-06T10:00:00Z", pp: pp("d", "PP-4", "aprovada", "j9") },
      ],
    }),
  ]);
  assert.deepEqual(notas.map((n) => n.id), ["reprovada-e-outra"]);
  // A PP que registrou foi reprovada: o job passa a ser o da que conta.
  assert.equal(notas[0].pp, "PP-4");
  assert.equal(notas[0].job.job_id, "j9");
});

test("os pagamentos de cada PP vão na primeira nota dela, com o código e o job da PP", () => {
  const notas = montar(
    [
      // A PP "a" tem duas notas: a n1 (anexada antes) leva os pagamentos.
      nota({
        id: "n1",
        anexos: [{ created_at: "2026-10-05T10:00:00Z", pp: pp("a", "PP-00139", "pago") }],
      }),
      nota({
        id: "n2",
        anexos: [
          { created_at: "2026-10-05T11:00:00Z", pp: pp("a", "PP-00139", "pago") },
          // A n2 também cobre a PP "b", de outro job, e é a primeira dela.
          { created_at: "2026-10-09T10:00:00Z", pp: pp("b", "PP-00140", "aprovada", "j2") },
        ],
      }),
    ],
    [
      { id: "pg-a", valor: "9000", data_movimento: "2026-11-10", pedido_compra_id: "a", retencoes: [{ imposto: "IRRF", valor: "150" }] },
      { id: "pg-b", valor: "3900", data_movimento: "2026-11-20", pedido_compra_id: "b", retencoes: [{ imposto: "PIS", valor: "26" }] },
    ],
  );
  const n1 = notas.find((n) => n.id === "n1")!;
  const n2 = notas.find((n) => n.id === "n2")!;
  assert.deepEqual(n1.pagamentos.map((p) => [p.id, p.pp, p.job?.job_id, p.bruto]), [["pg-a", "PP-00139", "j1", 9150]]);
  assert.deepEqual(n2.pagamentos.map((p) => [p.id, p.pp, p.job?.job_id, p.bruto]), [["pg-b", "PP-00140", "j2", 3926]]);
});
