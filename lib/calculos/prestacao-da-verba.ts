/**
 * A prestação de contas da verba, documento a documento (decisão 189).
 *
 * A regra do que cada tipo de documento exige vive aqui e no banco
 * (`_faltas_do_documento_da_prestacao`, que recusa o envio e a aprovação).
 * A tela usa esta para marcar os campos que faltam antes de mandar; o banco
 * tem a última palavra. As duas listas precisam andar juntas.
 *
 *   NF e fatura .. número, emissão, valor, CNPJ tomador, CNPJ e razão social
 *                  do emitente;
 *   cupom fiscal . número, emissão, valor e CNPJ do emitente (razão social
 *                  opcional);
 *   recibo ....... data, valor e quem recebeu (número e CPF/CNPJ opcionais);
 *   boleto e
 *   contrato ..... número e data, SEM valor — anexos de apoio, que não somam
 *                  no comprovado (a NF e o boleto da mesma compra não contam
 *                  duas vezes);
 *   outro ........ descrição, data e valor.
 */
import {
  documentoTipoLabel,
  type DocumentoDaPrestacao,
  type DocumentoTipo,
  type PPStatus,
  type PrestacaoDaVerba,
} from "@/lib/types";

/** Os 7 tipos do sistema, na ordem do seletor (pedido do Tiago, 19/10/2026). */
export const TIPOS_DA_PRESTACAO: readonly DocumentoTipo[] = [
  "nota_fiscal",
  "recibo",
  "fatura",
  "boleto",
  "contrato",
  "cupom_fiscal",
  "outro",
];

/** Boleto e contrato acompanham a compra, mas não comprovam gasto. */
export function tipoSomaNoComprovado(t: DocumentoTipo | null): boolean {
  return t !== "boleto" && t !== "contrato";
}

/** O campo que falta, como a tela o marca de vermelho. */
export type CampoDoDocumento =
  | "tipo"
  | "numero"
  | "descricao"
  | "data"
  | "valor"
  | "tomador"
  | "emitenteDocumento"
  | "emitenteNome";

/** Os campos de um documento como a gaveta os edita. */
export interface CamposDoDocumento {
  documento_tipo: DocumentoTipo | null;
  documento_numero: string;
  documento_data: string;
  valor: number | null;
  tomador_estabelecimento_id: string | null;
  emitente_documento: string;
  emitente_nome: string;
  descricao: string;
}

export const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** A mesma chave de `chave_do_numero_da_nf`: letras e dígitos, sem os zeros
 *  da frente. Vazia = número que não identifica a nota. */
export function chaveDoNumeroDaNf(numero: string): string {
  return numero.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^0+/, "");
}

export function camposDoDocumento(d: DocumentoDaPrestacao): CamposDoDocumento {
  return {
    documento_tipo: d.documento_tipo,
    documento_numero: d.documento_numero ?? "",
    documento_data: d.documento_data ?? "",
    valor: d.valor,
    tomador_estabelecimento_id: d.tomador_estabelecimento_id,
    emitente_documento: d.emitente_documento ?? "",
    emitente_nome: d.emitente_nome ?? "",
    descricao: d.descricao ?? "",
  };
}

/** O que falta para o documento ir ao financeiro (vazio = completo). */
export function faltasDoDocumento(d: CamposDoDocumento): CampoDoDocumento[] {
  const t = d.documento_tipo;
  if (!t) return ["tipo"];
  const f: CampoDoDocumento[] = [];
  const numero = d.documento_numero.trim();
  if (t === "nota_fiscal" || t === "fatura" || t === "cupom_fiscal" || t === "boleto" || t === "contrato") {
    if (!numero || (t === "nota_fiscal" && !chaveDoNumeroDaNf(numero))) f.push("numero");
  }
  if (t === "outro" && !d.descricao.trim()) f.push("descricao");
  if (!d.documento_data) f.push("data");
  if (tipoSomaNoComprovado(t) && !(Number(d.valor) > 0)) f.push("valor");
  if ((t === "nota_fiscal" || t === "fatura") && !d.tomador_estabelecimento_id) f.push("tomador");
  if ((t === "nota_fiscal" || t === "fatura" || t === "cupom_fiscal") && soDigitos(d.emitente_documento).length !== 14) {
    f.push("emitenteDocumento");
  }
  if ((t === "nota_fiscal" || t === "fatura" || t === "recibo") && !d.emitente_nome.trim()) f.push("emitenteNome");
  return f;
}

/** O que o documento comprova: o valor, menos em boleto e contrato. */
export function valorComprovado(d: Pick<DocumentoDaPrestacao, "documento_tipo" | "valor">): number {
  return tipoSomaNoComprovado(d.documento_tipo) ? Number(d.valor ?? 0) : 0;
}

/** A soma, em centavos (sem resto de ponto flutuante). */
export function somaComprovadaEmCentavos(docs: ReadonlyArray<Pick<DocumentoDaPrestacao, "documento_tipo" | "valor">>): number {
  return docs.reduce((s, d) => s + Math.round(valorComprovado(d) * 100), 0);
}

/** "NF 4521", "Recibo", "Outro · ticket de estacionamento". */
export function rotuloDoDocumento(d: Pick<DocumentoDaPrestacao, "documento_tipo" | "documento_numero" | "descricao">): string {
  if (!d.documento_tipo) return "Sem tipo";
  if (d.documento_tipo === "outro") {
    return d.descricao ? `Outro · ${d.descricao}` : "Outro";
  }
  const n = d.documento_numero?.trim();
  return n ? `${documentoTipoLabel(d.documento_tipo)} ${n}` : documentoTipoLabel(d.documento_tipo);
}

/** 00.000.000/0000-00 ou 000.000.000-00; o resto, como veio. */
export function formatarCpfCnpj(s: string | null | undefined): string {
  const d = soDigitos(s);
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return s ?? "";
}

/** O status da PP que aceita documentos: depois do envio ao financeiro. */
const PP_ACEITA_DOCUMENTOS: readonly PPStatus[] = ["em_avaliacao", "aprovada", "pago"];

/**
 * A produção pode mexer nos documentos agora? Desde o envio da PP ao
 * financeiro — mesmo antes do pagamento — até mandar a prestação; de novo
 * quando o financeiro reprova. O reembolso (decisão 187) não presta contas.
 */
export function producaoEditaPrestacao(pp: {
  verba_producao: boolean;
  tipo_verba?: string | null;
  status: PPStatus;
  prestacao: Pick<PrestacaoDaVerba, "status"> | null;
}): boolean {
  if (!pp.verba_producao || pp.tipo_verba === "reembolso") return false;
  if (!PP_ACEITA_DOCUMENTOS.includes(pp.status)) return false;
  return !pp.prestacao || pp.prestacao.status === "rascunho" || pp.prestacao.status === "reprovada";
}

/** O texto do botão da verba na trilha da aba PPs e no cartão do painel. */
export function rotuloDoBotaoDaPrestacao(pp: {
  prestacao: Pick<PrestacaoDaVerba, "status" | "documentos"> | null;
}): string {
  if (pp.prestacao?.status === "reprovada") return "Corrigir prestação";
  if (pp.prestacao && pp.prestacao.documentos.length > 0) return "Continuar prestação";
  return "Prestar contas";
}

/** O documento com os campos editados por cima (a correção do financeiro,
 *  ainda na tela). */
export function aplicarCampos(d: DocumentoDaPrestacao, c: CamposDoDocumento | undefined): DocumentoDaPrestacao {
  if (!c) return d;
  return {
    ...d,
    documento_tipo: c.documento_tipo,
    documento_numero: c.documento_numero.trim() || null,
    documento_data: c.documento_data || null,
    valor: tipoSomaNoComprovado(c.documento_tipo) ? c.valor : null,
    tomador_estabelecimento_id: c.tomador_estabelecimento_id,
    emitente_documento: soDigitos(c.emitente_documento) || null,
    emitente_nome: c.emitente_nome.trim() || null,
    descricao: c.descricao.trim() || null,
  };
}

/** A mesma coisa dita igual: para saber se a correção mudou algo. */
export function chaveDosCampos(c: CamposDoDocumento): string {
  return JSON.stringify({
    ...c,
    documento_numero: c.documento_numero.trim(),
    emitente_documento: soDigitos(c.emitente_documento),
    emitente_nome: c.emitente_nome.trim(),
    descricao: c.descricao.trim(),
    valor: c.valor == null ? null : Math.round(c.valor * 100),
  });
}
