"use client";

import * as React from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Edit3,
  Trash2,
  ArrowRightLeft,
  Scissors,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DrawerContent,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ROTULO_PENDENCIA_FERIAS,
  type NivelPendenciaFerias,
} from "@/lib/rh/pendencias-ferias";
import type { PendenciaColaboradorRow } from "./aba-pendencias";
import {
  excluirLancamentoFerias,
  editarLancamentoFerias,
  moverLancamentoFerias,
  dividirLancamentoCombinado,
} from "./actions-pendencias";

type Props = {
  row: PendenciaColaboradorRow;
  aberto: boolean;
  onFechar: () => void;
};

type AcaoAtiva =
  | { tipo: "excluir"; lancId: string }
  | { tipo: "editar"; lancId: string }
  | { tipo: "mover"; lancId: string }
  | { tipo: "dividir"; lancId: string }
  | null;

export function DrawerPendenciasColaborador({ row, aberto, onFechar }: Props) {
  const [acao, setAcao] = React.useState<AcaoAtiva>(null);

  const lancamentoDaAcao = React.useMemo(() => {
    if (!acao) return null;
    return row.lancamentos.find((l) => l.id === acao.lancId) ?? null;
  }, [acao, row.lancamentos]);

  // Agrupa lançamentos por período, preservando "sem período" (abono avulso)
  const porPeriodo = new Map<string | null, typeof row.lancamentos>();
  for (const l of row.lancamentos) {
    const arr = porPeriodo.get(l.periodo_id) ?? [];
    arr.push(l);
    porPeriodo.set(l.periodo_id, arr);
  }

  const idsEmPendencia = new Set(
    row.itens.flatMap((i) => i.lancamentos_envolvidos),
  );

  return (
    <>
      <Dialog
        open={aberto}
        onOpenChange={(v) => {
          if (!v) onFechar();
        }}
      >
        <DrawerContent className="w-full sm:max-w-2xl">
          {/* Header */}
          <div className="p-6 border-b border-border">
            <h2 className="text-lg font-semibold">{row.nome}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {row.total} pendência{row.total !== 1 ? "s" : ""} no histórico
              de férias
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Lista de pendências */}
            <section>
              <h3 className="text-sm font-semibold mb-3">
                Pendências identificadas
              </h3>
              <ul className="space-y-2">
                {row.itens.map((i, idx) => (
                  <li
                    key={idx}
                    className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${classDoNivel(i.nivel)}`}
                  >
                    {iconeDoNivel(i.nivel)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">
                        {ROTULO_PENDENCIA_FERIAS[i.tipo]} · aquisitivo{" "}
                        {i.aquisitivo}
                      </p>
                      <p className="text-xs mt-0.5 opacity-90">
                        {i.descricao}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Lançamentos por período */}
            <section>
              <h3 className="text-sm font-semibold mb-3">
                Lançamentos registrados
              </h3>
              <div className="space-y-4">
                {row.periodos
                  .filter((p) =>
                    row.lancamentos.some((l) => l.periodo_id === p.id),
                  )
                  .map((periodo) => {
                    const lancs = porPeriodo.get(periodo.id) ?? [];
                    const totalUsado = lancs.reduce(
                      (s, l) => s + l.dias,
                      0,
                    );
                    const estourado = totalUsado > periodo.dias_direito;
                    return (
                      <div
                        key={periodo.id}
                        className="rounded-xl border border-border overflow-hidden"
                      >
                        <div className="flex items-center justify-between bg-muted/40 px-4 py-2 text-xs">
                          <span className="font-semibold">
                            Aquisitivo {periodo.aquisitivo}
                          </span>
                          <span
                            className={
                              estourado
                                ? "text-california-red font-semibold"
                                : "text-muted-foreground"
                            }
                          >
                            {totalUsado}d de {periodo.dias_direito}d
                          </span>
                        </div>
                        <ul className="divide-y divide-border">
                          {lancs.map((l) => (
                            <LancamentoLinha
                              key={l.id}
                              lanc={l}
                              emPendencia={idsEmPendencia.has(l.id)}
                              onAcao={(tipo) =>
                                setAcao({ tipo, lancId: l.id })
                              }
                            />
                          ))}
                        </ul>
                      </div>
                    );
                  })}
              </div>
            </section>
          </div>
        </DrawerContent>
      </Dialog>

      {/* Modais de ação */}
      {acao?.tipo === "excluir" && lancamentoDaAcao && (
        <ModalExcluir
          lanc={lancamentoDaAcao}
          onFechar={() => setAcao(null)}
        />
      )}
      {acao?.tipo === "editar" && lancamentoDaAcao && (
        <ModalEditar
          lanc={lancamentoDaAcao}
          onFechar={() => setAcao(null)}
        />
      )}
      {acao?.tipo === "mover" && lancamentoDaAcao && (
        <ModalMover
          lanc={lancamentoDaAcao}
          periodos={row.periodos}
          onFechar={() => setAcao(null)}
        />
      )}
      {acao?.tipo === "dividir" && lancamentoDaAcao && (
        <ModalDividir
          lanc={lancamentoDaAcao}
          periodos={row.periodos}
          onFechar={() => setAcao(null)}
        />
      )}
    </>
  );
}

// ======================================================================
// Linha de lançamento
// ======================================================================

function LancamentoLinha({
  lanc,
  emPendencia,
  onAcao,
}: {
  lanc: PendenciaColaboradorRow["lancamentos"][number];
  emPendencia: boolean;
  onAcao: (tipo: "excluir" | "editar" | "mover" | "dividir") => void;
}) {
  const diasFolga = lanc.dias - (lanc.dias_abono ?? 0);
  const inicioFmt = lanc.data_inicio
    ? new Date(lanc.data_inicio + "T00:00:00").toLocaleDateString("pt-BR")
    : "sem data";
  const fimFmt = lanc.data_fim
    ? new Date(lanc.data_fim + "T00:00:00").toLocaleDateString("pt-BR")
    : "-";

  return (
    <li
      className={`px-4 py-3 ${emPendencia ? "bg-amber-50/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            <span className="font-medium">
              {tipoLabel(lanc.tipo)}
            </span>{" "}
            <span className="text-muted-foreground">·</span>{" "}
            {lanc.dias}d
            {lanc.dias_abono > 0 && (
              <span className="text-muted-foreground text-xs ml-1">
                ({diasFolga} folga + {lanc.dias_abono} abono)
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {inicioFmt} → {fimFmt}
          </p>
          {lanc.observacao && (
            <p className="text-xs text-muted-foreground italic mt-1">
              &ldquo;{lanc.observacao}&rdquo;
            </p>
          )}
        </div>
        <div className="flex gap-1">
          <BotaoAcao
            onClick={() => onAcao("editar")}
            icon={<Edit3 className="h-3.5 w-3.5" />}
            label="Editar"
          />
          <BotaoAcao
            onClick={() => onAcao("mover")}
            icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
            label="Mover"
          />
          <BotaoAcao
            onClick={() => onAcao("dividir")}
            icon={<Scissors className="h-3.5 w-3.5" />}
            label="Dividir"
          />
          <BotaoAcao
            onClick={() => onAcao("excluir")}
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Excluir"
            destrutivo
          />
        </div>
      </div>
    </li>
  );
}

function BotaoAcao({
  onClick,
  icon,
  label,
  destrutivo = false,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  destrutivo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors ${
        destrutivo
          ? "hover:bg-california-red/10 hover:text-california-red hover:border-california-red/30"
          : "hover:bg-muted"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ======================================================================
// Modal: Excluir
// ======================================================================

function ModalExcluir({
  lanc,
  onFechar,
}: {
  lanc: PendenciaColaboradorRow["lancamentos"][number];
  onFechar: () => void;
}) {
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const r = await excluirLancamentoFerias({
      lancamento_id: lanc.id,
      motivo,
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onFechar();
    window.location.reload();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Excluir lançamento</DialogTitle>
          <DialogDescription>
            Vai apagar o lançamento de {lanc.dias} dia
            {lanc.dias !== 1 ? "s" : ""}. Essa ação é irreversível.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="motivo-excluir">Motivo da exclusão</Label>
          <Textarea
            id="motivo-excluir"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Duplicata · aquisitivo errado · cadastro em teste"
            rows={3}
          />
        </div>
        {erro && <p className="text-sm text-california-red">{erro}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={confirmar}
            disabled={enviando || motivo.trim().length < 3}
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ======================================================================
// Modal: Editar
// ======================================================================

function ModalEditar({
  lanc,
  onFechar,
}: {
  lanc: PendenciaColaboradorRow["lancamentos"][number];
  onFechar: () => void;
}) {
  const [dataInicio, setDataInicio] = React.useState(lanc.data_inicio ?? "");
  const [dataFim, setDataFim] = React.useState(lanc.data_fim ?? "");
  const [diasAbono, setDiasAbono] = React.useState(lanc.dias_abono ?? 0);
  const [observacao, setObservacao] = React.useState(lanc.observacao ?? "");
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const r = await editarLancamentoFerias({
      lancamento_id: lanc.id,
      data_inicio: dataInicio,
      data_fim: dataFim,
      dias_abono: diasAbono,
      observacao: observacao || null,
      motivo,
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onFechar();
    window.location.reload();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar lançamento</DialogTitle>
          <DialogDescription>
            Ajuste datas, dias de abono e observação do lançamento.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="editar-inicio">Data de início</Label>
            <Input
              id="editar-inicio"
              type="date"
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="editar-fim">Data de fim</Label>
            <Input
              id="editar-fim"
              type="date"
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="editar-abono">Dias de abono (0 a 10)</Label>
            <Input
              id="editar-abono"
              type="number"
              min={0}
              max={10}
              value={diasAbono}
              onChange={(e) => setDiasAbono(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="editar-obs">Observação</Label>
            <Textarea
              id="editar-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="editar-motivo">Motivo da edição</Label>
            <Textarea
              id="editar-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Datas erradas no cadastro original"
              rows={2}
            />
          </div>
        </div>
        {erro && <p className="text-sm text-california-red">{erro}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button
            onClick={confirmar}
            disabled={enviando || motivo.trim().length < 3}
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ======================================================================
// Modal: Mover
// ======================================================================

function ModalMover({
  lanc,
  periodos,
  onFechar,
}: {
  lanc: PendenciaColaboradorRow["lancamentos"][number];
  periodos: PendenciaColaboradorRow["periodos"];
  onFechar: () => void;
}) {
  const [novoPeriodo, setNovoPeriodo] = React.useState<string>("");
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  const periodosDisponiveis = periodos.filter((p) => p.id !== lanc.periodo_id);

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const r = await moverLancamentoFerias({
      lancamento_id: lanc.id,
      novo_periodo_id: novoPeriodo,
      motivo,
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onFechar();
    window.location.reload();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover para outro aquisitivo</DialogTitle>
          <DialogDescription>
            O lançamento vai mudar de período aquisitivo sem alterar as datas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Novo período aquisitivo</Label>
            <Select
              value={novoPeriodo}
              onValueChange={(v) => setNovoPeriodo(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Escolha o período de destino" />
              </SelectTrigger>
              <SelectContent>
                {periodosDisponiveis.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.aquisitivo} · {p.dias_direito}d direito ·{" "}
                    {p.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mover-motivo">Motivo</Label>
            <Textarea
              id="mover-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Aquisitivo cadastrado errado na planilha original"
            />
          </div>
        </div>
        {erro && <p className="text-sm text-california-red">{erro}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button
            onClick={confirmar}
            disabled={enviando || !novoPeriodo || motivo.trim().length < 3}
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Mover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ======================================================================
// Modal: Dividir
// ======================================================================

type Parte = {
  periodo_id: string;
  data_inicio: string;
  data_fim: string;
  dias_abono: number;
};

function ModalDividir({
  lanc,
  periodos,
  onFechar,
}: {
  lanc: PendenciaColaboradorRow["lancamentos"][number];
  periodos: PendenciaColaboradorRow["periodos"];
  onFechar: () => void;
}) {
  const [partes, setPartes] = React.useState<Parte[]>([
    {
      periodo_id: lanc.periodo_id ?? "",
      data_inicio: lanc.data_inicio ?? "",
      data_fim: "",
      dias_abono: 0,
    },
    {
      periodo_id: "",
      data_inicio: "",
      data_fim: lanc.data_fim ?? "",
      dias_abono: 0,
    },
  ]);
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  function atualizar(idx: number, patch: Partial<Parte>) {
    setPartes((cur) =>
      cur.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  }

  function adicionarParte() {
    if (partes.length >= 4) return;
    setPartes((cur) => [
      ...cur,
      { periodo_id: "", data_inicio: "", data_fim: "", dias_abono: 0 },
    ]);
  }

  function removerParte(idx: number) {
    if (partes.length <= 2) return;
    setPartes((cur) => cur.filter((_, i) => i !== idx));
  }

  async function confirmar() {
    setEnviando(true);
    setErro(null);
    const r = await dividirLancamentoCombinado({
      lancamento_id: lanc.id,
      partes,
      motivo,
    });
    setEnviando(false);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    onFechar();
    window.location.reload();
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Dividir lançamento combinado</DialogTitle>
          <DialogDescription>
            O lançamento atual de {lanc.dias}d vai ser substituído por 2 a 4
            lançamentos separados, um por aquisitivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {partes.map((p, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border p-3 space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  Parte {idx + 1}
                </span>
                {partes.length > 2 && (
                  <button
                    type="button"
                    onClick={() => removerParte(idx)}
                    className="text-xs text-muted-foreground hover:text-california-red"
                  >
                    Remover
                  </button>
                )}
              </div>
              <Select
                value={p.periodo_id}
                onValueChange={(v) => atualizar(idx, { periodo_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Aquisitivo" />
                </SelectTrigger>
                <SelectContent>
                  {periodos.map((per) => (
                    <SelectItem key={per.id} value={per.id}>
                      {per.aquisitivo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Início</Label>
                  <Input
                    type="date"
                    value={p.data_inicio}
                    onChange={(e) =>
                      atualizar(idx, { data_inicio: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Fim</Label>
                  <Input
                    type="date"
                    value={p.data_fim}
                    onChange={(e) =>
                      atualizar(idx, { data_fim: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label className="text-xs">Abono</Label>
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    value={p.dias_abono}
                    onChange={(e) =>
                      atualizar(idx, {
                        dias_abono: Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
          {partes.length < 4 && (
            <button
              type="button"
              onClick={adicionarParte}
              className="w-full rounded-lg border border-dashed border-border py-2 text-sm text-muted-foreground hover:bg-muted/40"
            >
              + Adicionar parte
            </button>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="dividir-motivo">Motivo</Label>
            <Textarea
              id="dividir-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              placeholder="Férias cruzavam dois períodos aquisitivos"
            />
          </div>
        </div>
        {erro && <p className="text-sm text-california-red">{erro}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button
            onClick={confirmar}
            disabled={enviando || motivo.trim().length < 3}
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            Dividir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ======================================================================
// Helpers visuais
// ======================================================================

function iconeDoNivel(n: NivelPendenciaFerias) {
  if (n === "critica") return <AlertCircle className="h-4 w-4 mt-0.5" />;
  if (n === "alerta") return <AlertTriangle className="h-4 w-4 mt-0.5" />;
  return <Info className="h-4 w-4 mt-0.5" />;
}

function classDoNivel(n: NivelPendenciaFerias) {
  if (n === "critica")
    return "border-california-red/30 bg-california-red/5 text-california-red";
  if (n === "alerta") return "border-amber-300/60 bg-amber-50 text-amber-900";
  return "border-blue-300/60 bg-blue-50 text-blue-900";
}

function tipoLabel(tipo: string) {
  if (tipo === "usufruto") return "Usufruto";
  if (tipo === "abono_combinado") return "Férias + abono";
  if (tipo === "abono_avulso") return "Abono avulso";
  if (tipo === "abono_excepcional") return "Abono excepcional";
  return tipo;
}
