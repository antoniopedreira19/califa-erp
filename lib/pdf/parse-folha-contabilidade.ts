/**
 * Parser do PDF "Relação Geral dos Líquidos" entregue mensalmente pela
 * contabilidade. Função PURA: recebe o texto já extraído do PDF e devolve
 * um objeto estruturado. A extração do texto do PDF (via pdf-parse) é
 * responsabilidade do caller — isso mantém o parser 100% testável sem binário.
 *
 * Formato do PDF:
 *   - Cabeçalho com CNPJ e Competência (MM/YYYY).
 *   - Três seções fixas, cada uma iniciada pelo nome: "Empregados",
 *     "Estagiários", "Contribuintes". Nem toda seção precisa aparecer.
 *   - Cada linha: `codigo_contabilidade nome CPF valor data_pagamento`.
 *   - Rodapé com totalizadores: "Empregados: N Estagiários: N
 *     Contribuintes: N Total da Empresa: R$"
 *
 * Spec: docs/superpowers/specs/2026-10-06-folha-dois-fluxos-design.md (D3)
 */

export type SecaoPdf = "empregados" | "estagiarios" | "contribuintes";

export interface LinhaPdf {
  secao: SecaoPdf;
  codigo_contabilidade: string;
  nome: string;
  /** CPF normalizado — só dígitos, 11 caracteres. */
  cpf: string;
  /** Valor em centavos (inteiro) — R$ 1.988,40 → 198840. */
  valor: number;
  /** Data de pagamento no formato ISO yyyy-mm-dd. */
  data_pagamento: string;
}

export interface TotalizadoresPdf {
  empregados: number;
  estagiarios: number;
  contribuintes: number;
  /** Soma total do rodapé do PDF, em centavos. */
  total_empresa: number;
}

export interface ParsedFolha {
  /** CNPJ emissor normalizado — só dígitos, 14 caracteres. */
  cnpj_emissor: string;
  competencia_ano: number;
  competencia_mes: number;
  linhas: LinhaPdf[];
  totalizadores: TotalizadoresPdf;
}

const RE_CNPJ = /CNPJ:\s*([\d./-]+)/;
const RE_COMPETENCIA = /Compet[eê]ncia:\s*(\d{2})\/(\d{4})/;
// Formato da linha: "61 CAROLINE CERQUEIRA INACIO 415.891.968-13 1.988,40 05/10/2026"
// O código é o primeiro número; o nome vai até o CPF; valor BR; data BR.
const RE_LINHA =
  /^\s*(\d+)\s+(.+?)\s+(\d{3}\.\d{3}\.\d{3}-\d{2})\s+([\d.]+,\d{2})\s+(\d{2}\/\d{2}\/\d{4})\s*$/;
const RE_TOTAIS =
  /Empregados:\s*(\d+)\s+Estagi[áa]rios:\s*(\d+)\s+Contribuintes:\s*(\d+)\s+Total da Empresa:\s*([\d.,]+)/;

function brlParaCentavos(s: string): number {
  const limpo = s.replace(/\./g, "").replace(",", ".");
  const num = Number(limpo);
  if (!Number.isFinite(num)) {
    throw new Error(`Valor inválido no PDF: "${s}"`);
  }
  return Math.round(num * 100);
}

function dataBrParaIso(s: string): string {
  const [d, m, y] = s.split("/");
  return `${y}-${m}-${d}`;
}

/** Localiza o cabeçalho de uma seção no texto. Retorna o índice após o nome ou -1. */
function indexAfterSectionHeader(texto: string, header: string): number {
  // Procura o header rodeado por quebras de linha (não casar com "Estagiários:" do rodapé).
  const re = new RegExp(`(^|\\n)${header}\\s*(\\r?\\n)`, "u");
  const m = re.exec(texto);
  if (!m) return -1;
  return m.index + m[0].length;
}

export function parseFolhaContabilidadeTexto(texto: string): ParsedFolha {
  const cnpjMatch = texto.match(RE_CNPJ);
  if (!cnpjMatch) {
    throw new Error("CNPJ não encontrado no PDF.");
  }
  const cnpj_emissor = cnpjMatch[1].replace(/\D/g, "");

  const compMatch = texto.match(RE_COMPETENCIA);
  if (!compMatch) {
    throw new Error("Competência não encontrada no PDF.");
  }
  const competencia_mes = Number(compMatch[1]);
  const competencia_ano = Number(compMatch[2]);

  const idxEmpregados = indexAfterSectionHeader(texto, "Empregados");
  if (idxEmpregados < 0) {
    throw new Error('Seção "Empregados" não encontrada no PDF.');
  }
  const idxEstagiarios = indexAfterSectionHeader(texto, "Estagiários");
  const idxContribuintes = indexAfterSectionHeader(texto, "Contribuintes");

  const totMatch = texto.match(RE_TOTAIS);
  const idxTotais = totMatch ? texto.indexOf(totMatch[0]) : texto.length;

  const blocos: { secao: SecaoPdf; inicio: number; fim: number }[] = [];

  // Fim de empregados = início do próximo header que exista.
  const fimEmpregados =
    idxEstagiarios > 0
      ? texto.lastIndexOf("Estagiários", idxEstagiarios)
      : idxContribuintes > 0
        ? texto.lastIndexOf("Contribuintes", idxContribuintes)
        : idxTotais;
  blocos.push({ secao: "empregados", inicio: idxEmpregados, fim: fimEmpregados });

  if (idxEstagiarios > 0) {
    const fim =
      idxContribuintes > 0
        ? texto.lastIndexOf("Contribuintes", idxContribuintes)
        : idxTotais;
    blocos.push({ secao: "estagiarios", inicio: idxEstagiarios, fim });
  }

  if (idxContribuintes > 0) {
    blocos.push({ secao: "contribuintes", inicio: idxContribuintes, fim: idxTotais });
  }

  const linhas: LinhaPdf[] = [];
  for (const bloco of blocos) {
    const trecho = texto.slice(bloco.inicio, bloco.fim);
    for (const linhaRaw of trecho.split(/\r?\n/)) {
      const m = linhaRaw.match(RE_LINHA);
      if (!m) continue;
      linhas.push({
        secao: bloco.secao,
        codigo_contabilidade: m[1],
        nome: m[2].trim(),
        cpf: m[3].replace(/\D/g, ""),
        valor: brlParaCentavos(m[4]),
        data_pagamento: dataBrParaIso(m[5]),
      });
    }
  }

  if (!totMatch) {
    throw new Error("Totalizadores do rodapé não encontrados no PDF.");
  }
  const totalizadores: TotalizadoresPdf = {
    empregados: Number(totMatch[1]),
    estagiarios: Number(totMatch[2]),
    contribuintes: Number(totMatch[3]),
    total_empresa: brlParaCentavos(totMatch[4]),
  };

  return {
    cnpj_emissor,
    competencia_ano,
    competencia_mes,
    linhas,
    totalizadores,
  };
}
