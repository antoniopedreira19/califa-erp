/**
 * Importação no orçamento de serviço Interno (decisão 105, 25/09/2026).
 *
 * Rode com:  node --import tsx --test lib/importacao/tipo-fixo.test.ts
 *
 * No Interno o tipo da coluna G não importa — toda linha é F · Interno.
 * Então a linha com tipo em branco ou desconhecido, que nos outros
 * orçamentos é descartada com aviso, entra como FI. A linha de agrupamento
 * (sem valor e sem tipo) continua sendo agrupamento.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { adicionarAbaOrcamento } from "../exportacao/planilha-orcamento";
import { parseOficial } from "./parser-oficial";

const item = (id: string, nome: string, tipo: string, unit: number) => ({
  id,
  item: nome,
  tipo_custo: tipo as any,
  valor_unitario_orcado: unit,
  quantidade_orcada: 1,
  dias_meses_orcado: 1,
  total_orcado: unit,
  em_save: false,
  save_consumido: 0,
});

/** A planilha do cliente com três itens; o do "Produtor" perde o tipo e o
 *  da "Logística" ganha um tipo que não existe. */
async function planilhaComTiposQuebrados(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  adicionarAbaOrcamento(wb, "Orçamento", {
    identificacao: "TES-0001/26-12 · Interno",
    clienteNome: "Teste",
    titulo: "Interno - V1",
    secoes: [
      {
        percentualHonorarios: 0,
        percentualImposto: 19.53,
        grupos: [
          {
            id: "g-equipe",
            nome: "Equipe",
            itens: [
              item("i-dir", "Diretor", "FI", 10000),
              item("i-prod", "Produtor", "FI", 5000),
            ],
          },
          { id: "g-verbas", nome: "Verbas", itens: [item("i-log", "Logística", "FI", 3000)] },
        ],
      },
    ],
  } as any);
  const ws = wb.worksheets[0];
  ws.eachRow((row) => {
    const nome = String(row.getCell(2).value ?? "").trim();
    if (nome === "Produtor") row.getCell(7).value = null;
    if (nome === "Logística") row.getCell(7).value = "X";
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test("fora do Interno, tipo em branco ou desconhecido descarta a linha", async () => {
  const lida = await parseOficial(await planilhaComTiposQuebrados());
  const nomes = lida.grupos.flatMap((g) => g.itens.map((i) => i.item));
  assert.deepEqual(nomes, ["Diretor"]);
  assert.equal(
    lida.warnings.filter((w) => w.severidade === "ignorada").length,
    2,
  );
});

test("no Interno, toda linha com valor entra como F · Interno", async () => {
  const lida = await parseOficial(await planilhaComTiposQuebrados(), {
    tipoFixo: "FI",
  });
  assert.deepEqual(
    lida.grupos.map((g) => [g.nome, g.itens.map((i) => [i.item, i.tipo_custo])]),
    [
      [
        "Equipe",
        [
          ["Diretor", "FI"],
          ["Produtor", "FI"],
        ],
      ],
      ["Verbas", [["Logística", "FI"]]],
    ],
  );
  assert.equal(
    lida.warnings.filter((w) => w.severidade === "ignorada").length,
    0,
  );
});
