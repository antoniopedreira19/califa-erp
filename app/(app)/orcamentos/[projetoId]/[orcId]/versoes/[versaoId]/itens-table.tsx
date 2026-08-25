"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularTotaisPlanejados } from "@/lib/calculos/versao-totais";
import {
  tipoCustoLabel,
  type TipoCusto,
  type VersaoOrcamentoItem,
  type Categoria,
  type ItemBv,
} from "@/lib/types";
import {
  adicionarItem,
  atualizarCampoItem,
  removerItem,
  type ActionResult,
} from "../actions";
import {
  ColunasFixas,
  LARGURA_MINIMA,
} from "@/app/(app)/_planilha/grade-orcamento";
import {
  celulaVizinha,
  direcaoDaTecla,
  direcaoNoCampo,
  type Direcao,
} from "@/app/(app)/_planilha/navegacao";
import {
  ORCADO,
  PLANEJADO,
  RENTABILIDADE,
  FAIXA_ROTULO,
  FAIXA_GRUPO,
  LINHA_GRUPO_NOME,
  LINHA_NOVO_GRUPO,
  LINHA_TOTAL_ROTULO,
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";
import {
  Calha,
  LinhaDaCalha,
  usePosicoesDaCalha,
} from "@/app/(app)/_planilha/calha";
import {
  BvDialog,
  type AdaptadorBv,
  type FornecedorOpcao,
} from "@/app/(app)/_bv/bv-dialog";
import {
  BvActionButton,
  LARGURA_CALHA_BV,
} from "@/app/(app)/_bv/bv-action-button";
import { aceitaBV, TIPOS_CUSTO } from "@/lib/calculos/versao-totais";
import {
  blocosDoItem,
  planejadoEspelhaOrcado,
  rotuloColunaTotal,
  somarBlocosDosItens,
  valorNaVisao,
  type VisaoBv,
} from "@/lib/calculos/bv-planilha";
import { SubLinhaBv } from "@/app/(app)/_planilha/chave-bruto-liquido";

/** Onde a grade grava.
 *
 *  Por padrão, nas Server Actions da versão. O editor de orçamento do
 *  projeto passa um adaptador que mexe no rascunho em memória — lá nada
 *  existe no banco até o "Salvar orçamentos", mas a planilha é a mesma e
 *  não pode ser reescrita só por causa do destino da escrita. */
export interface AdaptadorItens {
  atualizarCampo: (
    itemId: string,
    campo: string,
    valor: string | null,
  ) => Promise<ActionResult>;
  adicionar: (grupoId: string, formData: FormData) => Promise<ActionResult>;
  remover: (itemId: string) => Promise<ActionResult>;
  /** Recarrega a origem dos dados depois de cada escrita. No rascunho é
   *  no-op: o estado do React já é a fonte. */
  aposEscrita: () => void;
}

/** Um agrupamento da planilha, com os itens já separados. */
export interface GrupoDaPlanilha {
  id: string;
  nome: string;
  itens: VersaoOrcamentoItem[];
}

interface Props {
  /** TODOS os agrupamentos da planilha, na ordem em que aparecem.
   *
   *  Até 24/08/2026 este componente desenhava UM grupo, e a tela
   *  empilhava um card por grupo. O handoff "Planilha Interna - Grupos
   *  Unificados" juntou tudo numa tabela só: um cabeçalho de colunas,
   *  uma calha de números, e cada grupo virando uma linha que carrega o
   *  próprio subtotal. */
  grupos: GrupoDaPlanilha[];
  moeda: string;
  /** Alíquota da versão — vira o BV líquido descontado na vista Líquido. */
  percentualImposto: number;
  /** Bruto (padrão) ou Líquido (− BV). Decidida uma vez por página. */
  visao: VisaoBv;
  readOnly?: boolean;
  categorias: Categoria[];
  /** BV por id do item. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  /** Ausente ⇒ grava direto nas Server Actions da versão. */
  adaptador?: AdaptadorItens;
  /** Repassado ao formulário de BV; mesma regra do adaptador acima. */
  adaptadorBv?: AdaptadorBv;
  /** Grupo recolhido esconde as linhas, o "Novo item" e as ações de item.
   *  A linha do grupo — com o subtotal e a rentabilidade — continua à
   *  vista: é ela que justifica recolher. */
  estaAberto: (grupoId: string) => boolean;
  onAlternarGrupo: (grupoId: string) => void;
  /** O NOME do grupo dentro da linha dele. Só o nome: o chevron e o
   *  contador de itens são iguais em toda tela e saem daqui de dentro.
   *  Quem passa isto é a tela, porque renomear muda de mecanismo entre
   *  elas — Server Action na versão, estado local no rascunho. */
  nomeDoGrupo?: (grupo: GrupoDaPlanilha) => React.ReactNode;
  /** Ações do grupo (remover) — vão para a calha à direita, na altura da
   *  linha do grupo, no mesmo eixo das lixeiras de item. */
  acoesDoGrupo?: (grupo: GrupoDaPlanilha) => React.ReactNode;
  /** Gatilho de "Novo grupo", na linha tracejada que fecha o corpo da
   *  tabela. Ausente ⇒ a linha não existe (versão congelada). */
  novoGrupo?: React.ReactNode;
  /** BASE do rótulo do pé da tabela. Default: "Total do orçamento". A
   *  vista Líquido acrescenta o sufixo sozinha, para o rótulo não ter que
   *  ser reescrito em cada tela. */
  rotuloTotal?: string;
}

/** Campos que a grade edita — espelha o allowlist do server action. */
type Campo =
  | "item"
  | "tipo_custo"
  | "categoria_id"
  | "valor_unitario_orcado"
  | "quantidade_orcada"
  | "dias_meses_orcado"
  | "valor_unitario_planejado"
  | "quantidade_planejada"
  | "dias_meses_planejado";

/** Ordem em que o Tab percorre a linha — a mesma da tela, da esquerda
 *  para a direita. Total e Rentabilidade não entram porque são calculadas:
 *  o Tab passa por cima delas sem precisar saber que existem. */
const CAMPOS_NAVEGAVEIS: readonly Campo[] = [
  "item",
  "tipo_custo",
  "categoria_id",
  "valor_unitario_orcado",
  "quantidade_orcada",
  "dias_meses_orcado",
  "valor_unitario_planejado",
  "quantidade_planejada",
  "dias_meses_planejado",
];

/** As três colunas do bloco PLANEJADO — as que `A` e `D` travam. */
const CAMPOS_PLANEJADO: readonly Campo[] = [
  "valor_unitario_planejado",
  "quantidade_planejada",
  "dias_meses_planejado",
];

type ValorCampo = string | number | null;

/** Célula em edição.
 *
 *  `porTeclado` distingue a célula que o Tab abriu da que o clique
 *  abriu: só na primeira o `<select>` continua a navegação sozinho
 *  depois da escolha. */
type CelulaAtiva = {
  rowId: string;
  campo: Campo;
  porTeclado?: boolean;
} | null;

type Overrides = Record<string, Partial<Record<Campo, ValorCampo>>>;

/** Radix Select não aceita value="" — sentinela para "sem categoria". */
const SEM_CATEGORIA = "__nenhuma__";
const DRAFT_ID = "__draft__";

/** Altura fixa da linha de item. A calha à direita não depende mais
 *  disto — ela mede cada linha —, mas a grade continua respirando melhor
 *  com a altura travada do que deixando o conteúdo decidir. */
const ALTURA_LINHA = "h-7";

/** Fio vertical entre as colunas neutras (Item, Tipo, Categoria). */
const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";

/** Recuo dos itens sob a linha do grupo. É ele que faz a hierarquia
 *  aparecer sem precisar de card por agrupamento. */
const RECUO_ITEM = "pl-[30px]";

/** 2px menor que a linha (28px), como no handoff — o campo respira dentro
 *  da célula em vez de encostar nas bordas. */
const CAMPO_CLASSES =
  "h-[26px] w-full rounded-md border border-california-red/40 bg-white px-2 text-xs outline-none focus:border-california-red";

interface Draft {
  /** A que grupo a linha nova pertence. Com uma tabela só para a planilha
   *  inteira, o rascunho precisa dizer onde nasceu. */
  grupoId: string;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
}

/** Planejado nasce igual ao orçado (0 · 1 · 1): a linha nova é uma folha
 *  em branco nos dois blocos, e não um planejado zerado ao lado de um
 *  orçado preenchido. */
function draftVazio(grupoId: string): Draft {
  return {
    grupoId,
    item: "",
    tipo_custo: "B",
    categoria_id: null,
    valor_unitario_orcado: 0,
    quantidade_orcada: 1,
    dias_meses_orcado: 1,
    valor_unitario_planejado: 0,
    quantidade_planejada: 1,
    dias_meses_planejado: 1,
  };
}

/** A linha nova ainda em branco — nenhum campo saiu do estado de
 *  nascimento. É por este teste que ela some sozinha no Esc e em
 *  qualquer clique fora dela: enquanto ninguém digitou nada, a linha não
 *  é um item, é só o cursor esperando. Digitou qualquer coisa (inclusive
 *  um valor sem descrição), ela fica na tela até o usuário decidir. */
function draftIntocado(d: Draft): boolean {
  const zero = draftVazio(d.grupoId);
  return (Object.keys(zero) as Array<keyof Draft>).every(
    (campo) => d[campo] === zero[campo],
  );
}

/** Aceita "1.234,56" e "1234.56". Vírgula presente ⇒ ponto é milhar. */
function parseNumero(raw: string): number | null {
  const limpo = raw.trim();
  if (limpo === "") return 0;
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Número cru para digitação: vírgula decimal, sem separador de milhar. */
function paraEdicao(valor: number): string {
  if (!Number.isFinite(valor)) return "";
  return String(valor).replace(".", ",");
}

/** Rentabilidade de uma linha (ou do subtotal) pela fórmula oficial da
 *  versão — mesma função do card de Totais. */
function rentabilidadeDe(orcado: number, planejado: number) {
  return calcularTotaisPlanejados([
    { total_orcado: orcado, total_planejado: planejado },
  ]);
}

/** Mesmo formato do card de Totais: uma casa decimal, vírgula decimal. */
function formatarPercentual(percentual: number): string {
  return `${percentual.toFixed(1).replace(".", ",")}%`;
}

function num(v: ValorCampo): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function mesmoValor(a: ValorCampo, b: ValorCampo): boolean {
  if (typeof a === "number" || typeof b === "number") return num(a) === num(b);
  return (a ?? null) === (b ?? null);
}

export function ItensTable({
  grupos,
  moeda,
  percentualImposto,
  visao,
  readOnly,
  categorias,
  bvsPorItem,
  fornecedores,
  versaoLabel,
  adaptador,
  adaptadorBv,
  estaAberto,
  onAlternarGrupo,
  nomeDoGrupo,
  acoesDoGrupo,
  novoGrupo,
  rotuloTotal,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  /** Direcao padrão das escritas: o banco, via Server Actions. */
  const acoes = React.useMemo<AdaptadorItens>(
    () =>
      adaptador ?? {
        atualizarCampo: atualizarCampoItem,
        adicionar: adicionarItem,
        remover: removerItem,
        aposEscrita: () => router.refresh(),
      },
    [adaptador, router],
  );
  const [ativa, setAtiva] = React.useState<CelulaAtiva>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [removendo, setRemovendo] =
    React.useState<VersaoOrcamentoItem | null>(null);
  const [bvAberto, setBvAberto] = React.useState<VersaoOrcamentoItem | null>(
    null,
  );

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const persistindoRef = React.useRef(false);

  const editavel = !readOnly;

  /** Todos os itens da planilha, achatados — a navegação e a busca por
   *  id atravessam os grupos e não podem depender de qual card era. */
  const itensPorId = React.useMemo(() => {
    const mapa = new Map<string, VersaoOrcamentoItem>();
    for (const g of grupos) for (const it of g.itens) mapa.set(it.id, it);
    return mapa;
  }, [grupos]);

  const todosOsItens = React.useMemo(
    () => grupos.flatMap((g) => g.itens),
    [grupos],
  );

  // A calha vive fora do frame da tabela e agora acompanha linhas de
  // alturas diferentes (grupo, item, "Novo item"). Medir é a única forma
  // de acertar — ver o cabeçalho de `_planilha/calha`.
  const posicoesCalha = usePosicoesDaCalha(wrapperRef, [
    grupos,
    draft,
    readOnly,
    visao,
    // Recolher/expandir muda o que existe no DOM e, com isso, todos os
    // offsets abaixo do grupo que se moveu.
    grupos.map((g) => (estaAberto(g.id) ? "1" : "0")).join(""),
  ]);

  // O handler de clique-fora lê o rascunho por ref, e não pela closure:
  // ver o porquê logo abaixo.
  const draftRef = React.useRef(draft);
  draftRef.current = draft;
  const descarteAgendado = React.useRef<ReturnType<typeof setTimeout>>();

  // Enquanto a linha nova estiver em branco, qualquer clique fora dela a
  // descarta: ela ainda não é um item, é só o cursor esperando alguém
  // digitar. `pointerdown` e não `click` porque o clique numa outra
  // célula já teria aberto a edição de lá antes de o descarte acontecer.
  // Ficam de fora a própria linha e o menu do Radix, que abre em portal
  // fora da tabela — escolher um Tipo não pode matar a linha.
  //
  // O descarte espera um tique porque o campo em edição só entrega o que
  // foi digitado no `blur`, e o navegador dispara o `blur` DEPOIS deste
  // handler. Matar a linha aqui apagaria a descrição recém-digitada
  // antes de ela ser gravada.
  //
  // Daí a inscrição ser de mount, com `[]`: o `blur` chama `setDraft` com
  // um objeto NOVO, e um efeito que dependesse de `draft` se
  // reinscreveria no meio do caminho — a limpeza cancelaria o descarte
  // que acabou de ser agendado, e a linha em branco ficaria na tela.
  // Defeito real, visto no navegador em 25/08/2026: com clique
  // sintético (sem troca de foco) passava, com clique de verdade não.
  React.useEffect(() => {
    const aoApontar = (e: PointerEvent) => {
      const atual = draftRef.current;
      if (!atual || !draftIntocado(atual)) return;

      const alvo = e.target instanceof Element ? e.target : null;
      if (
        alvo?.closest(`[data-calha="${DRAFT_ID}"]`) ||
        alvo?.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }

      descarteAgendado.current = setTimeout(() => {
        setDraft((d) => (d && draftIntocado(d) ? null : d));
        setAtiva((ativa) => (ativa?.rowId === DRAFT_ID ? null : ativa));
      }, 0);
    };

    document.addEventListener("pointerdown", aoApontar);
    return () => {
      document.removeEventListener("pointerdown", aoApontar);
      clearTimeout(descarteAgendado.current);
    };
  }, []);

  // Descarta o valor otimista quando o servidor já devolveu o mesmo valor.
  React.useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Overrides = {};
      for (const item of todosOsItens) {
        const campos = prev[item.id];
        if (!campos) continue;
        const restante: Partial<Record<Campo, ValorCampo>> = {};
        for (const [campo, valor] of Object.entries(campos)) {
          const doServidor = item[campo as Campo] as ValorCampo;
          if (!mesmoValor(doServidor, valor as ValorCampo)) {
            restante[campo as Campo] = valor as ValorCampo;
          }
        }
        if (Object.keys(restante).length > 0) next[item.id] = restante;
      }
      return next;
    });
  }, [todosOsItens]);

  function valorAtual(item: VersaoOrcamentoItem, campo: Campo): ValorCampo {
    const campos = overrides[item.id];
    if (campos && campo in campos) return campos[campo] as ValorCampo;
    return item[campo] as ValorCampo;
  }

  function totaisDoItem(item: VersaoOrcamentoItem) {
    // Sem edição pendente usa o valor GENERATED do banco; com edição,
    // recalcula na hora (valor × qtd × dias/meses).
    const orcado = overrides[item.id]
      ? num(valorAtual(item, "valor_unitario_orcado")) *
        num(valorAtual(item, "quantidade_orcada")) *
        num(valorAtual(item, "dias_meses_orcado"))
      : Number(item.total_orcado);

    // Em `A` e `D` o planejado É o orçado — inclusive enquanto o usuário
    // ainda está digitando o orçado, para o espelho não piscar atrasado.
    if (planejadoEspelhaOrcado(
      String(valorAtual(item, "tipo_custo")) as VersaoOrcamentoItem["tipo_custo"],
    )) {
      return { orcado, planejado: orcado };
    }

    const planejado = overrides[item.id]
      ? num(valorAtual(item, "valor_unitario_planejado")) *
        num(valorAtual(item, "quantidade_planejada")) *
        num(valorAtual(item, "dias_meses_planejado"))
      : Number(item.total_planejado);

    return { orcado, planejado };
  }

  /** Os blocos da linha, com a dedução de BV separada. No orçamento não
   *  há realizado — só o par orçado × planejado importa aqui. */
  function blocosDe(item: VersaoOrcamentoItem) {
    const totais = totaisDoItem(item);
    return blocosDoItem(
      {
        tipo_custo: String(
          valorAtual(item, "tipo_custo"),
        ) as VersaoOrcamentoItem["tipo_custo"],
        total_orcado: totais.orcado,
        total_planejado: totais.planejado,
        bv_liquido_planejado: item.bv_liquido_planejado,
      },
      bvsPorItem[item.id] ?? null,
      0,
      percentualImposto,
    );
  }

  /** Ordem das linhas para a navegação — a planilha INTEIRA, e não mais
   *  um grupo de cada vez (decisão do Tiago, 24/08/2026). O Tab que sai
   *  do último item de um grupo cai no primeiro do grupo seguinte, que é
   *  o comportamento de planilha de verdade. Grupo recolhido não tem
   *  linha na tela: fica fora da lista e o Tab pula por cima dele.
   *
   *  A linha nova entra logo depois do último item DO GRUPO DELA, que é
   *  onde ela aparece. */
  const linhasNavegaveis = React.useMemo(() => {
    const ids: string[] = [];
    for (const g of grupos) {
      if (!estaAberto(g.id)) continue;
      for (const it of g.itens) ids.push(it.id);
      if (draft?.grupoId === g.id) ids.push(DRAFT_ID);
    }
    return ids;
  }, [grupos, draft, estaAberto]);

  /** Último item visível de cada grupo → id do grupo dele. É por aqui
   *  que o Enter/↓ da última linha sabe que o destino não é o primeiro
   *  item do grupo de baixo, e sim o "Novo item" DESTE grupo. */
  const grupoDoUltimoItem = React.useMemo(() => {
    const mapa = new Map<string, string>();
    for (const g of grupos) {
      if (!estaAberto(g.id)) continue;
      const ultimo = g.itens[g.itens.length - 1];
      if (ultimo) mapa.set(ultimo.id, g.id);
    }
    return mapa;
  }, [grupos, estaAberto]);

  /** As três colunas de PLANEJADO travadas nesta linha.
   *
   *  Em `A` e `D` o planejado espelha o orçado e não se digita — o Tab
   *  precisa PULAR essas células, senão a navegação morre numa célula
   *  que não abre para edição. A linha nova (draft) nasce sem tipo
   *  definido, então nunca trava. */
  const planejadoTravadoEm = React.useCallback(
    (rowId: string): boolean => {
      const item = itensPorId.get(rowId);
      if (!item) return false;
      const campos = overrides[rowId];
      const tipo =
        campos && "tipo_custo" in campos
          ? campos.tipo_custo
          : item.tipo_custo;
      return planejadoEspelhaOrcado(
        String(tipo) as VersaoOrcamentoItem["tipo_custo"],
      );
    },
    [itensPorId, overrides],
  );

  /** Para onde o teclado leva a partir daqui. `null` encerra a edição. */
  const celulaDirecao = React.useCallback(
    (rowId: string, campo: Campo, destino?: Direcao): CelulaAtiva => {
      if (!destino) return null; // blur / clique fora: só confirma e sai

      // Enter/↓ na última linha do grupo abre o "Novo item" DELE em vez
      // de cair no grupo seguinte (pedido do Tiago, 25/08/2026): é assim
      // que se acrescenta item sem tirar a mão do teclado. O cursor vai
      // para a descrição, que é o campo sem o qual a linha não grava.
      // Rascunho já aberto em OUTRO grupo e ainda em branco é
      // descartado no caminho — em branco ele não vale nada.
      if (destino === "abaixo" && editavel) {
        const grupoId = grupoDoUltimoItem.get(rowId);
        if (
          grupoId &&
          (!draft ||
            (draft.grupoId !== grupoId && draftIntocado(draft)))
        ) {
          setDraft(draftVazio(grupoId));
          return { rowId: DRAFT_ID, campo: "item", porTeclado: true };
        }
      }

      let alvo = celulaVizinha(
        linhasNavegaveis,
        CAMPOS_NAVEGAVEIS,
        { linhaId: rowId, campo },
        destino,
      );

      // Anda até sair de célula travada. O teto é o tamanho da grade:
      // uma planilha inteira de itens `A` não pode virar laço infinito —
      // aí não há para onde ir e a edição encerra.
      const teto = linhasNavegaveis.length * CAMPOS_NAVEGAVEIS.length;
      for (let i = 0; alvo && i < teto; i++) {
        const travada =
          CAMPOS_PLANEJADO.includes(alvo.campo) &&
          planejadoTravadoEm(alvo.linhaId);
        if (!travada) break;
        alvo = celulaVizinha(
          linhasNavegaveis,
          CAMPOS_NAVEGAVEIS,
          alvo,
          destino,
        );
      }

      return alvo
        ? { rowId: alvo.linhaId, campo: alvo.campo, porTeclado: true }
        : null;
    },
    [linhasNavegaveis, planejadoTravadoEm, grupoDoUltimoItem, draft, editavel],
  );

  function gravar(
    itemId: string,
    campo: Campo,
    valor: ValorCampo,
    proxima: CelulaAtiva,
  ) {
    const anterior = overrides[itemId];
    setErro(null);
    setAtiva(proxima);
    setOverrides((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], [campo]: valor },
    }));

    const reverter = () =>
      setOverrides((prev) => {
        const next = { ...prev };
        if (anterior) next[itemId] = anterior;
        else delete next[itemId];
        return next;
      });

    startTransition(async () => {
      try {
        const res = await acoes.atualizarCampo(
          itemId,
          campo,
          valor === null ? null : String(valor),
        );
        if (!res.ok) {
          reverter();
          setErro(res.message);
          return;
        }
        acoes.aposEscrita();
      } catch (e) {
        // Falha de rede: sem reverter, a célula mostraria para sempre um
        // valor que não está no banco. Repassa o erro para o Next tratar
        // (inclusive o redirect de sessão expirada).
        reverter();
        throw e;
      }
    });
  }

  /** Confirma uma célula de item já existente e move o foco. */
  function confirmarCampo(
    item: VersaoOrcamentoItem,
    campo: Campo,
    valor: ValorCampo,
    destino?: Direcao,
  ) {
    const proxima = celulaDirecao(item.id, campo, destino);
    // Valor igual não vira escrita — mas a navegação acontece do mesmo
    // jeito, senão passar por uma célula sem alterar nada mataria o Tab.
    if (mesmoValor(valorAtual(item, campo), valor)) {
      setAtiva(proxima);
      return;
    }
    gravar(item.id, campo, valor, proxima);
  }

  function confirmarNumero(
    item: VersaoOrcamentoItem,
    campo: Campo,
    raw: string,
    destino?: Direcao,
  ) {
    const n = parseNumero(raw);
    if (n === null) {
      // Entrada inválida interrompe a navegação de propósito: seguir em
      // frente esconderia o aviso atrás da próxima célula.
      setAtiva(null);
      setErro("Valor inválido — a célula foi mantida como estava.");
      return;
    }
    confirmarCampo(item, campo, n, destino);
  }

  /** Fecha a célula SE ela ainda for a ativa.
   *
   *  O `<select>` avisa que fechou também quando é desmontado pela
   *  navegação — sem esta guarda, o aviso de fechamento chegaria depois
   *  do `setAtiva` da próxima célula e cancelaria o Tab. */
  const fecharCelula = React.useCallback((rowId: string, campo: Campo) => {
    // Updater, e não leitura direta: o Radix avisa que fechou no mesmo
    // tick em que a escolha já mandou a edição para a próxima célula, e
    // sem olhar o estado MAIS RECENTE este aviso atrasado fecharia a
    // célula errada — matando o Tab que acabou de acontecer.
    setAtiva((atual) =>
      atual && atual.rowId === rowId && atual.campo === campo ? null : atual,
    );
  }, []);

  /** Salva a linha nova assim que ela tem descrição.
   *  O ref é trava de reentrância: sem ela, qualquer re-execução do
   *  handler insere o item de novo. */
  function persistirDraft(d: Draft, proxima: CelulaAtiva) {
    if (persistindoRef.current) return;
    persistindoRef.current = true;

    const formData = new FormData();
    formData.set("item", d.item);
    formData.set("tipo_custo", d.tipo_custo);
    if (d.categoria_id) formData.set("categoria_id", d.categoria_id);
    formData.set("valor_unitario_orcado", String(d.valor_unitario_orcado));
    formData.set("quantidade_orcada", String(d.quantidade_orcada));
    formData.set("dias_meses_orcado", String(d.dias_meses_orcado));
    formData.set(
      "valor_unitario_planejado",
      String(d.valor_unitario_planejado),
    );
    formData.set("quantidade_planejada", String(d.quantidade_planejada));
    formData.set("dias_meses_planejado", String(d.dias_meses_planejado));

    startTransition(async () => {
      try {
        const res = await acoes.adicionar(d.grupoId, formData);
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        setDraft(null);
        // A linha nova troca de identidade ao ser salva: o `__draft__`
        // deixa de existir e nasce um item com id do banco. Sem religar o
        // destino a esse id, o Tab que disparou o salvamento cairia numa
        // linha que não está mais na tela e a edição morreria no meio da
        // digitação. As três origens de escrita (banco, multi-jobs e
        // agregado) devolvem o id justamente para isto.
        setAtiva(
          proxima && proxima.rowId === DRAFT_ID && res.id
            ? { rowId: res.id, campo: proxima.campo }
            : proxima,
        );
        acoes.aposEscrita();
      } finally {
        // Sem o finally, uma falha de rede deixaria a trava presa e o
        // "Novo item" morto até recarregar a página.
        persistindoRef.current = false;
      }
    });
  }

  function confirmarDraft(campo: Campo, valor: ValorCampo, destino?: Direcao) {
    if (!draft) return;
    const atualizado = { ...draft, [campo]: valor } as Draft;
    const proxima = celulaDirecao(DRAFT_ID, campo, destino);
    setErro(null);
    setDraft(atualizado);
    // Sem descrição o banco recusa: a linha fica local até ter texto, e a
    // navegação segue dentro do próprio rascunho.
    if (atualizado.item.trim().length > 0) {
      persistirDraft(atualizado, proxima);
      return;
    }
    setAtiva(proxima);
  }

  function confirmarDraftNumero(campo: Campo, raw: string, destino?: Direcao) {
    const n = parseNumero(raw);
    if (n === null) {
      setAtiva(null);
      setErro("Valor inválido — a célula foi mantida como estava.");
      return;
    }
    confirmarDraft(campo, n, destino);
  }

  function handleRemoveConfirm() {
    if (!removendo) return;
    const alvo = removendo;
    startTransition(async () => {
      const res = await acoes.remover(alvo.id);
      if (!res.ok) setErro(res.message);
      setRemovendo(null);
      acoes.aposEscrita();
    });
  }

  /** Abre a linha nova NO grupo pedido, com o cursor na descrição. */
  function abrirDraft(grupoId: string) {
    setDraft(draftVazio(grupoId));
    setAtiva({ rowId: DRAFT_ID, campo: "item" });
  }

  /** Esc numa célula da linha nova: em branco, ela some junto. */
  const descartarDraftIntocado = React.useCallback(() => {
    setDraft((atual) => (atual && draftIntocado(atual) ? null : atual));
  }, []);

  /** O BV existe em A, AR e D — os tipos em que há comissão a negociar
   *  com o fornecedor. O AR entrou em 13/08/2026: nele o principal passa
   *  pela California e ainda assim há comissão. Usa o valor otimista:
   *  mudar o tipo na célula acende/apaga o botão na hora.
   *
   *  Aqui a pílula nunca se divide, mesmo em AR: a PP nasce do realizado
   *  do job (`pedidos_compra` referencia `job_itens_realizado`), e no
   *  orçamento nada disso existe ainda. A calha dividida é da planilha do
   *  job. */
  const temBv = (item: VersaoOrcamentoItem) =>
    aceitaBV(String(valorAtual(item, "tipo_custo")));

  /** Subtotais de cada grupo e o fechamento da planilha inteira — a
   *  mesma conta, aplicada a recortes diferentes da mesma lista. */
  const subtotaisPorGrupo = React.useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof somarBlocosDosItens>>();
    for (const g of grupos) {
      mapa.set(g.id, somarBlocosDosItens(g.itens.map(blocosDe)));
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, overrides, bvsPorItem, percentualImposto]);

  const totaisDaPlanilha = React.useMemo(
    () => somarBlocosDosItens(todosOsItens.map(blocosDe)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todosOsItens, overrides, bvsPorItem, percentualImposto],
  );

  const totalOrcado = totaisDaPlanilha.orcado;
  const totalPlanejado = valorNaVisao(totaisDaPlanilha.planejado, visao);
  const {
    rentabilidade: resultadoTotal,
    percentualRentabilidade: percentualTotal,
  } = rentabilidadeDe(totalOrcado, totalPlanejado);

  const rotuloDoTotal = `${rotuloTotal ?? "Total do orçamento"}${
    visao === "liquido" ? " · líquido (− BV)" : ""
  }`;

  // Em versão congelada a calha não some: ela ainda mostra os BVs já
  // lançados, em modo consulta. Sem nada a mostrar, não há calha.
  const temBvVisivel = todosOsItens.some((it) => bvsPorItem[it.id]);
  const temCalha = editavel || temBvVisivel;

  /** A barra de dica só faz sentido com células à vista. */
  const temDica = editavel && grupos.some((g) => estaAberto(g.id));

  return (
    <>
      {/* O card da planilha inteira. Ele mora AQUI, e não no chamador,
          porque desde 25/08/2026 a dica de teclado fica FORA dele — e um
          componente não consegue devolver nada fora do próprio card se
          quem desenha o card é quem o chama. Sem `overflow-hidden`: a
          calha de ações precisa escapar do frame, e são os filhos que
          arredondam os cantos. */}
      <div
        ref={wrapperRef}
        className="relative rounded-2xl border border-border bg-card shadow-soft"
      >
        {erro && (
          <div className="flex items-center justify-between gap-3 rounded-t-2xl border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
            <span>{erro}</span>
            <button
              type="button"
              onClick={() => setErro(null)}
              className="rounded-md p-1 hover:bg-california-red/10"
              title="Fechar aviso"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* A tabela fecha o card sozinha: abaixo dela não há mais nada
            dentro do frame. */}
        <div
          className={cn(
            "overflow-x-auto rounded-b-2xl",
            !erro && "rounded-t-2xl",
          )}
        >
          <table
            className={cn("w-full table-fixed text-sm border-collapse", LARGURA_MINIMA)}
          >
            <ColunasFixas />
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {/* Linha 1 — a faixa dos blocos. Ela é UMA para a planilha
                  inteira: era esta repetição, um cabeçalho por grupo, que
                  o handoff "Grupos Unificados" veio eliminar. */}
              <tr>
                <th colSpan={3} className={FAIXA_GRUPO} />
                <th colSpan={4} className={cn(FAIXA_ROTULO, ORCADO.faixa)}>
                  ORÇADO
                </th>
                <th colSpan={4} className={cn(FAIXA_ROTULO, PLANEJADO.faixa)}>
                  PLANEJADO
                </th>
                <th
                  colSpan={2}
                  className={cn(FAIXA_ROTULO, RENTABILIDADE.faixa)}
                >
                  RENTABILIDADE
                </th>
              </tr>

              {/* Linha 2 — sub-cabeçalho de colunas */}
              <tr className="bg-muted/40">
                <th className="text-left font-semibold px-3 py-2 border-r border-r-border">
                  Grupo · Item
                </th>
                <th className="text-left font-semibold px-3 py-2 border-r border-r-border">
                  Tipo
                </th>
                <th className="text-left font-semibold px-3 py-2">Categoria</th>
                {/* bloco ORÇADO */}
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    ORCADO.cabecalhoAbre,
                  )}
                >
                  R$ Unit.
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    ORCADO.cabecalhoMeio,
                  )}
                >
                  QT
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    ORCADO.cabecalhoMeio,
                  )}
                >
                  D/M
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    ORCADO.cabecalhoFim,
                  )}
                >
                  Total
                </th>
                {/* bloco PLANEJADO */}
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoAbre,
                  )}
                >
                  R$ Unit.
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoMeio,
                  )}
                >
                  QT
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoMeio,
                  )}
                >
                  D/M
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    PLANEJADO.cabecalhoFim,
                  )}
                >
                  {rotuloColunaTotal(visao)}
                </th>
                {/* bloco RENTABILIDADE */}
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    RENTABILIDADE.cabecalhoAbre,
                  )}
                >
                  R$
                </th>
                <th
                  className={cn(
                    "text-right font-semibold px-3 py-2",
                    RENTABILIDADE.cabecalhoFim,
                  )}
                >
                  %
                </th>
              </tr>
            </thead>

            <tbody>
              {grupos.map((grupo) => {
                const aberto = estaAberto(grupo.id);
                const sub =
                  subtotaisPorGrupo.get(grupo.id) ??
                  somarBlocosDosItens([]);
                const subOrcado = sub.orcado;
                const subPlanejado = valorNaVisao(sub.planejado, visao);
                const {
                  rentabilidade: subResultado,
                  percentualRentabilidade: subPercentual,
                } = rentabilidadeDe(subOrcado, subPlanejado);

                return (
                  <React.Fragment key={grupo.id}>
                    {/* A LINHA DO GRUPO: nome à esquerda e o subtotal já
                        alinhado às colunas Total de cada bloco. Era o
                        `tfoot` de um card inteiro; agora é uma linha. */}
                    <tr data-calha={`g:${grupo.id}`} className="h-10">
                      <td colSpan={3} className={LINHA_GRUPO_NOME}>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => onAlternarGrupo(grupo.id)}
                            title={
                              aberto
                                ? "Ocultar itens do grupo"
                                : "Mostrar itens do grupo"
                            }
                            aria-expanded={aberto}
                            className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white hover:text-california-red"
                          >
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform duration-150",
                                !aberto && "-rotate-90",
                              )}
                            />
                          </button>
                          {nomeDoGrupo ? (
                            nomeDoGrupo(grupo)
                          ) : (
                            <TruncateTooltip
                              text={grupo.nome}
                              className="text-[13.5px] font-bold tracking-[-0.01em] text-foreground"
                            />
                          )}
                          <span className="flex-none whitespace-nowrap text-[11px] text-muted-foreground">
                            {grupo.itens.length}{" "}
                            {grupo.itens.length === 1 ? "item" : "itens"}
                            {!aberto && grupo.itens.length > 0 && " ocultos"}
                          </span>
                        </div>
                      </td>
                      <td colSpan={3} className={ORCADO.grupoVazio} />
                      <td
                        className={cn(
                          "px-3 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                          ORCADO.grupoValor,
                        )}
                      >
                        {formatCurrency(subOrcado, moeda)}
                      </td>
                      <td colSpan={3} className={PLANEJADO.grupoVazio} />
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
                          {/* A soma dos BVs de todos os itens do grupo. */}
                          {visao === "liquido" && (
                            <SubLinhaBv
                              deducao={sub.planejado.deducaoBv}
                              formatar={(v) => formatCurrency(v, moeda)}
                              cor={PLANEJADO.texto}
                              corRotulo={PLANEJADO.textoSuave}
                            />
                          )}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "px-3 text-right whitespace-nowrap font-mono text-xs font-semibold",
                          RENTABILIDADE.bordaAbre,
                          RENTABILIDADE.grupoValor,
                        )}
                      >
                        {formatCurrency(subResultado, moeda)}
                      </td>
                      <td
                        className={cn(
                          "px-3 text-right whitespace-nowrap font-mono text-xs font-semibold",
                          RENTABILIDADE.grupoValor,
                        )}
                      >
                        {subPercentual === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          formatarPercentual(subPercentual)
                        )}
                      </td>
                    </tr>

                    {aberto &&
                      grupo.itens.length === 0 &&
                      draft?.grupoId !== grupo.id && (
                        <tr className="border-b border-border">
                          <td
                            colSpan={13}
                            className="py-5 pl-[30px] pr-3 text-xs text-muted-foreground"
                          >
                            Sem itens neste grupo ainda.
                          </td>
                        </tr>
                      )}

                    {aberto &&
                      grupo.itens.map((item) => {
                        const totais = totaisDoItem(item);
                        const blocos = blocosDe(item);
                        const planejadoNaVisao = valorNaVisao(
                          blocos.planejado,
                          visao,
                        );
                        const planejadoTravado = planejadoEspelhaOrcado(
                          String(
                            valorAtual(item, "tipo_custo"),
                          ) as VersaoOrcamentoItem["tipo_custo"],
                        );
                        const categoriaId = valorAtual(item, "categoria_id") as
                          | string
                          | null;
                        const categoria = categorias.find(
                          (c) => c.id === categoriaId,
                        );
                        const ativaAqui = (campo: Campo) =>
                          ativa?.rowId === item.id && ativa.campo === campo;

                        return (
                          <tr
                            key={item.id}
                            data-calha={`i:${item.id}`}
                            className={cn(
                              ALTURA_LINHA,
                              "border-b border-border transition-colors",
                              editavel && "hover:bg-accent/40",
                            )}
                          >
                            <CelulaTexto
                              valor={String(valorAtual(item, "item") ?? "")}
                              editando={ativaAqui("item")}
                              editavel={editavel}
                              onAtivar={() =>
                                setAtiva({ rowId: item.id, campo: "item" })
                              }
                              onConfirmar={(v, d) =>
                                confirmarCampo(item, "item", v.trim(), d)
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={cn(
                                "text-foreground",
                                RECUO_ITEM,
                                GRADE_NEUTRA,
                              )}
                            />

                            <CelulaSelect
                              editando={ativaAqui("tipo_custo")}
                              editavel={editavel}
                              valor={String(valorAtual(item, "tipo_custo"))}
                              opcoes={TIPOS_CUSTO.map((t) => ({
                                value: t,
                                label: tipoCustoLabel(t),
                              }))}
                              onAtivar={() =>
                                setAtiva({ rowId: item.id, campo: "tipo_custo" })
                              }
                              onConfirmar={(v) =>
                                confirmarCampo(
                                  item,
                                  "tipo_custo",
                                  v,
                                  ativa?.porTeclado ? "proxima" : undefined,
                                )
                              }
                              onNavegar={(d) =>
                                setAtiva(celulaDirecao(item.id, "tipo_custo", d))
                              }
                              onFechar={() => fecharCelula(item.id, "tipo_custo")}
                              tdClassName={cn(GRADE_NEUTRA, "px-2")}
                            >
                              <Badge variant="outline" className="px-1.5">
                                {String(valorAtual(item, "tipo_custo"))}
                              </Badge>
                            </CelulaSelect>

                            <CelulaSelect
                              editando={ativaAqui("categoria_id")}
                              editavel={editavel}
                              valor={categoriaId ?? SEM_CATEGORIA}
                              opcoes={[
                                { value: SEM_CATEGORIA, label: "Nenhuma" },
                                ...categorias
                                  .filter(
                                    (c) => c.ativo || c.id === item.categoria_id,
                                  )
                                  .map((c) => ({
                                    value: c.id,
                                    label: c.ativo
                                      ? c.nome
                                      : `${c.nome} (inativa)`,
                                  })),
                              ]}
                              vazio="Nenhuma categoria cadastrada em /categorias"
                              onAtivar={() =>
                                setAtiva({
                                  rowId: item.id,
                                  campo: "categoria_id",
                                })
                              }
                              onConfirmar={(v) =>
                                confirmarCampo(
                                  item,
                                  "categoria_id",
                                  v === SEM_CATEGORIA ? null : v,
                                  ativa?.porTeclado ? "proxima" : undefined,
                                )
                              }
                              onNavegar={(d) =>
                                setAtiva(
                                  celulaDirecao(item.id, "categoria_id", d),
                                )
                              }
                              onFechar={() =>
                                fecharCelula(item.id, "categoria_id")
                              }
                            >
                              {categoria ? (
                                <Badge variant="neutral">{categoria.nome}</Badge>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </CelulaSelect>

                            <CelulaNumero
                              valor={num(
                                valorAtual(item, "valor_unitario_orcado"),
                              )}
                              formato="moeda"
                              moeda={moeda}
                              editando={ativaAqui("valor_unitario_orcado")}
                              editavel={editavel}
                              onAtivar={() =>
                                setAtiva({
                                  rowId: item.id,
                                  campo: "valor_unitario_orcado",
                                })
                              }
                              onConfirmar={(raw, d) =>
                                confirmarNumero(
                                  item,
                                  "valor_unitario_orcado",
                                  raw,
                                  d,
                                )
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={cn("font-mono", ORCADO.celulaAbre)}
                            />
                            <CelulaNumero
                              valor={num(valorAtual(item, "quantidade_orcada"))}
                              editando={ativaAqui("quantidade_orcada")}
                              editavel={editavel}
                              onAtivar={() =>
                                setAtiva({
                                  rowId: item.id,
                                  campo: "quantidade_orcada",
                                })
                              }
                              onConfirmar={(raw, d) =>
                                confirmarNumero(item, "quantidade_orcada", raw, d)
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={ORCADO.celulaMeio}
                            />
                            <CelulaNumero
                              valor={num(valorAtual(item, "dias_meses_orcado"))}
                              editando={ativaAqui("dias_meses_orcado")}
                              editavel={editavel}
                              onAtivar={() =>
                                setAtiva({
                                  rowId: item.id,
                                  campo: "dias_meses_orcado",
                                })
                              }
                              onConfirmar={(raw, d) =>
                                confirmarNumero(item, "dias_meses_orcado", raw, d)
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={ORCADO.celulaMeio}
                            />
                            <td
                              className={cn(
                                "px-3 text-right font-mono text-xs font-semibold whitespace-nowrap",
                                ORCADO.celulaTotal,
                              )}
                            >
                              {formatCurrency(totais.orcado, moeda)}
                            </td>

                            {/* Planejado espelha o Orçado: zero é
                                "R$ 0,00 · 0 · 0", não travessão. Em `A` e
                                `D` o espelho é literal e as células não
                                abrem: lá o cliente paga o fornecedor
                                direto, e o custo da agência É o orçado
                                menos o BV. */}
                            <CelulaNumero
                              valor={
                                planejadoTravado
                                  ? num(valorAtual(item, "valor_unitario_orcado"))
                                  : num(
                                      valorAtual(item, "valor_unitario_planejado"),
                                    )
                              }
                              formato="moeda"
                              moeda={moeda}
                              editando={ativaAqui("valor_unitario_planejado")}
                              editavel={editavel && !planejadoTravado}
                              onAtivar={() =>
                                setAtiva({
                                  rowId: item.id,
                                  campo: "valor_unitario_planejado",
                                })
                              }
                              onConfirmar={(raw, d) =>
                                confirmarNumero(
                                  item,
                                  "valor_unitario_planejado",
                                  raw,
                                  d,
                                )
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={cn("font-mono", PLANEJADO.celulaAbre)}
                            />
                            <CelulaNumero
                              valor={
                                planejadoTravado
                                  ? num(valorAtual(item, "quantidade_orcada"))
                                  : num(valorAtual(item, "quantidade_planejada"))
                              }
                              editando={ativaAqui("quantidade_planejada")}
                              editavel={editavel && !planejadoTravado}
                              onAtivar={() =>
                                setAtiva({
                                  rowId: item.id,
                                  campo: "quantidade_planejada",
                                })
                              }
                              onConfirmar={(raw, d) =>
                                confirmarNumero(
                                  item,
                                  "quantidade_planejada",
                                  raw,
                                  d,
                                )
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={PLANEJADO.celulaMeio}
                            />
                            <CelulaNumero
                              valor={
                                planejadoTravado
                                  ? num(valorAtual(item, "dias_meses_orcado"))
                                  : num(valorAtual(item, "dias_meses_planejado"))
                              }
                              editando={ativaAqui("dias_meses_planejado")}
                              editavel={editavel && !planejadoTravado}
                              onAtivar={() =>
                                setAtiva({
                                  rowId: item.id,
                                  campo: "dias_meses_planejado",
                                })
                              }
                              onConfirmar={(raw, d) =>
                                confirmarNumero(
                                  item,
                                  "dias_meses_planejado",
                                  raw,
                                  d,
                                )
                              }
                              onCancelar={() => setAtiva(null)}
                              tdClassName={PLANEJADO.celulaMeio}
                            />
                            <td
                              className={cn(
                                "px-3 text-right whitespace-nowrap",
                                PLANEJADO.celulaTotal,
                              )}
                            >
                              <div className="flex flex-col items-end">
                                <span className="font-mono text-xs font-semibold leading-[1.2]">
                                  {formatCurrency(planejadoNaVisao, moeda)}
                                </span>
                                {visao === "liquido" && (
                                  <SubLinhaBv
                                    deducao={blocos.planejado.deducaoBv}
                                    formatar={(v) => formatCurrency(v, moeda)}
                                    cor={PLANEJADO.texto}
                                    corRotulo={PLANEJADO.textoSuave}
                                  />
                                )}
                              </div>
                            </td>

                            <CelulasRentabilidade
                              orcado={totais.orcado}
                              planejado={planejadoNaVisao}
                              moeda={moeda}
                            />
                          </tr>
                        );
                      })}

                    {/* Linha nova — preenchida na própria grade, sem drawer. */}
                    {aberto && draft?.grupoId === grupo.id && (
                      <LinhaDraft
                        draft={draft}
                        moeda={moeda}
                        categorias={categorias}
                        ativa={ativa}
                        onAtivar={(campo) => setAtiva({ rowId: DRAFT_ID, campo })}
                        onFechar={() => {
                          setAtiva(null);
                          descartarDraftIntocado();
                        }}
                        onConfirmarTexto={(campo, v, d) =>
                          confirmarDraft(campo, v, d)
                        }
                        onConfirmarNumero={(campo, raw, d) =>
                          confirmarDraftNumero(campo, raw, d)
                        }
                        onNavegar={(campo, d) =>
                          setAtiva(celulaDirecao(DRAFT_ID, campo, d))
                        }
                        onFecharCelula={(campo) => fecharCelula(DRAFT_ID, campo)}
                      />
                    )}

                    {/* "Novo item" fecha o agrupamento, e não a tabela —
                        é o que dá ao grupo um fim visível sem precisar do
                        card que ele tinha antes. */}
                    {aberto && editavel && (
                      <tr className="h-[30px] border-b border-border">
                        <td colSpan={13} className="pl-[30px] pr-3">
                          <button
                            type="button"
                            onClick={() => abrirDraft(grupo.id)}
                            // Rascunho em branco não trava nada: o clique
                            // aqui o descarta (pointerdown, acima) e abre
                            // a linha nova neste grupo.
                            disabled={
                              (draft !== null && !draftIntocado(draft)) ||
                              pending
                            }
                            className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px] font-semibold text-california-red transition-colors hover:text-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Plus className="h-3 w-3" />
                            Novo item em {grupo.nome}
                          </button>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {/* "Novo grupo" — depois do último grupo e antes do total,
                  que é onde o grupo novo vai nascer. */}
              {novoGrupo && (
                <tr>
                  <td colSpan={13} className={LINHA_NOVO_GRUPO}>
                    <div className="flex items-center gap-2.5">
                      {novoGrupo}
                      <span className="text-[11px] text-muted-foreground">
                        o grupo novo entra aqui, no fim da ordem
                      </span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot>
              <tr>
                <td colSpan={3} className={LINHA_TOTAL_ROTULO}>
                  {rotuloDoTotal}
                </td>
                <td colSpan={3} className={ORCADO.subtotalVazio} />
                <td
                  className={cn(
                    "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                    ORCADO.subtotalValor,
                  )}
                >
                  {formatCurrency(totalOrcado, moeda)}
                </td>
                <td colSpan={3} className={PLANEJADO.subtotalVazio} />
                <td
                  className={cn(
                    "px-3 py-2 text-right whitespace-nowrap",
                    PLANEJADO.subtotalValor,
                  )}
                >
                  <div className="flex flex-col items-end">
                    <span className="font-mono text-[13px] font-bold">
                      {formatCurrency(totalPlanejado, moeda)}
                    </span>
                    {visao === "liquido" && (
                      <SubLinhaBv
                        deducao={totaisDaPlanilha.planejado.deducaoBv}
                        formatar={(v) => formatCurrency(v, moeda)}
                        cor={PLANEJADO.texto}
                        corRotulo={PLANEJADO.textoSuave}
                      />
                    )}
                  </div>
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                    RENTABILIDADE.bordaAbre,
                    RENTABILIDADE.subtotalValor,
                  )}
                >
                  {formatCurrency(resultadoTotal, moeda)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                    RENTABILIDADE.subtotalValor,
                  )}
                >
                  {percentualTotal === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatarPercentual(percentualTotal)
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* A calha — fora do frame da tabela, ao lado das linhas. Cada
            pílula é presa à posição MEDIDA da linha que ela acompanha:
            numa tabela só, as linhas têm alturas diferentes e altura
            chutada acumularia erro a cada grupo. */}
        {temCalha && (
          <Calha>
            {grupos.map((grupo) => {
              const aberto = estaAberto(grupo.id);
              const acoesGrupo = acoesDoGrupo?.(grupo);

              return (
                <React.Fragment key={grupo.id}>
                  {acoesGrupo && (
                    <LinhaDaCalha posicao={posicoesCalha[`g:${grupo.id}`]}>
                      {/* A vaga do BV fica vazia para a lixeira do grupo
                          cair no mesmo eixo das lixeiras de item. */}
                      <span
                        className={cn("flex-none", LARGURA_CALHA_BV)}
                        aria-hidden
                      />
                      {acoesGrupo}
                    </LinhaDaCalha>
                  )}

                  {aberto &&
                    grupo.itens.map((item) => {
                      const bv = bvsPorItem[item.id] ?? null;
                      // Sem BV numa versão congelada não há nada a
                      // consultar — a vaga fica vazia para não desalinhar.
                      const mostraBv = temBv(item) && (editavel || bv !== null);
                      if (!mostraBv && !editavel) return null;

                      return (
                        <LinhaDaCalha
                          key={item.id}
                          posicao={posicoesCalha[`i:${item.id}`]}
                        >
                          <span
                            className={cn(
                              "flex flex-none items-center",
                              LARGURA_CALHA_BV,
                            )}
                          >
                            {mostraBv && (
                              <BvActionButton
                                temBv={bv !== null}
                                itemNome={item.item}
                                // BV que já saiu para o financeiro abre em
                                // consulta mesmo com a versão aberta.
                                somenteLeitura={
                                  !editavel ||
                                  (bv !== null && bv.situacao !== "a_negociar")
                                }
                                onClick={() => setBvAberto(item)}
                              />
                            )}
                          </span>

                          {editavel && (
                            <button
                              type="button"
                              onClick={() => setRemovendo(item)}
                              disabled={pending}
                              title={`Remover ${item.item}`}
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </LinhaDaCalha>
                      );
                    })}
                </React.Fragment>
              );
            })}

            {draft && (
              <LinhaDaCalha posicao={posicoesCalha[DRAFT_ID]}>
                {/* A linha nova ainda não existe no banco: sem id, não há
                    a que prender um BV. O botão entra depois de salva. */}
                <span
                  className={cn("flex-none", LARGURA_CALHA_BV)}
                  aria-hidden
                />
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setAtiva(null);
                  }}
                  title="Descartar linha nova"
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-california-red"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </LinhaDaCalha>
            )}
          </Calha>
        )}
      </div>

      {/* A dica de teclado vive FORA do card (pedido do Tiago,
          25/08/2026): colada no rodapé, dentro do frame, ela lia como se
          fosse mais uma linha da planilha. */}
      {temDica && (
        <p className="mt-2 px-1 text-[11px] text-muted-foreground">
          Clique em qualquer célula para editar ·{" "}
          <kbd className="font-mono">Tab</kbd> e as{" "}
          <kbd className="font-mono">setas</kbd> andam ·{" "}
          <kbd className="font-mono">Enter</kbd> desce ·{" "}
          <kbd className="font-mono">Esc</kbd> desfaz
        </p>
      )}

      {bvAberto && (
        <BvDialog
          open
          onOpenChange={(o) => !o && setBvAberto(null)}
          item={bvAberto}
          grupoNome={
            grupos.find((g) => g.itens.some((i) => i.id === bvAberto.id))
              ?.nome ?? ""
          }
          versaoLabel={versaoLabel}
          categoriaNome={
            categorias.find((c) => c.id === bvAberto.categoria_id)?.nome ?? null
          }
          moeda={moeda}
          bv={bvsPorItem[bvAberto.id] ?? null}
          fornecedores={fornecedores}
          percentualImposto={percentualImposto}
          origem="orcamento"
          readOnly={readOnly}
          adaptador={adaptadorBv}
        />
      )}

      <ConfirmDialog
        open={removendo !== null}
        onOpenChange={(o) => !o && setRemovendo(null)}
        title="Remover item?"
        description={
          <>
            <strong className="text-foreground">{removendo?.item}</strong> será
            removido do grupo{" "}
            <strong className="text-foreground">
              {grupos.find((g) => g.itens.some((i) => i.id === removendo?.id))
                ?.nome ?? ""}
            </strong>
            . Você pode adicionar novamente depois se precisar.
          </>
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleRemoveConfirm}
      />
    </>
  );
}

// ============================================================
// Células
// ============================================================

const TD_BASE = "text-xs align-middle";

function CelulaTexto({
  valor,
  editando,
  editavel,
  onAtivar,
  onConfirmar,
  onCancelar,
  tdClassName,
}: {
  valor: string;
  editando: boolean;
  editavel: boolean;
  onAtivar: () => void;
  onConfirmar: (valor: string, destino?: Direcao) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  // Sem este reset o ref ficava `true` para sempre depois do primeiro
  // Enter, e a partir daí sair da célula pelo clique não gravava mais
  // nada. Passava despercebido porque o Enter fechava a edição; com a
  // navegação por teclado a mesma célula é reaberta o tempo todo.
  React.useEffect(() => {
    if (editando) finalizado.current = false;
  }, [editando]);

  if (editando) {
    return (
      <td className={cn(TD_BASE, "px-1.5", tdClassName)}>
        <input
          autoFocus
          defaultValue={valor}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            const destino = direcaoNoCampo(e, e.currentTarget);
            if (destino) {
              // preventDefault é o que impede o navegador de levar o foco
              // para o próximo elemento por conta própria: quem decide
              // para onde ir é a grade, não a ordem do DOM.
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
          className={CAMPO_CLASSES}
        />
      </td>
    );
  }

  return (
    <td
      className={cn(TD_BASE, "px-3", tdClassName, editavel && "cursor-pointer")}
      onClick={editavel ? onAtivar : undefined}
    >
      <TruncateTooltip text={valor} />
    </td>
  );
}

function CelulaNumero({
  valor,
  formato,
  moeda,
  editando,
  editavel,
  onAtivar,
  onConfirmar,
  onCancelar,
  tdClassName,
}: {
  valor: number;
  formato?: "moeda";
  moeda?: string;
  editando: boolean;
  editavel: boolean;
  onAtivar: () => void;
  onConfirmar: (raw: string, destino?: Direcao) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  React.useEffect(() => {
    if (editando) finalizado.current = false;
  }, [editando]);

  if (editando) {
    return (
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
        <input
          autoFocus
          inputMode="decimal"
          defaultValue={paraEdicao(valor)}
          onFocus={(e) => e.currentTarget.select()}
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
          className={cn(CAMPO_CLASSES, "text-right font-mono")}
        />
      </td>
    );
  }

  return (
    <td
      className={cn(
        TD_BASE,
        "px-3 text-right whitespace-nowrap",
        tdClassName,
        editavel && "cursor-pointer",
      )}
      onClick={editavel ? onAtivar : undefined}
    >
      {formato === "moeda" ? formatCurrency(valor, moeda) : valor}
    </td>
  );
}

/** Célula de escolha (Tipo, Categoria).
 *
 *  As setas aqui são do dropdown — é com elas que se percorrem as opções
 *  —, então esta célula navega só por Tab e Enter. Escolher um valor
 *  fecha a lista mas NÃO sai da célula: o gatilho continua com o foco e
 *  é o Tab seguinte que anda, como o time pediu em 13/08/2026. */
function CelulaSelect({
  valor,
  opcoes,
  vazio,
  editando,
  editavel,
  onAtivar,
  onConfirmar,
  onNavegar,
  onFechar,
  tdClassName,
  children,
}: {
  valor: string;
  opcoes: { value: string; label: string }[];
  /** Texto auxiliar quando só existe a opção "Nenhuma". */
  vazio?: string;
  editando: boolean;
  editavel: boolean;
  onAtivar: () => void;
  onConfirmar: (valor: string, destino?: Direcao) => void;
  onNavegar: (destino: Direcao) => void;
  onFechar: () => void;
  tdClassName?: string;
  children: React.ReactNode;
}) {

  /** Só o Tab é nosso: ele atravessa a coluna sem escolher nada. O Enter
   *  pertence ao Radix, que o usa para confirmar a opção destacada —
   *  interceptá-lo aqui deixaria o dropdown sem como escolher pelo
   *  teclado. As setas também são dele, para percorrer as opções. */
  function navegarNaLista(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    e.preventDefault();
    onNavegar(e.shiftKey ? "anterior" : "proxima");
  }

  if (editando) {
    return (
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
        <Select
          value={valor}
          defaultOpen
          // Escolher grava E decide para onde ir — quem sabe disso é o
          // pai, que conhece o `porTeclado` da célula. Aqui só repassa.
          onValueChange={onConfirmar}
          onOpenChange={(aberto) => {
            if (!aberto) onFechar();
          }}
        >
          <SelectTrigger
            className={cn(CAMPO_CLASSES, "justify-between gap-1 py-0")}
          >
            <SelectValue />
          </SelectTrigger>
          {/* Tab com a lista aberta atravessa sem escolher — é o jeito de
              passar por uma coluna que já está certa. */}
          <SelectContent onKeyDown={navegarNaLista}>
            {opcoes.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
            {vazio && opcoes.length === 1 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">{vazio}</p>
            )}
          </SelectContent>
        </Select>
      </td>
    );
  }

  return (
    // px-3 antes de tdClassName: a coluna Tipo tem só 4,5% da largura e
    // precisa reduzir o padding para o badge não ser cortado.
    <td
      className={cn(TD_BASE, "px-3", tdClassName, editavel && "cursor-pointer")}
      onClick={editavel ? onAtivar : undefined}
    >
      <div className="max-w-[160px] truncate">{children}</div>
    </td>
  );
}

/** Linha em branco da grade: vive no cliente até ter descrição. */
function LinhaDraft({
  draft,
  moeda,
  categorias,
  ativa,
  onAtivar,
  onFechar,
  onConfirmarTexto,
  onConfirmarNumero,
  onNavegar,
  onFecharCelula,
}: {
  draft: Draft;
  moeda: string;
  categorias: Categoria[];
  ativa: CelulaAtiva;
  onAtivar: (campo: Campo) => void;
  onFechar: () => void;
  onConfirmarTexto: (campo: Campo, valor: ValorCampo, destino?: Direcao) => void;
  onConfirmarNumero: (campo: Campo, raw: string, destino?: Direcao) => void;
  /** Tab/Enter num `<select>` da linha nova: navega sem gravar valor. */
  onNavegar: (campo: Campo, destino: Direcao) => void;
  /** Fecha só se a célula ainda for a ativa — mesma guarda das linhas de
   *  item, para o aviso de fechamento do Radix não cancelar o Tab. */
  onFecharCelula: (campo: Campo) => void;
}) {
  const ativaAqui = (campo: Campo) =>
    ativa?.rowId === DRAFT_ID && ativa.campo === campo;
  const totalOrcado =
    draft.valor_unitario_orcado *
    draft.quantidade_orcada *
    draft.dias_meses_orcado;
  const totalPlanejado =
    draft.valor_unitario_planejado *
    draft.quantidade_planejada *
    draft.dias_meses_planejado;
  const categoria = categorias.find((c) => c.id === draft.categoria_id);

  return (
    <tr
      data-calha={DRAFT_ID}
      className={cn(
        ALTURA_LINHA,
        "border-b border-border bg-california-red/[0.03]",
      )}
    >
      <CelulaTexto
        valor={draft.item}
        editando={ativaAqui("item")}
        editavel
        onAtivar={() => onAtivar("item")}
        onConfirmar={(v, d) => onConfirmarTexto("item", v.trim(), d)}
        onCancelar={onFechar}
        tdClassName={cn("text-foreground", RECUO_ITEM, GRADE_NEUTRA)}
      />
      <CelulaSelect
        editando={ativaAqui("tipo_custo")}
        editavel
        valor={draft.tipo_custo}
        opcoes={TIPOS_CUSTO.map((t) => ({ value: t, label: tipoCustoLabel(t) }))}
        onAtivar={() => onAtivar("tipo_custo")}
        onConfirmar={(v) =>
          onConfirmarTexto(
            "tipo_custo",
            v,
            ativa?.porTeclado ? "proxima" : undefined,
          )
        }
        onNavegar={(d) => onNavegar("tipo_custo", d)}
        onFechar={() => onFecharCelula("tipo_custo")}
        tdClassName={cn(GRADE_NEUTRA, "px-2")}
      >
        <Badge variant="outline" className="px-1.5">
          {draft.tipo_custo}
        </Badge>
      </CelulaSelect>
      <CelulaSelect
        editando={ativaAqui("categoria_id")}
        editavel
        valor={draft.categoria_id ?? SEM_CATEGORIA}
        opcoes={[
          { value: SEM_CATEGORIA, label: "Nenhuma" },
          ...categorias
            .filter((c) => c.ativo || c.id === draft.categoria_id)
            .map((c) => ({
              value: c.id,
              label: c.ativo ? c.nome : `${c.nome} (inativa)`,
            })),
        ]}
        vazio="Nenhuma categoria cadastrada em /categorias"
        onAtivar={() => onAtivar("categoria_id")}
        onConfirmar={(v) =>
          onConfirmarTexto(
            "categoria_id",
            v === SEM_CATEGORIA ? null : v,
            ativa?.porTeclado ? "proxima" : undefined,
          )
        }
        onNavegar={(d) => onNavegar("categoria_id", d)}
        onFechar={() => onFecharCelula("categoria_id")}
      >
        {categoria ? (
          <Badge variant="neutral">{categoria.nome}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </CelulaSelect>

      <CelulaNumero
        valor={draft.valor_unitario_orcado}
        formato="moeda"
        moeda={moeda}
        editando={ativaAqui("valor_unitario_orcado")}
        editavel
        onAtivar={() => onAtivar("valor_unitario_orcado")}
        onConfirmar={(raw, d) => onConfirmarNumero("valor_unitario_orcado", raw, d)}
        onCancelar={onFechar}
        tdClassName={cn("font-mono", ORCADO.celulaAbre)}
      />
      <CelulaNumero
        valor={draft.quantidade_orcada}
        editando={ativaAqui("quantidade_orcada")}
        editavel
        onAtivar={() => onAtivar("quantidade_orcada")}
        onConfirmar={(raw, d) => onConfirmarNumero("quantidade_orcada", raw, d)}
        onCancelar={onFechar}
        tdClassName={ORCADO.celulaMeio}
      />
      <CelulaNumero
        valor={draft.dias_meses_orcado}
        editando={ativaAqui("dias_meses_orcado")}
        editavel
        onAtivar={() => onAtivar("dias_meses_orcado")}
        onConfirmar={(raw, d) => onConfirmarNumero("dias_meses_orcado", raw, d)}
        onCancelar={onFechar}
        tdClassName={ORCADO.celulaMeio}
      />
      <td
        className={cn(
          "px-3 text-right font-mono text-xs font-semibold whitespace-nowrap",
          ORCADO.celulaTotal,
        )}
      >
        {formatCurrency(totalOrcado, moeda)}
      </td>

      {/* Sem vazioComoTraco: na linha nova o planejado espelha o orçado —
          R$ 0,00 · 1 · 1 em vez de três travessões. */}
      <CelulaNumero
        valor={draft.valor_unitario_planejado}
        formato="moeda"
        moeda={moeda}
        editando={ativaAqui("valor_unitario_planejado")}
        editavel
        onAtivar={() => onAtivar("valor_unitario_planejado")}
        onConfirmar={(raw, d) => onConfirmarNumero("valor_unitario_planejado", raw, d)}
        onCancelar={onFechar}
        tdClassName={cn("font-mono", PLANEJADO.celulaAbre)}
      />
      <CelulaNumero
        valor={draft.quantidade_planejada}
        editando={ativaAqui("quantidade_planejada")}
        editavel
        onAtivar={() => onAtivar("quantidade_planejada")}
        onConfirmar={(raw, d) => onConfirmarNumero("quantidade_planejada", raw, d)}
        onCancelar={onFechar}
        tdClassName={PLANEJADO.celulaMeio}
      />
      <CelulaNumero
        valor={draft.dias_meses_planejado}
        editando={ativaAqui("dias_meses_planejado")}
        editavel
        onAtivar={() => onAtivar("dias_meses_planejado")}
        onConfirmar={(raw, d) => onConfirmarNumero("dias_meses_planejado", raw, d)}
        onCancelar={onFechar}
        tdClassName={PLANEJADO.celulaMeio}
      />
      <td
        className={cn(
          "px-3 text-right font-mono text-xs font-semibold whitespace-nowrap",
          PLANEJADO.celulaTotal,
        )}
      >
        {formatCurrency(totalPlanejado, moeda)}
      </td>

      <CelulasRentabilidade
        orcado={totalOrcado}
        planejado={totalPlanejado}
        moeda={moeda}
      />
    </tr>
  );
}

/** Rentabilidade da linha: valor absoluto e percentual sobre o orçado.
 *  Sem planejado ainda não há rentabilidade a mostrar. */
function CelulasRentabilidade({
  orcado,
  planejado,
  moeda,
}: {
  orcado: number;
  planejado: number;
  moeda: string;
}) {
  const { rentabilidade, percentualRentabilidade } = rentabilidadeDe(
    orcado,
    planejado,
  );
  const semPlanejado = planejado <= 0;

  return (
    <>
      <td
        className={cn(
          "px-3 text-right font-mono text-xs whitespace-nowrap",
          RENTABILIDADE.celulaAbre,
        )}
      >
        {semPlanejado ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={RENTAB_VALOR}>
            {formatCurrency(rentabilidade, moeda)}
          </span>
        )}
      </td>
      <td
        className={cn(
          "px-3 text-right font-mono text-xs whitespace-nowrap",
          RENTABILIDADE.celulaTotal,
        )}
      >
        {percentualRentabilidade === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={RENTAB_VALOR}>
            {formatarPercentual(percentualRentabilidade)}
          </span>
        )}
      </td>
    </>
  );
}
