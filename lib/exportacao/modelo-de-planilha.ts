import ExcelJS from "exceljs";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import { PERCENTUAL_INT_TAXES_PADRAO } from "@/lib/impostos";
import { adicionarAbaInterna } from "./planilha-interna";
import { secaoInternaDaVersao } from "./interna-da-versao";

/**
 * A planilha modelo, vazia (decisão 110): a planilha interna do ERP
 * (decisão 088) sem nenhum item, na aba "Padrão". ORÇAMENTO, PLANEJADO e
 * REALIZADO nas colunas do desenho do modal de importação, e o importador
 * a lê de volta sem ajuste. No mensal, um bloco vazio por mês de `meses`.
 */
export function montarPlanilhaModelo(
  // A Mídia Off ainda não tem planilha para exportar e importar (decisão
  // 147): o modal de importação fica desligado nela.
  modelo: Exclude<CategoriaModeloPlanilha, "midia_off">,
  meses: string[] = [],
): ExcelJS.Workbook {
  const nomeDoModelo =
    modelo === "internacional" ? "internacional" : modelo === "mensal" ? "mensal" : "nacional";
  const wb = new ExcelJS.Workbook();
  adicionarAbaInterna(wb, "Padrão", {
    identificacao: "Planilha modelo",
    clienteNome: "",
    titulo: `Orçamento ${nomeDoModelo} · planilha modelo`,
    marca: "interna:orcamento",
    modelo,
    ...(modelo === "internacional" ? { moeda: "USD", cambioCompra: null, cambio: null } : {}),
    comRealizado: false,
    secoes: [
      secaoInternaDaVersao({
        percentualHonorarios: 0,
        percentualImposto: 0,
        internacional:
          modelo === "internacional"
            ? { percentualIntTaxes: PERCENTUAL_INT_TAXES_PADRAO, intTransactionCosts: 0 }
            : null,
        ...(modelo === "mensal"
          ? { meses: meses.map((mes) => ({ mes, grupos: [] })) }
          : { grupos: [] }),
      }),
    ],
  });
  return wb;
}
