import ExcelJS from "exceljs";
import type { ImportacaoWarning, TipoCusto } from "@/lib/types";
import { TIPOS_CUSTO } from "@/lib/calculos/versao-totais";
import {
  COLUNA_ID,
  MARCA_GRUPO,
  MARCA_ITEM,
  MARCA_ORCAMENTO,
  MARCA_VERSAO,
} from "@/lib/exportacao/planilha-orcamento";

/**
 * Parser da planilha que o próprio ERP exportou — a do projeto
 * (`/api/orcamentos/[projetoId]/export`) ou a da versão única.
 *
 * Não é o parser da planilha oficial da agência (`parser-oficial.ts`):
 * o layout é outro. Aqui as colunas são A · PLANILHA (grupo), B · ITEM,
 * C · R$, D · QT, E · D/M, F · TT, G · tipo — e a coluna H, escondida,
 * carrega o id de cada linha, gravado na exportação:
 *
 *   `orc:<id>|v:<id>`  no título da seção (um orçamento)
 *   `grp:<id>`         na linha do grupo
 *   `it:<id>`          na linha do item
 *
 * O id é o que casa a linha de volta com a versão (decisão 041). Quem
 * apagar a coluna H perde o casamento por id — a linha cai na reserva por
 * grupo + descrição, feita em `diff-projeto.ts`, e o preview avisa.
 *
 * Classificação de linha, depois do header:
 *   - SEÇÃO  : H começa com `orc:`, OU (A com texto, B vazia, C vazia e
 *              a linha está pintada como título) — na prática, o `orc:`.
 *   - GRUPO  : H começa com `grp:`, OU (A com texto e C vazia).
 *   - ITEM   : H começa com `it:`, OU (B com texto e C numérica).
 *   - RESUMO : E contém SUB-TOTAL / TOTAL / IMPOSTO / HONORÁRIOS /
 *              FATURAMENTO — encerra a leitura.
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
const TIPOS_VALIDOS: readonly TipoCusto[] = TIPOS_CUSTO;

export interface ItemLido {
  /** Id do item na versão exportada, ou `null` (linha nova, ou id apagado). */
  itemId: string | null;
  item: string;
  tipo_custo: TipoCusto;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  linha_xlsx: number;
}

export interface GrupoLido {
  grupoId: string | null;
  nome: string;
  itens: ItemLido[];
  linha_xlsx: number;
}

export interface SecaoLida {
  orcamentoId: string | null;
  versaoId: string | null;
  titulo: string;
  grupos: GrupoLido[];
  linha_xlsx: number;
}

export interface LeituraProjeto {
  aba: string;
  secoes: SecaoLida[];
  warnings: ImportacaoWarning[];
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
  if (typeof v === "object" && v !== null) {
    const anyV = v as any;
    if (typeof anyV.result === "number" && Number.isFinite(anyV.result)) {
      return { ok: true, n: anyV.result };
    }
  }
  const raw = normalizar(v).replace(/[R$\s]/g, "");
  if (raw === "") return { ok: false, n: 0 };
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
      cleaned = raw.replace(/\./g, "");
    }
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? { ok: true, n } : { ok: false, n: 0 };
}

function ehLinhaHeader(cells: string[]): boolean {
  const joined = cells.slice(0, 7).map((c) => c.toLowerCase()).join("|");
  return KEYWORDS_HEADER.filter((k) => joined.includes(k)).length >= 3;
}

function ehLinhaResumo(cells: string[]): boolean {
  const alvo = cells[4].toLowerCase();
  return KEYWORDS_RESUMO.some((k) => alvo.includes(k));
}

/** Lê as marcas da coluna oculta: `orc:…|v:…`, `grp:…` ou `it:…`. */
function marcas(h: string): {
  orcamentoId: string | null;
  versaoId: string | null;
  grupoId: string | null;
  itemId: string | null;
} {
  const out = {
    orcamentoId: null as string | null,
    versaoId: null as string | null,
    grupoId: null as string | null,
    itemId: null as string | null,
  };
  for (const parte of h.split("|")) {
    const p = parte.trim();
    if (p.startsWith(MARCA_ORCAMENTO)) out.orcamentoId = p.slice(MARCA_ORCAMENTO.length) || null;
    else if (p.startsWith(MARCA_VERSAO)) out.versaoId = p.slice(MARCA_VERSAO.length) || null;
    else if (p.startsWith(MARCA_GRUPO)) out.grupoId = p.slice(MARCA_GRUPO.length) || null;
    else if (p.startsWith(MARCA_ITEM)) out.itemId = p.slice(MARCA_ITEM.length) || null;
  }
  return out;
}

// ---------- parser principal ----------

export async function parsePlanilhaProjeto(
  buffer: ArrayBuffer | Buffer,
): Promise<LeituraProjeto> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const ws =
    wb.worksheets.find((w) => w.name.trim().toLowerCase() === "orçamento") ??
    wb.worksheets.find((w) => w.name.trim().toLowerCase() === "orcamento") ??
    wb.worksheets[0];

  const warnings: ImportacaoWarning[] = [];
  const secoes: SecaoLida[] = [];
  let linhasLidas = 0;
  let linhasImportadas = 0;
  let linhasIgnoradas = 0;

  if (!ws) {
    return {
      aba: "",
      secoes,
      warnings: [
        { linha: 0, motivo: "Planilha sem abas legíveis.", severidade: "ignorada" },
      ],
      linhas_lidas: 0,
      linhas_importadas: 0,
      linhas_ignoradas: 0,
    };
  }

  // A exportação de versão única não tem linha de seção: os ids do
  // orçamento e da versão ficam na coluna H da linha 1.
  const marcaCabecalho = marcas(normalizar(ws.getCell(1, COLUNA_ID).value));

  let headerEncontrado = false;
  let secaoAtual: SecaoLida | null = null;
  let grupoAtual: GrupoLido | null = null;
  let terminou = false;

  const abrirSecaoImplicita = (linha: number) => {
    secaoAtual = {
      orcamentoId: marcaCabecalho.orcamentoId,
      versaoId: marcaCabecalho.versaoId,
      titulo: normalizar(ws.getCell(1, 1).value),
      grupos: [],
      linha_xlsx: linha,
    };
    secoes.push(secaoAtual);
    grupoAtual = null;
  };

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (terminou) return;

    const cells: string[] = [];
    for (let c = 1; c <= 7; c++) cells.push(normalizar(row.getCell(c).value));
    const h = normalizar(row.getCell(COLUNA_ID).value);

    if (cells.every((c) => c === "")) return;
    linhasLidas++;

    if (!headerEncontrado) {
      if (ehLinhaHeader(cells)) headerEncontrado = true;
      return;
    }

    if (ehLinhaResumo(cells)) {
      terminou = true;
      linhasIgnoradas++;
      return;
    }

    const [colA, colB, colC, colD, colE, , colG] = cells;
    const m = marcas(h);
    const valorC = toNumber(row.getCell(3).value);

    // SEÇÃO: a marca do orçamento decide; sem marca, uma linha só com
    // texto na A e nada em B/C/F seria grupo, então a seção sem id só
    // existe pela marca.
    if (m.orcamentoId) {
      secaoAtual = {
        orcamentoId: m.orcamentoId,
        versaoId: m.versaoId,
        titulo: colA,
        grupos: [],
        linha_xlsx: rowNumber,
      };
      secoes.push(secaoAtual);
      grupoAtual = null;
      return;
    }

    // GRUPO: marca `grp:` ou texto na A sem valor unitário na C.
    if (m.grupoId || (colA !== "" && colB === "" && !valorC.ok)) {
      if (!secaoAtual) abrirSecaoImplicita(rowNumber);
      grupoAtual = {
        grupoId: m.grupoId,
        nome: colA !== "" ? colA : "Sem nome",
        itens: [],
        linha_xlsx: rowNumber,
      };
      secaoAtual!.grupos.push(grupoAtual);
      return;
    }

    // ITEM: marca `it:` ou descrição na B com valor unitário na C.
    if (m.itemId || (colB !== "" && valorC.ok)) {
      if (!secaoAtual) abrirSecaoImplicita(rowNumber);
      if (!grupoAtual) {
        grupoAtual = {
          grupoId: null,
          nome: "Sem grupo",
          itens: [],
          linha_xlsx: rowNumber,
        };
        secaoAtual!.grupos.push(grupoAtual);
        warnings.push({
          linha: rowNumber,
          motivo:
            "Item encontrado antes de qualquer grupo — agrupado em 'Sem grupo'.",
          severidade: "ajuste",
        });
      }

      const tipoUpper = colG.toUpperCase().trim();
      if (!TIPOS_VALIDOS.includes(tipoUpper as TipoCusto)) {
        warnings.push({
          linha: rowNumber,
          coluna: "G",
          motivo:
            tipoUpper === ""
              ? "Tipo de custo ausente na coluna G — linha descartada."
              : `Tipo "${colG}" não é um tipo de custo válido — linha descartada.`,
          severidade: "ignorada",
        });
        linhasIgnoradas++;
        return;
      }

      if (!valorC.ok) {
        warnings.push({
          linha: rowNumber,
          coluna: "C",
          motivo: `Valor unitário inválido ("${colC}") — linha descartada.`,
          severidade: "ignorada",
        });
        linhasIgnoradas++;
        return;
      }

      const qt = toNumber(row.getCell(4).value);
      const dm = toNumber(row.getCell(5).value);
      if (!qt.ok && colD !== "") {
        warnings.push({
          linha: rowNumber,
          coluna: "D",
          motivo: `Quantidade inválida ("${colD}") — assumida 1.`,
          severidade: "ajuste",
        });
      }
      if (!dm.ok && colE !== "") {
        warnings.push({
          linha: rowNumber,
          coluna: "E",
          motivo: `Dias/meses inválido ("${colE}") — assumido 1.`,
          severidade: "ajuste",
        });
      }

      if (colB === "") {
        warnings.push({
          linha: rowNumber,
          coluna: "B",
          motivo: "Item sem descrição na coluna B — linha descartada.",
          severidade: "ignorada",
        });
        linhasIgnoradas++;
        return;
      }

      grupoAtual.itens.push({
        itemId: m.itemId,
        item: colB,
        tipo_custo: tipoUpper as TipoCusto,
        valor_unitario_orcado: valorC.n,
        quantidade_orcada: qt.ok ? qt.n : 1,
        dias_meses_orcado: dm.ok ? dm.n : 1,
        linha_xlsx: rowNumber,
      });
      linhasImportadas++;
      return;
    }

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
        'Não encontramos a linha de header (com "PLANILHA"/"ITEM"/"R$"). Confirme se o arquivo é a planilha exportada do projeto.',
      severidade: "ignorada",
    });
  }

  return {
    aba: ws.name,
    secoes,
    warnings,
    linhas_lidas: linhasLidas,
    linhas_importadas: linhasImportadas,
    linhas_ignoradas: linhasIgnoradas,
  };
}
