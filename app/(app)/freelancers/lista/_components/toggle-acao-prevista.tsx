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
import type { AcaoPrevistaFreelancer } from "@/lib/types";
import { atualizarAcaoPrevista } from "../../actions";
import { AcaoPrevistaBadge } from "./acao-prevista-badge";

const OPCOES: Array<{ value: AcaoPrevistaFreelancer | null; label: string }> = [
  { value: null, label: "Sem decisão" },
  { value: "contratar", label: "Contratar" },
  { value: "renovar", label: "Renovar" },
  { value: "manter", label: "Manter" },
  { value: "substituir", label: "Substituir" },
  { value: "encerrar", label: "Encerrar" },
];

interface Props {
  freelancerId: string;
  valorAtual: AcaoPrevistaFreelancer | null;
}

export function ToggleAcaoPrevista({ freelancerId, valorAtual }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  function escolher(e: React.MouseEvent, acao: AcaoPrevistaFreelancer | null) {
    e.stopPropagation();
    startTransition(async () => {
      await atualizarAcaoPrevista(freelancerId, acao);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
          aria-label="Trocar ação prevista"
        >
          <AcaoPrevistaBadge acao={valorAtual} />
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-48 p-1"
        align="center"
        side="bottom"
        avoidCollisions={false}
        onClick={(e) => e.stopPropagation()}
      >
        {OPCOES.map((o) => {
          const ativo = o.value === valorAtual;
          return (
            <button
              key={o.value ?? "sem_decisao"}
              type="button"
              onClick={(e) => escolher(e, o.value)}
              disabled={pending}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-xs font-medium text-left transition-colors",
                ativo
                  ? "bg-california-red/10 text-california-red"
                  : "text-foreground hover:bg-muted",
              )}
            >
              <span>{o.label}</span>
              {pending && ativo && (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              )}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
