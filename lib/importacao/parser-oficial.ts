import ExcelJS from "exceljs";
import type { ImportacaoWarning, TipoCusto } from "@/lib/types";

/**
 * Parser da planilha padrão da Agência California ("aba Oficial").
 *
 * Layout REAL da planilha (a que foi validada com um exemplo do usuário):
 *   Linha 1 (superior): agrupa "ORÇAMENTO", "PLANEJADO", "REALIZADO"
 *   Linha 2 (headers de coluna):
 *     A · PLANILHA (categoria longa, ex: "INTERNA - Corona - Ativação...")
 *     B · CATEGORIA (opcional; ignorada no MVP)
 *     C · ITEM (nome do item de custo)
 *     D · R$ (valor unitário do ORÇAMENTO)
 *     E · QT
 *     F · D/M
 *     G · TT (total do ORÇAMENTO)
 *     H · Tipo A/B/C/D (bloco ORÇAMENTO)
 *     I → col do bloco PLANEJADO (ignorado)
 *     N → col do bloco REALIZADO (ignorado)
 *
 * Classificação de linha (depois do header):
 *   - GRUPO   : col A tem texto + col D vazia + col G tem número (subtotal)
 *   - ITEM    : col D tem número
 *   - RESUMO  : col D contém SUB-TOTAL / TOTAL / IMPOSTO / HONORÁRIOS /
 *               FATURAMENTO — ignora, mas tenta extrair % de honorários.
 *   - Outras  : warning "linha não reconhecida" (só se tiver conteúdo).
 *
 * Tipo do item vem da col H. Se for A/B/C/D → usa. Se for outra coisa
 * (ex.: "F", "A e D", vazia), o item é DESCARTADO com warning de severidade
 * 'ignorada', porque hoje o modelo de tributação só cobre A/B/C/D.
 *
 * planilha_origem: guardamos a col A do item no campo `planilha_origem` da
 * tabela versoes_orcamento_itens (usa a categoria longa como rastro).
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

const KEYWORDS_HEADER = ["planilha", "item", "r$", "qt", "d/m", "tt"];

const TIPOS_VALIDOS: readonly TipoCusto[] = ["A", "B", "C", "D"] as const;

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
  /** Categoria longa vinda da col A (ex.: "INTERNA - Corona - ..."). */
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

// ---------- helpers de classificação ----------

function ehLinhaHeader(cells: string[]): boolean {
  const joined = cells.slice(0, 8).map((c) => c.toLowerCase()).join("|");
  const hits = KEYWORDS_HEADER.filter((k) => joined.includes(k)).length;
  return hits >= 3;
}

function ehLinhaResumo(cells: string[]): boolean {
  // Palavra-chave em qualquer uma das 4 primeiras cols (A-D) resolve.
  const alvo = cells.slice(0, 4).map((s) => s.toLowerCase());
  return alvo.some((c) => KEYWORDS_RESUMO.some((k) => c.includes(k)));
}

function extrairPercentualHonorarios(cells: string[]): number | null {
  const joined = cells.slice(0, 8).join(" ").toLowerCase();
  if (!joined.includes("honor")) return null;
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

  let ws = wb.worksheets.find(
    (w) => w.name.trim().toLowerCase() === "oficial",
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
  let grupoAtual: ParseGrupo | null = null;
  let percentualHonorarios: number | null = null;

  let headerEncontrado = false;
  let linhasLidas = 0;
  let linhasImportadas = 0;
  let linhasIgnoradas = 0;

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    // Lê colunas A–L (12 colunas).
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

    // Resumo (SUB-TOTAL, TOTAL, IMPOSTO, HONORÁRIOS, FATURAMENTO)?
    if (ehLinhaResumo(cells)) {
      const pct = extrairPercentualHonorarios(cells);
      if (pct !== null && percentualHonorarios === null) {
        percentualHonorarios = pct;
      }
      linhasIgnoradas++;
      return;
    }

    const [colA, , colC, colD, colE, colF, colG, colH] = cells;
    const valorD = toNumber(colD);
    const totalG = toNumber(colG);

    // GRUPO: col A tem texto + col D vazia + col G tem valor (subtotal do grupo).
    if (colA !== "" && colD === "" && totalG.ok) {
      const ordem = grupos.length + 1;
      grupoAtual = { nome: colA, ordem, itens: [] };
      grupos.push(grupoAtual);
      return;
    }

    // ITEM: col D tem número (valor unitário obrigatório).
    if (valorD.ok) {
      if (!grupoAtual) {
        grupoAtual = {
          nome: "Sem grupo",
          ordem: grupos.length + 1,
          itens: [],
        };
        grupos.push(grupoAtual);
        warnings.push({
          linha: rowNumber,
          motivo:
            "Item encontrado antes de qualquer grupo — agrupado em 'Sem grupo'.",
          severidade: "ajuste",
        });
      }

      // Valida tipo (col H). Se não for A/B/C/D, DESCARTA a linha com warning.
      const tipoUpper = colH.toUpperCase().trim();
      if (!TIPOS_VALIDOS.includes(tipoUpper as TipoCusto)) {
        warnings.push({
          linha: rowNumber,
          coluna: letra(8),
          motivo:
            tipoUpper === ""
              ? "Tipo de custo ausente na coluna H — linha descartada."
              : `Tipo "${colH}" ainda não é suportado (apenas A/B/C/D) — linha descartada.`,
          severidade: "ignorada",
        });
        linhasIgnoradas++;
        return;
      }

      const qtd = toNumber(colE);
      const dm = toNumber(colF);

      if (!qtd.ok && colE !== "") {
        warnings.push({
          linha: rowNumber,
          coluna: letra(5),
          motivo: `Quantidade inválida ("${colE}") — assumida 1.`,
          severidade: "ajuste",
        });
      }
      if (!dm.ok && colF !== "") {
        warnings.push({
          linha: rowNumber,
          coluna: letra(6),
          motivo: `Dias/meses inválido ("${colF}") — assumido 1.`,
          severidade: "ajuste",
        });
      }

      // Nome do item vem da col C. Se estiver vazia, cai para col A como fallback.
      const nomeItem = colC !== "" ? colC : colA;
      if (colC === "") {
        warnings.push({
          linha: rowNumber,
          coluna: letra(3),
          motivo:
            "Nome do item vazio na coluna C — usamos o texto da coluna A como fallback.",
          severidade: "ajuste",
        });
      }

      // Planejado (cols I=R$, J=QT, K=D/M). Cols L (TT) e M (RENTA) ignoradas.
      const rawColI = row.getCell(9).value;
      const rawColJ = row.getCell(10).value;
      const rawColK = row.getCell(11).value;

      const valorPlanejado = toNumber(rawColI);
      const qtdPlanejada = toNumber(rawColJ);
      const dmPlanejado = toNumber(rawColK);

      grupoAtual.itens.push({
        ordem: grupoAtual.itens.length + 1,
        item: nomeItem,
        tipo_custo: tipoUpper as TipoCusto,
        valor_unitario_orcado: valorD.n,
        quantidade_orcada: qtd.ok ? qtd.n : 1,
        dias_meses_orcado: dm.ok ? dm.n : 1,
        valor_unitario_planejado: valorPlanejado.ok ? valorPlanejado.n : 0,
        quantidade_planejada: qtdPlanejada.ok ? qtdPlanejada.n : 0,
        dias_meses_planejado: dmPlanejado.ok ? dmPlanejado.n : 0,
        planilha_origem: colA !== "" ? colA : null,
        linha_xlsx: rowNumber,
      });
      linhasImportadas++;
      return;
    }

    // Nenhum padrão bate — anômala.
    warnings.push({
      linha: rowNumber,
      motivo: "Linha não reconhecida — descartada.",
      severidade: "ignorada",
    });
    linhasIgnoradas++;
  });

  if (!headerEncontrado) {
    warnings.push({
      linha: 0,
      motivo:
        'Não encontramos a linha de header (com "PLANILHA"/"ITEM"/"R$"). Confirme se a aba está no formato padrão.',
      severidade: "ignorada",
    });
  }

  // Remove grupos vazios (podem sobrar se todos os itens de um grupo forem
  // de tipo não suportado, por exemplo).
  const gruposComItens = grupos
    .filter((g) => g.itens.length > 0)
    .map((g, idx) => ({ ...g, ordem: idx + 1 }));

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
