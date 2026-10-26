/**
 * Os nomes de coluna das abas da planilha "Fin. Conta Califórnia" e o campo
 * que cada um vira no histórico financeiro (decisão 211). As abas não
 * concordam entre si — "Descrição", "Servico" ou "Serviço"; "Job", "Jobs" ou
 * "Job ou Evento" —, então a leitura é sempre pelo nome, nunca pela posição.
 * A chave é o título normalizado (`normalizarTexto`).
 */
import { normalizarTexto } from "./regras";

export const SINONIMOS_DA_CONTA: Readonly<Record<string, string>> = {
  DATA: "data",
  CREDITO: "credito",
  DEBITO: "debito",
  SALDO: "saldo",
  PARC: "parcela",
  PARCELA: "parcela",
  DESCRICAO: "descricao",
  SERVICO: "descricao",
  FORNECEDOR: "fornecedor",
  JOB: "job",
  JOBS: "job",
  "JOB OU EVENTO": "job",
  EVENTO: "evento",
  CIDADE: "evento",
  "PAIS UF CIDADE": "evento",
  TIPO: "tipo",
  COD: "cod",
  "COD CONTA": "cod",
  REG: "reg",
  "REG CALIFA": "reg",
  "CMH REG": "reg_cmh",
  "REG CMH": "reg_cmh",
  DOC: "documento",
  DOCUMENTO: "documento",
  OBS: "observacao",
  OBSERVACAO: "observacao",
  // A DRE da Doca soma por estas duas colunas, e não pelo Tipo.
  "DRE EXTRA": "dre_extra",
  "ANO COMP": "ano_comp",
};

export const SINONIMOS_DA_NOTA: Readonly<Record<string, string>> = {
  NF: "nf",
  JOB: "job",
  CLIENTE: "cliente",
  MUNICIPIO: "municipio",
  AP: "municipio",
  CNAE: "cnae",
  OBS: "obs",
  EMISSAO: "emissao",
  VENCIMENTO: "vencimento",
  RECEBIMENTO: "recebimento",
  VALOR: "valor",
  DEDUCAO: "deducao",
  DEDUCOES: "deducao",
  "VALOR TRIBUTAVEL": "valor_tributavel",
  ISS: "iss",
  PIS: "pis",
  COFINS: "cofins",
  CSLL: "csll",
  IR: "ir",
  "AD IR": "adicional_ir",
  RETENCOES: "retencoes",
  "TOTAL IMPOSTOS": "total_impostos",
  OBSERVACAO: "observacao",
};

export const SINONIMOS_DO_RESULTADO: Readonly<Record<string, string>> = {
  T: "trimestre",
  "JOBS UNIFICADO": "projeto",
  CLIENTE: "cliente",
  PRODU: "marca",
  SERV: "servico",
  GP: "gp",
  "DATA START": "data_inicio",
  "DATA ABERTURA": "data_inicio",
  DATA: "data",
  REGIONAL: "regional",
  CIDADE: "regional",
  STATUS: "status",
  PISCILLIA: "codigo_antigo",
  CODIGO: "codigo_antigo",
  "TOTAL RECEITA": "receita",
  IMPOSTO: "imposto",
  "TOTAL IMPOSTO": "imposto",
  "TOTAL CO": "custo",
  "TOTAL CUSTO OP": "custo",
};

/**
 * Cabeçalho da aba (a linha do CSV bruto, com o número da linha na posição 0)
 * → posição de cada campo, pela primeira ocorrência do nome.
 */
export function colunasPorNome(cabecalho: readonly string[], sinonimos: Readonly<Record<string, string>>): Map<string, number> {
  const colunas = new Map<string, number>();
  cabecalho.forEach((titulo, i) => {
    if (i === 0) return;
    const campo = sinonimos[normalizarTexto(titulo)];
    if (campo && !colunas.has(campo)) colunas.set(campo, i);
  });
  return colunas;
}

export const celula = (linha: readonly string[], colunas: Map<string, number>, campo: string) => (linha[colunas.get(campo) ?? -1] ?? "").trim();
