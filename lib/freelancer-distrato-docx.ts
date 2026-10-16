import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  Footer,
  Header,
  PageNumber,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from "docx";
import type { Freelancer, FreelancerContrato } from "@/lib/types";
import { formatCpf, formatCnpj } from "@/lib/utils";

/**
 * Geração do DOCX do distrato — antecipação de término do contrato.
 * Template simples; a função principal é documentar quem aceitou o quê
 * e qual era a data original.
 */

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function dataExtenso(iso: string | null): string {
  if (!iso) return "___";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

type RunInput = string | { text: string; bold?: boolean; italics?: boolean };

function run(input: RunInput): TextRun {
  if (typeof input === "string") return new TextRun({ text: input });
  return new TextRun({
    text: input.text,
    bold: input.bold,
    italics: input.italics,
  });
}

function paragraph(
  runs: RunInput[],
  spacing = 160,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.JUSTIFIED,
): Paragraph {
  return new Paragraph({
    alignment,
    spacing: { after: spacing, line: 300 },
    children: runs.map(run),
  });
}

function emptyLine(): Paragraph {
  return new Paragraph({ children: [new TextRun("")] });
}

function signatureLine(label: string, before = 1600): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before, after: 0 },
    children: [new TextRun({ text: label, bold: true, size: 19 })],
  });
}

interface Props {
  freelancer: Freelancer;
  contrato: FreelancerContrato;
}

export async function gerarFreelancerDistratoDocx({
  freelancer: f,
  contrato,
}: Props): Promise<Buffer> {
  const nome = (f.nome_completo || f.nome_social).toUpperCase();
  const cpf = f.cpf ? formatCpf(f.cpf) : "___";
  const cnpj = f.cnpj ? formatCnpj(f.cnpj) : null;
  const razaoSocial = f.razao_social?.toUpperCase() || null;

  const dataOriginal =
    contrato.data_termino_original ?? contrato.data_termino ?? null;
  const dataProposta = contrato.distrato_data_proposta;
  const motivo = contrato.distrato_motivo ?? "não especificado";
  const nomeJob = contrato.nome_job || "___";

  const titulo = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
    children: [
      new TextRun({
        text: "DISTRATO DE CONTRATO DE PRESTAÇÃO DE SERVIÇOS",
        bold: true,
        size: 26,
        color: "000000",
      }),
    ],
  });

  const paragrafoContratante = paragraph([
    { text: "CALIFORNIA FILMES E PUBLICIDADE LTDA.", bold: true },
    ", inscrita no CNPJ/MF sob o nº 19.437.976/0001-54, com sede à Rua Vale Cabral, n°. 43, Pituba, Salvador – BA, doravante denominada ",
    { text: "CONTRATANTE", bold: true },
    ";",
  ]);

  const partsContratado: RunInput[] = [
    { text: nome, bold: true },
    `, inscrito(a) no CPF sob o nº ${cpf}`,
  ];
  if (razaoSocial && cnpj) {
    partsContratado.push(
      ", neste ato como representante da ",
      { text: razaoSocial, bold: true },
      `, inscrita no CNPJ sob o nº ${cnpj}`,
    );
  }
  partsContratado.push(
    ", doravante denominado(a) ",
    { text: "CONTRATADO(A)", bold: true },
    ".",
  );
  const paragrafoContratado = paragraph(partsContratado);

  const paragrafoResumo = paragraph([
    "As partes, acima qualificadas, resolvem de comum acordo rescindir o Contrato de Prestação de Serviços referente ao projeto ",
    { text: `"${nomeJob}"`, bold: true },
    `, originalmente firmado com término em ${dataExtenso(dataOriginal)}, antecipando a sua rescisão para a data de `,
    { text: dataExtenso(dataProposta), bold: true },
    ", nos termos abaixo:",
  ]);

  const clausulaPrimeira = paragraph([
    { text: "CLÁUSULA PRIMEIRA –", bold: true },
    ` As partes concordam em antecipar o término do contrato original para a data de ${dataExtenso(dataProposta)}, cessando nessa data toda e qualquer obrigação recíproca derivada do instrumento original.`,
  ]);

  const clausulaSegunda = paragraph([
    { text: "CLÁUSULA SEGUNDA –", bold: true },
    ` A motivação apresentada para o distrato é: ${motivo}.`,
  ]);

  const clausulaTerceira = paragraph([
    { text: "CLÁUSULA TERCEIRA –", bold: true },
    " As partes dão plena, geral e irrestrita quitação uma à outra quanto aos valores pagos até a data da rescisão antecipada, nada mais tendo a reclamar entre si, a qualquer tempo e a que título for, em juízo ou fora dele, com relação ao contrato ora rescindido.",
  ]);

  const clausulaQuarta = paragraph([
    { text: "CLÁUSULA QUARTA –", bold: true },
    " As Partes concordam em assinar o presente Distrato por meio de plataformas de assinatura eletrônica ou digital, admitindo expressamente tal meio como válido, nos termos do permissivo contido no § 2º do artigo 10 da Medida Provisória nº 2.200-2/2001.",
  ]);

  const clausulaQuinta = paragraph([
    { text: "CLÁUSULA QUINTA –", bold: true },
    " Fica eleito o Foro da Comarca de Salvador - BA para dirimir quaisquer dúvidas oriundas do presente Distrato.",
  ]);

  const fecho = paragraph([
    "E, por estarem assim justas e contratadas, as partes firmam o presente Distrato em uma única via digital, com a mesma validade jurídica.",
  ]);

  const localData = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 280, after: 280 },
    children: [
      new TextRun({
        text: `Salvador – BA, ${dataExtenso(dataProposta)}.`,
      }),
    ],
  });

  const assinaturaEmpresa = signatureLine("CALIFORNIA FILMES E PUBLICIDADE LTDA");
  const assinaturaContratado = signatureLine(razaoSocial || nome);

  const hiddenBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  function testemunhaCell(): TableCell {
    return new TableCell({
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: {
        top: hiddenBorder,
        bottom: hiddenBorder,
        left: hiddenBorder,
        right: hiddenBorder,
      },
      children: [
        new Paragraph({
          spacing: { after: 0 },
          children: [new TextRun({ text: "TESTEMUNHA", size: 19 })],
        }),
        new Paragraph({
          spacing: { after: 0 },
          children: [new TextRun({ text: "CPF:", size: 19 })],
        }),
      ],
    });
  }

  const testemunhas = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          testemunhaCell(),
          new TableCell({
            width: { size: 4, type: WidthType.PERCENTAGE },
            borders: {
              top: hiddenBorder,
              bottom: hiddenBorder,
              left: hiddenBorder,
              right: hiddenBorder,
            },
            children: [new Paragraph({ children: [new TextRun("")] })],
          }),
          testemunhaCell(),
        ],
      }),
    ],
  });

  const doc = new Document({
    creator: "Agência California",
    title: `Distrato ${nomeJob} - ${nome}`,
    styles: {
      default: { document: { run: { font: "Calibri", size: 20 } } },
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1000, bottom: 900, left: 1200, right: 1200 } },
        },
        headers: { default: new Header({ children: [emptyLine()] }) },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Página ", size: 18, color: "444444" }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 18,
                    color: "444444",
                  }),
                  new TextRun({ text: " de ", size: 18, color: "444444" }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 18,
                    color: "444444",
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          titulo,
          paragrafoContratante,
          paragrafoContratado,
          paragrafoResumo,
          clausulaPrimeira,
          clausulaSegunda,
          clausulaTerceira,
          clausulaQuarta,
          clausulaQuinta,
          fecho,
          localData,
          assinaturaEmpresa,
          assinaturaContratado,
          new Paragraph({
            spacing: { before: 1600, after: 0 },
            children: [new TextRun("")],
          }),
          testemunhas,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
