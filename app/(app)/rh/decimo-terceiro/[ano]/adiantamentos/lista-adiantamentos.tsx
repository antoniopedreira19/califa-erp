"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Loader2,
  AlertCircle,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  lancarAdiantamentoDecimoTerceiro,
  excluirAdiantamentoDecimoTerceiro,
  calcularTreizeBrutoEsperado,
} from "../../actions";

export interface AdiantamentoRow {
  id: string;
  colaborador_id: string;
  colaborador_nome: string;
  colaborador_funcao: string;
  colaborador_tipo: string;
  data: string;
  valor: number;
  obs: string | null;
  integral: boolean;
  folha_pagamento_id: string | null;
  folha_status: string | null;
  tem_nf: boolean;
  /** Folhas vinculadas por FK reversa: 2 pra híbrido novo (CLT+PJ),
   *  1 pros puros, 0 pros legados. Ordenado por origem ascendente
   *  (california, contabilidade).
   *  - `status` null em legado calculado em runtime.
   *  - `tem_nf` só faz sentido pra origem california (parte PJ). */
  partes: Array<{
    origem: string;
    salario_base: number;
    status: string | null;
    tem_nf: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Deriva o status visual do adiantamento com base no estado da folha e NF
//
// Legado = sem folha vinculada (pagamento foi feito antes do ERP entrar em
// vigor pra California). Nesses casos, se o adiantamento foi integral,
// mostramos "Pago — integral" pra explicar por que o colaborador sumiu
// da folha de 13º. Senão, só "Pago" cinza.

function derivarStatusAdiantamento(
  folha_status: string | null,
  tem_nf: boolean,
  tipo_contratacao: string,
  integral: boolean,
): { label: string; variant: "pago" | "pago_integral" | "aguardando_nf" | "aguardando_aprovacao" | "aprovado" } {
  if (!folha_status) {
    return integral
      ? { label: "Pago — integral", variant: "pago_integral" }
      : { label: "Pago", variant: "pago" };
  }
  if (folha_status === "paga") return { label: "Pago", variant: "pago" };
  if (folha_status === "aprovada") return { label: "Aprovado — a pagar", variant: "aprovado" };
  // status === 'enviada' (ou 'pendente_correcao' tratado como enviada)
  if (!tem_nf && ["pj", "mei", "clt_recibo"].includes(tipo_contratacao)) {
    return { label: "Aguardando NF", variant: "aguardando_nf" };
  }
  return { label: "Aguardando aprovação", variant: "aguardando_aprovacao" };
}

const variantClasses: Record<ReturnType<typeof derivarStatusAdiantamento>["variant"], string> = {
  pago: "bg-zinc-100 text-zinc-500",
  pago_integral: "bg-zinc-100 text-zinc-600 ring-1 ring-zinc-300",
  aguardando_nf: "bg-amber-50 text-amber-700",
  aguardando_aprovacao: "bg-blue-50 text-blue-700",
  aprovado: "bg-emerald-50 text-emerald-700",
};

export interface ColabOpcao {
  id: string;
  nome: string;
  tipo_contratacao: string;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const TIPO_LABEL: Record<string, string> = {
  clt: "CLT",
  clt_recibo: "Híbrido",
  pj: "PJ",
  mei: "MEI",
};

const TIPO_CLASSE: Record<string, string> = {
  clt: "bg-zinc-100 text-zinc-700",
  clt_recibo: "bg-violet-50 text-violet-700",
  pj: "bg-sky-50 text-sky-700",
  mei: "bg-sky-50 text-sky-700",
};

interface Props {
  ano: number;
  adiantamentos: AdiantamentoRow[];
  colaboradores: ColabOpcao[];
  podeEditar: boolean;
}

type OrdemCampo = "data" | "valor";
type OrdemDirecao = "asc" | "desc";
type FiltroStatus =
  | "todos"
  | "pago"
  | "pago_integral"
  | "aguardando_nf"
  | "aguardando_aprovacao"
  | "aprovado";

const FILTRO_STATUS_LABEL: Record<FiltroStatus, string> = {
  todos: "Todos os status",
  pago: "Pago",
  pago_integral: "Pago — integral",
  aguardando_nf: "Aguardando NF",
  aguardando_aprovacao: "Aguardando aprovação",
  aprovado: "Aprovado — a pagar",
};

export function ListaAdiantamentos({
  ano,
  adiantamentos,
  colaboradores,
  podeEditar,
}: Props) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [excluindoId, setExcluindoId] = React.useState<string | null>(null);
  const [busca, setBusca] = React.useState("");
  const [filtroStatus, setFiltroStatus] = React.useState<FiltroStatus>("todos");
  const [ordemCampo, setOrdemCampo] = React.useState<OrdemCampo>("data");
  const [ordemDirecao, setOrdemDirecao] = React.useState<OrdemDirecao>("desc");

  async function handleExcluir(adiantamentoId: string) {
    if (!confirm("Excluir este adiantamento? A linha no financeiro será removida automaticamente se ainda não estiver aprovada.")) {
      return;
    }
    setExcluindoId(adiantamentoId);
    const res = await excluirAdiantamentoDecimoTerceiro(adiantamentoId);
    setExcluindoId(null);
    if (!res.ok) {
      alert(res.message);
      return;
    }
    router.refresh();
  }

  function toggleOrdem(campo: OrdemCampo) {
    if (ordemCampo === campo) {
      setOrdemDirecao((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setOrdemCampo(campo);
      setOrdemDirecao(campo === "data" ? "desc" : "desc");
    }
  }

  // Híbrido com 2 folhas (parte CLT + parte PJ) pode expandir
  const [expandidas, setExpandidas] = React.useState<Set<string>>(new Set());
  function toggleExpansao(id: string) {
    setExpandidas((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  // Enriquece com o status derivado uma vez só, pra usar no filtro e na row
  const adiantamentosComStatus = React.useMemo(
    () =>
      adiantamentos.map((a) => ({
        row: a,
        status: derivarStatusAdiantamento(
          a.folha_status,
          a.tem_nf,
          a.colaborador_tipo,
          a.integral,
        ),
      })),
    [adiantamentos],
  );

  const lista = React.useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const filtrada = adiantamentosComStatus.filter(({ row, status }) => {
      if (filtroStatus !== "todos" && status.variant !== filtroStatus) return false;
      if (termo === "") return true;
      return (
        row.colaborador_nome.toLowerCase().includes(termo) ||
        row.colaborador_funcao.toLowerCase().includes(termo) ||
        (row.obs?.toLowerCase().includes(termo) ?? false)
      );
    });
    const sinal = ordemDirecao === "asc" ? 1 : -1;
    return [...filtrada].sort((a, b) => {
      if (ordemCampo === "data") {
        return a.row.data.localeCompare(b.row.data) * sinal;
      }
      return (a.row.valor - b.row.valor) * sinal;
    });
  }, [adiantamentosComStatus, busca, filtroStatus, ordemCampo, ordemDirecao]);

  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por colaborador, função ou observação…"
              className="pl-9"
            />
          </div>
          <Select
            value={filtroStatus}
            onValueChange={(v) => setFiltroStatus(v as FiltroStatus)}
          >
            <SelectTrigger className="sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(FILTRO_STATUS_LABEL) as FiltroStatus[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {FILTRO_STATUS_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {podeEditar && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-california-red-hover"
              >
                <Plus className="h-4 w-4" />
                Novo adiantamento
              </button>
            </DialogTrigger>
            <NovoAdiantamentoDialogContent
              ano={ano}
              colaboradores={colaboradores}
              onClose={() => setDialogOpen(false)}
            />
          </Dialog>
        )}
      </div>

      {adiantamentos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum adiantamento registrado em {ano}.
          </p>
        </div>
      ) : lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum adiantamento corresponde aos filtros aplicados.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-3"></th>
                <th className="px-4 py-3 text-left font-medium">
                  <HeaderOrdenavel
                    label="Data"
                    campo="data"
                    ordemCampo={ordemCampo}
                    ordemDirecao={ordemDirecao}
                    onClick={() => toggleOrdem("data")}
                    align="left"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Colaborador</th>
                <th className="px-4 py-3 text-left font-medium">Tipo</th>
                <th className="px-4 py-3 text-right font-medium">
                  <HeaderOrdenavel
                    label="Valor"
                    campo="valor"
                    ordemCampo={ordemCampo}
                    ordemDirecao={ordemDirecao}
                    onClick={() => toggleOrdem("valor")}
                    align="right"
                  />
                </th>
                <th className="px-4 py-3 text-left font-medium">Observação</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-center font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map(({ row: a, status }) => {
                const bloqueadoAprovado = a.folha_status === "aprovada" || a.folha_status === "paga";
                const bloqueadoNf = a.tem_nf && a.folha_status === "enviada";
                const excluirBloqueado = bloqueadoAprovado || bloqueadoNf;
                const tooltipExcluir = bloqueadoAprovado
                  ? "Adiantamento já aprovado pelo financeiro — cancele o título em contas a pagar primeiro."
                  : bloqueadoNf
                    ? "Colaborador já anexou NF — remova a NF antes de excluir."
                    : null;
                const ehHibridoComSplit =
                  a.colaborador_tipo === "clt_recibo" && a.partes.length >= 2;
                const expandida = expandidas.has(a.id);

                return (
                  <React.Fragment key={a.id}>
                  <tr className="border-t border-border">
                    <td className="px-2 py-3 text-center">
                      {ehHibridoComSplit && (
                        <button
                          type="button"
                          onClick={() => toggleExpansao(a.id)}
                          aria-label={expandida ? "Recolher" : "Expandir"}
                          className="inline-flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
                        >
                          {expandida ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {formatarData(a.data)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.colaborador_nome}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.colaborador_funcao}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {a.colaborador_tipo ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            TIPO_CLASSE[a.colaborador_tipo] ?? "bg-zinc-100 text-zinc-500"
                          }`}
                        >
                          {TIPO_LABEL[a.colaborador_tipo] ?? a.colaborador_tipo.toUpperCase()}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-california-red">
                      {brl.format(a.valor)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {a.obs ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variantClasses[status.variant]}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {podeEditar && (
                        excluirBloqueado ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center rounded-full p-1.5 text-muted-foreground/40 cursor-not-allowed">
                                  <Trash2 className="h-4 w-4" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[260px] text-center">
                                {tooltipExcluir}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleExcluir(a.id)}
                            disabled={excluindoId === a.id}
                            aria-label="Excluir"
                            className="inline-flex items-center justify-center rounded-full hover:bg-destructive/10 p-1.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                          >
                            {excluindoId === a.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                  {ehHibridoComSplit && expandida &&
                    a.partes.map((p) => {
                      const ehClt = p.origem === "contabilidade";
                      // Status por parte: CLT puro nunca espera NF; PJ sim.
                      // Se não tem status (legado), mostra "Pago".
                      const partStatus = (() => {
                        if (p.status == null) return { label: "Pago", classe: "bg-zinc-100 text-zinc-500" };
                        if (p.status === "paga") return { label: "Pago", classe: "bg-zinc-100 text-zinc-500" };
                        if (p.status === "aprovada") return { label: "Aprovado — a pagar", classe: "bg-emerald-50 text-emerald-700" };
                        // enviada / pendente_correcao
                        if (!ehClt && !p.tem_nf) {
                          return { label: "Aguardando NF", classe: "bg-amber-50 text-amber-700" };
                        }
                        return { label: "Aguardando aprovação", classe: "bg-blue-50 text-blue-700" };
                      })();
                      return (
                        <tr
                          key={`${a.id}-${p.origem}`}
                          className="border-t border-border/50 bg-muted/20 text-xs"
                        >
                          <td className="px-2 py-2"></td>
                          <td className="px-4 py-2 text-muted-foreground">—</td>
                          <td className="px-4 py-2 pl-10 italic text-muted-foreground">
                            {ehClt ? "Parte CLT (sem desconto)" : "Parte PJ (recibo)"}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                ehClt
                                  ? "bg-zinc-100 text-zinc-700"
                                  : "bg-sky-50 text-sky-700"
                              }`}
                            >
                              {ehClt ? "CLT" : "PJ"}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium text-california-red">
                            {brl.format(p.salario_base)}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">
                            {ehClt ? "Contabilidade" : "California"}
                          </td>
                          <td className="px-4 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${partStatus.classe}`}
                            >
                              {partStatus.label}
                            </span>
                          </td>
                          <td className="px-4 py-2"></td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NovoAdiantamentoDialogContent({
  ano,
  colaboradores,
  onClose,
}: {
  ano: number;
  colaboradores: ColabOpcao[];
  onClose: () => void;
}) {
  const router = useRouter();
  const hoje = new Date().toISOString().slice(0, 10);
  const [colabId, setColabId] = React.useState<string>("");
  const [data, setData] = React.useState<string>(hoje);
  const [obs, setObs] = React.useState<string>("");
  const [tipoAdiantamento, setTipoAdiantamento] = React.useState<
    "primeira_parcela" | "integral" | null
  >(null);
  const [destino, setDestino] = React.useState<"ambos" | "clt" | "pj">(
    "ambos",
  );
  const [brutoCalculado, setBrutoCalculado] = React.useState<{
    bruto: number;
    tipoContratacao: string;
    brutoClt: number | null;
    brutoPj: number | null;
  } | null>(null);
  const [carregandoBruto, setCarregandoBruto] = React.useState(false);
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  // Ao escolher o colaborador, busca o 13º bruto esperado. Pra híbrido
  // vem também o split brutoClt/brutoPj.
  React.useEffect(() => {
    if (!colabId) {
      setBrutoCalculado(null);
      setTipoAdiantamento(null);
      setDestino("ambos");
      return;
    }
    let cancelado = false;
    setCarregandoBruto(true);
    setErro(null);
    setBrutoCalculado(null);
    setTipoAdiantamento(null);
    setDestino("ambos");
    calcularTreizeBrutoEsperado({ colaborador_id: colabId, ano })
      .then((res) => {
        if (cancelado) return;
        if (!res.ok) {
          setErro(res.message);
          setBrutoCalculado(null);
        } else {
          setBrutoCalculado({
            bruto: res.bruto,
            tipoContratacao: res.tipo_contratacao,
            brutoClt: res.brutoClt,
            brutoPj: res.brutoPj,
          });
        }
      })
      .finally(() => {
        if (!cancelado) setCarregandoBruto(false);
      });
    return () => {
      cancelado = true;
    };
  }, [colabId, ano]);

  // Híbrido só é "real" quando a API devolveu o split (clt_recibo com
  // valor_recibo > 0 e < salário). Nos demais casos, o destino é
  // irrelevante e o seletor fica escondido.
  const ehHibrido =
    brutoCalculado != null &&
    brutoCalculado.tipoContratacao === "clt_recibo" &&
    brutoCalculado.brutoClt != null &&
    brutoCalculado.brutoPj != null;

  // Base para os valores dos radios "primeira parcela" / "integral".
  // Pra híbrido com destino='clt' ou 'pj', usa só a parte correspondente.
  const baseBruto = React.useMemo(() => {
    if (brutoCalculado == null) return null;
    if (!ehHibrido || destino === "ambos") return brutoCalculado.bruto;
    if (destino === "clt") return brutoCalculado.brutoClt;
    return brutoCalculado.brutoPj;
  }, [brutoCalculado, ehHibrido, destino]);

  const valorCalculado =
    baseBruto == null || tipoAdiantamento == null
      ? null
      : tipoAdiantamento === "integral"
        ? baseBruto
        : Math.round((baseBruto / 2) * 100) / 100;

  async function handleSalvar() {
    setErro(null);
    if (!colabId) {
      setErro("Escolha um colaborador.");
      return;
    }
    if (tipoAdiantamento == null || valorCalculado == null || valorCalculado <= 0) {
      setErro("Escolha o tipo do adiantamento.");
      return;
    }
    setEnviando(true);
    const res = await lancarAdiantamentoDecimoTerceiro({
      ano,
      colaborador_id: colabId,
      data,
      valor: valorCalculado,
      obs: obs.trim() === "" ? null : obs.trim(),
      integral: tipoAdiantamento === "integral",
      destino: ehHibrido ? destino : "ambos",
    });
    setEnviando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onClose();
    router.refresh();
  }

  return (
    <DialogContent className="sm:max-w-[560px]">
      <DialogHeader>
        <DialogTitle>Novo adiantamento de 13º</DialogTitle>
        <DialogDescription>
          Cria linha no financeiro aguardando aprovação e abate automaticamente
          da 1ª parcela quando a folha for calculada.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="colab">Colaborador</Label>
          <Select value={colabId} onValueChange={setColabId}>
            <SelectTrigger id="colab">
              <SelectValue placeholder="Escolha o colaborador" />
            </SelectTrigger>
            <SelectContent>
              {colaboradores.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Seletor de destino: só aparece pra colaborador híbrido com split
            real (clt_recibo + valor_recibo > 0). Pros demais, o backend
            ignora destino e sempre grava 'ambos'. */}
        {ehHibrido && (
          <div className="space-y-2">
            <Label>Qual parte do 13º adiantar?</Label>
            <p className="text-xs text-muted-foreground">
              O colaborador é híbrido (CLT + Recibo). Escolha se o adiantamento
              cobre as duas partes proporcionalmente ou apenas uma delas.
            </p>
            <RadioGroup
              value={destino}
              onValueChange={(v) => {
                setDestino(v as "ambos" | "clt" | "pj");
                // Troca de destino muda o valor-base; limpa a escolha
                // de tipo pra forçar o usuário a reconferir.
                setTipoAdiantamento(null);
              }}
              disabled={enviando}
              className="grid grid-cols-3 gap-2"
            >
              {([
                { v: "ambos", label: "Ambas", val: brutoCalculado?.bruto },
                { v: "clt", label: "Só CLT", val: brutoCalculado?.brutoClt },
                { v: "pj", label: "Só PJ", val: brutoCalculado?.brutoPj },
              ] as const).map((opt) => (
                <label
                  key={opt.v}
                  htmlFor={`destino-${opt.v}`}
                  className={`flex cursor-pointer flex-col items-start gap-1 rounded-lg border p-3 transition-colors ${
                    destino === opt.v
                      ? "border-california-red bg-california-red/5"
                      : "border-border bg-muted/20 hover:bg-muted/40"
                  }`}
                >
                  <div className="flex w-full items-center gap-2">
                    <RadioGroupItem id={`destino-${opt.v}`} value={opt.v} />
                    <span className="text-sm font-medium">{opt.label}</span>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    Base: {opt.val != null ? brl.format(opt.val) : "—"}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
        )}

        <div className="space-y-2">
          <Label>Tipo do adiantamento</Label>
          {!colabId ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
              Escolha um colaborador acima pra ver os valores calculados.
            </p>
          ) : carregandoBruto ? (
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 inline h-3 w-3 animate-spin" />
              Calculando o 13º do colaborador…
            </p>
          ) : brutoCalculado == null || baseBruto == null ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-4 text-center text-xs text-destructive">
              Não foi possível calcular o 13º — veja o erro acima.
            </p>
          ) : (
            <RadioGroup
              value={tipoAdiantamento ?? ""}
              onValueChange={(v) =>
                setTipoAdiantamento(v as "primeira_parcela" | "integral")
              }
              disabled={enviando}
              className="gap-2"
            >
              <label
                htmlFor="tipo-primeira"
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                  tipoAdiantamento === "primeira_parcela"
                    ? "border-california-red bg-california-red/5"
                    : "border-border bg-muted/20 hover:bg-muted/40"
                }`}
              >
                <RadioGroupItem id="tipo-primeira" value="primeira_parcela" />
                <div className="flex flex-1 items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Primeira parcela do 13º</div>
                    <div className="text-xs text-muted-foreground">
                      Metade do 13º{ehHibrido && destino !== "ambos" ? ` (parte ${destino === "clt" ? "CLT" : "PJ"})` : ""}. Abate da 1ª parcela quando a folha for calculada.
                    </div>
                  </div>
                  <div className="shrink-0 text-right tabular-nums font-semibold text-california-red">
                    {brl.format(Math.round((baseBruto / 2) * 100) / 100)}
                  </div>
                </div>
              </label>
              {/* Integral só faz sentido pra destino='ambos': significa
                  "quitou o 13º inteiro, tira da folha". Pra destino=clt/pj,
                  o colaborador ainda tem a outra parte na folha, então
                  mantemos só "primeira parcela" e opções de parcial. */}
              {(!ehHibrido || destino === "ambos") && (
                <label
                  htmlFor="tipo-integral"
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                    tipoAdiantamento === "integral"
                      ? "border-california-red bg-california-red/5"
                      : "border-border bg-muted/20 hover:bg-muted/40"
                  }`}
                >
                  <RadioGroupItem id="tipo-integral" value="integral" />
                  <div className="flex flex-1 items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">Valor integral do 13º</div>
                      <div className="text-xs text-muted-foreground">
                        Quita o 13º inteiro. O colaborador não participa da folha deste ano.
                      </div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums font-semibold text-california-red">
                      {brl.format(baseBruto)}
                    </div>
                  </div>
                </label>
              )}
            </RadioGroup>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="data">Data do adiantamento</Label>
          <Input
            id="data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            disabled={enviando}
            className="sm:max-w-[200px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="obs">Observação (opcional)</Label>
          <textarea
            id="obs"
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            disabled={enviando}
            rows={2}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/30"
          />
        </div>

        {erro && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={enviando}
            className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={enviando}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Lançar
          </button>
        </div>
      </div>
    </DialogContent>
  );
}

function HeaderOrdenavel({
  label,
  campo,
  ordemCampo,
  ordemDirecao,
  onClick,
  align,
}: {
  label: string;
  campo: OrdemCampo;
  ordemCampo: OrdemCampo;
  ordemDirecao: OrdemDirecao;
  onClick: () => void;
  align: "left" | "right";
}) {
  const ativo = ordemCampo === campo;
  const Icon = !ativo ? ArrowUpDown : ordemDirecao === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-foreground ${
        ativo ? "text-foreground" : ""
      } ${align === "right" ? "flex-row-reverse" : ""}`}
    >
      {label}
      <Icon className="h-3 w-3" />
    </button>
  );
}
