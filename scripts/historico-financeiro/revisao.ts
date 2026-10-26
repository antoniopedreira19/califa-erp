/**
 * Revisão da E2 do histórico financeiro (decisão 211): junta as pendências e
 * as propostas de de-para da padronização num .xlsx só, uma aba por assunto,
 * com a coluna "Sua decisão". Vazia, vale a proposta.
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/revisao.ts <pasta-da-versao>
 *
 * Saída: <pasta-da-versao>/revisao-e2.xlsx. Como a planilha, fica em `tmp/`.
 */
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { lerCsv } from "../../lib/historico-financeiro/csv";

type Coluna = { titulo: string; campo: string; largura: number; numero?: boolean };

const ATENCAO = new Set(["ambíguo", "parecido", "pela sigla", "pela marca", "geral", "grupo sem tipo: proposto", "grupo sem tipo no plano"]);
const AMARELO = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFF2CC" } };
const CINZA = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF2F2F2" } };

const COMO_RESOLVER: Record<string, string> = {
  "Data inválida": "Corrigir a data na planilha.",
  "Job não encontrado": "Escreva o nome do job certo, ou \"sem job\".",
  "Job repetido com dados diferentes": "Escreva qual aba vale.",
  "Tipo sem padrão": "Escreva o grupo certo (CO, DA, CF…) ou corrija o Tipo na planilha.",
  "Nota sem empresa": "Escreva a empresa (Agência California, CCH ou Hitlab) ou o que é a nota.",
  "Regional sem par": "Escreva a regional do sistema, ou \"sem regional\".",
  "Valor que não fecha": "Corrigir na planilha.",
  "Nota sem número": "Corrigir na planilha.",
  "Job nas duas colunas": "Escreva qual dos dois jobs vale.",
  "Colunas trocadas no resultado": "Corrigir na planilha.",
};

async function lerTabela(arquivo: string): Promise<Record<string, string>[]> {
  const [cabecalho, ...linhas] = lerCsv(await readFile(arquivo, "utf8"));
  return linhas.map((l) => Object.fromEntries(cabecalho.map((c, i) => [c, l[i] ?? ""])));
}

function aba(livro: ExcelJS.Workbook, nome: string, colunas: Coluna[], linhas: Record<string, string>[], realce?: (l: Record<string, string>) => "amarelo" | "cinza" | null) {
  const planilha = livro.addWorksheet(nome, { views: [{ state: "frozen", ySplit: 1 }] });
  planilha.columns = [...colunas, { titulo: "Sua decisão", campo: "", largura: 34 }].map((c) => ({ header: c.titulo, key: c.campo || "decisao", width: c.largura }));
  planilha.getRow(1).font = { bold: true };
  for (const l of linhas) {
    const linha = planilha.addRow(colunas.map((c) => (c.numero && l[c.campo] !== "" ? Number(l[c.campo]) : l[c.campo])));
    colunas.forEach((c, i) => {
      if (c.numero) linha.getCell(i + 1).numFmt = "#,##0.00";
    });
    const cor = realce?.(l);
    if (cor) for (let i = 1; i <= colunas.length; i++) linha.getCell(i).fill = cor === "amarelo" ? AMARELO : CINZA;
  }
  planilha.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length + 1 } };
  return planilha;
}

const ordem = (prioridades: string[]) => (a: Record<string, string>, b: Record<string, string>) =>
  (prioridades.indexOf(a.como) + 1 || 99) - (prioridades.indexOf(b.como) + 1 || 99);

async function main() {
  const [pastaArg] = process.argv.slice(2);
  if (!pastaArg) {
    console.error("Uso: npx tsx scripts/historico-financeiro/revisao.ts <pasta-da-versao>");
    process.exit(1);
  }
  const pasta = join(resolve(pastaArg), "padronizado");
  const resumo = JSON.parse(await readFile(join(pasta, "resumo.json"), "utf8"));
  const pendencias: Record<string, string>[] = (await lerTabela(join(pasta, "pendencias.csv"))).map((p) => ({
    ...p,
    como_resolver: COMO_RESOLVER[p.tipo] ?? "",
  }));
  const plano = (await lerTabela(join(pasta, "propostas/plano.csv"))).sort(ordem(["grupo sem tipo: proposto", "geral", "parecido", "tipo com um subtipo só", "igual"]));
  const clientes = (await lerTabela(join(pasta, "propostas/clientes.csv"))).sort(ordem(["ambíguo", "parecido", "pela sigla", "pela marca", "sem par", "igual"]));
  const marcas = (await lerTabela(join(pasta, "propostas/marcas.csv"))).sort(ordem(["parecido", "sem par", "igual"]));
  const servicos = await lerTabela(join(pasta, "propostas/servicos.csv"));
  const regionais = await lerTabela(join(pasta, "propostas/regionais.csv"));

  const livro = new ExcelJS.Workbook();
  const leia = livro.addWorksheet("Leia-me");
  leia.getColumn(1).width = 110;
  const textos = [
    `Revisão da padronização (E2) — planilha exportada em ${resumo.versao.exportado_em}`,
    "",
    "Cada aba traz a proposta e a coluna \"Sua decisão\". Vazia, vale a proposta. Para corrigir, escreva o valor certo:",
    "a sigla do cliente (ex.: AMB), o código do subtipo (ex.: 07.009), o nome da regional ou do serviço do sistema.",
    "",
    "Amarelo: confira (proposta parecida, ambígua ou geral). Cinza: sem par no cadastro.",
    "Cliente e marca sem par ficam como texto no histórico, sem cadastro novo. Preencha só se quiser ligar a um cadastro existente.",
    "Pendências de \"Corrigir na planilha\" se resolvem no Google Sheets: a próxima versão já chega corrigida.",
    "",
    `Primeira carga (01/01/2023 a 30/06/2026): ${resumo.movimentos.por_carga["1ª carga"]} movimentos e ${resumo.notas.por_carga["emitida · 1ª carga"]} notas emitidas.`,
    `Pendências: ${pendencias.length}. Propostas: ${plano.length} contas do plano, ${clientes.length} clientes, ${marcas.length} marcas, ${servicos.length} serviços e ${regionais.length} regionais.`,
  ];
  textos.forEach((t, i) => {
    leia.getCell(i + 1, 1).value = t;
    if (i === 0) leia.getCell(i + 1, 1).font = { bold: true, size: 13 };
  });

  aba(livro, "Pendências", [
    { titulo: "Tipo", campo: "tipo", largura: 30 },
    { titulo: "Aba", campo: "aba", largura: 26 },
    { titulo: "Linha", campo: "linha", largura: 8 },
    { titulo: "Data", campo: "data", largura: 12 },
    { titulo: "Valor", campo: "valor", largura: 14, numero: true },
    { titulo: "Encontrado", campo: "encontrado", largura: 34 },
    { titulo: "Detalhe", campo: "detalhe", largura: 60 },
    { titulo: "Como resolver", campo: "como_resolver", largura: 52 },
  ], pendencias.sort((a, b) => a.tipo.localeCompare(b.tipo)));

  aba(livro, "Plano de contas", [
    { titulo: "Grupo", campo: "grupo", largura: 12 },
    { titulo: "Cod", campo: "cod", largura: 8 },
    { titulo: "Descrição na planilha", campo: "descricao_na_planilha", largura: 34 },
    { titulo: "Linhas (1ª carga)", campo: "linhas_na_1a_carga", largura: 16, numero: true },
    { titulo: "Saídas − entradas (R$)", campo: "saldo_saidas_menos_entradas", largura: 20, numero: true },
    { titulo: "Subtipo proposto", campo: "subtipo_proposto", largura: 16 },
    { titulo: "Nome no sistema", campo: "nome_no_sistema", largura: 46 },
    { titulo: "Como", campo: "como", largura: 24 },
  ], plano, (l) => (ATENCAO.has(l.como) ? "amarelo" : null));

  aba(livro, "Clientes", [
    { titulo: "Cliente na planilha", campo: "cliente_na_planilha", largura: 32 },
    { titulo: "Jobs", campo: "jobs", largura: 8, numero: true },
    { titulo: "Sigla proposta", campo: "sigla_proposta", largura: 16 },
    { titulo: "Cliente no sistema", campo: "cliente_no_sistema", largura: 46 },
    { titulo: "Como", campo: "como", largura: 14 },
  ], clientes, (l) => (ATENCAO.has(l.como) ? "amarelo" : l.como === "sem par" ? "cinza" : null));

  aba(livro, "Marcas", [
    { titulo: "Cliente na planilha", campo: "cliente_na_planilha", largura: 28 },
    { titulo: "Marca na planilha", campo: "marca_na_planilha", largura: 28 },
    { titulo: "Jobs", campo: "jobs", largura: 8, numero: true },
    { titulo: "Cliente proposto", campo: "cliente_proposto", largura: 16 },
    { titulo: "Marca proposta", campo: "marca_proposta", largura: 30 },
    { titulo: "Como", campo: "como", largura: 14 },
  ], marcas, (l) => (ATENCAO.has(l.como) ? "amarelo" : l.como === "sem par" ? "cinza" : null));

  aba(livro, "Serviços", [
    { titulo: "Serviço na planilha", campo: "servico_na_planilha", largura: 24 },
    { titulo: "Jobs", campo: "jobs", largura: 8, numero: true },
    { titulo: "Serviço proposto", campo: "servico_proposto", largura: 20 },
    { titulo: "Como", campo: "como", largura: 14 },
  ], servicos, (l) => (ATENCAO.has(l.como) || l.como === "sem par" ? "amarelo" : null));

  aba(livro, "Regionais", [
    { titulo: "Empresa", campo: "empresa", largura: 22 },
    { titulo: "Regional na planilha", campo: "regional_na_planilha", largura: 22 },
    { titulo: "Ocorrências", campo: "ocorrencias", largura: 14, numero: true },
    { titulo: "Regional proposta", campo: "regional_proposta", largura: 20 },
    { titulo: "Como", campo: "como", largura: 16 },
  ], regionais, (l) => (l.como === "sem par" ? "amarelo" : null));

  const saida = join(resolve(pastaArg), "revisao-e2.xlsx");
  await livro.xlsx.writeFile(saida);
  console.log(`Revisão gravada em ${saida}`);
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.stack : erro);
  process.exit(1);
});
