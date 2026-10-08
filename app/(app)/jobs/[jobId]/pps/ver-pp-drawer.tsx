"use client";

/**
 * A PP já enviada, no MESMO formulário em que ela foi preenchida — só que
 * travado (decisão do Tiago, 09/09/2026).
 *
 * A primeira versão desta tela (08/09) era uma ficha própria, com outra
 * ordem e outros rótulos. Ela obrigava quem já conhece o formulário de PP
 * a reaprender onde cada coisa mora. Agora é o formulário de `Gerar PP`
 * espelhado campo a campo, na mesma ordem e com os mesmos rótulos, em
 * caixas de leitura: quem gerou a PP reconhece a tela na hora.
 *
 * Duas diferenças de propósito:
 *
 *   * **a pergunta "Esta é a última PP deste item?" não existe aqui** —
 *     ela é sobre o item e já foi respondida na emissão (decisão 052);
 *   * **no lugar dela entra a linha do tempo** da PP: gerada → enviada →
 *     avaliação → aprovação → pagamento, com o passo de hoje aceso e os
 *     que ainda vêm apagados. É o que a produção pergunta depois do envio.
 *
 * Nada aqui grava, exceto o "Cancelar PP" do rodapé, que é a mesma action
 * e a mesma confirmação do painel "Destrinchar realizado".
 *
 * 08/10/2026 (pedido do Tiago, com print da PP-00084):
 *
 *   * **os anexos mostram o que foi informado no envio** — o tipo de cada
 *     arquivo e, na NF, número, data de emissão, valor, CNPJ tomador e a
 *     parte desta PP, no mesmo cartão do envio, travado. Os dados vêm do
 *     cadastro da nota (`carregarPPParaVisualizar`), que é o que o
 *     financeiro corrige; até a consulta voltar, da cópia no anexo;
 *   * **"Ver PDF da PP" virou "Visualizar"**: abre a tela lado a lado do
 *     Contas a Pagar — a mesma, `PPTela`, em leitura —, com o PDF da PP,
 *     o documento anexado e os dados na coluna da direita;
 *   * **"Fechar" foi para a esquerda** do rodapé; "Visualizar" e
 *     "Cancelar PP", para a direita.
 */

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  X,
  FileText,
  Eye,
  AlertCircle,
  AlertTriangle,
  Ban,
  Lock,
  Check,
  Clock,
  History,
  Image as ImageIcon,
} from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { PagamentoForaDoCadastroCartao } from "@/components/financeiro/pagamento-fora-do-cadastro";
import {
  documentoTipoLabel,
  podeCancelarPP,
  type AnexoDaPPNaLista,
  type PedidoCompraNaLista,
  type PPEvento,
  type PPEventoTipo,
  situacaoDaVerba,
  situacaoVerbaLabel,
} from "@/lib/types";
import { formatarCnpj } from "@/lib/fiscal/cadastro";
import {
  nfInicial,
  notasFiscaisDaLinhaPP,
  parteDaNota,
  type NotaDaLinhaPP,
} from "@/lib/fiscal/nf-da-pp";
import type { PPRow } from "@/app/(app)/financeiro/contas-a-pagar/pedidos-compra-list";
import type { EstabelecimentoDaNota } from "@/app/(app)/financeiro/contas-a-pagar/pp-dossie";
import { PPStatusChip } from "./pp-status-chip";
import { carregarPPParaVisualizar } from "./actions-visualizar";
import {
  signedUrlPdfParcela,
  signedUrlAnexo,
  cancelarPedidoCompra,
} from "../realizado/actions-pp";
import { ResumoDasNfs, type TomadorDaNf } from "../realizado/anexos-da-pp";

/** A tela lado a lado do Contas a Pagar, só quando alguém clica em
 *  "Visualizar": ela traz o dossiê, o chat e a aprovação do financeiro,
 *  que o job não precisa carregar de saída. */
const PPTela = dynamic(
  () => import("@/app/(app)/financeiro/contas-a-pagar/pp-tela").then((m) => m.PPTela),
  { ssr: false },
);

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pp: PedidoCompraNaLista | null;
  /** Fornecedor, ou o nome do responsável na verba de produção. Quem
   *  resolve o nome é quem já tem a lista de fornecedores carregada. */
  contraparteNome: string;
  empresaNome: string;
  /** O cartão do topo, igual ao do formulário: item, planejado e o que o
   *  item já tem em PPs — todas menos as canceladas (decisão 074). */
  itemDescricao: string;
  valorPlanejado: number;
  emPPsEmitidas: number;
  /** Os CNPJs tomadores do job, para o CNPJ das notas até a consulta da
   *  PP voltar (ela traz o cadastro inteiro, inativos inclusive). */
  tomadores: TomadorDaNf[];
  /** Cancelar no rodapé. `false` esconde o botão — quem só lê o job (o
   *  financeiro, o job encerrado) não cancela nada daqui. */
  podeCancelar: boolean;
  /** Toast de quem abriu a ficha. */
  onMensagem?: (mensagem: string) => void;
}

function formatData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

function formatDataHora(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Quantidade e D/M são fatores, não dinheiro: sem R$ e sem zeros à toa. */
function formatFator(n: number): string {
  return Number(n ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

/** O unitário do formulário mostra centavos sempre. */
function formatUnitario(n: number): string {
  return formatCurrency(Number(n ?? 0), "BRL");
}

function formatarTamanho(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/** Um passo da linha do tempo. */
interface Passo {
  chave: string;
  titulo: string;
  detalhe?: string | null;
  /** Justificativa do financeiro, entre aspas, numa linha própria. */
  motivo?: string | null;
  quando?: string | null;
  /** `negado`: rejeição ou reprovação que já passou (decisão 136). */
  estado: "feito" | "agora" | "futuro" | "negado";
}

/**
 * A linha do tempo da PP, a partir do histórico de eventos (decisão 136,
 * desenho aprovado em 01/10/2026): um passo por evento, na ordem em que
 * aconteceu, e depois o passo de agora e os que ainda vêm, como antes.
 *
 * - O que a produção fez leva o nome de quem fez (gerou, enviou,
 *   reenviou, cancelou, prestou contas). O que o financeiro fez aparece
 *   "pelo financeiro", sem o nome — a mesma regra da devolução do job.
 * - Rejeição e reprovação ficam com a justificativa e o ponto vermelho, e
 *   não somem mais quando a PP é reenviada.
 * - Urgência e pagamento fora do cadastro ficam de fora (Tiago): quem os
 *   vê é o financeiro, no Contas a Pagar.
 *
 * PP sem nenhum evento (não deveria existir: o histórico foi preenchido e
 * os gatilhos gravam tudo) cai na montagem antiga, pelas colunas.
 */
function passosDaPP(pp: PedidoCompraNaLista): Passo[] {
  const eventos = pp.eventos.filter((e) => !EVENTOS_FORA_DA_PRODUCAO.has(e.evento));
  if (eventos.length === 0) return passosDasColunas(pp);

  const situacaoVerba = situacaoDaVerba(pp);
  const quando = (e: PPEvento) => (e.so_data ? formatData(e.em) : formatDataHora(e.em));
  const ultimo = (tipos: PPEventoTipo[]) => {
    for (let i = eventos.length - 1; i >= 0; i--) {
      if (tipos.includes(eventos[i].evento)) return i;
    }
    return -1;
  };
  const ultimaAprovacao = ultimo(["aprovada"]);
  const ultimaPrestacao = ultimo([
    "prestacao_enviada",
    "prestacao_reenviada",
    "prestacao_reprovada",
    "prestacao_aprovada",
  ]);

  const passos: Passo[] = eventos.map((e, i) => {
    const base = { chave: `${e.evento}-${i}`, quando: quando(e) };
    switch (e.evento) {
      case "emitida":
        return { ...base, titulo: "Gerada", detalhe: e.por_nome, estado: "feito" };
      case "enviada":
        return { ...base, titulo: "Enviada ao financeiro", detalhe: e.por_nome, estado: "feito" };
      case "reenviada":
        return { ...base, titulo: "Reenviada ao financeiro", detalhe: e.por_nome, estado: "feito" };
      case "envio_desfeito":
        return { ...base, titulo: "Envio desfeito", estado: "feito" };
      case "rejeitada":
        return { ...base, titulo: "Rejeitada pelo financeiro", motivo: e.motivo, estado: "negado" };
      case "reprovada":
        return { ...base, titulo: "Reprovada pelo financeiro", motivo: e.motivo, estado: "negado" };
      case "aprovacao_desfeita":
        return { ...base, titulo: "Aprovação desfeita pelo financeiro", motivo: e.motivo, estado: "feito" };
      case "aprovada":
        return {
          ...base,
          titulo: "Aprovada pelo financeiro",
          detalhe:
            i !== ultimaAprovacao
              ? null
              : pp.prazo_pagamento_financeiro
                ? `pagamento programado para ${formatData(pp.prazo_pagamento_financeiro)}`
                : "virou título a pagar",
          estado: "feito",
        };
      case "paga":
        return { ...base, titulo: "Paga", estado: "feito" };
      case "baixa_desfeita":
        return { ...base, titulo: "Baixa desfeita pelo financeiro", estado: "feito" };
      case "cancelada":
        return {
          ...base,
          titulo: "Cancelada",
          detalhe: [e.por_nome, "o PDF e os anexos ficam guardados no histórico"]
            .filter(Boolean)
            .join(" · "),
          estado: "feito",
        };
      case "prestacao_enviada":
        return { ...base, titulo: "Prestação de contas enviada", detalhe: e.por_nome, estado: "feito" };
      case "prestacao_reenviada":
        return { ...base, titulo: "Prestação de contas reenviada", detalhe: e.por_nome, estado: "feito" };
      case "prestacao_reprovada":
        return { ...base, titulo: "Prestação reprovada pelo financeiro", motivo: e.motivo, estado: "negado" };
      case "nf_corrigida":
        // Revisão da decisão 152: a NF corrigida com a PP em avaliação.
        // O motivo é o que mudou, escrito pelo banco — vai sem aspas.
        return {
          ...base,
          titulo: "NF corrigida",
          detalhe: [e.por_nome, e.motivo].filter(Boolean).join(" — ") || null,
          estado: "feito",
        };
      case "prestacao_aprovada":
        return i === ultimaPrestacao && situacaoVerba === "concluida"
          ? { ...base, titulo: "Concluída", detalhe: "prestação aprovada pelo financeiro", estado: "feito" }
          : { ...base, titulo: "Prestação aprovada pelo financeiro", estado: "feito" };
      default:
        return { ...base, titulo: e.evento, estado: "feito" };
    }
  });

  // O passo de agora: o último evento que descreve o estado da PP, ou um
  // passo novo quando o estado ainda não é um evento ("em avaliação").
  const acender = (i: number, extra?: string) => {
    if (i < 0) return;
    passos[i] = {
      ...passos[i],
      estado: "agora",
      detalhe: [passos[i].detalhe, extra].filter(Boolean).join(" — ") || null,
    };
  };

  if (pp.status === "em_avaliacao") {
    passos.push(
      {
        chave: "avaliacao",
        titulo: "Em avaliação no financeiro",
        detalhe: "aguardando a data de pagamento e a aprovação",
        quando: "agora",
        estado: "agora",
      },
      { chave: "aprovacao", titulo: "Aprovação", quando: null, estado: "futuro" },
      { chave: "pagamento", titulo: "Pagamento", quando: null, estado: "futuro" },
    );
  } else if (pp.status === "rejeitada") {
    acender(ultimo(["rejeitada", "reprovada"]));
  } else if (pp.status === "aprovada") {
    acender(ultimaAprovacao);
    passos.push({ chave: "pagamento", titulo: "Pagamento", quando: null, estado: "futuro" });
  } else if (pp.status === "cancelada") {
    acender(ultimo(["cancelada"]));
  } else if (pp.status === "pago") {
    if (!situacaoVerba) {
      acender(ultimo(["paga"]));
    } else if (situacaoVerba === "aguardando_prestacao") {
      passos.push({
        chave: "prestacao",
        titulo: "Prestação de contas",
        detalhe: "preste contas na aba de PPs",
        quando: null,
        estado: "agora",
      });
    } else if (situacaoVerba === "prestacao_em_avaliacao") {
      passos.push({
        chave: "prestacao",
        titulo: situacaoVerbaLabel(situacaoVerba),
        detalhe: "com o financeiro",
        quando: "agora",
        estado: "agora",
      });
    } else if (situacaoVerba === "prestacao_reprovada") {
      acender(ultimo(["prestacao_reprovada"]), "corrija na aba de PPs");
    } else if (situacaoVerba === "devolucao_pendente") {
      passos.push({
        chave: "devolucao",
        titulo: situacaoVerbaLabel(situacaoVerba),
        detalhe: `estorno de verba de ${formatCurrency(pp.prestacao?.valor_devolvido ?? 0, "BRL")} aguardando a devolução`,
        quando: null,
        estado: "agora",
      });
    }
  }

  return passos;
}

/** Ficam no histórico do financeiro, não na linha do tempo da produção. */
const EVENTOS_FORA_DA_PRODUCAO = new Set<PPEventoTipo>([
  "urgente",
  "urgencia_retirada",
  "fora_do_cadastro",
]);

/**
 * A linha do tempo da PP, montada do que o registro tem — a de antes do
 * histórico de eventos, que ficou só como reserva.
 *
 * Só entra passo que aconteceu de verdade (tem data) ou que ainda vai
 * acontecer no caminho normal. Rejeição, aprovação, pagamento e
 * cancelamento aparecem quando existem — e a rejeição carrega o motivo,
 * que é o que faz o GP corrigir a PP.
 */
function passosDasColunas(pp: PedidoCompraNaLista): Passo[] {
  const passos: Passo[] = [];

  passos.push({
    chave: "gerada",
    titulo: "Gerada",
    detalhe: pp.emitida_por_nome,
    quando: formatDataHora(pp.created_at),
    estado: "feito",
  });

  if (pp.enviada_financeiro_em) {
    passos.push({
      chave: "enviada",
      titulo: "Enviada ao financeiro",
      detalhe: pp.enviada_financeiro_por_nome,
      quando: formatDataHora(pp.enviada_financeiro_em),
      estado: "feito",
    });
  }

  if (pp.rejeitada_em) {
    passos.push({
      chave: "rejeitada",
      titulo: "Rejeitada pelo financeiro",
      detalhe: pp.motivo_rejeicao,
      quando: formatDataHora(pp.rejeitada_em),
      estado: pp.status === "rejeitada" ? "agora" : "feito",
    });
  }

  if (pp.status === "em_avaliacao") {
    passos.push({
      chave: "avaliacao",
      titulo: "Em avaliação no financeiro",
      detalhe: "aguardando a data de pagamento e a aprovação",
      quando: "agora",
      estado: "agora",
    });
  }

  if (pp.aprovada_em) {
    passos.push({
      chave: "aprovada",
      titulo: "Aprovada pelo financeiro",
      detalhe: pp.prazo_pagamento_financeiro
        ? `pagamento programado para ${formatData(pp.prazo_pagamento_financeiro)}`
        : "virou título a pagar",
      quando: formatDataHora(pp.aprovada_em),
      estado: pp.status === "aprovada" ? "agora" : "feito",
    });
  } else if (pp.status === "em_avaliacao") {
    passos.push({
      chave: "aprovada",
      titulo: "Aprovação",
      quando: null,
      estado: "futuro",
    });
  }

  const situacaoVerba = situacaoDaVerba(pp);

  if (pp.pago_em) {
    passos.push({
      chave: "pago",
      titulo: "Paga",
      quando: formatData(pp.pago_em),
      estado: situacaoVerba ? "feito" : "agora",
    });
  } else if (pp.status === "em_avaliacao" || pp.status === "aprovada") {
    passos.push({
      chave: "pago",
      titulo: "Pagamento",
      quando: null,
      estado: "futuro",
    });
  }

  // Verba paga: a prestação de contas é o passo seguinte (decisão 081). Só
  // leitura aqui — ela se faz na aba de PPs (pergunta 5a).
  if (situacaoVerba) {
    const pr = pp.prestacao;
    passos.push({
      chave: "prestacao",
      titulo:
        situacaoVerba === "aguardando_prestacao"
          ? "Prestação de contas"
          : situacaoVerbaLabel(situacaoVerba),
      detalhe:
        situacaoVerba === "aguardando_prestacao"
          ? "preste contas na aba de PPs"
          : situacaoVerba === "prestacao_reprovada"
            ? `${pr?.motivo_reprovacao ?? "reprovada pelo financeiro"} — corrija na aba de PPs`
            : situacaoVerba === "prestacao_em_avaliacao"
              ? "com o financeiro"
              : situacaoVerba === "devolucao_pendente"
                ? `estorno de verba de ${formatCurrency(pr?.valor_devolvido ?? 0, "BRL")} aguardando a devolução`
                : "prestação aprovada",
      quando:
        situacaoVerba === "aguardando_prestacao" || !pr
          ? null
          : situacaoVerba === "prestacao_reprovada"
            ? formatDataHora(pr.reprovada_em ?? pr.enviada_em)
            : situacaoVerba === "prestacao_em_avaliacao"
              ? formatDataHora(pr.enviada_em)
              : formatDataHora(pr.aprovada_em ?? pr.enviada_em),
      estado: situacaoVerba === "concluida" ? "feito" : "agora",
    });
  }

  if (pp.cancelada_em) {
    passos.push({
      chave: "cancelada",
      titulo: "Cancelada",
      detalhe: "o PDF e os anexos ficam guardados no histórico",
      quando: formatDataHora(pp.cancelada_em),
      estado: "agora",
    });
  }

  return passos;
}

export function VerPPDrawer({
  open,
  onOpenChange,
  pp,
  contraparteNome,
  empresaNome,
  itemDescricao,
  valorPlanejado,
  emPPsEmitidas,
  tomadores,
  podeCancelar,
  onMensagem,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [confirmandoCancelar, setConfirmandoCancelar] = React.useState(false);
  /** A PP no formato da tela do financeiro: as notas do cadastro aqui, e
   *  a tela lado a lado no "Visualizar". O `ppId` impede que os dados de
   *  uma PP apareçam na ficha de outra. */
  const [dados, setDados] = React.useState<{
    ppId: string;
    pp: PPRow;
    estabelecimentos: EstabelecimentoDaNota[];
  } | null>(null);
  const [erroDosDados, setErroDosDados] = React.useState<string | null>(null);
  const [ladoALado, setLadoALado] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setErro(null);
      setConfirmandoCancelar(false);
      setLadoALado(false);
    }
  }, [open]);

  // Carrega ao abrir a ficha, e não no clique: as notas aparecem com o
  // que o financeiro registrou, e o "Visualizar" abre sem espera.
  const ppId = open ? (pp?.id ?? null) : null;
  React.useEffect(() => {
    if (!ppId) return;
    let vivo = true;
    setErroDosDados(null);
    carregarPPParaVisualizar(ppId).then((res) => {
      if (!vivo) return;
      if (res.ok) setDados({ ppId, pp: res.pp, estabelecimentos: res.estabelecimentos });
      else setErroDosDados(res.message);
    });
    return () => {
      vivo = false;
    };
  }, [ppId]);

  /** Todo documento passa por uma URL assinada de validade curta — o
   *  bucket é privado. */
  function abrir(
    promessa: Promise<{ ok: true; url: string } | { ok: false; message: string }>,
  ) {
    startTransition(async () => {
      const res = await promessa;
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  function cancelar() {
    if (!pp) return;
    const codigo = pp.codigo;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(pp.id);
      setConfirmandoCancelar(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onMensagem?.(`${codigo} cancelada.`);
      router.refresh();
      onOpenChange(false);
    });
  }

  if (!open || !pp) return null;

  const parcelas = pp.parcelas ?? [];
  const anexos = pp.anexos ?? [];
  const passos = passosDaPP(pp);
  const dadosDestaPP = dados?.ppId === pp.id ? dados : null;
  // As notas desta PP, uma por anexo do tipo NF: as do cadastro, quando a
  // consulta voltou; até lá, a cópia que o anexo guarda.
  const notas: NotaDaLinhaPP[] =
    (dadosDestaPP
      ? dadosDestaPP.pp.notas_fiscais?.notas
      : notasFiscaisDaLinhaPP({
          id: pp.id,
          verba_producao: pp.verba_producao,
          nf_registrada_em: null,
          anexos: anexos.map((a) => ({ ...a, nota: null })),
        })?.notas) ?? [];
  const notaDoAnexo = new Map(notas.map((n) => [n.anexo_id, n]));
  const cnpjDoTomador = (id: string | null): { nome: string; cnpj: string } | null => {
    if (!id) return null;
    const e = dadosDestaPP?.estabelecimentos.find((x) => x.id === id);
    if (e) return { nome: e.nome, cnpj: formatarCnpj(e.cnpj) };
    const t = tomadores.find((x) => x.id === id);
    return t ? { nome: t.nome, cnpj: t.cnpj } : null;
  };
  const cancelavel = podeCancelarPP(pp.status);
  const motivoSemCancelar =
    pp.status === "aprovada"
      ? "PP já aprovada pelo financeiro — é título a pagar. Para cancelar, fale com o financeiro."
      : pp.status === "pago"
        ? "PP já paga — cancelar exigiria estorno pelo financeiro."
        : "Esta PP não pode mais ser cancelada.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="flex flex-wrap items-center gap-2.5">
            Pedido de Produção · {pp.codigo}
            <PPStatusChip status={pp.status} />
          </DialogTitle>
          <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <Lock className="h-3 w-3 flex-none" />
            Somente leitura — a PP já foi enviada ao financeiro e não é mais
            editável.
          </p>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {erro && (
            <div className="flex items-start justify-between gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
              <span>{erro}</span>
              <button
                type="button"
                onClick={() => setErro(null)}
                aria-label="Fechar aviso"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {pp.motivo_rejeicao && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <div className="flex flex-col gap-1">
                <p className="text-[12.5px] leading-relaxed text-red-700">
                  <strong>{pp.codigo} rejeitada pelo financeiro</strong> ·{" "}
                  {pp.motivo_rejeicao}
                </p>
                <p className="text-[11.5px] leading-snug text-red-700/80">
                  A correção e o reenvio ficam na aba “Pedidos de Produção” do
                  job.
                </p>
              </div>
            </div>
          )}

          {pp.status === "cancelada" && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                <strong className="text-foreground">{pp.codigo} cancelada</strong>{" "}
                em {formatDataHora(pp.cancelada_em)}. O PDF e os anexos ficam
                guardados no histórico.
              </p>
            </div>
          )}

          {/* O cartão do item, como no formulário: o planejado é a
              referência da PP, e "Em PPs emitidas" é o que o item já tem
              em PPs — todas menos as canceladas, esta inclusive
              (decisão 074). */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">Item</p>
            <p className="font-medium">{itemDescricao || pp.item_nome || "—"}</p>
            {pp.grupo_nome && (
              <p className="text-[11px] text-muted-foreground">
                bloco {pp.grupo_nome}
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Planejado do item</p>
                <p className="font-mono font-semibold">
                  {formatCurrency(valorPlanejado, "BRL")}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Em PPs emitidas</p>
                <p className="font-mono font-semibold">
                  {formatCurrency(emPPsEmitidas, "BRL")}
                </p>
              </div>
            </div>
          </div>

          {/* Fornecedor & Empresa — a mesma ordem do formulário. */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Fornecedor &amp; Empresa
            </h3>

            <div className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "relative inline-flex h-5 w-9 flex-none items-center rounded-full border-2 border-transparent",
                  pp.verba_producao
                    ? "bg-california-red/60"
                    : "bg-muted-foreground/25",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-white shadow",
                    pp.verba_producao ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                Verba de Produção
              </span>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {pp.verba_producao ? "Pago ao responsável interno" : "Não"}
              </span>
            </div>

            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Valor desta PP
                </h4>
                <span className="text-[11px] text-muted-foreground">
                  mesmas colunas do item na planilha
                </span>
              </div>

              <div className="grid grid-cols-[1.5fr_0.75fr_0.75fr] gap-2.5">
                <CampoLido rotulo="R$ Unit." mono direita>
                  {formatUnitario(pp.valor_unitario)}
                </CampoLido>
                <CampoLido rotulo="QT" mono direita>
                  {formatFator(pp.quantidade)}
                </CampoLido>
                <CampoLido rotulo="D/M" mono direita>
                  {formatFator(pp.dias_meses)}
                </CampoLido>
              </div>

              <div className="flex items-end justify-between gap-4 border-t border-border pt-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    Valor desta PP
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {formatUnitario(pp.valor_unitario)} ×{" "}
                    {formatFator(pp.quantidade)} × {formatFator(pp.dias_meses)}
                  </p>
                </div>
                <span className="font-mono text-[22px] font-bold leading-none">
                  {formatCurrency(Number(pp.valor ?? 0), "BRL")}
                </span>
              </div>
            </div>

            <div>
              <CampoLido
                rotulo={pp.verba_producao ? "Responsável" : "Fornecedor"}
              >
                {contraparteNome || "—"}
                {pp.cadastro_do_fornecedor_mudou && (
                  <span
                    className="ml-1 font-bold text-amber-600"
                    aria-hidden="true"
                  >
                    *
                  </span>
                )}
              </CampoLido>
              {/* O asterisco da decisão 067, explicado por extenso. Esta é
                  a ficha que alguém abre justamente para conferir uma PP
                  que já saiu do job, e a pergunta que o asterisco levanta
                  ("então ela vai pagar errado?") precisa de resposta —
                  não: ela paga pelo documento dela. */}
              {pp.cadastro_do_fornecedor_mudou && (
                <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] leading-relaxed text-amber-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-700" />
                  <span>
                    Os dados de pagamento deste fornecedor mudaram depois que
                    esta PP foi montada. Ela continua valendo pelo que está no
                    documento dela — o cadastro novo vale para as próximas PPs.
                  </span>
                </p>
              )}
              {/* Decisão 127: o meio que esta PP troca, em três linhas. */}
              {pp.pagamento_fora_do_cadastro && (
                <PagamentoForaDoCadastroCartao
                  pagamento={pp.pagamento_fora_do_cadastro}
                  pedido={null}
                  className="mt-1.5"
                />
              )}
            </div>

            <CampoLido rotulo="Empresa emissora">{empresaNome || "—"}</CampoLido>

            <div className="grid grid-cols-2 gap-3">
              <CampoLido rotulo="Prazo de pagamento" mono>
                {formatData(pp.prazo_pagamento)}
              </CampoLido>
              <CampoLido rotulo="Parcelas" mono>
                {parcelas.length || 1}
              </CampoLido>
            </div>

            {parcelas.length > 1 && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
                <p className="text-[11px] text-muted-foreground">
                  Vencimentos combinados com o fornecedor na emissão. A data de
                  pagamento é a que o financeiro programa na aprovação.
                </p>
                {parcelas.map((parcela, i) => (
                  <div
                    key={parcela.id}
                    className="grid grid-cols-[28px_1fr_1fr_28px] items-center gap-2"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {i + 1}/{parcelas.length}
                    </span>
                    <div className="flex h-9 items-center rounded-lg border border-border bg-muted/40 px-3 font-mono text-[12.5px]">
                      {formatData(parcela.data_vencimento)}
                    </div>
                    <div className="flex h-9 items-center justify-end rounded-lg border border-border bg-muted/40 px-3 font-mono text-[12.5px]">
                      {formatCurrency(Number(parcela.valor ?? 0), "BRL")}
                    </div>
                    <button
                      type="button"
                      title={`Ver PDF da parcela ${i + 1}`}
                      aria-label={`Ver PDF da parcela ${i + 1}`}
                      onClick={() => abrir(signedUrlPdfParcela(parcela.id))}
                      disabled={pending}
                      className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      <Eye className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {parcelas.some((p) => p.data_pagamento) && (
                  <div className="flex flex-col gap-1 border-t border-border pt-2">
                    {parcelas.map((parcela, i) =>
                      parcela.data_pagamento ? (
                        <span
                          key={parcela.id}
                          className="text-[11px] text-muted-foreground"
                        >
                          Parcela {i + 1}: pagamento programado para{" "}
                          <span className="font-mono">
                            {formatData(parcela.data_pagamento)}
                          </span>
                        </span>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Serviço */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Serviço
            </h3>
            <CampoLido rotulo="Descrição do serviço" alturaLivre>
              {pp.servico}
            </CampoLido>
            <CampoLido rotulo="Especificações" alturaLivre>
              {pp.especificacoes?.trim() ? (
                <span className="whitespace-pre-wrap">{pp.especificacoes}</span>
              ) : (
                <span className="text-muted-foreground">
                  Sem especificações nesta PP.
                </span>
              )}
            </CampoLido>
          </div>

          {/* Anexos */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Anexos {anexos.length > 0 ? `· ${anexos.length}` : ""}
            </h3>
            {anexos.length === 0 ? (
              <p className="rounded border border-dashed border-border p-3 text-[12.5px] text-muted-foreground">
                {pp.verba_producao
                  ? "Verba de produção sai sem anexo — as notas entram na prestação de contas."
                  : "Sem anexos nesta PP."}
              </p>
            ) : (
              <ul className="space-y-2">
                {anexos.map((anexo) => (
                  <AnexoLido
                    key={anexo.id}
                    anexo={anexo}
                    nota={notaDoAnexo.get(anexo.id) ?? null}
                    pp={pp}
                    cnpjDoTomador={cnpjDoTomador}
                    onAbrir={() => abrir(signedUrlAnexo(anexo.id))}
                    disabled={pending}
                  />
                ))}
              </ul>
            )}
            {/* A soma das notas × o valor da PP, como no envio. */}
            {notas.some((n) => n.valor !== null) && (
              <ResumoDasNfs
                valores={notas.filter((n) => n.valor !== null).map((n) => parteDaNota(nfInicial(n, null)))}
                valorPP={Number(pp.valor ?? 0)}
              />
            )}
          </div>

          {/* No lugar da pergunta "Esta é a última PP deste item?", que só
              faz sentido na emissão: o que aconteceu com a PP até aqui.
              Desde 28/09/2026 (decisão 112) é a última seção do
              formulário e rola com ele — antes ficava presa acima do
              rodapé, sempre à vista, e encolhia a área do formulário. */}
          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <History className="h-3.5 w-3.5 text-california-red" />
              Linha do tempo
            </span>
            <ol className="flex flex-col">
              {passos.map((passo, i) => (
                <li
                  key={passo.chave}
                  className="relative grid grid-cols-[17px_1fr_auto] items-start gap-x-3"
                >
                  {i < passos.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-2 top-4 w-px bg-border"
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 mt-0.5 inline-flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 bg-card",
                      passo.estado === "feito" &&
                        "border-foreground bg-foreground text-white",
                      passo.estado === "agora" &&
                        "border-amber-600 bg-amber-50 text-amber-700",
                      passo.estado === "futuro" && "border-border",
                      passo.estado === "negado" &&
                        "border-california-red bg-california-red text-white",
                    )}
                  >
                    {passo.estado === "feito" && <Check className="h-2.5 w-2.5" />}
                    {passo.estado === "agora" && <Clock className="h-2.5 w-2.5" />}
                    {passo.estado === "negado" && <X className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                  <span className={cn("flex flex-col pb-3.5")}>
                    <span
                      className={cn(
                        "text-[12.5px] font-semibold",
                        passo.estado === "futuro" &&
                          "font-medium text-muted-foreground",
                      )}
                    >
                      {passo.titulo}
                    </span>
                    {passo.detalhe && (
                      <span className="text-[11.5px] leading-snug text-muted-foreground">
                        {passo.detalhe}
                      </span>
                    )}
                    {passo.motivo && (
                      <span className="text-[11.5px] leading-snug text-muted-foreground">
                        “{passo.motivo}”
                      </span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-[11px] text-muted-foreground",
                      passo.estado === "agora" && "font-semibold text-amber-700",
                    )}
                  >
                    {passo.quando ?? "—"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* "Fechar" à esquerda; à direita, "Visualizar" e "Cancelar PP"
            (Tiago, 08/10/2026). */}
        <div className="flex items-center gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="mr-auto rounded-lg bg-california-red px-4 py-2 text-[13px] font-semibold text-white hover:bg-california-red-hover"
          >
            Fechar
          </button>
          {/* A tela lado a lado do Contas a Pagar, em leitura: o PDF da PP,
              o documento anexado e os dados. Espera a PP carregar. */}
          <button
            type="button"
            onClick={() => {
              if (dadosDestaPP) setLadoALado(true);
              else if (erroDosDados) setErro(erroDosDados);
            }}
            disabled={pending || (!dadosDestaPP && !erroDosDados)}
            title={dadosDestaPP || erroDosDados ? "Ver a PP e os documentos lado a lado" : "Carregando a PP…"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-semibold hover:bg-muted disabled:opacity-50"
          >
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            Visualizar
          </button>
          {/* A mesma regra do painel: em avaliação e rejeitada ainda voltam
              atrás; aprovada é título a pagar e paga precisaria de estorno.
              Nesses dois o botão fica apagado com o motivo. */}
          {podeCancelar && (
            <button
              type="button"
              onClick={() => setConfirmandoCancelar(true)}
              disabled={pending || !cancelavel}
              title={cancelavel ? "Cancelar PP" : motivoSemCancelar}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-[13px] font-semibold transition-colors disabled:opacity-50",
                cancelavel
                  ? "border-california-red/35 bg-white text-california-red hover:bg-california-red/[0.06]"
                  : "cursor-not-allowed border-border bg-white text-muted-foreground",
              )}
            >
              <Ban className="h-3.5 w-3.5" />
              Cancelar PP
            </button>
          )}
        </div>

        <ConfirmDialog
          open={confirmandoCancelar}
          onOpenChange={setConfirmandoCancelar}
          title="Cancelar Pedido de Produção?"
          description={
            <>
              <strong className="text-foreground">{pp.codigo}</strong> será
              cancelada. O PDF e os anexos ficam guardados no histórico. Ela já
              está no financeiro: cancelar a tira da fila de avaliação e ela
              deixa de contar no realizado do item.
            </>
          }
          confirmLabel="Cancelar PP"
          cancelLabel="Voltar"
          variant="destructive"
          pending={pending}
          onConfirm={cancelar}
        />

        {/* Fechar a tela volta para esta ficha. */}
        {dadosDestaPP && (
          <PPTela
            somenteLeitura
            pp={dadosDestaPP.pp}
            estabelecimentos={dadosDestaPP.estabelecimentos}
            open={ladoALado}
            onOpenChange={setLadoALado}
          />
        )}
      </DrawerContent>
    </Dialog>
  );
}

/**
 * Um anexo da PP como o envio ao financeiro o mostrou — o mesmo cartão,
 * travado (08/10/2026): o tipo do arquivo e, na NF, os dados da nota logo
 * abaixo dele (decisão 152); nos outros tipos, o número do documento. O
 * olho abre o arquivo numa aba nova, como antes.
 */
function AnexoLido({
  anexo,
  nota,
  pp,
  cnpjDoTomador,
  onAbrir,
  disabled,
}: {
  anexo: AnexoDaPPNaLista;
  /** A nota deste anexo, quando ele é do tipo NF. */
  nota: NotaDaLinhaPP | null;
  pp: PedidoCompraNaLista;
  cnpjDoTomador: (id: string | null) => { nome: string; cnpj: string } | null;
  onAbrir: () => void;
  disabled: boolean;
}) {
  const Icone = anexo.arquivo_mimetype?.startsWith("image/") ? ImageIcon : FileText;
  const rotulo = "text-[11px] font-medium text-muted-foreground";
  const nf = nota ? nfInicial(nota, null) : null;
  const tomador = cnpjDoTomador(nota?.tomador ?? null);
  // Decisão 156: a nota em outro CNPJ que não o da PP — a produção
  // confirmou no envio, e o financeiro decide na aprovação.
  const emOutroCnpj =
    !!nota?.tomador && !!pp.estabelecimento_id && nota.tomador !== pp.estabelecimento_id;
  const registradaNaOutra =
    nota?.registrada?.na_pp && nota.registrada.na_pp !== pp.codigo ? nota.registrada.na_pp : null;

  return (
    <li className="overflow-hidden rounded-xl border border-border bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-muted/60">
          <Icone className="h-4 w-4 text-california-red" />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[13px] font-medium text-foreground"
            title={anexo.arquivo_nome_original}
          >
            {anexo.arquivo_nome_original}
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {formatarTamanho(anexo.arquivo_tamanho_bytes)}
          </p>
        </div>
        {anexo.documento_tipo && (
          <span
            title="Tipo do documento"
            className="flex h-8 w-[136px] flex-none items-center rounded-lg border border-border bg-muted/40 px-2 text-xs text-foreground"
          >
            {documentoTipoLabel(anexo.documento_tipo)}
          </span>
        )}
        <button
          type="button"
          title="Abrir anexo"
          aria-label={`Abrir ${anexo.arquivo_nome_original}`}
          onClick={onAbrir}
          disabled={disabled}
          className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Eye className="h-3 w-3" />
        </button>
      </div>

      {anexo.documento_tipo === "nota_fiscal" && nota && nf && (
        <div className="space-y-1.5 border-t border-border px-3 pb-3 pt-2.5">
          <div className="grid grid-cols-[100px_148px_132px_minmax(0,1fr)] gap-x-2 gap-y-2">
            <DadoDaNf rotulo="Número da NF" mono>
              {nf.numero || "—"}
            </DadoDaNf>
            <DadoDaNf rotulo="Data de emissão">{formatData(nota.emissao)}</DadoDaNf>
            <DadoDaNf rotulo="Valor da NF" mono>
              {nota.valor !== null ? formatCurrency(nota.valor, "BRL") : "—"}
            </DadoDaNf>
            <DadoDaNf rotulo="CNPJ tomador" mono title={tomador?.nome}>
              {tomador?.cnpj ?? "—"}
            </DadoDaNf>
          </div>

          {nf.cobre_outra && (
            <div className="flex flex-wrap items-center gap-2">
              <span className={rotulo}>Valor nesta PP</span>
              <span className="flex h-8 w-[132px] items-center rounded-lg border border-border bg-muted/40 px-2 font-mono text-xs font-semibold">
                {formatCurrency(nf.valor_na_pp, "BRL")}
              </span>
              {nota.valor !== null && (
                <span className="text-[11px] text-muted-foreground">
                  de {formatCurrency(nota.valor, "BRL")} da nota
                </span>
              )}
            </div>
          )}

          {nota.outras_pps.length > 0 && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Também na{" "}
              {nota.outras_pps.map((o, i) => (
                <React.Fragment key={o.codigo}>
                  {i > 0 && ", "}
                  <span className="font-mono">{o.codigo}</span> ({formatCurrency(o.valor_na_pp, "BRL")})
                </React.Fragment>
              ))}
              .
            </p>
          )}

          {nota.registrada ? (
            <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              <Lock className="mt-0.5 h-3 w-3 flex-none" />
              <span>
                {/* Horário com fuso: o dia é o local, não o de UTC. */}
                Registrada pelo financeiro em{" "}
                {new Date(nota.registrada.em).toLocaleDateString("pt-BR")}
                {registradaNaOutra ? (
                  <>
                    , na aprovação da <span className="font-mono">{registradaNaOutra}</span>
                  </>
                ) : null}
                .
              </span>
            </p>
          ) : (
            pp.status === "em_avaliacao" && (
              <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
                <Lock className="mt-0.5 h-3 w-3 flex-none" />
                <span>Informada no envio. O financeiro confere na aprovação.</span>
              </p>
            )
          )}

          {emOutroCnpj && (
            <p className="flex items-start gap-1.5 text-[11.5px] font-semibold leading-snug text-california-red">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>
                A nota está no CNPJ {tomador?.nome ?? "—"}; a PP é do CNPJ{" "}
                {cnpjDoTomador(pp.estabelecimento_id)?.nome ?? "—"}.
              </span>
            </p>
          )}
        </div>
      )}

      {anexo.documento_tipo && anexo.documento_tipo !== "nota_fiscal" && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <span className={rotulo}>Número do documento</span>
          <span className="flex h-8 w-44 items-center rounded-lg border border-border bg-muted/40 px-2 font-mono text-xs">
            {anexo.documento_numero?.trim() || "—"}
          </span>
        </div>
      )}
    </li>
  );
}

/** Um dado da NF, na caixa travada do tamanho do campo do envio. */
function DadoDaNf({
  rotulo,
  children,
  mono,
  title,
}: {
  rotulo: string;
  children: React.ReactNode;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-0">
      <span className="text-[11px] font-medium text-muted-foreground">{rotulo}</span>
      <div
        title={title}
        className={cn(
          "flex h-8 items-center truncate rounded-lg border border-border bg-muted/40 px-2 text-xs text-foreground",
          mono && "font-mono",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Um campo do formulário, travado.
 *
 * Mesma altura, borda e raio do `Input`, com o fundo do desabilitado: a
 * tela precisa ser reconhecível como O formulário da PP, não como uma
 * ficha nova. `alturaLivre` é para os campos que no formulário são
 * textarea ou texto longo.
 */
function CampoLido({
  rotulo,
  children,
  mono,
  direita,
  alturaLivre,
}: {
  rotulo: string;
  children: React.ReactNode;
  mono?: boolean;
  direita?: boolean;
  alturaLivre?: boolean;
}) {
  return (
    <div>
      <span className="text-xs font-medium">{rotulo}</span>
      <div
        className={cn(
          "mt-1 w-full rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm leading-snug text-foreground",
          !alturaLivre && "flex min-h-11 items-center",
          mono && "font-mono font-semibold",
          direita && "justify-end text-right",
        )}
      >
        {children}
      </div>
    </div>
  );
}
