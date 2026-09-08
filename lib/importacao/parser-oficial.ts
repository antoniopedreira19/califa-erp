import ExcelJS from "exceljs";
import type { ImportacaoWarning, TipoCusto } from "@/lib/types";
import { TIPOS_CUSTO } from "@/lib/calculos/versao-totais";

/**
 * Parser da planilha padrão da Agência California.
 *
 * Layout REAL (conferido célula a célula em 08/09/2026 contra o modelo
 * "Modelo Planilha interna.xlsx", aba "Padrão", enviado pelo Tiago):
 *
 *   Linha 2 · faixas dos blocos: C:F ORÇAMENTO · H:L PLANEJADO · M:Q REALIZADO
 *   Linha 3 · header das colunas:
 *     A · CATEGORIA  — o AGRUPAMENTO do item (repetido em cada linha)
 *     B · ITEM       — nome do item
 *     C · R$         — valor unitário orçado
 *     D · QT
 *     E · D/M
 *     F · TT         — subtotal/total (só leitura visual; nada é lido daqui)
 *     G · (sem header) tipo de custo
 *     H · R$ · I · QT · J · D/M · K · TT · L · RENTA   → bloco PLANEJADO
 *     M..Q                                            → bloco REALIZADO (ignorado)
 *
 * É o MESMO layout que `lib/exportacao/planilha-orcamento.ts` escreve, com
 * uma diferença: a exportação põe o nome do grupo na coluna A de uma LINHA
 * DE GRUPO e deixa a coluna A dos itens vazia; o modelo do Tiago põe o nome
 * na coluna B da linha de grupo e repete o grupo na coluna A de cada item.
 * O parser aceita os dois — ver "Classificação de linha".
 *
 * Classificação de linha (depois do header):
 *   - RESUMO : coluna A vazia + SUB-TOTAL/TOTAL/IMPOSTO/HONORÁRIOS/
 *              FATURAMENTO em A..E. Ignorada; é dela que sai o % de
 *              honorários (coluna E, ver `extrairPercentualHonorarios`).
 *              A exigência de "A vazia" protege item cujo NOME contenha
 *              uma dessas palavras — item sempre tem a coluna A ou o tipo.
 *   - GRUPO  : sem valor em C e sem tipo em G, com nome só em A (formato da
 *              exportação) ou só em B (formato do modelo). Cria o grupo e
 *              passa a ser o grupo corrente.
 *   - ITEM   : todo o resto. O grupo sai da coluna A quando ela tem texto
 *              (regra do Tiago, 08/09/2026); quando está vazia, herda o
 *              último grupo visto (formato da exportação).
 *
 * Decisões do Tiago em 08/09/2026:
 *   1. O agrupamento é a COLUNA A. As linhas de grupo do modelo têm
 *      subtotal com intervalo errado (ESTRUTURA soma F5:F14, mas os itens
 *      vão até a 18), então nada é lido delas além do nome.
 *   2. Item sem valor unitário ENTRA, com R$ 0,00 — o modelo é um gabarito
 *      em branco, e o nome do item é o que interessa preservar. Quem barra
 *      orçado zerado é o salvar do rascunho, na tela, não o parser.
 *   3. A coluna A só agrupa: `categoria_id` continua nascendo vazia.
 *   4. O % de honorários vem da coluna E da linha HONORÁRIOS (0,12 → 12).
 *
 * Grupo vazio (nome que aparece numa linha de grupo mas em nenhum item) é
 * descartado no fim. É o que resolve o "CONTEUDO" sem acento da linha de
 * grupo contra o "CONTEÚDO" com acento da coluna A dos itens: sobra um só,
 * o que tem itens.
 */

const KEYWORDS_RESUMO = [
  "sub-total",
  "subtotal",
  "total",
  "imposto",
  "honorários",
  "honorarios",
  "faturamento",
];

/** "planilha" continua na lista: é o header que a exportação escreve na
 *  coluna A, e "categoria" é o do modelo. Os dois formatos passam. */
const KEYWORDS_HEADER = ["categoria", "planilha", "item", "r$", "qt", "d/m", "tt"];

const TIPOS_VALIDOS: readonly TipoCusto[] = TIPOS_CUSTO;

/** Nomes de aba que o parser procura antes de cair na primeira. */
const ABAS_CONHECIDAS = ["padrao", "oficial"];

export interface ParseItem {
  ordem: number;
  item: string;
  tipo_custo: TipoCusto;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  /** Sempre null desde 08/09/2026: a coluna A virou o AGRUPAMENTO do item,
   *  então guardá-la de novo aqui seria repetir o nome do grupo. */
  planilha_origem: string | null;
  /** Linha do XLSX de onde veio (para debug/warnings). */
  linha_xlsx: number;
}

export interface ParseGrupo {
  nome: string;
  ordem: number;
  itens: ParseItem[];
}

export interface ParseResultado {
  aba: string;
  grupos: ParseGrupo[];
  warnings: ImportacaoWarning[];
  percentual_honorarios: number | null;
  linhas_lidas: number;
  linhas_importadas: number;
  linhas_ignoradas: number;
}

// ---------- helpers de célula ----------

function normalizar(s: unknown): string {
  if (s === null || s === undefined) return "";
  if (typeof s === "string") return s.trim();
  if (typeof s === "number") return String(s);
  if (typeof s === "object") {
    const anyS = s as any;
    if (typeof anyS.text === "string") return anyS.text.trim();
    if (typeof anyS.result === "string" || typeof anyS.result === "number") {
      return String(anyS.result).trim();
    }
    if (Array.isArray(anyS.richText)) {
      return anyS.richText.map((r: any) => r.text ?? "").join("").trim();
    }
  }
  return String(s).trim();
}

function toNumber(v: unknown): { ok: boolean; n: number } {
  if (v === null || v === undefined || v === "") return { ok: false, n: 0 };
  if (typeof v === "number" && Number.isFinite(v)) return { ok: true, n: v };

  // ExcelJS devolve células com fórmula como { formula, result }. Muitas
  // planilhas da agência têm R$/QT/TT como fórmula referenciando outra
  // planilha. Priorize o `result` numérico — evita ir pra rota de string
  // (que exige heurística de formato) quando não precisa.
  if (typeof v === "object" && v !== null) {
    const anyV = v as any;
    if (typeof anyV.result === "number" && Number.isFinite(anyV.result)) {
      return { ok: true, n: anyV.result };
    }
  }

  const raw = normalizar(v).replace(/[R$\s]/g, "");
  if (raw === "") return { ok: false, n: 0 };

  // Detecta formato do decimal:
  //  - "1.234,56" → pt-BR com milhar: remove pontos, troca vírgula por ponto.
  //  - "11,05"    → pt-BR sem milhar: troca vírgula por ponto.
  //  - "11.05"    → US ou result-de-fórmula: ponto já é decimal.
  //  - "1.105"    → ambíguo. Assume MILHAR se a parte pós-ponto tiver
  //                exatamente 3 dígitos (não pode ser decimal com 3 casas
  //                em moeda), senão assume DECIMAL. Cobre "1.105" (milhar)
  //                vs "11.05" (decimal US) sem quebrar nenhum dos dois.
  //  - "12345"    → inteiro.
  const temVirgula = raw.includes(",");
  const temPonto = raw.includes(".");
  let cleaned = raw;

  if (temVirgula && temPonto) {
    cleaned = raw.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    cleaned = raw.replace(",", ".");
  } else if (temPonto) {
    const partes = raw.split(".");
    if (partes.length === 2 && partes[1].length === 3 && partes[0] !== "") {
      // "1.105" — parece milhar pt-BR (3 dígitos após o ponto, sem vírgula).
      cleaned = raw.replace(/\./g, "");
    }
    // senão mantém raw: "11.05" fica "11.05", parse direto.
  }

  const n = Number(cleaned);
  if (Number.isFinite(n)) return { ok: true, n };
  return { ok: false, n: 0 };
}

function letra(col: number): string {
  return String.fromCharCode(64 + col); // 1 → 'A'
}

/** Minúscula e sem acento — para comparar nome de aba. */
function semAcento(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

// ---------- helpers de classificação ----------

function ehLinhaHeader(cells: string[]): boolean {
  const joined = cells.slice(0, 8).map((c) => c.toLowerCase()).join("|");
  const hits = KEYWORDS_HEADER.filter((k) => joined.includes(k)).length;
  return hits >= 3;
}

/**
 * Linha de fechamento (SUB-TOTAL, TOTAL, IMPOSTO, HONORÁRIOS, FATURAMENTO).
 *
 * Exige a coluna A vazia: no layout novo o fechamento fica em C..E com A e B
 * vazias, e essa exigência impede que um ITEM chamado, por exemplo, "TOTEM
 * DE TOTAL" seja engolido — item sempre tem a coluna A preenchida (modelo)
 * ou o tipo em G (exportação).
 */
function ehLinhaResumo(cells: string[]): boolean {
  if (cells[0] !== "") return false;
  const alvo = cells.slice(0, 5).map((s) => s.toLowerCase());
  return alvo.some((c) => KEYWORDS_RESUMO.some((k) => c.includes(k)));
}

/**
 * % de honorários de uma linha de fechamento.
 *
 * Formato do modelo (08/09/2026): C = "HONORÁRIOS", E = 0,12 → 12.
 * Um número acima de 1 é lido como já percentual ("12" → 12), porque as
 * planilhas antigas escreviam assim. O fallback continua sendo o texto com
 * "%" em qualquer coluna, que é como as versões mais velhas guardavam.
 */
function extrairPercentualHonorarios(
  cells: string[],
  valorColE: unknown,
): number | null {
  const joined = cells.slice(0, 8).join(" ").toLowerCase();
  if (!joined.includes("honor")) return null;

  const daColunaE = toNumber(valorColE);
  if (daColunaE.ok && daColunaE.n > 0) {
    return daColunaE.n <= 1 ? daColunaE.n * 100 : daColunaE.n;
  }

  const m = joined.match(/([0-9]+(?:[.,][0-9]+)?)\s*%/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// ---------- parser principal ----------

export async function parseOficial(
  buffer: ArrayBuffer | Buffer,
): Promise<ParseResultado> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS.xlsx.load aceita ArrayBuffer/Buffer. Tipagem antiga do ExcelJS
  // não bate com o Buffer generic novo do @types/node — cast explícito.
  await wb.xlsx.load(buffer as any);

  let ws = wb.worksheets.find((w) =>
    ABAS_CONHECIDAS.includes(semAcento(w.name)),
  );
  if (!ws) ws = wb.worksheets[0];

  if (!ws) {
    return {
      aba: "",
      grupos: [],
      warnings: [
        {
          linha: 0,
          motivo: "Planilha sem abas legíveis.",
          severidade: "ignorada",
        },
      ],
      percentual_honorarios: null,
      linhas_lidas: 0,
      linhas_importadas: 0,
      linhas_ignoradas: 0,
    };
  }

  const warnings: ImportacaoWarning[] = [];
  const grupos: ParseGrupo[] = [];
  /** Último grupo resolvido — é ele que recolhe item com a coluna A vazia. */
  let grupoAtual: ParseGrupo | null = null;
  let percentualHonorarios: number | null = null;

  let headerEncontrado = false;
  let linhasLidas = 0;
  let linhasImportadas = 0;
  let linhasIgnoradas = 0;
  let viuLinhaDeGrupo = false;

  /** Acha o grupo pelo nome ou cria um novo, preservando a ordem de entrada. */
  function grupoPorNome(nome: string): ParseGrupo {
    const existente = grupos.find((g) => g.nome === nome);
    if (existente) return existente;
    const novo: ParseGrupo = { nome, ordem: grupos.length + 1, itens: [] };
    grupos.push(novo);
    return novo;
  }

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Lê colunas A–L (12 colunas): até J basta para orçado + planejado, e as
    // duas a mais mantêm a checagem de "linha vazia" honesta.
    const cells: string[] = [];
    for (let c = 1; c <= 12; c++) {
      cells.push(normalizar(row.getCell(c).value));
    }

    if (cells.every((c) => c === "")) return;
    linhasLidas++;

    // Header?
    if (!headerEncontrado) {
      if (ehLinhaHeader(cells)) headerEncontrado = true;
      return;
    }

    // Fechamento (SUB-TOTAL, TOTAL, IMPOSTO, HONORÁRIOS, FATURAMENTO)?
    if (ehLinhaResumo(cells)) {
      const pct = extrairPercentualHonorarios(cells, row.getCell(5).value);
      if (pct !== null && percentualHonorarios === null) {
        percentualHonorarios = pct;
      }
      linhasIgnoradas++;
      return;
    }

    const [colA, colB, colC, colD, colE, , colG, colH, colI, colJ] = cells;
    const valorC = toNumber(colC);
    const tipoUpper = colG.toUpperCase().trim();
    const temTipoValido = TIPOS_VALIDOS.includes(tipoUpper as TipoCusto);

    // GRUPO: sem valor unitário e sem tipo, com nome em exatamente UMA das
    // duas primeiras colunas — `A` é o formato da exportação, `B` o do
    // modelo. Nas duas, ou em nenhuma, não é linha de grupo.
    const nomeSoEmUmaColuna = (colA === "") !== (colB === "");
    if (!valorC.ok && !temTipoValido && nomeSoEmUmaColuna) {
      const nome = colA !== "" ? colA : colB;
      grupoAtual = grupoPorNome(nome);
      viuLinhaDeGrupo = true;
      linhasIgnoradas++;
      return;
    }

    // Sobrou linha sem nada em A e em B, e sem valor nem tipo: legenda,
    // nota solta, rodapé. Ignora em silêncio — avisar sobre isso só
    // enche a lista de warnings de coisa que ninguém quer importar.
    if (colA === "" && colB === "" && !valorC.ok && !temTipoValido) {
      linhasIgnoradas++;
      return;
    }

    // ---------- ITEM ----------

    // O grupo sai da coluna A quando ela tem texto (decisão do Tiago em
    // 08/09/2026); vazia, o item cai no último grupo visto.
    if (colA !== "") {
      grupoAtual = grupoPorNome(colA);
    } else if (!grupoAtual) {
      grupoAtual = grupoPorNome("Sem grupo");
      warnings.push({
        linha: rowNumber,
        coluna: letra(1),
        motivo:
          "Item sem agrupamento na coluna A e sem grupo anterior — agrupado em 'Sem grupo'.",
        severidade: "ajuste",
      });
    }

    // Tipo de custo (coluna G). Sem tipo válido a linha não entra: é ele
    // que decide tributação, honorário e faturamento do item.
    if (!temTipoValido) {
      warnings.push({
        linha: rowNumber,
        coluna: letra(7),
        motivo:
          tipoUpper === ""
            ? `Tipo de custo ausente na coluna G — linha descartada. Aceitos: ${TIPOS_VALIDOS.join(", ")}.`
            : `Tipo "${colG}" não é suportado (aceitos: ${TIPOS_VALIDOS.join(", ")}) — linha descartada.`,
        severidade: "ignorada",
      });
      linhasIgnoradas++;
      return;
    }

    // Nome do item vem da coluna B.
    const nomeItem = colB !== "" ? colB : colA;
    if (colB === "" && colA === "") {
      warnings.push({
        linha: rowNumber,
        coluna: letra(2),
        motivo: "Linha com tipo mas sem nome de item — descartada.",
        severidade: "ignorada",
      });
      linhasIgnoradas++;
      return;
    }
    if (colB === "") {
      warnings.push({
        linha: rowNumber,
        coluna: letra(2),
        motivo:
          "Nome do item vazio na coluna B — usamos o texto da coluna A como fallback.",
        severidade: "ajuste",
      });
    }

    // Valor unitário (coluna C). Vazio entra como zero — decisão do Tiago
    // em 08/09/2026. Quem barra orçado zerado é o salvar, na tela.
    let valorUnitario = valorC.ok ? valorC.n : 0;
    if (!valorC.ok && colC !== "") {
      warnings.push({
        linha: rowNumber,
        coluna: letra(3),
        motivo: `Valor unitário inválido ("${colC}") — assumido R$ 0,00.`,
        severidade: "ajuste",
      });
    }
    if (valorUnitario < 0) {
      warnings.push({
        linha: rowNumber,
        coluna: letra(3),
        motivo: `Valor unitário negativo (${colC}) — assumido R$ 0,00.`,
        severidade: "ajuste",
      });
      valorUnitario = 0;
    }

    // QT e D/M precisam ser POSITIVOS: o banco tem CHECK
    // `itens_quantidade_positiva` e `itens_dias_meses_positivo`. Zero ou
    // negativo derrubaria o insert inteiro, então vira 1 com aviso.
    const qtd = toNumber(colD);
    const dm = toNumber(colE);

    let quantidade = qtd.ok ? qtd.n : 1;
    if (!qtd.ok && colD !== "") {
      warnings.push({
        linha: rowNumber,
        coluna: letra(4),
        motivo: `Quantidade inválida ("${colD}") — assumida 1.`,
        severidade: "ajuste",
      });
    }
    if (quantidade <= 0) {
      warnings.push({
        linha: rowNumber,
        coluna: letra(4),
        motivo: `Quantidade ${colD || "0"} não é aceita (precisa ser maior que zero) — assumida 1.`,
        severidade: "ajuste",
      });
      quantidade = 1;
    }

    let diasMeses = dm.ok ? dm.n : 1;
    if (!dm.ok && colE !== "") {
      warnings.push({
        linha: rowNumber,
        coluna: letra(5),
        motivo: `Dias/meses inválido ("${colE}") — assumido 1.`,
        severidade: "ajuste",
      });
    }
    if (diasMeses <= 0) {
      warnings.push({
        linha: rowNumber,
        coluna: letra(5),
        motivo: `Dias/meses ${colE || "0"} não é aceito (precisa ser maior que zero) — assumido 1.`,
        severidade: "ajuste",
      });
      diasMeses = 1;
    }

    // Bloco PLANEJADO: H · R$, I · QT, J · D/M. K (TT) e L (RENTA) são
    // calculados pelo sistema. Vazio entra como zero — planejado pode ser
    // zero no banco, diferente de QT e D/M do orçado.
    const valorPlanejado = toNumber(colH);
    const qtdPlanejada = toNumber(colI);
    const dmPlanejado = toNumber(colJ);

    grupoAtual.itens.push({
      ordem: grupoAtual.itens.length + 1,
      item: nomeItem,
      tipo_custo: tipoUpper as TipoCusto,
      valor_unitario_orcado: valorUnitario,
      quantidade_orcada: quantidade,
      dias_meses_orcado: diasMeses,
      valor_unitario_planejado:
        valorPlanejado.ok && valorPlanejado.n > 0 ? valorPlanejado.n : 0,
      quantidade_planejada:
        qtdPlanejada.ok && qtdPlanejada.n > 0 ? qtdPlanejada.n : 0,
      dias_meses_planejado:
        dmPlanejado.ok && dmPlanejado.n > 0 ? dmPlanejado.n : 0,
      planilha_origem: null,
      linha_xlsx: rowNumber,
    });
    linhasImportadas++;
  });

  if (!headerEncontrado) {
    warnings.push({
      linha: 0,
      motivo:
        'Não encontramos a linha de header (com "CATEGORIA"/"ITEM"/"R$"). Confirme se a aba está no formato padrão.',
      severidade: "ignorada",
    });
  }

  // Remove grupos vazios: sobram quando um nome aparece numa linha de grupo
  // e em nenhum item (o "CONTEUDO" sem acento do modelo), ou quando todos os
  // itens do grupo caíram por tipo não suportado.
  const gruposComItens = grupos
    .filter((g) => g.itens.length > 0)
    .map((g, idx) => ({ ...g, ordem: idx + 1 }));

  if (gruposComItens.length === 0 && viuLinhaDeGrupo) {
    warnings.push({
      linha: 0,
      motivo:
        "Encontramos linhas de grupo, mas nenhum item. Confira se a coluna A traz o agrupamento, a B o nome do item e a G o tipo de custo.",
      severidade: "ignorada",
    });
  }

  return {
    aba: ws.name,
    grupos: gruposComItens,
    warnings,
    percentual_honorarios: percentualHonorarios,
    linhas_lidas: linhasLidas,
    linhas_importadas: linhasImportadas,
    linhas_ignoradas: linhasIgnoradas,
  };
}
