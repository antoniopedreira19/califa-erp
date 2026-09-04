"use client";

import * as React from "react";
import { ChevronDown, Lock, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularRentabilidade } from "@/lib/calculos/versao-totais";
import type {
  ItemPlanilhaJob,
  JobItemRealizado,
  PedidoCompra,
  PedidoCompraNaLista,
  Fornecedor,
  Empresa,
  ItemBv,
} from "@/lib/types";
import { nomeContraparteBRPP } from "@/lib/types";
import { CalhaLinha } from "./calha-linha";
import { GerarPPDrawer } from "./gerar-pp-drawer";
import { PainelPPsItem } from "./painel-pps-item";
import { somaDasPPsEmitidas, contarPendentes } from "@/lib/calculos/pps-item";
import { ppChegouAoFinanceiro } from "@/lib/types";
import { BvDialog } from "@/app/(app)/_bv/bv-dialog";
import { acaoBv } from "@/app/(app)/_bv/bv-action-button";
import { LARGURA_CALHA } from "@/app/(app)/_planilha/calha-acoes";
import { ERRATA } from "@/app/(app)/_planilha/blocos";
import { TIPOS_CUSTO } from "@/lib/calculos/versao-totais";
import {
  parseNumero,
  type CampoErrata,
  type RascunhoErrata,
} from "./errata-rascunho";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { direcaoNoCampo, type Direcao } from "@/app/(app)/_planilha/navegacao";
import {
  Miolo,
  useSelecaoPlanilha,
  type CelulaSelecionada,
  type ColunaDaGrade,
  type Selecao,
  type TipoEditor,
} from "@/app/(app)/_planilha/selecao";
import {
  Calha,
  LinhaDaCalha,
  usePosicoesDaCalha,
} from "@/app/(app)/_planilha/calha";
import { RentabilidadeNoVao } from "@/app/(app)/_planilha/rentabilidade-inline";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";
import {
  ORCADO,
  PLANEJADO,
  REALIZADO,
  FAIXA_ROTULO,
  FAIXA_GRUPO,
  LINHA_GRUPO_NOME,
  LINHA_TOTAL_ROTULO,
  RENTAB_VALOR,
  type Bloco,
} from "@/app/(app)/_planilha/blocos";
import {
  ColunasJob,
  colunasDoRotuloJob,
  larguraMinimaJob,
  totalDeColunasJob,
  type ColunasJobVisiveis,
} from "@/app/(app)/_planilha/grade-job";
import {
  CabecalhoSaveColuna,
  CabecalhoSaveFaixa,
  CelulaSave,
  SAVE_VAZIO,
  classesDaLinhaComSave,
  type EstadoSaveDaLinha,
} from "@/app/(app)/_planilha/save-coluna";
import { AlcaDaColunaSave } from "@/app/(app)/_planilha/exibir-colunas";
import { aceitaBV, tipoGeraDesembolso } from "@/lib/calculos/versao-totais";
import {
  BLOCO_ZERO,
  blocosDoItem,
  realizadoVemDasPPs,
  rotuloColunaTotal,
  somarBlocosDosItens,
  valorNaVisao,
  type ValoresDoBloco,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";

/** Um agrupamento da planilha do job, com os itens já separados. */
export interface GrupoDoJob {
  id: string;
  nome: string;
  itens: ItemPlanilhaJob[];
}

interface Props {
  jobId: string;
  /** TODOS os agrupamentos da planilha, na ordem.
   *
   *  Até 24/08/2026 esta tabela desenhava UM grupo e a tela empilhava um
   *  card por grupo. O handoff "Planilha Interna - Grupos Unificados"
   *  juntou tudo numa tabela só — um cabeçalho de colunas, uma calha de
   *  números — e o grupo virou uma linha que carrega o próprio subtotal e
   *  a própria rentabilidade. */
  grupos: GrupoDoJob[];
  realizadosMap: Map<string, JobItemRealizado>;
  /** id da categoria -> nome. Itens sem categoria caem no travessão. */
  categoriasMap: Map<string, string>;
  moeda: string;
  /** Alíquota do job — vira o BV líquido, que é o que a vista Líquido
   *  desconta. */
  percentualImposto: number;
  /** Bruto (padrão) ou Líquido (− BV). Decidida uma vez por página, em
   *  `JobRealizadoSection`: dois grupos em modos diferentes deixariam o
   *  card de Totais sem bater com nenhum deles. */
  visao: VisaoBv;
  /** Grupo recolhido esconde as LINHAS e a calha de ações. A linha do
   *  grupo — subtotal e rentabilidade — continua visível: é o dado que
   *  justifica recolher, mesma regra da planilha do orçamento. */
  estaAberto: (grupoId: string) => boolean;
  onAlternarGrupo: (grupoId: string) => void;
  /** Trilha lateral de BV e Pedido de Produção — só com o job aberto.
   *  Antes da abertura a planilha é visível e o realizado é editável,
   *  mas nada que vire documento pode ser criado. */
  podeAcoes: boolean;
  /** Job ainda não aberto pelo financeiro (`aguardando_abertura` ou
   *  `rejeitado_financeiro`). Distingue-se do job ENCERRADO, que também
   *  tem `podeAcoes` falso mas conserva os BVs lançados para consulta. */
  preAbertura: boolean;
  /** Errata devolveu o job ao mural: o envio de PP ao financeiro fica
   *  fechado até a revisão da abertura ser salva (decisão 040). */
  aberturaEmRevisao?: boolean;
  // PP rail — várias PPs por item desde 17/08/2026 (PPs parciais).
  ppsPorItemId: Map<string, PedidoCompraNaLista[]>;
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social" | "status">>;
  empresas: Array<Pick<Empresa, "id" | "razao_social" | "nome_fantasia" | "ativo" | "principal">>;
  /** Membros ativos do tenant — usados no combo de Responsável da Verba de Produção. */
  responsaveis: Array<{ id: string; nome: string }>;
  jobEmpresaId: string;
  jobResponsavelId: string;
  /** BV por id do item da versão. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  /** BASE do rótulo do pé da tabela. A vista Líquido acrescenta o sufixo
   *  sozinha. Default: "Total da planilha". */
  rotuloTotal?: string;
  /** Liga a coluna SAVE. Mesma coluna da planilha do orçamento — no job
   *  ela é só leitura até a Errata, que é quem pode mexer no orçado
   *  depois da abertura (decisão 028, nota de 26/08/2026). */
  saveVisivel?: boolean;
  /** Liga e desliga a coluna Save pela alça na borda esquerda da
   *  planilha. Ausente ⇒ a alça não aparece. */
  onAlternarSave?: () => void;
  savePorItem?: Record<string, EstadoSaveDaLinha>;
  onAbrirSave?: (item: ItemPlanilhaJob) => void;
  /** O rascunho do modo errata. Ausente = planilha só de leitura, que é
   *  como as outras telas que reusam esta tabela a consomem. */
  errata?: RascunhoErrata;
  /** Criar item normal e apagar linha ficam atrás de acesso; criar LINHA
   *  VERMELHA, não. Hoje todo mundo passa — a separação existe para o dia
   *  em que os papéis entrarem, e para o gate nascer num lugar só. */
  podeEditarLinhas?: boolean;
  /** Menu "Exibir" (decisão 045). Default: a planilha de sempre — os
   *  três blocos, sem colunas de rentabilidade. Escondido, o ORÇADO sai
   *  da grade inteira; ligada, cada rentabilidade entra como as duas
   *  últimas colunas do bloco que a gera (Rentab. R$ · Rentab. %), e o
   *  "rentab." que morava no vão da linha de grupo e do total sai —
   *  a informação passa a ter um lugar só. */
  orcadoVisivel?: boolean;
  rentabPlanejadaVisivel?: boolean;
  rentabRealizadaVisivel?: boolean;
}

/** Quem decide o conteúdo da calha é a coluna Tipo:
 *
 *   - `A` e `D` — o cliente paga o fornecedor direto. Só BV.
 *   - `B`, `C`, `F`, `FI` — o custo sai do caixa da California. Só PP.
 *   - `AR` (A · Repasse) — as duas coisas na mesma linha: o principal
 *     passa pela California e vira PP, e ainda há comissão a negociar com
 *     o fornecedor, que é o BV. Desde 13/08/2026 é o único tipo assim, e
 *     é ele que a pílula dividida atende.
 *
 *  A pílula dividida cabe na MESMA calha de sempre (116px), então a
 *  reserva da página não muda e a tabela não perde um pixel. */

/** ⚠️ Nenhuma célula desta planilha é editável desde 21/08/2026.
 *
 *  O Orçado e o Planejado sempre vieram da versão aprovada e da errata. O
 *  REALIZADO era o único bloco digitável — e deixou de ser: ele nasce
 *  zerado e é montado pelas PPs emitidas no item (trigger
 *  `trg_pp_recalcula_realizado`). Em `A` e `D`, que não geram PP, o
 *  realizado é o próprio orçado.
 *
 *  Por isso saíram daqui a navegação por Tab, os overrides otimistas e a
 *  chamada a `upsertItemRealizado`: não há mais o que gravar a partir
 *  desta tabela. Mexer no realizado agora é emitir ou cancelar PP. */
const ALTURA_LINHA = "h-[34px]";

/** Por que a linha não entra na errata — o mesmo texto do servidor
 *  (`barrarLinhaComPPNoFinanceiro`), para a tela não prometer o que a
 *  action recusa. */
const MOTIVO_TRAVA_PP =
  "Linha com Pedido de Produção já no financeiro não entra em errata. Corrija o que falta em outra linha, ou cancele a PP antes.";

const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";

/** Razão social quando existe — é o nome que o PDF da PP usa. */
function nomeDoFornecedor(
  fornecedores: Array<Pick<Fornecedor, "id" | "nome" | "razao_social">>,
  id: string,
): string {
  const f = fornecedores.find((x) => x.id === id);
  return f?.razao_social ?? f?.nome ?? "Fornecedor";
}

function formatarPercentual(p: number): string {
  return `${p.toFixed(1).replace(".", ",")}%`;
}

type NavDaCelula = ReturnType<Selecao["celulaProps"]>;

/** Mesma forma do campo da planilha do orçamento — o teclado é um só. */
const CAMPO_LISTA =
  "h-[26px] w-full rounded-md border border-california-red/40 bg-white px-2 text-xs outline-none focus:border-california-red";

/** As colunas que a seleção percorre, na ordem da tela. */
const COLUNAS_NEUTRAS: ColunaDaGrade[] = [
  { chave: "item", rotulo: "Item" },
  { chave: "tipo_custo", rotulo: "Tipo" },
  { chave: "categoria_id", rotulo: "Categoria" },
];
const COLUNAS_ORCADO: ColunaDaGrade[] = [
  { chave: "valor_unitario_orcado", rotulo: "R$ Unit.", bloco: "Orçado" },
  { chave: "quantidade_orcada", rotulo: "QT", bloco: "Orçado" },
  { chave: "dias_meses_orcado", rotulo: "D/M", bloco: "Orçado" },
  { chave: "total_orcado", rotulo: "Total", bloco: "Orçado" },
];
const COLUNAS_PLANEJADO: ColunaDaGrade[] = [
  { chave: "valor_unitario_planejado", rotulo: "R$ Unit.", bloco: "Planejado" },
  { chave: "quantidade_planejada", rotulo: "QT", bloco: "Planejado" },
  { chave: "dias_meses_planejado", rotulo: "D/M", bloco: "Planejado" },
  { chave: "total_planejado", rotulo: "Total", bloco: "Planejado" },
];
const COLUNAS_RENTAB_PLAN: ColunaDaGrade[] = [
  { chave: "rentab_plan_valor", rotulo: "Rentab. R$", bloco: "Planejado" },
  { chave: "rentab_plan_pct", rotulo: "Rentab. %", bloco: "Planejado" },
];
const COLUNAS_REALIZADO: ColunaDaGrade[] = [
  { chave: "valor_unitario_realizado", rotulo: "R$ Unit.", bloco: "Realizado" },
  { chave: "quantidade_realizada", rotulo: "QT", bloco: "Realizado" },
  { chave: "dias_meses_realizado", rotulo: "D/M", bloco: "Realizado" },
  { chave: "total_realizado", rotulo: "Total", bloco: "Realizado" },
];
const COLUNAS_RENTAB_REAL: ColunaDaGrade[] = [
  { chave: "rentab_real_valor", rotulo: "Rentab. R$", bloco: "Realizado" },
  { chave: "rentab_real_pct", rotulo: "Rentab. %", bloco: "Realizado" },
];

/** Uma célula do job com moldura de seleção: `<td>` + miolo. */
function CelulaJob({
  nav,
  moldura,
  className,
  title,
  children,
}: {
  nav: NavDaCelula;
  moldura: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const { className: navClasse, ...handlers } = nav;
  return (
    <td
      className={cn("px-3 text-xs align-middle", className, navClasse)}
      title={title}
      {...handlers}
    >
      <Miolo moldura={moldura}>{children}</Miolo>
    </td>
  );
}

/** Foco no campo recém-aberto: por Enter, o conteúdo inteiro selecionado;
 *  por um caractere digitado, o cursor no fim dele. */
function focarCampo(el: HTMLInputElement, semente?: string) {
  if (semente === undefined) {
    el.select();
    return;
  }
  const fim = el.value.length;
  el.setSelectionRange(fim, fim);
}

/** O campo aberto numa célula da errata (descrição da linha nova, ou
 *  R$ Unit. / QT / D/M do Orçado). Tab, Enter e setas confirmam e andam;
 *  Esc cancela; sair pelo clique confirma. */
function CampoDaErrata({
  valor,
  semente,
  numerico,
  onConfirmar,
  onCancelar,
  className,
  ariaLabel,
}: {
  valor: string;
  semente?: string;
  numerico?: boolean;
  onConfirmar: (raw: string, destino?: Direcao) => void;
  onCancelar: () => void;
  className: string;
  ariaLabel: string;
}) {
  const finalizado = React.useRef(false);
  return (
    <input
      autoFocus
      defaultValue={semente ?? valor}
      inputMode={numerico ? "decimal" : undefined}
      onFocus={(e) => focarCampo(e.currentTarget, semente)}
      onKeyDown={(e) => {
        const destino = direcaoNoCampo(e, e.currentTarget);
        if (destino) {
          e.preventDefault();
          finalizado.current = true;
          onConfirmar(e.currentTarget.value, destino);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          finalizado.current = true;
          onCancelar();
        }
      }}
      onBlur={(e) => {
        if (!finalizado.current) onConfirmar(e.currentTarget.value);
      }}
      aria-label={ariaLabel}
      className={className}
    />
  );
}

/**
 * Célula do bloco ORÇADO — a que a errata abre.
 *
 * Fora da errata é leitura. Na errata, mostra o que está no rascunho e
 * abre pelo mesmo caminho da planilha do orçamento (Enter, digitar,
 * duplo clique — decisão 046); o input guarda TEXTO, não número: com
 * número, digitar "1," volta a "1" e o cursor pula. A conversão acontece
 * uma vez só, em `useRascunhoErrata`, e é de lá que sai o total da linha.
 */
function CelulaOrcadoErrata({
  item,
  campo,
  editando,
  errata,
  moeda,
  className,
  travada = false,
  aberta,
  semente,
  nav,
  moldura,
  onConfirmar,
  onCancelar,
}: {
  item: ItemPlanilhaJob;
  campo: CampoErrata;
  editando: boolean;
  errata?: RascunhoErrata;
  moeda: string;
  className: string;
  /** Linha com PP já no financeiro não entra em errata (decisão 040): a
   *  célula fica de leitura mesmo com o modo ligado. */
  travada?: boolean;
  aberta: boolean;
  semente?: string;
  nav: NavDaCelula;
  moldura: string;
  onConfirmar: (raw: string, destino?: Direcao) => void;
  onCancelar: () => void;
}) {
  // A linha vermelha nasce sem orçado e nunca ganha um: mostrar travessão
  // é mais honesto do que mostrar zeros que ninguém pode mexer.
  if (item.linha_vermelha) {
    return (
      <CelulaJob
        nav={nav}
        moldura={moldura}
        className={cn("text-right font-mono", ERRATA.celulaVermelhaApagada)}
      >
        —
      </CelulaJob>
    );
  }

  const valorSalvo =
    campo === "unitario"
      ? Number(item.valor_unitario_orcado ?? 0)
      : campo === "quantidade"
        ? Number(item.quantidade_orcada ?? 0)
        : Number(item.dias_meses_orcado ?? 0);
  const podeEditar = editando && !!errata && !travada;
  const rotulo =
    campo === "unitario" ? "R$ unitário" : campo === "quantidade" ? "QT" : "D/M";

  if (podeEditar && aberta) {
    const edicao = errata.edicaoDe(item.id);
    return (
      <td className={cn("px-1.5 align-middle", className, ERRATA.celulaEditavel)}>
        <CampoDaErrata
          valor={edicao ? edicao[campo] : String(valorSalvo)}
          semente={semente}
          numerico
          onConfirmar={onConfirmar}
          onCancelar={onCancelar}
          className={ERRATA.input}
          ariaLabel={`${rotulo} orçado de ${item.item || "item novo"}`}
        />
      </td>
    );
  }

  // Na errata o número mostrado é o do RASCUNHO — o que foi digitado.
  const texto = podeEditar ? errata.edicaoDe(item.id)?.[campo] : undefined;
  const numero = texto !== undefined ? (parseNumero(texto) ?? 0) : valorSalvo;
  return (
    <CelulaJob
      nav={nav}
      moldura={moldura}
      title={editando && travada ? MOTIVO_TRAVA_PP : undefined}
      className={cn(
        "text-right",
        campo === "unitario" && "font-mono",
        editando && travada && "text-muted-foreground",
        className,
        podeEditar && ERRATA.celulaEditavel,
      )}
    >
      {campo === "unitario" ? formatCurrency(numero, moeda) : numero}
    </CelulaJob>
  );
}

export function JobItemRealizadoTable({
  jobId,
  grupos,
  realizadosMap,
  categoriasMap,
  moeda,
  percentualImposto,
  visao,
  estaAberto,
  onAlternarGrupo,
  podeAcoes,
  preAbertura,
  aberturaEmRevisao = false,
  ppsPorItemId,
  fornecedores,
  empresas,
  responsaveis,
  jobEmpresaId,
  jobResponsavelId: _jobResponsavelId,
  bvsPorItem,
  versaoLabel,
  rotuloTotal,
  saveVisivel = false,
  onAlternarSave,
  savePorItem,
  onAbrirSave,
  errata,
  podeEditarLinhas = true,
  orcadoVisivel = true,
  rentabPlanejadaVisivel = false,
  rentabRealizadaVisivel = false,
}: Props) {
  const editando = errata?.ativo === true;
  /** Quais colunas a grade desenha. Vai para o `colgroup`, para o piso
   *  de largura e para todos os `colSpan` de linha inteira — os três têm
   *  que sair da MESMA fonte, senão a tabela desalinha sem erro. */
  const colunas: ColunasJobVisiveis = {
    save: saveVisivel,
    orcado: orcadoVisivel,
    rentabPlanejada: rentabPlanejadaVisivel,
    rentabRealizada: rentabRealizadaVisivel,
  };
  const temRentab = rentabPlanejadaVisivel || rentabRealizadaVisivel;
  // Rail lateral PP
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [painelOpen, setPainelOpen] = React.useState(false);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  /** PP gerada aberta no formulário para edição. Null = gerar nova. */
  const [ppEditando, setPpEditando] =
    React.useState<PedidoCompraNaLista | null>(null);
  const [itemIdAtual, setItemIdAtual] = React.useState<string | null>(null);
  const [bvAberto, setBvAberto] = React.useState<ItemPlanilhaJob | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);
  // Estado otimista: quando finalizar PP OK, adiciona {itemRealizadoId: codigo}
  // pra trilha lateral mostrar os ícones Ver/Cancelar IMEDIATAMENTE, sem
  // esperar o router.refresh() completar. Quando a PP real chega via prop
  // (ppsPorItemId do server), este state fica redundante mas não conflita.
  const [ppsOtimistas, setPpsOtimistas] = React.useState<
    Map<string, { codigo: string }>
  >(new Map());

  // Auto-dismiss do toast após 4s
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // O placeholder otimista morre quando a PP real chega via prop. Sem
  // isto ele ficava no mapa para sempre e, com o cancelar dentro do
  // próprio painel (02/09/2026), ressuscitava: cancelada a única PP do
  // item, `ppsDoItem` voltava a vazio e o chip mostrava "PPs · 1" de uma
  // PP que já não existia.
  React.useEffect(() => {
    setPpsOtimistas((prev) => {
      let mudou = false;
      const next = new Map(prev);
      for (const realizadoId of prev.keys()) {
        if ((ppsPorItemId.get(realizadoId) ?? []).length > 0) {
          next.delete(realizadoId);
          mudou = true;
        }
      }
      return mudou ? next : prev;
    });
  }, [ppsPorItemId]);

  /** Todos os itens da planilha, achatados — as contas e as buscas por
   *  id atravessam os grupos e não podem depender de qual card era. */
  const todosOsItens = React.useMemo(
    () => grupos.flatMap((g) => g.itens),
    [grupos],
  );

  // A calha vive fora do frame da tabela e agora acompanha linhas de
  // alturas diferentes (grupo e item). Medir é a única forma de acertar —
  // ver o cabeçalho de `_planilha/calha`.
  const posicoesCalha = usePosicoesDaCalha(wrapperRef, [
    grupos,
    visao,
    podeAcoes,
    preAbertura,
    grupos.map((g) => (estaAberto(g.id) ? "1" : "0")).join(""),
  ]);

  /** O chip da calha abre o painel; o formulário só se chega por ele. */
  function abrirPainel(itemRealizadoId: string) {
    setItemIdAtual(itemRealizadoId);
    setPainelOpen(true);
  }

  /**
   * Os três blocos de UMA linha, já com a dedução de BV separada.
   *
   * - **Orçado** nunca recebe BV: é idêntico nas duas vistas.
   * - **Planejado** deduz o BV CONGELADO no envio para abertura
   *   (`bv_liquido_planejado`). Editar o BV depois, aqui na planilha, não
   *   mexe nele — o compromisso do planejado já foi fechado. O valor novo
   *   só reaparece no realizado, e só na confirmação.
   * - **Realizado** deduz o BV vigente, e só a partir de `confirmado`.
   *   Enquanto ele está `a_negociar` a linha diz "BV não emitido" em vez
   *   de deduzir zero — que pareceria "não tem BV".
   */
  const blocosPorItem = React.useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof blocosDoItem>>();
    for (const it of todosOsItens) {
      mapa.set(
        it.id,
        blocosDoItem(
          it,
          bvsPorItem[it.id] ?? null,
          Number(realizadosMap.get(it.id)?.total_realizado ?? 0),
          percentualImposto,
          !preAbertura,
        ),
      );
    }
    return mapa;
  }, [todosOsItens, bvsPorItem, realizadosMap, percentualImposto, preAbertura]);

  const BLOCO_VAZIO = {
    orcado: 0,
    orcadoRentabilidade: 0,
    planejado: BLOCO_ZERO,
    realizado: BLOCO_ZERO,
  };

  /** Subtotais de cada grupo e o fechamento da planilha inteira — a
   *  mesma conta, aplicada a recortes diferentes da mesma lista. */
  const subtotaisPorGrupo = React.useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof somarBlocosDosItens>>();
    for (const g of grupos) {
      mapa.set(
        g.id,
        somarBlocosDosItens(
          g.itens.map((it) => blocosPorItem.get(it.id) ?? BLOCO_VAZIO),
        ),
      );
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, blocosPorItem]);

  const totais = React.useMemo(
    () =>
      somarBlocosDosItens(
        todosOsItens.map((it) => blocosPorItem.get(it.id) ?? BLOCO_VAZIO),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todosOsItens, blocosPorItem],
  );
  /** A rentabilidade realizada do total só sobre os itens com PP. */
  const realizadaDaPlanilha = React.useMemo(
    () =>
      rentabilidadeRealizadaDe(
        todosOsItens.map((it) => blocosPorItem.get(it.id) ?? BLOCO_VAZIO),
        visao,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todosOsItens, blocosPorItem, visao],
  );

  /** O grupo a que um item pertence — o formulário de BV e o painel de
   *  PPs mostram o nome dele no subtítulo. */
  const grupoDoItem = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const g of grupos) for (const it of g.itens) mapa.set(it.id, g.nome);
    return mapa;
  }, [grupos]);

  const rotuloDoTotal = `${rotuloTotal ?? "Total da planilha"}${
    visao === "liquido" ? " · líquido (− BV)" : ""
  }`;

  /** Linhas que a errata NÃO pode tocar: as que já têm PP no financeiro
   *  (decisão 040). O mesmo recorte de `barrarLinhaComPPNoFinanceiro`,
   *  no servidor — a tela nasce travada para o usuário não montar a
   *  errata inteira e só então tomar o erro. A gerada não trava: ela
   *  ainda é rascunho do job. */
  const travadasPorPP = React.useMemo(() => {
    const travadas = new Set<string>();
    for (const it of todosOsItens) {
      const realizadoId = realizadosMap.get(it.id)?.id;
      if (!realizadoId) continue;
      const pps = ppsPorItemId.get(realizadoId) ?? [];
      if (pps.some((pp) => ppChegouAoFinanceiro(pp.status))) travadas.add(it.id);
    }
    return travadas;
  }, [todosOsItens, realizadosMap, ppsPorItemId]);

  const fmt = (v: number) => formatCurrency(v, moeda);

  // ---- SELEÇÃO E TECLADO (decisão 046) --------------------------------
  /** A célula ABERTA — só existe na errata. */
  const [aberta, setAberta] = React.useState<{
    rowId: string;
    campo: string;
    semente?: string;
  } | null>(null);

  const colunasDaGrade = React.useMemo<ColunaDaGrade[]>(
    () => [
      ...COLUNAS_NEUTRAS,
      ...(orcadoVisivel ? COLUNAS_ORCADO : []),
      ...COLUNAS_PLANEJADO,
      ...(rentabPlanejadaVisivel ? COLUNAS_RENTAB_PLAN : []),
      ...COLUNAS_REALIZADO,
      ...(rentabRealizadaVisivel ? COLUNAS_RENTAB_REAL : []),
    ],
    [orcadoVisivel, rentabPlanejadaVisivel, rentabRealizadaVisivel],
  );

  /** As linhas na ordem da tela; grupo recolhido fica fora. */
  const linhasNavegaveis = React.useMemo(() => {
    const ids: string[] = [];
    for (const g of grupos) {
      if (!estaAberto(g.id)) continue;
      for (const it of g.itens) ids.push(it.id);
    }
    return ids;
  }, [grupos, estaAberto]);

  /** Último item visível de cada grupo → id do grupo. É por aqui que o ↓
   *  da última linha abre o "Novo item" DESTE grupo na errata. */
  const grupoDoUltimoItem = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const g of grupos) {
      if (!estaAberto(g.id)) continue;
      const ultimo = g.itens[g.itens.length - 1];
      if (ultimo) mapa.set(ultimo.id, g.id);
    }
    return mapa;
  }, [grupos, estaAberto]);

  const itemPorId = React.useMemo(
    () => new Map(todosOsItens.map((it) => [it.id, it])),
    [todosOsItens],
  );

  /** O que cada célula abre — só na errata. Fora dela tudo é leitura:
   *  seleciona, mas não abre. */
  const editorDe = React.useCallback(
    (rowId: string, coluna: string): TipoEditor | null => {
      if (!editando || !errata) return null;
      const item = itemPorId.get(rowId);
      if (!item || travadasPorPP.has(rowId)) return null;
      if (coluna === "item") return errata.ehNova(rowId) ? "texto" : null;
      if (coluna === "tipo_custo") return "lista";
      if (
        coluna === "valor_unitario_orcado" ||
        coluna === "quantidade_orcada" ||
        coluna === "dias_meses_orcado"
      ) {
        return item.linha_vermelha ? null : "numero";
      }
      return null;
    },
    [editando, errata, itemPorId, travadasPorPP],
  );

  /** Cria a linha nova e já abre a descrição dela — é o que o input
   *  sempre aberto fazia antes de a errata ganhar o mesmo teclado da
   *  planilha do orçamento. */
  function abrirLinhaNova(grupoId: string, vermelha: boolean) {
    if (!errata) return;
    const chave = errata.adicionar(grupoId, vermelha);
    selecao.selecionar({ linhaId: chave, coluna: "item" });
    setAberta({ rowId: chave, campo: "item" });
  }

  const selecao: Selecao = useSelecaoPlanilha({
    linhas: linhasNavegaveis,
    colunas: colunasDaGrade,
    editorDe,
    onAbrir: (c, semente) => setAberta({ rowId: c.linhaId, campo: c.coluna, semente }),
    // ↓ na última linha do grupo, na errata, abre o "Novo item" dele —
    // menos quando a última linha é uma nova ainda sem nome.
    aoDescer: (rowId) => {
      if (!editando || !errata || !podeEditarLinhas) return false;
      const grupoId = grupoDoUltimoItem.get(rowId);
      if (!grupoId) return false;
      const item = itemPorId.get(rowId);
      if (item && errata.ehNova(rowId) && item.item.trim() === "") return false;
      abrirLinhaNova(grupoId, false);
      return true;
    },
    editando: aberta !== null,
    wrapperRef,
  });
  const selecaoRef = React.useRef(selecao.celula);
  selecaoRef.current = selecao.celula;

  // Campo fechou: o foco volta ao card, para as setas continuarem.
  const abertaAnterior = React.useRef(aberta);
  React.useEffect(() => {
    if (abertaAnterior.current !== null && aberta === null && selecaoRef.current) {
      selecao.focar();
    }
    abertaAnterior.current = aberta;
  }, [aberta, selecao]);

  // Errata desligada: nenhuma célula fica aberta.
  React.useEffect(() => {
    if (!editando) setAberta(null);
  }, [editando]);

  function fecharEMover(de: CelulaSelecionada, destino?: Direcao) {
    setAberta(null);
    if (destino) selecao.mover(destino, de);
  }

  /** Fecha a lista SE ela ainda for a aberta — o Radix avisa que fechou
   *  também quando é desmontado pela navegação. */
  const fecharCelula = React.useCallback((rowId: string, campo: string) => {
    setAberta((atual) =>
      atual && atual.rowId === rowId && atual.campo === campo ? null : atual,
    );
  }, []);


  return (
    <>
      {/* A faixa de erro que ficava aqui era do lançamento inline do
          realizado, que deixou de existir em 21/08/2026. Erro de PP e de
          BV vive no drawer que o produziu, junto do campo que o causou. */}
      <div
        ref={wrapperRef}
        // O card recebe as teclas da seleção; sem anel — a moldura da
        // célula é o foco visível.
        tabIndex={0}
        onKeyDown={selecao.onKeyDown}
        className="relative outline-none"
      >
      {/* A alça da coluna Save — mesma da planilha do orçamento, no
          lado oposto ao da calha de BV e PP. */}
      {onAlternarSave && (
        <div className="absolute right-full top-0 flex h-full items-start">
          <AlcaDaColunaSave visivel={saveVisivel} onAlternar={onAlternarSave} />
        </div>
      )}
      {/* Com o nome do grupo na faixa, a tabela abre e fecha o card. */}
      {/* A tabela abre e fecha o card: a planilha inteira é uma só. */}
      <div className="overflow-x-auto rounded-b-2xl rounded-t-2xl">
        <table
          className="w-full table-fixed text-sm border-collapse"
          style={{ minWidth: larguraMinimaJob(colunas) }}
        >
          <ColunasJob {...colunas} />
          <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {/* Linha 1 — a faixa dos blocos. Ela é UMA para a planilha
                inteira: era esta repetição, um cabeçalho por grupo, que o
                handoff "Grupos Unificados" veio eliminar. */}
            <tr>
              {saveVisivel && <CabecalhoSaveFaixa />}
              <th colSpan={3} className={FAIXA_GRUPO} />
              {orcadoVisivel && (
                <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                  ORÇADO
                </th>
              )}
              {/* A faixa cobre a rentabilidade do bloco quando ela está
                  ligada: são as duas últimas colunas DELE, não um quarto
                  bloco. */}
              <th
                colSpan={rentabPlanejadaVisivel ? 6 : 4}
                className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}
              >
                PLANEJADO
              </th>
              <th
                colSpan={rentabRealizadaVisivel ? 6 : 4}
                className={cn(FAIXA_ROTULO, REALIZADO.faixa)}
              >
                REALIZADO
              </th>
            </tr>
            <tr className="bg-muted/40">
              {saveVisivel && <CabecalhoSaveColuna />}
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Grupo · Item</th>
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Tipo</th>
              <th className="text-left font-semibold px-3 py-2 border-r border-r-border">Categoria</th>
              {/* Orcado */}
              {orcadoVisivel && (
                <>
                  <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoAbre)}>R$ Unit.</th>
                  <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoMeio)}>QT</th>
                  <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoMeio)}>D/M</th>
                  <th className={cn("text-right font-semibold px-3 py-2", ORCADO.cabecalhoFim)}>Total</th>
                </>
              )}
              {/* Planejado — com a rentabilidade ligada, o Total deixa de
                  ser a última coluna do bloco e ganha o fio de 1px. */}
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoAbre)}>R$ Unit.</th>
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoMeio)}>QT</th>
              <th className={cn("text-right font-semibold px-3 py-2", PLANEJADO.cabecalhoMeio)}>D/M</th>
              <th className={cn("text-right font-semibold px-3 py-2", rentabPlanejadaVisivel ? PLANEJADO.cabecalhoMeio : PLANEJADO.cabecalhoFim)}>{rotuloColunaTotal(visao)}</th>
              {rentabPlanejadaVisivel && <CabecalhosRentabilidade bloco={PLANEJADO} />}
              {/* Realizado */}
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoAbre)}>R$ Unit.</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoMeio)}>QT</th>
              <th className={cn("text-right font-semibold px-3 py-2", REALIZADO.cabecalhoMeio)}>D/M</th>
              <th className={cn("text-right font-semibold px-3 py-2", rentabRealizadaVisivel ? REALIZADO.cabecalhoMeio : REALIZADO.cabecalhoFim)}>{rotuloColunaTotal(visao)}</th>
              {rentabRealizadaVisivel && <CabecalhosRentabilidade bloco={REALIZADO} />}
            </tr>
          </thead>

          <tbody>
            {grupos.map((grupo) => {
              const abertoAqui = estaAberto(grupo.id);
              const sub =
                subtotaisPorGrupo.get(grupo.id) ??
                somarBlocosDosItens([]);
              const subPlanejado = valorNaVisao(sub.planejado, visao);
              const subRealizado = valorNaVisao(sub.realizado, visao);
              // A realizada do grupo conta só os itens que já têm PP
              // (decisão 045): somar o orçado de quem ainda não pediu
              // nada inflaria a margem como se o custo não fosse
              // acontecer.
              const realizadaDoGrupo = rentabilidadeRealizadaDe(
                grupo.itens.map((it) => blocosPorItem.get(it.id) ?? BLOCO_VAZIO),
                visao,
              );

              return (
                <React.Fragment key={grupo.id}>
                  {/* A LINHA DO GRUPO: nome à esquerda, subtotal já
                      alinhado à coluna Total de cada bloco, e a
                      rentabilidade ocupando o vão vazio de PLANEJADO e
                      REALIZADO. Era um `tfoot` de duas linhas por card;
                      agora é uma linha só. */}
                  <tr data-calha={`g:${grupo.id}`} className="h-10">
                    <td
                      colSpan={colunasDoRotuloJob(colunas)}
                      className={LINHA_GRUPO_NOME}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => onAlternarGrupo(grupo.id)}
                          title={
                            abertoAqui
                              ? "Ocultar itens do grupo"
                              : "Mostrar itens do grupo"
                          }
                          aria-expanded={abertoAqui}
                          className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white hover:text-california-red"
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform duration-150",
                              !abertoAqui && "-rotate-90",
                            )}
                          />
                        </button>
                        <TruncateTooltip
                          text={grupo.nome}
                          className="text-[13.5px] font-bold tracking-[-0.01em] text-foreground"
                        />
                        <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">
                          {grupo.itens.length}{" "}
                          {grupo.itens.length === 1 ? "item" : "itens"}
                          {!abertoAqui && grupo.itens.length > 0 && " ocultos"}
                        </span>
                      </div>
                    </td>

                    {orcadoVisivel && (
                      <>
                        <td colSpan={3} className={ORCADO.grupoVazio} />
                        <td
                          className={cn(
                            "px-3 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                            ORCADO.grupoValor,
                          )}
                        >
                          {formatCurrency(sub.orcado, moeda)}
                        </td>
                      </>
                    )}

                    {/* O "rentab." no vão só existe enquanto a
                        rentabilidade não tem colunas próprias. */}
                    <td
                      colSpan={3}
                      className={cn("overflow-hidden px-3 text-right", PLANEJADO.grupoVazio)}
                    >
                      {!rentabPlanejadaVisivel && (
                        <RentabilidadeNoVao
                          orcado={sub.orcadoRentabilidade}
                          custo={subPlanejado}
                          moeda={moeda}
                          corRotulo={PLANEJADO.textoSuave}
                        />
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-3 text-right whitespace-nowrap",
                        PLANEJADO.grupoValor,
                      )}
                    >
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-[13px] font-bold leading-[1.2]">
                          {formatCurrency(subPlanejado, moeda)}
                        </span>
                        {visao === "liquido" && (
                          <SubLinhaBv
                            deducao={sub.planejado.deducaoBv}
                            formatar={fmt}
                            cor={PLANEJADO.texto}
                            corRotulo={PLANEJADO.textoSuave}
                          />
                        )}
                      </div>
                    </td>
                    {rentabPlanejadaVisivel && (
                      <CelulasRentabilidade
                        bloco={PLANEJADO}
                        linha="grupo"
                        orcado={sub.orcadoRentabilidade}
                        custo={subPlanejado}
                        temCusto={sub.planejado.bruto > 0}
                        moeda={moeda}
                      />
                    )}

                    <td
                      colSpan={3}
                      className={cn("overflow-hidden px-3 text-right", REALIZADO.grupoVazio)}
                    >
                      {!rentabRealizadaVisivel && (
                        <RentabilidadeNoVao
                          orcado={sub.orcadoRentabilidade}
                          custo={subRealizado}
                          moeda={moeda}
                          corRotulo={REALIZADO.textoSuave}
                        />
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-3 text-right whitespace-nowrap",
                        REALIZADO.grupoValor,
                      )}
                    >
                      <div className="flex flex-col items-end">
                        <span className="font-mono text-[13px] font-bold leading-[1.2]">
                          {sub.realizado.bruto > 0
                            ? formatCurrency(subRealizado, moeda)
                            : "—"}
                        </span>
                        {visao === "liquido" && (
                          <SubLinhaBv
                            deducao={sub.realizado.deducaoBv}
                            formatar={fmt}
                            cor={REALIZADO.texto}
                            corRotulo={REALIZADO.textoSuave}
                          />
                        )}
                      </div>
                    </td>
                    {rentabRealizadaVisivel && (
                      <CelulasRentabilidade
                        bloco={REALIZADO}
                        linha="grupo"
                        orcado={realizadaDoGrupo.orcado}
                        custo={realizadaDoGrupo.custo}
                        temCusto={realizadaDoGrupo.temCusto}
                        parcial={realizadaDoGrupo.parcial}
                        moeda={moeda}
                      />
                    )}
                  </tr>

                  {abertoAqui && grupo.itens.length === 0 && (
                    <tr className="border-b border-border">
                      <td
                        colSpan={totalDeColunasJob(colunas)}
                        className="py-5 pl-[30px] pr-3 text-xs text-muted-foreground"
                      >
                        Sem itens neste grupo.
                      </td>
                    </tr>
                  )}

                  {abertoAqui && grupo.itens.map((item) => {
                    const blocos = blocosPorItem.get(item.id) ?? BLOCO_VAZIO;
                    const realizadoDoItem = realizadosMap.get(item.id);
                    // A quebra do realizado espelha o orçado só em `A`/`D`
                    // COM o job aberto. Na pré-abertura ela vem da linha
                    // de realizado, que está zerada — e zero vira
                    // travessão, igual ao Total.
                    const quebraDasPPs =
                      realizadoVemDasPPs(item.tipo_custo) || preAbertura;
                    const categoria = item.categoria_id
                      ? categoriasMap.get(item.categoria_id)
                      : null;
                    const travada = travadasPorPP.has(item.id);
                    const abertaAqui = (campo: string) =>
                      aberta?.rowId === item.id && aberta.campo === campo;
                    const sementeDe = (campo: string) =>
                      abertaAqui(campo) ? aberta?.semente : undefined;
                    const nav = (coluna: string) => selecao.celulaProps(item.id, coluna);
                    const moldura = (coluna: string) => selecao.moldura(item.id, coluna);
                    const classeNeutra = item.linha_vermelha
                      ? ERRATA.celulaVermelha
                      : GRADE_NEUTRA;
                    const celulaOrcado = (
                      campo: CampoErrata,
                      coluna: string,
                      classe: string,
                    ) => (
                      <CelulaOrcadoErrata
                        item={item}
                        campo={campo}
                        editando={editando}
                        errata={errata}
                        moeda={moeda}
                        className={classe}
                        travada={travada}
                        aberta={abertaAqui(coluna)}
                        semente={sementeDe(coluna)}
                        nav={nav(coluna)}
                        moldura={moldura(coluna)}
                        onConfirmar={(raw, d) => {
                          errata?.editarCampo(item.id, campo, raw);
                          fecharEMover({ linhaId: item.id, coluna }, d);
                        }}
                        onCancelar={() => setAberta(null)}
                      />
                    );

                    return (
                      <tr
                        key={item.id}
                        data-calha={`i:${item.id}`}
                        className={cn(
                          ALTURA_LINHA,
                          "border-b border-border",
                          item.linha_vermelha && ERRATA.linhaVermelha,
                          saveVisivel &&
                            classesDaLinhaComSave(
                              savePorItem?.[item.id] ?? SAVE_VAZIO,
                            ),
                        )}
                      >
                        {saveVisivel && (
                          <CelulaSave
                            estado={savePorItem?.[item.id] ?? SAVE_VAZIO}
                            moeda={moeda}
                            totalOrcado={Number(item.total_orcado ?? 0)}
                            onAbrir={onAbrirSave ? () => onAbrirSave(item) : undefined}
                          />
                        )}

                        {/* Item — só a linha NOVA da errata tem nome
                            editável; as outras vêm da versão aprovada. */}
                        {abertaAqui("item") && errata ? (
                          <td className={cn("px-1.5 pl-[18px] align-middle", classeNeutra)}>
                            <CampoDaErrata
                              valor={item.item}
                              semente={sementeDe("item")}
                              onConfirmar={(v, d) => {
                                errata.editarNome(item.id, v);
                                fecharEMover({ linhaId: item.id, coluna: "item" }, d);
                              }}
                              onCancelar={() => setAberta(null)}
                              className={ERRATA.inputNome}
                              ariaLabel="Descrição do item novo"
                            />
                          </td>
                        ) : (
                          <CelulaJob
                            nav={nav("item")}
                            moldura={moldura("item")}
                            className={cn("pl-[30px]", classeNeutra)}
                          >
                            <div className="flex min-w-0 items-center gap-1.5">
                              {editando && travada && (
                                <Lock
                                  className="h-3 w-3 flex-none text-muted-foreground"
                                  aria-label={MOTIVO_TRAVA_PP}
                                >
                                  <title>{MOTIVO_TRAVA_PP}</title>
                                </Lock>
                              )}
                              {item.item ? (
                                <TruncateTooltip text={item.item} />
                              ) : (
                                <span className="text-muted-foreground">
                                  {editando && errata?.ehNova(item.id)
                                    ? "Descrição do item"
                                    : "—"}
                                </span>
                              )}
                              {item.linha_vermelha && (
                                <span className={cn(ERRATA.tagVermelha, "flex-none")}>
                                  só realizado
                                </span>
                              )}
                            </div>
                          </CelulaJob>
                        )}

                        {/* Tipo — lista, como na planilha do orçamento:
                            escolher grava e FICA na célula. */}
                        {abertaAqui("tipo_custo") && errata ? (
                          <td className={cn("px-1.5 align-middle", classeNeutra)}>
                            <Select
                              value={item.tipo_custo}
                              defaultOpen
                              onValueChange={(v) =>
                                errata.editarTipo(
                                  item.id,
                                  v as ItemPlanilhaJob["tipo_custo"],
                                )
                              }
                              onOpenChange={(o) => {
                                if (!o) fecharCelula(item.id, "tipo_custo");
                              }}
                            >
                              <SelectTrigger
                                className={cn(CAMPO_LISTA, "justify-between gap-1 py-0")}
                                aria-label={`Tipo de custo de ${item.item || "item novo"}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent
                                onKeyDown={(e) => {
                                  if (e.key !== "Tab") return;
                                  e.preventDefault();
                                  fecharEMover(
                                    { linhaId: item.id, coluna: "tipo_custo" },
                                    e.shiftKey ? "anterior" : "proxima",
                                  );
                                }}
                              >
                                {TIPOS_CUSTO.map((t) => (
                                  <SelectItem key={t} value={t}>
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        ) : (
                          <CelulaJob
                            nav={nav("tipo_custo")}
                            moldura={moldura("tipo_custo")}
                            className={classeNeutra}
                          >
                            <Badge variant="outline">{item.tipo_custo}</Badge>
                          </CelulaJob>
                        )}

                        <CelulaJob
                          nav={nav("categoria_id")}
                          moldura={moldura("categoria_id")}
                          className={classeNeutra}
                        >
                          {categoria ? (
                            <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted px-2 py-0.5 text-[10.5px] font-medium text-foreground">
                              {categoria}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </CelulaJob>

                        {/* ORÇADO — o único bloco que o modo errata abre.
                            Escondido pelo menu, sai inteiro — a errata
                            liga o bloco de volta ao entrar. */}
                        {orcadoVisivel && (
                          <>
                            {celulaOrcado("unitario", "valor_unitario_orcado", ORCADO.celulaAbre)}
                            {celulaOrcado("quantidade", "quantidade_orcada", ORCADO.celulaMeio)}
                            {celulaOrcado("diasMeses", "dias_meses_orcado", ORCADO.celulaMeio)}
                            <CelulaJob
                              nav={nav("total_orcado")}
                              moldura={moldura("total_orcado")}
                              className={cn(
                                "text-right font-mono font-semibold whitespace-nowrap",
                                item.linha_vermelha
                                  ? ERRATA.celulaVermelhaApagada
                                  : ORCADO.celulaTotal,
                              )}
                            >
                              {formatCurrency(Number(item.total_orcado ?? 0), moeda)}
                            </CelulaJob>
                          </>
                        )}

                        {/* Planejado (RO) */}
                        <CelulaLeitura
                          valor={Number(item.valor_unitario_planejado ?? 0)}
                          formato="moeda"
                          moeda={moeda}
                          className={cn("font-mono", PLANEJADO.celulaAbre)}
                          nav={nav("valor_unitario_planejado")}
                          moldura={moldura("valor_unitario_planejado")}
                        />
                        <CelulaLeitura
                          valor={Number(item.quantidade_planejada ?? 0)}
                          className={PLANEJADO.celulaMeio}
                          nav={nav("quantidade_planejada")}
                          moldura={moldura("quantidade_planejada")}
                        />
                        <CelulaLeitura
                          valor={Number(item.dias_meses_planejado ?? 0)}
                          className={PLANEJADO.celulaMeio}
                          nav={nav("dias_meses_planejado")}
                          moldura={moldura("dias_meses_planejado")}
                        />
                        <CelulaTotalComBv
                          bloco={blocos.planejado}
                          visao={visao}
                          moeda={moeda}
                          // Com a rentabilidade ligada o Total ganha o fio
                          // de 1px à direita: ele deixou de fechar o bloco.
                          className={cn(
                            rentabPlanejadaVisivel && PLANEJADO.celulaMeio,
                            PLANEJADO.celulaTotal,
                          )}
                          cor={PLANEJADO.texto}
                          corRotulo={PLANEJADO.textoSuave}
                          nav={nav("total_planejado")}
                          moldura={moldura("total_planejado")}
                        />
                        {rentabPlanejadaVisivel && (
                          <CelulasRentabilidade
                            bloco={PLANEJADO}
                            linha="item"
                            orcado={blocos.orcadoRentabilidade}
                            custo={valorNaVisao(blocos.planejado, visao)}
                            temCusto={blocos.planejado.bruto > 0}
                            moeda={moeda}
                            selecao={selecao}
                            linhaId={item.id}
                            colunas={["rentab_plan_valor", "rentab_plan_pct"]}
                          />
                        )}

                        {/* Realizado — leitura. Em item que gera PP, a
                            quebra descreve as PPs emitidas; em A e D, que
                            não geram PP, ela espelha o orçado. */}
                        <CelulaLeitura
                          valor={
                            quebraDasPPs
                              ? Number(realizadoDoItem?.valor_unitario_realizado ?? 0)
                              : Number(item.valor_unitario_orcado ?? 0)
                          }
                          formato="moeda"
                          moeda={moeda}
                          className={cn("font-mono", REALIZADO.celulaAbre)}
                          nav={nav("valor_unitario_realizado")}
                          moldura={moldura("valor_unitario_realizado")}
                        />
                        <CelulaLeitura
                          valor={
                            quebraDasPPs
                              ? Number(realizadoDoItem?.quantidade_realizada ?? 0)
                              : Number(item.quantidade_orcada ?? 0)
                          }
                          className={REALIZADO.celulaMeio}
                          nav={nav("quantidade_realizada")}
                          moldura={moldura("quantidade_realizada")}
                        />
                        <CelulaLeitura
                          valor={
                            quebraDasPPs
                              ? Number(realizadoDoItem?.dias_meses_realizado ?? 0)
                              : Number(item.dias_meses_orcado ?? 0)
                          }
                          className={REALIZADO.celulaMeio}
                          nav={nav("dias_meses_realizado")}
                          moldura={moldura("dias_meses_realizado")}
                        />
                        <CelulaTotalComBv
                          bloco={blocos.realizado}
                          visao={visao}
                          moeda={moeda}
                          className={cn(
                            rentabRealizadaVisivel && REALIZADO.celulaMeio,
                            REALIZADO.celulaTotal,
                          )}
                          cor={REALIZADO.texto}
                          corRotulo={REALIZADO.textoSuave}
                          nav={nav("total_realizado")}
                          moldura={moldura("total_realizado")}
                        />
                        {/* Item sem PP emitida ainda não tem rentabilidade
                            realizada: travessão, e não zero. */}
                        {rentabRealizadaVisivel && (
                          <CelulasRentabilidade
                            bloco={REALIZADO}
                            linha="item"
                            orcado={blocos.orcadoRentabilidade}
                            custo={valorNaVisao(blocos.realizado, visao)}
                            temCusto={blocos.realizado.bruto > 0}
                            moeda={moeda}
                            selecao={selecao}
                            linhaId={item.id}
                            colunas={["rentab_real_valor", "rentab_real_pct"]}
                          />
                        )}
                      </tr>
                    );
                  })}

                  {/* Os dois jeitos de criar linha, no pé do grupo.
                      "Novo item" é a linha de sempre: tem orçado, entra na
                      conta e depois recebe planejado. "Linha vermelha" é a
                      outra coisa — ela nasce sem orçado e sem planejado e
                      só recebe realizado, por PP. É o custo que o
                      orçamento não previu e que alguém precisa pedir
                      mesmo assim.

                      Criar item normal fica atrás de acesso; criar linha
                      vermelha, não. */}
                  {abertoAqui && editando && errata && (
                    <tr className="border-b border-border">
                      <td
                        colSpan={totalDeColunasJob(colunas)}
                        className={ERRATA.linhaAcao}
                      >
                        <div className="flex flex-wrap items-center gap-2 pl-[18px]">
                          {podeEditarLinhas && (
                            <button
                              type="button"
                              onClick={() => abrirLinhaNova(grupo.id, false)}
                              className={ERRATA.botaoNovoItem}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Novo item em {grupo.nome}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => abrirLinhaNova(grupo.id, true)}
                            className={ERRATA.botaoLinhaVermelha}
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Linha vermelha
                          </button>
                          <span className="text-[11px] text-muted-foreground">
                            orçado e planejado zerados · só recebe realizado por
                            PP
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>

          <tfoot>
            {/* O pé da tabela repete a forma da linha de grupo: subtotal
                alinhado à coluna Total e a rentabilidade no vão. Antes
                eram DUAS linhas por card — uma de subtotal e outra só de
                "Rentabilidade" —, e elas viravam quatro na tela com dois
                agrupamentos. */}
            <tr>
              <td
                colSpan={colunasDoRotuloJob(colunas)}
                className={LINHA_TOTAL_ROTULO}
              >
                {rotuloDoTotal}
              </td>

              {orcadoVisivel && (
                <>
                  <td colSpan={3} className={ORCADO.subtotalVazio} />
                  <td
                    className={cn(
                      "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                      ORCADO.subtotalValor,
                    )}
                  >
                    {formatCurrency(totais.orcado, moeda)}
                  </td>
                </>
              )}

              <td
                colSpan={3}
                className={cn("overflow-hidden px-3 py-2 text-right", PLANEJADO.subtotalVazio)}
              >
                {!rentabPlanejadaVisivel && (
                  <RentabilidadeNoVao
                    orcado={totais.orcadoRentabilidade}
                    custo={valorNaVisao(totais.planejado, visao)}
                    moeda={moeda}
                    corRotulo={PLANEJADO.textoSuave}
                  />
                )}
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right whitespace-nowrap",
                  PLANEJADO.subtotalValor,
                )}
              >
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {formatCurrency(valorNaVisao(totais.planejado, visao), moeda)}
                  </span>
                  {/* A soma dos BVs de todos os itens da planilha — foi o
                      que substituiu as pílulas de "BV do grupo" do design
                      3b. */}
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={totais.planejado.deducaoBv}
                      formatar={fmt}
                      cor={PLANEJADO.texto}
                      corRotulo={PLANEJADO.textoSuave}
                    />
                  )}
                </div>
              </td>
              {rentabPlanejadaVisivel && (
                <CelulasRentabilidade
                  bloco={PLANEJADO}
                  linha="total"
                  orcado={totais.orcadoRentabilidade}
                  custo={valorNaVisao(totais.planejado, visao)}
                  temCusto={totais.planejado.bruto > 0}
                  moeda={moeda}
                />
              )}

              <td
                colSpan={3}
                className={cn("overflow-hidden px-3 py-2 text-right", REALIZADO.subtotalVazio)}
              >
                {!rentabRealizadaVisivel && (
                  <RentabilidadeNoVao
                    orcado={totais.orcadoRentabilidade}
                    custo={valorNaVisao(totais.realizado, visao)}
                    moeda={moeda}
                    corRotulo={REALIZADO.textoSuave}
                  />
                )}
              </td>
              <td
                className={cn(
                  "px-3 py-2 text-right whitespace-nowrap",
                  REALIZADO.subtotalValor,
                )}
              >
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[13px] font-bold">
                    {totais.realizado.bruto > 0
                      ? formatCurrency(valorNaVisao(totais.realizado, visao), moeda)
                      : "—"}
                  </span>
                  {visao === "liquido" && (
                    <SubLinhaBv
                      deducao={totais.realizado.deducaoBv}
                      formatar={fmt}
                      cor={REALIZADO.texto}
                      corRotulo={REALIZADO.textoSuave}
                    />
                  )}
                </div>
              </td>
              {rentabRealizadaVisivel && (
                <CelulasRentabilidade
                  bloco={REALIZADO}
                  linha="total"
                  orcado={realizadaDaPlanilha.orcado}
                  custo={realizadaDaPlanilha.custo}
                  temCusto={realizadaDaPlanilha.temCusto}
                  parcial={realizadaDaPlanilha.parcial}
                  moeda={moeda}
                />
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* A calha — fora do frame da tabela, ao lado das linhas. Cada
          pílula é presa à posição MEDIDA da linha que ela acompanha:
          numa tabela só, as linhas têm alturas diferentes e altura
          chutada acumularia erro a cada grupo.

          Job encerrado não some com a calha: os BVs já lançados seguem
          consultáveis, como na tela de Orçamentos. Só o que é ação
          (gerar PP, lançar BV novo) é que desaparece. */}
      {(editando ||
        podeAcoes ||
        (!preAbertura && todosOsItens.some((i) => bvsPorItem[i.id]))) && (
        <Calha className={cn("pointer-events-none absolute left-full top-0 ml-2.5", LARGURA_CALHA)}>
          {grupos.map((grupo) =>
            estaAberto(grupo.id)
              ? grupo.itens.map((item) => {
                  // No modo errata a calha troca de assunto: BV e PP são
                  // ações sobre a linha como ela está, e ela está sendo
                  // reescrita. O que cabe ali é remover.
                  if (editando) {
                    if (!errata || !podeEditarLinhas) return null;
                    // Linha com save não se remove — `barrarRemocao`, em
                    // `actions-errata.ts`, recusa no servidor porque o
                    // `on delete cascade` de `saves_consumos` devolveria
                    // crédito ao job de origem em silêncio. Oferecer o
                    // botão fazia o usuário montar a errata inteira,
                    // escrever a descrição e só então tomar o erro — com
                    // a linha já sumida da tabela e sem desfazer
                    // (31/08/2026). O gate é o mesmo dos dois lados.
                    const travadaPorSave =
                      item.em_save === true ||
                      Number(item.save_consumido ?? 0) > 0;
                    // PP no financeiro trava a linha inteira (decisão
                    // 040) — remover inclusive. O servidor já recusava
                    // qualquer PP no histórico (`barrarRemocao`); a
                    // tela passa a dizer isso antes do clique.
                    const travadaPorPP = travadasPorPP.has(item.id);
                    const motivoDaTrava = travadaPorPP
                      ? MOTIVO_TRAVA_PP
                      : item.em_save
                        ? "Linha marcada como save: tire a marca antes de remover."
                        : "Linha paga com saldo de save de outro job: desfaça o consumo antes de remover.";
                    return (
                      <LinhaDaCalha
                        key={item.id}
                        posicao={posicoesCalha[`i:${item.id}`]}
                      >
                        <div
                          className={cn(
                            "pointer-events-auto flex items-center",
                            ALTURA_LINHA,
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => errata.remover(item.id)}
                            disabled={travadaPorSave || travadaPorPP}
                            title={
                              travadaPorSave || travadaPorPP
                                ? motivoDaTrava
                                : undefined
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground"
                          >
                            <Trash2 className="h-3 w-3" />
                            Remover
                          </button>
                        </div>
                      </LinhaDaCalha>
                    );
                  }

                  // ---- BV: tipos A, AR e D ----
                  const bv = bvsPorItem[item.id] ?? null;
                  // Sem BV num job congelado não há o que consultar — a
                  // vaga fica vazia para não desalinhar as de baixo.
                  // Linha em save não tem fornecedor neste job: sem BV a
                  // negociar e sem PP a emitir (decisão 028 §9). Os dois
                  // lados já são recusados no banco — aqui a calha nem
                  // oferece.
                  const emSave = item.em_save === true;
                  const mostraBv =
                    !emSave &&
                    aceitaBV(item.tipo_custo) &&
                    (podeAcoes || (!preAbertura && bv !== null));
                  const travado =
                    !podeAcoes || (bv !== null && bv.situacao !== "a_negociar");

                  // ---- PP: tipos de calha PP (AR, B, C, F, FI) ----
                  // Job congelado não gera nem consulta PP na planilha: a
                  // aba de Pedidos de Produção é quem guarda o histórico.
                  const realizado = realizadosMap.get(item.id);
                  const realizadoId = realizado?.id ?? "";
                  const ppsDoItem = ppsPorItemId.get(realizadoId) ?? [];

                  return (
                    <LinhaDaCalha
                      key={item.id}
                      posicao={posicoesCalha[`i:${item.id}`]}
                    >
                      <CalhaLinha
                        altura={ALTURA_LINHA}
                        bv={
                          mostraBv
                            ? acaoBv({
                                temBv: bv !== null,
                                itemNome: item.item,
                                somenteLeitura: travado,
                                onClick: () => setBvAberto(item),
                              })
                            : null
                        }
                        pp={
                          podeAcoes && !emSave && tipoGeraDesembolso(item.tipo_custo)
                            ? {
                                itemRealizadoId: realizadoId,
                                pedidos: ppsDoItem,
                                // PPs geradas e não enviadas: o círculo
                                // vermelho do chip (02/09/2026).
                                pendentes: contarPendentes(ppsDoItem),
                                otimista:
                                  ppsDoItem.length > 0
                                    ? null
                                    : ppsOtimistas.get(realizadoId) ?? null,
                                onAbrirPainel: abrirPainel,
                              }
                            : null
                        }
                      />
                    </LinhaDaCalha>
                  );
                })
              : null,
          )}
        </Calha>
      )}
      </div>

      {(podeAcoes || temRentab) && grupos.some((g) => estaAberto(g.id)) && (
        <div className="flex flex-col gap-1 rounded-b-2xl border-t border-border bg-muted/40 px-6 py-3">
          {podeAcoes && (
            <span className="text-[11px] text-muted-foreground">
              O Realizado não é digitado: ele é a soma dos Pedidos de Produção
              enviados ao financeiro no item — PP só gerada ainda não conta. Em
              custo <strong>A</strong> e <strong>D</strong>, que não geram PP,
              ele espelha o Orçado.
            </span>
          )}
          {temRentab && (
            <span className="text-[11px] text-muted-foreground">
              Rentabilidade = Orçado − custo, em R$ e % do orçado. Item sem PP
              emitida ainda não tem rentabilidade realizada; no grupo e no
              total, a realizada marcada com <strong>*</strong> conta só os
              itens que já têm PP.
            </span>
          )}
        </div>
      )}

      {(() => {
        const itemAtual = todosOsItens.find(
          (i) => (realizadosMap.get(i.id)?.id ?? "") === itemIdAtual,
        );
        // A referência do painel e do formulário é o PLANEJADO do item
        // (02/09/2026, decisão 039). Era o orçado; antes disso, o
        // realizado — que É a soma das PPs e se limitaria sozinho.
        const planejadoAtual = itemAtual
          ? Number(itemAtual.total_planejado ?? 0)
          : 0;
        // Decomposição do planejado — referência do cartão do formulário
        // de PP, que mostra "R$ Unit. × QT × D/M" de onde os campos vêm.
        const unitarioPlanejado = itemAtual
          ? Number(itemAtual.valor_unitario_planejado ?? 0)
          : 0;
        const quantidadePlanejada = itemAtual
          ? Number(itemAtual.quantidade_planejada ?? 0)
          : 0;
        const dmPlanejado = itemAtual
          ? Number(itemAtual.dias_meses_planejado ?? 0)
          : 0;
        const ppsDoItem = itemIdAtual
          ? (ppsPorItemId.get(itemIdAtual) ?? [])
          : [];
        // Só o que já chegou ao financeiro: a gerada conta na pendência.
        const emPPs = somaDasPPsEmitidas(ppsDoItem);

        return (
          <>
            <PainelPPsItem
              open={painelOpen}
              onOpenChange={setPainelOpen}
              itemNome={itemAtual?.item ?? ""}
              grupoNome={
                itemAtual ? grupoDoItem.get(itemAtual.id) ?? "" : ""
              }
              moeda={moeda}
              totalPlanejado={planejadoAtual}
              pps={ppsDoItem.map((pp) => ({
                id: pp.id,
                codigo: pp.codigo,
                status: pp.status,
                fornecedorNome: nomeContraparteBRPP({
                  verba_producao: pp.verba_producao,
                  fornecedor: pp.fornecedor_id ? { nome: nomeDoFornecedor(fornecedores, pp.fornecedor_id) } : null,
                  responsavel: pp.responsavel,
                }) || nomeDoFornecedor(fornecedores, pp.fornecedor_id ?? ""),
                valor: Number(pp.valor ?? 0),
                verbaProducao: pp.verba_producao === true,
                temAnexo: (pp.anexos ?? []).length > 0,
              }))}
              emPPs={emPPs}
              aberturaEmRevisao={aberturaEmRevisao}
              onNovaPP={
                podeAcoes
                  ? () => {
                      // O painel some enquanto o formulário está aberto:
                      // dois drawers empilhados na direita brigariam pelo
                      // mesmo espaço.
                      setPpEditando(null);
                      setPainelOpen(false);
                      setDrawerOpen(true);
                    }
                  : null
              }
              onEditar={
                podeAcoes
                  ? (pp) => {
                      const completa = ppsDoItem.find((x) => x.id === pp.id);
                      if (!completa) return;
                      setPpEditando(completa);
                      setPainelOpen(false);
                      setDrawerOpen(true);
                    }
                  : null
              }
              onMensagem={setToast}
            />

            <GerarPPDrawer
              open={drawerOpen}
              onOpenChange={(aberto) => {
                setDrawerOpen(aberto);
                if (!aberto) setPpEditando(null);
              }}
              itemRealizadoId={itemIdAtual}
              jobId={jobId}
              fornecedores={fornecedores}
              empresas={empresas}
              responsaveis={responsaveis}
              defaultEmpresaId={jobEmpresaId}
              itemDescricao={itemAtual?.item ?? ""}
              valorPlanejado={planejadoAtual}
              unitarioPlanejado={unitarioPlanejado}
              quantidadePlanejada={quantidadePlanejada}
              dmPlanejado={dmPlanejado}
              emPPsEmitidas={emPPs}
              ppEditando={ppEditando}
              onSuccess={(codigo, modo) => {
                if (modo === "editada") {
                  setToast(`${codigo} salva — segue gerada, no job.`);
                  return;
                }
                setToast(
                  `Pedido de Produção ${codigo} gerado. Envie ao financeiro pelo painel do item.`,
                );
                // Estado otimista: o chip da calha já conta a PP nova antes
                // do router.refresh() completar. Some sozinho quando a PP
                // real chega via prop (ppsPorItemId do server).
                if (itemIdAtual) {
                  setPpsOtimistas((prev) => {
                    const next = new Map(prev);
                    next.set(itemIdAtual, { codigo });
                    return next;
                  });
                }
              }}
            />
          </>
        );
      })()}

      {/* Mesmo formulário da tela de Orçamentos, na variante do job: o
          terceiro bloco é o Realizado e o rodapé ganha o Confirmar. */}
      {bvAberto &&
        (() => {
          const realizado = realizadosMap.get(bvAberto.id);
          const daPP = realizadoVemDasPPs(bvAberto.tipo_custo) || preAbertura;
          return (
            <BvDialog
              open
              onOpenChange={(o) => !o && setBvAberto(null)}
              item={bvAberto}
              grupoNome={grupoDoItem.get(bvAberto.id) ?? ""}
              versaoLabel={versaoLabel}
              categoriaNome={
                bvAberto.categoria_id
                  ? categoriasMap.get(bvAberto.categoria_id) ?? null
                  : null
              }
              moeda={moeda}
              bv={bvsPorItem[bvAberto.id] ?? null}
              fornecedores={fornecedores.map((f) => ({
                id: f.id,
                nome: f.razao_social ?? f.nome,
              }))}
              percentualImposto={percentualImposto}
              origem="job"
              realizado={{
                valorUnitario: daPP
                  ? Number(realizado?.valor_unitario_realizado ?? 0)
                  : Number(bvAberto.valor_unitario_orcado ?? 0),
                quantidade: daPP
                  ? Number(realizado?.quantidade_realizada ?? 0)
                  : Number(bvAberto.quantidade_orcada ?? 0),
                diasMeses: daPP
                  ? Number(realizado?.dias_meses_realizado ?? 0)
                  : Number(bvAberto.dias_meses_orcado ?? 0),
                total: blocosPorItem.get(bvAberto.id)?.realizado.bruto ?? 0,
              }}
              readOnly={!podeAcoes}
            />
          );
        })()}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated animate-in fade-in slide-in-from-bottom-2"
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
    </>
  );
}

/** Célula de leitura dos blocos Planejado e Realizado.
 *
 *  Substituiu a `CelulaRealNum`, que era um input disfarçado de célula.
 *  Zero vira travessão: "R$ 0,00" numa linha sem PP diria "custou zero",
 *  quando o que houve foi "ainda não se pediu nada". Seleciona, mas não
 *  abre — é o que "só leitura" quer dizer. */
function CelulaLeitura({
  valor,
  formato,
  moeda,
  className,
  nav,
  moldura,
}: {
  valor: number;
  formato?: "moeda";
  moeda?: string;
  className?: string;
  nav: NavDaCelula;
  moldura: string;
}) {
  const vazio = valor <= 0;
  return (
    <CelulaJob
      nav={nav}
      moldura={moldura}
      className={cn(
        "whitespace-nowrap text-right",
        className,
        vazio && "text-muted-foreground",
      )}
    >
      {vazio ? "—" : formato === "moeda" ? formatCurrency(valor, moeda) : valor}
    </CelulaJob>
  );
}

/** Célula de Total dos blocos que recebem BV.
 *
 *  Na vista Bruto é o Total de sempre. Na Líquido mostra o valor já
 *  descontado E a sub-linha que diz de quanto foi o desconto — é ela que
 *  torna a dedução auditável sem abrir o formulário do BV. */
function CelulaTotalComBv({
  bloco,
  visao,
  moeda,
  className,
  cor,
  corRotulo,
  nav,
  moldura,
}: {
  bloco: ValoresDoBloco;
  visao: VisaoBv;
  moeda: string;
  className?: string;
  cor: string;
  corRotulo: string;
  nav: NavDaCelula;
  moldura: string;
}) {
  const valor = valorNaVisao(bloco, visao);
  return (
    <CelulaJob
      nav={nav}
      moldura={moldura}
      className={cn("whitespace-nowrap text-right", className)}
    >
      <div className="flex flex-col items-end">
        <span
          className={cn(
            "font-mono text-xs font-semibold leading-[1.2]",
            bloco.bruto <= 0 && "text-muted-foreground",
          )}
        >
          {bloco.bruto > 0 ? formatCurrency(valor, moeda) : "—"}
        </span>
        {visao === "liquido" && bloco.bruto > 0 && (
          <SubLinhaBv
            deducao={bloco.deducaoBv}
            pendente={bloco.bvPendente}
            formatar={(v) => formatCurrency(v, moeda)}
            cor={cor}
            corRotulo={corRotulo}
          />
        )}
      </div>
    </CelulaJob>
  );
}

/** Os dois cabeçalhos da rentabilidade de um bloco — as últimas colunas
 *  dele, na cor do bloco como as outras. */
function CabecalhosRentabilidade({ bloco }: { bloco: Bloco }) {
  // Sem `whitespace-nowrap`, de propósito: com ele "RENTAB. %" vazava
  // para a coluna vizinha em produção (04/09/2026). Quebrando, vira duas
  // linhas — como "Total líquido" já faz — e cabe na coluna estreita.
  return (
    <>
      <th className={cn("text-right font-semibold px-2 py-2 leading-tight", bloco.cabecalhoMeio)}>
        Rentab. R$
      </th>
      <th className={cn("text-right font-semibold px-2 py-2 leading-tight", bloco.cabecalhoFim)}>
        Rentab. %
      </th>
    </>
  );
}

/** As duas células de rentabilidade de um bloco (R$ · %), numa linha de
 *  item, de grupo ou de total. As classes de fundo e fio vêm do bloco; os
 *  dois valores são grafite (`RENTAB_VALOR`), positivos ou negativos — a
 *  cor do bloco fica no cabeçalho, na faixa e no Total.
 *
 *  `temCusto` falso é "ainda não há custo lançado": travessão, e não
 *  "R$ 0,00 · 0%", que diria que a margem é zero. `parcial` marca a
 *  realizada de grupo/total que deixou item sem PP fora da conta. */
function CelulasRentabilidade({
  bloco,
  linha,
  orcado,
  custo,
  temCusto,
  parcial = false,
  moeda,
  selecao,
  linhaId,
  colunas,
}: {
  bloco: Bloco;
  linha: "item" | "grupo" | "total";
  orcado: number;
  custo: number;
  temCusto: boolean;
  parcial?: boolean;
  moeda: string;
  /** Só a linha de ITEM é navegável: grupo e total ficam fora da seleção. */
  selecao?: Selecao;
  linhaId?: string;
  colunas?: [string, string];
}) {
  const { rentabilidade, percentual } = calcularRentabilidade(orcado, custo);
  const classes =
    linha === "item"
      ? { valor: bloco.celulaMeio, pct: bloco.celulaTotal, texto: "text-xs font-semibold" }
      : linha === "grupo"
        ? { valor: bloco.grupoValor, pct: bloco.grupoValor, texto: "text-[13px] font-bold" }
        : { valor: bloco.subtotalValor, pct: bloco.subtotalValor, texto: "py-2 text-[13px] font-bold" };
  const base = cn(
    "px-3 text-right align-middle whitespace-nowrap font-mono",
    classes.texto,
  );
  const titulo = parcial
    ? "Rentabilidade parcial: há item sem PP emitida, fora desta conta."
    : undefined;
  const valorNode = temCusto ? (
    formatCurrency(rentabilidade, moeda)
  ) : (
    <span className="text-muted-foreground">—</span>
  );
  const pctNode =
    temCusto && percentual !== null ? (
      <>
        {formatarPercentual(percentual)}
        {parcial && " *"}
      </>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  if (selecao && linhaId && colunas) {
    return (
      <>
        <CelulaJob
          nav={selecao.celulaProps(linhaId, colunas[0])}
          moldura={selecao.moldura(linhaId, colunas[0])}
          className={cn(base, classes.valor, RENTAB_VALOR)}
          title={titulo}
        >
          {valorNode}
        </CelulaJob>
        <CelulaJob
          nav={selecao.celulaProps(linhaId, colunas[1])}
          moldura={selecao.moldura(linhaId, colunas[1])}
          className={cn(base, classes.pct, RENTAB_VALOR)}
          title={titulo}
        >
          {pctNode}
        </CelulaJob>
      </>
    );
  }
  return (
    <>
      <td className={cn(base, classes.valor, RENTAB_VALOR)} title={titulo}>
        {valorNode}
      </td>
      <td className={cn(base, classes.pct, RENTAB_VALOR)} title={titulo}>
        {pctNode}
      </td>
    </>
  );
}

/** A rentabilidade REALIZADA de um recorte (grupo ou planilha), contando
 *  só os itens que já têm realizado — decisão 045. Item com orçado e sem
 *  PP fica fora da base e marca a conta como parcial; a linha vermelha
 *  (sem orçado, só realizado) entra pelo custo, como o imprevisto que é;
 *  a linha em save (sem base e sem custo) não conta para nada. */
function rentabilidadeRealizadaDe(
  blocos: Array<{ orcadoRentabilidade: number; realizado: ValoresDoBloco }>,
  visao: VisaoBv,
): { orcado: number; custo: number; temCusto: boolean; parcial: boolean } {
  let orcado = 0;
  let custo = 0;
  let comRealizado = 0;
  let esperandoPP = 0;
  for (const b of blocos) {
    if (b.realizado.bruto > 0) {
      orcado += b.orcadoRentabilidade;
      custo += valorNaVisao(b.realizado, visao);
      comRealizado += 1;
    } else if (b.orcadoRentabilidade > 0) {
      esperandoPP += 1;
    }
  }
  return {
    orcado,
    custo,
    temCusto: comRealizado > 0,
    parcial: comRealizado > 0 && esperandoPP > 0,
  };
}
