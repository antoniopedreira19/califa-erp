"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BadgePercent, Save, SendHorizonal, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn, formatCurrency } from "@/lib/utils";
import { calcularTotaisPlanejados } from "@/lib/calculos/versao-totais";
import {
  bvSituacaoLabel,
  type BvSituacao,
  type ItemBv,
  type TipoCusto,
} from "@/lib/types";
import {
  cancelarBv,
  confirmarBv,
  salvarBv,
  type ActionResult,
  type OrigemBv,
} from "./actions";

export interface FornecedorOpcao {
  id: string;
  nome: string;
}

/** Onde o BV é gravado.
 *
 *  Por padrão nas Server Actions, contra o item já existente no banco. O
 *  editor de orçamento do projeto passa um adaptador que guarda o BV no
 *  rascunho: lá o item ainda não tem id, e a linha em `itens_bv` só nasce
 *  no "Salvar orçamentos", depois que os itens existem. */
export interface AdaptadorBv {
  salvar: (itemId: string, formData: FormData) => Promise<ActionResult>;
  cancelar: (itemId: string) => Promise<ActionResult>;
  /** No-op no rascunho: o estado do React já é a fonte. */
  aposEscrita: () => void;
}

/** O que o formulário precisa do item. `VersaoOrcamentoItem` (orçamento)
 *  e `ItemPlanilhaJob` (job) satisfazem os dois — e nos dois o `id` é o
 *  id do item na VERSÃO, que é a chave do BV. */
export interface ItemComBv {
  id: string;
  item: string;
  tipo_custo: TipoCusto;
  categoria_id: string | null;
  valor_unitario_orcado: number;
  quantidade_orcada: number;
  dias_meses_orcado: number;
  total_orcado: number;
  valor_unitario_planejado: number;
  quantidade_planejada: number;
  dias_meses_planejado: number;
  total_planejado: number;
}

/** Bloco Realizado — só existe na planilha do job. */
export interface RealizadoDoItem {
  valorUnitario: number;
  quantidade: number;
  diasMeses: number;
  total: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: ItemComBv;
  grupoNome: string;
  versaoLabel: string;
  categoriaNome: string | null;
  moeda: string;
  bv: ItemBv | null;
  fornecedores: FornecedorOpcao[];
  /** Muda o rodapé e o terceiro bloco de valores. */
  origem: OrigemBv;
  /** Job: substitui a caixa de rentabilidade. Ignorado no orçamento. */
  realizado?: RealizadoDoItem | null;
  /** Contexto congelado (versão aprovada no orçamento, job encerrado):
   *  o BV é consultado, nunca gravado. */
  readOnly?: boolean;
  /** Ausente ⇒ grava direto nas Server Actions. */
  adaptador?: AdaptadorBv;
}

/** Aceita "1.234,56" e "1234.56". Vírgula presente ⇒ ponto é milhar.
 *  Mesma regra da edição inline da planilha. */
function parseNumero(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  const normalizado = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/** Só roda ao abrir o formulário, nunca a cada tecla — durante a digitação
 *  o campo fica cru. Campo de dinheiro tem que reabrir "750,50", não
 *  "750,5"; o separador de milhar volta a ser lido por `parseNumero`,
 *  que trata ponto como milhar quando há vírgula. */
function paraEdicao(valor: number): string {
  if (valor === 0) return "";
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarPercentual(percentual: number): string {
  return `${percentual.toFixed(1).replace(".", ",")}%`;
}

export function BvDialog({
  open,
  onOpenChange,
  item,
  grupoNome,
  versaoLabel,
  categoriaNome,
  moeda,
  bv,
  fornecedores,
  origem,
  realizado,
  readOnly,
  adaptador,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const acoes = React.useMemo<AdaptadorBv>(
    () =>
      adaptador ?? {
        salvar: (itemId, formData) => salvarBv(itemId, formData, origem),
        cancelar: (itemId) => cancelarBv(itemId, origem),
        aposEscrita: () => router.refresh(),
      },
    [adaptador, origem, router],
  );
  const [erro, setErro] = React.useState<string | null>(null);
  const [askRemover, setAskRemover] = React.useState(false);
  const [askConfirmar, setAskConfirmar] = React.useState(false);

  const [fornecedorId, setFornecedorId] = React.useState<string | null>(null);
  const [valorRaw, setValorRaw] = React.useState("");

  const noJob = origem === "job";

  /** Sem BV na linha, o formulário está criando um — e todo BV nasce em
   *  "A negociar". As páginas só entregam BVs ativos, então cancelado
   *  nunca chega aqui. */
  const situacaoAtual: BvSituacao = bv?.situacao ?? "a_negociar";

  /** Confirmado já foi ao financeiro; recebido já teve baixa no contas a
   *  receber. Nos dois casos ninguém altera mais nada. */
  const travadoPorSituacao = situacaoAtual !== "a_negociar";
  const somenteLeitura = Boolean(readOnly) || travadoPorSituacao;

  // Reabrir o formulário tem que trazer os valores do banco de volta, e
  // um BV recém-cancelado não pode deixar resíduo no próximo item aberto.
  React.useEffect(() => {
    if (!open) return;
    setFornecedorId(bv?.fornecedor_id ?? null);
    setValorRaw(paraEdicao(Number(bv?.valor ?? 0)));
    setErro(null);
  }, [open, bv]);

  const totalOrcado = Number(item.total_orcado);
  const totalPlanejado = Number(item.total_planejado);
  const { rentabilidade, percentualRentabilidade } = calcularTotaisPlanejados([
    { total_orcado: totalOrcado, total_planejado: totalPlanejado },
  ]);

  const valorBv = parseNumero(valorRaw) ?? 0;
  // Percentual sobre o orçado: é sobre esse total que o BV é negociado.
  const percentualBv = totalOrcado > 0 ? (valorBv / totalOrcado) * 100 : null;

  const prazoRef = React.useRef<HTMLFormElement>(null);

  /** Lê o prazo do input escondido do DatePicker e monta o payload. */
  function montarFormData(): FormData | null {
    const valor = parseNumero(valorRaw);
    if (valor === null) {
      setErro("Informe o valor do BV.");
      return null;
    }
    const formData = new FormData();
    if (fornecedorId) formData.set("fornecedor_id", fornecedorId);
    formData.set("valor", String(valor));
    const prazo = prazoRef.current
      ? new FormData(prazoRef.current).get("prazo_repasse")
      : null;
    if (prazo) formData.set("prazo_repasse", prazo.toString());
    return formData;
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (somenteLeitura) return;

    const formData = montarFormData();
    if (!formData) return;

    setErro(null);
    startTransition(async () => {
      const res = await acoes.salvar(item.id, formData);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      acoes.aposEscrita();
    });
  }

  /** Confirmar exige fornecedor: é quem vai devolver o valor, e sem nome
   *  não existe cobrança. A trava também vale no servidor. */
  function handlePedirConfirmacao() {
    if (!fornecedorId) {
      setErro("Informe o fornecedor antes de confirmar o BV.");
      return;
    }
    if (parseNumero(valorRaw) === null) {
      setErro("Informe o valor do BV.");
      return;
    }
    setErro(null);
    setAskConfirmar(true);
  }

  function handleConfirmar() {
    startTransition(async () => {
      // Grava primeiro o que estiver na tela: confirmar sem salvar
      // enviaria ao financeiro um valor diferente do que o usuário vê.
      const formData = montarFormData();
      if (!formData) {
        setAskConfirmar(false);
        return;
      }
      const salvo = await acoes.salvar(item.id, formData);
      if (!salvo.ok) {
        setAskConfirmar(false);
        setErro(salvo.message);
        return;
      }
      const res = await confirmarBv(item.id);
      setAskConfirmar(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  function handleRemover() {
    startTransition(async () => {
      const res = await acoes.cancelar(item.id);
      setAskRemover(false);
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      onOpenChange(false);
      acoes.aposEscrita();
    });
  }

  const fornecedorFaltando = noJob && !fornecedorId && !somenteLeitura;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
          <form ref={prazoRef} onSubmit={handleSubmit}>
            {/* Cabeçalho — identifica a linha da planilha de onde o
                formulário foi aberto. */}
            <div className="flex items-start gap-4 px-6 pb-4 pt-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-lg font-bold tracking-tight">
                    {item.item}
                  </DialogTitle>
                  <Badge variant="outline" className="px-1.5">
                    {item.tipo_custo}
                  </Badge>
                  {categoriaNome && (
                    <Badge variant="neutral">{categoriaNome}</Badge>
                  )}
                </div>
                <DialogDescription className="text-xs">
                  Grupo {grupoNome} · versão {versaoLabel} · cliente paga o
                  fornecedor diretamente
                </DialogDescription>
              </div>
            </div>

            {erro && (
              <div className="flex items-center justify-between gap-3 border-y border-california-red/20 bg-california-red/5 px-6 py-2 text-xs text-california-red">
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

            <div className="grid border-t border-border md:grid-cols-2">
              {/* Coluna esquerda — de onde o BV é calculado. Só leitura:
                  editar número de planilha continua sendo na planilha. */}
              <div className="flex flex-col gap-4 border-b border-border px-6 py-5 md:border-b-0 md:border-r">
                <BlocoValores
                  titulo="Orçado"
                  valorUnitario={Number(item.valor_unitario_orcado)}
                  quantidade={Number(item.quantidade_orcada)}
                  diasMeses={Number(item.dias_meses_orcado)}
                  total={totalOrcado}
                  moeda={moeda}
                />
                <BlocoValores
                  titulo="Planejado"
                  valorUnitario={Number(item.valor_unitario_planejado)}
                  quantidade={Number(item.quantidade_planejada)}
                  diasMeses={Number(item.dias_meses_planejado)}
                  total={totalPlanejado}
                  moeda={moeda}
                  tom="azul"
                />

                {/* No job o terceiro bloco é o Realizado — é o número que
                    importa em execução. A rentabilidade do item continua
                    na planilha, no rodapé do grupo. No orçamento não há
                    realizado, então fica a caixa de rentabilidade. */}
                {noJob ? (
                  <BlocoValores
                    titulo="Realizado"
                    valorUnitario={realizado?.valorUnitario ?? 0}
                    quantidade={realizado?.quantidade ?? 0}
                    diasMeses={realizado?.diasMeses ?? 0}
                    total={realizado?.total ?? 0}
                    moeda={moeda}
                    tom="ambar"
                  />
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-800/80">
                      Rentabilidade do item
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-baseline gap-2 whitespace-nowrap font-mono",
                        rentabilidade >= 0
                          ? "text-emerald-700"
                          : "text-california-red",
                      )}
                    >
                      <span className="text-[15px] font-bold">
                        {formatCurrency(rentabilidade, moeda)}
                      </span>
                      <span className="text-xs font-semibold">
                        {percentualRentabilidade === null
                          ? "—"
                          : formatarPercentual(percentualRentabilidade)}
                      </span>
                    </span>
                  </div>
                )}
              </div>

              {/* Coluna direita — o BV propriamente dito. */}
              <div className="flex flex-col gap-4 bg-muted/30 px-6 py-5">
                <div className="flex items-center gap-2">
                  <BadgePercent className="h-4 w-4 text-california-red" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-foreground">
                    BV do item
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="bv-fornecedor"
                    className="text-[13px] font-semibold text-foreground"
                  >
                    Fornecedor
                    {noJob && <span className="ml-1 text-california-red">*</span>}
                  </label>
                  <Combobox
                    id="bv-fornecedor"
                    items={fornecedores.map((f) => ({
                      value: f.id,
                      label: f.nome,
                    }))}
                    value={fornecedorId}
                    onChange={setFornecedorId}
                    placeholder="Selecione o fornecedor"
                    disabled={somenteLeitura || pending}
                    className={cn(
                      "h-11 rounded-xl",
                      fornecedorFaltando &&
                        "border-amber-400 ring-2 ring-amber-200",
                    )}
                  />
                  <span
                    className={cn(
                      "text-[11.5px] leading-relaxed",
                      fornecedorFaltando
                        ? "font-medium text-amber-700"
                        : "text-muted-foreground",
                    )}
                  >
                    {noJob
                      ? "Obrigatório para confirmar: é quem devolve o valor à California."
                      : "Opcional aqui — pode ser definido depois, no acompanhamento do job."}
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="bv-valor"
                    className="text-[13px] font-semibold text-foreground"
                  >
                    Valor do BV
                  </label>
                  <div
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border border-border bg-white px-3.5 py-2.5 transition-colors",
                      "focus-within:border-foreground focus-within:ring-[3px] focus-within:ring-foreground/[0.07]",
                      somenteLeitura && "opacity-70",
                    )}
                  >
                    <span className="font-mono text-[13px] text-muted-foreground">
                      {moeda === "BRL" ? "R$" : moeda}
                    </span>
                    <input
                      id="bv-valor"
                      inputMode="decimal"
                      value={valorRaw}
                      onChange={(e) => setValorRaw(e.target.value)}
                      disabled={somenteLeitura || pending}
                      placeholder="0,00"
                      className="min-w-0 flex-1 bg-transparent font-mono text-[15px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
                    />
                    <span className="whitespace-nowrap font-mono text-[13px] font-semibold text-muted-foreground">
                      {percentualBv === null
                        ? "—"
                        : formatarPercentual(percentualBv)}
                    </span>
                  </div>
                  <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                    Percentual calculado sobre o total orçado.
                  </span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground">
                    Prazo de repasse
                  </span>
                  <DatePicker
                    name="prazo_repasse"
                    defaultValue={bv?.prazo_repasse ?? ""}
                    disabled={somenteLeitura || pending}
                    placeholder="Selecione a data"
                    className="rounded-xl"
                  />
                </div>

                {/* Situação é derivada, nunca escolhida: quem a move são
                    os eventos de outras telas. Por isso ela é exibida, e
                    não editável — nem para quem pode editar o resto. */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground">
                    Situação
                  </span>
                  <div className="flex h-11 items-center rounded-xl border border-dashed border-border bg-white/60 px-3.5">
                    <Badge variant="neutral">
                      {bvSituacaoLabel(situacaoAtual)}
                    </Badge>
                  </div>
                  {travadoPorSituacao ? (
                    <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                      {situacaoAtual === "recebido"
                        ? "Já teve baixa no contas a receber."
                        : "Já foi enviado ao financeiro."}{" "}
                      A partir daqui nada mais é alterado neste BV.
                    </span>
                  ) : (
                    <span className="text-[11.5px] leading-relaxed text-muted-foreground">
                      Anda sozinha: nasce em <strong>A negociar</strong>, vira{" "}
                      <strong>Confirmado</strong> no envio ao financeiro e{" "}
                      <strong>Recebido</strong> na baixa do contas a receber.
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-border bg-card px-6 py-4">
              {bv && !somenteLeitura ? (
                <button
                  type="button"
                  onClick={() => setAskRemover(true)}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-california-red transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remover BV
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-xl border border-border bg-white px-5 py-2.5 text-[13px] font-semibold text-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
                >
                  {somenteLeitura ? "Fechar" : "Cancelar"}
                </button>
                {!somenteLeitura && (
                  <button
                    type="submit"
                    disabled={pending}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50",
                      // No job, Salvar é o passo intermediário e Confirmar
                      // é a ação de peso — a hierarquia visual segue isso.
                      noJob
                        ? "border border-border bg-white text-foreground"
                        : "bg-foreground text-white",
                    )}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {pending ? "Salvando..." : noJob ? "Salvar" : "Salvar BV"}
                  </button>
                )}
                {noJob && !somenteLeitura && (
                  <button
                    type="button"
                    onClick={handlePedirConfirmacao}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <SendHorizonal className="h-3.5 w-3.5" />
                    Confirmar
                  </button>
                )}
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={askRemover}
        onOpenChange={setAskRemover}
        title="Remover BV?"
        description={
          <>
            O BV de <strong className="text-foreground">{item.item}</strong>{" "}
            passa para <strong className="text-foreground">Cancelado</strong> e
            sai da planilha. Você pode lançar um novo no mesmo item depois — os
            valores atuais serão substituídos.
          </>
        }
        confirmLabel="Remover"
        cancelLabel="Voltar"
        variant="destructive"
        pending={pending}
        onConfirm={handleRemover}
      />

      {/* O envio ao financeiro é irreversível: confirmado, o BV trava nas
          duas telas. Por isso a confirmação explica o que acontece antes
          de acontecer. */}
      <ConfirmDialog
        open={askConfirmar}
        onOpenChange={setAskConfirmar}
        title="Confirmar e enviar ao financeiro?"
        description={
          <>
            O BV de <strong className="text-foreground">{item.item}</strong> no
            valor de{" "}
            <strong className="text-foreground">
              {formatCurrency(valorBv, moeda)}
            </strong>{" "}
            será enviado ao financeiro para cobrança do fornecedor{" "}
            <strong className="text-foreground">
              {fornecedores.find((f) => f.id === fornecedorId)?.nome ?? "—"}
            </strong>
            . Depois de confirmado, o BV passa a <strong>Confirmado</strong> e
            não pode mais ser editado nem removido — nem aqui, nem no
            orçamento.
          </>
        }
        confirmLabel="Confirmar envio"
        cancelLabel="Voltar"
        pending={pending}
        confirmDisabled
        confirmDisabledReason={
          <>
            O envio está desativado por enquanto: o módulo de faturamento
            ainda não existe, então não há para onde mandar o BV. O fluxo
            fica pronto e o botão é liberado quando o módulo entrar. Até lá,
            use <strong>Salvar</strong> para registrar a negociação.
          </>
        }
        onConfirm={handleConfirmar}
      />
    </>
  );
}

type Tom = "neutro" | "azul" | "ambar";

const TONS: Record<Tom, { titulo: string; borda: string; head: string; linha: string; total: string }> = {
  neutro: {
    titulo: "text-muted-foreground",
    borda: "border-border",
    head: "border-b border-border bg-muted/40 text-muted-foreground",
    linha: "",
    total: "",
  },
  azul: {
    titulo: "text-[#5a76a8]",
    borda: "border-[#dfeafb]",
    head: "border-b border-[#dfeafb] bg-blue-50/60 text-[#5a76a8]",
    linha: "bg-blue-50/20",
    total: "text-[#1e4fa3]",
  },
  ambar: {
    titulo: "text-[#b45309]",
    borda: "border-[#f7e6c2]",
    head: "border-b border-[#f7e6c2] bg-[#FFFBEB] text-[#b45309]",
    linha: "bg-[#FFFDF5]",
    total: "text-[#b45309]",
  },
};

/** Mini-planilha de leitura: repete um bloco da linha para o usuário ver
 *  sobre o que está negociando o BV. */
function BlocoValores({
  titulo,
  valorUnitario,
  quantidade,
  diasMeses,
  total,
  moeda,
  tom = "neutro",
}: {
  titulo: string;
  valorUnitario: number;
  quantidade: number;
  diasMeses: number;
  total: number;
  moeda: string;
  tom?: Tom;
}) {
  const c = TONS[tom];
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className={cn(
          "text-[10px] font-bold uppercase tracking-[0.1em]",
          c.titulo,
        )}
      >
        {titulo}
      </span>
      <div className={cn("overflow-hidden rounded-xl border", c.borda)}>
        <table className="w-full table-fixed border-collapse text-xs">
          <thead>
            <tr
              className={cn(
                "text-[9.5px] font-semibold uppercase tracking-wider",
                c.head,
              )}
            >
              <th className="w-[30%] px-3 py-1.5 text-left">R$ Unit.</th>
              <th className="w-[20%] px-1.5 py-1.5 text-center">QT</th>
              <th className="w-[16%] px-1.5 py-1.5 text-center">D/M</th>
              <th className="w-[34%] px-3 py-1.5 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className={cn("h-9 font-mono", c.linha)}>
              <td className="whitespace-nowrap px-3">
                {formatCurrency(valorUnitario, moeda)}
              </td>
              <td className="px-1.5 text-center">{quantidade}</td>
              <td className="px-1.5 text-center">{diasMeses}</td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 text-right font-bold",
                  c.total,
                )}
              >
                {formatCurrency(total, moeda)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
