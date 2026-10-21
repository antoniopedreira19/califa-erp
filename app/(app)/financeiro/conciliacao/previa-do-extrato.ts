/**
 * "Ver no Extrato antes" (decisão 195): os títulos marcados na aba Títulos
 * aparecem no Extrato como linhas previstas, em lilás, onde a baixa vai
 * pô-los — sem gravar nada. A seleção atravessa a troca de aba pela aba do
 * navegador (`sessionStorage`), uma por conta; sem armazenamento, o Extrato
 * só não mostra a prévia.
 */

export const chaveDaPrevia = (contaId: string) => `conciliacao-previa:${contaId}`;

export interface LinhaPrevista {
  chave: string;
  data: string;
  credito: number;
  debito: number;
  descricao: string;
  contraparte: string;
  job: string | null;
  centro: string;
  centroCompleto: string;
  empresa: string | null;
  rateio: Array<{ regional: string; percentual: number }>;
}

export function lerPrevia(contaId: string): LinhaPrevista[] {
  try {
    const texto = window.sessionStorage.getItem(chaveDaPrevia(contaId));
    if (!texto) return [];
    const lista = JSON.parse(texto);
    return Array.isArray(lista) ? (lista as LinhaPrevista[]) : [];
  } catch {
    return [];
  }
}

export function gravarPrevia(contaId: string, linhas: LinhaPrevista[]): void {
  try {
    if (linhas.length === 0) window.sessionStorage.removeItem(chaveDaPrevia(contaId));
    else window.sessionStorage.setItem(chaveDaPrevia(contaId), JSON.stringify(linhas));
  } catch {
    // Sem armazenamento, o Extrato só não mostra a prévia.
  }
}
