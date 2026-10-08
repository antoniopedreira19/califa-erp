/**
 * Excel do orçamento mensal — Fee e Always On (decisão 078, 15/09/2026).
 *
 * Rode com:  node --import tsx --test lib/importacao/mensal.test.ts
 *
 * O ciclo inteiro sem banco: a exportação sai, os dois parsers a leem de
 * volta, o diff conhece o mês de cada grupo, e os meses da planilha são
 * conferidos contra os da versão. Mais a planilha interna no layout da aba
 * SUL (INTERNA - DRE + Planilhas Ânima 2026), montada aqui célula a célula.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { adicionarAbaOrcamentoMensal } from "../exportacao/planilha-orcamento-mensal";
import { calcularTotaisVersao } from "../calculos/versao-totais";
import { mesDoRotulo } from "../calculos/meses-trimestre";
import { parsePlanilhaProjeto } from "./parser-projeto";
import { parseOficial } from "./parser-oficial";
import { planejarSecao, type GrupoAtual, type ItemAtual } from "./diff-projeto";
import {
  abaSemBlocoDeMes,
  casarBlocosComMeses,
  conferirMesesDaSecao,
  mesesDaAbaParaGravar,
} from "./meses-da-planilha";
import { montarPreviewDaAba } from "./preview-da-aba";

const it = (id: string, nome: string, tipo: any, unit: number, qt = 1, dm = 1) => ({
  id,
  item: nome,
  tipo_custo: tipo,
  valor_unitario_orcado: unit,
  quantidade_orcada: qt,
  dias_meses_orcado: dm,
  total_orcado: unit * qt * dm,
  em_save: false,
  save_consumido: 0,
});

const secaoFee = {
  titulo: "0-0001/26-09 · Teste Fee 4T/2026 - V1",
  rotuloNoResumo: "0-0001/26-09",
  orcamentoId: "orc-fee",
  versaoId: "v-fee",
  percentualHonorarios: 12,
  percentualImposto: 19.53,
  meses: [
    {
      mes: "2026-10-01",
      grupos: [
        { id: "g-out", nome: "Equipe", itens: [it("i-out", "Coordenador", "B", 12000)] },
        { id: "g-out-v", nome: "Verbas", itens: [it("i-out-v", "Logística", "C", 3000)] },
      ],
    },
    { mes: "2026-11-01", grupos: [{ id: "g-nov", nome: "Equipe", itens: [it("i-nov", "Coordenador", "B", 12000)] }] },
    { mes: "2026-12-01", grupos: [{ id: "g-dez", nome: "Equipe", itens: [it("i-dez", "Coordenador", "B", 12000)] }] },
  ],
};
const secaoAon = {
  titulo: "0-0001/26-10 · Always On 1T/2027 - V2",
  rotuloNoResumo: "0-0001/26-10",
  orcamentoId: "orc-aon",
  versaoId: "v-aon",
  percentualHonorarios: 15,
  percentualImposto: 16.33,
  meses: [
    { mes: "2027-01-01", grupos: [{ id: "g-jan", nome: "Conteúdo", itens: [it("i-jan", "Posts", "B", 800, 10)] }] },
    { mes: "2027-02-01", grupos: [{ id: "g-fev", nome: "Conteúdo", itens: [it("i-fev", "Posts", "B", 800, 12)] }] },
  ],
};

async function exportar(secoes: any[]): Promise<{ buffer: Buffer; ws: ExcelJS.Worksheet }> {
  const wb = new ExcelJS.Workbook();
  const ws = adicionarAbaOrcamentoMensal(
    wb,
    "Orçamento",
    {
      identificacao: "0-0001/26 · Projeto Teste",
      clienteNome: "Pevetech",
      titulo: "Orçamento · 15/09/2026",
      secoes,
    },
    { formulas: true },
  );
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), ws };
}

test("o título do mês é lido nos dois formatos", () => {
  assert.deepEqual(mesDoRotulo("OUTUBRO DE 2026"), { numero: 10, ano: 2026 });
  assert.deepEqual(mesDoRotulo("JANEIRO - 1877/1"), { numero: 1, ano: null });
  assert.deepEqual(mesDoRotulo("AGOSTO  - 2552/1"), { numero: 8, ano: null });
  assert.deepEqual(mesDoRotulo("Março de 2027"), { numero: 3, ano: 2027 });
  assert.deepEqual(mesDoRotulo("SETEMBRO"), { numero: 9, ano: null });
  assert.equal(mesDoRotulo("Equipe"), null);
  assert.equal(mesDoRotulo("Julho Produções"), null);
});

test("cada mês fecha no FATURAMENTO do mês e o resumo soma", async () => {
  const { ws } = await exportar([secaoFee]);
  const valores = new Map<string, number>();
  ws.eachRow((row) => {
    const rotulo = String(row.getCell(5).value ?? "");
    const v: any = row.getCell(6).value;
    if (rotulo) valores.set(rotulo, Number(v && typeof v === "object" ? v.result ?? 0 : v ?? 0));
  });
  let soma = 0;
  for (const [mes, nome] of [
    ["2026-10-01", "OUTUBRO"],
    ["2026-11-01", "NOVEMBRO"],
    ["2026-12-01", "DEZEMBRO"],
  ] as const) {
    const grupos = secaoFee.meses.find((m) => m.mes === mes)!.grupos;
    const esperado = calcularTotaisVersao(grupos.flatMap((g) => g.itens), 12, 19.53).cliente.total;
    assert.ok(Math.abs(valores.get(`FATURAMENTO DE ${nome}`)! - esperado) < 0.005, nome);
    soma += esperado;
  }
  assert.ok(Math.abs(valores.get("FATURAMENTO DO TRIMESTRE")! - soma) < 0.005);
});

test("a exportação do projeto volta pelo parser do projeto, mês a mês", async () => {
  const { buffer } = await exportar([secaoFee, secaoAon]);
  const leitura = await parsePlanilhaProjeto(buffer);
  assert.equal(leitura.modelo, "mensal");
  assert.equal(leitura.secoes.length, 2);
  const [fee, aon] = leitura.secoes;
  assert.equal(fee.orcamentoId, "orc-fee");
  assert.deepEqual(fee.meses.map((m) => m.mes), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.deepEqual(aon.meses.map((m) => m.mes), ["2027-01-01", "2027-02-01"]);
  assert.deepEqual(
    fee.grupos.map((g) => [g.grupoId, g.mes, g.itens.length]),
    [
      ["g-out", "2026-10-01", 1],
      ["g-out-v", "2026-10-01", 1],
      ["g-nov", "2026-11-01", 1],
      ["g-dez", "2026-12-01", 1],
    ],
  );
  assert.deepEqual(aon.grupos.map((g) => g.mes), ["2027-01-01", "2027-02-01"]);
  // Nada do fechamento nem do resumo virou grupo.
  assert.ok(leitura.secoes.every((s) => s.grupos.every((g) => /^(Equipe|Verbas|Conteúdo)$/.test(g.nome))));
});

function atuaisDoFee(): { grupos: GrupoAtual[]; itens: ItemAtual[] } {
  const grupos: GrupoAtual[] = [];
  const itens: ItemAtual[] = [];
  let ordem = 0;
  for (const m of secaoFee.meses) {
    for (const g of m.grupos) {
      grupos.push({ id: g.id, nome: g.nome, ordem: ++ordem, mes: m.mes });
      for (const i of g.itens) {
        itens.push({
          id: i.id,
          grupo_id: g.id,
          ordem,
          item: i.item,
          tipo_custo: i.tipo_custo,
          valor_unitario_orcado: i.valor_unitario_orcado,
          quantidade_orcada: i.quantidade_orcada,
          dias_meses_orcado: i.dias_meses_orcado,
          valor_unitario_planejado: 9000,
          quantidade_planejada: 1,
          dias_meses_planejado: 1,
          categoria_id: null,
          planilha_origem: null,
          em_save: false,
        });
      }
    }
  }
  return { grupos, itens };
}

test("o diff conhece o mês: igual não gera versão, mudar de mês gera", async () => {
  const { buffer } = await exportar([secaoFee]);
  const [secao] = (await parsePlanilhaProjeto(buffer)).secoes;
  const { grupos, itens } = atuaisDoFee();

  const igual = planejarSecao(secao, grupos, itens);
  assert.equal(igual.alterado, false);

  const movido = {
    ...secao,
    grupos: secao.grupos.map((g) => (g.grupoId === "g-nov" ? { ...g, mes: "2026-10-01" } : g)),
  };
  const plano = planejarSecao(movido, grupos, itens);
  assert.equal(plano.alterado, true);
  assert.equal(plano.resumo.gruposMudadosDeMes, 1);

  // Sem id, "Equipe" de novembro casa com o "Equipe" de novembro — não com
  // o de outubro, que tem o mesmo nome.
  const semIds = {
    ...secao,
    grupos: secao.grupos.map((g) => ({
      ...g,
      grupoId: null,
      itens: g.itens.map((i) => ({ ...i, itemId: null })),
    })),
  };
  const porNome = planejarSecao(semIds, grupos, itens);
  assert.deepEqual(
    porNome.grupos.map((g) => g.origem?.id),
    ["g-out", "g-out-v", "g-nov", "g-dez"],
  );
  assert.equal(porNome.alterado, false);
});

test("os meses da seção têm que ser os da versão", () => {
  const lidos = (datas: (string | null)[]) => datas.map((mes) => ({ mes, rotulo: mes ?? "OUTUBRO" }));
  const daVersao = ["2026-10-01", "2026-11-01", "2026-12-01"];
  assert.equal(conferirMesesDaSecao(lidos(daVersao), daVersao), null);
  assert.match(conferirMesesDaSecao(lidos(daVersao.slice(0, 2)), daVersao)!, /falta dezembro de 2026/);
  assert.match(
    conferirMesesDaSecao(lidos([...daVersao, "2027-01-01"]), daVersao)!,
    /traz janeiro de 2027, que o orçamento não tem/,
  );
  assert.match(conferirMesesDaSecao(lidos([null, ...daVersao.slice(1)]), daVersao)!, /não diz de que mês é/);
  assert.match(
    conferirMesesDaSecao(lidos([daVersao[0], ...daVersao]), daVersao)!,
    /aparece em mais de um bloco/,
  );
});

test("a exportação da versão volta pelo 'Importar planilha' com os meses", async () => {
  const { buffer } = await exportar([{ ...secaoFee, titulo: undefined }]);
  const parsed = await parseOficial(buffer, { mensal: true });
  assert.equal(parsed.modelo, "mensal");
  assert.deepEqual(parsed.meses.map((m) => m.mes), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.deepEqual(
    parsed.grupos.map((g) => [g.nome, g.mes, g.grupo_id, g.itens.map((i) => i.item_id)]),
    [
      ["Equipe", "2026-10-01", "g-out", ["i-out"]],
      ["Verbas", "2026-10-01", "g-out-v", ["i-out-v"]],
      ["Equipe", "2026-11-01", "g-nov", ["i-nov"]],
      ["Equipe", "2026-12-01", "g-dez", ["i-dez"]],
    ],
  );
  const casados = casarBlocosComMeses(parsed.grupos, parsed.meses, [
    "2026-10-01",
    "2026-11-01",
    "2026-12-01",
  ]);
  assert.ok(casados.ok);
  if (casados.ok) assert.equal(casados.grupos.length, 4);

  // Sem o modo mensal, a mesma planilha diz que é mensal — e a importação
  // de um orçamento nacional a recusa.
  const comoNacional = await parseOficial(buffer);
  assert.equal(comoNacional.modelo, "mensal");
});

/** A aba SUL da planilha interna, reduzida ao que importa. */
async function planilhaSul(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Controle ânima").addRow(["", "SUB-TOTAL OPERAÇÃO BR", "", 4039023.49]);
  const ws = wb.addWorksheet("SUL");
  const linha = (n: number, cells: Record<string, unknown>) => {
    for (const [col, v] of Object.entries(cells)) ws.getCell(`${col}${n}`).value = v as any;
  };
  const bloco = (inicio: number, titulo: string, grupo: string, itens: [string, string, number, string, number][]) => {
    linha(inicio, { A: "Atualizado", B: titulo, H: "FATURAMENTO", I: 60000 });
    linha(inicio + 1, { F: "ORÇAMENTO", G: "ORÇAMENTO", K: "PLANEJADO" });
    linha(inicio + 2, { A: "PLANILHA", B: "ITEM", F: "R$", G: "QT", H: "DIAS", I: "TT", K: "R$", L: "QT", M: "DIAS", N: "TT", O: "RENTA" });
    linha(inicio + 3, { B: grupo, C: "NOME", D: "CONTRATO", E: "UNI", I: 1 });
    itens.forEach(([agrup, nome, unit, tipo, planejado], i) =>
      linha(inicio + 4 + i, { A: agrup, B: nome, C: "Maurício", D: "Fixo", E: "Hub Sul", F: unit, G: 1, H: 1, I: unit, J: tipo, K: planejado, L: 1, M: 1, N: planejado }),
    );
    const f = inicio + 5 + itens.length;
    linha(f, { F: "SUB-TOTAL B", I: 1, J: "B", M: "SUB-TOTAL" });
    linha(f + 1, { B: "Conta para Sobra", F: "SUB-TOTAL C", J: "C" });
    linha(f + 2, { F: "TOTAL", I: 1 });
    linha(f + 3, { B: "Limite Faturamento", F: "IMPOSTO", I: 1 });
    linha(f + 4, { B: 60000, F: "HONORÁRIOS", I: 1 });
    linha(f + 5, { F: "FATURAMENTO", I: 1 });
    return f + 7;
  };
  linha(1, { F: "SUB-TOTAL OPERAÇÃO", I: 1131511.33 });
  let n = 6;
  n = bloco(n, "OUTUBRO - 2552/1", "EQUIPE", [["EQUIPE", "Gerente de Projeto", 9000, "B", 8000]]);
  n = bloco(n, "NOVEMBRO - 2600/1", " VERBAS DO PROJETO", [
    ["VERBA", "Logística", 3000, "C", 2500],
    ["VERBA", "Total de horas extras", 700, "B", 700],
  ]);
  n = bloco(n, "DEZEMBRO", "EQUIPE", [["EQUIPE", "Gerente de Projeto", 9500, "B", 9000]]);
  bloco(n, "JANEIRO - 2700/1", "EQUIPE", [["EQUIPE", "Gerente de Projeto", 1, "B", 1]]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("a planilha interna (aba SUL) entra pelos títulos dos meses", async () => {
  const parsed = await parseOficial(await planilhaSul(), { mensal: true });
  assert.equal(parsed.aba, "SUL");
  assert.equal(parsed.modelo, "mensal");
  assert.deepEqual(parsed.meses.map((m) => [m.numero, m.ano]), [
    [10, null],
    [11, null],
    [12, null],
    [1, null],
  ]);
  const semAviso = parsed.warnings.filter((w) => w.severidade === "ignorada");
  assert.deepEqual(semAviso, [], JSON.stringify(parsed.warnings));
  assert.deepEqual(
    parsed.grupos.map((g) => [g.nome, g.mes_numero, g.itens.map((i) => [i.item, i.tipo_custo, i.valor_unitario_orcado, i.valor_unitario_planejado])]),
    [
      ["EQUIPE", 10, [["Gerente de Projeto", "B", 9000, 8000]]],
      ["VERBA", 11, [["Logística", "C", 3000, 2500], ["Total de horas extras", "B", 700, 700]]],
      ["EQUIPE", 12, [["Gerente de Projeto", "B", 9500, 9000]]],
      ["EQUIPE", 1, [["Gerente de Projeto", "B", 1, 1]]],
    ],
  );

  // Trimestre inteiro: janeiro fica de fora, com aviso.
  const trimestre = casarBlocosComMeses(parsed.grupos, parsed.meses, [
    "2026-10-01",
    "2026-11-01",
    "2026-12-01",
  ]);
  assert.ok(trimestre.ok);
  if (trimestre.ok) {
    assert.deepEqual(trimestre.grupos.map((g) => g.mes), ["2026-10-01", "2026-11-01", "2026-12-01"]);
    assert.match(trimestre.avisos[0].motivo, /JANEIRO - 2700\/1.*fora/);
    // O grupo do bloco de janeiro não vira "grupo antes do primeiro mês".
    assert.equal(trimestre.avisos.length, 1, JSON.stringify(trimestre.avisos));
  }

  // Versão com outubro e novembro só: dezembro está no trimestre e a
  // versão não tem — fica de fora, com aviso (decisão 158; antes recusava).
  const semDezembro = casarBlocosComMeses(parsed.grupos, parsed.meses, ["2026-10-01", "2026-11-01"]);
  assert.ok(semDezembro.ok);
  if (semDezembro.ok) {
    assert.deepEqual(semDezembro.grupos.map((g) => g.mes), ["2026-10-01", "2026-11-01"]);
    assert.ok(
      semDezembro.avisos.some((a) => /"DEZEMBRO" ficou de fora: o orçamento não tem dezembro/.test(a.motivo)),
      JSON.stringify(semDezembro.avisos),
    );
  }

  // Versão de um mês só (o Always On mês a mês): entra só outubro.
  const soOutubro = casarBlocosComMeses(parsed.grupos, parsed.meses, ["2026-10-01"]);
  assert.ok(soOutubro.ok);
  if (soOutubro.ok) assert.deepEqual(soOutubro.grupos.map((g) => [g.nome, g.mes]), [["EQUIPE", "2026-10-01"]]);

  // Mês da versão sem bloco na planilha continua recusando.
  const semBlocoDeDezembro = casarBlocosComMeses(
    parsed.grupos.filter((g) => g.mes_numero !== 12),
    parsed.meses.filter((m) => m.numero !== 12),
    ["2026-10-01", "2026-11-01", "2026-12-01"],
  );
  assert.equal(semBlocoDeDezembro.ok, false);
  if (!semBlocoDeDezembro.ok) assert.match(semBlocoDeDezembro.message, /falta dezembro de 2026/);
});

/** Uma aba de UM mês, sem título de mês — a planilha do AON (decisão 158). */
async function abaDeUmMes(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("AON - PILOTO");
  ws.addRow(["Stand By", "PROPOSTA - CLIENTE", "", "", "", "", "FATURAMENTO", 30000]);
  ws.addRow(["", "", "", "", "ORÇAMENTO", "ORÇAMENTO", "ORÇAMENTO", "", "", "PLANEJADO"]);
  ws.addRow(["PLANILHA", "ITEM", "", "", "R$", "QT", "DIAS", "TT", "", "R$", "QT", "DIAS", "TT"]);
  ws.addRow(["", "EQUIPE", "PESSOA", "CONTRATO"]);
  ws.addRow(["EQUIPE", "Analista de Mídia", "TBD", "", 6000, 1, 1, 6000, "B", 4000, 1, 1, 4000]);
  ws.addRow(["EQUIPE", "Analista de BI", "TBD", "Freela", 6000, 1, 1, 6000, "B", 6000, 1, 1, 6000]);
  ws.addRow(["", " VERBAS DO PROJETO"]);
  ws.addRow(["VERBA", "Plataforma", "-", "", 3000, 1, 1, 3000, "B", 3000, 1, 1, 3000]);
  ws.addRow(["", "", "", "", "SUB-TOTAL B", "", "", 15000, "B"]);
  ws.addRow(["", "Limite Faturamento", "", "", "HONORÁRIOS", "", "", { formula: "(H9+H10)*13%", result: 1950 }]);
  ws.addRow(["", "", "", "", "FATURAMENTO", "", "", 21000]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const TRIMESTRE = ["2026-10-01", "2026-11-01", "2026-12-01"];

test("aba sem título de mês: repete nos meses ou entra só no primeiro (decisão 158)", async () => {
  const parsed = await parseOficial(await abaDeUmMes(), { mensal: true });
  assert.equal(parsed.modelo, "nacional");
  assert.ok(abaSemBlocoDeMes(parsed));
  assert.deepEqual(parsed.grupos.map((g) => [g.nome, g.itens.length]), [["EQUIPE", 2], ["VERBA", 1]]);
  // Sozinho, o casamento continua recusando a aba sem bloco.
  assert.equal(casarBlocosComMeses(parsed.grupos, parsed.meses, ["2026-10-01"]).ok, false);

  // Orçamento de três meses: sem escolha, não grava.
  const semEscolha = mesesDaAbaParaGravar(parsed, TRIMESTRE, null);
  assert.equal(semEscolha.ok, false);
  if (!semEscolha.ok) assert.match(semEscolha.message, /Escolha se os itens se repetem/);

  const todos = mesesDaAbaParaGravar(parsed, TRIMESTRE, "todos");
  assert.ok(todos.ok);
  if (todos.ok) {
    assert.equal(todos.parsed.modelo, "mensal");
    assert.deepEqual(
      todos.parsed.grupos.map((g) => [g.nome, g.mes, g.ordem, g.itens.length]),
      [
        ["EQUIPE", "2026-10-01", 1, 2],
        ["VERBA", "2026-10-01", 2, 1],
        ["EQUIPE", "2026-11-01", 3, 2],
        ["VERBA", "2026-11-01", 4, 1],
        ["EQUIPE", "2026-12-01", 5, 2],
        ["VERBA", "2026-12-01", 6, 1],
      ],
    );
    assert.equal(todos.parsed.linhas_importadas, 9);
  }

  const primeiro = mesesDaAbaParaGravar(parsed, TRIMESTRE, "primeiro");
  assert.ok(primeiro.ok);
  if (primeiro.ok) {
    assert.deepEqual(primeiro.parsed.grupos.map((g) => g.mes), ["2026-10-01", "2026-10-01"]);
    assert.equal(primeiro.parsed.linhas_importadas, 3);
  }

  // Orçamento de um mês: entra nele, sem pergunta.
  const umMes = mesesDaAbaParaGravar(parsed, ["2026-10-01"], null);
  assert.ok(umMes.ok);
  if (umMes.ok) assert.deepEqual(umMes.parsed.grupos.map((g) => g.mes), ["2026-10-01", "2026-10-01"]);
});

test("a tela recebe as leituras de cada opção da aba sem título de mês (decisão 158)", async () => {
  const parsed = await parseOficial(await abaDeUmMes(), { mensal: true });
  const contexto = { modelo: "mensal" as const, anterior: null, honorarios: null };

  const tres = montarPreviewDaAba(parsed, { ...contexto, mesesDestino: TRIMESTRE });
  assert.ok(tres.ok);
  if (tres.ok) {
    // Antes da escolha, a aba como está: um mês, sem o nome do mês.
    assert.deepEqual(tres.preview.grupos.map((g) => [g.nome, g.itens_count]), [["EQUIPE", 2], ["VERBA", 1]]);
    assert.ok(tres.semBloco);
    assert.deepEqual(tres.semBloco!.meses, TRIMESTRE);
    assert.equal(tres.semBloco!.todos.grupos.length, 6);
    assert.equal(tres.semBloco!.todos.grupos.reduce((s, g) => s + g.total_bruto, 0), 45000);
    assert.equal(tres.semBloco!.primeiro!.grupos.length, 2);
    assert.ok(tres.semBloco!.todos.grupos.every((g) => /·/.test(g.nome)));
  }

  const um = montarPreviewDaAba(parsed, { ...contexto, mesesDestino: ["2026-10-01"] });
  assert.ok(um.ok);
  if (um.ok) {
    assert.equal(um.semBloco!.primeiro, null);
    assert.equal(um.preview.grupos.length, 2);
    assert.ok(um.preview.grupos.every((g) => /·/.test(g.nome)));
  }

  // Fora do mensal, nada muda: a aba é a planilha nacional de sempre.
  const nacional = montarPreviewDaAba(parsed, { ...contexto, modelo: "nacional", mesesDestino: null });
  assert.ok(nacional.ok);
  if (nacional.ok) assert.equal(nacional.semBloco, null);
});

test("planilha com blocos de mês segue como antes, com ou sem opção (decisão 158)", async () => {
  const { buffer } = await exportar([{ ...secaoFee, titulo: undefined }]);
  const parsed = await parseOficial(buffer, { mensal: true });
  assert.equal(abaSemBlocoDeMes(parsed), false);
  for (const opcao of [null, "todos", "primeiro"] as const) {
    const r = mesesDaAbaParaGravar(parsed, TRIMESTRE, opcao);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.parsed.grupos.map((g) => g.grupo_id), ["g-out", "g-out-v", "g-nov", "g-dez"]);
  }
  const preview = montarPreviewDaAba(parsed, {
    modelo: "mensal",
    anterior: null,
    honorarios: null,
    mesesDestino: TRIMESTRE,
  });
  assert.ok(preview.ok);
  if (preview.ok) assert.equal(preview.semBloco, null);
});

test("QT 0 é aceito: item listado sem cobrança no mês (15/09/2026)", async () => {
  // Planilha interna do mensal, como a aba SUL.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SUL");
  ws.getCell("A1").value = "Atualizado";
  ws.getCell("B1").value = "OUTUBRO - 2552/1";
  const cab: Record<string, string> = { A: "PLANILHA", B: "ITEM", F: "R$", G: "QT", H: "DIAS", I: "TT", K: "R$", L: "QT", M: "DIAS", N: "TT" };
  for (const [c, v] of Object.entries(cab)) ws.getCell(`${c}2`).value = v;
  const item: Record<string, unknown> = { A: "EQUIPE", B: "Gerente de Projeto", F: 9000, G: 0, H: 1, I: 0, J: "B", K: 9000, L: 0, M: 1, N: 0 };
  for (const [c, v] of Object.entries(item)) ws.getCell(`${c}3`).value = v as any;
  const mensal = await parseOficial(Buffer.from(await wb.xlsx.writeBuffer()), { mensal: true });
  const [linha] = mensal.grupos[0].itens;
  assert.equal(linha.quantidade_orcada, 0);
  assert.equal(linha.valor_unitario_orcado, 9000);
  assert.ok(!mensal.warnings.some((w) => /Quantidade/.test(w.motivo)), JSON.stringify(mensal.warnings));

  // No modelo nacional também, e o padrão de QT vazio continua 1.
  const wbN = new ExcelJS.Workbook();
  const wsN = wbN.addWorksheet("Padrão");
  wsN.addRow(["CATEGORIA", "ITEM", "R$", "QT", "D/M", "TT"]);
  wsN.addRow(["Equipe", "Sem cobrança", 1000, 0, 1, 0, "B"]);
  wsN.addRow(["Equipe", "Sem quantidade", 1000, null, 1, 1000, "B"]);
  wsN.addRow(["Equipe", "Negativa", 1000, -2, 1, 0, "B"]);
  const nacional = await parseOficial(Buffer.from(await wbN.xlsx.writeBuffer()));
  assert.deepEqual(
    nacional.grupos[0].itens.map((i) => [i.item, i.quantidade_orcada]),
    [
      ["Sem cobrança", 0],
      ["Sem quantidade", 1],
      ["Negativa", 1],
    ],
  );
});

/** Blocos da planilha interna com o % de honorários só dentro da fórmula. */
async function internaComHonorarios(blocos: [string, string][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SUL");
  let n = 1;
  const linha = (cells: Record<string, unknown>) => {
    for (const [col, v] of Object.entries(cells)) ws.getCell(`${col}${n}`).value = v as any;
    n++;
  };
  for (const [titulo, formula] of blocos) {
    linha({ A: "On Going", B: titulo, H: "FATURAMENTO" });
    linha({ A: "PLANILHA", B: "ITEM", F: "R$", G: "QT", H: "DIAS", I: "TT", K: "R$", L: "QT", M: "DIAS", N: "TT" });
    linha({ A: "EQUIPE", B: "Editor", F: 10000, G: 1, H: 1, I: 10000, J: "B", K: 8000, L: 1, M: 1, N: 8000 });
    linha({ F: "SUB-TOTAL B", I: 10000, J: "B" });
    linha({ B: "Limite Faturamento", F: "IMPOSTO", I: 1 });
    linha({ B: 60000, F: "HONORÁRIOS", I: { formula, result: 1300 } });
    linha({ F: "FATURAMENTO", I: 1 });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("o % de honorários é lido de dentro da fórmula, mês a mês (decisão 158)", async () => {
  const parsed = await parseOficial(
    await internaComHonorarios([
      ["SETEMBRO", "(I4+I6)*12%"],
      ["OUTUBRO", "(I11+I13)*13%G448"],
      ["NOVEMBRO", "(I18+I20)*13%"],
    ]),
    { mensal: true },
  );
  assert.deepEqual(parsed.meses.map((m) => [m.rotulo, m.percentual_honorarios]), [
    ["SETEMBRO", 12],
    ["OUTUBRO", 13],
    ["NOVEMBRO", 13],
  ]);
  // O primeiro da aba é o de setembro, que não entra num orçamento do 4º
  // trimestre: o aviso usa o dos meses que entram.
  assert.equal(parsed.percentual_honorarios, 12);
  const quarto = mesesDaAbaParaGravar(parsed, ["2026-10-01", "2026-11-01"], null);
  assert.ok(quarto.ok);
  if (quarto.ok) {
    assert.equal(quarto.parsed.percentual_honorarios, 13);
    assert.ok(!quarto.parsed.warnings.some((w) => /honorários diferentes/.test(w.motivo)));
  }
});

test("meses com honorários diferentes avisam, e vale o primeiro (decisão 158)", async () => {
  const parsed = await parseOficial(
    await internaComHonorarios([
      ["OUTUBRO", "(I4+I6)*13%"],
      ["NOVEMBRO", "(I11+I13)*12,5%"],
    ]),
    { mensal: true },
  );
  const r = mesesDaAbaParaGravar(parsed, ["2026-10-01", "2026-11-01"], null);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.parsed.percentual_honorarios, 13);
    assert.ok(
      r.parsed.warnings.some((w) => /honorários diferentes \(OUTUBRO: 13%; NOVEMBRO: 12,5%\)/.test(w.motivo)),
      JSON.stringify(r.parsed.warnings),
    );
  }
});

test("aba sem título de mês: o % da fórmula chega ao aviso (decisão 158)", async () => {
  const parsed = await parseOficial(await abaDeUmMes(), { mensal: true });
  assert.equal(parsed.percentual_honorarios, 13);
  const preview = montarPreviewDaAba(parsed, {
    modelo: "mensal",
    anterior: null,
    mesesDestino: TRIMESTRE,
    honorarios: { percentual: 12, clienteNome: "Cliente Teste", versao: "v1" },
  });
  assert.ok(preview.ok);
  if (preview.ok) {
    assert.equal(preview.semBloco!.todos.percentual_honorarios, 13);
    assert.equal(preview.semBloco!.todos.percentual_honorarios_cliente, 12);
    assert.equal(preview.semBloco!.todos.honorarios_da_versao, "v1");
  }
});
