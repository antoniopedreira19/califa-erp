"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ExternalLink, Lock, Send } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DrawerContent,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { enviarJobParaFaturamento } from "./actions-faturamento";

const SEM_PORTAL = "__sem_portal__";

export interface PortalOption {
  id: string;
  nome: string;
  url: string;
}

interface Props {
  jobId: string;
  jobCodigo: string;
  /** Faturamento previsto atual — vai travado no formulário. */
  valorFaturado: number;
  /** Data prevista na abertura do job; o campo nasce com ela. */
  dataPrevistaFaturamento: string | null;
  portais: PortalOption[];
  moeda: string;
}

function hojeIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Enviar job para faturamento": o que a produção libera ao financeiro.
 *
 * O valor é read-only de propósito — vem do faturamento previsto do job e
 * é relido no servidor. Quem envia informa o que só a produção sabe: PO,
 * vencimento, CNAE e em qual portal do cliente a nota é lançada.
 */
export function EnviarFaturamentoDrawer({
  jobId,
  jobCodigo,
  valorFaturado,
  dataPrevistaFaturamento,
  portais,
  moeda,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [confirmar, setConfirmar] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [numeroPo, setNumeroPo] = React.useState("");
  const [dataFaturamento, setDataFaturamento] = React.useState(
    dataPrevistaFaturamento ?? hojeIso(),
  );
  const [cnae, setCnae] = React.useState("");
  const [portalId, setPortalId] = React.useState(SEM_PORTAL);

  const portalEscolhido = portais.find((p) => p.id === portalId) ?? null;
  const podeEnviar = cnae.trim().length > 0 && dataFaturamento.length === 10;

  function handleEnviar() {
    setErro(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await enviarJobParaFaturamento(jobId, {
        numero_po: numeroPo.trim() || null,
        data_faturamento: dataFaturamento,
        cnae: cnae.trim(),
        portal_id: portalId === SEM_PORTAL ? null : portalId,
      });
      if (!res.ok) {
        setErro(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        setConfirmar(false);
        return;
      }
      setConfirmar(false);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-california-red-hover"
      >
        <Send className="h-4 w-4" />
        Enviar job para faturamento
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <DialogHeader className="border-b border-border p-6">
            <DialogTitle>Enviar {jobCodigo} para faturamento</DialogTitle>
            <DialogDescription>
              O job entra na fila de faturamento do financeiro com estas
              informações. O valor vem do faturamento previsto e não é
              editável aqui.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <div className="space-y-2">
              <Label>Valor a ser faturado</Label>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3.5 py-2.5">
                <span className="font-mono text-base font-bold">
                  {formatCurrency(valorFaturado, moeda)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  <Lock className="h-2.5 w-2.5" />
                  Do faturamento previsto
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Já considera as erratas registradas até agora.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="numero-po">Número da PO</Label>
              <Input
                id="numero-po"
                value={numeroPo}
                onChange={(e) => setNumeroPo(e.target.value)}
                maxLength={60}
                placeholder="Opcional — nem todo cliente emite PO"
              />
              {fieldErrors.numero_po?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label>
                Data de faturamento (vencimento){" "}
                <span className="text-california-red">*</span>
              </Label>
              <DatePicker
                name="data_faturamento"
                defaultValue={dataFaturamento}
                onDateChange={(d) =>
                  setDataFaturamento(
                    d
                      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                      : "",
                  )
                }
              />
              <p className="text-xs text-muted-foreground">
                Nasce da data prevista na abertura do job. Ajuste se o
                acordo com o cliente for outro.
              </p>
              {fieldErrors.data_faturamento?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="cnae">
                CNAE a ser utilizado{" "}
                <span className="text-california-red">*</span>
              </Label>
              <Input
                id="cnae"
                value={cnae}
                onChange={(e) => setCnae(e.target.value)}
                maxLength={120}
                placeholder="Ex.: 7311-4/00 — Agências de publicidade"
              />
              {fieldErrors.cnae?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="portal">Portal de fornecedor do cliente</Label>
              {portais.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3.5 py-3 text-xs text-muted-foreground">
                  Este cliente não tem portal cadastrado. Cadastre em
                  Cadastros › Clientes se a nota precisar ser lançada em um.
                </p>
              ) : (
                <Select value={portalId} onValueChange={setPortalId}>
                  <SelectTrigger id="portal">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_PORTAL}>
                      Sem portal
                    </SelectItem>
                    {portais.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {portalEscolhido && (
                <a
                  href={portalEscolhido.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-california-red hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {portalEscolhido.url}
                </a>
              )}
            </div>

            {erro && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => setConfirmar(true)}
              disabled={!podeEnviar || pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-california-red-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              Enviar
            </button>
          </div>
        </DrawerContent>
      </Dialog>

      <ConfirmDialog
        open={confirmar}
        onOpenChange={(o) => !o && setConfirmar(false)}
        title={`Enviar ${jobCodigo} para faturamento?`}
        description={
          <>
            O job entra na fila de faturamento do financeiro no valor de{" "}
            <strong>{formatCurrency(valorFaturado, moeda)}</strong>, com
            vencimento em{" "}
            <strong>
              {dataFaturamento.split("-").reverse().join("/")}
            </strong>
            . Depois disso o job fica pronto para ser encerrado.
          </>
        }
        confirmLabel="Sim, enviar"
        pending={pending}
        onConfirm={handleEnviar}
      />
    </>
  );
}
