"use client";

/**
 * Baixa em lote: selecionar vários títulos e dar baixa de uma vez (pedido
 * do Tiago em 02/10/2026 — "selecionando vários e dando baixa de vez";
 * desenho aprovado no protótipo do módulo fiscal).
 *
 * O mesmo desenho em toda lista de títulos — Títulos a Pagar, Títulos a
 * Receber e a aba Títulos da conciliação:
 *   • uma coluna de seleção, igual à da remessa CNAB (caixa nativa com a cor
 *     da California). O título que não entra no lote fica com a caixa
 *     desligada e o motivo no `title`;
 *   • a barra escura que aparece com a seleção, com os totais;
 *   • o diálogo, com a data e a conta UMA vez e uma baixa por título.
 *
 * Quem usa: cada lista monta os seus títulos como `TituloParaLote` (a chave
 * é também o id da seleção), passa as chaves dos que aceitam baixa em lote
 * para `useSelecao`, e entrega ao diálogo os selecionados. O diálogo chama a
 * Server Action `darBaixaEmLote`, que baixa um por um pela action da baixa
 * individual — as regras moram em `lib/financeiro/baixa-em-lote.ts`.
 *
 * No lote não entram retenção, baixa parcial nem cartão: cada título é
 * baixado pelo que falta, inteiro, pela conta escolhida. O título com
 * retenção a fazer se baixa sozinho.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { AlertCircle, AlertTriangle, ArrowRightLeft, CreditCard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Combobox } from "@/components/ui/combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ContaBancaria, PlanoContaSubtipo, PlanoContaTipo } from "@/lib/types";
import type {
  AlvoDaBaixaEmLote,
  CentroDeCusto,
  EntradaDaBaixaEmLote,
} from "@/lib/financeiro/baixa-em-lote";
import { darBaixaEmLote } from "@/app/(app)/financeiro/actions-baixa-em-lote";

// ---------------------------------------------------------------------------
// O título, no formato do lote
// ---------------------------------------------------------------------------

/** O que cada lista entrega ao lote, um por título. */
export interface TituloParaLote {
  /**
   * Única entre as listas: `pagar|pp|<id>`, `receber|nf|<id>`… É também o
   * id da seleção (`useSelecao`) e o que a Server Action devolve em
   * `feitas`.
   */
  chave: string;
  tipo: "pagar" | "receber";
  /** Por onde a Server Action baixa o título: a origem e o id que a baixa
   *  de um por um recebe. */
  alvo: AlvoDaBaixaEmLote;
  /** O nome do título, como a lista mostra. */
  titulo: string;
  /** A referência curta: "PP-00127 · 1/2", "NF 2054", "AV-00012". */
  referencia: string;
  /** Fornecedor ou cliente. */
  contraparte: string;
  /** ISO. Vermelho no diálogo quando passou da data do movimento. */
  vencimento: string | null;
  /** O que falta: o valor menos as baixas já feitas (decisão 125). É por
   *  ele que o título é baixado. */
  aberto: number;
  /** O centro de custo que o título já tem — o par completo, tipo e
   *  subtipo. `null`: usa o do lote. */
  centroDeCusto: CentroDeCusto | null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

const moeda = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function br(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** Hoje em ISO local — `toISOString` volta em UTC e erra o dia à noite. */
function hojeIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

// ---------------------------------------------------------------------------
// Seleção
// ---------------------------------------------------------------------------

/** A seleção de uma lista. `elegiveis` são as chaves que aceitam baixa em
 *  lote, na lista como ela está na tela (filtros valendo). */
export function useSelecao(elegiveis: string[]) {
  const [sel, setSel] = React.useState<Set<string>>(() => new Set());
  const chave = elegiveis.join("|");
  // Título que saiu da lista (baixado, filtrado) sai da seleção.
  React.useEffect(() => {
    const aceitos = new Set(elegiveis);
    setSel((prev) => {
      const n = new Set([...prev].filter((id) => aceitos.has(id)));
      return n.size === prev.size ? prev : n;
    });
    // `chave` resume `elegiveis`, que é um array novo a cada renderização.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const marcados = elegiveis.filter((id) => sel.has(id));
  return {
    sel,
    marcado: (id: string) => sel.has(id),
    alternar: (id: string) =>
      setSel((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    todos: elegiveis.length > 0 && marcados.length === elegiveis.length,
    alguns: marcados.length > 0 && marcados.length < elegiveis.length,
    alternarTodos: () =>
      setSel(marcados.length === elegiveis.length ? new Set() : new Set(elegiveis)),
    limpar: () => setSel(new Set()),
    quantos: marcados.length,
  };
}

/** A caixa de uma linha. Sem `disponivel`, fica desligada com o motivo no
 *  título. */
export function CaixaDaLinha({
  marcado,
  onAlternar,
  disponivel = true,
  motivo,
}: {
  marcado: boolean;
  onAlternar: () => void;
  disponivel?: boolean;
  motivo?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={marcado}
      disabled={!disponivel}
      title={
        disponivel ? (marcado ? "Tirar da seleção" : "Selecionar para dar baixa em lote") : motivo
      }
      aria-label={disponivel ? "Selecionar para dar baixa em lote" : motivo}
      onChange={onAlternar}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 cursor-pointer accent-california-red disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/** A caixa do cabeçalho: marca todos os títulos visíveis que aceitam baixa. */
export function CaixaDoCabecalho({
  todos,
  alguns,
  onAlternar,
  disponivel = true,
}: {
  todos: boolean;
  alguns: boolean;
  onAlternar: () => void;
  disponivel?: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = alguns;
  }, [alguns]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={todos}
      disabled={!disponivel}
      title={todos ? "Tirar todos da seleção" : "Selecionar todos os que aceitam baixa"}
      aria-label="Selecionar todos"
      onChange={onAlternar}
      className="h-4 w-4 cursor-pointer accent-california-red disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

/** A barra que aparece com a seleção: quantos, quanto entra e sai, e a
 *  ação. Fica logo abaixo da tabela e gruda no pé da tela enquanto a lista
 *  rola. */
export function BarraDeSelecao({
  itens,
  onLimpar,
  onBaixar,
}: {
  itens: TituloParaLote[];
  onLimpar: () => void;
  onBaixar: () => void;
}) {
  if (itens.length === 0) return null;
  const saidas = r2(itens.filter((t) => t.tipo === "pagar").reduce((s, t) => s + t.aberto, 0));
  const entradas = r2(itens.filter((t) => t.tipo === "receber").reduce((s, t) => s + t.aberto, 0));
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-[#282828] py-2.5 pl-5 pr-2.5 text-sm text-white shadow-elevated">
        <span className="font-semibold">
          {itens.length} {itens.length === 1 ? "título selecionado" : "títulos selecionados"}
        </span>
        <span className="h-4 w-px bg-white/20" />
        {saidas > 0 && (
          <span className="text-white/75">
            Saem <strong className="font-mono font-semibold text-white">{moeda(saidas)}</strong>
          </span>
        )}
        {entradas > 0 && (
          <span className="text-white/75">
            Entram{" "}
            <strong className="font-mono font-semibold text-emerald-300">{moeda(entradas)}</strong>
          </span>
        )}
        <button
          type="button"
          onClick={onLimpar}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
        >
          Limpar seleção
        </button>
        <button
          type="button"
          onClick={onBaixar}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
        >
          <CreditCard className="h-3.5 w-3.5" />
          {itens.length === 1 ? "Dar baixa" : `Dar baixa em ${itens.length}`}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// O diálogo
// ---------------------------------------------------------------------------

// As formas reais (`FormaPagamento`), sem o cartão: no cartão a baixa é a
// entrada do item na fatura (decisão 093), que não cabe num lote de conta.
const FORMAS = [
  ["pix", "PIX"],
  ["transferencia", "Transferência"],
  ["boleto", "Boleto"],
] as const;
type FormaDoLote = (typeof FORMAS)[number][0];

/**
 * O tipo do centro de custo de quem não tem um, como no protótipo aprovado:
 * os pagamentos entram em "02 · Custo Operacional" — onde toda PP nasce
 * (decisão 068) — e os recebimentos em "01 · Receita". O lote escolhe só o
 * subtipo; quem já tem centro de custo usa o seu.
 */
const CODIGO_TIPO_PAGAR = "02";
const CODIGO_TIPO_RECEBER = "01";

const ROTULO_TIPO: Record<TituloParaLote["tipo"], string> = {
  pagar: "A pagar",
  receber: "A receber",
};

const CHIP_TIPO: Record<TituloParaLote["tipo"], string> = {
  pagar: "bg-rose-50 text-rose-700",
  receber: "bg-emerald-50 text-emerald-700",
};

/** O chip "A pagar"/"A receber" da coluna Tipo, quando o lote mistura os dois. */
export function ChipTipo({ tipo }: { tipo: TituloParaLote["tipo"] }) {
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold",
        CHIP_TIPO[tipo],
      )}
    >
      {ROTULO_TIPO[tipo]}
    </span>
  );
}

const COMBO = "h-9 w-full rounded-lg border-border px-3 text-sm";

type ContaDoLote = Pick<ContaBancaria, "id" | "nome" | "banco" | "ativo">;
type TipoDoLote = Pick<PlanoContaTipo, "id" | "codigo" | "nome" | "ativo">;
type SubtipoDoLote = Pick<PlanoContaSubtipo, "id" | "tipo_id" | "nome" | "ativo">;

export function BaixaEmLoteDialog({
  open,
  onOpenChange,
  itens,
  contas,
  tipos,
  subtipos,
  contaPadrao,
  onConcluido,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  /** Os selecionados. O diálogo guarda a lista de quando abriu: a baixa
   *  tira os títulos da tela no mesmo instante, e ele não pode esvaziar
   *  enquanto fecha. */
  itens: TituloParaLote[];
  /** Todas as contas ativas, de qualquer empresa (decisão 064). */
  contas: ContaDoLote[];
  tipos: TipoDoLote[];
  subtipos: SubtipoDoLote[];
  /** Id da conta já escolhida (a da conciliação aberta). */
  contaPadrao?: string | null;
  /** Todas as baixas feitas: recebe a mensagem do toast. A lista limpa a
   *  seleção e mostra o toast; a página já foi atualizada. */
  onConcluido?: (mensagem: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[960px]">
        {/* O conteúdo do Radix desmonta ao fechar (depois da animação): o
            formulário remonta a cada abertura, com o estado do zero e a
            lista de títulos da seleção daquele momento. */}
        <FormularioDoLote
          itensIniciais={itens}
          contas={contas}
          tipos={tipos}
          subtipos={subtipos}
          contaPadrao={contaPadrao ?? null}
          onCancelar={() => onOpenChange(false)}
          onConcluido={(mensagem) => {
            onOpenChange(false);
            onConcluido?.(mensagem);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function FormularioDoLote({
  itensIniciais,
  contas,
  tipos,
  subtipos,
  contaPadrao,
  onCancelar,
  onConcluido,
}: {
  itensIniciais: TituloParaLote[];
  contas: ContaDoLote[];
  tipos: TipoDoLote[];
  subtipos: SubtipoDoLote[];
  contaPadrao: string | null;
  onCancelar: () => void;
  onConcluido: (mensagem: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [lista] = React.useState(itensIniciais);
  /** As que já viraram baixa num envio que parou no meio: saem da tabela
   *  e não vão de novo. */
  const [concluidas, setConcluidas] = React.useState<Set<string>>(() => new Set());
  const [data, setData] = React.useState<string>(hojeIso);
  const [conta, setConta] = React.useState<string>(contaPadrao ?? "");
  const [forma, setForma] = React.useState<FormaDoLote>("pix");
  const [subtipoSaida, setSubtipoSaida] = React.useState<string>("");
  const [subtipoEntrada, setSubtipoEntrada] = React.useState<string>("");
  const [erro, setErro] = React.useState<string | null>(null);
  const [faltando, setFaltando] = React.useState<Set<string>>(new Set());

  const itens = lista.filter((t) => !concluidas.has(t.chave));
  const pagar = itens.filter((t) => t.tipo === "pagar");
  const receber = itens.filter((t) => t.tipo === "receber");
  const misto = pagar.length > 0 && receber.length > 0;

  const contasAtivas = contas.filter((c) => c.ativo);
  const contaEscolhida = contasAtivas.find((c) => c.id === conta) ?? null;

  // O centro de custo de quem não tem um (protótipo: uma linha para os
  // pagamentos, outra para os recebimentos).
  const tipoPagar = tipos.find((t) => t.ativo && t.codigo === CODIGO_TIPO_PAGAR) ?? null;
  const tipoReceber = tipos.find((t) => t.ativo && t.codigo === CODIGO_TIPO_RECEBER) ?? null;
  const subtiposPagar = tipoPagar
    ? subtipos.filter((s) => s.ativo && s.tipo_id === tipoPagar.id)
    : [];
  const subtiposReceber = tipoReceber
    ? subtipos.filter((s) => s.ativo && s.tipo_id === tipoReceber.id)
    : [];
  const pagarSemCentro = pagar.filter((t) => !t.centroDeCusto);
  const receberSemCentro = receber.filter((t) => !t.centroDeCusto);

  const saidas = r2(pagar.reduce((s, t) => s + t.aberto, 0));
  const entradas = r2(receber.reduce((s, t) => s + t.aberto, 0));

  function confirmar() {
    const falta = new Set<string>();
    if (!data) falta.add("data");
    if (!contaEscolhida) falta.add("conta");
    if (pagar.length > 0 && !forma) falta.add("forma");
    if (pagarSemCentro.length > 0 && !subtipoSaida) falta.add("subtipo-saida");
    if (receberSemCentro.length > 0 && !subtipoEntrada) falta.add("subtipo-entrada");
    setFaltando(falta);
    if (falta.size) {
      setErro(
        falta.has("data") || falta.has("conta")
          ? "Escolha a data e a conta do movimento."
          : falta.has("forma")
            ? "Escolha a forma de pagamento e o subtipo do centro de custo."
            : "Escolha o subtipo do centro de custo.",
      );
      return;
    }
    if (
      (pagarSemCentro.length > 0 && !tipoPagar) ||
      (receberSemCentro.length > 0 && !tipoReceber)
    ) {
      setErro(
        `O tipo ${pagarSemCentro.length > 0 && !tipoPagar ? "02 · Custo Operacional" : "01 · Receita"} não está ativo no plano de contas. Dê baixa nos títulos sem centro de custo um a um.`,
      );
      return;
    }
    setErro(null);

    const entrada: EntradaDaBaixaEmLote = {
      pago_em: data,
      conta_bancaria_id: conta,
      forma_pagamento: pagar.length > 0 ? forma : null,
      centro_pagar:
        pagarSemCentro.length > 0 && tipoPagar
          ? { tipoId: tipoPagar.id, subtipoId: subtipoSaida }
          : null,
      centro_receber:
        receberSemCentro.length > 0 && tipoReceber
          ? { tipoId: tipoReceber.id, subtipoId: subtipoEntrada }
          : null,
      itens: itens.map((t) => ({
        chave: t.chave,
        rotulo: t.titulo,
        alvo: t.alvo,
        aberto: r2(t.aberto),
        centro: t.centroDeCusto,
      })),
    };
    const nomeDaConta = contaEscolhida?.nome ?? "";
    const total = itens.length;

    startTransition(async () => {
      const res = await darBaixaEmLote(entrada);
      if (res.feitas.length > 0) router.refresh();
      if (res.ok) {
        const n = res.feitas.length;
        onConcluido(
          `${n} ${n === 1 ? "baixa registrada" : "baixas registradas"} em ${br(data)}, na conta ${nomeDaConta}. Cada uma vira um movimento na Conciliação.`,
        );
        return;
      }
      // Parou no meio: as feitas continuam valendo e saem da tabela; a que
      // falhou e as seguintes ficam, para corrigir e confirmar de novo.
      if (res.feitas.length > 0) {
        setConcluidas((prev) => new Set([...prev, ...res.feitas]));
      }
      const n = res.feitas.length;
      setErro(
        res.falha.chave === null
          ? res.falha.mensagem
          : `${n === 0 ? "Nenhuma baixa registrada" : `${n} de ${total} ${n === 1 ? "baixa registrada" : "baixas registradas"}`}. A baixa de “${res.falha.rotulo ?? "um título"}” não foi feita: ${res.falha.mensagem}${n > 0 ? " Os títulos que ficaram abaixo continuam em aberto." : ""}`,
      );
    });
  }

  const vencido = (t: TituloParaLote) => Boolean(data && t.vencimento && t.vencimento < data);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-emerald-600" />
          {itens.length === 1 ? "Dar baixa em 1 título" : `Dar baixa em ${itens.length} títulos`}
        </DialogTitle>
        <DialogDescription>
          Uma data e uma conta para todos; cada título vira uma baixa própria, pelo valor em
          aberto.
        </DialogDescription>
      </DialogHeader>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      <div className="space-y-4">
        <div className={cn("grid gap-3", pagar.length ? "grid-cols-3" : "grid-cols-2")}>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Data do{" "}
              {pagar.length ? (receber.length ? "movimento" : "pagamento") : "recebimento"}{" "}
              <span className="text-california-red">*</span>
            </label>
            <DatePicker
              name="lote_data"
              defaultValue={data}
              onDateChange={(d) => {
                setData(d ? format(d, "yyyy-MM-dd") : "");
                setErro(null);
              }}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold">
              Conta bancária <span className="text-california-red">*</span>
            </label>
            <Select
              value={conta || undefined}
              onValueChange={(v) => {
                setConta(v);
                setErro(null);
              }}
            >
              <SelectTrigger
                className={cn(faltando.has("conta") && !contaEscolhida && "border-california-red")}
              >
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contasAtivas.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta bancária ativa. Cadastre em
                    /financeiro/cadastros/contas-bancarias.
                  </div>
                ) : (
                  contasAtivas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} · {c.banco}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          {pagar.length > 0 && (
            <div className="space-y-1">
              <label className="text-xs font-semibold">
                Forma de pagamento <span className="text-california-red">*</span>
              </label>
              <Select value={forma} onValueChange={(v) => setForma(v as FormaDoLote)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAS.map(([v, r]) => (
                    <SelectItem key={v} value={v}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-xl border border-border">
          <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full table-fixed text-[12.5px]">
              <thead className="sticky top-0 z-[1] bg-muted text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  {misto && <th className="w-[84px] px-3 py-2 text-left font-semibold">Tipo</th>}
                  <th className="px-3 py-2 text-left font-semibold">Título</th>
                  <th className="w-[92px] px-2 py-2 text-center font-semibold">Vencimento</th>
                  <th className="w-[112px] px-3 py-2 text-right font-semibold">Em aberto</th>
                  <th className="w-[150px] px-3 py-2 text-right font-semibold">Ajuste</th>
                  <th className="w-[132px] px-3 py-2 text-right font-semibold">Na conta</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((t) => (
                  <tr key={t.chave} className="border-t border-border/70 align-top">
                    {misto && (
                      <td className="px-3 py-2">
                        <ChipTipo tipo={t.tipo} />
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <span className="block truncate font-semibold" title={t.titulo}>
                        {t.titulo}
                      </span>
                      <span
                        className="block truncate text-[11px] text-muted-foreground"
                        title={`${t.referencia} · ${t.contraparte}`}
                      >
                        {t.referencia} · {t.contraparte}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <span
                        className={cn(
                          "font-mono text-[11.5px]",
                          vencido(t) && "font-semibold text-california-red",
                        )}
                      >
                        {br(t.vencimento)}
                      </span>
                      {vencido(t) && (
                        <span className="block text-[10.5px] text-california-red">vencido</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {moeda(t.aberto)}
                    </td>
                    {/* Sem retenção nem multa no lote: o ajuste fica para a
                        baixa de um título sozinho. */}
                    <td className="px-3 py-2 text-right">
                      <span className="text-muted-foreground">—</span>
                    </td>
                    <td
                      className={cn(
                        "whitespace-nowrap px-3 py-2 text-right font-mono font-semibold tabular-nums",
                        t.tipo === "receber" ? "text-emerald-700" : "text-foreground",
                      )}
                    >
                      {t.tipo === "receber" ? "+ " : "− "}
                      {moeda(t.aberto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border bg-muted/30 px-3 py-2 text-[12.5px]">
            {saidas > 0 && (
              <span className="text-muted-foreground">
                Saem da conta{" "}
                <strong className="font-mono font-semibold text-foreground">{moeda(saidas)}</strong>
              </span>
            )}
            {entradas > 0 && (
              <span className="text-muted-foreground">
                Entram na conta{" "}
                <strong className="font-mono font-semibold text-emerald-700">
                  {moeda(entradas)}
                </strong>
              </span>
            )}
          </div>
        </div>

        {(pagar.length > 0 || receber.length > 0) && (
          <div
            className={cn(
              "grid gap-3",
              pagar.length && receber.length ? "grid-cols-2" : "grid-cols-1",
            )}
          >
            {pagar.length > 0 &&
              (pagarSemCentro.length > 0 ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold">
                    Centro de custo dos pagamentos <span className="text-california-red">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex h-9 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {tipoPagar ? `${tipoPagar.codigo} · ${tipoPagar.nome}` : "—"}
                    </div>
                    <Combobox
                      items={subtiposPagar.map((s) => ({ value: s.id, label: s.nome }))}
                      value={subtipoSaida || null}
                      onChange={(v) => {
                        setSubtipoSaida(v ?? "");
                        setErro(null);
                      }}
                      placeholder="Subtipo..."
                      buscaPlaceholder="Escreva o nome do subtipo"
                      disabled={subtiposPagar.length === 0}
                      className={cn(
                        COMBO,
                        faltando.has("subtipo-saida") && !subtipoSaida && "border-california-red",
                      )}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {pagarSemCentro.length === pagar.length
                      ? `O mesmo subtipo para ${pagar.length === 1 ? "o pagamento" : `os ${pagar.length} pagamentos`}.`
                      : `O mesmo subtipo para ${pagarSemCentro.length === 1 ? "o pagamento" : `os ${pagarSemCentro.length} pagamentos`} sem centro de custo; ${pagar.length - pagarSemCentro.length === 1 ? "o outro usa o que já tem" : `os outros ${pagar.length - pagarSemCentro.length} usam o que já têm`}.`}{" "}
                    Subtipos diferentes: um lote para cada.
                  </p>
                </div>
              ) : (
                <p className="self-end text-[11px] text-muted-foreground">
                  {pagar.length === 1
                    ? "O pagamento usa o centro de custo que já tem."
                    : `Os ${pagar.length} pagamentos usam o centro de custo que já têm.`}
                </p>
              ))}
            {receber.length > 0 &&
              (receberSemCentro.length > 0 ? (
                <div className="space-y-1">
                  <label className="text-xs font-semibold">
                    Centro de custo dos recebimentos <span className="text-california-red">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex h-9 items-center rounded-lg border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
                      {tipoReceber ? `${tipoReceber.codigo} · ${tipoReceber.nome}` : "—"}
                    </div>
                    <Combobox
                      items={subtiposReceber.map((s) => ({ value: s.id, label: s.nome }))}
                      value={subtipoEntrada || null}
                      onChange={(v) => {
                        setSubtipoEntrada(v ?? "");
                        setErro(null);
                      }}
                      placeholder="Subtipo..."
                      buscaPlaceholder="Escreva o nome do subtipo"
                      disabled={subtiposReceber.length === 0}
                      className={cn(
                        COMBO,
                        faltando.has("subtipo-entrada") && !subtipoEntrada && "border-california-red",
                      )}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Define onde a receita entra no DRE.
                    {receberSemCentro.length < receber.length &&
                      ` Vale para ${receberSemCentro.length === 1 ? "o recebimento" : `os ${receberSemCentro.length} recebimentos`} sem centro de custo; ${receber.length - receberSemCentro.length === 1 ? "o outro usa o que já tem" : `os outros ${receber.length - receberSemCentro.length} usam o que já têm`}.`}
                  </p>
                </div>
              ) : (
                <p className="self-end text-[11px] text-muted-foreground">
                  {receber.length === 1
                    ? "O recebimento usa o centro de custo que já tem."
                    : `Os ${receber.length} recebimentos usam o centro de custo que já têm.`}
                </p>
              ))}
          </div>
        )}

        {receber.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>
              Recebimento com imposto retido pelo cliente não entra no lote: dê baixa nele sozinho,
              para informar a retenção imposto a imposto. Baixa parcial também é só uma por vez.
            </span>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
          <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
          <span>
            Ao confirmar, cada baixa é registrada e enviada para a{" "}
            <strong className="font-semibold text-foreground">Conciliação</strong>
            {contaEscolhida ? ` da conta ${contaEscolhida.nome}` : ""}, em linhas separadas, como se
            tivessem sido feitas uma a uma.
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCancelar}
          className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={confirmar}
          disabled={pending || itens.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          <CreditCard className="h-4 w-4" />
          {pending
            ? "Confirmando..."
            : itens.length === 1
              ? "Confirmar baixa"
              : `Confirmar ${itens.length} baixas`}
        </button>
      </div>
    </>
  );
}
