"use client";

import * as React from "react";
import { Search, Sheet } from "lucide-react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MultiSelectRegionais } from "@/components/ui/multi-select-regionais";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  PPStatus,
  FormaPagamento,
  PrestacaoDaVerba,
  DevolucaoDaVerba,
  PlanoContaTipo,
  PlanoContaSubtipo,
  PagamentoForaDoCadastroDaPP,
  PPEvento,
} from "@/lib/types";
import type { CartaoOption } from "@/components/financeiro/forma-pagamento-field";
import { ppStatusLabel, nomeContraparteBRPP, situacaoDaVerba, situacaoVerbaLabel } from "@/lib/types";
import type { DocumentoTipo, TipoVerba, TitularDaVerbaTipo } from "@/lib/types";
import type { DeslocamentosDoReembolso, ReembolsoTipo } from "@/lib/calculos/reembolso";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";
import type { SituacaoFaturamento } from "@/lib/calculos/esteira-faturamento";
import { SITUACAO_META } from "@/app/(app)/financeiro/abertura-de-job/situacao-faturamento";
import type { FiscalDaAprovacaoPP } from "@/lib/fiscal/aprovacao-da-pp";
import type { NotasFiscaisDaLinhaPP, RegimeDoFornecedorDaPP } from "@/lib/fiscal/nf-da-pp";
import { PPTela } from "./pp-tela";
import {
  ultimoEnvioDaPP,
  ultimoEnvioDaPrestacao,
  type EnvioDaPP,
} from "@/lib/data/eventos-da-pp";
import { formatDataHoraListaBr } from "@/lib/formatar-data-hora";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { usePublicarContagemPorEmpresa } from "@/components/ui/contagem-nos-seletores";

/** Decisão 257: a Planilha Interna do job em leitura, com a linha da PP em
 *  destaque — o mesmo pop-up da abertura. Carregado só quando abre: a
 *  planilha é pesada e esta lista não precisa dela para montar. */
const PopUpDaPlanilha = dynamic(
  () => import("@/app/(app)/financeiro/abertura-de-job/[jobId]/planilha-em-leitura").then((m) => m.PopUpDaPlanilha),
  { ssr: false },
);

export interface PPRow {
  id: string;
  codigo: string;
  status: PPStatus;
  valor: number;
  prazo_pagamento: string;
  prazo_pagamento_financeiro: string | null;
  created_at: string;
  cancelada_em: string | null;
  motivo_cancelamento: string | null;
  rejeitada_em: string | null;
  motivo_rejeicao: string | null;
  rejeitada_por_nome: string | null;
  pago_em: string | null;
  pago_por_nome: string | null;
  /**
   * Linha do tempo da PP — a seção "Histórico" do dossiê (11/09/2026).
   *
   * ⚠️ Campos OBRIGATÓRIOS de propósito, e não opcionais. `PPRow` é um
   * tipo escrito à mão, montado por `.map` no servidor: campo opcional
   * aqui desliga a checagem que garante que ele chegou à tela, e o dado
   * some em silêncio com `tsc`, `lint` e `build` limpos. Quem não tiver o
   * valor manda `null` explícito.
   */
  enviada_financeiro_em: string | null;
  enviada_financeiro_por_nome: string | null;
  aprovada_em: string | null;
  aprovada_por_nome: string | null;
  /**
   * Pagamento urgente (decisão 077). Obrigatório, como o histórico acima:
   * opcional aqui, a marca sumiria da lista em silêncio com `tsc` limpo.
   * PP sem urgência manda `false` e `null` explícitos.
   */
  urgente: boolean;
  urgente_justificativa: string | null;
  urgente_em: string | null;
  urgente_por_nome: string | null;
  /**
   * Documentos anexados no instante da aprovação. Três estados
   * diferentes, e a tela distingue os três: `null` = aprovada antes do
   * registro existir; `[]` = aprovada SEM documento; lista = o que foi
   * conferido.
   */
  anexos_na_aprovacao: Array<{
    id: string;
    nome: string;
    tamanho_bytes: number;
  }> | null;
  fornecedor_id: string;
  /**
   * Decisão 067: o cadastro do fornecedor mudou depois que esta PP tirou a
   * foto dos dados de pagamento. Calculado no servidor — a tela recebe só
   * o booleano, nunca o dado bancário.
   */
  cadastro_do_fornecedor_mudou: boolean;
  /**
   * Decisão 127: a PP paga fora do cadastro do fornecedor — o meio
   * trocado, o motivo e só os dados desse meio. Null = paga pelo cadastro.
   * Obrigatório pelo mesmo motivo do histórico acima.
   */
  pagamento_fora_do_cadastro: PagamentoForaDoCadastroDaPP | null;
  fornecedor_nome: string;
  empresa_id: string;
  empresa_nome: string;
  /** O CNPJ da PP (decisão 156): o tomador esperado da NF e o CNPJ da conta
   *  que paga. Obrigatório pelo mesmo motivo do histórico acima. */
  estabelecimento_id: string | null;
  job_id: string;
  job_codigo: string;
  job_nome: string;
  /** GP responsável do job — referência nos pop-ups de aprovação
   *  (decisão 136). Obrigatório pelo mesmo motivo do histórico. */
  job_responsavel_nome: string | null;
  /** Decisão 257: o dia em que o financeiro abriu o job (coluna Abertura do
   *  job). Obrigatório pelo mesmo motivo do histórico. */
  job_aberto_em: string | null;
  /** Decisão 257: onde o job está na esteira do faturamento — a mesma
   *  leitura de Visualizar Jobs (`faturamentoPorJob`). Só a página de Contas
   *  a Pagar lê; quem monta a linha sem ela manda null. */
  job_faturamento: SituacaoFaturamento | null;
  /** Decisão 257: a linha da planilha (`jobs_itens_orcado.id`) de onde veio
   *  a PP — a que o pop-up da Planilha Interna destaca. */
  item_orcado_id: string | null;
  regional_id: string | null;
  projeto_codigo: string | null;
  projeto_nome: string | null;
  cliente_nome: string | null;
  servico: string;
  quantidade: number;
  especificacoes: string | null;
  pdf_path: string;
  cancelada_por_nome: string | null;
  emitida_por_nome: string | null;
  /**
   * Por onde a PP vai ser paga, escolhida na APROVAÇÃO pelo financeiro
   * (29/08/2026). Antes disso era sempre null — a forma só existia na
   * baixa. Continua null quando o financeiro não escolhe nada e deixa
   * para decidir parcela a parcela.
   */
  forma_pagamento: FormaPagamento | null;
  cartao_credito_id: string | null;
  /**
   * Plano de contas da PP. Só é preenchido quando ela vai para o cartão:
   * lá não existe baixa individual onde escolhê-lo, e o fechamento da
   * fatura precisa dele para classificar o lançamento.
   */
  plano_conta_tipo_id: string | null;
  plano_conta_subtipo_id: string | null;
  /** Decisão 209: a PP do cartão corporativo — sem fornecedor
   *  (`fornecedor_id` vazio), com a plataforma e o link da compra. O
   *  `fornecedor_nome` já vem "Cartão corporativo — plataforma".
   *  Obrigatórios pelo mesmo motivo do histórico acima. */
  cartao_corporativo: boolean;
  cartao_plataforma: string | null;
  cartao_link: string | null;
  /** Verdadeiro quando a PP é de verba (produção, alimentação ou transporte). */
  /** Decisão 216: foi sem NF na auditoria da Mídia System — a NF chega
   *  depois, na prestação de contas. */
  sem_nf_na_auditoria: boolean;
  verba_producao: boolean;
  /** Decisão 164: o tipo da verba; null fora da verba. Obrigatório, como os
   *  campos abaixo: opcional, o `.map` o descartaria em silêncio. */
  tipo_verba: TipoVerba | null;
  /** De onde vem o titular (alimentação e transporte). */
  verba_titular_tipo: TitularDaVerbaTipo | null;
  /** Decisão 187: na PP de reembolso, despesas ou veículo próprio; null
   *  fora dela. Obrigatório pelo mesmo motivo do `tipo_verba`. */
  reembolso_tipo: ReembolsoTipo | null;
  /** Decisão 187: a conta do veículo próprio, como a PP guardou. */
  reembolso_deslocamentos: DeslocamentosDoReembolso | null;
  /** Quem recebe a verba: o responsável (produção) ou o titular
   *  (alimentação e transporte). Null fora da verba. */
  responsavel_nome: string | null;
  /**
   * Prestação de contas da verba (decisão 081): enviada pela produção,
   * conferida aqui. Null fora da verba ou enquanto a produção não enviou.
   * Obrigatória no tipo — opcional, o `.map` da página a descartaria.
   */
  prestacao: PrestacaoDaVerba | null;
  /** Estorno de verba criado na aprovação, quando sobrou saldo. */
  devolucao: DevolucaoDaVerba | null;
  /**
   * Histórico de eventos da PP e da prestação, em ordem (decisão 136).
   * As colunas acima guardam só o último evento de cada tipo — o reenvio
   * apaga a rejeição. Obrigatório pelo mesmo motivo do histórico.
   */
  eventos: PPEvento[];
  anexos: Array<{
    id: string;
    arquivo_nome_original: string;
    arquivo_tamanho_bytes: number;
    /** O tipo, o número, a data e o valor que a produção informou — o
     *  dossiê do reembolso mostra o comprovante assim (decisão 187). */
    documento_tipo: DocumentoTipo | null;
    documento_numero: string | null;
    nf_data_emissao: string | null;
    nf_valor: number | null;
  }>;
  /**
   * Parcelas da PP, sempre ao menos uma (1/1). Aqui são leitura — o
   * financeiro precisa ver em quantas vezes vai pagar ANTES de aprovar.
   * A baixa de cada uma acontece na aba "Títulos a Pagar" (Tela 3.2).
   */
  parcelas: Array<{
    id: string;
    numero: number;
    /** Prazo negociado pela produção. Não muda depois da emissão. */
    data_vencimento: string;
    /** Definida na aprovação; nula enquanto a PP está em avaliação. */
    data_pagamento: string | null;
    data_pagamento_primeira: string | null;
    valor: number;
    pago_em: string | null;
    /**
     * A fatura em que esta parcela caiu, quando a PP é paga no cartão.
     * Uma parcela, uma fatura — pela data da parcela. É o que faz a
     * parcela aparecer na aba Cartão em vez de Títulos a Pagar.
     */
    fatura_cartao_id: string | null;
  }>;
  /**
   * Módulo fiscal (02/10/2026): o regime tributário do fornecedor, como o
   * cadastro guarda hoje — a coluna "Dados da PP" mostra e a retenção da
   * aprovação parte dele. Obrigatório pelo mesmo motivo do histórico: null
   * explícito na verba e no fornecedor sem regime informado.
   */
  regime_do_fornecedor: RegimeDoFornecedorDaPP | null;
  /**
   * Módulo fiscal: as NFs do fornecedor — uma por anexo do tipo NF, com a
   * nota do cadastro quando já ligada (decisão 152). Null na PP sem anexo
   * de NF e na verba de produção: o grupo "Notas fiscais do fornecedor" não
   * aparece e a aprovação segue sem as seções de retenção e crédito.
   */
  notas_fiscais: NotasFiscaisDaLinhaPP | null;
}

function statusBadgeClasses(status: PPStatus): string {
  switch (status) {
    // Gerada nunca chega a esta tela (o financeiro só lê a partir de
    // em_avaliacao); o caso existe para o mapa continuar exaustivo.
    case "gerada":
      return "bg-[#f6f6f6] text-foreground border-[#d7d7d7]";
    case "em_avaliacao":
      return "bg-[#fffbeb] text-[#92400e] border-[#fde68a]";
    case "aprovada":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "pago":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "rejeitada":
      return "bg-red-50 text-red-700 border-red-200";
    case "cancelada":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** A grade da lista (decisão 257, revista em 16/11/2026). Larguras fixas,
 *  medidas com o texto real mais longo na largura de conteúdo do Tiago
 *  (1.616 px). Fornecedor e Job ficam sem largura e dividem o que sobra; o
 *  texto deles quebra em até duas linhas, e o resto abre no cartão. Com a
 *  largura automática, a tabela foi a 1.887 px numa caixa de 1.615 px e
 *  Faturamento, Status e o ícone saíam da tela. A ordem segue a do
 *  cabeçalho: no filtro de prestações, Comprovado e Saldo entram no lugar
 *  de Parcela e Prazo original, logo depois do Valor. */
function ColunasDasPPs({ prestacoes }: { prestacoes: boolean }) {
  return (
    <colgroup>
      {/* Código, com Verba/Reembolso embaixo. A urgência não tem selo na
          linha: ela mora na seção "Urgentes" (16/11/2026). */}
      <col className="w-[112px]" />
      {/* Valor: cabe R$ 1.387.138,56, a maior PP */}
      <col className="w-[144px]" />
      {prestacoes ? (
        <>
          {/* Comprovado e Saldo */}
          <col className="w-[132px]" />
          <col className="w-[124px]" />
        </>
      ) : (
        // Parcela
        <col className="w-[92px]" />
      )}
      {/* Fornecedor: divide o que sobra com o Job */}
      <col />
      {/* Prazo original */}
      {!prestacoes && <col className="w-[108px]" />}
      {/* Enviada por */}
      <col className="w-[160px]" />
      {/* Job */}
      <col />
      {/* Abertura do job */}
      <col className="w-[108px]" />
      {/* Faturamento */}
      <col className="w-[168px]" />
      {/* Status */}
      <col className="w-[152px]" />
      {/* Ícone da Planilha Interna */}
      <col className="w-[44px]" />
    </colgroup>
  );
}

/** Nome, selo de reenvio e, embaixo, data e hora do último envio. O nome
 *  fica numa linha só: o que não cabe abre no cartão. */
function QuemEnviou({ envio }: { envio: EnvioDaPP | null }) {
  if (!envio) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-foreground">
        <TruncateTooltip as="span" text={envio.por_nome ?? "—"} className="min-w-0" />
        {envio.reenviada && (
          <span className="shrink-0 rounded-md border border-california-red/30 bg-california-red/5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-california-red">
            Reenviada
          </span>
        )}
      </div>
      <div className="mt-0.5 whitespace-nowrap text-[12px] text-muted-foreground">
        {formatDataHoraListaBr(envio.em)}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Decisão 257: o faturamento do job e a linha da prestação
// ---------------------------------------------------------------------------

/** A ordem da esteira do faturamento, para o funil da coluna. */
const ORDEM_DO_FATURAMENTO: SituacaoFaturamento[] = [
  "aguardando_envio",
  "enviado",
  "faturado",
  "inadimplente",
  "liquidado",
  "sem_faturamento",
];

/** O selo da esteira do faturamento — o mesmo de Visualizar Jobs. */
function SeloDoFaturamento({ s }: { s: SituacaoFaturamento | null }) {
  if (!s) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        SITUACAO_META[s].classes,
      )}
    >
      {SITUACAO_META[s].rotulo}
    </span>
  );
}

/** O selo "Prestação" embaixo do código, no lugar do "Verba". */
function SeloPrestacao() {
  return (
    <span className="rounded-md bg-sky-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-sky-800">Prestação</span>
  );
}

/** A urgência só vale enquanto a PP espera o financeiro: em avaliação (a
 *  aprovar) ou aprovada (a pagar). Essas sobem para a seção "Urgentes" no
 *  topo da lista (decisão 257, revista em 16/11/2026; antes só as em
 *  avaliação subiam, e as aprovadas levavam o selo na linha). */
function urgenteVisivel(r: PPRow): boolean {
  return r.urgente && (r.status === "em_avaliacao" || r.status === "aprovada");
}

/** A linha da prestação existe quando a produção ENVIA a prestação ao
 *  financeiro — o envio exige a verba paga, e o rascunho é da produção. É
 *  sempre UMA linha: o banco tem uma prestação por PP
 *  (`uniq_prestacao_por_pp`) e uma devolução por prestação; reprovada e
 *  reenviada, a mesma linha volta para "Prestação", e o histórico fica na
 *  tela da PP. */
function temLinhaDaPrestacao(r: PPRow): boolean {
  return situacaoDaVerba(r) !== null && !!r.prestacao && r.prestacao.status !== "rascunho";
}

/** O andamento da prestação, com a data do momento embaixo. A sobra já
 *  devolvida ganha selo próprio, "Devolvido" — antes ela se confundia com a
 *  "Concluída" sem sobra. */
function StatusDaPrestacao({ r }: { r: PPRow }) {
  const s = situacaoDaVerba(r);
  if (!s) return null;
  const pr = r.prestacao;
  const devolvida = s === "concluida" && Number(pr?.valor_devolvido ?? 0) > 0 && !!r.devolucao?.pago_em;
  const data = (texto: string, iso: string | null | undefined) =>
    iso ? <span className="whitespace-nowrap text-xs text-muted-foreground">{texto} {formatDate(iso)}</span> : null;
  return (
    <div className="flex flex-col items-start gap-1">
      {devolvida ? (
        <Badge className="whitespace-nowrap border border-emerald-200 bg-emerald-50 text-emerald-700">Devolvido</Badge>
      ) : (
        <SituacaoVerbaChip situacao={s} />
      )}
      {s === "prestacao_reprovada" && data("Reprovada", pr?.reprovada_em)}
      {s === "devolucao_pendente" && data("Previsto", r.devolucao?.data_pagamento)}
      {devolvida && data("Devolvido", r.devolucao?.pago_em)}
      {s === "concluida" && !devolvida && data("Aprovada", pr?.aprovada_em)}
    </div>
  );
}

/** A linha da prestação, logo embaixo da linha da PP (que fica "Pago").
 *  Valor = o comprovado, com a sobra embaixo; Enviada por = quem enviou a
 *  prestação; Status = o andamento. As colunas que repetiriam a linha de
 *  cima ficam vazias. Clicar abre a mesma tela da PP, que mostra os
 *  comprovantes. */
function LinhaDaPrestacao({ r, onAbrir }: { r: PPRow; onAbrir: () => void }) {
  const pr = r.prestacao;
  const sobra = Number(pr?.valor_devolvido ?? 0);
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onAbrir();
        }
      }}
      className="cursor-pointer border-b border-border bg-muted/25 transition-colors last:border-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
    >
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs font-bold text-california-red/70">
        <span>{r.codigo}</span>
        <span className="mt-1 flex">
          <SeloPrestacao />
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums" title="Comprovado na prestação">
        {pr ? (
          <>
            <span className="font-semibold">{formatMoney(Number(pr.valor_gasto))}</span>
            {sobra > 0 && (
              <span className="block whitespace-nowrap text-xs text-muted-foreground">sobra {formatMoney(sobra)}</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5" />
      <td className="px-4 py-2.5" />
      <td className="px-4 py-2.5" />
      <td className="px-4 py-2.5">
        <QuemEnviou envio={ultimoEnvioDaPrestacao(r.eventos)} />
      </td>
      <td className="px-4 py-2.5" />
      <td className="px-4 py-2.5" />
      <td className="px-4 py-2.5" />
      <td className="px-4 py-2.5">
        <StatusDaPrestacao r={r} />
      </td>
      <td className="px-2 py-2.5" />
    </tr>
  );
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "prestacoes": prestação de contas de verba esperando conferência
 *  (decisão 081). A PP dela está "pago"; o que se aprova é a prestação. */
type FiltroStatus = PPStatus | "todas" | "prestacoes";

const STATUS_FILTROS: Array<{ key: FiltroStatus; label: string }> = [
  { key: "em_avaliacao", label: "Em avaliação" },
  // "Prestação de Contas" desde 19/10/2026 (comentário do Tiago no
  // protótipo da decisão 189); antes, "Prestações".
  { key: "prestacoes", label: "Prestação de Contas" },
  { key: "aprovada", label: "Aprovadas" },
  { key: "pago", label: "Pagas" },
  { key: "rejeitada", label: "Rejeitadas" },
  { key: "cancelada", label: "Canceladas" },
  { key: "todas", label: "Todas" },
];

// ---------------------------------------------------------------------------
// Filtro e ordem pelo título da coluna, como no Excel (pedido do Tiago,
// 09/10/2026, decisão 165 — o mesmo filtro da aba PPs do job)
// ---------------------------------------------------------------------------

/** O texto do status, como o selo da linha (a verba paga mostra a situação). */
function rotuloDoStatus(r: PPRow): string {
  const verba = situacaoDaVerba(r);
  return verba ? situacaoVerbaLabel(verba) : ppStatusLabel(r.status);
}

/** A lista do funil de Status na ordem da esteira da PP, não de A a Z. */
const ORDEM_DO_STATUS = [
  "Em avaliação",
  "Aprovada",
  "Pago",
  "Aguardando prestação",
  "Prestação em avaliação",
  "Prestação reprovada",
  "Devolução pendente",
  "Concluída",
  "Rejeitado",
  "Cancelada",
];

/**
 * As colunas. No chip "Prestação de Contas" três títulos mudam de sentido —
 * Emissão vira "Enviada em", Prazo original vira "Comprovado" e Parcela vira
 * "Saldo"; Valor fica igual. Os títulos são neutros porque a lista junta a
 * verba e a PP da Mídia System (decisão 216), que não tem verba nem saldo a
 * devolver: nela o Saldo é sempre R$ 0,00. As três que
 * mudam de sentido têm chave própria em cada modo: o filtro feito em
 * "Emissão" não vale sobre a data de envio da prestação, e volta quando
 * o chip sai de Prestação de Contas. Código, Fornecedor, Job, Enviada por, Valor e
 * Status seguem filtrando nos dois modos.
 */
function colunasDoModo(prestacoes: boolean): ColunaFiltravel<PPRow>[] {
  const envio = (r: PPRow) =>
    prestacoes ? ultimoEnvioDaPrestacao(r.eventos) : ultimoEnvioDaPP(r.eventos);
  return [
    {
      chave: "codigo",
      rotulo: "Código",
      tipo: "texto",
      // A busca da coluna acha também pelo selo da célula e pela urgência
      // (que mora na seção "Urgentes", sem selo na linha).
      celula: (r) => ({
        ...celulaTexto(r.codigo),
        busca: [
          r.codigo,
          urgenteVisivel(r) ? "Urgente" : "",
          r.verba_producao ? (r.tipo_verba === "reembolso" ? "Reembolso" : "Verba") : "",
        ].join(" "),
      }),
    },
    {
      chave: "fornecedor",
      rotulo: "Fornecedor",
      tipo: "texto",
      celula: (r) =>
        celulaTexto(
          // A mesma conta da célula (decisão 164: o tipo da verba e o titular).
          nomeContraparteBRPP({
            verba_producao: r.verba_producao,
            tipo_verba: r.tipo_verba,
            verba_titular_nome: r.responsavel_nome,
            fornecedor: r.fornecedor_nome ? { nome: r.fornecedor_nome } : null,
            responsavel: r.responsavel_nome ? { nome: r.responsavel_nome } : null,
          }),
        ),
    },
    {
      chave: "job",
      rotulo: "Job",
      tipo: "texto",
      celula: (r) => ({ ...celulaTexto(`${r.job_codigo} ${r.job_nome}`.trim()), ordem: r.job_codigo }),
    },
    // Decisão 257: a abertura e o faturamento do job, cada um na sua coluna.
    {
      chave: "job_aberto_em",
      rotulo: "Abertura do job",
      tipo: "data",
      celula: (r) => celulaData(r.job_aberto_em),
    },
    {
      chave: "job_faturamento",
      rotulo: "Faturamento",
      tipo: "texto",
      celula: (r) => ({
        ...celulaTexto(r.job_faturamento ? SITUACAO_META[r.job_faturamento].rotulo : null),
        ordemNaLista: r.job_faturamento ? ORDEM_DO_FATURAMENTO.indexOf(r.job_faturamento) : -1,
      }),
    },
    // Decisão 257: a Emissão saiu da lista (e o "Enviada em" da prestação,
    // cuja data já está em Enviada por).
    {
      // Filtra por quem enviou; ordena por quando (o último envio).
      chave: "enviada_por",
      rotulo: "Enviada por",
      tipo: "data",
      celula: (r) => {
        const e = envio(r);
        return { ...celulaTexto(e?.por_nome ?? null), ordem: e?.em ?? "" };
      },
    },
    {
      chave: "valor",
      rotulo: "Valor",
      tipo: "valor",
      faixa: true,
      alinhar: "right",
      celula: (r) => celulaValor(r.valor, formatMoney),
    },
    prestacoes
      ? {
          chave: "gasto",
          rotulo: "Comprovado",
          tipo: "valor",
          faixa: true,
          celula: (r) => celulaValor(r.prestacao?.valor_gasto ?? 0, formatMoney),
        }
      : { chave: "prazo", rotulo: "Prazo original", tipo: "data", celula: (r) => celulaData(r.prazo_pagamento) },
    prestacoes
      ? {
          chave: "saldo",
          rotulo: "Saldo",
          tipo: "valor",
          faixa: true,
          celula: (r) => celulaValor(r.prestacao?.valor_devolvido ?? 0, formatMoney),
        }
      : {
          // O que a célula mostra: "1/N".
          chave: "parcela",
          rotulo: "Parcela",
          // Lista dos valores ("1/3"), ordem de número: do menor para o maior.
          tipo: "valor",
          celula: (r) => {
            const n = Math.max(r.parcelas.length, 1);
            return { valor: `1/${n}`, rotulo: `1/${n}`, ordem: n };
          },
        },
    {
      chave: "status",
      rotulo: "Status",
      tipo: "texto",
      celula: (r) => ({
        ...celulaTexto(rotuloDoStatus(r)),
        ordemNaLista: ORDEM_DO_STATUS.indexOf(rotuloDoStatus(r)),
      }),
    },
  ];
}
const COLUNAS_PP = colunasDoModo(false);
const COLUNAS_PRESTACOES = colunasDoModo(true);

interface PedidosCompraListProps {
  rows: PPRow[];
  tenantId: string;
  regionais: Array<{ id: string; nome: string; ativo: boolean }>;
  /** Só o drawer usa: a aprovação passou a escolher a forma de pagamento
   *  e, no cartão, o centro de custo (29/08/2026). */
  cartoes: CartaoOption[];
  tipos: PlanoContaTipo[];
  subtipos: PlanoContaSubtipo[];
  /** Módulo fiscal: o que a NF do fornecedor e a aprovação leem do
   *  cadastro de impostos, das notas dos jobs e das PPs anteriores. */
  fiscal: FiscalDaAprovacaoPP;
  /** As PPs das empresas que NÃO estão marcadas no seletor do cabeçalho,
   *  só com o que a contagem precisa (16/11/2026): a página carrega só as
   *  das marcadas, e o seletor mostra quantas cada empresa tem. Todas
   *  marcadas = lista vazia. */
  ppsDeOutrasEmpresas: PPParaContagem[];
}

/** O mínimo de uma PP para as contagens dos seletores. */
export interface PPParaContagem {
  empresa_id: string;
  status: PPStatus;
  regional_id: string | null;
  prestacao_em_avaliacao: boolean;
}

/** Os nomes que o número dos seletores conta, pelo chip escolhido. */
const LEGENDA_DAS_CONTAGENS: Record<FiltroStatus, string> = {
  todas: "Todas as PPs",
  prestacoes: "Prestações em avaliação",
  gerada: "PPs geradas",
  em_avaliacao: "PPs em avaliação",
  aprovada: "PPs aprovadas",
  pago: "PPs pagas",
  rejeitada: "PPs rejeitadas",
  cancelada: "PPs canceladas",
};

/** A PP entra no chip escolhido? A mesma regra dos números dos chips. */
function entraNoChip(
  r: { status: PPStatus; prestacao_em_avaliacao: boolean },
  filtro: FiltroStatus,
): boolean {
  if (filtro === "prestacoes") return r.prestacao_em_avaliacao;
  return filtro === "todas" || r.status === filtro;
}

export function PedidosCompraList({
  rows,
  tenantId,
  regionais,
  cartoes,
  tipos,
  subtipos,
  fiscal,
  ppsDeOutrasEmpresas,
}: PedidosCompraListProps) {
  const [filtro, setFiltro] = React.useState<FiltroStatus>("em_avaliacao");
  // Vazio = todas as regionais (16/09/2026: o filtro virou múltiplo).
  const [regionaisFiltro, setRegionaisFiltro] = React.useState<string[]>([]);
  const [busca, setBusca] = React.useState("");
  const [ppSelecionada, setPpSelecionada] = React.useState<PPRow | null>(null);
  /** Decisão 257: a PP cuja linha abre na Planilha Interna do job. */
  const [planilhaDe, setPlanilhaDe] = React.useState<PPRow | null>(null);

  // Regional recorta o universo ANTES das contagens de status, senão os
  // chips mostram números que não batem com o que o usuário vê na tabela.
  const rowsPorRegional = React.useMemo(() => {
    if (regionaisFiltro.length === 0) return rows;
    return rows.filter(
      (r) => r.regional_id !== null && regionaisFiltro.includes(r.regional_id),
    );
  }, [rows, regionaisFiltro]);

  const contagens = React.useMemo(() => {
    const c: Record<FiltroStatus, number> = {
      todas: rowsPorRegional.length,
      prestacoes: 0,
      gerada: 0,
      em_avaliacao: 0,
      aprovada: 0,
      pago: 0,
      rejeitada: 0,
      cancelada: 0,
    };
    for (const r of rowsPorRegional) {
      c[r.status]++;
      if (r.prestacao?.status === "em_avaliacao") c.prestacoes++;
    }
    return c;
  }, [rowsPorRegional]);

  /** Quantas PPs do chip escolhido cada regional e cada empresa têm, nos
   *  seletores (16/11/2026, pedido do Tiago). A mesma base dos números dos
   *  chips: a busca não entra. Cada seletor ignora a própria seleção — o
   *  número diz quantas aparecem ao marcar aquela — e respeita a do outro. */
  const paraContagem = React.useMemo(
    () =>
      rows.map((r) => ({
        empresa_id: r.empresa_id,
        status: r.status,
        regional_id: r.regional_id,
        prestacao_em_avaliacao: r.prestacao?.status === "em_avaliacao",
      })),
    [rows],
  );
  const contagemPorRegional = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of paraContagem)
      if (r.regional_id && entraNoChip(r, filtro)) c[r.regional_id] = (c[r.regional_id] ?? 0) + 1;
    return c;
  }, [paraContagem, filtro]);
  const contagemPorEmpresa = React.useMemo(() => {
    const porEmpresa: Record<string, number> = {};
    for (const r of [...paraContagem, ...ppsDeOutrasEmpresas]) {
      if (!entraNoChip(r, filtro)) continue;
      if (regionaisFiltro.length > 0 && !(r.regional_id && regionaisFiltro.includes(r.regional_id))) continue;
      porEmpresa[r.empresa_id] = (porEmpresa[r.empresa_id] ?? 0) + 1;
    }
    return { legenda: LEGENDA_DAS_CONTAGENS[filtro], porEmpresa };
  }, [paraContagem, ppsDeOutrasEmpresas, filtro, regionaisFiltro]);
  // O seletor de empresas mora no cabeçalho da página, fora desta lista.
  usePublicarContagemPorEmpresa(contagemPorEmpresa);

  /** O que passa nos filtros de CIMA (regional, chip e busca). Os filtros
   *  dos títulos vêm depois, sobre esta lista. */
  const doTopo = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return rowsPorRegional.filter((r) => {
      if (filtro === "prestacoes") {
        if (r.prestacao?.status !== "em_avaliacao") return false;
      } else if (filtro !== "todas" && r.status !== filtro) {
        return false;
      }
      if (q === "") return true;
      return (
        r.codigo.toLowerCase().includes(q) ||
        r.fornecedor_nome.toLowerCase().includes(q) ||
        r.job_codigo.toLowerCase().includes(q) ||
        r.job_nome.toLowerCase().includes(q)
      );
    });
  }, [rowsPorRegional, filtro, busca]);

  const prestacoes = filtro === "prestacoes";
  const COLUNAS = prestacoes ? COLUNAS_PRESTACOES : COLUNAS_PP;
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "contas-a-pagar-pps" });
  const filtrados = colunas.visiveis;
  /** A ordem guardada pode ser de uma coluna que este modo não tem
   *  (ordenou por Emissão e foi para Prestação de Contas): aí ela não vale, e a
   *  barra não aparece por causa dela. */
  const ordemValendo =
    colunas.ordenacao !== null && COLUNAS.some((c) => c.chave === colunas.ordenacao!.coluna);
  const barraAtiva = colunas.filtrando || ordemValendo;

  /** As urgentes que esperam o financeiro (em avaliação e aprovadas) sobem
   *  para a seção "Urgentes" no topo, seja qual for a ordem do resto
   *  (decisão 077; as aprovadas desde 16/11/2026, decisão 257). Busca e
   *  filtros continuam valendo para elas — os dos títulos também. Com ordem
   *  pelo título, as urgentes se ordenam entre elas, e as demais embaixo da
   *  faixa "Demais PPs": a urgente não desce para o meio da lista. */
  const [urgentes, demais] = React.useMemo(
    () => [filtrados.filter(urgenteVisivel), filtrados.filter((r) => !urgenteVisivel(r))],
    [filtrados],
  );

  const regionaisOrdenadas = React.useMemo(
    () => [...regionais].filter((r) => r.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [regionais],
  );

  return (
    <div className="space-y-4">
      {/* Cabeçalho no padrão de Recorrências: chips + busca numa linha só.
          Sem botão de criação — PP nasce em Compras, não aqui. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {STATUS_FILTROS.map((f) => {
            const ativo = filtro === f.key;
            const count = contagens[f.key];
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFiltro(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  ativo
                    ? "border-california-red bg-california-red text-white"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/50",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "tabular-nums",
                    ativo ? "text-white/85" : "text-muted-foreground/70",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            <MultiSelectRegionais
              regionais={regionaisOrdenadas}
              selecionadas={regionaisFiltro}
              onSelectionChange={setRegionaisFiltro}
              contagens={contagemPorRegional}
              legenda={LEGENDA_DAS_CONTAGENS[filtro]}
            />
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar..."
                className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:border-california-red focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {barraAtiva && (
        <BarraDosFiltrosDeColuna
          visiveis={colunas.visiveis.length}
          total={colunas.total}
          singular="PP"
          plural="PPs"
          onLimpar={colunas.limpar}
        />
      )}

      {/* Grade fixa (16/11/2026): numa janela mais estreita que a do
          Tiago, a lista rola de lado dentro da caixa, e nenhuma coluna some.
          O `relative` prende na caixa o rótulo `sr-only` do cabeçalho, que
          é absoluto: sem ele, a página inteira ganhava rolagem lateral. */}
      <div className="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full min-w-[1520px] table-fixed text-sm">
          <ColunasDasPPs prestacoes={prestacoes} />
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-3 font-semibold">{colunas.titulo("codigo")}</th>
              {/* Decisão 257: Valor, Parcela, Fornecedor, Prazo original,
                  Enviada por, Job, Abertura do job, Faturamento e Status; a
                  Emissão saiu. No filtro de prestações (decisão 081), o
                  Comprovado e o Saldo ficam juntos, depois do Valor. */}
              <th className="px-4 py-3 font-semibold text-right">{colunas.titulo("valor")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo(prestacoes ? "gasto" : "parcela")}</th>
              {prestacoes && <th className="px-4 py-3 font-semibold">{colunas.titulo("saldo")}</th>}
              <th className="px-4 py-3 font-semibold">{colunas.titulo("fornecedor")}</th>
              {!prestacoes && <th className="px-4 py-3 font-semibold">{colunas.titulo("prazo")}</th>}
              {/* Decisão 136: qualquer GP envia, então o financeiro vê
                  quem enviou — e, no reenvio, quem mandou de volta. No
                  filtro de prestações, quem enviou a prestação (e quando). */}
              <th className="px-4 py-3 font-semibold">{colunas.titulo("enviada_por")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("job")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("job_aberto_em")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("job_faturamento")}</th>
              <th className="px-4 py-3 font-semibold">{colunas.titulo("status")}</th>
              <th className="w-10 px-2 py-3">
                <span className="sr-only">Planilha Interna</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {/* Vazio pelos filtros dos títulos: a tabela fica, com os
                títulos, para desfazer. */}
            {doTopo.length > 0 && filtrados.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  Nenhum Pedido de Produção com esse filtro.
                </td>
              </tr>
            )}
            {doTopo.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "Nenhum Pedido de Produção emitido ainda."
                    : "Nenhum Pedido de Produção encontrado com esses filtros."}
                </td>
              </tr>
            )}
            {[...urgentes, ...demais].map((r, i) => (
              <React.Fragment key={r.id}>
              {/* A seção das urgentes: o título faz o papel do selo, que
                  saiu da linha (16/11/2026). */}
              {i === 0 && urgentes.length > 0 && (
                <tr className="border-b border-border bg-california-red/[0.07]">
                  <td
                    colSpan={11}
                    className="border-l-[3px] border-l-california-red px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-california-red"
                  >
                    Urgentes · {urgentes.length}
                  </td>
                </tr>
              )}
              {i === urgentes.length && urgentes.length > 0 && (
                <tr className="border-b border-border bg-muted/30">
                  <td
                    colSpan={11}
                    className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                  >
                    Demais PPs
                  </td>
                </tr>
              )}
              <tr
                role="button"
                tabIndex={0}
                onClick={() => setPpSelecionada(r)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setPpSelecionada(r);
                  }
                }}
                className={cn(
                  "border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:bg-accent/40",
                  i < urgentes.length && "bg-california-red/[0.04]",
                )}
              >
                <td
                  className={cn(
                    "px-4 py-3 font-mono text-xs font-bold text-california-red",
                    i < urgentes.length && "border-l-[3px] border-l-california-red",
                  )}
                >
                  {/* A justificativa da urgência ao passar o mouse no código;
                      inteira, ela está no topo do dossiê da PP. */}
                  <span
                    className="block whitespace-nowrap"
                    title={urgenteVisivel(r) ? (r.urgente_justificativa ?? undefined) : undefined}
                  >
                    {r.codigo}
                  </span>
                  {/* Decisão 257: o selo Verba/Reembolso logo embaixo do
                      código, para a coluna ficar estreita. No filtro de
                      prestações a linha é a da prestação. */}
                  {r.verba_producao && (
                    <span className="mt-1 flex font-sans">
                      {filtro === "prestacoes" ? (
                        <SeloPrestacao />
                      ) : (
                        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          {/* Decisão 187: o reembolso mora no campo da verba. */}
                          {r.tipo_verba === "reembolso" ? "Reembolso" : "Verba"}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold">
                  {formatMoney(r.valor)}
                </td>
                {/* No filtro de prestações: o Comprovado e o Saldo, juntos. */}
                {filtro === "prestacoes" ? (
                  <>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {formatMoney(r.prestacao?.valor_gasto ?? 0)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-teal-700">
                        {formatMoney(r.prestacao?.valor_devolvido ?? 0)}
                      </span>
                    </td>
                  </>
                ) : (
                  // Parcela: a PP parcelada aparece como "1/3" — quantas
                  // vezes o financeiro vai pagar. Cada parcela vira uma linha
                  // própria na aba "Títulos a Pagar".
                  <td className="px-4 py-3">
                    <span className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs font-semibold">
                      1/{Math.max(r.parcelas.length, 1)}
                    </span>
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-start">
                  {/* Até duas linhas; o nome inteiro abre no cartão. */}
                  <TruncateTooltip
                    linhas={2}
                    className="min-w-0"
                    text={nomeContraparteBRPP({ verba_producao: r.verba_producao, tipo_verba: r.tipo_verba, verba_titular_nome: r.responsavel_nome, fornecedor: r.fornecedor_nome ? { nome: r.fornecedor_nome } : null, responsavel: r.responsavel_nome ? { nome: r.responsavel_nome } : null })}
                  />
                  {/* Asterisco da decisão 067. Aqui ele importa mais que na
                      aba de títulos: é nesta tela que a PP é aprovada, e
                      aprovar é o passo em que dá tempo de conferir a conta
                      antes de o dinheiro sair. */}
                  {r.cadastro_do_fornecedor_mudou && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          tabIndex={0}
                          className="ml-1 shrink-0 cursor-help font-bold text-amber-600"
                          aria-label="O cadastro do fornecedor mudou depois desta PP"
                        >
                          *
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px]">
                        Os dados de pagamento do fornecedor mudaram depois
                        desta PP. Ela continua valendo pelos dados que estão
                        no documento dela; o cadastro novo vale para as
                        próximas.
                      </TooltipContent>
                    </Tooltip>
                  )}
                  </div>
                </td>
                {filtro !== "prestacoes" && (
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(r.prazo_pagamento)}</td>
                )}
                <td className="px-4 py-3">
                  <QuemEnviou
                    envio={
                      filtro === "prestacoes"
                        ? ultimoEnvioDaPrestacao(r.eventos)
                        : ultimoEnvioDaPP(r.eventos)
                    }
                  />
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {/* Código e nome em até duas linhas; o resto abre no cartão. */}
                  <TruncateTooltip linhas={2} text={`${r.job_codigo} ${r.job_nome}`.trim()}>
                    <span className="font-mono text-xs">{r.job_codigo}</span> {r.job_nome}
                  </TruncateTooltip>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDiaBr(r.job_aberto_em)}</td>
                <td className="px-4 py-3">
                  <SeloDoFaturamento s={r.job_faturamento} />
                </td>
                <td className="px-4 py-3">
                  {/* Decisão 257: a PP paga — verba inclusive — fica "Pago",
                      com o dia embaixo; o andamento da prestação mora na
                      linha de baixo. No filtro de prestações a linha é a
                      prestação. */}
                  {filtro === "prestacoes" && situacaoDaVerba(r) ? (
                    <SituacaoVerbaChip situacao={situacaoDaVerba(r)!} />
                  ) : r.status === "pago" ? (
                    <div className="flex flex-col items-start gap-1">
                      <Badge className={cn("whitespace-nowrap border", statusBadgeClasses(r.status))}>
                        {ppStatusLabel(r.status)}
                      </Badge>
                      {r.pago_em && (
                        <span className="whitespace-nowrap text-xs text-muted-foreground">Pago {formatDate(r.pago_em)}</span>
                      )}
                    </div>
                  ) : (
                    <Badge className={cn("whitespace-nowrap border", statusBadgeClasses(r.status))}>
                      {ppStatusLabel(r.status)}
                    </Badge>
                  )}
                </td>
                {/* Decisão 257: a linha da PP na Planilha Interna do job, num
                    pop-up (o ícone do protótipo de Suprimentos). */}
                <td className="px-2 py-3 text-right">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={`Ver a linha da ${r.codigo} na Planilha Interna`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPlanilhaDe(r);
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Sheet className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Ver a linha na Planilha Interna</TooltipContent>
                  </Tooltip>
                </td>
              </tr>
              {/* Decisão 257: a prestação de contas é outra linha da mesma PP,
                  logo embaixo. */}
              {filtro !== "prestacoes" && temLinhaDaPrestacao(r) && (
                <LinhaDaPrestacao r={r} onAbrir={() => setPpSelecionada(r)} />
              )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Clicar na linha abre a TELA da PP — pedido, documento e dossiê
          lado a lado —, e não mais um drawer que obrigava a abrir a
          conferência num segundo passo (10/09/2026). Vale para qualquer
          status: ver o documento de uma PP paga é pedido corriqueiro. */}
      <PPTela
        pp={ppSelecionada}
        open={ppSelecionada !== null}
        onOpenChange={(open) => {
          if (!open) setPpSelecionada(null);
        }}
        tenantId={tenantId}
        cartoes={cartoes}
        tipos={tipos}
        subtipos={subtipos}
        fiscal={fiscal}
      />

      {/* Decisão 257: a Planilha Interna do job, com a linha da PP na borda
          vermelha (a da revisão da abertura) e rolada até ela. */}
      {planilhaDe && (
        <PopUpDaPlanilha
          aberto
          onOpenChange={(v) => {
            if (!v) setPlanilhaDe(null);
          }}
          jobId={planilhaDe.job_id}
          codigo={planilhaDe.job_codigo}
          descricao={
            planilhaDe.item_orcado_id
              ? `A linha de onde veio a ${planilhaDe.codigo} está com a borda vermelha.`
              : `A ${planilhaDe.codigo} não está ligada a uma linha da planilha.`
          }
          linhasDaRevisao={planilhaDe.item_orcado_id ? [planilhaDe.item_orcado_id] : []}
          rolarAte={planilhaDe.item_orcado_id}
        />
      )}
    </div>
  );
}
