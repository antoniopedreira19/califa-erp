import Link from "next/link";

export type AbaColaborador = "vinculos" | "dependentes" | "breakdown";

const TABS: { key: AbaColaborador; label: string }[] = [
  { key: "vinculos", label: "Vínculos" },
  { key: "dependentes", label: "Dependentes" },
  { key: "breakdown", label: "Cálculo do mês" },
];

export function TabsNav({
  tabAtual,
  colaboradorId,
  baseParams,
}: {
  tabAtual: AbaColaborador;
  colaboradorId: string;
  baseParams: string;
}) {
  return (
    <div className="border-b border-border">
      <nav className="flex gap-6">
        {TABS.map((t) => {
          const ativo = t.key === tabAtual;
          const params = new URLSearchParams(baseParams);
          params.set("tab", t.key);
          return (
            <Link
              key={t.key}
              href={`/rh/beneficios/colaborador/${colaboradorId}?${params.toString()}`}
              prefetch={false}
              className={`px-1 pb-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                ativo
                  ? "border-california-red text-california-red"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
