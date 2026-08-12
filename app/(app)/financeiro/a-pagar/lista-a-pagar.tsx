"use client";

import * as React from "react";
import { format } from "date-fns";
import { CreditCard, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { marcarPagaFinanceiro, darBaixaAvulsa } from "./actions";

export type ItemAPagar = {
  origem_tipo: "pp" | "avulsa" | "recorrente";
  origem_id: string;
  empresa_id: string;
  data_prevista: string | null;
  valor: number;
  natureza: "entrada" | "saida";
  descricao: string;
  fornecedor_id: string | null;
  cliente_id: string | null;
  job_id: string | null;
  aprovada_em: string | null;
};

type Conta = {
  id: string;
  nome: string;
  banco: string;
  empresa_id: string;
  ativo: boolean;
};

type Tipo = { id: string; codigo: string; nome: string; ativo: boolean };
type Subtipo = { id: string; tipo_id: string; nome: string; ativo: boolean };

const CHIP: Record<ItemAPagar["origem_tipo"], string> = {
  pp: "PP",
  avulsa: "Avulsa",
  recorrente: "Recorrente",
};

function formatarData(iso: string): string {
  // iso: YYYY-MM-DD
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ---------------------------------------------------------------------------
// BaixaPPDialog — dialog para PP aprovadas (solicita data + conta + tipo + subtipo)
// ---------------------------------------------------------------------------

function BaixaPPDialog({
  item,
  contas,
  tipos,
  subtipos,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  item: ItemAPagar;
  contas: Conta[];
  tipos: Tipo[];
  subtipos: Subtipo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: {
    pago_em: string;
    conta_bancaria_id: string;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
  }) => void;
  pending: boolean;
}) {
  const [erro, setErro] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [contaId, setContaId] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setPagoEm(format(new Date(), "yyyy-MM-dd"));
    setContaId("");
    setTipoId("");
    setSubtipoId("");
  }, [open, item]);

  React.useEffect(() => {
    setSubtipoId("");
  }, [tipoId]);

  const contasDaEmpresa = contas.filter(
    (c) => c.empresa_id === item.empresa_id && c.ativo,
  );
  const tiposAtivos = tipos.filter((t) => t.ativo);
  const subtiposDoTipo = tipoId
    ? subtipos.filter((s) => s.tipo_id === tipoId && s.ativo)
    : [];

  function handleSubmit() {
    setErro(null);
    if (!contaId || !tipoId || !subtipoId || !pagoEm) {
      setErro("Preencha todos os campos obrigatórios.");
      return;
    }
    onConfirm({
      pago_em: pagoEm,
      conta_bancaria_id: contaId,
      plano_conta_tipo_id: tipoId,
      plano_conta_subtipo_id: subtipoId,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Dar baixa — PP
          </DialogTitle>
        </DialogHeader>

        {erro && (
          <div className="flex items-start gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">Descrição</span>
          <span className="font-medium">{item.descricao}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">
            {formatCurrency(item.valor, "BRL")}
          </span>
          {item.data_prevista && (
            <>
              <span className="text-muted-foreground">Previsto para</span>
              <span>{formatarData(item.data_prevista)}</span>
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Data do pagamento *</label>
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => setPagoEm(d ? format(d, "yyyy-MM-dd") : "")}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Conta bancária *</label>
            <Select value={contaId} onValueChange={setContaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contasDaEmpresa.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta ativa dessa empresa. Cadastre em /cadastros/contas-bancarias.
                  </div>
                ) : (
                  contasDaEmpresa.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} · {c.banco}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Tipo *</label>
              <Select value={tipoId} onValueChange={setTipoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {tiposAtivos.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum tipo cadastrado.
                    </div>
                  ) : (
                    tiposAtivos.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.codigo} · {t.nome}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Subtipo *</label>
              <Select
                value={subtipoId}
                onValueChange={setSubtipoId}
                disabled={!tipoId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={tipoId ? "Selecione..." : "Escolha o tipo primeiro"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {subtiposDoTipo.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      Nenhum subtipo cadastrado.
                    </div>
                  ) : (
                    subtiposDoTipo.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nome}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {pending ? "Confirmando..." : "Confirmar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// BaixaAvulsaDialog — dialog para avulsas/recorrentes (só data + conta)
// ---------------------------------------------------------------------------

function BaixaAvulsaDialog({
  item,
  contas,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  item: ItemAPagar;
  contas: Conta[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: { pago_em: string; conta_bancaria_id: string }) => void;
  pending: boolean;
}) {
  const [erro, setErro] = React.useState<string | null>(null);
  const [pagoEm, setPagoEm] = React.useState(format(new Date(), "yyyy-MM-dd"));
  const [contaId, setContaId] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setErro(null);
    setPagoEm(format(new Date(), "yyyy-MM-dd"));
    setContaId("");
  }, [open, item]);

  const contasDaEmpresa = contas.filter(
    (c) => c.empresa_id === item.empresa_id && c.ativo,
  );

  function handleSubmit() {
    setErro(null);
    if (!contaId || !pagoEm) {
      setErro("Preencha todos os campos obrigatórios.");
      return;
    }
    onConfirm({ pago_em: pagoEm, conta_bancaria_id: contaId });
  }

  const tipoLabel = item.origem_tipo === "recorrente" ? "Recorrente" : "Avulsa";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-emerald-600" />
            Dar baixa — {tipoLabel}
          </DialogTitle>
        </DialogHeader>

        {erro && (
          <div className="flex items-start gap-2 rounded border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <div className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">Descrição</span>
          <span className="font-medium">{item.descricao}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">
            {formatCurrency(item.valor, "BRL")}
          </span>
          {item.data_prevista && (
            <>
              <span className="text-muted-foreground">Previsto para</span>
              <span>{formatarData(item.data_prevista)}</span>
            </>
          )}
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Data do pagamento *</label>
            <DatePicker
              name="pago_em"
              defaultValue={pagoEm}
              onDateChange={(d) => setPagoEm(d ? format(d, "yyyy-MM-dd") : "")}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Conta bancária *</label>
            <Select value={contaId} onValueChange={setContaId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a conta..." />
              </SelectTrigger>
              <SelectContent>
                {contasDaEmpresa.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma conta ativa dessa empresa. Cadastre em /cadastros/contas-bancarias.
                  </div>
                ) : (
                  contasDaEmpresa.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome} · {c.banco}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <CreditCard className="h-4 w-4" />
            {pending ? "Confirmando..." : "Confirmar baixa"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ListaAPagar — componente principal
// ---------------------------------------------------------------------------

export function ListaAPagar({
  itens,
  contas,
  tipos,
  subtipos,
}: {
  itens: ItemAPagar[];
  contas: Conta[];
  tipos: Tipo[];
  subtipos: Subtipo[];
}) {
  const [selecionado, setSelecionado] = React.useState<ItemAPagar | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [toastMsg, setToastMsg] = React.useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  React.useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), 4000);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const hoje = new Date().toISOString().slice(0, 10);

  function handleClose() {
    setSelecionado(null);
  }

  function handleConfirmPP(payload: {
    pago_em: string;
    conta_bancaria_id: string;
    plano_conta_tipo_id: string;
    plano_conta_subtipo_id: string;
  }) {
    if (!selecionado) return;
    startTransition(async () => {
      const res = await marcarPagaFinanceiro({
        pp_id: selecionado.origem_id,
        pago_em: payload.pago_em,
        conta_bancaria_id: payload.conta_bancaria_id,
        plano_conta_tipo_id: payload.plano_conta_tipo_id,
        plano_conta_subtipo_id: payload.plano_conta_subtipo_id,
      });
      if (!res.ok) {
        setToastMsg({ tipo: "erro", texto: res.message });
      } else {
        setToastMsg({ tipo: "ok", texto: "Baixa registrada com sucesso." });
        setSelecionado(null);
      }
    });
  }

  function handleConfirmAvulsa(payload: {
    pago_em: string;
    conta_bancaria_id: string;
  }) {
    if (!selecionado) return;
    startTransition(async () => {
      const res = await darBaixaAvulsa({
        avulsa_id: selecionado.origem_id,
        pago_em: payload.pago_em,
        conta_bancaria_id: payload.conta_bancaria_id,
      });
      if (!res.ok) {
        setToastMsg({ tipo: "erro", texto: res.message });
      } else {
        setToastMsg({ tipo: "ok", texto: "Baixa registrada com sucesso." });
        setSelecionado(null);
      }
    });
  }

  return (
    <>
      {toastMsg && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg ${
            toastMsg.tipo === "ok"
              ? "bg-emerald-600 text-white"
              : "bg-california-red text-white"
          }`}
        >
          {toastMsg.texto}
        </div>
      )}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Origem</th>
              <th className="p-3 text-left">Descrição</th>
              <th className="p-3 text-left">Vencimento</th>
              <th className="p-3 text-right">Valor</th>
              <th className="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  Nada aprovado aguardando pagamento no momento.
                </td>
              </tr>
            )}
            {itens.map((item) => {
              const vencido = item.data_prevista && item.data_prevista < hoje;
              return (
                <tr
                  key={`${item.origem_tipo}:${item.origem_id}`}
                  className="border-t border-border hover:bg-muted/40 transition-colors"
                >
                  <td className="p-3">
                    <Badge variant="neutral">{CHIP[item.origem_tipo]}</Badge>
                  </td>
                  <td className="p-3 max-w-xs truncate" title={item.descricao}>
                    {item.descricao}
                  </td>
                  <td className={`p-3 ${vencido ? "text-california-red font-medium" : ""}`}>
                    {item.data_prevista ? formatarData(item.data_prevista) : "—"}
                  </td>
                  <td className="p-3 text-right font-medium font-mono">
                    {formatCurrency(item.valor, "BRL")}
                  </td>
                  <td className="p-3 text-right">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() => setSelecionado(item)}
                    >
                      Dar baixa
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selecionado && selecionado.origem_tipo === "pp" && (
        <BaixaPPDialog
          item={selecionado}
          contas={contas}
          tipos={tipos}
          subtipos={subtipos}
          open={true}
          onOpenChange={(open) => { if (!open) handleClose(); }}
          onConfirm={handleConfirmPP}
          pending={pending}
        />
      )}

      {selecionado && selecionado.origem_tipo !== "pp" && (
        <BaixaAvulsaDialog
          item={selecionado}
          contas={contas}
          open={true}
          onOpenChange={(open) => { if (!open) handleClose(); }}
          onConfirm={handleConfirmAvulsa}
          pending={pending}
        />
      )}
    </>
  );
}
