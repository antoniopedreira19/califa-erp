declare module "pdfmake/src/printer" {
  import type { TDocumentDefinitions } from "pdfmake/interfaces";

  interface PdfKitDocument extends NodeJS.ReadableStream {
    end(): void;
  }

  export default class PdfPrinter {
    constructor(fontDescriptors: Record<string, unknown>);
    createPdfKitDocument(docDefinition: TDocumentDefinitions): PdfKitDocument;
  }
}
