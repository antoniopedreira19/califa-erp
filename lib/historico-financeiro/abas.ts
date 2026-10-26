/**
 * O papel de cada aba da planilha "Fin. Conta Califórnia" na importação do
 * histórico financeiro — decisão 211, com as respostas de 25/10/2026:
 *
 *   - D2 (contas): as 9 abas de conta que existem no sistema entram; Fundo
 *     Fixo e BB Americas entram em contas a criar; Santander Community, BB
 *     FitDance e Bradesco FitDance ficam fora;
 *   - D3 (período): a primeira carga vai de 01/01/2023 a 30/06/2026. O 3T de
 *     2026 entra quando o trimestre fechar; de 01/10/2026 em diante vale o
 *     sistema (extrato OFX e conciliação).
 *
 * Aba que não está aqui sai no resumo da padronização como "aba nova":
 * uma versão nova da planilha pode trazer aba que ainda não tem regra.
 */

export type AbaDeConta = {
  papel: "conta";
  /** Nome da conta no sistema (ou o nome proposto, quando ela ainda não existe). */
  conta: string;
  situacao: "importar" | "criar" | "fora";
};

export type AbaDeFaturamento = {
  papel: "faturamento";
  /** CNPJ emissor, pelo nome do estabelecimento no módulo fiscal quando ele existe. */
  estabelecimento: string;
  situacao: "importar" | "fora";
};

export type AbaDeResultado = {
  papel: "resultado";
  /** A empresa como a planilha a chama. */
  empresaDaAba: "California" | "CMH" | "Hitlab" | "Go Crazy" | "Ventura" | "Infloo";
  ano: number;
  /** Onde as fórmulas da aba procuram o job nas contas. */
  coluna: "job" | "evento";
};

export type AbaDeReferencia = { papel: "referencia" };

export type PapelDaAba = AbaDeConta | AbaDeFaturamento | AbaDeResultado | AbaDeReferencia;

const conta = (nome: string, situacao: AbaDeConta["situacao"] = "importar"): AbaDeConta => ({ papel: "conta", conta: nome, situacao });
const fat = (estabelecimento: string, situacao: AbaDeFaturamento["situacao"] = "importar"): AbaDeFaturamento => ({
  papel: "faturamento",
  estabelecimento,
  situacao,
});
const res = (empresaDaAba: AbaDeResultado["empresaDaAba"], ano: number): AbaDeResultado => ({
  papel: "resultado",
  empresaDaAba,
  ano,
  coluna: empresaDaAba === "California" || empresaDaAba === "Go Crazy" ? "job" : "evento",
});
const referencia: AbaDeReferencia = { papel: "referencia" };

export const PAPEL_DAS_ABAS: Readonly<Record<string, PapelDaAba>> = {
  // Contas bancárias (D2)
  "Conta California BB": conta("BB California"),
  "Conta Santander Califórnia": conta("California Santander"),
  "California Bradesco": conta("Bradesco California"),
  "XP California": conta("XP California"),
  Paypal: conta("Paypal California"),
  "Santander Go Crazy": conta("Santander GoCrazy"),
  "BB Go Crazy": conta("BB GoCrazy"),
  "XP Go Crazy": conta("XP GoCrazy"),
  "Santander Hitlab": conta("Santander Hitlab"),
  "Fundo Fixo Califórnia": conta("Fundo Fixo California", "criar"),
  "BB Americas": conta("BB Americas", "criar"),
  "Santander Community": conta("Santander Community", "fora"),
  "BB FitDance": conta("BB FitDance", "fora"),
  "Bradesco FitDance": conta("Bradesco FitDance", "fora"),

  // Faturamento: o estabelecimento emissor de cada aba
  "Faturamento California": fat("California · Salvador"),
  "Faturamento Cali Fortaleza": fat("California · Fortaleza"),
  "Faturamento Cali SP": fat("California · São Paulo"),
  "Faturamento Hitlab": fat("Hitlab · Salvador"),
  "Faturamento Go Crazy St André": fat("GoCrazy · Santo André"),
  "Faturamento Go Crazy": fat("GoCrazy (aba Faturamento Go Crazy)"),
  "Faturamento Go Crazy SP": fat("GoCrazy · São Paulo"),
  "FATURAMENTO fit": fat("FitDance", "fora"),

  // Resultado de jobs
  "Res. Jobs 2027": res("California", 2027),
  "Res. Jobs 2026": res("California", 2026),
  "Res. Jobs 2025": res("California", 2025),
  "Res. Jobs 2024": res("California", 2024),
  "Res. Jobs 2023": res("California", 2023),
  "Res. Jobs 2022": res("California", 2022),
  "Res. Jobs 2021": res("California", 2021),
  "Res. Jobs 2020": res("California", 2020),
  "Nova Res. Jobs 2019": res("California", 2019),
  "Res. Jobs CMH 2027": res("CMH", 2027),
  "Res. Jobs CMH 2026": res("CMH", 2026),
  "Res. Jobs CMH 2025": res("CMH", 2025),
  "Res. Jobs CMH 2024": res("CMH", 2024),
  "Res. Jobs CMH 2023": res("CMH", 2023),
  "Res. Jobs CMH 2022": res("CMH", 2022),
  "Res. Jobs CMH 2021": res("CMH", 2021),
  "Res. Jobs CMH 2020": res("CMH", 2020),
  "Res. Jobs CMH 2019": res("CMH", 2019),
  "Cópia de Res. Jobs CMH 2018": res("CMH", 2018),
  "Res. Jobs HTLB 2027": res("Hitlab", 2027),
  "Res. Jobs HTLB 2026": res("Hitlab", 2026),
  "Res. Jobs HTLB 2025": res("Hitlab", 2025),
  "Res. Jobs HTLB 2024": res("Hitlab", 2024),
  "Res. Jobs Go Crazy 2027": res("Go Crazy", 2027),
  "Res. Jobs Go Crazy 2026": res("Go Crazy", 2026),
  "Res. Jobs Go Crazy 2025": res("Go Crazy", 2025),
  "Res. Jobs Go Crazy 2024": res("Go Crazy", 2024),
  "Res. Jobs VENTURA 2026": res("Ventura", 2026),
  "Res. Jobs INFLOOL 2025": res("Infloo", 2025),

  // Relatórios e listas: servem de conferência, não se importam
  DRE: referencia,
  "Cópia de DRE": referencia,
  "DRE CMH": referencia,
  "DRE HIT": referencia,
  "DRE Ventura": referencia,
  "DRE Doca": referencia,
  "DRE COMMUNITY": referencia,
  "DRE INFLOO": referencia,
  "Gerencial 26": referencia,
  "Gerencial 25": referencia,
  "Gerencial 25 CMH": referencia,
  "Gerencial 24": referencia,
  "Gerencial 24 CMH": referencia,
  "Gerencial 23": referencia,
  "Gerencial 23 CMH": referencia,
  "Gerencial 22": referencia,
  FluxodeCaixa: referencia,
  "FluxodeCaixa-2026": referencia,
  "FluxodeCaixa-2027": referencia,
  "2024 - FluxodeCaixa": referencia,
  "2023 - FluxodeCaixa": referencia,
  "Fat por cliente": referencia,
  "Cópia de Fat por cliente": referencia,
  Inadimplentes: referencia,
  PerdaRecebimento: referencia,
  "Tabela PerdaInadimplentes": referencia,
  Consolidado: referencia,
  "Centro de Custo Código": referencia,
  "Página115": referencia,
  "Página101": referencia,
  "Resumo Califas": referencia,
};

/** A empresa gerencial do sistema para os jobs de cada aba de resultado (D1). */
export const EMPRESA_DA_ABA_DE_RESULTADO: Readonly<Record<AbaDeResultado["empresaDaAba"], string>> = {
  California: "Agência California",
  "Go Crazy": "Agência California",
  CMH: "CCH",
  Hitlab: "Hitlab",
  Ventura: "Ventura",
  Infloo: "Infloo",
};

/** Data de corte: até aqui vale o histórico; depois, o sistema. */
export const CORTE = "2026-09-30";

export type Carga = "anterior a 2023" | "1ª carga" | "3T 2026" | "depois do corte";

/** Em qual carga uma data entra (D3). */
export function cargaDaData(data: string): Carga {
  if (data < "2023-01-01") return "anterior a 2023";
  if (data <= "2026-06-30") return "1ª carga";
  if (data <= CORTE) return "3T 2026";
  return "depois do corte";
}
