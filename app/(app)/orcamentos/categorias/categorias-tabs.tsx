"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { Categoria, CategoriaDominio } from "@/lib/types";
import { CategoriasList } from "./itens/categorias-list";
import { CategoriasDominioList } from "./orcamento/categorias-dominio-list";

type Tab = "itens" | "orcamento";

export function CategoriasTabs({
  categoriasItem,
  categoriasOrcamento,
  isAdmin,
}: {
  categoriasItem: Categoria[];
  categoriasOrcamento: CategoriaDominio[];
  isAdmin: boolean;
}) {
  const [tab, setTab] = React.useState<Tab>("itens");

  return (
    <div className="space-y-6">
      <div
        role="tablist"
        aria-label="Tipos de categoria"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
      >
        <TabButton
          active={tab === "itens"}
          onClick={() => setTab("itens")}
          count={categoriasItem.filter((c) => c.ativo).length}
        >
          Categorias de Item
        </TabButton>
        <TabButton
          active={tab === "orcamento"}
          onClick={() => setTab("orcamento")}
          count={categoriasOrcamento.filter((c) => c.ativo).length}
        >
          Categorias do Orçamento/Projeto
        </TabButton>
      </div>

      {tab === "itens" ? (
        <CategoriasList categorias={categoriasItem} isAdmin={isAdmin} />
      ) : (
        <CategoriasDominioList
          categorias={categoriasOrcamento}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <span>{children}</span>
      <span
        className={cn(
          "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
          active
            ? "bg-california-red/10 text-california-red"
            : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}
