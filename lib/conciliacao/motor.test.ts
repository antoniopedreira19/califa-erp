/**
 * Testes do motor de correspondência (decisão 199): o porte bate com o
 * `casar` do protótipo aprovado, linha a linha, sobre os mesmos dados, e com
 * a contagem da especificação (seção 8, Fase 3).
 *
 * Rode com:  node --import tsx --test lib/conciliacao/motor.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { lerOfx } from "./ofx";
import {
  casar,
  correcaoDaBaixa,
  ehCerto,
  gruposDeIguais,
  type LancamentoDoMotor,
  type LoteDoMotor,
  type RegraDoMotor,
  type ResultadoDoMotor,
  type TituloDoMotor,
} from "./motor";

const PASTA = "../../docs/handoffs/2026-10-21-conciliacao-com-o-banco/prototipo/src";

type Prototipo = {
  TITULOS_INICIAIS: TituloDoMotor[];
  LANCAMENTOS_INICIAIS: Array<LancamentoDoMotor & { conciliado?: boolean }>;
  LOTES: LoteDoMotor[];
  REGRAS: RegraDoMotor[];
  ofxDeExemplo: (horario: string) => string;
};
type CasarDoPrototipo = (
  movimentos: unknown[],
  sistema: unknown,
  opcoes: { recomendada: boolean },
) => Array<{ estado: string; confianca?: string; titulo?: { id: string } | null; titulos?: Array<{ id: string }>; lote?: { id: string } }>;

async function cenario() {
  const dados = (await import(`${PASTA}/data.js`)) as Prototipo;
  const proto = (await import(`${PASTA}/ofx.js`)) as { casar: CasarDoPrototipo };
  const ofx = lerOfx(dados.ofxDeExemplo("091923").replace("__SALDO__", "0"));
  const sistema = {
    titulos: dados.TITULOS_INICIAIS,
    lancamentos: dados.LANCAMENTOS_INICIAIS.filter((l) => !l.conciliado),
    lotes: dados.LOTES,
    regras: dados.REGRAS,
    deslocamento: 0,
  };
  return { ofx, sistema, protoCasar: proto.casar };
}

const contagem = (res: Array<{ estado: string; confianca?: string }>) => {
  const c: Record<string, number> = {};
  res.forEach((r) => {
    const k = r.estado + (r.confianca ? `:${r.confianca}` : "");
    c[k] = (c[k] ?? 0) + 1;
  });
  return c;
};

test("a contagem da especificação, com os dados do protótipo", async () => {
  const { ofx, sistema } = await cenario();
  const res = casar(ofx.movimentos, sistema);
  assert.deepEqual(contagem(res), {
    "regra:alta": 5,
    "sugestao:alta": 40,
    "diferenca:media": 2,
    "combinacao:alta": 2,
    "par:alta": 2,
    "divergencia:media": 1,
    sem_par: 1,
    "sugestao:media": 3,
    "ja_lancado:alta": 1,
    "soma:alta": 1,
  });
});

test("linha a linha, o mesmo resultado do protótipo", async () => {
  const { ofx, sistema, protoCasar } = await cenario();
  const nosso = casar(ofx.movimentos, sistema);
  const dele = protoCasar(ofx.movimentos, sistema, { recomendada: true });
  assert.equal(nosso.length, dele.length);
  nosso.forEach((r, i) => {
    const p = dele[i];
    assert.equal(r.estado, p.estado, `linha ${i}`);
    assert.equal(r.confianca, p.confianca, `linha ${i}`);
    assert.equal(r.titulo?.id ?? null, p.titulo?.id ?? null, `linha ${i}`);
    assert.deepEqual((r.titulos ?? []).map((t) => t.id), (p.titulos ?? []).map((t) => t.id), `linha ${i}`);
    assert.equal(r.lote?.id ?? null, p.lote?.id ?? null, `linha ${i}`);
  });
});

test("as combinações: NF 1196 + NF 1197 e PP-00162 + PP-00163", async () => {
  const { ofx, sistema } = await cenario();
  const comb = casar(ofx.movimentos, sistema).filter((r) => r.estado === "combinacao");
  assert.deepEqual(
    comb.map((r) => (r.titulos ?? []).map((t) => t.ref).join("+")).sort(),
    ["NF 1196+NF 1197", "PP-00162+PP-00163"],
  );
});

// --- Casos pequenos -----------------------------------------------------------

const titulo = (id: string, liquido: number, extra: Partial<TituloDoMotor> = {}): TituloDoMotor => ({
  id,
  lado: "pagar",
  origem: "pp",
  ref: id,
  contraparte: "FORNECEDOR 001 EXEMPLO",
  vencimento: "2026-10-19",
  valor: liquido,
  liquido,
  forma: "pix",
  centro: { tipo: "02", sub: "Produção" },
  ...extra,
});
const mov = (ordem: number, valor: number, historico = "PIX ENVIADO", data = "2026-10-19") => ({ ordem, data, valor, historico });
const vazio = { titulos: [], lancamentos: [], lotes: [], regras: [] };

test("linhas iguais em número igual ao de títulos: cada linha paga um, com confiança alta", () => {
  const res = casar([mov(0, -3000), mov(1, -3000)], { ...vazio, titulos: [titulo("a", 3000), titulo("b", 3000)] });
  assert.deepEqual(res.map((r) => [r.estado, r.confianca, r.iguais]), [
    ["sugestao", "alta", 2],
    ["sugestao", "alta", 2],
  ]);
  assert.equal(new Set(res.map((r) => r.titulo?.id)).size, 2);
});

test("mais títulos que linhas iguais: fica médio, e o grupo traz o que sobra para trocar", () => {
  const res = casar([mov(0, -3000), mov(1, -3000)], {
    ...vazio,
    titulos: [titulo("a", 3000), titulo("b", 3000), titulo("c", 3000)],
  });
  assert.ok(res.every((r) => r.estado === "sugestao" && r.confianca === "media"));
  const [g] = gruposDeIguais(res);
  assert.equal(g.linhas.length, 2);
  assert.equal(g.titulos.length, 3);
  assert.equal(g.marcados.length, 2);
});

test("a soma de 2 títulos da mesma contraparte: uma combinação é alta; duas, média", () => {
  const uma = casar([mov(0, -500)], { ...vazio, titulos: [titulo("a", 200), titulo("b", 300)] });
  assert.equal(uma[0].estado, "combinacao");
  assert.equal(uma[0].confianca, "alta");
  const duas = casar([mov(0, -500)], {
    ...vazio,
    titulos: [titulo("a", 200), titulo("b", 300), titulo("c", 100), titulo("d", 400)],
  });
  assert.equal(duas[0].estado, "combinacao");
  assert.equal(duas[0].confianca, "media");
});

test("a remessa só casa com uma saída do banco", () => {
  const lote: LoteDoMotor = { id: "l", nome: "remessa", total: 1000, titulos: [titulo("a", 1000, { loteId: "l" })] };
  assert.equal(casar([mov(0, -1000, "PAGAMENTO A FORNECEDORES")], { ...vazio, lotes: [lote] })[0].estado, "soma");
  assert.equal(casar([mov(0, 1000, "TED RECEBIDA")], { ...vazio, lotes: [lote] })[0].estado, "sem_par");
});

test("a regra vem antes do título de mesmo valor, e a baixa feita à mão vem antes da regra", () => {
  const tarifa: RegraDoMotor = { id: "g1", padrao: "TAR", centro: "04 · Tarifa bancária", criadaEm: "27/10/2026", usos: 44 };
  const res = casar([mov(0, -250, "TAR PIX PGTO FORNEC - MESMA INST"), mov(1, -250)], {
    ...vazio,
    titulos: [titulo("a", 250)],
    regras: [tarifa],
  });
  assert.equal(res[0].estado, "regra");
  assert.equal(res[1].titulo?.id, "a");
  const l: LancamentoDoMotor = { id: "l1", data: "2026-10-19", valor: -250, descricao: "Tarifa lançada à mão" };
  const manual = casar([mov(0, -250, "TAR PIX PGTO FORNEC - MESMA INST")], { ...vazio, lancamentos: [l], regras: [tarifa] });
  assert.equal(manual[0].estado, "ja_lancado");
});

test("\"PIX DEVOLVIDO\" também é devolução: a saída do mesmo dia vira o par", () => {
  const res = casar([mov(0, -4200, "PIX ENVIADO", "2026-10-02"), mov(1, 4200, "PIX DEVOLVIDO", "2026-10-02")], vazio);
  assert.deepEqual(res.map((r) => r.estado), ["par", "par"]);
});

test("a baixa feita à mão com juros conta pelo total que saiu da conta", () => {
  const l: LancamentoDoMotor = { id: "l1", data: "2026-10-19", valor: -1050, juros: 50, descricao: "PP 1/1" };
  const res = casar([mov(0, -1050, "PAGAMENTO DE TITULO")], { ...vazio, lancamentos: [l] });
  assert.equal(res[0].estado, "ja_lancado");
});

test("o que conta como certo: alta com centro de custo", () => {
  const com = casar([mov(0, -700)], { ...vazio, titulos: [titulo("a", 700)] })[0];
  const sem = casar([mov(0, -700)], { ...vazio, titulos: [titulo("a", 700, { centro: null })] })[0];
  assert.equal(com.confianca, "alta");
  assert.equal(ehCerto(com), true);
  assert.equal(ehCerto(sem), false);
});

test("a correção da baixa: os juros saem e o valor fica o do banco", () => {
  // O exemplo do protótipo: −516,95 com 0,36 de juros, e o banco 516,59.
  const c = correcaoDaBaixa(
    { valor: -516.95, juros: 0.36, data: "2026-10-18" },
    { valor: -516.59, data: "2026-10-19" },
    { liquido: 516.59, forma: "boleto", origem: "pp" },
  );
  assert.deepEqual(c.depois, { data: "2026-10-19", principal: 516.59, juros: 0, total: 516.59 });
  assert.deepEqual(c.antes, { data: "2026-10-18", principal: 516.59, juros: 0.36, total: 516.95 });
  // Fora do boleto e da guia, a diferença muda o valor pago.
  const pix = correcaoDaBaixa({ valor: -1000, data: "2026-10-19" }, { valor: -990, data: "2026-10-19" }, { liquido: 1000, forma: "pix", origem: "pp" });
  assert.deepEqual(pix.depois, { data: "2026-10-19", principal: 990, juros: 0, total: 990 });
});

test("sem nada no sistema, a linha fica sem correspondência, com o motivo", () => {
  const [r] = casar([mov(0, -12.34)], vazio) as ResultadoDoMotor[];
  assert.equal(r.estado, "sem_par");
  assert.equal(r.motivo, "Nenhum título ou lançamento do sistema tem esse valor.");
});
