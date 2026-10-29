import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  PageNumber,
  Footer,
  Header,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import extenso from "extenso";
import type { Freelancer, FreelancerContrato } from "@/lib/types";
import { formatCpf, formatCnpj } from "@/lib/utils";

/**
 * Geração do DOCX de contrato de freelancer. Portado do AgCaliforniaRH
 * (lib/contrato-docx.ts). Mesmo texto jurídico, adaptado aos tipos do
 * califa-erp.
 *
 * O DOCX é usado como minuta pré-assinatura. A assinatura final acontece
 * fora do sistema (plataforma de eSignature ou papel), e o PDF assinado
 * é anexado via upload separado.
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

/**
 * UF por cidade — subset simples para resolver a cidade de assinatura.
 * Default SP se a cidade não aparecer aqui.
 */
const UF_POR_CIDADE: Record<string, string> = {
  "São Paulo": "SP",
  Salvador: "BA",
  "Rio de Janeiro": "RJ",
  "Belo Horizonte": "MG",
  Brasília: "DF",
  Curitiba: "PR",
  "Porto Alegre": "RS",
  Recife: "PE",
  Fortaleza: "CE",
  Manaus: "AM",
  Belém: "PA",
  Goiânia: "GO",
  Vitória: "ES",
  Florianópolis: "SC",
  "Campo Grande": "MS",
  Cuiabá: "MT",
  Natal: "RN",
  "João Pessoa": "PB",
  Maceió: "AL",
  Aracaju: "SE",
  Teresina: "PI",
  "São Luís": "MA",
  Palmas: "TO",
  "Boa Vista": "RR",
  "Rio Branco": "AC",
  "Porto Velho": "RO",
  Macapá: "AP",
};

function dataExtenso(dataIso: string | null): string {
  if (!dataIso) return "___";
  const [y, m, d] = dataIso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${y}`;
}

function valorFormatado(v: number | string | null): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || isNaN(n as number)) return "R$ 0,00";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(n as number);
}

function valorExtenso(v: number | string | null): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (!n || isNaN(n as number)) return "zero reais";
  try {
    return extenso((n as number).toFixed(2).replace(".", ","), {
      mode: "currency",
    });
  } catch {
    return "";
  }
}

function numExt(n: number): string {
  try {
    return extenso(String(n));
  } catch {
    return "";
  }
}

/** Diferença em meses + dias entre duas datas (inclusive na data_termino). */
function meseseDias(
  inicio: Date,
  termino: Date,
): { meses: number; dias: number } {
  // Convenção: período em meses conta o dia-D até o mesmo dia-D de N meses
  // depois como "N meses" cheios (não "N meses e 1 dia"). O +1 inclusivo só
  // vale pro cálculo de diárias (ver `duracaoTexto`). Antes isso, a minuta
  // saía com "3 meses e 1 dia" quando o form tinha pedido 3 meses redondos.
  let meses =
    (termino.getFullYear() - inicio.getFullYear()) * 12 +
    (termino.getMonth() - inicio.getMonth());
  let dias = termino.getDate() - inicio.getDate();
  if (dias < 0) {
    meses -= 1;
    const diasNoMesAnterior = new Date(
      termino.getFullYear(),
      termino.getMonth(),
      0,
    ).getDate();
    dias += diasNoMesAnterior;
  }
  if (meses < 0) {
    meses = 0;
    dias = Math.max(0, dias);
  }
  return { meses, dias };
}

function composeEndereco(f: Freelancer): string {
  // "Estruturado útil" exige rua — cidade sozinha não é endereço (vários
  // migrados do RH antigo têm só a cidade). Nesse caso cai no
  // `endereco_legado` que vem completo.
  if (f.rua) {
    const partes = [
      f.numero ? `${f.rua}, ${f.numero}` : f.rua,
      f.complemento,
      f.bairro,
      f.cidade,
    ].filter(Boolean);
    return partes.join(", ");
  }
  return (f.endereco_legado ?? "").trim();
}

/**
 * Texto de duração. Ex: "3 (três) meses e 15 (quinze) dias", "5 (cinco)
 * dias". Contratos de diária mostram só em dias, mesmo se passar de 30.
 */
function duracaoTexto(
  inicioIso: string | null,
  terminoIso: string | null,
  tipo: string | null,
): string {
  if (!inicioIso || !terminoIso) return "";
  const inicio = new Date(inicioIso + "T00:00:00");
  const termino = new Date(terminoIso + "T00:00:00");
  if (isNaN(inicio.getTime()) || isNaN(termino.getTime())) return "";
  if (termino < inicio) return "";

  if (tipo === "diarias") {
    const dias =
      Math.round((termino.getTime() - inicio.getTime()) / 86400000) + 1;
    const ext = numExt(dias);
    return `${dias}${ext ? ` (${ext})` : ""} ${dias === 1 ? "dia" : "dias"}`;
  }

  const { meses, dias } = meseseDias(inicio, termino);
  const parts: string[] = [];
  if (meses > 0) {
    const ext = numExt(meses);
    parts.push(
      `${meses}${ext ? ` (${ext})` : ""} ${meses === 1 ? "mês" : "meses"}`,
    );
  }
  if (dias > 0) {
    const ext = numExt(dias);
    parts.push(
      `${dias}${ext ? ` (${ext})` : ""} ${dias === 1 ? "dia" : "dias"}`,
    );
  }
  if (parts.length === 0) return "1 (um) dia";
  return parts.join(" e ");
}

// Helpers de parágrafo
type RunInput = string | { text: string; bold?: boolean; italics?: boolean };

function toRun(input: RunInput): TextRun {
  if (typeof input === "string") return new TextRun({ text: input });
  return new TextRun({
    text: input.text,
    bold: input.bold,
    italics: input.italics,
  });
}

function paragraph(
  runs: RunInput[],
  opts: {
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spacing?: number;
  } = {},
): Paragraph {
  return new Paragraph({
    alignment: opts.alignment ?? AlignmentType.JUSTIFIED,
    spacing: {
      after: opts.spacing ?? 160,
      line: 300,
    },
    children: runs.map(toRun),
  });
}

function emptyLine(): Paragraph {
  return new Paragraph({ children: [new TextRun({ text: "" })] });
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

export async function gerarFreelancerContratoDocx({
  freelancer: f,
  contrato,
}: Props): Promise<Buffer> {
  const nome = (f.nome_completo || f.nome_social).toUpperCase();
  const rg = f.rg ? f.rg : "___";
  const cpf = f.cpf ? formatCpf(f.cpf) : "___";
  const endereco = composeEndereco(f) || "___";
  const razaoSocial = f.razao_social?.toUpperCase() || null;
  const cnpj = f.cnpj ? formatCnpj(f.cnpj) : null;

  const dataInicioExt = dataExtenso(contrato.data_inicio);
  const dataTerminoExt = dataExtenso(contrato.data_termino);
  const nomeJob = contrato.nome_job || "___";
  const cargo = contrato.cargo || "atividades diversas";
  const valor = valorFormatado(contrato.valor);
  const valorExt = valorExtenso(contrato.valor);
  const duracao = duracaoTexto(
    contrato.data_inicio,
    contrato.data_termino,
    contrato.tipo,
  );
  const cidadeAssinatura = contrato.cidade || "São Paulo";
  const dataAssinaturaExt = dataExtenso(contrato.data_inicio);
  const uf = UF_POR_CIDADE[cidadeAssinatura] ?? "SP";

  const temPix = !!f.pix_chave;

  const titulo = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 280 },
    children: [
      new TextRun({
        text: "CONTRATO DE PRESTAÇÃO DE SERVIÇOS POR TEMPO DETERMINADO",
        bold: true,
        size: 26,
        color: "000000",
      }),
    ],
  });

  const paragrafoContratante = paragraph([
    { text: "CALIFORNIA FILMES E PUBLICIDADE LTDA.", bold: true },
    ", inscrita no CNPJ/MF sob o nº 19.437.976/0001-54, com sede à Rua Vale Cabral, n°. 43, Pituba, Salvador – BA, doravante denominada simplesmente ",
    { text: "CONTRATANTE", bold: true },
    ";",
  ]);

  const paragrafoContratadoRuns: RunInput[] = [
    { text: nome, bold: true },
    ` brasileiro(a), portador(a) de RG nº.${rg} , inscrito(a) no CPF sob o nº${cpf}, residente e domiciliado(a) na `,
    { text: endereco, bold: true },
  ];
  if (razaoSocial && cnpj) {
    paragrafoContratadoRuns.push(
      ", neste ato como representante da ",
      { text: razaoSocial, bold: true },
      ", inscrita no ",
      { text: `CNPJ sob o nº ${cnpj}`, bold: true },
    );
  }
  paragrafoContratadoRuns.push(
    ", doravante denominado(a) ",
    { text: "CONTRATADO(A)", bold: true },
    ";",
  );
  const paragrafoContratado = paragraph(paragrafoContratadoRuns);

  const paragrafoPreambulo = paragraph([
    { text: "CONTRATANTE", bold: true },
    " e ",
    { text: "CONTRATADO(A)", bold: true },
    ", adiante referidos como partes contratantes, reconhecem a validade e a eficácia do presente instrumento particular de contrato de prestação de serviços por tempo determinado com o(a) ",
    { text: "CONTRATADO(A)", bold: true },
    " na condição de ",
    { text: "freelancer", italics: true },
    ", como sendo a expressão exata e convergente das suas vontades, obrigando-se reciprocamente ao cumprimento das condições nele assumidas, nos termos que se seguem:",
  ]);

  const paragrafoPactuam = paragraph([
    "Pelo presente instrumento particular de contrato de prestação de serviços por tempo determinado na condição de ",
    { text: "freelancer", italics: true },
    ", as Partes pactuam os seguintes termos:",
  ]);

  const clausulaPrimeira = paragraph([
    { text: "CLÁUSULA PRIMEIRA –", bold: true },
    " O(A) ",
    { text: "CONTRATADO(A)", bold: true },
    " prestará ao ",
    { text: "CONTRATANTE", bold: true },
    `, a partir de ${dataInicioExt} e assinatura deste instrumento, seus trabalhos exercendo as atividades de `,
    { text: cargo, bold: true },
    " de campanhas publicitárias e produção de conteúdos desenvolvidos pela ",
    { text: `CONTRATANTE no projeto "${nomeJob}"`, bold: true },
    `. O contrato celebrado neste documento tem a duração${duracao ? ` de ${duracao},` : ""} até ${dataTerminoExt}, podendo ser renovado conforme motivação conjunta e expressa das partes.`,
  ]);

  const clausulaSegunda = paragraph([
    { text: "CLÁUSULA SEGUNDA –", bold: true },
    " O(A) ",
    { text: "CONTRATADO(A)", bold: true },
    " durante o período estabelecido, será responsável por realizar os serviços atinentes à atividade estabelecida na cláusula primeira, envidando todos os serviços para o desempenho das atividades e fica expressamente convencionado que não será constituído qualquer vínculo empregatício entre as partes, responsabilizando-se o(a) ",
    { text: "CONTRATADO(A)", bold: true },
    " por todos os encargos tributário, previdenciário e trabalhistas advindos das suas atividades.",
  ]);

  const clausulaTerceira = paragraph([
    { text: "CLÁUSULA TERCEIRA –", bold: true },
    " O(A) ",
    { text: "CONTRATADO(A)", bold: true },
    " receberá o valor de ",
    { text: valor, bold: true },
    valorExt ? ` (${valorExt}) ` : " ",
    {
      text:
        contrato.tipo === "mensal"
          ? "mensal"
          : contrato.tipo === "diarias"
            ? "por diária"
            : "pelo período",
      bold: true,
    },
    " pelo período estabelecido na cláusula primeira, devendo emitir e apresentar à ",
    { text: "CONTRATANTE", bold: true },
    " nota fiscal de serviços com uma antecedência mínima de 05 (cinco) dias úteis da data prevista para pagamento, conforme calendário financeiro da ",
    { text: "CONTRATANTE.", bold: true },
  ]);

  const paragrafoUnico = paragraph([
    { text: "PARÁGRAFO ÚNICO -", bold: true },
    " A ",
    { text: "CONTRATANTE", bold: true },
    " efetuará pagamento da remuneração ",
    contrato.tipo === "mensal" ? "mensalmente" : "conforme acordado",
    ", mediante transferência bancária para conta de titularidade do(a) ",
    { text: "CONTRATADO(A)", bold: true },
    `, Banco: ${f.banco || "-"}  Ag.: ${f.agencia || "-"}  CC: ${f.conta || "-"}`,
    temPix && f.pix_chave ? `  PIX: ${f.pix_chave}` : "",
    ", e o comprovante de transferência bancária valerá como recibo de pagamento.",
  ]);

  const clausulaQuarta = paragraph([
    { text: "CLÁUSULA QUARTA –", bold: true },
    " As partes se obrigam, a manter a mais estrita confidencialidade e sigilo das informações que vier a obter a respeito da outra e/ou de clientes em função deste Instrumento, mesmo após o término da vigência, e independentemente da forma ou razão que tenha originado o encerramento da relação entre a ",
    { text: "CONTRATANTE", bold: true },
    " e o(a) ",
    { text: "CONTRATADO(A)", bold: true },
  ]);

  const clausulaQuinta = paragraph([
    { text: "CLÁUSULA QUINTA -", bold: true },
    " O presente instrumento contratual poderá ser rescindido a qualquer tempo, mediante notificação formal da parte contrária, desde que a Parte que deseje a resilição esteja adimplente com suas obrigações contratuais.",
  ]);

  const clausulaSexta = paragraph([
    { text: "CLÁUSULA SEXTA -", bold: true },
    " O(A) ",
    { text: "CONTRATADO(A)", bold: true },
    " deverá seguir com as orientações passadas para o cumprimento das atividades e a filosofia de trabalho da empresa.",
  ]);

  const clausulaSetima = paragraph([
    { text: "CLÁUSULA SÉTIMA –", bold: true },
    " O presente contrato, em razão da natureza da atividade, é pontual e específico, não tendo qualquer característica de uma relação empregatícia, seja pela ausência de habitualidade, seja pela ausência de subordinação entre as partes;",
  ]);

  const paragrafoPrimeiro = paragraph([
    { text: "PARÁGRAFO PRIMEIRO –", bold: true },
    " As partes declararam que a vinculação jurídica estabelecida se restringe às previsões contidas na legislação civil em vigor, inexistindo qualquer vinculação laboral ou qualquer relação de dependência entre as partes ou ainda de exclusividade, podendo cada parte estabelecer novos contratos nos mesmos moldes, desde que respeitadas as disposições contidas neste instrumento;",
  ]);

  const paragrafoSegundo = paragraph([
    { text: "PARÁGRAFO SEGUNDO –", bold: true },
    " As partes declaram ainda que não respondem de forma solidária ou subsidiária em favor da outra em nenhuma condição ou circunstância, sendo ambas absolutamente independentes em suas decisões, respondendo cada uma por suas ações em todo e qualquer tempo;",
  ]);

  const clausulaOitava = paragraph([
    { text: "CLÁUSULA OITAVA -", bold: true },
    " As Partes concordam em assinar o presente Contrato por meio de plataformas de assinatura eletrônica ou digital, admitindo expressamente tal meio como válido, nos termos do permissivo contido no § 2º do artigo 10 da Medida Provisória nº 2.200-2/2001. Fica dispensada a obrigatoriedade do uso de assinaturas, das Partes e/ou das testemunhas, por meio de certificados emitidos pela ICP-Brasil, nos mesmos termos do dispositivo mencionado no item acima, concordando as Partes que qualquer meio idôneo de certificação digital de autoria e integridade deste Instrumento será válido com comprovação de suas assinaturas.",
  ]);

  const clausulaNona = paragraph([
    { text: "CLÁUSULA NONA -", bold: true },
    " Fica eleito o Foro da Comarca de Salvador - BA para dirimir quaisquer dúvidas oriundas do presente Contrato, com renúncia expressa a qualquer outro, por mais privilegiado que possa ser.",
  ]);

  const fecho = paragraph([
    "E, por estarem assim justas e contratadas as Partes, firmam o presente Contrato na presença das duas testemunhas abaixo assinadas.",
  ]);

  const localData = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 280, after: 280 },
    children: [
      new TextRun({
        text: `${cidadeAssinatura} – ${uf} (Salvador – BA), ${dataAssinaturaExt}.`,
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

  const testemunhasTabela = new Table({
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

  const espacoAntesTestemunhas = new Paragraph({
    spacing: { before: 1600, after: 0 },
    children: [new TextRun({ text: "" })],
  });

  const doc = new Document({
    creator: "Agência California",
    title: `Contrato ${nomeJob} - ${nome}`,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 20 },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1000,
              bottom: 900,
              left: 1200,
              right: 1200,
            },
          },
        },
        headers: {
          default: new Header({ children: [emptyLine()] }),
        },
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
          paragrafoPreambulo,
          paragrafoPactuam,
          clausulaPrimeira,
          clausulaSegunda,
          clausulaTerceira,
          paragrafoUnico,
          clausulaQuarta,
          clausulaQuinta,
          clausulaSexta,
          clausulaSetima,
          paragrafoPrimeiro,
          paragrafoSegundo,
          clausulaOitava,
          clausulaNona,
          fecho,
          localData,
          assinaturaEmpresa,
          assinaturaContratado,
          espacoAntesTestemunhas,
          testemunhasTabela,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
