/**
 * A leitura do anexo pela IA, aplicada ao anexo em edição (decisão 192,
 * 19/10/2026). Puro: a tela (`useAnexosEmEdicao`) chama, e os testes
 * também.
 *
 * A regra: a leitura só preenche o que está vazio — o tipo que alguém já
 * escolheu, ou o número que já digitou, ficam. O CNPJ começa no da PP, que
 * é um palpite; o que o documento diz vale mais, desde que ninguém o tenha
 * trocado. Cada campo que ela preenche leva o selo "IA" até alguém mexer
 * nele. Sem tipo lido, a leitura conta como falha: escolhe-se à mão, como
 * antes.
 */
import type { CampoLidoPelaIA, DadosLidosDoDocumento, DocumentoTipo } from "@/lib/types";
import { documentoTemCnpj } from "@/lib/fiscal/cnpj-da-pp";

/** A leitura de um anexo: começa logo que o PDF sobe. `campos` são os que
 *  ela preencheu e ainda não foram mexidos. */
export interface LeituraDoAnexo {
  estado: "lendo" | "lido" | "falhou";
  campos: CampoLidoPelaIA[];
  /** A IA marcou dúvida (documento borrado, cortado, tipo incerto). */
  duvida?: boolean;
}

/** O que a leitura precisa do anexo em edição (o resto passa intacto). */
export interface AnexoQueRecebeLeitura {
  tipo: DocumentoTipo | null;
  /** O número fora da NF (na NF, ele mora em `nf.numero`). */
  numero: string | null;
  nf: { numero: string; emissao: string; valor: number; tomador: string };
  leitura?: LeituraDoAnexo;
}

export function aplicarLeitura<A extends AnexoQueRecebeLeitura>(
  a: A,
  d: DadosLidosDoDocumento,
  tomadorPadrao: string | null,
): A {
  const campos: CampoLidoPelaIA[] = [];
  let tipo = a.tipo;
  if (!tipo && d.tipo) {
    tipo = d.tipo;
    campos.push("tipo");
  }
  if (!tipo) return { ...a, leitura: { estado: "falhou", campos: [] } };
  const ehNf = tipo === "nota_fiscal";
  let numero = a.numero;
  const nf = { ...a.nf };
  if (d.numero && ehNf && !nf.numero.trim()) {
    nf.numero = d.numero;
    campos.push("numero");
  }
  if (d.numero && !ehNf && !(numero ?? "").trim()) {
    numero = d.numero;
    campos.push("numero");
  }
  if (ehNf && d.data_emissao && !nf.emissao) {
    nf.emissao = d.data_emissao;
    campos.push("emissao");
  }
  if (ehNf && d.valor_total && !(nf.valor > 0)) {
    nf.valor = d.valor_total;
    campos.push("valor");
  }
  if (documentoTemCnpj(tipo) && d.tomador_estabelecimento_id && (!nf.tomador || nf.tomador === tomadorPadrao)) {
    nf.tomador = d.tomador_estabelecimento_id;
    campos.push("tomador");
  }
  return { ...a, tipo, numero, nf, leitura: { estado: "lido", campos, duvida: d.confianca_baixa } };
}

/** O selo sai do campo que alguém mexeu. */
export function semSelo(leitura: LeituraDoAnexo | undefined, tirar: CampoLidoPelaIA[]): LeituraDoAnexo | undefined {
  if (!leitura || tirar.length === 0) return leitura;
  return { ...leitura, campos: leitura.campos.filter((c) => !tirar.includes(c)) };
}
