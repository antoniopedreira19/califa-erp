import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  icon: LucideIcon;
  titulo: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * Card de agrupamento de dados no perfil do freelancer. Só é usado se
 * tem pelo menos um campo preenchido — chamador decide via conditional
 * render, não aqui dentro, pra evitar `children` falsy render invisível.
 */
export function BlocoInfo({ icon: Icon, titulo, children, className }: Props) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-white p-5 shadow-soft",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          {titulo}
        </h3>
      </div>
      <dl className="space-y-3">{children}</dl>
    </div>
  );
}

export function Linha({
  rotulo,
  valor,
}: {
  rotulo: string;
  valor: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground min-w-[90px] shrink-0">
        {rotulo}
      </dt>
      <dd className="text-sm text-foreground flex-1 min-w-0 break-words">
        {valor}
      </dd>
    </div>
  );
}
