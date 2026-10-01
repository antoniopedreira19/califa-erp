// Gerador de PDFs de recibo de férias/abono para PJ, fiel aos modelos
// enviados pelo RH em 2026-10-01 (`_MODELO FÉRIAS.pdf` e `MODELO ABONO.pdf`).
//
// 3 formatos:
//   - "ferias"    : só férias (usufruto ou abono_combinado tratado como férias).
//   - "abono"     : só abono (abono_avulso ou abono_excepcional).
//   - "combinado" : férias + abono no mesmo PDF (duas seções).
//
// Empresa emissora é fixa (CALIFORNIA FILMES E PUBLICIDADE LTDA / CNPJ
// 19.437.976/0001-54). Se um dia variar por alocação, substituir pela
// consulta à empresa real.

import PdfPrinter from "pdfmake/src/printer";
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import { LOGO_ICON_BASE64 } from "./logo-base64";

let _printer: PdfPrinter | null = null;
function getPrinter(): PdfPrinter {
  if (_printer) return _printer;
  _printer = new PdfPrinter({
    Helvetica: {
      normal: "Helvetica",
      bold: "Helvetica-Bold",
      italics: "Helvetica-Oblique",
      bolditalics: "Helvetica-BoldOblique",
    },
  });
  return _printer;
}

const EMPRESA_NOME = "CALIFORNIA FILMES E PUBLICIDADE LTDA";
const EMPRESA_CNPJ = "19.437.976/0001-54";

export type FormatoRecibo = "ferias" | "abono" | "combinado";

export type DadosRecibo = {
  prestadorNome: string;
  periodoAquisitivo: string; // ex "2024/2025"
  dataInicio: string; // ISO
  dataFim: string;
  dias: number;
  valorBase: number;
  valorFerias: number;
  valorAbono: number;
  valorUmTerco: number;
  valorTotal: number;
  diasFerias?: number; // só pra combinado
  diasAbono?: number; // só pra combinado
};

export function gerarReciboFeriasPdf(
  formato: FormatoRecibo,
  dados: DadosRecibo,
): Promise<Buffer> {
  const docDef = montarDocumento(formato, dados);
  const printer = getPrinter();
  const doc = printer.createPdfKitDocument(docDef);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function montarDocumento(
  formato: FormatoRecibo,
  d: DadosRecibo,
): TDocumentDefinitions {
  const titulo =
    formato === "ferias"
      ? "RECIBO DE FÉRIAS"
      : formato === "abono"
        ? "RECIBO DE ABONO"
        : "RECIBO DE FÉRIAS E ABONO";

  const content: Content[] = [
    // Logo centralizado
    {
      image: LOGO_ICON_BASE64,
      width: 90,
      alignment: "center",
      margin: [0, 0, 0, 24],
    },
    // Título
    { text: titulo, style: "titulo", alignment: "center", margin: [0, 0, 0, 20] },
    // Dados empresa
    {
      stack: [
        { text: [{ text: "EMPRESA: ", bold: true }, EMPRESA_NOME] },
        { text: [{ text: "CNPJ: ", bold: true }, EMPRESA_CNPJ] },
      ],
      margin: [0, 0, 0, 16],
    },
    // Prestador
    {
      text: [{ text: "PRESTADOR DE SERVIÇO: ", bold: true }, d.prestadorNome],
      margin: [0, 0, 0, 24],
    },
    // Seção Cálculo
    { text: "CÁLCULO", bold: true, alignment: "center", margin: [0, 0, 0, 16] },
    { text: [{ text: "PERÍODO AQUISITIVO: ", bold: true }, d.periodoAquisitivo || "—"] },
  ];

  if (formato === "ferias" || formato === "combinado") {
    content.push({
      text: [
        { text: "PERÍODO PARA GOZO: ", bold: true },
        `${fmtDate(d.dataInicio)} a ${fmtDate(d.dataFim)}`,
      ],
      margin: [0, 6, 0, 0],
    });
  }
  if (formato === "abono" || formato === "combinado") {
    const diasAb = formato === "combinado" ? (d.diasAbono ?? 0) : d.dias;
    content.push({
      text: [{ text: "ABONO DE FÉRIAS (DIAS): ", bold: true }, String(diasAb)],
      margin: [0, 6, 0, 0],
    });
  }

  content.push({
    text: [
      { text: "VALOR BASE REMUNERAÇÃO: ", bold: true },
      fmtBRL(d.valorBase),
    ],
    margin: [0, 6, 0, 16],
  });

  // Breakdown
  const linhasBreakdown: Content[] = [];
  if (formato === "ferias" || formato === "combinado") {
    const diasFer = formato === "combinado" ? (d.diasFerias ?? 0) : d.dias;
    linhasBreakdown.push(linhaValor(`FÉRIAS (${diasFer} dias):`, d.valorFerias));
    linhasBreakdown.push(linhaValor("1/3 FÉRIAS:", calcularTercoFerias(d, formato)));
  }
  if (formato === "abono" || formato === "combinado") {
    const diasAb = formato === "combinado" ? (d.diasAbono ?? 0) : d.dias;
    linhasBreakdown.push(linhaValor(`ABONO (${diasAb} dias):`, d.valorAbono));
    linhasBreakdown.push(linhaValor("1/3 ABONO:", calcularTercoAbono(d, formato)));
  }

  content.push({
    stack: linhasBreakdown,
    margin: [20, 0, 0, 16],
  });

  // Total
  content.push({
    text: [
      { text: "TOTAL: ", bold: true, fontSize: 13 },
      { text: fmtBRL(d.valorTotal), bold: true, fontSize: 13 },
    ],
    margin: [0, 0, 0, 32],
  });

  // Recibo
  content.push({
    text: "RECIBO",
    bold: true,
    alignment: "center",
    margin: [0, 0, 0, 12],
  });

  const palavraDias =
    formato === "ferias"
      ? "dias de férias"
      : formato === "abono"
        ? "dias de Abono de férias"
        : "dias, entre férias e abono";

  content.push({
    text: [
      "Recebi a importância de ",
      { text: fmtBRL(d.valorTotal), bold: true },
      ` (${valorPorExtenso(d.valorTotal)}) correspondente a `,
      { text: String(d.dias), bold: true },
      ` ${palavraDias}.`,
    ],
    margin: [0, 0, 0, 36],
  });

  // Local + data
  content.push({
    text: `(Cidade), ${new Date().toLocaleDateString("pt-BR")}.`,
    alignment: "center",
    margin: [0, 0, 0, 48],
  });

  // Assinatura
  content.push({
    stack: [
      {
        canvas: [
          {
            type: "line",
            x1: 150,
            y1: 0,
            x2: 400,
            y2: 0,
            lineWidth: 0.6,
            lineColor: "#000",
          },
        ],
      },
      {
        text: d.prestadorNome || "Nome do Prestador",
        alignment: "center",
        bold: true,
        margin: [0, 6, 0, 0],
      },
    ],
  });

  return {
    pageSize: "A4",
    pageMargins: [60, 60, 60, 60],
    defaultStyle: {
      font: "Helvetica",
      fontSize: 11,
      lineHeight: 1.2,
    },
    styles: {
      titulo: { fontSize: 14, bold: true },
    },
    content,
  };
}

function linhaValor(rotulo: string, valor: number): Content {
  return {
    columns: [
      { text: rotulo, width: "*" },
      { text: fmtBRL(valor), width: "auto", bold: true },
    ],
    margin: [0, 2, 0, 2],
  };
}

function calcularTercoFerias(d: DadosRecibo, formato: FormatoRecibo): number {
  if (formato === "ferias") return d.valorUmTerco;
  // Combinado: 1/3 sobre o valor_ferias apenas
  return Math.round((d.valorFerias / 3) * 100) / 100;
}

function calcularTercoAbono(d: DadosRecibo, formato: FormatoRecibo): number {
  if (formato === "abono") return d.valorUmTerco;
  // Combinado: 1/3 sobre valor_abono apenas
  return Math.round((d.valorAbono / 3) * 100) / 100;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const [y, m, dd] = iso.slice(0, 10).split("-");
  return `${dd}/${m}/${y}`;
}

// Extenso simples pt-BR pra valores em BRL — cobre casos até milhões.
// Suficiente pra recibos; se um PJ tiver salário > R$ 10 milhões, revisamos.
function valorPorExtenso(n: number): string {
  const reais = Math.floor(n);
  const centavos = Math.round((n - reais) * 100);
  let txt = numeroPorExtenso(reais);
  txt += reais === 1 ? " real" : " reais";
  if (centavos > 0) {
    txt += ` e ${numeroPorExtenso(centavos)}`;
    txt += centavos === 1 ? " centavo" : " centavos";
  }
  return txt;
}

function numeroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  if (n < 0) return "menos " + numeroPorExtenso(-n);

  const unidades = [
    "",
    "um",
    "dois",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
  ];
  const dez_dezenove = [
    "dez",
    "onze",
    "doze",
    "treze",
    "quatorze",
    "quinze",
    "dezesseis",
    "dezessete",
    "dezoito",
    "dezenove",
  ];
  const dezenas = [
    "",
    "",
    "vinte",
    "trinta",
    "quarenta",
    "cinquenta",
    "sessenta",
    "setenta",
    "oitenta",
    "noventa",
  ];
  const centenas = [
    "",
    "cento",
    "duzentos",
    "trezentos",
    "quatrocentos",
    "quinhentos",
    "seiscentos",
    "setecentos",
    "oitocentos",
    "novecentos",
  ];

  function ate999(x: number): string {
    if (x === 0) return "";
    if (x === 100) return "cem";
    const c = Math.floor(x / 100);
    const resto = x % 100;
    const partes: string[] = [];
    if (c > 0) partes.push(centenas[c]);
    if (resto > 0) {
      if (resto < 10) partes.push(unidades[resto]);
      else if (resto < 20) partes.push(dez_dezenove[resto - 10]);
      else {
        const d = Math.floor(resto / 10);
        const u = resto % 10;
        if (u === 0) partes.push(dezenas[d]);
        else partes.push(`${dezenas[d]} e ${unidades[u]}`);
      }
    }
    return partes.join(" e ");
  }

  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;

  const partes: string[] = [];
  if (milhoes > 0) {
    if (milhoes === 1) partes.push("um milhão");
    else partes.push(`${ate999(milhoes)} milhões`);
  }
  if (milhares > 0) {
    if (milhares === 1) partes.push("mil");
    else partes.push(`${ate999(milhares)} mil`);
  }
  if (resto > 0) {
    partes.push(ate999(resto));
  }
  return partes.join(" e ");
}
