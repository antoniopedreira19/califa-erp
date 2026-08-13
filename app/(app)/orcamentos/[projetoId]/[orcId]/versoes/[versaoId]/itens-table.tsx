"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
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
  RENTAB_VALOR,
} from "@/app/(app)/_planilha/blocos";
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

interface Props {
  grupoId: string;
  grupoNome: string;
  itens: VersaoOrcamentoItem[];
  moeda: string;
  readOnly?: boolean;
  categorias: Categoria[];
  /** Grupo recolhido esconde as linhas, o "Novo item" e a trilha de ações.
   *  O subtotal continua visível — é o dado que justifica recolher. */
  aberto?: boolean;
  /** BV por id do item. Só existe em item tipo A, AR ou D. */
  bvsPorItem: Record<string, ItemBv>;
  fornecedores: FornecedorOpcao[];
  /** "v5" — aparece no subtítulo do formulário de BV. */
  versaoLabel: string;
  /** Ausente ⇒ grava direto nas Server Actions da versão. */
  adaptador?: AdaptadorItens;
  /** Repassado ao formulário de BV; mesma regra do adaptador acima. */
  adaptadorBv?: AdaptadorBv;
  /** Identidade do grupo — recolher e nome. Mora na PRIMEIRA linha do
   *  thead, na mesma faixa de ORÇADO / PLANEJADO / RENTABILIDADE: o card
   *  não tem mais barra de título só para isso. */
  cabecalhoGrupo?: React.ReactNode;
  /** Ações do grupo (contador, remover). Vão para a calha à direita da
   *  tabela, na altura da faixa — onde o design põe o "6 itens". */
  acoesGrupo?: React.ReactNode;
  /** A faixa da tabela é o topo do card e precisa arredondar. Falso
   *  enquanto o card mostra um aviso próprio à frente dela. Sem valor,
   *  vale a presença do `cabecalhoGrupo`. */
  abreCard?: boolean;
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

type ValorCampo = string | number | null;
type Overrides = Record<string, Partial<Record<Campo, ValorCampo>>>;
/** Célula em edição.
 *
 *  `porTeclado` diz COMO se chegou nela, e existe por causa das colunas
 *  de escolha. Escolher um valor no `<select>` precisa continuar a
 *  navegação de quem veio de Tab — mas não pode arrastar quem veio de
 *  clique para a próxima célula, abrindo um dropdown que ninguém pediu.
 *
 *  Ele mora AQUI, e não dentro da célula, porque nos editores de rascunho
 *  toda escrita reconstrói a árvore de componentes: estado local de
 *  célula não sobrevive ao rebuild, e essa foi a origem de a lista ficar
 *  presa aberta depois de escolher. Aqui em cima, sobrevive. */
type CelulaAtiva = {
  rowId: string;
  campo: Campo;
  porTeclado?: boolean;
} | null;

/** Radix Select não aceita value="" — sentinela para "sem categoria". */
const SEM_CATEGORIA = "__nenhuma__";
const DRAFT_ID = "__draft__";
/** Altura fixa da linha: mantém a trilha de ações fora do card alinhada.
 *  28px é o meio-termo entre os 36px antigos e os 25px do handoff: é o
 *  menor valor que ainda comporta o botão da trilha (14px de ícone + 6px
 *  de padding = 26px) e mantém o alvo de clique acima do mínimo de 24px
 *  da WCAG 2.5.8. */
const ALTURA_LINHA = "h-7";

// Grade: linhas verticais discretas, uma cor por bloco.
const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";

/** 2px menor que a linha (28px), como no handoff — o campo respira dentro
 *  da célula em vez de encostar nas bordas. */
const CAMPO_CLASSES =
  "h-[26px] w-full rounded-lg border border-california-red bg-white px-2 text-xs text-foreground outline-none ring-2 ring-california-red/15";

interface Draft {
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
 *  em branco simétrica, não um lado preenchido e outro zerado. */
const DRAFT_VAZIO: Draft = {
  item: "",
  tipo_custo: "A",
  categoria_id: null,
  valor_unitario_orcado: 0,
  quantidade_orcada: 1,
  dias_meses_orcado: 1,
  valor_unitario_planejado: 0,
  quantidade_planejada: 1,
  dias_meses_planejado: 1,
};

/** Aceita "1.234,56" e "1234.56". Vírgula presente ⇒ ponto é milhar. */
function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Número cru para digitação: vírgula decimal, sem separador de milhar. */
function paraEdicao(valor: number): string {
  return String(valor).replace(".", ",");
}

/** Rentabilidade de uma linha (ou do subtotal) pela fórmula oficial da
 *  versão — a mesma que alimenta o card de Totais. */
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
  grupoId,
  grupoNome,
  itens,
  moeda,
  readOnly,
  categorias,
  aberto = true,
  bvsPorItem,
  fornecedores,
  versaoLabel,
  adaptador,
  adaptadorBv,
  cabecalhoGrupo,
  acoesGrupo,
  abreCard,
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
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const faixaRef = React.useRef<HTMLTableRowElement>(null);
  const persistindoRef = React.useRef(false);
  const [railTop, setRailTop] = React.useState(0);
  const [faixaAltura, setFaixaAltura] = React.useState(0);

  const temDraft = draft !== null;

  // A trilha de ações vive fora do card, então precisa saber onde o
  // tbody começa. Altura de linha é fixa; só o offset do topo varia.
  // A faixa do grupo é o primeiro <tr> do thead — a calha das ações do
  // grupo se alinha por ela, não por altura chutada.
  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const tbody = tbodyRef.current;
    if (!wrapper || !tbody) return;
    const medir = () => {
      const topoWrapper = wrapper.getBoundingClientRect().top;
      setRailTop(tbody.getBoundingClientRect().top - topoWrapper);
      const faixa = faixaRef.current;
      if (faixa) setFaixaAltura(faixa.getBoundingClientRect().height);
    };
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [itens.length, readOnly, temDraft, aberto]);

  // Descarta o valor otimista quando o servidor já devolveu o mesmo valor.
  React.useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next: Overrides = {};
      for (const item of itens) {
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
  }, [itens]);

  function valorAtual(item: VersaoOrcamentoItem, campo: Campo): ValorCampo {
    const campos = overrides[item.id];
    if (campos && campo in campos) return campos[campo] as ValorCampo;
    return item[campo] as ValorCampo;
  }

  function totaisDoItem(item: VersaoOrcamentoItem) {
    // Sem edição pendente usa o valor GENERATED do banco; com edição,
    // recalcula na hora (valor × qtd × dias/meses).
    if (!overrides[item.id]) {
      return {
        orcado: Number(item.total_orcado),
        planejado: Number(item.total_planejado),
      };
    }
    return {
      orcado:
        num(valorAtual(item, "valor_unitario_orcado")) *
        num(valorAtual(item, "quantidade_orcada")) *
        num(valorAtual(item, "dias_meses_orcado")),
      planejado:
        num(valorAtual(item, "valor_unitario_planejado")) *
        num(valorAtual(item, "quantidade_planejada")) *
        num(valorAtual(item, "dias_meses_planejado")),
    };
  }

  /** Ordem das linhas para a navegação. A linha nova entra no fim: o Tab
   *  que sai do último item cai nela em vez de morrer, que é o que faz
   *  dar para preencher um grupo inteiro sem tocar no mouse. */
  const linhasNavegaveis = React.useMemo(
    () => [...itens.map((it) => it.id), ...(draft ? [DRAFT_ID] : [])],
    [itens, draft],
  );

  /** Para onde o teclado leva a partir daqui. `null` encerra a edição. */
  const celulaDirecao = React.useCallback(
    (rowId: string, campo: Campo, destino?: Direcao): CelulaAtiva => {
      if (!destino) return null; // blur / clique fora: só confirma e sai
      const alvo = celulaVizinha(
        linhasNavegaveis,
        CAMPOS_NAVEGAVEIS,
        { linhaId: rowId, campo },
        destino,
      );
      return alvo
        ? { rowId: alvo.linhaId, campo: alvo.campo, porTeclado: true }
        : null;
    },
    [linhasNavegaveis],
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
        const res = await acoes.adicionar(grupoId, formData);
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

  const subtotalOrcado = itens.reduce((s, it) => s + totaisDoItem(it).orcado, 0);
  const subtotalPlanejado = itens.reduce(
    (s, it) => s + totaisDoItem(it).planejado,
    0,
  );
  const { rentabilidade: resultado, percentualRentabilidade: percentualSubtotal } =
    rentabilidadeDe(subtotalOrcado, subtotalPlanejado);

  const editavel = !readOnly;

  // Quem arredonda o topo é o primeiro elemento visível do card: o aviso,
  // quando existe, senão a própria faixa da tabela.
  const arredondaTopo = (abreCard ?? cabecalhoGrupo != null) && !erro;

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

  // Em versão congelada a trilha não some: ela ainda mostra os BVs já
  // lançados, em modo consulta. Sem nenhum BV, não há o que mostrar.
  const temBvVisivel = itens.some((it) => bvsPorItem[it.id]);
  const temTrilha =
    aberto &&
    (editavel ? itens.length > 0 || draft !== null : temBvVisivel);

  return (
    <>
      {erro && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red",
            (abreCard ?? cabecalhoGrupo != null) && "rounded-t-2xl",
          )}
        >
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

      <div ref={wrapperRef} className="relative">
        {/* Sem a barra de dica embaixo (readOnly ou grupo recolhido), é a
            própria tabela que fecha o card — precisa arredondar. Com o
            nome do grupo na faixa ela também ABRE o card, e o mesmo vale
            para o topo (a menos que o aviso de erro esteja na frente). */}
        <div
          className={cn(
            "overflow-x-auto",
            arredondaTopo && "rounded-t-2xl",
            (readOnly || !aberto) && "rounded-b-2xl",
          )}
        >
          <table
            className={cn("w-full table-fixed text-sm border-collapse", LARGURA_MINIMA)}
          >
            <ColunasFixas />
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {/* Linha 1 — o nome do agrupamento divide a faixa com os
                  blocos, em vez de ocupar uma barra só dele acima da
                  tabela. */}
              <tr ref={faixaRef}>
                <th colSpan={3} className={FAIXA_GRUPO}>
                  {cabecalhoGrupo}
                </th>
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
                  Item
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
                  Total
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

            <tbody ref={tbodyRef}>
              {aberto && itens.length === 0 && !draft && (
                <tr>
                  <td
                    colSpan={13}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Sem itens neste grupo ainda.
                  </td>
                </tr>
              )}

              {aberto && itens.map((item) => {
                const totais = totaisDoItem(item);
                const categoriaId = valorAtual(item, "categoria_id") as
                  | string
                  | null;
                const categoria = categorias.find((c) => c.id === categoriaId);
                const ativaAqui = (campo: Campo) =>
                  ativa?.rowId === item.id && ativa.campo === campo;

                return (
                  <tr
                    key={item.id}
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
                      onConfirmar={(v, d) => confirmarCampo(item, "item", v.trim(), d)}
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("text-foreground", GRADE_NEUTRA)}
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
                          .filter((c) => c.ativo || c.id === item.categoria_id)
                          .map((c) => ({
                            value: c.id,
                            label: c.ativo ? c.nome : `${c.nome} (inativa)`,
                          })),
                      ]}
                      vazio="Nenhuma categoria cadastrada em /categorias"
                      onAtivar={() =>
                        setAtiva({ rowId: item.id, campo: "categoria_id" })
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
                        setAtiva(celulaDirecao(item.id, "categoria_id", d))
                      }
                      onFechar={() => fecharCelula(item.id, "categoria_id")}
                    >
                      {categoria ? (
                        <Badge variant="neutral">{categoria.nome}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </CelulaSelect>

                    <CelulaNumero
                      valor={num(valorAtual(item, "valor_unitario_orcado"))}
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
                        confirmarNumero(item, "valor_unitario_orcado", raw, d)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("font-mono", ORCADO.celulaAbre)}
                    />
                    <CelulaNumero
                      valor={num(valorAtual(item, "quantidade_orcada"))}
                      editando={ativaAqui("quantidade_orcada")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({ rowId: item.id, campo: "quantidade_orcada" })
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
                        setAtiva({ rowId: item.id, campo: "dias_meses_orcado" })
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

                    {/* Planejado espelha o Orçado: zero é "R$ 0,00 · 0 · 0",
                        não travessão. Simetria entre os dois blocos, e a
                        linha nova não muda de cara ao ser salva. */}
                    <CelulaNumero
                      valor={num(valorAtual(item, "valor_unitario_planejado"))}
                      formato="moeda"
                      moeda={moeda}
                      editando={ativaAqui("valor_unitario_planejado")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({
                          rowId: item.id,
                          campo: "valor_unitario_planejado",
                        })
                      }
                      onConfirmar={(raw, d) =>
                        confirmarNumero(item, "valor_unitario_planejado", raw, d)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("font-mono", PLANEJADO.celulaAbre)}
                    />
                    <CelulaNumero
                      valor={num(valorAtual(item, "quantidade_planejada"))}
                      editando={ativaAqui("quantidade_planejada")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({
                          rowId: item.id,
                          campo: "quantidade_planejada",
                        })
                      }
                      onConfirmar={(raw, d) =>
                        confirmarNumero(item, "quantidade_planejada", raw, d)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={PLANEJADO.celulaMeio}
                    />
                    <CelulaNumero
                      valor={num(valorAtual(item, "dias_meses_planejado"))}
                      editando={ativaAqui("dias_meses_planejado")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({
                          rowId: item.id,
                          campo: "dias_meses_planejado",
                        })
                      }
                      onConfirmar={(raw, d) =>
                        confirmarNumero(item, "dias_meses_planejado", raw, d)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={PLANEJADO.celulaMeio}
                    />
                    <td
                      className={cn(
                        "px-3 text-right font-mono text-xs font-semibold whitespace-nowrap",
                        PLANEJADO.celulaTotal,
                      )}
                    >
                      {formatCurrency(totais.planejado, moeda)}
                    </td>

                    <CelulasRentabilidade
                      orcado={totais.orcado}
                      planejado={totais.planejado}
                      moeda={moeda}
                    />
                  </tr>
                );
              })}

              {/* Linha nova — preenchida na própria grade, sem drawer. */}
              {aberto && draft && (
                <LinhaDraft
                  draft={draft}
                  moeda={moeda}
                  categorias={categorias}
                  ativa={ativa}
                  onAtivar={(campo) => setAtiva({ rowId: DRAFT_ID, campo })}
                  onFechar={() => setAtiva(null)}
                  onConfirmarTexto={(campo, v, d) => confirmarDraft(campo, v, d)}
                  onConfirmarNumero={(campo, raw, d) =>
                    confirmarDraftNumero(campo, raw, d)
                  }
                  onNavegar={(campo, d) =>
                    setAtiva(celulaDirecao(DRAFT_ID, campo, d))
                  }
                  onFecharCelula={(campo) => fecharCelula(DRAFT_ID, campo)}
                />
              )}

            </tbody>

            <tfoot>
              <tr>
                {/* py-1.5: o subtotal fecha a planilha, não precisa do
                    corpo de antes — fica só um degrau acima da linha de
                    item (28px) em vez de quase o dobro. */}
                <td
                  colSpan={3}
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Subtotal do grupo
                </td>
                <td colSpan={3} className={ORCADO.subtotalVazio} />
                <td
                  className={cn(
                    "px-3 py-1.5 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                    ORCADO.subtotalValor,
                  )}
                >
                  {formatCurrency(subtotalOrcado, moeda)}
                </td>
                <td colSpan={3} className={PLANEJADO.subtotalVazio} />
                <td
                  className={cn(
                    "px-3 py-1.5 text-right whitespace-nowrap font-mono text-[13px] font-bold",
                    PLANEJADO.subtotalValor,
                  )}
                >
                  {formatCurrency(subtotalPlanejado, moeda)}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right whitespace-nowrap font-mono text-xs font-semibold border-r border-r-[#e2e0da]",
                    RENTABILIDADE.bordaAbre,
                    RENTABILIDADE.subtotalValor,
                  )}
                >
                  {formatCurrency(resultado, moeda)}
                </td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right whitespace-nowrap font-mono text-xs font-semibold",
                    RENTABILIDADE.subtotalValor,
                  )}
                >
                  {percentualSubtotal === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    formatarPercentual(percentualSubtotal)
                  )}
                </td>
              </tr>

              {/* "Novo item" vem DEPOIS do subtotal (decisão do time,
                  27/07/2026) — o handoff original pedia acima dele. */}
              {aberto && editavel && (
                <tr>
                  {/* border-t fecha a base da grade: o subtotal é a última
                      linha da planilha, e o "Novo item" fica fora dela. */}
                  <td
                    colSpan={13}
                    className="border-t border-border px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(DRAFT_VAZIO);
                        setAtiva({ rowId: DRAFT_ID, campo: "item" });
                      }}
                      disabled={draft !== null || pending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-california-red/30 bg-california-red/5 px-3 py-1.5 text-xs font-semibold text-california-red hover:bg-california-red hover:text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Novo item
                    </button>
                  </td>
                </tr>
              )}
            </tfoot>
          </table>
        </div>

        {/* A dica só faz sentido com células à vista — com o grupo recolhido
            ela apontaria para uma grade que não está lá. */}
        {aberto && editavel && (
          <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-6 py-3 rounded-b-2xl">
            <span className="text-[11px] text-muted-foreground">
              Clique em qualquer célula para editar ·{" "}
              <kbd className="font-mono">Tab</kbd> e as{" "}
              <kbd className="font-mono">setas</kbd> andam ·{" "}
              <kbd className="font-mono">Enter</kbd> desce ·{" "}
              <kbd className="font-mono">Esc</kbd> desfaz
            </span>
          </div>
        )}

        {/* Ações do grupo — contador e remover, na calha à direita, na
            altura exata da faixa. É para lá que elas foram quando a barra
            de título do card saiu. */}
        {acoesGrupo && (
          <div
            className="absolute left-full top-0 ml-2 flex items-center"
            style={{ height: faixaAltura || undefined }}
          >
            {acoesGrupo}
          </div>
        )}

        {/* Trilha de ações — fora do frame da tabela, ao lado das linhas.
            O BV fica à ESQUERDA da ação que a tela já tinha (a lixeira),
            na mesma posição que ele ocupa na planilha do job. A pílula tem
            largura fixa para que as lixeiras de todas as linhas — inclusive
            as de tipo B e C, que não têm BV — fiquem no mesmo eixo. */}
        {temTrilha && (
          <div
            className="absolute left-full ml-2 flex flex-col"
            style={{ top: railTop }}
          >
            {itens.map((item) => {
              const bv = bvsPorItem[item.id] ?? null;
              // Sem BV numa versão congelada não há nada a consultar —
              // a vaga fica vazia para não desalinhar as linhas de baixo.
              const mostraBv = temBv(item) && (editavel || bv !== null);

              return (
                <div
                  key={item.id}
                  className={cn("flex items-center gap-1", ALTURA_LINHA)}
                >
                  <span
                    className={cn("flex flex-none items-center", LARGURA_CALHA_BV)}
                  >
                    {mostraBv && (
                      <BvActionButton
                        temBv={bv !== null}
                        itemNome={item.item}
                        // BV que já saiu para o financeiro abre em consulta
                        // mesmo com a versão aberta.
                        somenteLeitura={
                          !editavel || (bv !== null && bv.situacao !== "a_negociar")
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
                      className="rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
            {draft && (
              <div className={cn("flex items-center gap-1", ALTURA_LINHA)}>
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
                  className="rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {bvAberto && (
        <BvDialog
          open
          onOpenChange={(o) => !o && setBvAberto(null)}
          item={bvAberto}
          grupoNome={grupoNome}
          versaoLabel={versaoLabel}
          categoriaNome={
            categorias.find((c) => c.id === bvAberto.categoria_id)?.nome ?? null
          }
          moeda={moeda}
          bv={bvsPorItem[bvAberto.id] ?? null}
          fornecedores={fornecedores}
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
            <strong className="text-foreground">{grupoNome}</strong>. Você pode
            adicionar novamente depois se precisar.
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
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
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
      className={cn(TD_BASE, tdClassName, "px-3", editavel && "cursor-pointer")}
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
        tdClassName={cn("text-foreground", GRADE_NEUTRA)}
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
