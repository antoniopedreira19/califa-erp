import PdfPrinter from "pdfmake/src/printer";
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces";
import fs from "node:fs";
import path from "node:path";
import type {
  PedidoCompra,
  Empresa,
  Fornecedor,
  Job,
  Projeto,
  Orcamento,
  Cliente,
} from "@/lib/types";

// Fontes stock do pdfmake (bundled com o pacote em vfs_fonts).
// Usa Helvetica (built-in) — sem custom fonts pra manter bundle enxuto.
const printer = new PdfPrinter({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});

// Cache do logo em base64 (le do disco 1x por processo)
let LOGO_BASE64: string | null = null;
function getLogoBase64(): string {
  if (LOGO_BASE64) return LOGO_BASE64;
  const logoPath = path.join(process.cwd(), "public", "brand", "logo-icon.png");
  const buffer = fs.readFileSync(logoPath);
  LOGO_BASE64 = `data:image/png;base64,${buffer.toString("base64")}`;
  return LOGO_BASE64;
}

// Formatters
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
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
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
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return digits;
}

// Estilos de faixa (labels de secao)
function faixaTitulo(texto: string): Content {
  return {
    text: texto,
    style: "faixa",
    alignment: "center",
    fillColor: "#e5e5e5",
    margin: [0, 4, 0, 4],
  };
}

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
  >;
  empresa: Empresa;
  fornecedor: Fornecedor;
  job: Pick<Job, "nome" | "produto">;
  projeto: Pick<Projeto, "codigo" | "campanha">;
  orcamento: Pick<Orcamento, "codigo">;
  cliente: Pick<Cliente, "nome_fantasia">;
  responsavelNome: string;
}

export async function renderPedidoCompraPDF(dados: Dados): Promise<Buffer> {
  const { pp, empresa, fornecedor, job, projeto, orcamento, cliente, responsavelNome } = dados;

  const logo = getLogoBase64();

  const enderecoEmpresa = [
    empresa.logradouro,
    empresa.numero,
    empresa.complemento,
    empresa.bairro,
  ]
    .filter(Boolean)
    .join(", ");

  const enderecoFornecedor = [
    fornecedor.logradouro,
    fornecedor.numero,
    fornecedor.complemento,
    fornecedor.bairro,
  ]
    .filter(Boolean)
    .join(", ");

  const content: Content[] = [
    // 1. HEADER — logo + dados California | box PP + codigo
    {
      columns: [
        {
          width: "60%",
          stack: [
            { image: logo, width: 60, margin: [0, 0, 0, 4] },
            { text: empresa.razao_social, bold: true, fontSize: 9 },
            { text: enderecoEmpresa, fontSize: 8 },
            {
              text: `${fmtCEP(empresa.cep)} ${empresa.cidade} - ${empresa.uf}`,
              fontSize: 8,
            },
            {
              text: `FONE ${fmtFone(empresa.telefone)}`,
              fontSize: 8,
            },
            { text: `CNPJ: ${fmtCNPJ(empresa.cnpj)}`, fontSize: 8 },
            {
              text: `Inscricao Estadual: ${empresa.inscricao_estadual ?? "ISENTO"}`,
              fontSize: 8,
            },
            {
              text: `Inscricao Municipal: ${empresa.inscricao_municipal ?? ""}`,
              fontSize: 8,
            },
            { text: `E-mail: ${empresa.email ?? ""}`, fontSize: 8 },
          ],
        },
        {
          width: "40%",
          stack: [
            {
              text: "Pedido de Producao",
              alignment: "center",
              bold: true,
              fontSize: 12,
              margin: [0, 20, 0, 8],
            },
            {
              text: pp.codigo,
              alignment: "center",
              bold: true,
              fontSize: 20,
            },
          ],
        },
      ],
      margin: [0, 0, 0, 8],
    },

    // 2. GRID metadata (Cliente/Fornecedor/Emissao | Produto/Orcamento/Projeto | Titulo/Campanha)
    {
      columns: [
        {
          width: "60%",
          stack: [
            { text: [{ text: "Cliente: ", bold: true }, cliente.nome_fantasia], fontSize: 9 },
            { text: [{ text: "Fornecedor: ", bold: true }, fornecedor.razao_social ?? fornecedor.nome], fontSize: 9 },
            { text: [{ text: "Produto: ", bold: true }, job.produto ?? ""], fontSize: 9 },
            { text: [{ text: "Titulo: ", bold: true }, job.nome], fontSize: 9 },
            { text: [{ text: "Campanha: ", bold: true }, projeto.campanha ?? ""], fontSize: 9 },
          ],
        },
        {
          width: "40%",
          stack: [
            { text: [{ text: "Emissao: ", bold: true }, fmtDate(pp.created_at)], fontSize: 9 },
            { text: [{ text: "Orcamento: ", bold: true }, orcamento.codigo], fontSize: 9 },
            { text: [{ text: "Projeto: ", bold: true }, projeto.codigo], fontSize: 9 },
          ],
        },
      ],
      margin: [0, 0, 0, 8],
    },

    // 3. Faixa SOLICITAMOS
    faixaTitulo("SOLICITAMOS POR ORDEM DO SACADO, O SEGUINTE SERVICO"),

    // 4. Servico + quantidade + prazo pagto
    {
      columns: [
        { width: "70%", text: [{ text: "Servico: ", bold: true }, pp.servico], fontSize: 9 },
        { width: "30%", text: [{ text: "Quantidade: ", bold: true }, String(pp.quantidade)], fontSize: 9 },
      ],
      margin: [0, 4, 0, 4],
    },
    {
      text: [{ text: "Prazo de Pagto: ", bold: true }, fmtDate(pp.prazo_pagamento)],
      fontSize: 9,
      margin: [0, 0, 0, 8],
    },

    // 5. Especificacoes (condicional)
    ...(pp.especificacoes && pp.especificacoes.trim()
      ? [
          faixaTitulo("ESPECIFICACOES DO SERVICO"),
          {
            text: pp.especificacoes,
            fontSize: 9,
            margin: [0, 4, 0, 8],
          } as Content,
        ]
      : []),

    // 6. Dados para faturamento (empresa emissora)
    faixaTitulo("DADOS PARA FATURAMENTO DA COBRANCA"),
    {
      columns: [
        {
          width: "60%",
          stack: [
            { text: [{ text: "Nome do Sacado: ", bold: true }, empresa.razao_social], fontSize: 9 },
            { text: [{ text: "Endereco: ", bold: true }, enderecoEmpresa], fontSize: 9 },
            { text: [{ text: "Municipio: ", bold: true }, empresa.cidade], fontSize: 9 },
            {
              text: [
                { text: "Local de Pagto: ", bold: true },
                empresa.local_pagamento ?? enderecoEmpresa,
              ],
              fontSize: 9,
            },
            { text: [{ text: "CNPJ: ", bold: true }, fmtCNPJ(empresa.cnpj)], fontSize: 9 },
          ],
        },
        {
          width: "40%",
          stack: [
            { text: [{ text: "CEP: ", bold: true }, fmtCEP(empresa.cep)], fontSize: 9 },
            { text: [{ text: "UF: ", bold: true }, empresa.uf], fontSize: 9 },
            { text: [{ text: "Telefone: ", bold: true }, fmtFone(empresa.telefone)], fontSize: 9 },
            {
              text: [
                { text: "IE: ", bold: true },
                empresa.inscricao_estadual ?? "ISENTO",
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "IM: ", bold: true },
                empresa.inscricao_municipal ?? "",
              ],
              fontSize: 9,
            },
          ],
        },
      ],
      margin: [0, 4, 0, 8],
    },

    // 7. Dados bancarios fornecedor
    faixaTitulo("DADOS BANCARIOS DO FORNECEDOR PARA PAGAMENTO"),
    {
      columns: [
        {
          width: "50%",
          stack: [
            {
              text: [
                { text: "Banco: ", bold: true },
                `${fornecedor.banco_codigo ?? ""} - ${fornecedor.banco_nome ?? ""}`,
              ],
              fontSize: 9,
            },
            { text: [{ text: "Agencia: ", bold: true }, fornecedor.agencia ?? ""], fontSize: 9 },
            { text: [{ text: "Conta: ", bold: true }, `${fornecedor.conta ?? ""}${fornecedor.conta_dv ? "-" + fornecedor.conta_dv : ""}`], fontSize: 9 },
            { text: [{ text: "Tipo de Conta: ", bold: true }, fornecedor.tipo_conta ?? ""], fontSize: 9 },
          ],
        },
        {
          width: "50%",
          stack: [
            {
              text: [
                { text: "Nome: ", bold: true },
                fornecedor.razao_social ?? fornecedor.nome,
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "CNPJ/CPF: ", bold: true },
                fmtCPFCNPJ(fornecedor.cpf_cnpj),
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "Tipo de Chave PIX: ", bold: true },
                fornecedor.pix_tipo ?? "",
              ],
              fontSize: 9,
            },
            {
              text: [
                { text: "Chave PIX: ", bold: true },
                fornecedor.pix_chave ?? "",
              ],
              fontSize: 9,
            },
          ],
        },
      ],
      margin: [0, 4, 0, 8],
    },

    // 8. VALOR destacado
    {
      table: {
        widths: ["*"],
        body: [
          [
            {
              text: [
                { text: "Valor:  ", bold: true, fontSize: 12 },
                { text: fmtBRL(pp.valor), bold: true, fontSize: 14 },
              ],
              alignment: "right",
              fillColor: "#e5e5e5",
              margin: [8, 6, 8, 6],
            },
          ],
        ],
      },
      layout: "noBorders",
      margin: [0, 4, 0, 8],
    },

    // 9. Dados do fornecedor (endereco/contato)
    faixaTitulo("DADOS DO FORNECEDOR"),
    {
      columns: [
        {
          width: "60%",
          stack: [
            {
              text: [
                { text: "Razao Social: ", bold: true },
                fornecedor.razao_social ?? fornecedor.nome,
              ],
              fontSize: 9,
            },
            { text: [{ text: "Endereco: ", bold: true }, enderecoFornecedor], fontSize: 9 },
            {
              text: [
                { text: "Municipio: ", bold: true },
                `${fornecedor.cidade ?? ""}/${fornecedor.uf ?? ""} CEP: ${fmtCEP(fornecedor.cep)}`,
              ],
              fontSize: 9,
            },
            { text: [{ text: "CNPJ/CPF: ", bold: true }, fmtCPFCNPJ(fornecedor.cpf_cnpj)], fontSize: 9 },
            { text: [{ text: "E-mail: ", bold: true }, fornecedor.email ?? ""], fontSize: 9 },
          ],
        },
        {
          width: "40%",
          stack: [
            { text: [{ text: "Fone: ", bold: true }, fmtFone(fornecedor.telefone)], fontSize: 9 },
          ],
        },
      ],
      margin: [0, 4, 0, 20],
    },

    // 10. Assinaturas (footer)
    {
      columns: [
        {
          width: "50%",
          stack: [
            { text: "Concordamos com as condicoes do presente pedido.", alignment: "center", fontSize: 8, margin: [0, 20, 0, 20] },
            { canvas: [{ type: "line", x1: 30, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }] },
            { text: "Assinatura do Fornecedor", alignment: "center", fontSize: 8, margin: [0, 4, 0, 0] },
          ],
        },
        {
          width: "50%",
          stack: [
            { text: empresa.razao_social, alignment: "center", fontSize: 8, margin: [0, 20, 0, 20] },
            { canvas: [{ type: "line", x1: 30, y1: 0, x2: 220, y2: 0, lineWidth: 0.5 }] },
            {
              text: [
                { text: "Assinatura do resp. pelo pedido\n", fontSize: 8 },
                { text: responsavelNome.toUpperCase(), fontSize: 8, bold: true },
              ],
              alignment: "center",
              margin: [0, 4, 0, 0],
            },
          ],
        },
      ],
    },
  ];

  const docDefinition: TDocumentDefinitions = {
    pageSize: "A4",
    pageMargins: [30, 30, 30, 30],
    content,
    defaultStyle: { font: "Helvetica", fontSize: 9 },
    styles: {
      faixa: { bold: true, fontSize: 10 },
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: empresa.razao_social, alignment: "left", fontSize: 7, margin: [30, 0, 0, 0] },
        { text: `Pagina: ${currentPage}/${pageCount}`, alignment: "center", fontSize: 7 },
        { text: `Data ${fmtDate(pp.created_at)}`, alignment: "right", fontSize: 7, margin: [0, 0, 30, 0] },
      ],
    }),
  };

  return new Promise((resolve, reject) => {
    try {
      const doc = printer.createPdfKitDocument(docDefinition);
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
