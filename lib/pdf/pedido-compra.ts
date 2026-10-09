// pdfmake 0.2.10 (LTS estável). A 0.3.x é uma rewrite major com API async
// que exige urlResolver custom no construtor — não é drop-in do 0.2.x.
// Path `src/printer` (p minúsculo) — é o "main" no package.json do 0.2.x.
import PdfPrinter from "pdfmake/src/printer";
import type {
  TDocumentDefinitions,
  Content,
  TableCell,
  CustomTableLayout,
} from "pdfmake/interfaces";
import type {
  PedidoCompra,
  Empresa,
  Fornecedor,
  Job,
  Projeto,
  Cliente,
} from "@/lib/types";
// Logo embed como base64: em serverless Vercel, `public/` não é copiado
// pro filesystem da função runtime (ENOENT). Base64 no bundle resolve.
import { LOGO_ICON_BASE64 } from "./logo-base64";

// Lazy init do PdfPrinter — evita executar top-level side-effect ao
// importar este módulo.
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

// ===== Formatters =====

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}
function fmtCNPJ(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length !== 14) return digits;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function fmtCPFCNPJ(digits: string | null): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length === 11)
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return fmtCNPJ(d);
  return digits;
}
function fmtCEP(digits: string | null): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length !== 8) return digits;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}
function fmtFone(digits: string | null): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length === 10)
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11)
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return digits;
}

// ===== Helpers de layout =====

// Layout com bordas finas cinza escuro (visual do modelo de referência).
const BORDA: CustomTableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => "#333",
  vLineColor: () => "#333",
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2,
  paddingBottom: () => 2,
};

// Layout sem bordas (para faixa de título de seção).
const SEM_BORDA: CustomTableLayout = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};

// Célula label+valor no formato "Label: valor" (label em bold).
// Retorna Content pra funcionar tanto como TableCell (dentro de table.body)
// quanto como item de stack (dentro de outra célula).
function lv(label: string, valor: string | null | undefined): Content {
  return {
    text: [
      { text: `${label}: `, bold: true },
      { text: valor ?? "", bold: false },
    ],
    fontSize: 8,
  };
}

// Cabeçalho de seção — linha única cinza escuro, texto branco centralizado.
function secaoHeader(texto: string): Content {
  return {
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: texto,
            alignment: "center",
            bold: true,
            color: "white",
            fillColor: "#444",
            fontSize: 8,
            margin: [0, 3, 0, 3],
          },
        ],
      ],
    },
    layout: SEM_BORDA,
    margin: [0, 0, 0, 0],
  };
}

// ===== Componente principal =====

interface Dados {
  pp: Pick<
    PedidoCompra,
    | "codigo"
    | "servico"
    | "quantidade"
    | "especificacoes"
    | "valor"
    | "prazo_pagamento"
    | "created_at"
  > & {
    /** Quando true, o PDF troca "Fornecedor" por "Responsável" nos blocos,
     * omite os DADOS BANCÁRIOS (verba é interna, não paga fornecedor) e usa
     * `responsavelVerbaNome` no lugar do nome do fornecedor. */
    verba_producao?: boolean;
  };
  /** Decisão 161: a PP paga por boleto. O documento continua o de sempre;
   *  só a linha do PIX vira "Pagamento: Boleto". */
  pagamentoPorBoleto?: boolean;
  empresa: Empresa;
  /** Null quando `pp.verba_producao === true` — não há fornecedor. */
  fornecedor: Fornecedor | null;
  /** Nome do responsável interno da verba. Obrigatório quando `pp.verba_producao === true`. */
  responsavelVerbaNome?: string | null;
  job: Pick<Job, "codigo" | "nome" | "produto">;
  /** Só a campanha: o código do projeto saiu do documento em 29/09/2026 —
   *  o código da PP é o do JOB (decisão 126). */
  projeto: Pick<Projeto, "campanha">;
  cliente: Pick<Cliente, "nome_fantasia">;
  responsavelNome: string;
  /**
   * TODAS as parcelas da PP, em ordem de número — sempre ao menos uma.
   *
   * Desde 28/09/2026 (decisão 112) a PP tem UM documento só, com todas as
   * parcelas: o financeiro aprova a PP inteira, e as parcelas seguem
   * juntas para Títulos a Pagar. De 17/08 a 28/09 a emissão arquivava um
   * PDF por parcela, cada um mostrando só o valor dele e o total — as PPs
   * daquele período guardam esses documentos como foram emitidos.
   *
   * Parcela única sai com o desenho de sempre (Prazo de Pagto, "Parcela:
   * 1/1" e "Valor"). Parcelada troca o prazo e a linha da parcela por
   * "Parcelas: N" e ganha a tabela PARCELAS DO PEDIDO, com o valor total
   * do pedido em destaque embaixo.
   */
  parcelas: Array<{
    numero: number;
    data_vencimento: string;
    valor: number;
  }>;
}

export async function renderPedidoCompraPDF(dados: Dados): Promise<Buffer> {
  const {
    pp,
    empresa,
    fornecedor,
    responsavelVerbaNome,
    job,
    projeto,
    cliente,
    responsavelNome,
    parcelas,
    pagamentoPorBoleto,
  } = dados;

  const parcelada = parcelas.length > 1;
  const primeira = parcelas[0];

  const isVerba = pp.verba_producao === true;

  // Nome do contraparte pra usar nos blocos de identificação. Em verba,
  // é o responsável interno; nas demais, o fornecedor externo.
  const nomeContraparte = isVerba
    ? (responsavelVerbaNome ?? "")
    : (fornecedor?.razao_social ?? fornecedor?.nome ?? "");

  const enderecoEmpresa = [
    empresa.logradouro,
    empresa.numero,
    empresa.complemento,
    empresa.bairro,
  ]
    .filter(Boolean)
    .join(", ");

  // Endereço/CNPJ/etc só existem em fornecedor externo. Verba usa dados
  // internos e não estampa nada disso.
  const enderecoFornecedor = fornecedor
    ? [
        fornecedor.logradouro,
        fornecedor.numero,
        fornecedor.complemento,
        fornecedor.bairro,
      ]
        .filter(Boolean)
        .join(", ")
    : "";

  // ===== 1. HEADER — logo | dados empresa | box PP =====
  const headerTable: Content = {
    table: {
      widths: [80, "*", 130],
      body: [
        [
          {
            image: LOGO_ICON_BASE64,
            width: 60,
            alignment: "center",
            margin: [0, 8, 0, 8],
          },
          {
            stack: [
              {
                text: empresa.razao_social,
                bold: true,
                fontSize: 9,
                margin: [0, 2, 0, 1],
              },
              { text: enderecoEmpresa, fontSize: 8 },
              {
                text: `${fmtCEP(empresa.cep)} ${empresa.cidade ?? ""} - ${empresa.uf ?? ""}`,
                fontSize: 8,
              },
              {
                text: `FONE ${fmtFone(empresa.telefone)}`,
                fontSize: 8,
              },
              {
                text: `CNPJ: ${fmtCNPJ(empresa.cnpj)}`,
                fontSize: 8,
              },
              {
                text: `Inscrição Estadual: ${empresa.inscricao_estadual ?? "ISENTO"}`,
                fontSize: 8,
              },
              {
                text: `Inscrição Municipal: ${empresa.inscricao_municipal ?? ""}`,
                fontSize: 8,
              },
              { text: `E-mail: ${empresa.email ?? ""}`, fontSize: 8 },
            ],
            margin: [4, 4, 4, 4],
          },
          {
            stack: [
              {
                text: "Pedido de Produção",
                alignment: "center",
                bold: true,
                fontSize: 10,
                margin: [0, 10, 0, 6],
              },
              {
                text: pp.codigo,
                alignment: "center",
                bold: true,
                fontSize: 18,
                margin: [0, 0, 0, 6],
              },
            ],
          },
        ],
      ],
    },
    layout: BORDA,
    margin: [0, 0, 0, 0],
  };

  // ===== 2. METADATA (Cliente/Fornecedor/... | Emissão/Job) =====
  const metadataTable: Content = {
    table: {
      widths: ["50%", "50%"],
      body: [
        [
          {
            stack: [
              lv("Cliente", cliente.nome_fantasia),
              lv(
                isVerba ? "Responsável" : "Fornecedor",
                nomeContraparte,
              ),
              lv("Marca", job.produto ?? ""),
              lv("Título", job.nome),
              lv("Campanha", projeto.campanha ?? ""),
            ],
          },
          {
            stack: [
              lv("Emissão", fmtDate(pp.created_at)),
              // O código do JOB, e só ele: é o que a produção e o
              // financeiro usam para falar do trabalho. O do orçamento é só
              // da base de dados (decisão 121) e o do projeto saiu também
              // (decisão 126).
              lv("Job", job.codigo),
            ],
          },
        ],
      ],
    },
    layout: BORDA,
    margin: [0, 0, 0, 0],
  };

  // ===== 3. Serviço + Quantidade + Prazo pagamento =====
  // Parcelada: o prazo de cada parcela está na tabela PARCELAS DO PEDIDO,
  // então aqui fica só quantas são.
  const servicoTable: Content = {
    table: {
      widths: ["70%", "30%"],
      body: [
        [
          lv("Serviço", pp.servico),
          lv("Quantidade", String(pp.quantidade)),
        ],
        ...(parcelada
          ? [[{ text: "", fontSize: 8 }, lv("Parcelas", String(parcelas.length))]]
          : [
              [
                { text: "", fontSize: 8 },
                lv("Prazo de Pagto", fmtDate(primeira?.data_vencimento ?? pp.prazo_pagamento)),
              ],
              [{ text: "", fontSize: 8 }, lv("Parcela", "1/1")],
            ]),
      ],
    },
    layout: BORDA,
    margin: [0, 0, 0, 0],
  };

  // ===== 4. Especificações (condicional) =====
  const especificacoesBloco: Content[] =
    pp.especificacoes && pp.especificacoes.trim()
      ? [
          secaoHeader("ESPECIFICAÇÕES DO SERVIÇO"),
          {
            table: {
              widths: ["*"],
              body: [
                [
                  {
                    text: pp.especificacoes,
                    fontSize: 8,
                    margin: [0, 2, 0, 2],
                  },
                ],
              ],
            },
            layout: BORDA,
            margin: [0, 0, 0, 0],
          },
        ]
      : [];

  // ===== 5. DADOS PARA FATURAMENTO DA COBRANÇA =====
  const faturamentoTable: Content = {
    table: {
      widths: ["18%", "32%", "18%", "32%"],
      body: [
        [
          { text: "Nome do Sacado:", bold: true, fontSize: 8 },
          {
            text: empresa.razao_social,
            colSpan: 3,
            fontSize: 8,
          },
          { text: "" },
          { text: "" },
        ],
        [
          { text: "Endereço:", bold: true, fontSize: 8 },
          { text: enderecoEmpresa, fontSize: 8 },
          { text: "CEP:", bold: true, fontSize: 8 },
          { text: fmtCEP(empresa.cep), fontSize: 8 },
        ],
        [
          { text: "Município:", bold: true, fontSize: 8 },
          { text: empresa.cidade ?? "", fontSize: 8 },
          { text: "UF:", bold: true, fontSize: 8 },
          { text: empresa.uf ?? "", fontSize: 8 },
        ],
        [
          { text: "Local de Pagto:", bold: true, fontSize: 8 },
          {
            text: empresa.local_pagamento ?? enderecoEmpresa,
            colSpan: 3,
            fontSize: 8,
          },
          { text: "" },
          { text: "" },
        ],
        [
          { text: "E-mail:", bold: true, fontSize: 8 },
          { text: empresa.email ?? "", fontSize: 8 },
          { text: "Telefone:", bold: true, fontSize: 8 },
          { text: fmtFone(empresa.telefone), fontSize: 8 },
        ],
        [
          { text: "CNPJ:", bold: true, fontSize: 8 },
          { text: fmtCNPJ(empresa.cnpj), fontSize: 8 },
          { text: "Insc. Estadual:", bold: true, fontSize: 8 },
          { text: empresa.inscricao_estadual ?? "ISENTO", fontSize: 8 },
        ],
        [
          { text: "", fontSize: 8 },
          { text: "", fontSize: 8 },
          { text: "Insc. Municipal:", bold: true, fontSize: 8 },
          { text: empresa.inscricao_municipal ?? "", fontSize: 8 },
        ],
      ],
    },
    layout: BORDA,
    margin: [0, 0, 0, 0],
  };

  // ===== 6. DADOS BANCÁRIOS DO FORNECEDOR =====
  // Verba de Produção não paga fornecedor externo — o dinheiro vai pro
  // caixa do responsável, então esta seção não existe pra ela.
  const bancoLabel = fornecedor
    ? [fornecedor.banco_codigo, fornecedor.banco_nome].filter(Boolean).join(" - ")
    : "";
  const contaCompleta = fornecedor
    ? `${fornecedor.conta ?? ""}${fornecedor.conta_dv ? "-" + fornecedor.conta_dv : ""}`
    : "";
  const bancariosBloco: Content[] = isVerba
    ? []
    : [
        secaoHeader("DADOS BANCÁRIOS DO FORNECEDOR PARA PAGAMENTO"),
        {
          table: {
            widths: ["18%", "32%", "18%", "32%"],
            body: [
              [
                { text: "Banco:", bold: true, fontSize: 8 },
                { text: bancoLabel, fontSize: 8 },
                { text: "Agência:", bold: true, fontSize: 8 },
                { text: fornecedor?.agencia ?? "", fontSize: 8 },
              ],
              [
                { text: "Conta:", bold: true, fontSize: 8 },
                { text: contaCompleta, fontSize: 8 },
                { text: "Tipo de Conta:", bold: true, fontSize: 8 },
                { text: fornecedor?.tipo_conta ?? "", fontSize: 8 },
              ],
              [
                { text: "Nome:", bold: true, fontSize: 8 },
                { text: nomeContraparte, fontSize: 8 },
                { text: "CNPJ/CPF:", bold: true, fontSize: 8 },
                { text: fmtCPFCNPJ(fornecedor?.cpf_cnpj ?? null), fontSize: 8 },
              ],
              pagamentoPorBoleto
                ? [
                    { text: "Pagamento:", bold: true, fontSize: 8 },
                    { text: "Boleto", bold: true, colSpan: 3, fontSize: 8 },
                    { text: "" },
                    { text: "" },
                  ]
                : [
                    { text: "Tipo de Chave PIX:", bold: true, fontSize: 8 },
                    { text: fornecedor?.pix_tipo ?? "", fontSize: 8 },
                    { text: "Chave PIX:", bold: true, fontSize: 8 },
                    { text: fornecedor?.pix_chave ?? "", fontSize: 8 },
                  ],
              [
                { text: "E-mail:", bold: true, fontSize: 8 },
                {
                  text: fornecedor?.email ?? "",
                  colSpan: 3,
                  fontSize: 8,
                },
                { text: "" },
                { text: "" },
              ],
            ],
          },
          layout: BORDA,
          margin: [0, 0, 0, 0],
        } as Content,
      ];

  // ===== 7. PARCELAS + VALOR destacado =====
  // Parcelada: a tabela com todas as parcelas, nenhuma em destaque (o
  // documento é da PP inteira), e o valor total do pedido na faixa cinza
  // fechando a conta. Parcela única: só a faixa, com o valor da PP.
  const parcelasBloco: Content[] = parcelada
    ? [
        secaoHeader("PARCELAS DO PEDIDO"),
        {
          table: {
            widths: ["24%", "38%", "38%"],
            body: [
              [
                { text: "Parcela", bold: true, fontSize: 8 },
                { text: "Prazo de Pagto", bold: true, fontSize: 8 },
                { text: "Valor", bold: true, fontSize: 8, alignment: "right" },
              ],
              ...parcelas.map((p) => [
                { text: `${p.numero}/${parcelas.length}`, fontSize: 8 },
                { text: fmtDate(p.data_vencimento), fontSize: 8 },
                { text: fmtBRL(p.valor), fontSize: 8, alignment: "right" as const },
              ]),
            ],
          },
          layout: BORDA,
          margin: [0, 0, 0, 0],
        } as Content,
      ]
    : [];

  const valorBlock: Content = {
    table: {
      widths: ["*"],
      body: [
        [
          {
            text: [
              {
                text: parcelada ? "Valor total do pedido:  " : "Valor:  ",
                bold: true,
                fontSize: 11,
              },
              { text: fmtBRL(pp.valor), bold: true, fontSize: 13 },
            ],
            alignment: "right",
            fillColor: "#e5e5e5",
            margin: [8, 5, 8, 5],
          },
        ],
      ],
    },
    layout: BORDA,
    margin: [0, 0, 0, 0],
  };

  // ===== 8. DADOS DO FORNECEDOR (ou DO RESPONSÁVEL, quando verba) =====
  const contraparteTable: Content = isVerba
    ? {
        table: {
          widths: ["18%", "*"],
          body: [
            [
              { text: "Nome:", bold: true, fontSize: 8 },
              { text: nomeContraparte, fontSize: 8 },
            ],
            [
              { text: "Natureza:", bold: true, fontSize: 8 },
              {
                text: "Verba de Produção — o dinheiro fica sob responsabilidade do funcionário nomeado acima e será prestado contas ao final.",
                fontSize: 8,
              },
            ],
          ],
        },
        layout: BORDA,
        margin: [0, 0, 0, 0],
      }
    : {
        table: {
          widths: ["18%", "50%", "12%", "20%"],
          body: [
            [
              { text: "Razão Social:", bold: true, fontSize: 8 },
              { text: nomeContraparte, fontSize: 8 },
              { text: "Fone:", bold: true, fontSize: 8 },
              { text: fmtFone(fornecedor?.telefone ?? null), fontSize: 8 },
            ],
            [
              { text: "Endereço:", bold: true, fontSize: 8 },
              {
                text: enderecoFornecedor,
                colSpan: 3,
                fontSize: 8,
              },
              { text: "" },
              { text: "" },
            ],
            [
              { text: "Município:", bold: true, fontSize: 8 },
              {
                text: `${fornecedor?.cidade ?? ""}/${fornecedor?.uf ?? ""} CEP: ${fmtCEP(fornecedor?.cep ?? null)}`,
                colSpan: 3,
                fontSize: 8,
              },
              { text: "" },
              { text: "" },
            ],
            [
              { text: "CNPJ/CPF:", bold: true, fontSize: 8 },
              {
                text: fmtCPFCNPJ(fornecedor?.cpf_cnpj ?? null),
                colSpan: 3,
                fontSize: 8,
              },
              { text: "" },
              { text: "" },
            ],
            [
              { text: "E-mail:", bold: true, fontSize: 8 },
              {
                text: fornecedor?.email ?? "",
                colSpan: 3,
                fontSize: 8,
              },
              { text: "" },
              { text: "" },
            ],
          ],
        },
        layout: BORDA,
        margin: [0, 0, 0, 0],
      };

  // ===== 9. ASSINATURAS =====
  const assinaturasTable: Content = {
    table: {
      widths: ["50%", "50%"],
      body: [
        [
          {
            stack: [
              {
                text: "Concordamos com as condições do presente pedido, inclusive as Notas Importantes",
                alignment: "center",
                fontSize: 8,
                margin: [0, 28, 0, 20],
              },
              {
                canvas: [
                  {
                    type: "line",
                    x1: 30,
                    y1: 0,
                    x2: 220,
                    y2: 0,
                    lineWidth: 0.5,
                  },
                ],
              },
              {
                text: isVerba
                  ? "Assinatura do Responsável"
                  : "Assinatura do Fornecedor",
                alignment: "center",
                fontSize: 8,
                margin: [0, 3, 0, 6],
              },
            ],
          },
          {
            stack: [
              {
                text: empresa.razao_social,
                alignment: "center",
                fontSize: 8,
                margin: [0, 28, 0, 20],
              },
              {
                canvas: [
                  {
                    type: "line",
                    x1: 30,
                    y1: 0,
                    x2: 220,
                    y2: 0,
                    lineWidth: 0.5,
                  },
                ],
              },
              {
                text: "Assinatura do resp. pelo pedido",
                alignment: "center",
                fontSize: 8,
                margin: [0, 3, 0, 1],
              },
              {
                text: responsavelNome.toUpperCase(),
                alignment: "center",
                fontSize: 8,
                bold: true,
                margin: [0, 0, 0, 6],
              },
            ],
          },
        ],
      ],
    },
    layout: BORDA,
    margin: [0, 0, 0, 0],
  };

  // ===== Composição final =====
  const content: Content[] = [
    headerTable,
    metadataTable,
    secaoHeader("SOLICITAMOS POR ORDEM DO SACADO, O SEGUINTE SERVIÇO"),
    servicoTable,
    ...especificacoesBloco,
    secaoHeader("DADOS PARA FATURAMENTO DA COBRANÇA"),
    faturamentoTable,
    ...bancariosBloco,
    ...parcelasBloco,
    valorBlock,
    secaoHeader(isVerba ? "DADOS DO RESPONSÁVEL" : "DADOS DO FORNECEDOR"),
    contraparteTable,
    { text: "", margin: [0, 6, 0, 0] }, // espaço antes das assinaturas
    assinaturasTable,
  ];

  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [25, 25, 25, 35],
    content,
    defaultStyle: { font: "Helvetica", fontSize: 8 },
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: empresa.razao_social,
          alignment: "left",
          fontSize: 7,
          margin: [25, 0, 0, 0],
        },
        {
          text: `Página: ${currentPage}/${pageCount}`,
          alignment: "center",
          fontSize: 7,
        },
        {
          text: `Data ${fmtDate(pp.created_at)}`,
          alignment: "right",
          fontSize: 7,
          margin: [0, 0, 25, 0],
        },
      ],
    }),
  };

  // pdfmake 0.2.x: createPdfKitDocument é síncrono e retorna direto o stream.
  return new Promise((resolve, reject) => {
    try {
      const doc = getPrinter().createPdfKitDocument(docDefinition);
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
