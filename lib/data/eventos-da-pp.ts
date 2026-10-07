import type { PedidoForaDoCadastro, PPEvento, PPEventoTipo } from "@/lib/types";

/**
 * O histórico da PP embutido na consulta de `pedidos_compra` (decisão 136).
 *
 * A tabela é escrita pelo banco — os gatilhos da emissão, da urgência, do
 * pagamento fora do cadastro e de cada mudança de status da PP e da
 * prestação de contas; e a RPC da correção da NF da PP em avaliação
 * (`nf_corrigida`, revisão da decisão 152). Ela existe porque as colunas da PP guardam um evento por tipo:
 * o reenvio apagava a rejeição, e o financeiro não sabia quem tinha mandado
 * a PP de volta.
 *
 * `enviada_financeiro_em/por` continuam sendo o PRIMEIRO envio (o chat das
 * PPs conta o prazo a partir dele). O último envio sai daqui.
 */
export const SELECT_EVENTOS_DA_PP =
  "eventos:pedidos_compra_eventos(evento, em, seq, so_data, motivo, autor:profiles!por(nome))";

type EventoBruto = {
  evento: PPEventoTipo;
  em: string;
  seq: number | string;
  so_data: boolean | null;
  motivo: string | null;
  autor: { nome: string } | Array<{ nome: string }> | null;
};

/** Na ordem em que aconteceram; `seq` desempata o mesmo instante. */
export function eventosDaPP(bruto: unknown): PPEvento[] {
  const lista = (Array.isArray(bruto) ? bruto : []) as EventoBruto[];
  return lista
    .slice()
    .sort((a, b) => {
      const t = new Date(a.em).getTime() - new Date(b.em).getTime();
      return t !== 0 ? t : Number(a.seq) - Number(b.seq);
    })
    .map((e) => ({
      evento: e.evento,
      por_nome: (Array.isArray(e.autor) ? e.autor[0]?.nome : e.autor?.nome) ?? null,
      em: e.em,
      so_data: e.so_data === true,
      motivo: e.motivo ?? null,
    }));
}

const ROTULO: Record<PPEventoTipo, string> = {
  emitida: "Emitida",
  urgente: "Marcada como urgente",
  urgencia_retirada: "Urgência retirada",
  fora_do_cadastro: "Pagamento fora do cadastro pedido",
  enviada: "Enviada ao financeiro",
  envio_desfeito: "Envio desfeito",
  rejeitada: "Rejeitada",
  reenviada: "Reenviada ao financeiro",
  aprovada: "Aprovada",
  aprovacao_desfeita: "Aprovação desfeita",
  reprovada: "Reprovada depois de aprovada",
  paga: "Paga",
  baixa_desfeita: "Baixa desfeita",
  cancelada: "Cancelada",
  prestacao_enviada: "Prestação de contas enviada",
  prestacao_reenviada: "Prestação de contas reenviada",
  prestacao_reprovada: "Prestação de contas reprovada",
  prestacao_aprovada: "Prestação de contas aprovada",
  nf_corrigida: "NF corrigida",
};

export function rotuloDoEventoPP(t: PPEventoTipo): string {
  return ROTULO[t];
}

/** A justificativa entra no histórico só onde ela explica a decisão. A da
 *  urgência e a do pagamento fora do cadastro já têm caixa própria no
 *  dossiê. */
export function eventoPPMostraMotivo(t: PPEventoTipo): boolean {
  return (
    t === "rejeitada" ||
    t === "reprovada" ||
    t === "aprovacao_desfeita" ||
    t === "cancelada" ||
    t === "prestacao_reprovada" ||
    // O que mudou na nota (revisão da decisão 152).
    t === "nf_corrigida"
  );
}

export interface EnvioDaPP {
  por_nome: string | null;
  em: string;
  /** O último envio foi um reenvio, depois de uma rejeição. */
  reenviada: boolean;
}

/** O último envio ao financeiro: o primeiro, ou o reenvio depois da
 *  rejeição. Null para a PP que nunca foi enviada. */
export function ultimoEnvioDaPP(eventos: PPEvento[]): EnvioDaPP | null {
  return ultimo(eventos, "enviada", "reenviada");
}

/** O último envio da prestação de contas da verba. */
export function ultimoEnvioDaPrestacao(eventos: PPEvento[]): EnvioDaPP | null {
  return ultimo(eventos, "prestacao_enviada", "prestacao_reenviada");
}

function ultimo(
  eventos: PPEvento[],
  envio: PPEventoTipo,
  reenvio: PPEventoTipo,
): EnvioDaPP | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.evento === envio || e.evento === reenvio) {
      return { por_nome: e.por_nome, em: e.em, reenviada: e.evento === reenvio };
    }
  }
  return null;
}

/** A última correção da NF com a PP em avaliação (revisão da decisão
 *  152): quem, quando e o que mudou. Null = a NF não foi corrigida. */
export function ultimaCorrecaoDaNf(
  eventos: PPEvento[],
): { por_nome: string | null; em: string; motivo: string | null } | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.evento === "nf_corrigida") return { por_nome: e.por_nome, em: e.em, motivo: e.motivo };
  }
  return null;
}

/** Quem pediu o pagamento fora do cadastro e quando (decisão 137): o
 *  último pedido, porque a PP corrigida pode trocar a chave. */
export function pedidoForaDoCadastro(eventos: PPEvento[]): PedidoForaDoCadastro | null {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const e = eventos[i];
    if (e.evento === "fora_do_cadastro") return { por_nome: e.por_nome, em: e.em };
  }
  return null;
}
