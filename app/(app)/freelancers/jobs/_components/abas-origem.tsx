"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  countProducao: number;
  countInterno: number;
}

/**
 * Pills que alternam entre `aba=producao` e `aba=interno` na querystring.
 * Mantém qualquer outro filtro (empresa, meus, filtro) na URL.
 */
export function AbasOrigem({ countProducao, countInterno }: Props) {
  const sp = useSearchParams();
  const aba = sp.get("aba") === "interno" ? "interno" : "producao";

  function hrefComAba(novaAba: "producao" | "interno") {
    const p = new URLSearchParams(sp.toString());
    p.set("aba", novaAba);
    return `?${p.toString()}`;
  }

  return (
    <nav
      className="inline-flex items-center gap-1 rounded-full bg-muted p-1"
      role="tablist"
      aria-label="Origem dos jobs"
    >
      <Pill
        href={hrefComAba("producao")}
        label="Produção"
        count={countProducao}
        ativo={aba === "producao"}
      />
      <Pill
        href={hrefComAba("interno")}
        label="Interno"
        count={countInterno}
        ativo={aba === "interno"}
      />
    </nav>
  );
}

function Pill({
  href,
  label,
  count,
  ativo,
}: {
  href: string;
  label: string;
  count: number;
  ativo: boolean;
}) {
  return (
    <Link
      href={href}
      role="tab"
      aria-selected={ativo}
      prefetch={false}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
        ativo
          ? "bg-white text-foreground shadow-soft"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "tabular-nums rounded-full px-2 py-0.5 text-[11px] font-semibold",
          ativo
            ? "bg-california-red/10 text-california-red"
            : "bg-background text-muted-foreground",
        )}
      >
        {count}
      </span>
    </Link>
  );
}
