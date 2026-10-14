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
// Formato da linha: "61 COLABORADOR EXEMPLO 01 110.000.018-00 1.988,40 05/10/2026"
// O código é o primeiro número; o nome vai até o CPF; valor BR; data BR.
const RE_LINHA =
  /^\s*(\d+)\s+(.+?)\s+(\d{3}\.\d{3}\.\d{3}-\d{2})\s+([\d.]+,\d{2})\s+(\d{2}\/\d{2}\/\d{4})\s*$/;
// Totalizadores vêm em uma única linha no PDF:
// "Empregados: 30 Estagiários: 2 Contribuintes: 1 Total da Empresa: 125.281,45"
// Mas o pdf-parse v1 (pdfjs antigo) pode extrair os campos em ordem diferente,
// com whitespace unicode (NBSP, etc.), com quebras de linha no meio ou em
// maiúsculas/minúsculas diferentes dependendo do PDF. Procuramos cada campo
// isoladamente, com regexes tolerantes:
//
//   - `[\s ]*` em vez de `\s*`: inclui NBSP e outros whitespace unicode
//     que `\s` do JS não cobre consistentemente.
//   - Flag `i`: aceita qualquer caixa.
//   - Entre palavras ("Total da Empresa"), `[\s ]+` tolera quebra de linha
//     ou múltiplos espaços entre elas.
//
// Os cabeçalhos de seção são "Empregados", "Estagiários", "Contribuintes" (SEM
// dois-pontos), então o `:` obrigatório garante que só casamos no rodapé.
const RE_TOTAL_EMPREGADOS = /Empregados[\s ]*:[\s ]*(\d+)/i;
const RE_TOTAL_ESTAGIARIOS = /Estagi[áa]rios[\s ]*:[\s ]*(\d+)/i;
const RE_TOTAL_CONTRIBUINTES = /Contribuintes[\s ]*:[\s ]*(\d+)/i;
const RE_TOTAL_EMPRESA =
  /Total[\s ]+da[\s ]+Empresa[\s ]*:[\s ]*([\d.,]+)/i;

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

  // Matches independentes dos 4 campos. "Total da Empresa:" é único no PDF,
  // então serve de âncora pra achar onde terminam os blocos de linhas.
  const totEmpregadosM = texto.match(RE_TOTAL_EMPREGADOS);
  const totEstagiariosM = texto.match(RE_TOTAL_ESTAGIARIOS);
  const totContribuintesM = texto.match(RE_TOTAL_CONTRIBUINTES);
  const totEmpresaM = texto.match(RE_TOTAL_EMPRESA);
  const idxTotais = totEmpresaM
    ? texto.indexOf(totEmpresaM[0])
    : totEmpregadosM
      ? texto.indexOf(totEmpregadosM[0])
      : texto.length;

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

  // Totalizadores do rodapé são SÓ CONFERÊNCIA — se o PDF for válido (CNPJ +
  // competência + pelo menos uma linha extraída), o import roda. Se o rodapé
  // for extraído normal, usamos; se não, computamos a partir das linhas.
  // Essa decisão evita falhar o import inteiro por detalhe de layout do PDF
  // que o pdf-parse v1 pode extrair de forma inconsistente.
  if (linhas.length === 0) {
    throw new Error("Nenhuma linha de colaborador foi extraída do PDF.");
  }

  const totalizadores: TotalizadoresPdf = {
    empregados: totEmpregadosM
      ? Number(totEmpregadosM[1])
      : linhas.filter((l) => l.secao === "empregados").length,
    estagiarios: totEstagiariosM
      ? Number(totEstagiariosM[1])
      : linhas.filter((l) => l.secao === "estagiarios").length,
    contribuintes: totContribuintesM
      ? Number(totContribuintesM[1])
      : linhas.filter((l) => l.secao === "contribuintes").length,
    total_empresa: totEmpresaM
      ? brlParaCentavos(totEmpresaM[1])
      : linhas.reduce((acc, l) => acc + l.valor, 0),
  };

  return {
    cnpj_emissor,
    competencia_ano,
    competencia_mes,
    linhas,
    totalizadores,
  };
}
