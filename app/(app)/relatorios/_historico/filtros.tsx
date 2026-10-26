import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * As peças comuns aos relatórios do histórico da planilha (decisão 211, A4):
 * os filtros por link (empresa, ano, período), o aviso de estado vazio e o
 * valor em reais sem o símbolo, com "—" no zero.
 */
export function Filtros({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-border bg-card p-4 shadow-soft">{children}</div>
  );
}

export function Filtro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase text-muted-foreground">{rotulo}</span>
      {children}
    </div>
  );
}

export function Opcao({ href, ativa, children }: { href: string; ativa: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={ativa ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1.5 text-sm transition-colors",
        ativa
          ? "border-california-red bg-california-red text-white"
          : "border-border text-foreground hover:border-california-red/40 hover:text-california-red",
      )}
    >
      {children}
    </Link>
  );
}

export function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">{children}</div>
  );
}

export function Valor({ valor }: { valor: number }) {
  if (valor === 0) return <span className="text-muted-foreground">—</span>;
  return <>{valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
}

/** Os anos de `de` a `ate`. */
export function anosEntre(de: string, ate: string): number[] {
  const anos: number[] = [];
  for (let a = Number(de.slice(0, 4)); a <= Number(ate.slice(0, 4)); a++) anos.push(a);
  return anos;
}

/** O último dia de um trimestre ("2025-06-30"). */
export function fimDoTrimestre(ano: number, trimestre: number): string {
  return `${ano}-${["03-31", "06-30", "09-30", "12-31"][trimestre - 1]}`;
}
