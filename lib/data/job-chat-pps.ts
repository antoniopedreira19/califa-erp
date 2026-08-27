import type {
  ItemChat,
  JobMensagem,
  PedidoCompraNaLista,
} from "@/lib/types";
import { nomeContraparteBRPP } from "@/lib/types";

/**
 * Monta a thread do chat de PPs de um job.
 *
 * Só as mensagens humanas vêm de `jobs_mensagens` (escopo='pps'). Os cards
 * automáticos ("PP emitida", "PP paga", "PP rejeitada", "PP cancelada")
 * são derivados de `pedidos_compra` — nada duplicado, nunca divergem da
 * fonte, aparecem retroativamente sem backfill.
 *
 * Limitação: sem histórico de transições, uma PP no estado terminal
 * ("pago"/"rejeitada"/"cancelada") só rende UM card do estado atual, no
 * timestamp `updated_at`. No MVP essas transições não voltam atrás.
 */

function dataHora(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes}/${d.getFullYear()} ${hora}:${min}`;
}

function dataHoraCurta(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dia}/${mes} ${hora}:${min}`;
}

function moeda(v: number, moedaCode: string): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: moedaCode });
}

function prazoEmDias(createdAt: string, prazoPagamento: string): string {
  const emissao = new Date(createdAt.slice(0, 10));
  const vencimento = new Date(prazoPagamento.slice(0, 10));
  const dias = Math.round(
    (vencimento.getTime() - emissao.getTime()) / 86_400_000,
  );
  if (!Number.isFinite(dias)) return "—";
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

export function montarThreadChatPPs(
  pps: PedidoCompraNaLista[],
  mensagens: Array<JobMensagem & { autor_nome: string | null }>,
  moedaCode: string,
  fornecedoresPorId: Record<string, string>,
): ItemChat[] {
  const itens: ItemChat[] = [];

  // ---- Um card por PP: "emitida" sempre; se estado terminal, o card
  // corresponde ao ESTADO ATUAL (pago/rejeitada/cancelada) e sobe pra
  // updated_at. Uma PP que ainda está "em_avaliacao" só gera o card de
  // emissão.
  for (const pp of pps) {
    const fornecedorLookup = pp.fornecedor_id ? fornecedoresPorId[pp.fornecedor_id] : null;
    const fornecedorNome = nomeContraparteBRPP({
      verba_producao: pp.verba_producao,
      fornecedor: fornecedorLookup ? { nome: fornecedorLookup } : null,
      responsavel: pp.responsavel,
    }) || "Fornecedor";
    const valorFmt = moeda(Number(pp.valor ?? 0), moedaCode);

    // Card de emissão (sempre existe)
    itens.push({
      tipo: "sistema",
      id: `pp-emitida-${pp.id}`,
      icone: "file-text",
      cor: "azul",
      titulo: "PP emitida",
      quando: dataHora(pp.created_at),
      resumo: `${pp.codigo} · ${pp.servico} · ${fornecedorNome}`,
      valor: valorFmt,
      valorTom: "neutro",
      linhas: [
        {
          texto: "Prazo de pagamento",
          valor: prazoEmDias(pp.created_at, pp.prazo_pagamento),
          tom: "texto",
        },
        ...(pp.emitida_por_nome
          ? ([
              {
                texto: "Emitida por",
                valor: pp.emitida_por_nome,
                tom: "texto",
              },
            ] as const)
          : []),
      ],
      em: pp.created_at,
    });

    // Card de estado terminal (se houver)
    if (pp.status === "pago") {
      itens.push({
        tipo: "sistema",
        id: `pp-paga-${pp.id}`,
        icone: "check-circle",
        cor: "verde",
        titulo: "PP paga",
        quando: dataHora(pp.updated_at),
        resumo: `${pp.codigo} · ${fornecedorNome}`,
        valor: valorFmt,
        valorTom: "positivo",
        linhas: [],
        em: pp.updated_at,
      });
    } else if (pp.status === "rejeitada") {
      itens.push({
        tipo: "sistema",
        id: `pp-rejeitada-${pp.id}`,
        icone: "x-circle",
        cor: "vermelho",
        titulo: "PP rejeitada",
        quando: dataHora(pp.updated_at),
        resumo: `${pp.codigo} · ${fornecedorNome}`,
        valor: valorFmt,
        valorTom: "negativo",
        linhas: [],
        em: pp.updated_at,
      });
    } else if (pp.status === "cancelada") {
      itens.push({
        tipo: "sistema",
        id: `pp-cancelada-${pp.id}`,
        icone: "ban",
        cor: "bege",
        titulo: "PP cancelada",
        quando: dataHora(pp.updated_at),
        resumo: `${pp.codigo} · ${fornecedorNome}`,
        valor: valorFmt,
        valorTom: "neutro",
        linhas: [],
        em: pp.updated_at,
      });
    }
  }

  // ---- Mensagens humanas
  for (const m of mensagens) {
    itens.push({
      tipo: "pessoa",
      id: m.id,
      autor: m.autor_nome ?? "—",
      area: m.area,
      quando: dataHoraCurta(m.created_at),
      texto: m.texto,
      em: m.created_at,
    });
  }

  return itens.sort((a, b) => a.em.localeCompare(b.em));
}
