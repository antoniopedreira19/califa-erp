/**
 * A divergência entre o registro da NF tomada e o PDF dela (decisão 271,
 * leitura v3): o que mostrar e o que o "Usar os dados do PDF" preenche.
 */
import { formatDocumento } from "@/lib/utils";
import type { NotaTomada } from "./dados";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** Uma linha por campo que não bate: "Número: registro 03 · PDF 59540". */
export function linhasDaDivergencia(n: NotaTomada): string[] {
  const pdf = n.leitura.pdf;
  if (!pdf) return [];
  const out: string[] = [];
  for (const d of n.leitura.divergencias) {
    if (d === "numero") out.push(`Número: registro ${n.numero} · PDF ${pdf.numero ?? "—"}`);
    if (d === "emitente")
      out.push(
        `Emitente: registro ${n.fornecedor.documento ? formatDocumento(n.fornecedor.documento) : "—"} · PDF ${pdf.cnpj ? formatDocumento(pdf.cnpj) : "—"}`,
      );
    if (d === "emissao") out.push(`Emissão: registro ${data(n.data_emissao)} · PDF ${pdf.emissao ? data(pdf.emissao) : "—"}`);
    if (d === "valor") out.push(`Valor: registro ${brl(n.valor)} · PDF ${pdf.valor !== null ? brl(pdf.valor) : "—"}`);
  }
  return out;
}

const CAMPO: Record<string, string> = { numero: "número", emitente: "CNPJ do emitente", emissao: "emissão", valor: "valor" };

/** De onde veio a comparação: só a imagem (pode ser erro de leitura) ou o texto do PDF. */
export function origemDaLeitura(n: NotaTomada): string | null {
  if (n.leitura.divergencias.length === 0 && n.leitura.discordancias.length === 0) return null;
  const partes: string[] = [];
  if (n.leitura.soImagem && n.leitura.divergencias.length > 0)
    partes.push("Só pela leitura da imagem (o PDF não tem texto): pode ser erro de leitura. Confira o PDF.");
  if (n.leitura.discordancias.length > 0)
    partes.push(`A leitura da imagem e a do texto do PDF discordaram em ${n.leitura.discordancias.map((d) => CAMPO[d]).join(", ")}: valeu o texto.`);
  return partes.length ? partes.join(" ") : null;
}

/** O PDF é de outra nota (outro número ou outro emitente): a leitura não vale para esta. */
export const pdfDeOutraNota = (n: NotaTomada) => n.leitura.divergencias.includes("numero") || n.leitura.divergencias.includes("emitente");

/**
 * O que o "Usar os dados do PDF" preenche na linha em edição: número, emissão
 * e valor que divergem. O emitente não se corrige aqui (6a): o PDF de outro
 * emitente volta para quem enviou o documento.
 */
export function dadosDoPdf(n: NotaTomada): { numero?: string; emissao?: string; valor?: number } | null {
  const pdf = n.leitura.pdf;
  if (!pdf || n.leitura.divergencias.includes("emitente")) return null;
  const out: { numero?: string; emissao?: string; valor?: number } = {};
  if (n.leitura.divergencias.includes("numero") && pdf.numero) out.numero = pdf.numero;
  if (n.leitura.divergencias.includes("emissao") && pdf.emissao) out.emissao = pdf.emissao;
  if (n.leitura.divergencias.includes("valor") && pdf.valor !== null) out.valor = pdf.valor;
  return Object.keys(out).length ? out : null;
}
