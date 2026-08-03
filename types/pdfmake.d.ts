declare module "pdfmake/src/printer" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface PdfKitDocument extends NodeJS.ReadableStream {
    end(): void;
  }

  // pdfmake 0.2.x (LTS estável) — construtor recebe só fontDescriptors,
  // createPdfKitDocument é síncrono e retorna stream diretamente.
  export default class PdfPrinter {
    constructor(fontDescriptors: Record<string, unknown>);
    createPdfKitDocument(docDefinition: TDocumentDefinitions): PdfKitDocument;
  }
}
