import Link from "next/link";
import { CheckCircle2, Undo2 } from "lucide-react";
import type { FechamentoRow } from "@/lib/types";

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${min}`;
}

export function TabFechamentos(props: {
  ano: number;
  fechamentos: FechamentoRow[];
  anosDisponiveis: number[];
}) {
  const anoAtual = new Date().getFullYear();
  const anosOpcoes = Array.from(
    new Set([anoAtual, ...props.anosDisponiveis, props.ano]),
  ).sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <label htmlFor="ano-fechamento" className="text-sm text-muted-foreground">
            Ano:
          </label>
          <SeletorAno ano={props.ano} opcoes={anosOpcoes} />
        </div>
      </div>

      {props.fechamentos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma competência fechada em {props.ano}. Fechamentos são criados
            pela página da folha mensal, no botão &quot;Aplicar descontos&quot;.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Competência</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Fechado em</th>
                <th className="px-4 py-3 font-medium">Por</th>
                <th className="px-4 py-3 font-medium text-right">Empresa</th>
                <th className="px-4 py-3 font-medium text-right">Colaborador</th>
                <th className="px-4 py-3 font-medium text-right">Vínculos</th>
              </tr>
            </thead>
            <tbody>
              {props.fechamentos.map((f) => (
                <tr
                  key={f.id}
                  className="border-t border-border transition-colors hover:bg-muted/30"
                >
                  <td className="p-0">
                    <Link
                      href={`/rh/beneficios/fechamentos/${f.id}`}
                      prefetch={false}
                      className="block px-4 py-3"
                    >
                      {NOMES_MES[f.mes - 1]}/{f.ano}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {f.reaberto_em === null ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Aplicado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <Undo2 className="h-3.5 w-3.5" />
                        Reaberto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatarDataHora(f.fechado_em)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {f.fechado_por_nome ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {brl.format(f.total_empresa)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {brl.format(f.total_colaborador)}
                  </td>
                  <td className="px-4 py-3 text-right">{f.qtd_vinculos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SeletorAno(props: { ano: number; opcoes: number[] }) {
  // Server-side select: muda via Link preservando a tab
  return (
    <div className="flex gap-1">
      {props.opcoes.map((a) => {
        const params = new URLSearchParams();
        params.set("tab", "fechamentos");
        params.set("anoFechamento", String(a));
        return (
          <Link
            key={a}
            href={`/rh/beneficios?${params.toString()}`}
            prefetch={false}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              a === props.ano
                ? "bg-california-red text-white"
                : "bg-background border border-border text-muted-foreground hover:bg-muted"
            }`}
          >
            {a}
          </Link>
        );
      })}
    </div>
  );
}
