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
    registrada_em: null,
    fornecedor: { nome: "Produtora Alfa", razao_social: null },
    pp_que_registrou: null,
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

// ---------------------------------------------------------------------------
// Decisão 182: o adiantamento conta na emissão da nota
// ---------------------------------------------------------------------------

const notaDeSaida = (id: string, emissao: string) => ({
  id,
  numero_nf: id.toUpperCase(),
  data_emissao: emissao,
  valor_total: "10000.00",
  estabelecimento_id: "ssa",
  fiscal_cnae_id: "cnae",
  emitido_em: `${emissao}T12:00:00-03:00`,
  empresa_id: "emp",
  descricao: null,
  empresa: { nome_fantasia: "Hitlab", razao_social: null },
  itens: [],
});

const recebimento = (id: string, nota: string, data: string, retido: Array<{ imposto: string; valor: string }> = []) => ({
  id,
  valor: "10000.00",
  data_movimento: data,
  titulo: { faturamento_id: nota },
  retencoes: retido,
});

test("o adiantamento conta na emissão da nota, com a retenção junto; o recebimento depois da nota fica no dia dele", () => {
  const { fatos } = montarFatos({
    cadastro: CADASTRO,
    notas: [notaDeSaida("nf1", "2026-10-05")],
    jobs: [],
    recebimentos: [
      recebimento("adiantado", "nf1", "2026-09-20", [{ imposto: "IRRF", valor: "150.00" }]),
      recebimento("depois", "nf1", "2026-11-03"),
    ],
    notasFornecedor: [],
    pagamentos: [],
    aprovacoes: [],
  });
  const porId = new Map(fatos.recebimentos.map((r) => [r.id, r]));
  assert.equal(porId.get("adiantado")?.data, "2026-10-05");
  assert.equal(porId.get("adiantado")?.adiantado_em, "2026-09-20");
  assert.equal(porId.get("adiantado")?.bruto, 10150);
  assert.equal(porId.get("adiantado")?.retido.IRRF, 150);
  assert.equal(porId.get("depois")?.data, "2026-11-03");
  assert.equal(porId.get("depois")?.adiantado_em, undefined);
});

test("a NF da prestação da verba entra pela verba que a registrou, sem os pagamentos dela (decisão 189)", () => {
  const verba = { ...pp("v", "PP-00300", "pago"), verba_producao: true };
  const [n] = montar(
    [
      nota({
        id: "nv",
        valor: "1180.00",
        registrada_na_pp_id: "v",
        registrada_em: "2026-10-19T15:00:00Z",
        pp_que_registrou: verba,
        anexos: [],
      }),
    ],
    [{ id: "pg", valor: "3000.00", data_movimento: "2026-10-14", pedido_compra_id: "v", retencoes: [] }],
  );
  assert.ok(n, "a nota da verba entra na apuração");
  assert.equal(n.valor, 1180);
  assert.equal(n.pp, "PP-00300");
  assert.deepEqual(n.pp_ids, ["v"]);
  assert.equal(n.pagamentos.length, 0);
});

test("a nota registrada por PP que não é verba, sem anexo que conte, continua fora", () => {
  const normal = { ...pp("x", "PP-00301", "pago"), verba_producao: false };
  const notas = montar([
    nota({ id: "nx", registrada_na_pp_id: "x", pp_que_registrou: normal, anexos: [] }),
  ]);
  assert.equal(notas.length, 0);
});
