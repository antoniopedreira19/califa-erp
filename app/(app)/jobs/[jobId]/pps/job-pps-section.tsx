"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Search,
  Eye,
  Pencil,
  X,
  Clock,
  Wallet,
  Layers,
  Receipt,
  Send,
  ClipboardList,
  ClipboardCheck,
  XCircle,
} from "lucide-react";
import {
  DescritivoPopover,
  DescritivoRodapeNota,
} from "@/components/ui/descritivo-popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import {
  podeCancelarPP,
  ppStatusLabel,
  situacaoVerbaLabel,
  type PedidoCompraNaLista,
  type PedidoCompraParcela,
  type PPStatus,
  type Empresa,
  type JobStatus,
  situacaoDaVerba,
  verbaAguardaProducao,
} from "@/lib/types";
import {
  cancelarERefazerPP,
  cancelarPedidoCompra,
} from "../realizado/actions-pp";
import { EnvioDialog, textoAguardaAbertura, type PPParaEnviar } from "../realizado/pp-a-emitir-ui";
import type { TomadorDaNf } from "../realizado/anexos-da-pp";
import { prazoDeEnvioPerdido, useFeriadosNacionais } from "../realizado/prazo-de-envio-pp";
import { hojeEmSaoPauloIso, isoParaBr } from "@/lib/calculos/janelas-pagamento";
import type { PPRow } from "@/app/(app)/financeiro/contas-a-pagar/pedidos-compra-list";
import type { EstabelecimentoDaNota } from "@/app/(app)/financeiro/contas-a-pagar/pp-dossie";
import { carregarPPParaVisualizar } from "./actions-visualizar";
import { VerPPDrawer } from "./ver-pp-drawer";
import { PPStatusChip } from "./pp-status-chip";
import {
  FILTRO_VAZIO,
  FiltroDeColuna,
  filtroAtivo,
  semAcento,
  type DirecaoDaOrdem,
  type FiltroDaColuna,
  type ValorDaColuna,
} from "@/components/ui/filtro-de-coluna";
import { PrestarContasDrawer } from "./prestar-contas-drawer";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";

/** A tela lado a lado do Contas a Pagar, em leitura — a mesma do
 *  "Visualizar" do "Ver PP". Só carrega quando alguém clica no olho. */
const PPTela = dynamic(
  () => import("@/app/(app)/financeiro/contas-a-pagar/pp-tela").then((m) => m.PPTela),
  { ssr: false },
);

interface Props {
  pps: PedidoCompraNaLista[];
  fornecedoresPorId: Record<string, string>;
  /** GP responsável pelo job ou admin, com o job em estado editável. */
  /** Cancelar a PP e a trilha de ações. Desde 08/09/2026 vale também na
   *  pré-abertura, junto com gerar (decisão 056). */
  editable: boolean;
  /** Corrigir e REENVIAR a PP rejeitada — é envio ao financeiro, e não
   *  segue `editable`: fica fechado na pré-abertura e enquanto a abertura
   *  está em revisão (decisões 056 e 040). */
  podeEnviar?: boolean;
  /** O papel envia PP (`jobs.enviar_pp`, decisão 136): sem ele, o
   *  cancelamento vale só para a PP ainda não enviada. */
  papelEnviaPP: boolean;
  /** PPs de verba em que quem está logado presta contas (decisão 081):
   *  responsável pela verba, responsável do job ou administrador. */
  podePrestarContas: string[];
  /** O status do job e a marca de revisão da abertura (decisão 040): as
   *  portas do envio que não são do papel, nas mesmas frases do painel do
   *  item. O PAPEL vem de `papelEnviaPP`. */
  statusDoJob: JobStatus;
  aberturaEmRevisao: boolean;
  /** O que o pop-up de envio precisa — o mesmo que o painel do item recebe
   *  (decisões 152 e 156). */
  tomadoresDaNf: TomadorDaNf[];
  tomadorPorEmpresa: Record<string, string>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia">>;
  /** O PLANEJADO de cada linha, pelo id da âncora do realizado: o cartão do
   *  topo do "Ver formulário", como no painel do item. */
  planejadoPorItem: Record<string, number>;
}

/** "aguardando_prestacao" junta verba sem prestação e prestação reprovada:
 *  nos dois casos a próxima ação é da produção (decisão 081, 4a). */
type Filtro = "todas" | PPStatus | "aguardando_prestacao" | "pronta_para_envio";

/**
 * As colunas que filtram e ordenam pelo título, como no Excel (pedido do
 * Tiago, 08/10/2026). A coluna das ações não tem título nem filtro.
 */
type Coluna =
  | "codigo"
  | "origem"
  | "servico"
  | "fornecedor"
  | "vencimento"
  | "pagamento"
  | "valor"
  | "status";

/** O que a coluna mostra numa linha, a chave do valor e como ela ordena. */
interface CelulaDaColuna {
  valor: string;
  rotulo: string;
  ordem: string | number;
  /** O texto em que a busca da coluna procura, quando não é só o rótulo. */
  busca?: string;
  /** O grupo do valor na lista do funil (o bloco do item). */
  grupo?: string;
}

/** Uma linha da tabela = uma PARCELA de uma PP. `parcela: null` só
 *  acontece se o embed vier vazio — nenhuma PP fica sem parcela. */
interface LinhaPP {
  pp: PedidoCompraNaLista;
  parcela: PedidoCompraParcela | null;
  indice: number;
  total: number;
}

const CHIPS: Array<{ key: Filtro; label: string }> = [
  { key: "todas", label: "Todas" },
  { key: "gerada", label: "Gerada" },
  { key: "pronta_para_envio", label: "Pronta para envio" },
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "pago", label: "Pago" },
  { key: "aguardando_prestacao", label: "Aguardando prestação" },
  { key: "rejeitada", label: "Rejeitado" },
  { key: "cancelada", label: "Cancelada" },
];

/**
 * A trilha fora do frame da tabela (decisão 160): até três botões só de
 * ícone — enviar ao financeiro, ver o formulário e cancelar —, só os que
 * valem na linha, um colado no outro (sem lugar vazio, pedido do Tiago).
 * "Prestar contas" segue com texto, no lugar do cancelar (verba paga nunca
 * é cancelável), e a trilha só se alarga quando há verba esperando prestação.
 */
const ICONE = 29;
const VAO = 6;
const LARGURA_TRILHA_ICONES = ICONE * 3 + VAO * 2;
// "Corrigir prestação" é o botão mais largo da trilha (decisão 081).
const LARGURA_TRILHA_PRESTACAO = ICONE * 2 + VAO * 2 + 128;
/** O quanto a trilha pode avançar sobre o respiro lateral da página. */
const AVANCO_NA_MARGEM = 30;

/** "Pronta para envio" (08/10/2026): o produtor conferiu os documentos no
 *  painel do item e deixou a PP para o GP enviar. */
function prontaParaEnvio(pp: PedidoCompraNaLista): boolean {
  return pp.status === "gerada" && pp.pronta_para_envio_em !== null;
}

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * A coluna "Dt. Pagamento" (decisão 112, 28/09/2026), que substituiu o
 * "Prazo" (os dias entre a emissão e o vencimento).
 *
 * Uma linha por parcela: paga → o dia em que foi paga; aprovada e ainda
 * não paga → a data que o financeiro programou (a de hoje, se ele
 * repactuou em Títulos a Pagar); antes da aprovação → travessão. A linha
 * sem parcela (PP anterior ao parcelamento) lê os campos da própria PP.
 */
function DtPagamento({
  pp,
  parcela,
}: {
  pp: PedidoCompraNaLista;
  parcela: PedidoCompraParcela | null;
}) {
  const paga = parcela ? parcela.pago_em : pp.pago_em;
  const programada = parcela
    ? parcela.data_pagamento
    : pp.prazo_pagamento_financeiro;
  if (paga) {
    return (
      <span className="flex flex-col leading-tight">
        <span className="font-mono text-xs">{formatarData(paga)}</span>
        <span className="text-[10.5px] font-semibold text-emerald-700">
          paga
        </span>
      </span>
    );
  }
  // Só PP aprovada tem data programada que vale: a que voltou para
  // avaliação (rejeitada, reenviada) pode guardar a data da aprovação
  // desfeita, e ela não vai ser paga nessa data.
  if (programada && (pp.status === "aprovada" || pp.status === "pago")) {
    return (
      <span className="flex flex-col leading-tight">
        <span className="font-mono text-xs">{formatarData(programada)}</span>
        <span className="text-[10.5px] text-muted-foreground">programada</span>
      </span>
    );
  }
  return (
    <span
      className="text-[12.5px] text-muted-foreground"
      title="A data sai na aprovação da PP pelo financeiro."
    >
      —
    </span>
  );
}

export function JobPPsSection({
  pps,
  fornecedoresPorId,
  editable,
  podeEnviar = false,
  papelEnviaPP,
  podePrestarContas,
  statusDoJob,
  aberturaEmRevisao,
  tomadoresDaNf,
  tomadorPorEmpresa,
  empresas,
  planejadoPorItem,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [busca, setBusca] = React.useState("");
  /** O filtro de cada coluna (o funil do título). */
  const [filtros, setFiltros] = React.useState<Partial<Record<Coluna, FiltroDaColuna>>>({});
  /** Uma coluna ordena por vez; sem nenhuma, vale a ordem de sempre. */
  const [ordenacao, setOrdenacao] = React.useState<{ coluna: Coluna; direcao: DirecaoDaOrdem } | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  /** A rejeitada que vai ser cancelada e refeita (decisão 153): ela não se
   *  edita mais, volta como PP a emitir no painel do item. */
  const [ppRefazendo, setPpRefazendo] = React.useState<PedidoCompraNaLista | null>(
    null,
  );
  const [ppCancelando, setPpCancelando] =
    React.useState<PedidoCompraNaLista | null>(null);
  const [ppPrestando, setPpPrestando] =
    React.useState<PedidoCompraNaLista | null>(null);
  /** A PP gerada no pop-up de envio — o mesmo do painel do item (decisão
   *  152), já preenchido com o que o produtor conferiu. */
  const [ppEnviando, setPpEnviando] =
    React.useState<PedidoCompraNaLista | null>(null);
  /** O formulário da PP em leitura ("Ver formulário" do painel do item). */
  const [ppVendo, setPpVendo] = React.useState<PedidoCompraNaLista | null>(null);
  /** A PP ao lado dos documentos (o olho). */
  const [visualizando, setVisualizando] = React.useState<{
    pp: PPRow;
    estabelecimentos: EstabelecimentoDaNota[];
  } | null>(null);
  const [ladoALadoAberto, setLadoALadoAberto] = React.useState(false);
  const feriados = useFeriadosNacionais();
  const hoje = hojeEmSaoPauloIso();
  // As portas do envio que não são do papel, nas mesmas frases do painel do
  // item (`envioBloqueadoPor` de job-item-realizado-table.tsx).
  const envioBloqueadoPor =
    textoAguardaAbertura(statusDoJob) ??
    (aberturaEmRevisao
      ? "A abertura deste job está em revisão no financeiro desde a última errata. O envio de PPs volta quando a revisão for salva — gerar, editar e cancelar continuam liberados."
      : null);
  const nomeDaEmpresa = (id: string) => {
    const e = empresas.find((x) => x.id === id);
    return e ? (e.nome_fantasia ?? e.razao_social) : "—";
  };
  /** Qual cartão de descrição está aberto — a chave é a LINHA (a parcela),
   *  não a PP: duas parcelas da mesma PP abririam dois cartões de uma vez.
   *  O estado é da lista, e é ele que garante um cartão por vez (051). */
  const [descritivoAberto, setDescritivoAberto] = React.useState<string | null>(
    null,
  );

  // A trilha não assume altura fixa: mede cada <tr> e posiciona o botão
  // correspondente no mesmo offset. Desde 08/09/2026 o serviço cabe em uma
  // linha só (o texto inteiro está no cartão), mas o fornecedor ainda
  // quebra em duas — e a medição continua sendo o que mantém os botões
  // alinhados com as linhas.
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const [linhas, setLinhas] = React.useState<
    Array<{ top: number; height: number }>
  >([]);
  /** Altura do cabeçalho: desce a trilha até o começo do tbody. */
  const [offsetThead, setOffsetThead] = React.useState(0);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const aguardandoPrestacao = React.useMemo(
    () => pps.filter((pp) => verbaAguardaProducao(situacaoDaVerba(pp))).length,
    [pps],
  );
  const prontas = React.useMemo(() => pps.filter(prontaParaEnvio).length, [pps]);

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return pps.filter((pp) => {
      if (filtro === "aguardando_prestacao") {
        if (!verbaAguardaProducao(situacaoDaVerba(pp))) return false;
      } else if (filtro === "pronta_para_envio") {
        if (!prontaParaEnvio(pp)) return false;
      } else if (filtro !== "todas" && pp.status !== filtro) {
        return false;
      }
      if (!termo) return true;
      const fornecedor = (pp.fornecedor_id ? fornecedoresPorId[pp.fornecedor_id] : null) ?? "";
      // O item e o bloco entraram na busca em 09/09/2026, junto da coluna
      // "Origem no job": procurar por "Fotógrafo" ou "TOOLKIT" é o jeito
      // natural de achar a PP depois que a origem virou visível.
      return (
        pp.codigo.toLowerCase().includes(termo) ||
        pp.servico.toLowerCase().includes(termo) ||
        (pp.item_nome ?? "").toLowerCase().includes(termo) ||
        (pp.grupo_nome ?? "").toLowerCase().includes(termo) ||
        fornecedor.toLowerCase().includes(termo)
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pps, filtro, busca, fornecedoresPorId]);

  /**
   * Uma linha por PARCELA (decisão do Tiago, 17/08/2026): cada parcela é
   * um vencimento próprio, e é assim que o financeiro vai tratá-la. PP
   * sem parcelamento tem uma parcela 1/1 e continua ocupando uma linha
   * só — visualmente nada mudou para ela.
   *
   * PP legada sem parcela não existe (a migration backfillou todas), mas
   * o fallback evita sumir com a linha caso o embed venha vazio.
   */
  const linhasBase = React.useMemo<LinhaPP[]>(
    () =>
      visiveis.flatMap((pp): LinhaPP[] => {
        const parcelas = pp.parcelas ?? [];
        if (parcelas.length === 0) {
          return [{ pp, parcela: null, indice: 0, total: 1 }];
        }
        return parcelas.map((parcela, i) => ({
          pp,
          parcela,
          indice: i,
          total: parcelas.length,
        }));
      }),
    [visiveis],
  );

  /** O que cada coluna mostra numa linha — a mesma conta das células. */
  const celula = React.useCallback(
    (linha: LinhaPP, coluna: Coluna): CelulaDaColuna => {
      const { pp, parcela } = linha;
      switch (coluna) {
        case "codigo":
          return { valor: pp.codigo, rotulo: pp.codigo, ordem: pp.codigo };
        case "origem": {
          const item = pp.item_nome ?? "—";
          // O item DENTRO do bloco: a chave junta os dois, para o mesmo
          // nome em blocos diferentes não virar um valor só, e a busca
          // acha pelo nome do bloco também.
          const bloco = pp.grupo_nome ?? "";
          return {
            valor: `${bloco}::${item}`,
            rotulo: item,
            ordem: `${bloco} ${item}`,
            busca: `${item} ${bloco}`,
            grupo: bloco,
          };
        }
        case "servico":
          return { valor: pp.servico, rotulo: pp.servico, ordem: pp.servico };
        case "fornecedor": {
          const nome = pp.verba_producao
            ? `Verba de produção${pp.responsavel?.nome ? ` · ${pp.responsavel.nome}` : ""}`
            : ((pp.fornecedor_id ? fornecedoresPorId[pp.fornecedor_id] : null) ?? "—");
          return { valor: nome, rotulo: nome, ordem: nome };
        }
        case "vencimento": {
          const iso = (parcela?.data_vencimento ?? pp.prazo_pagamento).slice(0, 10);
          return { valor: iso, rotulo: formatarData(iso), ordem: iso };
        }
        case "pagamento": {
          // A mesma regra da célula `DtPagamento`.
          const paga = parcela ? parcela.pago_em : pp.pago_em;
          const programada = parcela ? parcela.data_pagamento : pp.prazo_pagamento_financeiro;
          if (paga) {
            const iso = paga.slice(0, 10);
            return { valor: `paga:${iso}`, rotulo: `${formatarData(iso)} · paga`, ordem: iso };
          }
          if (programada && (pp.status === "aprovada" || pp.status === "pago")) {
            const iso = programada.slice(0, 10);
            return { valor: `programada:${iso}`, rotulo: `${formatarData(iso)} · programada`, ordem: iso };
          }
          return { valor: "", rotulo: "(sem data)", ordem: "9999-99-99" };
        }
        case "valor": {
          const v = parcela ? Number(parcela.valor) : Number(pp.valor);
          return { valor: String(Math.round(v * 100)), rotulo: formatCurrency(v, "BRL"), ordem: v };
        }
        case "status": {
          const situacao = situacaoDaVerba(pp);
          const rotulo = situacao ? situacaoVerbaLabel(situacao) : ppStatusLabel(pp.status);
          return { valor: rotulo, rotulo, ordem: rotulo };
        }
      }
    },
    [fornecedoresPorId],
  );

  /** A linha passa no filtro da coluna? */
  const passa = React.useCallback(
    (linha: LinhaPP, coluna: Coluna, f: FiltroDaColuna | undefined): boolean => {
      if (!f || !filtroAtivo(f)) return true;
      const c = celula(linha, coluna);
      if (coluna === "valor") {
        const v = Number(c.ordem);
        if (f.de !== null && v < f.de - 0.004) return false;
        if (f.ate !== null && v > f.ate + 0.004) return false;
        return true;
      }
      const termo = semAcento(f.busca.trim());
      if (termo && !semAcento(c.busca ?? c.rotulo).includes(termo)) return false;
      if (f.marcados !== null && !f.marcados.includes(c.valor)) return false;
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [celula],
  );

  const COLUNAS: Coluna[] = ["codigo", "origem", "servico", "fornecedor", "vencimento", "pagamento", "valor", "status"];

  /** Os valores de cada coluna para a lista do funil: o que sobra com os
   *  filtros das OUTRAS colunas, como o Excel faz. */
  const valoresDaColuna = React.useMemo(() => {
    const r = {} as Record<Coluna, ValorDaColuna[]>;
    for (const coluna of COLUNAS) {
      const mapa = new Map<string, { rotulo: string; ordem: string | number; quantas: number; grupo?: string }>();
      for (const linha of linhasBase) {
        if (!COLUNAS.every((outra) => outra === coluna || passa(linha, outra, filtros[outra]))) continue;
        const c = celula(linha, coluna);
        const atual = mapa.get(c.valor);
        if (atual) atual.quantas += 1;
        else mapa.set(c.valor, { rotulo: c.rotulo, ordem: c.ordem, quantas: 1, grupo: c.grupo });
      }
      r[coluna] = [...mapa.entries()]
        .sort(([, a], [, b]) =>
          typeof a.ordem === "number" && typeof b.ordem === "number"
            ? a.ordem - b.ordem
            : String(a.ordem).localeCompare(String(b.ordem), "pt-BR"),
        )
        .map(([valor, x]) => ({ valor, rotulo: x.rotulo, quantas: x.quantas, grupo: x.grupo }));
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhasBase, filtros, celula, passa]);

  /** As linhas da tabela: os filtros de todas as colunas e a ordem do
   *  título. Sem ordem, a de sempre (a PP mais nova em cima). */
  const linhasVisiveis = React.useMemo<LinhaPP[]>(() => {
    const filtradas = linhasBase.filter((linha) =>
      COLUNAS.every((coluna) => passa(linha, coluna, filtros[coluna])),
    );
    if (!ordenacao) return filtradas;
    const sinal = ordenacao.direcao === "asc" ? 1 : -1;
    return filtradas
      .map((linha, i) => ({ linha, i, chave: celula(linha, ordenacao.coluna).ordem }))
      .sort((a, b) => {
        const d =
          typeof a.chave === "number" && typeof b.chave === "number"
            ? a.chave - b.chave
            : String(a.chave).localeCompare(String(b.chave), "pt-BR");
        return d !== 0 ? d * sinal : a.i - b.i;
      })
      .map((x) => x.linha);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhasBase, filtros, ordenacao, celula, passa]);

  /** A etiqueta do bloco, clicada: a Origem passa a mostrar só os itens
   *  daquele bloco. */
  function filtrarPeloBloco(bloco: string) {
    const doBloco = Array.from(
      new Set(
        linhasBase
          .filter((l) => (l.pp.grupo_nome ?? "") === bloco)
          .map((l) => celula(l, "origem").valor),
      ),
    );
    setFiltros((atual) => ({ ...atual, origem: { ...FILTRO_VAZIO, marcados: doBloco } }));
  }

  const algumFiltroDeColuna = COLUNAS.some((c) => filtroAtivo(filtros[c])) || ordenacao !== null;

  /** O título que filtra e ordena. */
  function titulo(coluna: Coluna, rotulo: string, tipo: "texto" | "data" | "valor", alinhar: "left" | "right" = "left") {
    return (
      <FiltroDeColuna
        rotulo={rotulo}
        tipo={tipo}
        faixa={coluna === "valor"}
        valores={valoresDaColuna[coluna]}
        filtro={filtros[coluna] ?? FILTRO_VAZIO}
        onFiltro={(f) => setFiltros((atual) => ({ ...atual, [coluna]: f }))}
        ordem={ordenacao?.coluna === coluna ? ordenacao.direcao : null}
        onOrdem={(d) => setOrdenacao(d ? { coluna, direcao: d } : null)}
        alinhar={alinhar}
      />
    );
  }

  React.useLayoutEffect(() => {
    const tbody = tbodyRef.current;
    if (!tbody) return;

    const medir = () => {
      const base = tbody.getBoundingClientRect().top;
      const cardTop =
        tbody.closest("table")?.getBoundingClientRect().top ?? base;
      setOffsetThead(base - cardTop);
      setLinhas(
        Array.from(tbody.rows).map((tr) => {
          const r = tr.getBoundingClientRect();
          return { top: r.top - base, height: r.height };
        }),
      );
    };

    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(tbody);
    const tabela = tbody.closest("table");
    if (tabela) observer.observe(tabela);
    return () => observer.disconnect();
  }, [linhasVisiveis]);

  // Cards de resumo ignoram canceladas: PP cancelada não é PP gerada, é
  // uma que deixou de existir pro job.
  const ativas = pps.filter((p) => p.status !== "cancelada");
  const resumo = {
    geradas: ativas.length,
    aguardandoEnvio: ativas.filter((p) => p.status === "gerada").length,
    emAvaliacao: ativas.filter((p) => p.status === "em_avaliacao").length,
    pagas: ativas.filter((p) => p.status === "pago").length,
    total: ativas.reduce((s, p) => s + Number(p.valor ?? 0), 0),
  };

  /**
   * O olho (08/10/2026): a PP ao lado dos documentos anexados, na tela do
   * Contas a Pagar em leitura — a mesma do "Visualizar" do "Ver PP". Antes
   * cada linha abria o PDF da sua parcela numa aba nova; o PDF da PP traz
   * todas as parcelas, e a tela tem "Abrir em outra aba".
   */
  function handleVer(pp: PedidoCompraNaLista) {
    startTransition(async () => {
      const res = await carregarPPParaVisualizar(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setVisualizando({ pp: res.pp, estabelecimentos: res.estabelecimentos });
      setLadoALadoAberto(true);
    });
  }

  /**
   * Por que ESTA PP não pode ser enviada agora, na ordem do painel do item:
   * o job (pré-abertura, abertura em revisão) e o prazo de envio do
   * vencimento (decisão 157). O papel nem chega aqui: o botão só existe
   * para quem envia. Nulo: o botão vale.
   */
  function travaDoEnvio(pp: PedidoCompraNaLista): string | null {
    if (envioBloqueadoPor) return envioBloqueadoPor;
    const perdido = prazoDeEnvioPerdido(
      { prazoPagamento: pp.prazo_pagamento, geradaEm: pp.created_at },
      hoje,
      feriados,
    );
    if (perdido) {
      return `O prazo de envio do vencimento ${isoParaBr(pp.prazo_pagamento)} já passou. Atualize o vencimento no painel do item, na Planilha Interna.`;
    }
    if (!podeEnviar) return "O envio desta PP está fechado.";
    return null;
  }

  /** O que as PPs do item já somam, para o cartão do "Ver formulário":
   *  todas menos as canceladas (decisão 074). */
  function emPPsDoItem(itemRealizadoId: string): number {
    return pps
      .filter((x) => x.item_realizado_id === itemRealizadoId && x.status !== "cancelada")
      .reduce((s, x) => s + Number(x.valor ?? 0), 0);
  }

  const larguraTrilha = podePrestarContas.length > 0 ? LARGURA_TRILHA_PRESTACAO : LARGURA_TRILHA_ICONES;

  function handleCancelarConfirm() {
    if (!ppCancelando) return;
    const codigo = ppCancelando.codigo;
    startTransition(async () => {
      const res = await cancelarPedidoCompra(ppCancelando.id);
      setPpCancelando(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setToast(`${codigo} cancelada.`);
      router.refresh();
    });
  }

  if (pps.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum Pedido de Produção gerado neste job ainda.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          As PPs são geradas pela aba Planilha Interna, a partir dos itens com
          valor realizado lançado.
        </p>
      </div>
    );
  }

  return (
    // Reserva a calha da direita pra trilha, que fica fora do frame da
    // tabela — sem ela os botões eram cortados na borda da página. Desde
    // 08/10/2026 ela existe para todos: o "Ver formulário" é de quem lê.
    <div
      className="space-y-3.5"
      style={{ paddingRight: 10 + larguraTrilha - AVANCO_NA_MARGEM }}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardResumo
          rotulo="PPs geradas"
          valor={String(resumo.geradas)}
          // Quantas ainda não foram enviadas ao financeiro (02/09/2026).
          // O envio, a edição e o cancelamento da PP gerada moram no
          // painel do item, na Planilha Interna.
          detalhe={
            resumo.aguardandoEnvio > 0 ? (
              <>
                {resumo.aguardandoEnvio} aguardando envio
                {prontas > 0 && (
                  <span className="text-amber-800">
                    {" "}
                    · {prontas} {prontas === 1 ? "pronta" : "prontas"}
                  </span>
                )}
              </>
            ) : undefined
          }
        />
        <CardResumo
          rotulo="Em avaliação"
          valor={String(resumo.emAvaliacao)}
          cor="text-[#92400e]"
        />
        <CardResumo
          rotulo="Pagas"
          valor={String(resumo.pagas)}
          cor="text-emerald-700"
        />
        <CardResumo
          rotulo="Total em PPs"
          valor={formatCurrency(resumo.total, "BRL")}
          mono
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setFiltro(c.key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[11.5px] font-semibold transition-colors",
              filtro === c.key
                ? "border-california-red bg-california-red text-white"
                : "border-border bg-white text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
            {c.key === "aguardando_prestacao" && aguardandoPrestacao > 0
              ? ` · ${aguardandoPrestacao}`
              : ""}
            {c.key === "pronta_para_envio" && prontas > 0 ? ` · ${prontas}` : ""}
          </button>
        ))}
        {/* A busca geral fica, e cada coluna ganhou a sua (08/10/2026). */}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código, item, bloco ou fornecedor"
            className="h-8 w-[270px] rounded-lg border border-border bg-white pl-8 pr-3 text-xs outline-none focus:border-california-red/40"
          />
        </div>
      </div>

      {/* Quantas linhas os filtros dos títulos deixaram, e um botão que
          tira todos de uma vez: o filtro mora escondido no título, e é
          fácil esquecer um ligado (08/10/2026). */}
      {algumFiltroDeColuna && (
        <div
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2 text-[12px] text-muted-foreground"
        >
          <span>
            Mostrando <strong className="text-foreground">{linhasVisiveis.length}</strong> de {linhasBase.length}{" "}
            {linhasBase.length === 1 ? "linha" : "linhas"} · filtros e ordem pelos títulos das colunas
          </span>
          <button
            type="button"
            onClick={() => {
              setFiltros({});
              setOrdenacao(null);
            }}
            className="inline-flex items-center gap-1 font-semibold text-california-red hover:underline"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros e ordem
          </button>
        </div>
      )}

      {erro && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-california-red/30 bg-california-red/5 px-4 py-2 text-xs text-california-red">
          <span>{erro}</span>
          <button type="button" onClick={() => setErro(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="relative">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
          <div className="overflow-x-auto">
            {/* `table-fixed` desde 09/09/2026: com layout automático, uma
                descrição longa esticava a tabela para fora da página e
                obrigava a rolar para o lado até o Status. Agora as
                larguras mandam e o texto é que se acomoda — a mesma regra
                das planilhas (docs/09-identidade-visual-ui.md). */}
            <table className="w-full min-w-[980px] table-fixed border-collapse text-[13px]">
              <colgroup>
                <col className="w-[7%]" />
                <col className="w-[20%]" />
                <col className="w-[20%]" />
                <col className="w-[15%]" />
                <col className="w-[8.5%]" />
                <col className="w-[8.5%]" />
                <col className="w-[8.5%]" />
                <col className="w-[9%]" />
                <col className="w-[3.5%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5 text-left">{titulo("codigo", "Código", "texto")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("origem", "Origem no job", "texto")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("servico", "Serviço", "texto")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("fornecedor", "Fornecedor", "texto")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("vencimento", "Vencimento", "data")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("pagamento", "Dt. Pagamento", "data")}</th>
                  <th className="px-3.5 py-2.5 text-right">{titulo("valor", "Valor", "valor", "right")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("status", "Status", "texto")}</th>
                  <th className="px-3.5 py-2.5" />
                </tr>
              </thead>
              <tbody ref={tbodyRef}>
                {linhasVisiveis.length === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Nenhuma PP com esse filtro.
                    </td>
                  </tr>
                )}
                {linhasVisiveis.map(({ pp, parcela, indice, total }) => {
                  const vencimento = parcela?.data_vencimento ?? pp.prazo_pagamento;
                  const chaveDaLinha = parcela?.id ?? pp.id;
                  const valorLinha = parcela
                    ? Number(parcela.valor)
                    : Number(pp.valor);
                  const situacao = situacaoDaVerba(pp);
                  return (
                  <tr
                    key={parcela?.id ?? pp.id}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      pp.status === "cancelada" && "opacity-60",
                    )}
                  >
                    {/* A parcela desce para baixo do código: em linha, ela
                        empurrava a coluna e comia o espaço da origem. */}
                    <td
                      className="px-3.5 py-2.5 align-middle font-mono text-[11.5px] leading-tight"
                      title={`Emitida em ${formatarData(pp.created_at)}${pp.emitida_por_nome ? ` por ${pp.emitida_por_nome}` : ""}`}
                    >
                      {pp.codigo}
                      {total > 1 && (
                        <span className="block text-[10.5px] text-muted-foreground">
                          {indice + 1}/{total}
                        </span>
                      )}
                    </td>

                    {/* De ONDE a PP veio, que é a primeira pergunta de quem
                        abre esta aba (09/09/2026): a linha da planilha em
                        cima, o bloco na etiqueta. Sem isso, duas PPs de
                        "Sacola Personalizada" em blocos diferentes eram
                        indistinguíveis. */}
                    <td className="px-3.5 py-2.5 align-middle">
                      <div className="flex flex-col gap-1">
                        <span className="line-clamp-2 text-[13px] font-semibold leading-snug">
                          {pp.item_nome ?? "—"}
                        </span>
                        {pp.grupo_nome && (
                          // A etiqueta do bloco filtra a Origem por ele
                          // (08/10/2026): o atalho de quem vê o bloco na
                          // linha e quer só as PPs dele.
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                            onClick={() => filtrarPeloBloco(pp.grupo_nome ?? "")}
                                className="inline-flex max-w-full items-center gap-1.5 self-start rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground transition-colors hover:bg-california-red/10 hover:text-california-red"
                              >
                                <Layers className="h-3 w-3 flex-none" />
                                <span className="truncate">{pp.grupo_nome}</span>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Mostrar só as PPs do bloco {pp.grupo_nome}</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    </td>
                    {/* O serviço quebra em até DUAS linhas e para. Em uma
                        linha só ele estica a tabela (`nowrap`) ou vira
                        reticências em quase toda PP; em quantas quiser,
                        a linha cresce a quatro alturas. Duas cobrem as
                        descrições reais e mantêm a grade legível. */}
                    <td className="px-3.5 py-2.5 align-middle">
                      <div className="flex items-start gap-1.5">
                        <span className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-snug">
                          {pp.servico}
                        </span>
                        {/* O cartão é das ESPECIFICAÇÕES (decisão do
                            Tiago, 09/09/2026): a descrição agora se lê na
                            própria coluna, e o campo que não aparecia em
                            lugar nenhum fora do formulário era esse.
                            Sem especificações o ícone fica apagado — é o
                            comportamento nativo do componente. */}
                        <DescritivoPopover
                          rotulo="Especificações da PP"
                          acaoGatilho="Ver as especificações da PP"
                          tituloVazio="Esta PP não tem especificações"
                          codigo={pp.codigo}
                          nome={pp.item_nome}
                          texto={pp.especificacoes}
                          aberto={descritivoAberto === chaveDaLinha}
                          onAbertoChange={(v) =>
                            setDescritivoAberto(v ? chaveDaLinha : null)
                          }
                          rodape={
                            <>
                              <DescritivoRodapeNota
                                icone={<Clock className="h-3 w-3 flex-none" />}
                              >
                                Emitida em {formatarData(pp.created_at)}
                                {pp.emitida_por_nome
                                  ? ` por ${pp.emitida_por_nome}`
                                  : ""}
                              </DescritivoRodapeNota>
                              {total > 1 && (
                                <DescritivoRodapeNota
                                  icone={<Wallet className="h-3 w-3 flex-none" />}
                                >
                                  {formatCurrency(Number(pp.valor), "BRL")} em{" "}
                                  {total}x
                                </DescritivoRodapeNota>
                              )}
                            </>
                          }
                        />
                      </div>
                    </td>
                    {/* Verba de produção não tem fornecedor: em vez do "—"
                        de antes, a coluna diz o que a PP é e para quem
                        vai. */}
                    <td className="px-3.5 py-2.5 align-middle text-[12.5px] text-muted-foreground">
                      {pp.verba_producao ? (
                        <span className="line-clamp-2 leading-snug">
                          <span className="italic">Verba de produção</span>
                          {pp.responsavel?.nome ? ` · ${pp.responsavel.nome}` : ""}
                        </span>
                      ) : (
                        <span className="line-clamp-2 leading-snug">
                          {(pp.fornecedor_id
                            ? fornecedoresPorId[pp.fornecedor_id]
                            : null) ?? "—"}
                          {/* O asterisco da decisão 067: o cadastro mudou
                              de conta depois que esta PP tirou a foto. A
                              PP continua valendo pela foto — o que o
                              asterisco diz é que o cadastro de hoje já não
                              é o que este pedido manda pagar. */}
                          {pp.cadastro_do_fornecedor_mudou && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  tabIndex={0}
                                  className="ml-1 cursor-help font-bold text-amber-600"
                                  aria-label="O cadastro do fornecedor mudou depois desta PP"
                                >
                                  *
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[280px]">
                                Os dados de pagamento do fornecedor mudaram
                                depois desta PP. Ela continua valendo pelos
                                dados que estão no documento dela; o cadastro
                                novo vale para as próximas.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2.5 align-middle font-mono text-xs">
                      {formatarData(vencimento)}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2.5 align-middle">
                      <DtPagamento pp={pp} parcela={parcela} />
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2.5 align-middle text-right font-mono text-[12.5px] font-semibold">
                      {formatCurrency(valorLinha, "BRL")}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle">
                      {/* Verba paga: o chip diz onde a prestação está (081). */}
                      {situacao ? (
                        <SituacaoVerbaChip situacao={situacao} />
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <PPStatusChip status={pp.status} />
                          {/* O gatilho do GP (08/10/2026): o produtor
                              conferiu os documentos e deixou a PP pronta. */}
                          {prontaParaEnvio(pp) && (
                            <span
                                        title={`Pronta para envio${pp.pronta_para_envio_por_nome ? ` · ${pp.pronta_para_envio_por_nome}` : ""}`}
                              className="inline-flex items-center gap-1 whitespace-nowrap text-[10.5px] font-semibold text-amber-800"
                            >
                              <ClipboardCheck className="h-3 w-3" />
                              Pronta para envio
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 align-middle">
                      {/* Ver PDF é de CADA parcela (Tela 2.3): cada uma
                          tem seu documento. Editar é da PP inteira, então
                          só a primeira linha o mostra. */}
                      <div className="flex items-center justify-end gap-1.5">
                        {podeEnviar && pp.status === "rejeitada" && indice === 0 && (
                          <button
                            type="button"
                            onClick={() => setPpRefazendo(pp)}
                            disabled={pending}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-california-red/25 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-california-red hover:bg-california-red/[0.06] disabled:opacity-50"
                          >
                            <Pencil className="h-3 w-3" />
                            Cancelar e refazer
                          </button>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                                        onClick={() => handleVer(pp)}
                              disabled={pending}
                              aria-label={`Visualizar ${pp.codigo} e documentos`}
                              className="inline-flex items-center justify-center rounded-lg border border-border bg-white p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Visualizar {pp.codigo} e documentos
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* A trilha mora fora do frame, igual "Ver PP" / "Gerar PP" da
            Planilha Interna. Desde 08/10/2026 são três colunas de ícones —
            enviar (só o GP, PP gerada com arquivo anexado), ver o
            formulário (toda PP) e cancelar (a PP que ainda dá para
            cancelar) —; "Prestar contas" fica na coluna do cancelar. */}
        <div
          className="absolute left-full ml-2.5"
          style={{ width: larguraTrilha, top: offsetThead }}
        >
          {linhasVisiveis.map(({ pp, parcela }, i) => {
            const pos = linhas[i];
            // Tudo aqui é da PP inteira: só na 1ª linha dela que está na
            // tela — com filtro ou ordem pelo título, a parcela 1 pode ter
            // saído ou ido para baixo. Verba paga nunca é cancelável, então
            // prestar e cancelar não disputam a mesma coluna.
            if (!pos || linhasVisiveis.findIndex((l) => l.pp.id === pp.id) !== i) return null;
            const situacaoDaLinha = situacaoDaVerba(pp);
            const prestar =
              podePrestarContas.includes(pp.id) &&
              verbaAguardaProducao(situacaoDaLinha);
            const cancelar =
              editable &&
              podeCancelarPP(pp.status) &&
              (papelEnviaPP || pp.status === "gerada");
            // O envio é do GP (decisão 136) e precisa de arquivo anexado
            // (pedido do Tiago, 08/10/2026: qualquer arquivo; o tipo e os
            // dados da NF se conferem no pop-up). A verba sai sem nota.
            const enviar =
              editable &&
              papelEnviaPP &&
              pp.status === "gerada" &&
              (pp.verba_producao || (pp.anexos ?? []).length > 0);
            const trava = enviar ? travaDoEnvio(pp) : null;
            const enviarEl = enviar && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* O span segura o tooltip: botão desabilitado não recebe
                      o ponteiro, e o motivo da trava só se lê por ele. */}
                  <span
                    tabIndex={trava ? 0 : -1}
                    className={cn("inline-flex flex-none rounded-[9px]", trava !== null && "cursor-not-allowed")}
                  >
                    <button
                      type="button"
                      onClick={() => setPpEnviando(pp)}
                      disabled={pending || trava !== null}
                      aria-label={`Enviar ${pp.codigo} ao financeiro`}
                      className={cn(
                        "inline-flex flex-none items-center justify-center rounded-[9px] border transition-colors",
                        trava === null
                          ? "border-california-red bg-california-red text-white hover:bg-california-red-hover"
                          : "pointer-events-none border-border bg-muted text-muted-foreground/70",
                        pending && "opacity-60",
                      )}
                      style={{ width: ICONE, height: ICONE }}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px]">
                  {trava ??
                    (prontaParaEnvio(pp)
                      ? `Enviar ${pp.codigo} ao financeiro · pronta para envio${pp.pronta_para_envio_por_nome ? ` por ${pp.pronta_para_envio_por_nome}` : ""}`
                      : `Enviar ${pp.codigo} ao financeiro`)}
                </TooltipContent>
              </Tooltip>
            );
            const formularioEl = (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setPpVendo(pp)}
                    disabled={pending}
                    aria-label={`Ver formulário · ${pp.codigo}`}
                    className="inline-flex flex-none items-center justify-center rounded-[9px] border border-border bg-white text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    style={{ width: ICONE, height: ICONE }}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Ver formulário · {pp.codigo}</TooltipContent>
              </Tooltip>
            );
            const prestarEl = prestar && (
              <button
                type="button"
                onClick={() => setPpPrestando(pp)}
                className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg bg-california-red px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-california-red-hover"
              >
                <Receipt className="h-3.5 w-3.5" />
                {situacaoDaLinha === "prestacao_reprovada" ? "Corrigir prestação" : "Prestar contas"}
              </button>
            );
            const cancelarEl = cancelar && !prestar && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* O mesmo símbolo do "Cancelar PP" do painel do item: lá
                      a lixeira é de excluir a PP a emitir. */}
                  <button
                    type="button"
                    onClick={() => setPpCancelando(pp)}
                    disabled={pending}
                    aria-label={`Cancelar ${pp.codigo}`}
                    className="inline-flex flex-none items-center justify-center rounded-[9px] border border-border bg-white text-california-red transition-colors hover:border-california-red/30 hover:bg-california-red/[0.06] disabled:opacity-50"
                    style={{ width: ICONE, height: ICONE }}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Cancelar {pp.codigo}</TooltipContent>
              </Tooltip>
            );
            return (
              <div
                key={parcela?.id ?? pp.id}
                className="absolute inset-x-0 flex items-center"
                style={{ top: pos.top, height: pos.height, gap: VAO }}
              >
                {/* Só o que vale nesta linha, um colado no outro (pedido do
                    Tiago, 08/10/2026): sem lugar vazio quando a PP não pode
                    ser enviada. */}
                {enviarEl}
                {formularioEl}
                {prestarEl}
                {cancelarEl}
              </div>
            );
          })}
        </div>
      </div>

      {/* O envio, no mesmo pop-up do painel do item — já preenchido com o
          que o produtor conferiu, quando a PP está pronta para envio. */}
      {ppEnviando && (
        <EnvioDialog
          modo="enviar"
          pp={
            {
              id: ppEnviando.id,
              codigo: ppEnviando.codigo,
              estabelecimentoId: ppEnviando.estabelecimento_id ?? null,
              valor: Number(ppEnviando.valor ?? 0),
              servico: ppEnviando.servico,
              fornecedorId: ppEnviando.fornecedor_id ?? null,
              verbaProducao: ppEnviando.verba_producao === true,
              anexos: ppEnviando.anexos ?? [],
              pagaPorBoleto: ppEnviando.pagamento_fora_do_cadastro?.meio === "boleto",
            } satisfies PPParaEnviar
          }
          onOpenChange={(o) => !o && setPpEnviando(null)}
          nomeDoFornecedor={
            (ppEnviando.fornecedor_id
              ? fornecedoresPorId[ppEnviando.fornecedor_id]
              : null) ?? "—"
          }
          nomeDaEmpresa={
            tomadoresDaNf.find((t) => t.id === ppEnviando.estabelecimento_id)
              ?.nome ?? "—"
          }
          tomadores={tomadoresDaNf}
          tomadorEsperado={ppEnviando.estabelecimento_id ?? null}
          tomadorPorEmpresa={tomadorPorEmpresa}
          nomeDaEmpresaDe={nomeDaEmpresa}
          moeda="BRL"
          onEnviada={(codigo) => {
            setPpEnviando(null);
            setToast(`${codigo} enviada ao financeiro.`);
            router.refresh();
          }}
        />
      )}

      {/* O formulário da PP em leitura — a mesma ficha do "Ver formulário"
          do painel do item, com o "Visualizar" lado a lado no rodapé. */}
      <VerPPDrawer
        open={ppVendo !== null}
        onOpenChange={(aberto) => !aberto && setPpVendo(null)}
        pp={ppVendo}
        contraparteNome={
          ppVendo
            ? ppVendo.verba_producao
              ? (ppVendo.responsavel?.nome ?? "—")
              : ((ppVendo.fornecedor_id ? fornecedoresPorId[ppVendo.fornecedor_id] : null) ?? "—")
            : ""
        }
        // Decisão 156: a "Empresa emissora" da PP é o CNPJ dela.
        empresaNome={(() => {
          const t = tomadoresDaNf.find((x) => x.id === ppVendo?.estabelecimento_id);
          if (t) return `${t.nome} · ${t.cnpj}`;
          return ppVendo ? nomeDaEmpresa(ppVendo.empresa_id) : "—";
        })()}
        itemDescricao={ppVendo?.item_nome ?? ""}
        valorPlanejado={ppVendo ? (planejadoPorItem[ppVendo.item_realizado_id] ?? 0) : 0}
        emPPsEmitidas={ppVendo ? emPPsDoItem(ppVendo.item_realizado_id) : 0}
        tomadores={tomadoresDaNf}
        // O produtor cancela só a PP ainda não enviada (decisão 136).
        podeCancelar={editable && (papelEnviaPP || ppVendo?.status === "gerada")}
        onMensagem={setToast}
      />

      {/* A PP ao lado dos documentos, em leitura (o olho). */}
      {visualizando && (
        <PPTela
          somenteLeitura
          pp={visualizando.pp}
          estabelecimentos={visualizando.estabelecimentos}
          open={ladoALadoAberto}
          onOpenChange={setLadoALadoAberto}
        />
      )}

      <ConfirmDialog
        open={ppCancelando !== null}
        onOpenChange={(o) => !o && setPpCancelando(null)}
        title="Cancelar Pedido de Produção?"
        description={
          <>
            <strong className="text-foreground">{ppCancelando?.codigo}</strong>{" "}
            será cancelada e o item volta a permitir a geração de uma nova PP. O
            PDF e os anexos ficam guardados no histórico.
          </>
        }
        confirmLabel="Cancelar PP"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleCancelarConfirm}
      />

      <PrestarContasDrawer
        open={ppPrestando !== null}
        onOpenChange={(o) => !o && setPpPrestando(null)}
        pp={ppPrestando}
        onSuccess={setToast}
      />

      <ConfirmDialog
        open={ppRefazendo !== null}
        onOpenChange={(o) => !o && setPpRefazendo(null)}
        title={`Cancelar a ${ppRefazendo?.codigo ?? "PP"} e refazer?`}
        description={
          <>
            A <strong className="text-foreground">{ppRefazendo?.codigo}</strong> é cancelada e fica no histórico,
            com o motivo da rejeição. Ela volta como PP a emitir no painel do item, com os mesmos dados e anexos,
            para você corrigir e gerar uma PP nova, com outro código.
          </>
        }
        confirmLabel="Cancelar e refazer"
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={() => {
          const alvo = ppRefazendo;
          if (!alvo) return;
          startTransition(async () => {
            const res = await cancelarERefazerPP(alvo.id);
            setPpRefazendo(null);
            if (!res.ok) {
              setErro(res.message);
              return;
            }
            setToast(
              `${res.codigo} cancelada. A PP a emitir voltou no painel do item${alvo.item_nome ? ` “${alvo.item_nome}”` : ""}, na Planilha Interna.`,
            );
            router.refresh();
          });
        }}
      />

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <span className="text-sm font-medium text-emerald-800">{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="text-emerald-700 hover:text-emerald-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function CardResumo({
  rotulo,
  valor,
  cor,
  mono,
  detalhe,
}: {
  rotulo: string;
  valor: string;
  cor?: string;
  mono?: boolean;
  /** Linha curta embaixo do número, em vermelho — é pendência. */
  detalhe?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3.5 shadow-soft">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {rotulo}
      </span>
      <strong
        className={cn("text-[22px] font-bold", mono && "font-mono text-lg", cor)}
      >
        {valor}
      </strong>
      {detalhe && (
        <span className="text-[11px] font-semibold text-california-red">
          {detalhe}
        </span>
      )}
    </div>
  );
}
