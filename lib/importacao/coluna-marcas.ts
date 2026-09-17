import ExcelJS from "exceljs";
import { COLUNA_ID, MARCA_ORCAMENTO } from "@/lib/exportacao/planilha-orcamento";
import { MARCA_INTERNA, MARCA_INTERNA_JOB } from "@/lib/exportacao/planilha-interna";

/**
 * Onde mora a coluna oculta das marcas (`orc:`, `v:`, `grp:`, `it:`,
 * `mes:`, `resumo:`) da planilha que o próprio ERP exportou.
 *
 * Na planilha do cliente ela é sempre a H (`COLUNA_ID`). Na **interna**
 * (decisão 088) as colunas H..L são o PLANEJADO e M..Q o REALIZADO, então
 * a coluna das marcas vai para depois do último bloco visível — a M no
 * modo orçamento, a R no do job. Quem diz onde ela está é a linha 1:
 * `interna:orcamento` ou `interna:job` na própria coluna.
 *
 * Planilha sem marca nenhuma — o modelo da agência, ou uma em que
 * apagaram a coluna — cai na H, que é o que os dois parsers já faziam.
 */

/** Varredura da linha 1. A interna do job para na R (18); 40 dá folga. */
const ULTIMA_COLUNA_VARRIDA = 40;

export const RECUSA_INTERNA_DO_JOB =
  "Esta é a planilha interna do job (orçado, planejado e realizado), e ela não volta pelo Importar: o realizado nasce das PPs, não da planilha. Para importar, use a planilha do orçamento — no modo Interna ou na do cliente. Nada foi importado.";

export interface ColunaDeMarcas {
  /** 1 = A. */
  coluna: number;
  /** A planilha é uma interna, e de qual lado. `null` nas demais. */
  interna: "orcamento" | "job" | null;
}

function texto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const anyV = v as { text?: unknown; richText?: { text?: string }[] };
    if (typeof anyV.text === "string") return anyV.text.trim();
    if (Array.isArray(anyV.richText)) {
      return anyV.richText.map((r) => r.text ?? "").join("").trim();
    }
    return "";
  }
  return String(v).trim();
}

export function acharColunaDeMarcas(ws: ExcelJS.Worksheet): ColunaDeMarcas {
  const linha1 = ws.getRow(1);
  let porOrcamento: number | null = null;

  for (let c = 1; c <= ULTIMA_COLUNA_VARRIDA; c++) {
    const valor = texto(linha1.getCell(c).value);
    if (valor === "") continue;
    if (valor.startsWith(MARCA_INTERNA)) {
      return {
        coluna: c,
        interna: valor.startsWith(MARCA_INTERNA_JOB) ? "job" : "orcamento",
      };
    }
    // A exportação de versão única grava `orc:…|v:…` na linha 1 da coluna
    // oculta; serve de segunda pista, caso a marca da interna suma.
    if (
      porOrcamento === null &&
      valor.split("|").some((p) => p.trim().startsWith(MARCA_ORCAMENTO))
    ) {
      porOrcamento = c;
    }
  }

  return { coluna: porOrcamento ?? COLUNA_ID, interna: null };
}
