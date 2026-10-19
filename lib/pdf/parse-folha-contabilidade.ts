/**
 * Parser do PDF "Relação Geral dos Líquidos" entregue mensalmente pela
 * contabilidade. Função PURA: recebe o texto já extraído do PDF e devolve
 * um objeto estruturado.
 *
 * Formato real do texto extraído por pdf-parse v1 (observado em produção):
 *
 *   Empregados                                       ← header da seção
 *   110.000.018-0001 COLABORADOR EXEMPLO 01          ← CPF + código(colados) + nome
 *   05/10/2026                                       ← data
 *   1.988,40                                         ← valor
 *   100.000.002-0002 COLABORADOR EXEMPLO 02          ← próxima linha
 *   ...
 *   Estagiários                                      ← header próxima seção
 *   200.000.001-0001 ESTAGIARIO EXEMPLO 01
 *   05/10/2026
 *   2.000,00
 *   ...
 *   Contribuintes
 *   300.000.001-0001 CONTRIBUINTE EXEMPLO 01
 *   05/10/2026
 *   1.442,69
 *   Contribuintes: 1Empregados: 30Estagiários: 2125.281,45   ← rodapé grudado
 *   Total da Empresa:
 *
 * O pdf-parse v1 extrai o texto do PDF por coluna; os campos vêm empilhados
 * em linhas separadas, com CPF e código colados.
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

const RE_CNPJ = /CNPJ[\s:]*([\d./-]+)/i;
const RE_COMPETENCIA = /Compet[eê]ncia[\s:]*(\d{2})\/(\d{4})/i;

// Linha de colaborador: CPF (xxx.xxx.xxx-xx) + código (dígitos sem separador)
// + espaço + nome. Ex: "110.000.018-0001 COLABORADOR EXEMPLO 01"
const RE_LINHA_CPF_CODIGO_NOME =
  /^(\d{3}\.\d{3}\.\d{3}-\d{2})(\d+)\s+(.+?)\s*$/;
const RE_DATA = /^(\d{2}\/\d{2}\/\d{4})$/;
const RE_VALOR = /^([\d.]+,\d{2})$/;

// Headers de seção aparecem sozinhos numa linha. "Empregados" sem dois-pontos
// distingue header de "Empregados: 30" do rodapé.
const RE_HEADER_SECAO = /^(Empregados|Estagi[áa]rios|Contribuintes)$/;

// Totalizadores do rodapé: NÃO parseamos. No pdf-parse v1, os campos vêm
// colados: "Contribuintes: 1Empregados: 30Estagiários: 2125.281,45" — o "2125"
// é ambíguo (2 estagiários + 125.281,45 total). Contagem e total vêm sempre
// das linhas já parseadas (fonte de verdade).

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

function normalizarSecao(nome: string): SecaoPdf {
  const semAcento = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (semAcento === "empregados") return "empregados";
  if (semAcento === "estagiarios") return "estagiarios";
  return "contribuintes";
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

  // State machine: lê linha a linha, rastreia a seção atual. Quando encontra
  // uma linha de colaborador (CPF+código+nome), consome as próximas 2 linhas
  // (data e valor).
  const linhasBrutas = texto.split(/\r?\n/).map((l) => l.trim());
  const linhas: LinhaPdf[] = [];
  let secaoAtual: SecaoPdf | null = null;

  for (let i = 0; i < linhasBrutas.length; i++) {
    const linha = linhasBrutas[i];
    if (!linha) continue;

    // Header de seção?
    const headerMatch = linha.match(RE_HEADER_SECAO);
    if (headerMatch) {
      secaoAtual = normalizarSecao(headerMatch[1]);
      continue;
    }

    // Linha de colaborador?
    const cpfMatch = linha.match(RE_LINHA_CPF_CODIGO_NOME);
    if (!cpfMatch) continue;
    if (!secaoAtual) continue; // CPF antes de qualquer header — ignora.

    const cpf = cpfMatch[1].replace(/\D/g, "");
    const codigo = cpfMatch[2];
    const nome = cpfMatch[3].trim();

    // As próximas 2 linhas não-vazias devem ser data e valor (nessa ordem).
    let dataMatch: RegExpMatchArray | null = null;
    let valorMatch: RegExpMatchArray | null = null;
    let j = i + 1;
    while (j < linhasBrutas.length && (!dataMatch || !valorMatch)) {
      const prox = linhasBrutas[j];
      if (prox) {
        if (!dataMatch) {
          const m = prox.match(RE_DATA);
          if (m) {
            dataMatch = m;
            j++;
            continue;
          }
        }
        if (dataMatch && !valorMatch) {
          const m = prox.match(RE_VALOR);
          if (m) {
            valorMatch = m;
            j++;
            continue;
          }
        }
        // Linha inesperada entre CPF e data/valor: aborta esse match pra evitar
        // casamento errado com totalizador no rodapé.
        break;
      }
      j++;
    }

    if (!dataMatch || !valorMatch) continue;

    linhas.push({
      secao: secaoAtual,
      codigo_contabilidade: codigo,
      nome,
      cpf,
      valor: brlParaCentavos(valorMatch[1]),
      data_pagamento: dataBrParaIso(dataMatch[1]),
    });
    i = j - 1; // pula as linhas de data e valor que acabei de consumir
  }

  if (linhas.length === 0) {
    throw new Error("Nenhuma linha de colaborador foi extraída do PDF.");
  }

  // Totalizadores sempre vêm das linhas extraídas (fonte de verdade). O rodapé
  // do PDF é só conferência visual pra humano — não dá pra parsear com segurança
  // porque pdf-parse v1 cola os números.
  const totalizadores: TotalizadoresPdf = {
    empregados: linhas.filter((l) => l.secao === "empregados").length,
    estagiarios: linhas.filter((l) => l.secao === "estagiarios").length,
    contribuintes: linhas.filter((l) => l.secao === "contribuintes").length,
    total_empresa: linhas.reduce((acc, l) => acc + l.valor, 0),
  };

  return {
    cnpj_emissor,
    competencia_ano,
    competencia_mes,
    linhas,
    totalizadores,
  };
}
