"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Props {
  contratoId: string;
  valorAtual: boolean | null;
  /** Permissão de escrita: RH/admin/fin OU responsável do contrato. */
  podeEditar: boolean;
  /** Tamanho do botão. Default `sm` serve pra tabela densa. */
  tamanho?: "sm" | "md";
}

/**
 * Pílula clicável que troca inline o status_real do contrato:
 *   Trabalhando ↔ Inativo
 *
 * Fluxo de encerramento abre passo 2 pra motivo opcional;
 * reabrir é imediato.
 */
export function StatusRealDropdown({
  contratoId,
  valorAtual,
  podeEditar,
  tamanho = "sm",
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [etapa, setEtapa] = React.useState<"menu" | "motivo">("menu");
  const [motivo, setMotivo] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setEtapa("menu");
      setMotivo("");
      setErro(null);
    }
  }, [open]);

  async function aplicar(novo: boolean, motivoTexto: string | null) {
    setPending(true);
    setErro(null);
    try {
      const res = await fetch(
        `/api/freelancers/contratos/${contratoId}/status-real`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status_real: novo,
            ...(motivoTexto ? { motivo: motivoTexto } : {}),
          }),
        },
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setErro(json.error || "Erro ao atualizar.");
        setPending(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setErro("Erro de rede. Tenta de novo.");
      setPending(false);
    }
  }

  function clicarMenu(e: React.MouseEvent, destino: boolean) {
    e.stopPropagation();
    // Reabrir é direto. Encerrar pede motivo opcional.
    if (destino === true) {
      void aplicar(true, null);
    } else {
      setEtapa("motivo");
    }
  }

  if (valorAtual === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  const ativo = valorAtual === true;

  const badgeClasses = cn(
    "inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors",
    tamanho === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
    ativo
      ? "bg-emerald-50 text-emerald-700"
      : "bg-zinc-100 text-zinc-600",
    podeEditar && "hover:opacity-80 cursor-pointer",
  );

  if (!podeEditar) {
    return (
      <span className={badgeClasses}>
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            ativo ? "bg-emerald-500" : "bg-zinc-400",
          )}
        />
        {ativo ? "Trabalhando" : "Inativo"}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={badgeClasses}
          aria-label="Trocar status do contrato"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              ativo ? "bg-emerald-500" : "bg-zinc-400",
            )}
          />
          {ativo ? "Trabalhando" : "Inativo"}
          <ChevronDown className="h-3 w-3 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("p-1", etapa === "motivo" ? "w-72" : "w-48")}
        align="center"
        side="bottom"
        avoidCollisions={false}
        onClick={(e) => e.stopPropagation()}
      >
        {etapa === "menu" && (
          <div className="flex flex-col gap-0.5">
            <OpcaoLinha
              label="Trabalhando"
              cor="emerald"
              selecionado={ativo}
              pending={pending && ativo}
              disabled={pending}
              onClick={(e) => clicarMenu(e, true)}
            />
            <OpcaoLinha
              label="Inativo"
              cor="zinc"
              selecionado={!ativo}
              pending={false}
              disabled={pending}
              onClick={(e) => clicarMenu(e, false)}
            />
          </div>
        )}
        {etapa === "motivo" && (
          <div className="p-2 space-y-2">
            <p className="text-xs font-semibold text-foreground">
              Marcar como inativo?
            </p>
            <p className="text-[11px] text-muted-foreground leading-snug">
              Esse contrato sai dos ativos e deixa de contar na Saúde geral.
              Reversível pelo mesmo botão.
            </p>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Motivo (opcional)
              </label>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Ex.: diária já terminada, cadastro duplicado, etc."
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-california-red"
              />
            </div>
            {erro && (
              <p className="text-[11px] text-red-600 font-medium">{erro}</p>
            )}
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEtapa("menu");
                }}
                disabled={pending}
                className="rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void aplicar(false, motivo.trim() || null);
                }}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded bg-california-red px-2.5 py-1 text-xs font-semibold text-white hover:bg-california-red-hover transition-colors disabled:opacity-60"
              >
                {pending && <Loader2 className="h-3 w-3 animate-spin" />}
                Confirmar
              </button>
            </div>
          </div>
        )}
        {erro && etapa === "menu" && (
          <p className="px-2 py-1 text-[11px] text-red-600 font-medium">
            {erro}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function OpcaoLinha({
  label,
  cor,
  selecionado,
  pending,
  disabled,
  onClick,
}: {
  label: string;
  cor: "emerald" | "zinc";
  selecionado: boolean;
  pending: boolean;
  disabled: boolean;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs font-medium text-left transition-colors",
        selecionado
          ? "bg-california-red/10 text-california-red"
          : "text-foreground hover:bg-muted",
        disabled && "opacity-60 cursor-not-allowed",
      )}
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            cor === "emerald" ? "bg-emerald-500" : "bg-zinc-400",
          )}
        />
        {label}
      </span>
      {pending && (
        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
      )}
    </button>
  );
}
