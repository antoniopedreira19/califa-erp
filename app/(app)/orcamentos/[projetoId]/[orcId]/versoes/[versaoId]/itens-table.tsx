"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
} from "@/lib/types";
import { adicionarItem, atualizarCampoItem, removerItem } from "../actions";

interface Props {
  grupoId: string;
  grupoNome: string;
  itens: VersaoOrcamentoItem[];
  moeda: string;
  readOnly?: boolean;
  categorias: Categoria[];
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

type ValorCampo = string | number | null;
type Overrides = Record<string, Partial<Record<Campo, ValorCampo>>>;
type CelulaAtiva = { rowId: string; campo: Campo } | null;

const TIPOS: TipoCusto[] = ["A", "B", "C", "D"];
/** Radix Select não aceita value="" — sentinela para "sem categoria". */
const SEM_CATEGORIA = "__nenhuma__";
const DRAFT_ID = "__draft__";
/** Altura fixa da linha: mantém a trilha de ações fora do card alinhada. */
const ALTURA_LINHA = "h-9";

// Grade: linhas verticais discretas, uma cor por bloco.
const GRADE_NEUTRA = "border-r border-r-[#f1f1f1]";
const GRADE_ORCADO = "border-r border-r-[#eceae5]";
const GRADE_PLANEJADO = "border-r border-r-[#e6eff9]";
const GRADE_RENTAB = "border-r border-r-[#d9efe3]";

/** Piso para as colunas de moeda não cortarem o valor. Abaixo disso o card
 *  rola na horizontal em vez de espremer as colunas. */
const LARGURA_MINIMA = "min-w-[1060px]";

const CAMPO_CLASSES =
  "h-7 w-full rounded-lg border border-california-red bg-white px-2 text-xs text-foreground outline-none ring-2 ring-california-red/15";

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

const DRAFT_VAZIO: Draft = {
  item: "",
  tipo_custo: "A",
  categoria_id: null,
  valor_unitario_orcado: 0,
  quantidade_orcada: 1,
  dias_meses_orcado: 1,
  valor_unitario_planejado: 0,
  quantidade_planejada: 0,
  dias_meses_planejado: 0,
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

/** Larguras fixas do grid. Sem elas cada card mede as colunas pelo próprio
 *  conteúdo — um grupo com item de nome curto desalinha os blocos Orçado /
 *  Planejado / Rentabilidade em relação aos outros grupos e versões.
 *  Em porcentagem, não em px: os cards têm a mesma largura, então a mesma
 *  proporção alinha todos e ainda acompanha o container. */
function ColunasFixas() {
  return (
    <colgroup>
      {/* Item absorve a sobra (16%); as demais são proporcionais. */}
      <col />
      <col className="w-[4.5%]" />
      <col className="w-[8.5%]" />
      {/* Orçado */}
      <col className="w-[10%]" />
      <col className="w-[3.5%]" />
      <col className="w-[3.5%]" />
      <col className="w-[11%]" />
      {/* Planejado */}
      <col className="w-[10%]" />
      <col className="w-[3.5%]" />
      <col className="w-[3.5%]" />
      <col className="w-[11%]" />
      {/* Rentabilidade */}
      <col className="w-[9.5%]" />
      <col className="w-[5.5%]" />
    </colgroup>
  );
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
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [ativa, setAtiva] = React.useState<CelulaAtiva>(null);
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [removendo, setRemovendo] =
    React.useState<VersaoOrcamentoItem | null>(null);

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const persistindoRef = React.useRef(false);
  const [railTop, setRailTop] = React.useState(0);

  const temDraft = draft !== null;

  // A trilha de ações vive fora do card, então precisa saber onde o
  // tbody começa. Altura de linha é fixa; só o offset do topo varia.
  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const tbody = tbodyRef.current;
    if (!wrapper || !tbody) return;
    const medir = () =>
      setRailTop(
        tbody.getBoundingClientRect().top - wrapper.getBoundingClientRect().top,
      );
    medir();
    const observer = new ResizeObserver(medir);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [itens.length, readOnly, temDraft]);

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

  function gravar(itemId: string, campo: Campo, valor: ValorCampo) {
    const anterior = overrides[itemId];
    setErro(null);
    setAtiva(null);
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
        const res = await atualizarCampoItem(
          itemId,
          campo,
          valor === null ? null : String(valor),
        );
        if (!res.ok) {
          reverter();
          setErro(res.message);
          return;
        }
        router.refresh();
      } catch (e) {
        // Falha de rede: sem reverter, a célula mostraria para sempre um
        // valor que não está no banco. Repassa o erro para o Next tratar
        // (inclusive o redirect de sessão expirada).
        reverter();
        throw e;
      }
    });
  }

  /** Confirma uma célula de item já existente. */
  function confirmarCampo(
    item: VersaoOrcamentoItem,
    campo: Campo,
    valor: ValorCampo,
  ) {
    if (mesmoValor(valorAtual(item, campo), valor)) {
      setAtiva(null);
      return;
    }
    gravar(item.id, campo, valor);
  }

  function confirmarNumero(
    item: VersaoOrcamentoItem,
    campo: Campo,
    raw: string,
  ) {
    const n = parseNumero(raw);
    if (n === null) {
      setAtiva(null);
      setErro("Valor inválido — a célula foi mantida como estava.");
      return;
    }
    confirmarCampo(item, campo, n);
  }

  /** Salva a linha nova assim que ela tem descrição.
   *  O ref é trava de reentrância: sem ela, qualquer re-execução do
   *  handler insere o item de novo. */
  function persistirDraft(d: Draft) {
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
        const res = await adicionarItem(grupoId, formData);
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        setDraft(null);
        setAtiva(null);
        router.refresh();
      } finally {
        // Sem o finally, uma falha de rede deixaria a trava presa e o
        // "Novo item" morto até recarregar a página.
        persistindoRef.current = false;
      }
    });
  }

  function confirmarDraft(campo: Campo, valor: ValorCampo) {
    if (!draft) return;
    const atualizado = { ...draft, [campo]: valor } as Draft;
    setAtiva(null);
    setErro(null);
    setDraft(atualizado);
    // Sem descrição o banco recusa: a linha fica local até ter texto.
    if (atualizado.item.trim().length > 0) persistirDraft(atualizado);
  }

  function confirmarDraftNumero(campo: Campo, raw: string) {
    const n = parseNumero(raw);
    if (n === null) {
      setAtiva(null);
      setErro("Valor inválido — a célula foi mantida como estava.");
      return;
    }
    confirmarDraft(campo, n);
  }

  function handleRemoveConfirm() {
    if (!removendo) return;
    const alvo = removendo;
    startTransition(async () => {
      const res = await removerItem(alvo.id);
      if (!res.ok) setErro(res.message);
      setRemovendo(null);
      router.refresh();
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
  const temTrilha = editavel && (itens.length > 0 || draft !== null);

  return (
    <>
      {erro && (
        <div className="flex items-center justify-between gap-3 border-b border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
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
        <div className={cn("overflow-x-auto", readOnly && "rounded-b-2xl")}>
          <table
            className={cn("w-full table-fixed text-sm border-collapse", LARGURA_MINIMA)}
          >
            <ColunasFixas />
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {/* Linha 1 — faixas de bloco */}
              <tr>
                <th colSpan={3} className="bg-muted/40 border-b border-border" />
                <th
                  colSpan={4}
                  className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-foreground bg-[#f1f0ec] border-b-[3px] border-b-[#282828] border-l-2 border-l-[#d7d7d7]"
                >
                  ORÇADO
                </th>
                <th
                  colSpan={4}
                  className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.1em] normal-case text-[#1e4fa3] bg-[#e8f0fd] border-b-[3px] border-b-[#2f6fdb] border-l-2 border-l-[#b9d1f4]"
                >
                  PLANEJADO
                </th>
                <th
                  colSpan={2}
                  className="text-center px-3 py-2 text-[11px] font-extrabold tracking-[0.08em] normal-case text-emerald-700 bg-emerald-50 border-b-[3px] border-b-emerald-600 border-l-2 border-l-[#d7d7d7]"
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
                <th className="text-right font-semibold px-3 py-2 border-l-2 border-l-[#e4e2dd] border-r border-r-border">
                  R$ Unit.
                </th>
                <th className="text-right font-semibold px-3 py-2 border-r border-r-border">
                  QT
                </th>
                <th className="text-right font-semibold px-3 py-2 border-r border-r-border">
                  D/M
                </th>
                <th className="text-right font-semibold px-3 py-2">Total</th>
                {/* bloco PLANEJADO */}
                <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-l-2 border-l-[#cfe0f7] border-r border-r-[#dfeafb]">
                  R$ Unit.
                </th>
                <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-r border-r-[#dfeafb]">
                  QT
                </th>
                <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8] border-r border-r-[#dfeafb]">
                  D/M
                </th>
                <th className="text-right font-semibold px-3 py-2 bg-blue-50/60 text-[#5a76a8]">
                  Total
                </th>
                {/* bloco RENTABILIDADE */}
                <th className="text-right font-semibold px-3 py-2 bg-emerald-50/50 text-emerald-800/70 border-l border-l-border border-r border-r-[#d9efe3]">
                  R$
                </th>
                <th className="text-right font-semibold px-3 py-2 bg-emerald-50/50 text-emerald-800/70">
                  %
                </th>
              </tr>
            </thead>

            <tbody ref={tbodyRef}>
              {itens.length === 0 && !draft && (
                <tr>
                  <td
                    colSpan={13}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    Sem itens neste grupo ainda.
                  </td>
                </tr>
              )}

              {itens.map((item) => {
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
                      onConfirmar={(v) => confirmarCampo(item, "item", v.trim())}
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("text-foreground", GRADE_NEUTRA)}
                    />

                    <CelulaSelect
                      editando={ativaAqui("tipo_custo")}
                      editavel={editavel}
                      valor={String(valorAtual(item, "tipo_custo"))}
                      opcoes={TIPOS.map((t) => ({
                        value: t,
                        label: tipoCustoLabel(t),
                      }))}
                      onAtivar={() =>
                        setAtiva({ rowId: item.id, campo: "tipo_custo" })
                      }
                      onConfirmar={(v) => confirmarCampo(item, "tipo_custo", v)}
                      onFechar={() => setAtiva(null)}
                      tdClassName={GRADE_NEUTRA}
                    >
                      <Badge variant="outline">
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
                        )
                      }
                      onFechar={() => setAtiva(null)}
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
                      onConfirmar={(raw) =>
                        confirmarNumero(item, "valor_unitario_orcado", raw)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn(
                        "font-mono bg-black/[0.015] border-l-2 border-l-[#e4e2dd]",
                        GRADE_ORCADO,
                      )}
                    />
                    <CelulaNumero
                      valor={num(valorAtual(item, "quantidade_orcada"))}
                      editando={ativaAqui("quantidade_orcada")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({ rowId: item.id, campo: "quantidade_orcada" })
                      }
                      onConfirmar={(raw) =>
                        confirmarNumero(item, "quantidade_orcada", raw)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("bg-black/[0.015]", GRADE_ORCADO)}
                    />
                    <CelulaNumero
                      valor={num(valorAtual(item, "dias_meses_orcado"))}
                      editando={ativaAqui("dias_meses_orcado")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({ rowId: item.id, campo: "dias_meses_orcado" })
                      }
                      onConfirmar={(raw) =>
                        confirmarNumero(item, "dias_meses_orcado", raw)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("bg-black/[0.015]", GRADE_ORCADO)}
                    />
                    <td className="px-3 text-right font-mono text-xs font-semibold bg-black/[0.015] whitespace-nowrap">
                      {formatCurrency(totais.orcado, moeda)}
                    </td>

                    <CelulaNumero
                      valor={num(valorAtual(item, "valor_unitario_planejado"))}
                      formato="moeda"
                      moeda={moeda}
                      vazioComoTraco
                      editando={ativaAqui("valor_unitario_planejado")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({
                          rowId: item.id,
                          campo: "valor_unitario_planejado",
                        })
                      }
                      onConfirmar={(raw) =>
                        confirmarNumero(item, "valor_unitario_planejado", raw)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn(
                        "font-mono bg-blue-50/40 border-l-2 border-l-[#cfe0f7]",
                        GRADE_PLANEJADO,
                      )}
                    />
                    <CelulaNumero
                      valor={num(valorAtual(item, "quantidade_planejada"))}
                      vazioComoTraco
                      editando={ativaAqui("quantidade_planejada")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({
                          rowId: item.id,
                          campo: "quantidade_planejada",
                        })
                      }
                      onConfirmar={(raw) =>
                        confirmarNumero(item, "quantidade_planejada", raw)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("bg-blue-50/40", GRADE_PLANEJADO)}
                    />
                    <CelulaNumero
                      valor={num(valorAtual(item, "dias_meses_planejado"))}
                      vazioComoTraco
                      editando={ativaAqui("dias_meses_planejado")}
                      editavel={editavel}
                      onAtivar={() =>
                        setAtiva({
                          rowId: item.id,
                          campo: "dias_meses_planejado",
                        })
                      }
                      onConfirmar={(raw) =>
                        confirmarNumero(item, "dias_meses_planejado", raw)
                      }
                      onCancelar={() => setAtiva(null)}
                      tdClassName={cn("bg-blue-50/40", GRADE_PLANEJADO)}
                    />
                    <td className="px-3 text-right font-mono text-xs font-semibold bg-blue-50/40 whitespace-nowrap">
                      {totais.planejado > 0
                        ? formatCurrency(totais.planejado, moeda)
                        : "—"}
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
              {draft && (
                <LinhaDraft
                  draft={draft}
                  moeda={moeda}
                  categorias={categorias}
                  ativa={ativa}
                  onAtivar={(campo) => setAtiva({ rowId: DRAFT_ID, campo })}
                  onFechar={() => setAtiva(null)}
                  onConfirmarTexto={(campo, v) => confirmarDraft(campo, v)}
                  onConfirmarNumero={(campo, raw) =>
                    confirmarDraftNumero(campo, raw)
                  }
                />
              )}

            </tbody>

            <tfoot>
              <tr>
                <td
                  colSpan={3}
                  className="px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  Subtotal do grupo
                </td>
                <td
                  colSpan={3}
                  className="bg-[#f1f0ec] border-l-2 border-l-[#d7d7d7] border-t-2 border-t-[#282828]"
                />
                <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-foreground bg-[#f1f0ec] border-t-2 border-t-[#282828]">
                  {formatCurrency(subtotalOrcado, moeda)}
                </td>
                <td
                  colSpan={3}
                  className="bg-[#e8f0fd] border-l-2 border-l-[#b9d1f4] border-t-2 border-t-[#2f6fdb]"
                />
                <td className="px-3 py-3 text-right whitespace-nowrap font-mono text-[13px] font-bold text-[#1e4fa3] bg-[#e8f0fd] border-t-2 border-t-[#2f6fdb]">
                  {formatCurrency(subtotalPlanejado, moeda)}
                </td>
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-xs font-semibold bg-emerald-50 border-l-2 border-l-[#d7d7d7] border-t-2 border-t-emerald-600",
                    GRADE_RENTAB,
                    resultado >= 0 ? "text-emerald-700" : "text-california-red",
                  )}
                >
                  {formatCurrency(resultado, moeda)}
                </td>
                <td
                  className={cn(
                    "px-3 py-3 text-right whitespace-nowrap font-mono text-xs font-semibold bg-emerald-50 border-t-2 border-t-emerald-600",
                    resultado >= 0 ? "text-emerald-700" : "text-california-red",
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
              {editavel && (
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

        {editavel && (
          <div className="flex items-center justify-between gap-4 border-t border-border bg-muted/40 px-6 py-3 rounded-b-2xl">
            <span className="text-[11px] text-muted-foreground">
              Clique em qualquer célula para editar ·{" "}
              <kbd className="font-mono">Enter</kbd> confirma ·{" "}
              <kbd className="font-mono">Esc</kbd> desfaz
            </span>
          </div>
        )}

        {/* Trilha de ações — fora do frame da tabela, ao lado das linhas. */}
        {temTrilha && (
          <div
            className="absolute left-full ml-2 flex flex-col"
            style={{ top: railTop }}
          >
            {itens.map((item) => (
              <div
                key={item.id}
                className={cn("flex items-center", ALTURA_LINHA)}
              >
                <button
                  type="button"
                  onClick={() => setRemovendo(item)}
                  disabled={pending}
                  title={`Remover ${item.item}`}
                  className="rounded-md p-1.5 text-muted-foreground hover:text-california-red hover:bg-accent transition-colors disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {draft && (
              <div className={cn("flex items-center", ALTURA_LINHA)}>
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
  onConfirmar: (valor: string) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  if (editando) {
    return (
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
        <input
          autoFocus
          defaultValue={valor}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finalizado.current = true;
              onConfirmar(e.currentTarget.value);
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
      <div className="truncate" title={valor}>
        {valor}
      </div>
    </td>
  );
}

function CelulaNumero({
  valor,
  formato,
  moeda,
  vazioComoTraco,
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
  vazioComoTraco?: boolean;
  editando: boolean;
  editavel: boolean;
  onAtivar: () => void;
  onConfirmar: (raw: string) => void;
  onCancelar: () => void;
  tdClassName?: string;
}) {
  const finalizado = React.useRef(false);

  if (editando) {
    return (
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
        <input
          autoFocus
          inputMode="decimal"
          defaultValue={paraEdicao(valor)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finalizado.current = true;
              onConfirmar(e.currentTarget.value);
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

  const mostrarTraco = vazioComoTraco && valor <= 0;

  return (
    <td
      className={cn(
        TD_BASE,
        tdClassName,
        "px-3 text-right whitespace-nowrap",
        editavel && "cursor-pointer",
        mostrarTraco && "text-muted-foreground",
      )}
      onClick={editavel ? onAtivar : undefined}
    >
      {mostrarTraco
        ? "—"
        : formato === "moeda"
          ? formatCurrency(valor, moeda)
          : valor}
    </td>
  );
}

function CelulaSelect({
  valor,
  opcoes,
  vazio,
  editando,
  editavel,
  onAtivar,
  onConfirmar,
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
  onConfirmar: (valor: string) => void;
  onFechar: () => void;
  tdClassName?: string;
  children: React.ReactNode;
}) {
  if (editando) {
    return (
      <td className={cn(TD_BASE, tdClassName, "px-1.5")}>
        <Select
          value={valor}
          defaultOpen
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
          <SelectContent>
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
    <td
      className={cn(TD_BASE, tdClassName, "px-3", editavel && "cursor-pointer")}
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
}: {
  draft: Draft;
  moeda: string;
  categorias: Categoria[];
  ativa: CelulaAtiva;
  onAtivar: (campo: Campo) => void;
  onFechar: () => void;
  onConfirmarTexto: (campo: Campo, valor: ValorCampo) => void;
  onConfirmarNumero: (campo: Campo, raw: string) => void;
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
        onConfirmar={(v) => onConfirmarTexto("item", v.trim())}
        onCancelar={onFechar}
        tdClassName={cn("text-foreground", GRADE_NEUTRA)}
      />
      <CelulaSelect
        editando={ativaAqui("tipo_custo")}
        editavel
        valor={draft.tipo_custo}
        opcoes={TIPOS.map((t) => ({ value: t, label: tipoCustoLabel(t) }))}
        onAtivar={() => onAtivar("tipo_custo")}
        onConfirmar={(v) => onConfirmarTexto("tipo_custo", v)}
        onFechar={onFechar}
        tdClassName={GRADE_NEUTRA}
      >
        <Badge variant="outline">{draft.tipo_custo}</Badge>
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
          onConfirmarTexto("categoria_id", v === SEM_CATEGORIA ? null : v)
        }
        onFechar={onFechar}
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
        onConfirmar={(raw) => onConfirmarNumero("valor_unitario_orcado", raw)}
        onCancelar={onFechar}
        tdClassName={cn(
          "font-mono bg-black/[0.015] border-l-2 border-l-[#e4e2dd]",
          GRADE_ORCADO,
        )}
      />
      <CelulaNumero
        valor={draft.quantidade_orcada}
        editando={ativaAqui("quantidade_orcada")}
        editavel
        onAtivar={() => onAtivar("quantidade_orcada")}
        onConfirmar={(raw) => onConfirmarNumero("quantidade_orcada", raw)}
        onCancelar={onFechar}
        tdClassName={cn("bg-black/[0.015]", GRADE_ORCADO)}
      />
      <CelulaNumero
        valor={draft.dias_meses_orcado}
        editando={ativaAqui("dias_meses_orcado")}
        editavel
        onAtivar={() => onAtivar("dias_meses_orcado")}
        onConfirmar={(raw) => onConfirmarNumero("dias_meses_orcado", raw)}
        onCancelar={onFechar}
        tdClassName={cn("bg-black/[0.015]", GRADE_ORCADO)}
      />
      <td className="px-3 text-right font-mono text-xs font-semibold bg-black/[0.015] whitespace-nowrap">
        {formatCurrency(totalOrcado, moeda)}
      </td>

      <CelulaNumero
        valor={draft.valor_unitario_planejado}
        formato="moeda"
        moeda={moeda}
        vazioComoTraco
        editando={ativaAqui("valor_unitario_planejado")}
        editavel
        onAtivar={() => onAtivar("valor_unitario_planejado")}
        onConfirmar={(raw) => onConfirmarNumero("valor_unitario_planejado", raw)}
        onCancelar={onFechar}
        tdClassName={cn(
          "font-mono bg-blue-50/40 border-l-2 border-l-[#cfe0f7]",
          GRADE_PLANEJADO,
        )}
      />
      <CelulaNumero
        valor={draft.quantidade_planejada}
        vazioComoTraco
        editando={ativaAqui("quantidade_planejada")}
        editavel
        onAtivar={() => onAtivar("quantidade_planejada")}
        onConfirmar={(raw) => onConfirmarNumero("quantidade_planejada", raw)}
        onCancelar={onFechar}
        tdClassName={cn("bg-blue-50/40", GRADE_PLANEJADO)}
      />
      <CelulaNumero
        valor={draft.dias_meses_planejado}
        vazioComoTraco
        editando={ativaAqui("dias_meses_planejado")}
        editavel
        onAtivar={() => onAtivar("dias_meses_planejado")}
        onConfirmar={(raw) => onConfirmarNumero("dias_meses_planejado", raw)}
        onCancelar={onFechar}
        tdClassName={cn("bg-blue-50/40", GRADE_PLANEJADO)}
      />
      <td className="px-3 text-right font-mono text-xs font-semibold bg-blue-50/40 whitespace-nowrap">
        {totalPlanejado > 0 ? formatCurrency(totalPlanejado, moeda) : "—"}
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
  const cor = rentabilidade >= 0 ? "text-emerald-700" : "text-california-red";

  return (
    <>
      <td
        className={cn(
          "px-3 text-right font-mono text-xs whitespace-nowrap border-l-2 border-l-[#e4e2dd]",
          GRADE_RENTAB,
        )}
      >
        {semPlanejado ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cor}>{formatCurrency(rentabilidade, moeda)}</span>
        )}
      </td>
      <td className="px-3 text-right font-mono text-xs whitespace-nowrap">
        {percentualRentabilidade === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className={cor}>
            {formatarPercentual(percentualRentabilidade)}
          </span>
        )}
      </td>
    </>
  );
}
