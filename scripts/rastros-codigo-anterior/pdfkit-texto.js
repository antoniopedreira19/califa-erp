// Texto de um PDF pelo PDFKit da Apple (independente do extrator do projeto).
// Uso: osascript -l JavaScript pdfkit-texto.js <arquivo.pdf>
ObjC.import("PDFKit");
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const doc = $.PDFDocument.alloc.initWithURL(url);
  if (!doc || doc.isNil()) return "ERRO: não abriu " + argv[0];
  const partes = [];
  for (let i = 0; i < doc.pageCount; i++) {
    partes.push(ObjC.unwrap(doc.pageAtIndex(i).string));
  }
  return partes.join("\n<<PAGINA>>\n");
}
