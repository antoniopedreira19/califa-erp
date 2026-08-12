"use client";

import * as React from "react";
import { format } from "date-fns";
import { CreditCard, AlertCircle } from "lucide-react";
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

type Conta = {
  id: string;
  nome: string;
  banco: string;
  empresa_id: string;
  ativo: boolean;
};

type Tipo = { id: string; codigo: string; nome: string; ativo: boolean };
type Subtipo = { id: string; tipo_id: string; nome: string; ativo: boolean };

export function BaixaPPDialog({
  open,
  onOpenChange,
  ppCodigo,
  descricao,
  valor,
  empresaId,
  dataPrevista,
  contas,
  tipos,
  subtipos,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ppCodigo: string;
  descricao: string;
  valor: number;
  empresaId: string;
  dataPrevista: string | null;
  contas: Conta[];
  tipos: Tipo[];
  subtipos: Subtipo[];
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
  }, [open]);

  React.useEffect(() => {
    setSubtipoId("");
  }, [tipoId]);

  const contasDaEmpresa = contas.filter(
    (c) => c.empresa_id === empresaId && c.ativo,
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
            Dar baixa — PP {ppCodigo}
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
          <span className="font-medium">{descricao}</span>
          <span className="text-muted-foreground">Valor</span>
          <span className="font-mono font-semibold">
            {formatCurrency(valor, "BRL")}
          </span>
          {dataPrevista && (
            <>
              <span className="text-muted-foreground">Previsto para</span>
              <span>{formatarData(dataPrevista)}</span>
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

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}
