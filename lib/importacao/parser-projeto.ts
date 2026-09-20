import ExcelJS from "exceljs";
import type {
  CategoriaModeloPlanilha,
  ImportacaoWarning,
  TipoCusto,
} from "@/lib/types";
import { TIPOS_CUSTO } from "@/lib/calculos/versao-totais";
import {
  MARCA_GRUPO,
  MARCA_ITEM,
  MARCA_MES,
  MARCA_ORCAMENTO,
  MARCA_RESUMO,
  MARCA_VERSAO,
} from "@/lib/exportacao/planilha-orcamento";
import { isoDoMes, mesDoRotulo } from "@/lib/calculos/meses-trimestre";
import { acharColunaDeMarcas, RECUSA_INTERNA_DO_JOB } from "./coluna-marcas";

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
 *              FATURAMENTO — fecha a seção; a leitura recomeça no título
 *              do próximo orçamento (ou do próximo mês).
 *
 * **Exportação internacional** (decisão 072, 14/09/2026): A · SHEET,
 * B · ITEM, C · TT USD, D · BRL (unitário), E · QT, F · D/M, G · TT BRL, e
 * os mesmos ids na H. Sem coluna de tipo: a linha sai com `tipo_custo`
 * `null`, e o diff mantém o tipo da linha casada ou usa B na nova. O
 * fechamento tem o rótulo na C, com A e B vazias.
 *
 * **Exportação interna** (decisão 088, 17/09/2026): o mesmo orçado nas
 * colunas A..G, com PLANEJADO e REALIZADO à direita e a coluna das marcas
 * depois deles — quem a encontra é `acharColunaDeMarcas`, pela marca
 * `interna:…` da linha 1. A interna do JOB é recusada aqui mesmo: o
 * realizado nasce das PPs, não da planilha. A interna do ORÇAMENTO volta
 * normalmente, e como cada mês repete a faixa e o cabeçalho (o desenho da
 * aba SUL), as repetições são ignoradas.
 *
 * **Exportação mensal** (decisão 078, 15/09/2026): o layout do nacional,
 * com um bloco por mês. O título do mês carrega `mes:2026-10-01` na H e
 * abre o mês dos grupos seguintes; cada mês tem o seu fechamento, que aqui
 * é pulado até o título do próximo mês (ou da próxima seção). O título do
 * resumo, com `resumo:` na H, fecha a seção: o que vem embaixo dele é
 * resumo, e só o título do próximo orçamento recomeça a leitura.
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
  /** `null` na planilha internacional, que não tem coluna de tipo: vale o
   *  da linha casada, e B na linha nova (decisão do Tiago, 14/09/2026). */
  tipo_custo: TipoCusto | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  linha_xlsx: number;
}

export interface GrupoLido {
  grupoId: string | null;
  nome: string;
  /** Mês do bloco (`YYYY-MM-01`) na planilha mensal; `null` nos outros. */
  mes: string | null;
  itens: ItemLido[];
  linha_xlsx: number;
}

export interface MesLido {
  /** `YYYY-MM-01`, da marca `mes:` ou do título com ano; `null` quando o
   *  título não dá para ler — a análise recusa o orçamento. */
  mes: string | null;
  rotulo: string;
  linha_xlsx: number;
}

export interface SecaoLida {
  orcamentoId: string | null;
  versaoId: string | null;
  titulo: string;
  grupos: GrupoLido[];
  /** Os blocos de mês da seção, em ordem. Vazio fora do modelo mensal. */
  meses: MesLido[];
  linha_xlsx: number;
}

export interface LeituraProjeto {
  aba: string;
  /** Modelo da planilha, pelo cabeçalho (ou pelos blocos de mês, no
   *  mensal) — conferido contra o de cada orçamento na análise. */
  modelo: CategoriaModeloPlanilha;
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

/** Cabeçalho da planilha internacional (decisão 072) — ver
 *  `parser-oficial.ts`. Decide as colunas: lida com as do nacional, o TT
 *  em moeda viraria unitário e o TT BRL, tipo — as linhas cairiam como
 *  descartadas e o diff as trataria como apagadas. */
function ehLayoutInternacional(cells: string[]): boolean {
  return cells.slice(0, 7).some((c) => c.toLowerCase() === "tt brl");
}

/** Fechamento internacional: rótulo (texto, não número) na C com A e B
 *  vazias. Nas linhas de item e de grupo a C é o TT USD. */
function ehFechamentoInternacional(cells: string[], c: unknown): boolean {
  return cells[0] === "" && cells[1] === "" && cells[2] !== "" && !toNumber(c).ok;
}

/** Faixa de bloco — "ORÇAMENTO" na C, com A e B vazias. Na interna vêm
 *  também PLANEJADO e REALIZADO, fora das sete primeiras colunas. */
function ehLinhaFaixa(cells: string[]): boolean {
  if (cells[0] !== "" || cells[1] !== "") return false;
  const c = cells[2].toUpperCase();
  return c === "ORÇAMENTO" || c === "ORCAMENTO";
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
  mes: string | null;
  resumo: boolean;
} {
  const out = {
    orcamentoId: null as string | null,
    versaoId: null as string | null,
    grupoId: null as string | null,
    itemId: null as string | null,
    mes: null as string | null,
    resumo: false,
  };
  for (const parte of h.split("|")) {
    const p = parte.trim();
    if (p.startsWith(MARCA_ORCAMENTO)) out.orcamentoId = p.slice(MARCA_ORCAMENTO.length) || null;
    else if (p.startsWith(MARCA_VERSAO)) out.versaoId = p.slice(MARCA_VERSAO.length) || null;
    else if (p.startsWith(MARCA_GRUPO)) out.grupoId = p.slice(MARCA_GRUPO.length) || null;
    else if (p.startsWith(MARCA_ITEM)) out.itemId = p.slice(MARCA_ITEM.length) || null;
    else if (p.startsWith(MARCA_MES)) {
      const iso = p.slice(MARCA_MES.length);
      out.mes = /^\d{4}-\d{2}-01$/.test(iso) ? iso : null;
    } else if (p.startsWith(MARCA_RESUMO)) out.resumo = true;
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
      modelo: "nacional",
      secoes,
      warnings: [
        { linha: 0, motivo: "Planilha sem abas legíveis.", severidade: "ignorada" },
      ],
      linhas_lidas: 0,
      linhas_importadas: 0,
      linhas_ignoradas: 0,
    };
  }

  // A coluna das marcas é a H na planilha do cliente e vai para depois do
  // último bloco visível na interna (decisão 088).
  const colunaDeMarcas = acharColunaDeMarcas(ws);
  if (colunaDeMarcas.interna === "job") {
    return {
      aba: ws.name,
      modelo: "nacional",
      secoes: [],
      warnings: [{ linha: 0, motivo: RECUSA_INTERNA_DO_JOB, severidade: "ignorada" }],
      linhas_lidas: 0,
      linhas_importadas: 0,
      linhas_ignoradas: 0,
    };
  }

  // A exportação de versão única não tem linha de seção: os ids do
  // orçamento e da versão ficam nessa coluna, na linha 1.
  const marcaCabecalho = marcas(
    normalizar(ws.getCell(1, colunaDeMarcas.coluna).value),
  );

  let headerEncontrado = false;
  let layoutInternacional = false;
  /** Algum bloco de mês apareceu: o fechamento deixa de encerrar a leitura. */
  let layoutMensal = false;
  /** Entre o fechamento de um mês e o título do próximo. */
  let emFechamento = false;
  let mesAtual: string | null = null;
  let secaoAtual: SecaoLida | null = null;
  let grupoAtual: GrupoLido | null = null;

  const abrirSecaoImplicita = (linha: number) => {
    secaoAtual = {
      orcamentoId: marcaCabecalho.orcamentoId,
      versaoId: marcaCabecalho.versaoId,
      titulo: normalizar(ws.getCell(1, 1).value),
      grupos: [],
      meses: [],
      linha_xlsx: linha,
    };
    secoes.push(secaoAtual);
    grupoAtual = null;
  };

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= 7; c++) cells.push(normalizar(row.getCell(c).value));
    const h = normalizar(row.getCell(colunaDeMarcas.coluna).value);

    if (cells.every((c) => c === "")) return;
    linhasLidas++;

    const marcaDaLinha = marcas(h);

    // O primeiro cabeçalho decide o layout; os seguintes são repetição —
    // a planilha mensal e a interna repetem faixa e cabeçalho a cada mês.
    if (ehLinhaHeader(cells)) {
      if (!headerEncontrado) {
        headerEncontrado = true;
        layoutInternacional = ehLayoutInternacional(cells);
      }
      return;
    }
    if (ehLinhaFaixa(cells)) return;

    // Antes do primeiro cabeçalho só passam o título da seção e o do mês:
    // no mensal e na interna eles vêm ACIMA da faixa (o desenho da aba
    // SUL). O resto é identificação.
    if (!headerEncontrado && !marcaDaLinha.mes && !marcaDaLinha.orcamentoId) return;

    // Resumo (do trimestre, no mensal, ou do arquivo inteiro na interna do
    // projeto): o que vem embaixo dele não é conteúdo — mas o título do
    // orçamento seguinte pode vir, e ele recomeça a leitura.
    if (marcaDaLinha.resumo) {
      emFechamento = true;
      linhasIgnoradas++;
      return;
    }

    // MÊS (decisão 078): a marca `mes:` abre o bloco. Sem a marca (coluna
    // oculta apagada), vale o título com ano — mas só depois de um bloco
    // marcado, para um grupo chamado "Julho de 2026" num nacional
    // continuar sendo grupo.
    const rotuloDoMes =
      !marcaDaLinha.mes &&
      layoutMensal &&
      // Na interna o título do mês é mesclado, e a B devolve o texto da A.
      (cells[1] === "" || cells[1] === cells[0]) &&
      !marcaDaLinha.orcamentoId
        ? mesDoRotulo(cells[0])
        : null;
    if (marcaDaLinha.mes || rotuloDoMes?.ano) {
      layoutMensal = true;
      emFechamento = false;
      if (!secaoAtual) abrirSecaoImplicita(rowNumber);
      mesAtual =
        marcaDaLinha.mes ??
        (rotuloDoMes?.ano ? isoDoMes(rotuloDoMes.ano, rotuloDoMes.numero) : null);
      secaoAtual!.meses.push({ mes: mesAtual, rotulo: cells[0], linha_xlsx: rowNumber });
      grupoAtual = null;
      return;
    }

    // Entre o fechamento de um mês e o título do próximo só há fechamento.
    if (emFechamento && !marcaDaLinha.orcamentoId) {
      linhasIgnoradas++;
      return;
    }

    // O título da seção nunca é fechamento — e na interna ele é mesclado
    // de ponta a ponta, então o rótulo aparece em toda a linha.
    if (
      !marcaDaLinha.orcamentoId &&
      (layoutInternacional
        ? ehFechamentoInternacional(cells, row.getCell(3).value)
        : ehLinhaResumo(cells))
    ) {
      linhasIgnoradas++;
      // O fechamento encerra a SEÇÃO, não o arquivo: no mensal vem o
      // próximo mês, e na interna do projeto (decisão 088) cada orçamento
      // tem o seu, com o do orçamento seguinte logo abaixo. O que encerra
      // a leitura é a marca `resumo:`, lá em cima.
      emFechamento = true;
      return;
    }

    // Colunas do orçado: C/D/E no nacional, D/E/F no internacional.
    const [colA, colB, , , , , colG] = cells;
    const colUnit = layoutInternacional ? 4 : 3;
    const colQt = colUnit + 1;
    const colDm = colUnit + 2;
    const letraDe = (col: number) => String.fromCharCode(64 + col);
    const colC = cells[colUnit - 1];
    const colD = cells[colQt - 1];
    const colE = cells[colDm - 1];
    const m = marcas(h);
    const valorC = toNumber(row.getCell(colUnit).value);

    // SEÇÃO: a marca do orçamento decide; sem marca, uma linha só com
    // texto na A e nada em B/C/F seria grupo, então a seção sem id só
    // existe pela marca.
    if (m.orcamentoId) {
      secaoAtual = {
        orcamentoId: m.orcamentoId,
        versaoId: m.versaoId,
        titulo: colA,
        grupos: [],
        meses: [],
        linha_xlsx: rowNumber,
      };
      secoes.push(secaoAtual);
      grupoAtual = null;
      mesAtual = null;
      emFechamento = false;
      return;
    }

    // GRUPO: marca `grp:` ou texto na A sem valor unitário na C.
    if (m.grupoId || (colA !== "" && colB === "" && !valorC.ok)) {
      if (!secaoAtual) abrirSecaoImplicita(rowNumber);
      grupoAtual = {
        grupoId: m.grupoId,
        nome: colA !== "" ? colA : "Sem nome",
        mes: mesAtual,
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
          mes: mesAtual,
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
      if (!layoutInternacional && !TIPOS_VALIDOS.includes(tipoUpper as TipoCusto)) {
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
          coluna: letraDe(colUnit),
          motivo: `Valor unitário inválido ("${colC}") — linha descartada.`,
          severidade: "ignorada",
        });
        linhasIgnoradas++;
        return;
      }

      const qt = toNumber(row.getCell(colQt).value);
      const dm = toNumber(row.getCell(colDm).value);
      if (!qt.ok && colD !== "") {
        warnings.push({
          linha: rowNumber,
          coluna: letraDe(colQt),
          motivo: `Quantidade inválida ("${colD}") — assumida 1.`,
          severidade: "ajuste",
        });
      }
      if (!dm.ok && colE !== "") {
        warnings.push({
          linha: rowNumber,
          coluna: letraDe(colDm),
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
        tipo_custo: layoutInternacional ? null : (tipoUpper as TipoCusto),
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
    modelo: layoutInternacional ? "internacional" : layoutMensal ? "mensal" : "nacional",
    secoes,
    warnings,
    linhas_lidas: linhasLidas,
    linhas_importadas: linhasImportadas,
    linhas_ignoradas: linhasIgnoradas,
  };
}
