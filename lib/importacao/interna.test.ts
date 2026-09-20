/**
 * Excel da planilha interna — orçado + planejado (+ realizado no job),
 * decisão 088, 17/09/2026.
 *
 * Rode com:  node --import tsx --test lib/importacao/interna.test.ts
 *
 * O que se prova aqui é a promessa que o Tiago fez questão de manter: a
 * interna DO ORÇAMENTO volta pelo Importar — o da versão e o do projeto —,
 * com os ids, o agrupamento, o tipo e o planejado no lugar, nos três
 * modelos; e a interna DO JOB é recusada pelos dois, porque o realizado
 * nasce das PPs. O desafio é a coluna oculta das marcas, que aqui não é a
 * H (ela é o R$ planejado), e as faixas e cabeçalhos repetidos a cada mês.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  adicionarAbaInterna,
  type DadosDaAbaInterna,
  type GrupoInterno,
} from "../exportacao/planilha-interna";
import {
  montarFechamentoInterno,
  somarFechamentosInternos,
} from "../exportacao/montar-interna";
import { adicionarAbaOrcamento } from "../exportacao/planilha-orcamento";
import { parseOficial } from "./parser-oficial";
import { parsePlanilhaProjeto } from "./parser-projeto";
import { acharColunaDeMarcas } from "./coluna-marcas";
import type { TipoCusto } from "../types";

const it = (
  id: string,
  nome: string,
  tipo: TipoCusto,
  unit: number,
  planejado = unit,
) => ({
  id,
  item: nome,
  tipo_custo: tipo,
  valor_unitario_orcado: unit,
  quantidade_orcada: 2,
  dias_meses_orcado: 3,
  total_orcado: unit * 6,
  em_save: false,
  save_consumido: 0,
  valor_unitario_planejado: planejado,
  quantidade_planejada: 2,
  dias_meses_planejado: 3,
  total_planejado: planejado * 6,
});

const grupos: GrupoInterno[] = [
  {
    id: "g-equipe",
    nome: "Equipe",
    itens: [it("i-dir", "Diretor", "B", 10000, 8000), it("i-prod", "Produtor", "A", 5000)],
  },
  {
    id: "g-verbas",
    nome: "Verbas",
    itens: [it("i-log", "Logística", "C", 3000, 2500)],
  },
];

const HON = 13;
const IMP = 19.53;

function planilha(
  extra: Partial<DadosDaAbaInterna>,
  secoes: DadosDaAbaInterna["secoes"],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  adicionarAbaInterna(wb, "Interna", {
    identificacao: "0-0001/26-02 · Job 2",
    clienteNome: "Pevetech",
    titulo: "Planilha interna · orçamento",
    marca: "interna:orcamento",
    modelo: "nacional",
    comRealizado: false,
    secoes,
    ...extra,
  });
  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
}

const todosOsItens = grupos.flatMap((g) => g.itens);
const fechamento = montarFechamentoInterno(todosOsItens, HON, IMP);

test("a coluna das marcas fica depois dos blocos, e a linha 1 diz qual planilha é", async () => {
  const wb = new ExcelJS.Workbook();
  // O `load` do ExcelJS aceita Buffer; a tipagem antiga dele não bate com
  // o Buffer genérico do @types/node — o mesmo cast dos parsers.
  await wb.xlsx.load((await planilha({}, [{ grupos, fechamento }])) as any);
  // Orçado A..G + planejado H..L: as marcas vão para a M.
  assert.deepEqual(acharColunaDeMarcas(wb.worksheets[0]), {
    coluna: 13,
    interna: "orcamento",
  });

  const daCliente = new ExcelJS.Workbook();
  adicionarAbaOrcamento(daCliente, "Orçamento", {
    identificacao: "0-0001/26-02 · Job 2",
    clienteNome: "Pevetech",
    titulo: "Job 2 - V1",
    secoes: [{ percentualHonorarios: HON, percentualImposto: IMP, grupos }],
  });
  const lida = new ExcelJS.Workbook();
  await lida.xlsx.load(Buffer.from(await daCliente.xlsx.writeBuffer()) as any);
  // A planilha do cliente não mudou: id na H, e nada de interna.
  assert.deepEqual(acharColunaDeMarcas(lida.worksheets[0]), {
    coluna: 8,
    interna: null,
  });
});

test("a interna do orçamento volta pelo Importar da versão, com ids e planejado", async () => {
  const lida = await parseOficial(await planilha({}, [{ grupos, fechamento }]));

  assert.equal(lida.modelo, "nacional");
  assert.equal(lida.tem_planejado, true);
  assert.deepEqual(
    lida.grupos.map((g) => [g.nome, g.grupo_id, g.itens.length]),
    [
      ["Equipe", "g-equipe", 2],
      ["Verbas", "g-verbas", 1],
    ],
  );

  const diretor = lida.grupos[0].itens[0];
  assert.equal(diretor.item_id, "i-dir");
  assert.equal(diretor.item, "Diretor");
  assert.equal(diretor.tipo_custo, "B");
  assert.equal(diretor.valor_unitario_orcado, 10000);
  assert.equal(diretor.quantidade_orcada, 2);
  assert.equal(diretor.dias_meses_orcado, 3);
  // O planejado da interna é real (H · I · J) — na planilha do cliente a
  // H é o id oculto, e ali ele não existe.
  assert.equal(diretor.valor_unitario_planejado, 8000);
  assert.equal(diretor.quantidade_planejada, 2);
  assert.equal(diretor.dias_meses_planejado, 3);

  // O % de honorários sai da linha HONORÁRIOS do fechamento.
  assert.equal(lida.percentual_honorarios, HON);
  // Nenhuma linha do fechamento virou item, e nada foi descartado com aviso.
  assert.equal(lida.linhas_importadas, 3);
  assert.deepEqual(lida.warnings, []);
});

test("a planilha do cliente continua sem planejado (o id ainda mora na H)", async () => {
  const wb = new ExcelJS.Workbook();
  adicionarAbaOrcamento(wb, "Orçamento", {
    identificacao: "0-0001/26-02 · Job 2",
    clienteNome: "Pevetech",
    titulo: "Job 2 - V1",
    secoes: [{ percentualHonorarios: HON, percentualImposto: IMP, grupos }],
  });
  const lida = await parseOficial(Buffer.from(await wb.xlsx.writeBuffer()));

  assert.equal(lida.tem_planejado, false);
  assert.deepEqual(
    lida.grupos.map((g) => [g.nome, g.grupo_id, g.itens.length]),
    [
      ["Equipe", "g-equipe", 2],
      ["Verbas", "g-verbas", 1],
    ],
  );
  assert.equal(lida.grupos[0].itens[0].item_id, "i-dir");
  assert.equal(lida.grupos[0].itens[0].valor_unitario_planejado, 0);
});

test("a interna do orçamento volta pelo Importar do projeto", async () => {
  const buffer = await planilha({}, [
    {
      titulo: "0-0001/26-02 · Job 2 - V1",
      orcamentoId: "orc-2",
      versaoId: "v-2",
      grupos,
      fechamento,
    },
  ]);
  const leitura = await parsePlanilhaProjeto(buffer);

  assert.equal(leitura.modelo, "nacional");
  assert.equal(leitura.secoes.length, 1);
  const secao = leitura.secoes[0];
  assert.equal(secao.orcamentoId, "orc-2");
  assert.equal(secao.versaoId, "v-2");
  assert.deepEqual(
    secao.grupos.map((g) => [g.nome, g.grupoId, g.itens.map((i) => i.itemId)]),
    [
      ["Equipe", "g-equipe", ["i-dir", "i-prod"]],
      ["Verbas", "g-verbas", ["i-log"]],
    ],
  );
  const log = secao.grupos[1].itens[0];
  assert.equal(log.item, "Logística");
  assert.equal(log.tipo_custo, "C");
  assert.equal(log.valor_unitario_orcado, 3000);
  assert.equal(log.quantidade_orcada, 2);
  assert.equal(log.dias_meses_orcado, 3);
  assert.deepEqual(leitura.warnings, []);
});

test("a interna do projeto volta com os DOIS orçamentos, cada um com o seu fechamento", async () => {
  const segundo: GrupoInterno[] = [
    { id: "g-extra", nome: "Extras", itens: [it("i-extra", "Coffee break", "C", 1200)] },
  ];
  const fechamentoDoSegundo = montarFechamentoInterno(
    segundo.flatMap((g) => g.itens),
    HON,
    IMP,
  );
  const total = somarFechamentosInternos([fechamento, fechamentoDoSegundo]);
  // O total é a soma dos dois, com cada um fechando pelos seus percentuais.
  assert.equal(
    Math.round(total.valorDoJob * 100) / 100,
    Math.round((fechamento.valorDoJob + fechamentoDoSegundo.valorDoJob) * 100) / 100,
  );
  assert.equal(total.percentualHonorarios, HON);

  const buffer = await planilha(
    {
      fechamentoTotal: total,
    },
    [
      {
        titulo: "0-0001/26-01 · Job 1 - V1",
        orcamentoId: "orc-1",
        versaoId: "v-1",
        grupos,
        fechamento,
      },
      {
        titulo: "0-0001/26-02 · Job 2 - V1",
        orcamentoId: "orc-2",
        versaoId: "v-1b",
        grupos: segundo,
        fechamento: fechamentoDoSegundo,
      },
    ],
  );
  const leitura = await parsePlanilhaProjeto(buffer);

  // O fechamento do primeiro orçamento não pode encerrar a leitura: o
  // segundo vem logo abaixo dele.
  assert.deepEqual(
    leitura.secoes.map((s) => [s.orcamentoId, s.grupos.length]),
    [
      ["orc-1", 2],
      ["orc-2", 1],
    ],
  );
  assert.deepEqual(
    leitura.secoes[1].grupos[0].itens.map((i) => [i.itemId, i.item, i.tipo_custo]),
    [["i-extra", "Coffee break", "C"]],
  );
  assert.deepEqual(leitura.warnings, []);
});

test("a interna internacional volta pelos dois parsers", async () => {
  const internacional = { percentualIntTaxes: 18.02, intTransactionCosts: 1500 };
  const fechamentoIntl = montarFechamentoInterno(todosOsItens, 12, IMP, {
    internacional,
  });
  const dados = {
    modelo: "internacional" as const,
    moeda: "USD",
    cambioCompra: 5.1,
    cambio: { cotacao: 5.3, venda: 5.5, data: "2026-09-14", nomeDaMoeda: "Dólar" },
  };

  const daVersao = await parseOficial(
    await planilha(dados, [{ grupos, fechamento: fechamentoIntl }]),
  );
  assert.equal(daVersao.modelo, "internacional");
  assert.deepEqual(
    daVersao.grupos.map((g) => [g.nome, g.grupo_id, g.itens.length]),
    [
      ["Equipe", "g-equipe", 2],
      ["Verbas", "g-verbas", 1],
    ],
  );
  const diretor = daVersao.grupos[0].itens[0];
  assert.equal(diretor.item_id, "i-dir");
  // Internacional: o unitário é o BRL (coluna D), QT na E e D/M na F.
  assert.equal(diretor.valor_unitario_orcado, 10000);
  assert.equal(diretor.quantidade_orcada, 2);
  assert.equal(diretor.dias_meses_orcado, 3);
  assert.equal(diretor.valor_unitario_planejado, 8000);

  const doProjeto = await parsePlanilhaProjeto(
    await planilha({ ...dados }, [
      {
        titulo: "0-0001/26-03 · Job internacional - V1",
        orcamentoId: "orc-3",
        versaoId: "v-3",
        grupos,
        fechamento: fechamentoIntl,
      },
    ]),
  );
  assert.equal(doProjeto.modelo, "internacional");
  assert.deepEqual(
    doProjeto.secoes[0].grupos.map((g) => [g.nome, g.grupoId, g.itens.length]),
    [
      ["Equipe", "g-equipe", 2],
      ["Verbas", "g-verbas", 1],
    ],
  );
  assert.equal(doProjeto.secoes[0].orcamentoId, "orc-3");
});

test("a interna mensal volta mês a mês, com a faixa e o cabeçalho repetidos", async () => {
  const meses = [
    { mes: "2026-10-01", grupos: [grupos[0]] },
    { mes: "2026-11-01", grupos: [grupos[1]] },
  ];
  const fechamentoDoMes = meses.map((m) =>
    montarFechamentoInterno(
      m.grupos.flatMap((g) => g.itens),
      HON,
      IMP,
    ),
  );
  const secao = {
    titulo: "0-0001/26-09 · Teste Fee 4T/2026 - V1",
    orcamentoId: "orc-fee",
    versaoId: "v-fee",
    meses,
    fechamento,
    fechamentoDoMes,
  };
  const buffer = await planilha({ modelo: "mensal" }, [secao]);

  const doProjeto = await parsePlanilhaProjeto(buffer);
  assert.equal(doProjeto.modelo, "mensal");
  assert.deepEqual(
    doProjeto.secoes[0].meses.map((m) => m.mes),
    ["2026-10-01", "2026-11-01"],
  );
  assert.deepEqual(
    doProjeto.secoes[0].grupos.map((g) => [g.nome, g.grupoId, g.mes]),
    [
      ["Equipe", "g-equipe", "2026-10-01"],
      ["Verbas", "g-verbas", "2026-11-01"],
    ],
  );
  // Nem o fechamento de cada mês nem o resumo do trimestre viraram grupo.
  assert.deepEqual(doProjeto.warnings, []);

  const daVersao = await parseOficial(buffer, { mensal: true });
  assert.equal(daVersao.modelo, "mensal");
  assert.deepEqual(
    daVersao.meses.map((m) => m.mes),
    ["2026-10-01", "2026-11-01"],
  );
  assert.deepEqual(
    daVersao.grupos.map((g) => [g.nome, g.mes, g.itens.length]),
    [
      ["Equipe", "2026-10-01", 2],
      ["Verbas", "2026-11-01", 1],
    ],
  );
  assert.equal(daVersao.grupos[0].itens[0].valor_unitario_planejado, 8000);
});

test("a interna mensal do projeto volta com os dois orçamentos, apesar dos resumos", async () => {
  const mes = (iso: string, g: GrupoInterno[]) => ({ mes: iso, grupos: g });
  const secaoMensal = (orcamentoId: string, nome: string, g: GrupoInterno[]) => {
    const meses = [mes("2026-10-01", g), mes("2026-11-01", g)];
    const fechamentoDoMes = meses.map((m) =>
      montarFechamentoInterno(
        m.grupos.flatMap((x) => x.itens),
        HON,
        IMP,
      ),
    );
    return {
      titulo: nome,
      orcamentoId,
      versaoId: `v-${orcamentoId}`,
      meses,
      fechamentoDoMes,
      fechamento: montarFechamentoInterno(
        meses.flatMap((m) => m.grupos.flatMap((x) => x.itens)),
        HON,
        IMP,
      ),
    };
  };
  const secoes = [
    secaoMensal("orc-fee", "0-0001/26-13 · Fee - V1", [grupos[0]]),
    secaoMensal("orc-aon", "0-0001/26-14 · Always On - V1", [grupos[1]]),
  ];
  const leitura = await parsePlanilhaProjeto(
    await planilha(
      {
        modelo: "mensal",
        fechamentoTotal: somarFechamentosInternos(secoes.map((s) => s.fechamento)),
      },
      secoes,
    ),
  );

  // O RESUMO DO TRIMESTRE do primeiro orçamento não pode engolir o segundo.
  assert.equal(leitura.modelo, "mensal");
  assert.deepEqual(
    leitura.secoes.map((s) => [s.orcamentoId, s.meses.map((m) => m.mes)]),
    [
      ["orc-fee", ["2026-10-01", "2026-11-01"]],
      ["orc-aon", ["2026-10-01", "2026-11-01"]],
    ],
  );
  assert.deepEqual(
    leitura.secoes.map((s) => s.grupos.map((g) => [g.nome, g.mes])),
    [
      [
        ["Equipe", "2026-10-01"],
        ["Equipe", "2026-11-01"],
      ],
      [
        ["Verbas", "2026-10-01"],
        ["Verbas", "2026-11-01"],
      ],
    ],
  );
  assert.deepEqual(leitura.warnings, []);
});

test("a interna do job é recusada pelos dois parsers", async () => {
  const gruposDoJob: GrupoInterno[] = [
    {
      ...grupos[0],
      itens: [
        {
          ...grupos[0].itens[0],
          realizado: {
            valorUnitario: null,
            quantidade: null,
            diasMeses: null,
            total: 54000,
            espelhaOrcado: false,
            sublinhas: [
              {
                rotulo: "PP-00024 · Paga · Antonio",
                valor: 54000,
                marca: "pp:1",
                unitario: { valor: 9000, quantidade: 2, diasMeses: 3 },
              },
            ],
          },
        },
        grupos[0].itens[1],
      ],
    },
  ];
  const buffer = await planilha(
    { marca: "interna:job", comRealizado: true, titulo: "Planilha interna do job" },
    [
      {
        grupos: gruposDoJob,
        fechamento: montarFechamentoInterno(
          gruposDoJob.flatMap((g) => g.itens.map((i) => ({ ...i, total_realizado: 0 }))),
          HON,
          IMP,
          { comRealizado: true },
        ),
      },
    ],
  );

  const daVersao = await parseOficial(buffer);
  assert.deepEqual(daVersao.grupos, []);
  assert.match(daVersao.warnings[0].motivo, /não volta pelo Importar/);

  const doProjeto = await parsePlanilhaProjeto(buffer);
  assert.deepEqual(doProjeto.secoes, []);
  assert.match(doProjeto.warnings[0].motivo, /não volta pelo Importar/);
});
