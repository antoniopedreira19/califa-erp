/**
 * A conferência do imposto "paga no histórico" (decisão 277, entrega 3):
 * as linhas de imposto do histórico da planilha (`historico_movimentos`) na
 * conta e no dia do pagamento, agrupadas pela descrição.
 *
 * Na planilha, cada guia paga é um débito no banco dividido em várias linhas
 * (por empresa gerencial e pelo trimestre do job), com os créditos de PIS e
 * COFINS em linhas positivas. Somadas pela descrição, as linhas da guia dão o
 * valor dela — o grupo que bate fica marcado. Sem linha nenhuma, a tela
 * avisa: marcar como paga no histórico um pagamento que não está lá tira a
 * saída do DRE e do fluxo de caixa.
 */
import { r2 } from "./datas";

export interface LinhaDoHistorico {
  descricao: string | null;
  plano_codigo: string | null;
  tipo_planilha: string | null;
  valor: number;
}

export interface GrupoDoHistorico {
  descricao: string;
  linhas: number;
  /** A soma das linhas: negativa é saída. */
  total: number;
  /** Os "Tipo" da planilha das linhas ("CT 4T 2026", "CMH CT 3T 2026"). */
  tipos: string[];
  /** A soma do grupo é o valor da guia (no centavo). */
  bate: boolean;
}

// Sem "tributo": na planilha ela aparece em descrição de serviço ("tributo a
// uma banda", cachê de show), não em pagamento de imposto.
const DE_IMPOSTO = /\b(darf|iss|pis|cofins|irpj|csll|iof|imposto)\b/i;

/** Linha de imposto: o centro de custo tributário (03) ou a descrição. */
export function ehLinhaDeImposto(l: Pick<LinhaDoHistorico, "plano_codigo" | "descricao">): boolean {
  return (l.plano_codigo ?? "").startsWith("03.") || DE_IMPOSTO.test(l.descricao ?? "");
}

/** "PIS CRÉDITO" → "PIS": o crédito da planilha entra no grupo do imposto dele. */
const SUFIXO_DE_CREDITO = /\s+CR[ÉE]DITOS?$/;

/**
 * As linhas de imposto agrupadas pela descrição; o grupo que bate com a guia
 * vem primeiro. A linha de crédito ("PIS CRÉDITO", positiva) soma no grupo do
 * imposto ("PIS"): é assim que a planilha abre a guia de PIS/COFINS não
 * cumulativos (o débito cheio menos o crédito = o valor pago).
 */
export function gruposDoHistorico(linhas: LinhaDoHistorico[], valorDaGuia: number): GrupoDoHistorico[] {
  const m = new Map<string, { descricao: string; doDebito: boolean; linhas: number; total: number; tipos: Set<string> }>();
  for (const l of linhas) {
    if (!ehLinhaDeImposto(l)) continue;
    const texto = (l.descricao ?? "").replace(/\s+/g, " ").trim() || "(sem descrição)";
    const chave = texto.toUpperCase().replace(SUFIXO_DE_CREDITO, "");
    const credito = chave !== texto.toUpperCase();
    const g = m.get(chave) ?? { descricao: chave, doDebito: false, linhas: 0, total: 0, tipos: new Set<string>() };
    // O nome do grupo: o texto da primeira linha do imposto (a de crédito só nomeia sem outra).
    if (!credito && !g.doDebito) {
      g.descricao = texto;
      g.doDebito = true;
    }
    g.linhas += 1;
    g.total = r2(g.total + Number(l.valor));
    if (l.tipo_planilha) g.tipos.add(l.tipo_planilha.trim());
    m.set(chave, g);
  }
  return [...m.values()]
    .map((g) => ({
      descricao: g.descricao,
      linhas: g.linhas,
      total: g.total,
      tipos: [...g.tipos].sort(),
      bate: Math.abs(Math.abs(g.total) - valorDaGuia) < 0.005,
    }))
    .sort((a, b) => Number(b.bate) - Number(a.bate) || Math.abs(b.total) - Math.abs(a.total));
}
