/** Leitura do XLSX que chega por FormData.
 *
 *  Vive fora das Server Actions porque duas telas importam a mesma
 *  planilha com as mesmas regras: a versão do orçamento (que grava na
 *  hora) e o editor de orçamento do projeto (que só faz o parse e guarda
 *  o resultado no rascunho). Limite de tamanho e extensão aceita têm que
 *  ser os mesmos nas duas — se divergirem, um arquivo aprovado no preview
 *  falha no salvamento.
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB — planilhas típicas <500 KB

export interface ArquivoImportado {
  buffer: Buffer;
  nome: string;
  tamanho: number;
}

export type ExtracaoArquivo =
  | ({ ok: true } & ArquivoImportado)
  | { ok: false; message: string };

export async function extrairArquivoXlsx(
  formData: FormData,
  campo = "arquivo",
): Promise<ExtracaoArquivo> {
  const arquivo = formData.get(campo);
  if (!(arquivo instanceof File)) {
    return { ok: false, message: "Nenhum arquivo enviado." };
  }
  if (arquivo.size === 0) {
    return { ok: false, message: "Arquivo vazio." };
  }
  if (arquivo.size > MAX_BYTES) {
    return {
      ok: false,
      message: `Arquivo maior que ${MAX_BYTES / 1024 / 1024} MB. Reduza antes de enviar.`,
    };
  }
  const nome = arquivo.name.toLowerCase();
  if (!nome.endsWith(".xlsx") && !nome.endsWith(".xlsm")) {
    return {
      ok: false,
      message: "Apenas arquivos .xlsx são aceitos. Salve como Excel e reenvie.",
    };
  }
  const buffer = Buffer.from(await arquivo.arrayBuffer());
  return { ok: true, buffer, nome: arquivo.name, tamanho: arquivo.size };
}
