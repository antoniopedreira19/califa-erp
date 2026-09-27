/**
 * Teto e formato do arquivo de planilha (decisão 110, 27/09/2026).
 *
 * O arquivo vai do navegador DIRETO para o Storage, e o servidor o lê de
 * lá: a planilha não passa mais pelo corpo da Server Action, que a Vercel
 * corta em 4,5 MB (e o Next em 1 MB, o que barrava a planilha da
 * Budweiser, de 1,2 MB). O teto passou a ser o custo de LER o arquivo: 10
 * MB levaram ~10 s e ~860 MB de memória, contra 2 GB da função.
 *
 * Sem dependência de servidor: a tela confere antes de enviar e o servidor
 * confere de novo antes de ler — o limite não pode depender só do cliente.
 */

export const LIMITE_PLANILHA_BYTES = 10 * 1024 * 1024;
export const LIMITE_PLANILHA_ROTULO = "10 MB";

export const TIPO_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function megabytes(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1).replace(".", ",");
}

/** O motivo para recusar o arquivo antes de enviar, ou `null`. */
export function recusaDoArquivo(nome: string, tamanho: number): string | null {
  const minusculo = nome.toLowerCase();
  if (!minusculo.endsWith(".xlsx") && !minusculo.endsWith(".xlsm")) {
    return "Apenas arquivos .xlsx são aceitos. Salve como Excel e reenvie.";
  }
  if (tamanho === 0) return "Arquivo vazio.";
  if (tamanho > LIMITE_PLANILHA_BYTES) {
    return `O arquivo tem ${megabytes(tamanho)} MB, e o limite é ${LIMITE_PLANILHA_ROTULO}. Apague as abas que não serão usadas e envie de novo.`;
  }
  return null;
}
