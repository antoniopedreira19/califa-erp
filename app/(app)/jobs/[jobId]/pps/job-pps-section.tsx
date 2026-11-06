"use client";

import type { ComiteDaPP, PedidoDoComite } from "@/lib/data/comite";
import { cancelarEnvioAoComite } from "@/app/(app)/comite/actions";
import { SolicitarAprovacaoDialog, linhasDoMotivoDaPP } from "@/app/(app)/comite/_componentes/motivo-do-caso";
import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Search,
  Eye,
  Download,
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
  Gavel,
  Undo2,
  FilePlus,
  Trash2,
  ChevronRight,
} from "lucide-react";
import {
  DescritivoPopover,
  DescritivoRodapeNota,
} from "@/components/ui/descritivo-popover";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import {
  nomeDeQuemRecebeAVerba,
  nomeDoCartaoCorporativo,
  podeCancelarPP,
  ppStatusLabel,
  rotuloDaVerbaMinusculo,
  situacaoVerbaLabel,
  tipoDaVerba,
  type PedidoCompraNaLista,
  type PedidoCompraParcela,
  type PPStatus,
  type Empresa,
  type JobStatus,
  type PPAEmitir,
  situacaoDaVerba,
  verbaAguardaProducao,
  meioPeloAnexo,
} from "@/lib/types";
import {
  cancelarERefazerPP,
  cancelarPedidoCompra,
  gerarPPDaPPAEmitir,
  excluirPPAEmitir,
  solicitarAprovacaoDaPP,
  signedUrlPdf,
} from "../realizado/actions-pp";
import { baixarArquivo } from "@/components/documentos/painel-documento";
import { nomeDoArquivoDaPP, quemVaiNoNomeDoArquivo } from "@/lib/nome-do-arquivo-da-pp";
import {
  EnvioDialog,
  RevisaoDialog,
  SeloPPAEmitir,
  TextoDoReemitir,
  TOAST_DO_REEMITIR,
  textoAguardaAbertura,
  type PPParaEnviar,
} from "../realizado/pp-a-emitir-ui";
import { GerarPPDrawer } from "../realizado/gerar-pp-drawer";
import type { TomadorDaNf } from "../realizado/anexos-da-pp";
import { prazoDeEnvioPerdido, useFeriadosNacionais } from "../realizado/prazo-de-envio-pp";
import { hojeEmSaoPauloIso, isoParaBr } from "@/lib/calculos/janelas-pagamento";
import type { PPRow } from "@/app/(app)/financeiro/contas-a-pagar/pedidos-compra-list";
import type { EstabelecimentoDaNota } from "@/app/(app)/financeiro/contas-a-pagar/pp-dossie";
import { carregarPPParaVisualizar } from "./actions-visualizar";
import { VerPPDrawer } from "./ver-pp-drawer";
import { PPStatusChip } from "./pp-status-chip";
import {
  BarraDosFiltrosDeColuna,
  FILTRO_VAZIO,
  celulaData,
  marcaDoGrupo,
  useFiltrosDeColuna,
  type CelulaDaColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import { PrestarContasDrawer } from "./prestar-contas-drawer";
import { MarcaMidiaNaPP } from "../../_midia-system/midia-system";
import {
  envioDispensaNf,
  midiaAguardaProducao,
  situacaoMidiaDaPP,
  type MidiaSystemDoJob,
} from "@/lib/calculos/midia-system";
import {
  producaoEditaPrestacao,
  rotuloDoBotaoDaPrestacao,
} from "@/lib/calculos/prestacao-da-verba";
import { SituacaoVerbaChip } from "@/components/financeiro/situacao-verba-chip";
import { formatDataAsHoraBr, formatDiaBr } from "@/lib/formatar-data-hora";

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
  /** PPs de verba em que quem está logado presta contas (decisões 081,
   *  164 e 171): administrador, GP, produtor ou freela do job, e o
   *  responsável da verba de produção anterior à 171. */
  podePrestarContas: string[];
  /** O status do job: a porta do envio que não é do papel, na mesma frase
   *  do painel do item. O PAPEL vem de `papelEnviaPP`. A errata não trava
   *  mais o envio (decisão 238). */
  statusDoJob: JobStatus;
  /** O que o pop-up de envio precisa — o mesmo que o painel do item recebe
   *  (decisões 152 e 156). */
  tomadoresDaNf: TomadorDaNf[];
  tomadorPorEmpresa: Record<string, string>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia">>;
  /** O PLANEJADO de cada linha, pelo id da âncora do realizado: o cartão do
   *  topo do "Ver formulário", como no painel do item. */
  planejadoPorItem: Record<string, number>;
  /** Decisão 173: a PP gerada se edita também pela aba, no MESMO formulário
   *  do painel do item. Null = sem edição (quem só lê usa a ficha). */
  edicaoDaPP: EdicaoDaPPNaAba | null;
  /** Decisão 216: o job Mídia System. Na auditoria a PP vai sem NF; depois
   *  da liberação, a que foi sem nota presta contas dela. `null` = o job
   *  não é Mídia System. */
  midiaSystem: MidiaSystemDoJob | null;
  /** Decisão 242: as PPs a emitir que foram ao Comitê — o último
   *  pedido de cada uma, menos os cancelados. Aparecem na aba até virarem
   *  PP (aprovadas e geradas) ou até o envio ser cancelado. */
  noComite: PPNoComite[];
}

/** A PP a emitir diante do Comitê, como a aba PPs a mostra. */
export interface PPNoComite {
  aEmitir: PPAEmitir;
  pedido: PedidoDoComite;
  itemNome: string;
  grupoNome: string | null;
  /** Aprovada, mas editada depois para mais que o valor aprovado: volta a
   *  precisar do Comitê (como o cartão do painel do item avisa). */
  acimaDoAprovado: boolean;
}

/** O que o formulário da PP precisa e a aba não tinha (decisão 173). */
export interface EdicaoDaPPNaAba {
  /** Comitê de Aprovações (decisão 223). */
  comiteDaPP: ComiteDaPP;
  jobId: string;
  jobEmpresaId: string;
  fornecedores: Array<{ id: string; nome: string; razao_social: string | null; cpf_cnpj?: string | null }>;
  empresas: Array<{ id: string; razao_social: string; nome_fantasia: string | null; principal: boolean }>;
  podeCadastrarFornecedor: boolean;
  podeEditarFornecedor: boolean;
  cnpjPadraoDaPP: string | null;
  /** Cada linha, pelo id da âncora do realizado: o nome, o planejado e a
   *  conta dele, e se o item já está marcado como "todas as PPs geradas". */
  itens: Record<
    string,
    { nome: string; orcado: number; linhaVermelha: boolean; realizado: number; planejado: number; unitario: number; quantidade: number; diasMeses: number; concluido: boolean }
  >;
  /** As PPs a emitir que reemitem uma rejeitada (revisão da 153,
   *  19/10/2026): o "Reemitir PP" da aba abre o formulário nelas, e a
   *  revisão antes de gerar também é daqui — sem levar a pessoa à
   *  Planilha Interna. */
  aEmitirReemitidas: PPAEmitir[];
}

/** "aguardando_prestacao" junta verba sem prestação e prestação reprovada:
 *  nos dois casos a próxima ação é da produção (decisão 081, 4a). */
type Filtro = "todas" | PPStatus | "aguardando_prestacao" | "comite";

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
  { key: "comite", label: "Comitê" },
  // Decisão 242: "Pronta para envio" é uma Gerada — sai dos filtros e
  // fica só a marca na linha, embaixo do selo.
  { key: "gerada", label: "Gerada" },
  { key: "em_avaliacao", label: "Em avaliação" },
  { key: "pago", label: "Pago" },
  // Decisão 242: o nome da ação que a produção faz.
  { key: "aguardando_prestacao", label: "Prestar contas" },
  { key: "rejeitada", label: "Rejeitado" },
  { key: "cancelada", label: "Cancelada" },
];

/**
 * A trilha fora do frame da tabela (decisão 160): até três botões só de
 * ícone — enviar ao financeiro, ver o formulário e cancelar —, só os que
 * valem na linha, um colado no outro (sem lugar vazio, pedido do Tiago).
 * "Prestar contas" segue com texto, no lugar do cancelar (verba paga nunca
 * é cancelável), e a trilha só se alarga quando há verba esperando prestação.
 * O "Reemitir PP" da rejeitada (decisão 153; "Cancelar e refazer" até
 * 19/10/2026) também é ícone, entre o formulário e o cancelar: a rejeitada
 * não envia nem edita, então os três cabem na largura de sempre
 * (17/10/2026).
 */
const ICONE = 29;
const VAO = 6;
const LARGURA_TRILHA_ICONES = ICONE * 3 + VAO * 2;
// "Continuar prestação" é o botão mais largo da trilha (decisão 189): 149 px
// medidos. Ele divide a linha só com o formulário — com o cancelar junto
// (verba ainda em avaliação), vira ícone.
const LARGURA_TRILHA_PRESTACAO = ICONE + VAO + 150;
/** O quanto a trilha pode avançar sobre o respiro lateral da página. */
const AVANCO_NA_MARGEM = 30;

/** O selo da coluna Status pode ir a duas linhas (16/10/2026). O canto de
 *  11 px é a pílula de sempre numa linha (21 px de altura) e um retângulo
 *  arredondado em duas — `rounded-full` viraria uma cápsula. Alinhado à
 *  esquerda desde 19/10/2026 (comentário do Tiago no protótipo da
 *  prestação, decisão 189): todo texto da coluna começa no mesmo ponto. */
const SELO_QUE_QUEBRA = "whitespace-normal rounded-[11px] text-left";

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

/** O fornecedor da PP comum, ou "Cartão corporativo — plataforma" (decisão
 *  209), que não tem fornecedor. */
function nomeDoFornecedorDaPP(
  pp: PedidoCompraNaLista,
  fornecedoresPorId: Record<string, string>,
): string | null {
  if (pp.cartao_corporativo) return nomeDoCartaoCorporativo(pp.cartao_plataforma);
  return pp.fornecedor_id ? (fornecedoresPorId[pp.fornecedor_id] ?? null) : null;
}

/** A linha da tabela de uma PP a emitir no Comitê: o formato da PP, com o
 *  que a PP a emitir tem (sem código, sem pagamento). */
function linhaDaPPNoComite(c: PPNoComite): PedidoCompraNaLista {
  const a = c.aEmitir;
  const parcelas = a.dados.parcelas ?? [];
  return {
    id: `comite-${a.id}`,
    codigo: "PP a emitir",
    item_realizado_id: a.item_realizado_id,
    job_id: a.job_id,
    fornecedor_id: a.fornecedor_id,
    empresa_id: a.empresa_id,
    estabelecimento_id: a.dados.estabelecimento_id ?? null,
    servico: a.servico,
    especificacoes: a.dados.especificacoes ?? null,
    valor: a.valor,
    valor_unitario: a.dados.valor_unitario,
    quantidade: a.dados.quantidade,
    dias_meses: a.dados.dias_meses,
    prazo_pagamento: parcelas[0]?.data_vencimento ?? a.dados.prazo_pagamento,
    status: "gerada",
    verba_producao: a.verba_producao,
    tipo_verba: a.tipo_verba,
    verba_titular_tipo: a.verba_titular_tipo,
    verba_titular_nome: a.verba_titular_nome,
    cartao_corporativo: a.cartao_corporativo,
    cartao_plataforma: a.cartao_plataforma,
    pago_em: null,
    prazo_pagamento_financeiro: null,
    pronta_para_envio_em: null,
    created_at: a.created_at,
    updated_at: a.updated_at,
    emitida_por_nome: a.criada_por_nome,
    item_nome: c.itemNome,
    grupo_nome: c.grupoNome,
    parcelas: parcelas.map((p, i) => ({
      id: `comite-${a.id}-${i + 1}`,
      numero: i + 1,
      valor: p.valor,
      percentual: 0,
      data_vencimento: p.data_vencimento,
      data_pagamento: null,
      pago_em: null,
    })),
    anexos: [],
    prestacao: null,
    devolucao: null,
    eventos: [],
  } as unknown as PedidoCompraNaLista;
}

const ROTULO_DO_COMITE: Record<PedidoDoComite["status"], string> = {
  pendente: "Em avaliação no Comitê",
  devolvido: "Devolvida pelo Comitê",
  aprovado: "Aprovada pelo Comitê",
  cancelado: "Envio cancelado",
};

const COR_DO_COMITE: Record<PedidoDoComite["status"], string> = {
  pendente: "border-[#fde68a] bg-[#fffbeb] text-[#92400e]",
  devolvido: "border-red-200 bg-red-50 text-red-700",
  aprovado: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelado: "border-border bg-muted text-muted-foreground",
};

/** O selo da coluna Status para a PP a emitir no Comitê, no desenho do
 *  PPStatusChip; a dica diz quem enviou, quando, o motivo e a resposta. */
function SeloDoComite({
  pedido,
  acimaDoAprovado,
  className,
}: {
  pedido: PedidoDoComite;
  acimaDoAprovado: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex flex-col items-start gap-1">
          <span
            tabIndex={0}
            className={cn(
              "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              COR_DO_COMITE[pedido.status],
              className,
            )}
          >
            {ROTULO_DO_COMITE[pedido.status]}
          </span>
          <span
            className={cn(
              "text-[10.5px]",
              acimaDoAprovado ? "font-semibold text-california-red" : "text-muted-foreground",
            )}
          >
            {pedido.status === "pendente"
              ? `desde ${formatDiaBr(pedido.enviadoEm)}`
              : acimaDoAprovado
                ? "acima do aprovado"
                : pedido.status === "aprovado"
                  ? "pronta para gerar"
                  : "corrigir e reenviar"}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[320px] space-y-1 text-left">
        <p>
          Enviada por {pedido.enviadoPor} em {formatDataAsHoraBr(pedido.enviadoEm)}.
        </p>
        <p className="text-muted-foreground">Motivo: “{pedido.motivo}”</p>
        {pedido.decididoPor && (
          <p>
            {pedido.status === "devolvido" ? "Devolvida" : "Aprovada"} por {pedido.decididoPor} em{" "}
            {formatDataAsHoraBr(pedido.decididoEm)}
            {pedido.comentario ? `: “${pedido.comentario}”` : "."}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Decisão 241: o arquivo sai com o número e quem a PP paga. */
function nomeDoArquivoDaLinha(pp: PedidoCompraNaLista, fornecedoresPorId: Record<string, string>): string {
  return nomeDoArquivoDaPP(
    pp.codigo,
    quemVaiNoNomeDoArquivo({ ...pp, fornecedor_nome: nomeDoFornecedorDaPP(pp, fornecedoresPorId) }),
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
  tomadoresDaNf,
  tomadorPorEmpresa,
  empresas,
  planejadoPorItem,
  edicaoDaPP,
  midiaSystem,
  noComite,
}: Props) {
  const router = useRouter();
  /** Decisão 242: as linhas das PPs a emitir no Comitê, pelo id da linha. */
  const comiteDaLinha = React.useMemo(
    () => new Map(noComite.map((c) => [`comite-${c.aEmitir.id}`, c])),
    [noComite],
  );
  const ppsDoComite = React.useMemo(() => noComite.map(linhaDaPPNoComite), [noComite]);
  // As PPs a emitir do Comitê vêm em cima: são as que pedem resposta.
  const linhasDaTabela = React.useMemo(
    () => [...ppsDoComite, ...pps],
    [pps, ppsDoComite],
  );
  const [pending, startTransition] = React.useTransition();
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [busca, setBusca] = React.useState("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  /** A rejeitada que vai ser reemitida (decisão 153): ela não se edita,
   *  é cancelada e volta como PP a emitir, com os mesmos dados. */
  const [ppRefazendo, setPpRefazendo] = React.useState<PedidoCompraNaLista | null>(
    null,
  );
  /** Revisão da 153 (19/10/2026): o formulário abre aqui, na PP a emitir
   *  que o "Reemitir PP" devolveu, assim que ela chega pelo refresh — como
   *  no painel do item. Antes a aba só avisava onde ela tinha ido parar. */
  const [aEmitirEditando, setAEmitirEditando] = React.useState<PPAEmitir | null>(null);
  const [abrirQuandoChegar, setAbrirQuandoChegar] = React.useState<string | null>(null);
  /** O "Gerar PP" do formulário: a revisão abre quando a PP a emitir
   *  salva chega pelo refresh. Ela já estava na lista antes de salvar:
   *  `depoisDe` é o `updated_at` de antes, para a revisão não abrir com a
   *  versão velha (que nem tinha a resposta da "última PP"). */
  const [revisarQuandoChegar, setRevisarQuandoChegar] = React.useState<{
    id: string;
    depoisDe: string | null;
  } | null>(null);
  const [revisando, setRevisando] = React.useState<PPAEmitir | null>(null);
  const [erroDaRevisao, setErroDaRevisao] = React.useState<string | null>(null);
  const aEmitirReemitidas = edicaoDaPP?.aEmitirReemitidas;
  React.useEffect(() => {
    if (!abrirQuandoChegar || !aEmitirReemitidas) return;
    const alvo = aEmitirReemitidas.find((a) => a.id === abrirQuandoChegar);
    if (!alvo) return;
    setAbrirQuandoChegar(null);
    setPpEditando(null);
    setAEmitirEditando(alvo);
  }, [abrirQuandoChegar, aEmitirReemitidas]);
  React.useEffect(() => {
    if (!revisarQuandoChegar || !aEmitirReemitidas) return;
    const alvo = aEmitirReemitidas.find((a) => a.id === revisarQuandoChegar.id);
    if (!alvo || alvo.updated_at === revisarQuandoChegar.depoisDe) return;
    setRevisarQuandoChegar(null);
    setErroDaRevisao(null);
    setRevisando(alvo);
  }, [revisarQuandoChegar, aEmitirReemitidas]);
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
  /** Decisão 173: a PP gerada aberta no formulário, para editar no lugar. */
  const [ppEditando, setPpEditando] = React.useState<PedidoCompraNaLista | null>(null);
  /** A PP ao lado dos documentos (o olho). */
  const [visualizando, setVisualizando] = React.useState<{
    pp: PPRow;
    estabelecimentos: EstabelecimentoDaNota[];
  } | null>(null);
  const [ladoALadoAberto, setLadoALadoAberto] = React.useState(false);
  const feriados = useFeriadosNacionais();
  const hoje = hojeEmSaoPauloIso();
  // As portas do envio que não são do papel, nas mesmas frases do painel do
  // item (`envioBloqueadoPor` de job-item-realizado-table.tsx). A revisão
  // da abertura é por linha (decisão 185), em `travaDoEnvio`.
  const envioBloqueadoPor = textoAguardaAbertura(statusDoJob);
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

  /** Se a PP entra no filtro — a mesma conta da lista e do número ao lado
   *  do nome do filtro (decisão 242). */
  function passaNoFiltro(pp: PedidoCompraNaLista, f: Filtro): boolean {
    const doComite = comiteDaLinha.has(pp.id);
    if (f === "todas") return true;
    if (f === "comite") return doComite;
    if (doComite) return false;
    const aguardaProducao =
      verbaAguardaProducao(situacaoDaVerba(pp)) || midiaAguardaProducao(situacaoMidiaDaPP(pp, midiaSystem));
    if (f === "aguardando_prestacao") return aguardaProducao;
    return pp.status === f;
  }
  const quantas = (f: Filtro) => linhasDaTabela.filter((pp) => passaNoFiltro(pp, f)).length;

  const visiveis = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return linhasDaTabela.filter((pp) => {
      if (!passaNoFiltro(pp, filtro)) return false;
      if (!termo) return true;
      const fornecedor = nomeDoFornecedorDaPP(pp, fornecedoresPorId) ?? "";
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
  }, [linhasDaTabela, filtro, busca, fornecedoresPorId, midiaSystem, comiteDaLinha]);

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
          // Decisão 164: o tipo da verba e quem a recebe.
          const tipo = tipoDaVerba(pp);
          const quem = nomeDeQuemRecebeAVerba(pp);
          const nome = tipo
            ? `${rotuloDaVerbaMinusculo(tipo).replace(/^./, (c) => c.toUpperCase())}${quem ? ` · ${quem}` : ""}`
            : (nomeDoFornecedorDaPP(pp, fornecedoresPorId) ?? "—");
          return { valor: nome, rotulo: nome, ordem: nome };
        }
        case "vencimento": {
          // Árvore mês ▸ dia, como nas outras listas (decisão 165).
          return celulaData(parcela?.data_vencimento ?? pp.prazo_pagamento);
        }
        case "pagamento": {
          // A mesma regra da célula `DtPagamento`.
          const paga = parcela ? parcela.pago_em : pp.pago_em;
          const programada = parcela ? parcela.data_pagamento : pp.prazo_pagamento_financeiro;
          if (paga) return celulaData(paga, "paga");
          if (programada && (pp.status === "aprovada" || pp.status === "pago")) {
            return celulaData(programada, "programada");
          }
          return celulaData(null);
        }
        case "valor": {
          const v = parcela ? Number(parcela.valor) : Number(pp.valor);
          return { valor: String(Math.round(v * 100)), rotulo: formatCurrency(v, "BRL"), ordem: v };
        }
        case "status": {
          const doComite = comiteDaLinha.get(pp.id);
          if (doComite) {
            const rotulo = ROTULO_DO_COMITE[doComite.pedido.status];
            return { valor: rotulo, rotulo, ordem: rotulo };
          }
          const situacao = situacaoDaVerba(pp);
          const rotulo = situacao ? situacaoVerbaLabel(situacao) : ppStatusLabel(pp.status);
          return { valor: rotulo, rotulo, ordem: rotulo };
        }
      }
    },
    [fornecedoresPorId, comiteDaLinha],
  );

  /** As colunas do funil, pela mesma conta das células. Desde a decisão
   *  165 o filtro é o gancho comum das listas: guarda a intenção ("só
   *  estes" ou "todos menos estes") e fica guardado na aba do navegador,
   *  por job. */
  const COLUNAS_PPS = React.useMemo<ColunaFiltravel<LinhaPP>[]>(
    () => [
      { chave: "codigo", rotulo: "Código", tipo: "texto", celula: (l) => celula(l, "codigo") },
      { chave: "origem", rotulo: "Origem no job", tipo: "texto", celula: (l) => celula(l, "origem") },
      { chave: "servico", rotulo: "Serviço", tipo: "texto", celula: (l) => celula(l, "servico") },
      { chave: "fornecedor", rotulo: "Fornecedor", tipo: "texto", celula: (l) => celula(l, "fornecedor") },
      { chave: "vencimento", rotulo: "Vencimento", tipo: "data", celula: (l) => celula(l, "vencimento") },
      { chave: "pagamento", rotulo: "Dt. Pagamento", tipo: "data", celula: (l) => celula(l, "pagamento") },
      {
        chave: "valor",
        rotulo: "Valor",
        tipo: "valor",
        faixa: true,
        alinhar: "right",
        celula: (l) => celula(l, "valor"),
      },
      { chave: "status", rotulo: "Status", tipo: "texto", celula: (l) => celula(l, "status") },
    ],
    [celula],
  );
  const colunas = useFiltrosDeColuna(linhasBase, COLUNAS_PPS, {
    guardarEm: "job-pps",
    contexto: pps[0]?.job_id ?? "",
  });
  /** As linhas da tabela: os filtros de todas as colunas e a ordem do
   *  título. Sem ordem, a de sempre (a PP mais nova em cima). */
  const linhasVisiveis = colunas.visiveis;

  /** A etiqueta do bloco, clicada: a Origem passa a mostrar só os itens
   *  daquele bloco. */
  function filtrarPeloBloco(bloco: string) {
    // O bloco inteiro (decisão 165): PP nova de um item dele também entra.
    colunas.definir("origem", { ...FILTRO_VAZIO, marcados: [marcaDoGrupo(bloco)] });
  }

  const algumFiltroDeColuna = colunas.ativo;

  /** O título que filtra e ordena. */
  function titulo(coluna: Coluna) {
    return colunas.titulo(coluna);
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

  /** Decisão 241: baixar a PP direto da linha, com o número e o fornecedor
   *  no nome do arquivo. O PDF é um só para todas as parcelas (112). */
  function handleBaixar(pp: PedidoCompraNaLista) {
    startTransition(async () => {
      const res = await signedUrlPdf(pp.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      try {
        await baixarArquivo(res.url, nomeDoArquivoDaLinha(pp, fornecedoresPorId));
      } catch {
        setErro("Não foi possível baixar o arquivo. Tente de novo.");
      }
    });
  }

  /**
   * Por que ESTA PP não pode ser enviada agora, na ordem do painel do item:
   * o job (pré-abertura) e o prazo de envio do vencimento (decisão 157).
   * A errata não trava mais (decisão 238). O papel nem chega
   * aqui: o botão só existe para quem envia. Nulo: o botão vale.
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

  /** Decisão 242: o "Cancelar envio" do painel do item, também pela aba. */
  function handleCancelarEnvio(c: PPNoComite) {
    startTransition(async () => {
      const res = await cancelarEnvioAoComite(c.pedido.id);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setToast(`Envio ao Comitê cancelado. A PP a emitir continua no painel do item “${c.itemNome}”.`);
      router.refresh();
    });
  }
  /** Decisão 242: as ações do cartão da PP a emitir (painel do item), também
   *  pela aba — solicitar de novo a devolvida e excluir. */
  const [pedindoComite, setPedindoComite] = React.useState<PPNoComite | null>(null);
  const [excluindoAEmitir, setExcluindoAEmitir] = React.useState<PPNoComite | null>(null);
  async function solicitarComite(motivo: string): Promise<string | null> {
    if (!pedindoComite) return null;
    const res = await solicitarAprovacaoDaPP(pedindoComite.aEmitir.id, motivo);
    if (!res.ok) return res.message;
    setPedindoComite(null);
    setToast("Aprovação da PP solicitada ao Comitê.");
    router.refresh();
    return null;
  }
  function excluirAEmitir() {
    const alvo = excluindoAEmitir;
    if (!alvo) return;
    startTransition(async () => {
      const res = await excluirPPAEmitir(alvo.aEmitir.id);
      setExcluindoAEmitir(null);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setToast("PP a emitir excluída.");
      router.refresh();
    });
  }
  const acoesDoComite = {
    trava: textoAguardaAbertura(statusDoJob),
    pending,
    onCancelarEnvio: handleCancelarEnvio,
    onEditar: (c: PPNoComite) => {
      setPpEditando(null);
      setAEmitirEditando(c.aEmitir);
    },
    onGerar: (c: PPNoComite) => {
      setErroDaRevisao(null);
      setRevisando(c.aEmitir);
    },
    onSolicitar: (c: PPNoComite) => setPedindoComite(c),
    onExcluir: (c: PPNoComite) => setExcluindoAEmitir(c),
  };

  // Decisão 242: o total do que o filtro mostra: as PPs vivas; com o filtro do
  // Comitê, as PPs a emitir dele.
  const totalDaSelecao = (() => {
    const soComite = filtro === "comite";
    const ids = new Set<string>();
    let valor = 0;
    for (const l of linhasVisiveis) {
      const doComite = comiteDaLinha.has(l.pp.id);
      if (doComite !== soComite) continue;
      if (l.pp.status === "cancelada") continue;
      ids.add(l.pp.id);
      valor += l.parcela ? Number(l.parcela.valor) : Number(l.pp.valor);
    }
    return { quantas: ids.size, valor, soComite };
  })();

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

  if (pps.length === 0 && noComite.length === 0) {
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
      <div className="flex flex-wrap items-center gap-2">
        <BarraDeFiltros
          itens={CHIPS.map((c) => ({
            ...c,
            n: quantas(c.key),
            alerta: c.key === "comite" && noComite.some((x) => x.pedido.status === "pendente"),
          }))}
          filtro={filtro}
          onFiltro={setFiltro}
        />
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
        <BarraDosFiltrosDeColuna
          visiveis={linhasVisiveis.length}
          total={linhasBase.length}
          singular="linha"
          plural="linhas"
          onLimpar={colunas.limpar}
        />
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
                das planilhas (docs/09-identidade-visual-ui.md).

                Status, Valor e o olho cresceram em 16/10/2026: a 1440 px,
                com a calha alargada pelo "Prestar contas", a tabela fica
                em ~1120 px, e o olho (28 px numa coluna de 11 úteis)
                cobria o fim do selo, enquanto um valor de seis dígitos
                transbordava por cima do começo dele. As larguras saíram
                das três colunas de texto, que quebram em duas linhas. */}
            <table className="w-full min-w-[980px] table-fixed border-collapse text-[13px]">
              {/* Desde 19/10/2026 (decisão 189), as colunas de conteúdo curto
                  têm largura FIXA, medida no conteúdo a 100%: o selo mais
                  largo em duas linhas (104 px), o valor de sete dígitos
                  (116 px), o título "Dt. Pagamento" com a seta (106 px),
                  mais o recuo. Origem, Serviço e Fornecedor dividem o
                  resto. Com porcentagens, a coluna Status sobrava vazia. */}
              <colgroup>
                <col className="w-[92px]" />
                <col />
                <col />
                <col />
                <col className="w-[108px]" />
                <col className="w-[134px]" />
                <col className="w-[144px]" />
                <col className="w-[136px]" />
                <col className="w-[82px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-3.5 py-2.5 text-left">{titulo("codigo")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("origem")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("servico")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("fornecedor")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("vencimento")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("pagamento")}</th>
                  <th className="px-3.5 py-2.5 text-right">{titulo("valor")}</th>
                  <th className="px-3.5 py-2.5 text-left">{titulo("status")}</th>
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
                  const doComite = comiteDaLinha.get(pp.id) ?? null;
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
                      title={`${doComite ? "Criada" : "Emitida"} em ${formatDiaBr(pp.created_at)}${pp.emitida_por_nome ? ` por ${pp.emitida_por_nome}` : ""}`}
                    >
                      {doComite ? <SeloPPAEmitir refaz={null} /> : pp.codigo}
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
                                {doComite ? "Criada" : "Emitida"} em {formatDiaBr(pp.created_at)}
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
                          <span className="italic">
                            {rotuloDaVerbaMinusculo(tipoDaVerba(pp) ?? "producao").replace(/^./, (c) => c.toUpperCase())}
                          </span>
                          {nomeDeQuemRecebeAVerba(pp) ? ` · ${nomeDeQuemRecebeAVerba(pp)}` : ""}
                        </span>
                      ) : (
                        <span className="line-clamp-2 leading-snug">
                          {nomeDoFornecedorDaPP(pp, fornecedoresPorId) ?? "—"}
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
                      {/* Verba paga: o chip diz onde a prestação está (081).
                          O selo quebra linha dentro da coluna em vez de
                          passar por baixo do olho (16/10/2026): os da verba
                          medem até 170 px, e a coluna tem de 106 a 118 úteis a
                          1440 px. Numa linha só ele segue igual à pílula. */}
                      {doComite ? (
                        <SeloDoComite pedido={doComite.pedido} acimaDoAprovado={doComite.acimaDoAprovado} className={SELO_QUE_QUEBRA} />
                      ) : situacao ? (
                        <SituacaoVerbaChip situacao={situacao} className={SELO_QUE_QUEBRA} duasLinhas />
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <PPStatusChip status={pp.status} className={SELO_QUE_QUEBRA} />
                          {/* Decisão 216: foi sem NF na auditoria da Mídia
                              System, e onde a prestação da nota está. */}
                          <MarcaMidiaNaPP situacao={situacaoMidiaDaPP(pp, midiaSystem)} />
                          {/* O gatilho do GP (08/10/2026): o produtor
                              conferiu os documentos e deixou a PP pronta. */}
                          {prontaParaEnvio(pp) && (
                            <span
                                        title={`Pronta para envio${pp.pronta_para_envio_por_nome ? ` · ${pp.pronta_para_envio_por_nome}` : ""}`}
                              // Decisão 242: o vermelho do avião de enviar;
                              // o âmbar agora é do Comitê.
                              className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-california-red"
                            >
                              <ClipboardCheck className="h-3 w-3 flex-none" />
                              Pronta para envio
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    {/* Sem recuo à esquerda: o do Status já separa, e o
                        olho cabe inteiro na coluna a partir de ~1050 px de
                        tabela. */}
                    <td className="py-2.5 pl-0 pr-3.5 align-middle">
                      {/* Decisão 241: o baixar mora ao lado do olho — os dois são do
                          documento —, e a coluna passou de 46 para 82 px.
                          Ver PDF é de CADA parcela (Tela 2.3): cada uma
                          tem seu documento. O "Cancelar e refazer" morava
                          aqui e, com 138 px numa coluna de 45 a 61, cobria
                          o selo "Rejeitado"; foi para a trilha (17/10/2026). */}
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Decisão 242: a PP a emitir não tem documento
                            ainda — o olho e o baixar ficam de fora, e as
                            ações dela vão para a trilha. */}
                        {doComite ? null : (
                        <>
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => handleBaixar(pp)}
                              disabled={pending}
                              aria-label={`Baixar ${pp.codigo}`}
                              className="inline-flex items-center justify-center rounded-lg border border-border bg-white p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-50"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Baixar {nomeDoArquivoDaLinha(pp, fornecedoresPorId)}
                          </TooltipContent>
                        </Tooltip>
                        </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
              {/* Decisão 242: o "Total em PPs" do cartão vira o rodapé da tabela
                  e acompanha os filtros (o do chip e os dos títulos). */}
              {linhasVisiveis.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-muted/40">
                    <td colSpan={6} className="px-3.5 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Total · {totalDaSelecao.quantas}{" "}
                      {totalDaSelecao.soComite
                        ? totalDaSelecao.quantas === 1 ? "PP a emitir" : "PPs a emitir"
                        : totalDaSelecao.quantas === 1 ? "PP" : "PPs"}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-2.5 text-right font-mono text-[12.5px] font-bold">
                      {formatCurrency(totalDaSelecao.valor, "BRL")}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* A trilha mora fora do frame, igual "Ver PP" / "Gerar PP" da
            Planilha Interna. Desde 08/10/2026 são três colunas de ícones —
            enviar (só o GP, toda PP gerada), ver o
            formulário (toda PP) e cancelar (a PP que ainda dá para
            cancelar) —; "Prestar contas" fica na coluna do cancelar, e o
            "Reemitir PP" da rejeitada entre o formulário e ele. */}
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
            const doComite = comiteDaLinha.get(pp.id);
            if (doComite) {
              return (
                <div
                  key={parcela?.id ?? pp.id}
                  className="absolute inset-x-0 flex items-center"
                  style={{ top: pos.top, height: pos.height, gap: VAO }}
                >
                  {editable && <AcoesDoComite c={doComite} {...acoesDoComite} />}
                </div>
              );
            }
            // Decisão 189: a prestação abre desde o envio da PP ao
            // financeiro (os documentos ficam salvos), não só com a verba
            // paga; e volta a abrir quando o financeiro reprova.
            // Decisão 216: a PP que foi sem NF presta contas da nota com o
            // MESMO botão e a mesma gaveta, depois da liberação das NFs.
            const prestar =
              podePrestarContas.includes(pp.id) &&
              (producaoEditaPrestacao(pp) || midiaAguardaProducao(situacaoMidiaDaPP(pp, midiaSystem)));
            const cancelar =
              editable &&
              podeCancelarPP(pp.status) &&
              (papelEnviaPP || pp.status === "gerada");
            // O envio é do GP (decisão 136), em toda PP gerada. Até
            // 22/10/2026 só aparecia com arquivo anexado (decisão 160 §4);
            // agora a nota entra no pop-up, como no painel do item (decisão
            // 152), e o servidor segue exigindo a NF. A verba sai sem nota.
            const enviar = editable && papelEnviaPP && pp.status === "gerada";
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
            // Decisão 173: antes do envio, só editar; depois, só ver — nunca
            // os dois (Tiago, 14/10/2026). Quem não edita fica com a ficha.
            const editarEl = pp.status === "gerada" && editable && edicaoDaPP && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={() => setPpEditando(pp)}
                      disabled={pending || textoAguardaAbertura(statusDoJob) !== null}
                      aria-label={`Editar ${pp.codigo}`}
                      className="inline-flex flex-none items-center justify-center rounded-[9px] border border-border bg-white text-muted-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                      style={{ width: ICONE, height: ICONE }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[300px]">
                  {textoAguardaAbertura(statusDoJob) ?? `Editar ${pp.codigo}`}
                </TooltipContent>
              </Tooltip>
            );
            const formularioEl = !editarEl && (
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
            // Decisão 189: a verba ainda em avaliação também presta contas,
            // e ainda se cancela. Com o cancelar na linha, o botão vira ícone
            // (a trilha tem até três, decisão 160); paga, segue com texto.
            const prestarEl =
              prestar &&
              (cancelar ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setPpPrestando(pp)}
                      aria-label={`${rotuloDoBotaoDaPrestacao(pp)} · ${pp.codigo}`}
                      className="inline-flex flex-none items-center justify-center rounded-[9px] bg-california-red text-white transition-colors hover:bg-california-red-hover"
                      style={{ width: ICONE, height: ICONE }}
                    >
                      <Receipt className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{rotuloDoBotaoDaPrestacao(pp)} · {pp.codigo}</TooltipContent>
                </Tooltip>
              ) : (
                <button
                  type="button"
                  onClick={() => setPpPrestando(pp)}
                  className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg bg-california-red px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-california-red-hover"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  {rotuloDoBotaoDaPrestacao(pp)}
                </button>
              ));
            // A rejeitada volta como PP a emitir (decisão 153): é envio ao
            // financeiro, então segue `podeEnviar`, como o reenvio.
            const refazerEl = podeEnviar && pp.status === "rejeitada" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setPpRefazendo(pp)}
                    disabled={pending}
                    aria-label={`Editar e reemitir ${pp.codigo}`}
                    className="inline-flex flex-none items-center justify-center rounded-[9px] border border-california-red/25 bg-white text-california-red transition-colors hover:bg-california-red/[0.06] disabled:opacity-50"
                    style={{ width: ICONE, height: ICONE }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Editar e Reemitir PP</TooltipContent>
              </Tooltip>
            );
            const cancelarEl = cancelar && (
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
                    ser enviada. O lápis vem antes do avião (Tiago,
                    22/10/2026): primeiro se acerta a PP, depois se envia. */}
                {editarEl}
                {enviarEl}
                {formularioEl}
                {prestarEl}
                {refazerEl}
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
              reembolsoTipo:
                ppEnviando.tipo_verba === "reembolso" ? (ppEnviando.reembolso_tipo ?? "despesas") : null,
              anexos: ppEnviando.anexos ?? [],
              pagaPeloAnexo: meioPeloAnexo(ppEnviando.pagamento_fora_do_cadastro?.meio),
              cartaoCorporativo: ppEnviando.cartao_corporativo === true,
            } satisfies PPParaEnviar
          }
          onOpenChange={(o) => !o && setPpEnviando(null)}
          nomeDoFornecedor={
            (ppEnviando.verba_producao
              ? nomeDeQuemRecebeAVerba(ppEnviando)
              : nomeDoFornecedorDaPP(ppEnviando, fornecedoresPorId)) ?? "—"
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
          envioSemNf={envioDispensaNf(midiaSystem)}
          onEnviada={(codigo, emissora) => {
            setPpEnviando(null);
            setToast(
              `${codigo} enviada ao financeiro.${
                // Revisão da 156: a PP passou para o CNPJ do documento.
                emissora ? ` A empresa emissora passou para ${emissora.para}, o CNPJ do documento.` : ""
              }`,
            );
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
              ? (nomeDeQuemRecebeAVerba(ppVendo) ?? "—")
              : (nomeDoFornecedorDaPP(ppVendo, fornecedoresPorId) ?? "—")
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
            PDF ganha o selo de cancelada e fica no histórico, com os anexos.
          </>
        }
        confirmLabel="Cancelar PP"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleCancelarConfirm}
      />

      {/* Decisão 173: o mesmo formulário do painel do item, com a PP gerada.
          Salvar passa pela revisão; o código fica e o PDF é refeito. Desde
          19/10/2026 (revisão da 153) abre também a PP a emitir que o
          "Reemitir PP" devolveu. */}
      {edicaoDaPP && (ppEditando || aEmitirEditando) && (() => {
        const itemRealizadoId = (ppEditando ?? aEmitirEditando)!.item_realizado_id;
        const item = edicaoDaPP.itens[itemRealizadoId];
        return (
          <GerarPPDrawer
            open
            onOpenChange={(aberto) => {
              if (aberto) return;
              setPpEditando(null);
              setAEmitirEditando(null);
            }}
            itemRealizadoId={itemRealizadoId}
            jobId={edicaoDaPP.jobId}
            fornecedores={edicaoDaPP.fornecedores}
            empresas={edicaoDaPP.empresas}
            podeCadastrarFornecedor={edicaoDaPP.podeCadastrarFornecedor}
            podeEditarFornecedor={edicaoDaPP.podeEditarFornecedor}
            defaultEmpresaId={edicaoDaPP.jobEmpresaId}
            itemDescricao={item?.nome ?? ppEditando?.item_nome ?? ""}
            valorOrcado={item?.orcado ?? 0}
            comiteDaPP={edicaoDaPP.comiteDaPP}
            linhaVermelha={item?.linhaVermelha ?? false}
            valorPlanejado={item?.planejado ?? planejadoPorItem[itemRealizadoId] ?? 0}
            unitarioPlanejado={item?.unitario ?? 0}
            quantidadePlanejada={item?.quantidade ?? 0}
            dmPlanejado={item?.diasMeses ?? 0}
            emPPsEmitidas={item?.realizado ?? emPPsDoItem(itemRealizadoId)}
            aEmitirEditando={aEmitirEditando}
            ppGeradaEditando={ppEditando}
            itemConcluido={item?.concluido ?? false}
            statusDoJob={statusDoJob}
            tomadores={tomadoresDaNf}
            tomadorPorEmpresa={tomadorPorEmpresa}
            cnpjPadraoDaPP={edicaoDaPP.cnpjPadraoDaPP}
            midiaSystem={midiaSystem}
            onSuccess={(modo, idOuCodigo) => {
              if (modo === "editada") {
                setToast(`${idOuCodigo} atualizada. O PDF foi refeito com os dados novos.`);
                return;
              }
              if (modo === "salva") {
                setToast(
                  `PP a emitir salva. Gere a PP pelo painel do item${item?.nome ? ` “${item.nome}”` : ""}, na Planilha Interna, quando quiser.`,
                );
                return;
              }
              // "Gerar PP": salva e abre a revisão antes de gerar (decisão
              // 153), aqui mesmo.
              setRevisarQuandoChegar({
                id: idOuCodigo,
                depoisDe: aEmitirEditando?.id === idOuCodigo ? aEmitirEditando.updated_at : null,
              });
            }}
          />
        );
      })()}

      {/* Decisão 153: a revisão antes de gerar — a mesma do painel do item. */}
      {edicaoDaPP && (
        <RevisaoDialog
          open={revisando !== null}
          onOpenChange={(o) => {
            if (!o && !pending) setRevisando(null);
          }}
          aEmitir={revisando}
          nomeDoFornecedor={
            revisando
              ? revisando.cartao_corporativo
                ? nomeDoCartaoCorporativo(revisando.cartao_plataforma)
                : !revisando.verba_producao
                ? ((revisando.fornecedor_id ? fornecedoresPorId[revisando.fornecedor_id] : null) ?? "—")
                : (revisando.verba_titular_nome ?? "—")
              : ""
          }
          nomeDaEmpresa={
            revisando
              ? (tomadoresDaNf.find(
                  (t) => t.id === (revisando.dados.estabelecimento_id ?? edicaoDaPP.cnpjPadraoDaPP),
                )?.nome ?? "—")
              : ""
          }
          tomadores={tomadoresDaNf}
          planejado={
            revisando
              ? (edicaoDaPP.itens[revisando.item_realizado_id]?.planejado ??
                planejadoPorItem[revisando.item_realizado_id] ??
                0)
              : 0
          }
          emitidasAntes={revisando ? emPPsDoItem(revisando.item_realizado_id) : 0}
          moeda="BRL"
          pending={pending}
          erro={erroDaRevisao}
          onFecharErro={() => setErroDaRevisao(null)}
          onGerar={() => {
            const alvo = revisando;
            if (!alvo) return;
            setErroDaRevisao(null);
            startTransition(async () => {
              const res = await gerarPPDaPPAEmitir(alvo.id);
              if (!res.ok) {
                setErroDaRevisao(res.message);
                return;
              }
              setRevisando(null);
              setToast(
                alvo.tipo_verba === "reembolso"
                  ? `Pedido de Produção ${res.codigo} gerado. Envie ao financeiro com os comprovantes.`
                  : `Pedido de Produção ${res.codigo} gerado. Envie ao financeiro quando a nota chegar.`,
              );
              router.refresh();
            });
          }}
          onEditar={() => {
            const alvo = revisando;
            if (!alvo) return;
            setRevisando(null);
            setAEmitirEditando(alvo);
          }}
        />
      )}

      <PrestarContasDrawer
        open={ppPrestando !== null}
        onOpenChange={(o) => !o && setPpPrestando(null)}
        pp={ppPrestando}
        tomadores={tomadoresDaNf}
        podeEditar={ppPrestando !== null && podePrestarContas.includes(ppPrestando.id)}
        onSuccess={setToast}
        fornecedor={(() => {
          const id = ppPrestando?.fornecedor_id;
          if (!id) return null;
          const f = edicaoDaPP?.fornecedores.find((x) => x.id === id);
          return {
            nome: f?.nome ?? fornecedoresPorId[id] ?? "—",
            razao_social: f?.razao_social ?? null,
            cpf_cnpj: f?.cpf_cnpj ?? null,
          };
        })()}
      />

      <ConfirmDialog
        open={ppRefazendo !== null}
        onOpenChange={(o) => !o && setPpRefazendo(null)}
        title={`Editar e reemitir a ${ppRefazendo?.codigo ?? "PP"}?`}
        description={<TextoDoReemitir codigo={ppRefazendo?.codigo ?? "PP"} />}
        confirmLabel="Editar e Reemitir PP"
        cancelLabel="Voltar"
        variant="primary"
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
            // Quem não edita PP (sem `edicaoDaPP`) não tem o formulário
            // aqui: o aviso diz onde a PP a emitir está.
            if (edicaoDaPP) {
              setToast(TOAST_DO_REEMITIR(res.codigo));
              setAbrirQuandoChegar(res.aEmitirId);
            } else {
              setToast(
                `A ${res.codigo} voltou como PP a emitir no painel do item${alvo.item_nome ? ` “${alvo.item_nome}”` : ""}, na Planilha Interna, com os mesmos dados e anexos.`,
              );
            }
            router.refresh();
          });
        }}
      />

      {/* Decisão 242: o pedido ao Comitê e a exclusão da PP a emitir, os
          mesmos pop-ups do painel do item. */}
      <SolicitarAprovacaoDialog
        aberto={pedindoComite !== null}
        titulo="Solicitar a aprovação da PP?"
        descricao="O realizado do item com esta PP passa do orçado. Aprovada pelo Comitê, ela fica liberada para gerar."
        linhas={(() => {
          if (!pedindoComite) return [];
          const it = edicaoDaPP?.itens[pedindoComite.aEmitir.item_realizado_id];
          return linhasDoMotivoDaPP({
            item: pedindoComite.itemNome,
            linhaVermelha: it?.linhaVermelha ?? false,
            orcado: it?.orcado ?? 0,
            realizadoComAPP: Math.round(((it?.realizado ?? 0) + Number(pedindoComite.aEmitir.valor)) * 100) / 100,
          });
        })()}
        motivoInicial={pedindoComite?.pedido.status === "devolvido" ? pedindoComite.pedido.motivo : ""}
        placeholder="Ex.: o cliente pediu um painel a mais no palco na reunião de ontem."
        onFechar={() => setPedindoComite(null)}
        onEnviar={solicitarComite}
      />
      <ConfirmDialog
        open={excluindoAEmitir !== null}
        onOpenChange={(o) => !o && setExcluindoAEmitir(null)}
        title="Excluir a PP a emitir?"
        description={
          <>
            {excluindoAEmitir
              ? ((excluindoAEmitir.aEmitir.fornecedor_id ? fornecedoresPorId[excluindoAEmitir.aEmitir.fornecedor_id] : null) ?? "—")
              : ""}{" "}
            ·{" "}
            <strong className="text-foreground">{formatCurrency(Number(excluindoAEmitir?.aEmitir.valor ?? 0), "BRL")}</strong>. Some do
            item; nada foi gerado nem enviado.
          </>
        }
        confirmLabel="Excluir"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={excluirAEmitir}
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

/** Decisão 242: as ações da PP a emitir no Comitê, as mesmas do cartão no
 *  painel do item, na ordem dele (o lápis antes):
 *  - em avaliação: só cancelar o envio (não se edita nem se exclui);
 *  - devolvida: editar, solicitar a aprovação de novo e excluir;
 *  - aprovada: editar, gerar a PP e excluir. */
interface AcoesDoComiteProps {
  /** O job ainda não aceita gerar nem pedir ao Comitê (pré-abertura). */
  trava: string | null;
  pending: boolean;
  onCancelarEnvio: (c: PPNoComite) => void;
  onEditar: (c: PPNoComite) => void;
  onGerar: (c: PPNoComite) => void;
  onSolicitar: (c: PPNoComite) => void;
  onExcluir: (c: PPNoComite) => void;
}

function BotaoDoComite({
  rotulo,
  onClick,
  pending,
  trava = null,
  className,
  children,
}: {
  rotulo: string;
  onClick: () => void;
  pending: boolean;
  /** Fechado, com o motivo na dica (o span segura o tooltip). */
  trava?: string | null;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={trava ? 0 : -1} className={cn("inline-flex flex-none rounded-[9px]", trava && "cursor-not-allowed")}>
          <button
            type="button"
            onClick={onClick}
            disabled={pending || trava !== null}
            aria-label={rotulo}
            className={cn(
              "inline-flex flex-none items-center justify-center rounded-[9px] border transition-colors disabled:opacity-50",
              trava ? "pointer-events-none border-border bg-muted text-muted-foreground/70" : className,
            )}
            style={{ width: ICONE, height: ICONE }}
          >
            {children}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[300px]">{trava ?? rotulo}</TooltipContent>
    </Tooltip>
  );
}

function AcoesDoComite({ c, trava, pending, onCancelarEnvio, onEditar, onGerar, onSolicitar, onExcluir }: { c: PPNoComite } & AcoesDoComiteProps) {
  const st = c.pedido.status;
  // A devolvida e a aprovada que ficou mais cara pedem o Comitê de novo.
  const reenviar = st === "devolvido" || c.acimaDoAprovado;
  const neutro = "border-border bg-white text-muted-foreground hover:bg-muted";
  if (st === "pendente") {
    return (
      <BotaoDoComite rotulo={`Cancelar envio ao Comitê · ${c.itemNome}`} onClick={() => onCancelarEnvio(c)} pending={pending} className={neutro}>
        <Undo2 className="h-3.5 w-3.5" />
      </BotaoDoComite>
    );
  }
  return (
    <>
      <BotaoDoComite rotulo={`Editar a PP a emitir · ${c.itemNome}`} onClick={() => onEditar(c)} pending={pending} className={neutro}>
        <Pencil className="h-3.5 w-3.5" />
      </BotaoDoComite>
      {reenviar ? (
        <BotaoDoComite
          rotulo={`Solicitar aprovação de novo · ${c.itemNome}`}
          onClick={() => onSolicitar(c)}
          pending={pending}
          trava={trava}
          className="border-california-red bg-california-red text-white hover:bg-california-red-hover"
        >
          <Gavel className="h-3.5 w-3.5" />
        </BotaoDoComite>
      ) : (
        <BotaoDoComite
          rotulo={`Gerar PP · ${c.itemNome}`}
          onClick={() => onGerar(c)}
          pending={pending}
          trava={trava}
          className="border-foreground bg-foreground text-white hover:opacity-90"
        >
          <FilePlus className="h-3.5 w-3.5" />
        </BotaoDoComite>
      )}
      <BotaoDoComite
        rotulo={`Excluir a PP a emitir · ${c.itemNome}`}
        onClick={() => onExcluir(c)}
        pending={pending}
        className="border-border bg-white text-california-red hover:border-california-red/30 hover:bg-california-red/[0.06]"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </BotaoDoComite>
    </>
  );
}





/* ---- A barra de filtros (decisão 242) ----
 * Os filtros na ordem do caminho da PP — Comitê, Gerada, Em avaliação,
 * Pago — e depois os desvios: Prestar contas, Rejeitado, Cancelada.
 * Todo filtro com o número de PPs (a Pronta para envio é uma Gerada). */
const FLUXO: Filtro[] = ["comite", "gerada", "em_avaliacao", "pago"];
const DESVIOS: Filtro[] = ["aguardando_prestacao", "rejeitada", "cancelada"];

interface ItemDoFiltro {
  key: Filtro;
  label: string;
  n: number;
  alerta: boolean;
}

function NumeroDoFiltro({ n, ativo, alerta, claro }: { n: number; ativo: boolean; alerta: boolean; claro?: boolean }) {
  return (
    <span
      className={cn(
        "min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] font-bold leading-[16px] tabular-nums",
        ativo && claro
          ? "bg-white/25 text-white"
          : ativo
            ? "bg-california-red/10 text-california-red"
            : n === 0
              ? "bg-muted text-muted-foreground/60"
              : alerta
                ? "bg-[#fef3c7] text-[#92400e]"
                : "bg-muted text-foreground",
      )}
    >
      {n}
    </span>
  );
}

/** Setas ← → andam entre os filtros (o foco segue o filtro escolhido). */
function useSetas(chaves: Filtro[], filtro: Filtro, onFiltro: (f: Filtro) => void) {
  const refs = React.useRef(new Map<Filtro, HTMLButtonElement | null>());
  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft" && ev.key !== "Home" && ev.key !== "End") return;
    ev.preventDefault();
    const i = Math.max(0, chaves.indexOf(filtro));
    const j =
      ev.key === "Home" ? 0 : ev.key === "End" ? chaves.length - 1 : (i + (ev.key === "ArrowRight" ? 1 : -1) + chaves.length) % chaves.length;
    onFiltro(chaves[j]);
    refs.current.get(chaves[j])?.focus();
  };
  return { refs, onKeyDown };
}

function BarraDeFiltros({
  itens,
  filtro,
  onFiltro,
}: {
  itens: ItemDoFiltro[];
  filtro: Filtro;
  onFiltro: (f: Filtro) => void;
}) {
  const porChave = new Map(itens.map((i) => [i.key, i]));
  const ordem = itens.map((i) => i.key);
  const { refs, onKeyDown } = useSetas(ordem, filtro, onFiltro);
  const botao = (i: ItemDoFiltro, cls: (ativo: boolean) => string, claro: boolean) => {
    const ativo = filtro === i.key;
    return (
      <button
        key={i.key}
        ref={(el) => {
          refs.current.set(i.key, el);
        }}
        type="button"
        role="tab"
        aria-selected={ativo}
        tabIndex={ativo ? 0 : -1}
        onClick={() => onFiltro(i.key)}
        className={cls(ativo)}
      >
        {i.key === "comite" && <Gavel className="h-3 w-3" />}
        {i.label}
        <NumeroDoFiltro n={i.n} ativo={ativo} alerta={i.alerta} claro={claro} />
      </button>
    );
  };

  // 1 · Etapas em sequência: um controle só (o desenho do Bruto/Líquido da
  // planilha), na ordem do caminho da PP, com os desvios depois do traço.
  {
    const seg = (ativo: boolean) =>
      cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-california-red/40",
        ativo ? "bg-california-red text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      );
    const todas = porChave.get("todas");
    return (
      <div
        role="tablist"
        aria-label="Filtrar PPs pela situação"
        onKeyDown={onKeyDown}
        className="inline-flex flex-wrap items-center gap-0.5 rounded-xl border border-border bg-white p-1 shadow-soft"
      >
        {todas && botao(todas, seg, true)}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {FLUXO.flatMap((k, idx) => {
          const i = porChave.get(k);
          if (!i) return [];
          // A seta só entre duas etapas à vista (no quadro C não há o Comitê).
          const seta = FLUXO.slice(0, idx).some((x) => porChave.has(x)) ? (
            <ChevronRight key={`seta-${k}`} className="h-3 w-3 flex-none text-muted-foreground/50" aria-hidden />
          ) : null;
          return [seta, botao(i, seg, true)].filter(Boolean);
        })}
        <span className="mx-1 h-5 w-px bg-border" aria-hidden />
        {DESVIOS.flatMap((k) => {
          const i = porChave.get(k);
          return i ? [botao(i, seg, true)] : [];
        })}
      </div>
    );
  }

}
