"use client";

import { useState } from "react";
import { HeartPulse, Smile, Users2, UserRound } from "lucide-react";
import type { LinhaColaboradorBeneficios } from "@/lib/queries/beneficios";
import type { BeneficioTipo } from "@/lib/types";
import { DrawerColaboradorBeneficios } from "./drawer-colaborador";

type BeneficioOpcao = {
  id: string;
  nome: string;
  tipo: BeneficioTipo;
  beneficio_base_id: string | null;
};

const formatarBrl = (n: number) =>
  n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });

const TIPO_LABEL: Record<string, string> = {
  pj: "PJ",
  mei: "MEI",
  clt_recibo: "CLT + Recibo",
  clt: "CLT",
  estagio: "Estagiário",
  socio: "Sócio",
};

export function TabelaColaboradores({
  linhas,
  ano,
  mes,
  beneficios,
}: {
  linhas: LinhaColaboradorBeneficios[];
  ano: number;
  mes: number;
  beneficios: BeneficioOpcao[];
}) {
  const [colaboradorAberto, setColaboradorAberto] = useState<string | null>(null);

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <Users2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
        <p className="mt-3 text-sm font-medium text-foreground">
          Nenhum colaborador encontrado
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ajuste os filtros ou cadastre vínculos de benefícios na aba Catálogo.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-soft">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Colaborador</th>
              <th className="px-4 py-3 text-left">Tipo</th>
              <th className="px-4 py-3 text-left">Planos ativos</th>
              <th className="px-4 py-3 text-center">Deps</th>
              <th className="px-4 py-3 text-right">Custo empresa</th>
              <th className="px-4 py-3 text-right">Desconto folha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((l) => (
              <tr
                key={l.colaborador_id}
                onClick={() => setColaboradorAberto(l.colaborador_id)}
                className="cursor-pointer transition-colors hover:bg-muted/30"
              >
                <td className="px-4 py-3 font-medium text-foreground">{l.nome}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {TIPO_LABEL[l.tipo_contratacao] ?? l.tipo_contratacao}
                </td>
                <td className="px-4 py-3">
                  {l.planos_ativos.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {l.planos_ativos.map((p) => (
                        <ChipPlano key={p.beneficio_id} nome={p.nome} tipo={p.tipo} />
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {l.qtde_dependentes > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-muted/40 px-2 py-0.5 text-xs font-medium tabular-nums text-foreground">
                      <UserRound className="h-3 w-3" />
                      {l.qtde_dependentes}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                  {Number(l.custo_empresa) > 0
                    ? formatarBrl(Number(l.custo_empresa))
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                  {Number(l.custo_colaborador) > 0
                    ? formatarBrl(Number(l.custo_colaborador))
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {colaboradorAberto && (
        <DrawerColaboradorBeneficios
          colaboradorId={colaboradorAberto}
          ano={ano}
          mes={mes}
          onClose={() => setColaboradorAberto(null)}
          beneficios={beneficios}
        />
      )}
    </>
  );
}

function ChipPlano({ nome, tipo }: { nome: string; tipo: "saude" | "dental" }) {
  const Icon = tipo === "saude" ? HeartPulse : Smile;
  const classes =
    tipo === "saude"
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : "bg-sky-50 text-sky-700 border-sky-200";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium ${classes}`}
    >
      <Icon className="h-3 w-3" />
      {nome}
    </span>
  );
}
