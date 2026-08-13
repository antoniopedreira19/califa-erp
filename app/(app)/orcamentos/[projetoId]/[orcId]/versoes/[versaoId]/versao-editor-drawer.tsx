"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock, Pencil, Save } from "lucide-react";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ALIQUOTAS_IMPOSTO,
  aliquotaParaValor,
  formatarAliquota,
  valorInicialAliquota,
} from "@/lib/impostos";
import {
  VERSAO_STATUS_EDITAVEIS,
  versaoStatusLabel,
  type VersaoOrcamento,
  type VersaoOrcamentoStatus,
} from "@/lib/types";
import { atualizarVersao, type ActionResult } from "../actions";

interface Props {
  versao: VersaoOrcamento;
  /** Só `administrador` altera os honorários da versão — o padrão vem do
   *  cadastro do cliente. Para os demais o campo fica travado, e a server
   *  action recusa mesmo que alguém contorne a tela. */
  podeEditarHonorarios: boolean;
  /** Cliente do projeto, para explicar de onde vem o percentual. */
  clienteNome?: string | null;
  disabled?: boolean;
  disabledReason?: string;
}

export function VersaoEditorDrawer({
  versao,
  podeEditarHonorarios,
  clienteNome,
  disabled,
  disabledReason,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>(
    {},
  );
  const [status, setStatus] = React.useState<VersaoOrcamentoStatus>(
    VERSAO_STATUS_EDITAVEIS.includes(versao.status) ? versao.status : "rascunho",
  );
  // Versão legada (0, 19,54, 20) abre vazia: a lista não tem esse valor e
  // salvar exige escolher uma das alíquotas atuais.
  const [imposto, setImposto] = React.useState(() =>
    valorInicialAliquota(Number(versao.percentual_imposto)),
  );

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    const formData = new FormData(e.currentTarget);
    formData.set("status", status);
    // Em branco preserva a alíquota atual, igual aos demais campos do drawer.
    // Escolher só vira obrigatório na aprovação.
    if (imposto !== "") formData.set("percentual_imposto", imposto);

    startTransition(async () => {
      const res: ActionResult = await atualizarVersao(versao.id, formData);
      if (!res.ok) {
        setError(res.message);
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={disabled ? disabledReason : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
      </DialogTrigger>
      <DrawerContent>
        <DialogHeader className="border-b border-border p-6">
          <DialogTitle>Editar dados da versão</DialogTitle>
          <DialogDescription>
            Número da versão não pode ser alterado. Alterações são
            registradas em auditoria.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit}
          className="flex-1 flex flex-col overflow-hidden"
        >
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Moeda" name="moeda" errors={fieldErrors}>
                <Input
                  name="moeda"
                  defaultValue={versao.moeda}
                  maxLength={3}
                  className="uppercase"
                />
              </Field>
              <Field label="Taxa de câmbio" name="taxa_cambio" errors={fieldErrors}>
                <Input
                  name="taxa_cambio"
                  type="number"
                  step="0.0001"
                  min="0.0001"
                  placeholder={`atual: ${formatNumberHint(versao.taxa_cambio)}`}
                  className="no-spinner"
                />
              </Field>
              <Field
                label="Honorários (%)"
                name="percentual_honorarios"
                errors={fieldErrors}
                travado={!podeEditarHonorarios}
                hint={
                  podeEditarHonorarios
                    ? `Padrão de ${clienteNome ?? "cliente"}: alterar aqui vale só para esta versão.`
                    : `Vem do cadastro de ${clienteNome ?? "cliente"}. Só administrador altera.`
                }
              >
                {podeEditarHonorarios ? (
                  <Input
                    name="percentual_honorarios"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    placeholder={`atual: ${formatNumberHint(versao.percentual_honorarios)}%`}
                    className="no-spinner"
                  />
                ) : (
                  /* Sem `name`: o campo não é enviado. */
                  <Input
                    type="number"
                    value={versao.percentual_honorarios}
                    readOnly
                    disabled
                    className="no-spinner bg-muted/50 text-muted-foreground"
                  />
                )}
              </Field>
              <Field
                label="Impostos (%)"
                name="percentual_imposto"
                errors={fieldErrors}
              >
                <Select value={imposto} onValueChange={setImposto}>
                  <SelectTrigger id="percentual_imposto">
                    <SelectValue placeholder="Selecione a alíquota" />
                  </SelectTrigger>
                  <SelectContent>
                    {ALIQUOTAS_IMPOSTO.map((a) => (
                      <SelectItem key={a} value={aliquotaParaValor(a)}>
                        {formatarAliquota(a)}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Status" name="status" errors={fieldErrors}>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as VersaoOrcamentoStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VERSAO_STATUS_EDITAVEIS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {versaoStatusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex items-center rounded-lg border border-border bg-white px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-accent transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-california-red px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover hover:shadow-brand transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {pending ? (
                <>
                  <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Salvar alterações
                </>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}

function Field({
  label,
  name,
  errors,
  travado,
  hint,
  children,
}: {
  label: string;
  name: string;
  errors: Record<string, string[]>;
  /** Cadeado no rótulo: campo que este usuário não pode alterar. */
  travado?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  const fieldErrors = errors[name];
  return (
    <div className="space-y-2">
      <Label htmlFor={name} className="flex items-center gap-1.5">
        {label}
        {travado && <Lock className="h-3 w-3 text-muted-foreground" />}
      </Label>
      {children}
      {hint && (
        <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>
      )}
      {fieldErrors?.map((msg, i) => (
        <p key={i} className="text-xs text-california-red">
          {msg}
        </p>
      ))}
    </div>
  );
}

/** Formata número pt-BR aparando zeros. Usado nos placeholders "atual: X". */
function formatNumberHint(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return "—";
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}
