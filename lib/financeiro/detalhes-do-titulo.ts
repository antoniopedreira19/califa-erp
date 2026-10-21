/**
 * O que o ⓘ das planilhas de títulos mostra (decisão 195, variante A): só o
 * que a linha não tem. A linha já traz data, valor, descrição, fornecedor,
 * job, centro, trimestre, empresa e regional; o pop-up acrescenta a trilha
 * da origem, para onde vai o dinheiro, os documentos e, quando há mais de
 * uma, de onde vem o dinheiro.
 *
 * Lido só quando o ⓘ abre (`carregarDetalhesDoTitulo`), para as listas não
 * carregarem a trilha e os documentos de todos os títulos.
 */

/** Um documento do título. O de "origem" é o interno (a PP, a nota que a
 *  agência emitiu); o de "pagamento", o que paga (a NF do fornecedor, o
 *  orçamento, o boleto, a guia). */
export interface DocumentoDoDetalhe {
  grupo: "origem" | "pagamento";
  tipo: string;
  arquivo: string;
  url: string | null;
  imagem: boolean;
}

export interface DetalhesDoTitulo {
  /** O código no cabeçalho do pop-up ("PP-00044", "FC-00004"). */
  referencia: string;
  /** A trilha da origem: pedida, aprovada, emitida… */
  trilha: string[];
  /** "1 de 2"; nulo em parcela única. */
  parcela: string | null;
  /** O grupo "Pagamento" ou "Recebimento": a forma e o detalhe dela (a
   *  chave PIX, a linha do boleto, a guia, o cartão). */
  pagamento: { linha: string; detalhe: string | null };
  /** A nota que cobre mais de um job: quanto cabe a cada um. */
  origensDoDinheiro: Array<{ codigo: string; nome: string; valor: number }>;
  /** O que a baixa reteve na fonte (o ⓘ do Extrato); vazio no título, cuja
   *  retenção vem da linha. */
  retido: Array<{ rotulo: string; valor: number }>;
  /** A baixa com juros e multa (o ⓘ do Extrato, decisão 196): o principal,
   *  que quita o título, e os juros, em 11 · Despesa com Juros. A linha do
   *  Extrato mostra a soma. Nulo sem juros. */
  saidaDaBaixa: { principal: number; juros: number } | null;
  documentos: DocumentoDoDetalhe[];
}

/** "Orçamento do fornecedor", "NF 602 do fornecedor", "Boleto"… pelo tipo
 *  do anexo. */
export function rotuloDoAnexo(tipo: string | null, numero: string | null, nomeArquivo: string): string {
  switch (tipo) {
    case "nota_fiscal":
      return numero ? `NF ${numero} do fornecedor` : "NF do fornecedor";
    case "orcamento":
      return "Orçamento do fornecedor";
    case "boleto":
      return "Boleto";
    case "fatura":
      return "Fatura";
    case "recibo":
      return numero ? `Recibo ${numero}` : "Recibo";
    case "contrato":
      return "Contrato";
    case "cupom_fiscal":
      return "Cupom fiscal";
    default:
      return nomeArquivo || "Documento";
  }
}

export function ehImagem(nome: string, mimetype: string | null): boolean {
  if (mimetype) return mimetype.startsWith("image/");
  return /\.(png|jpe?g|webp|gif)$/i.test(nome);
}

/** O nome do arquivo no fim do caminho do Storage. */
export function nomeDoCaminho(path: string): string {
  return path.split("/").pop() ?? path;
}

/** "PIX · chave CNPJ", pelo tipo gravado na PP. */
export function rotuloDaChavePix(tipo: string | null): string {
  switch (tipo) {
    case "cpf":
      return "PIX · chave CPF";
    case "cnpj":
      return "PIX · chave CNPJ";
    case "email":
      return "PIX · chave e-mail";
    case "telefone":
      return "PIX · chave telefone";
    case "aleatoria":
      return "PIX · chave aleatória";
    default:
      return "PIX";
  }
}
