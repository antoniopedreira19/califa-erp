"use client";

import * as React from "react";
import { Search, UserX } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  rescisaoStatusLabel,
  tipoContratacaoLabel,
  type RescisaoStatus,
  type TipoContratacao,
} from "@/lib/types";
import { DrawerRescisao } from "./drawer-rescisao";

export type RescisaoLinha = {
  id: string;
  status: RescisaoStatus;
  data_rescisao: string;
  salario_vigente: number | null;
  saldo_salario_dias: number | null;
  saldo_salario_valor: number | null;
  avos_ferias: number | null;
  valor_ferias: number | null;
  valor_um_terco_ferias: number | null;
  avos_decimo: number | null;
  valor_decimo_terceiro: number | null;
  ajuste_valor: number;
  ajuste_motivo: string | null;
  total_bruto: number | null;
  total_liquido: number | null;
  conta_avulsa_id: string | null;
  enviada_em: string | null;
  paga_em: string | null;
  colaborador: {
    id: string;
    nome: string;
    cpf: string | null;
    tipo_contratacao: TipoContratacao;
    data_admissao: string;
  };
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

type TabKey =
  | "pendentes"
  | "enviadas"
  | "pagas"
  | "canceladas"
  | "todas";

const TABS: Array<{ key: TabKey; label: string; match: RescisaoStatus[] | "all" }> = [
  { key: "pendentes", label: "Pendentes", match: ["rascunho"] },
  { key: "enviadas", label: "Enviadas", match: ["enviada_financeiro"] },
  { key: "pagas", label: "Pagas", match: ["paga"] },
  { key: "canceladas", label: "Canceladas", match: ["cancelada"] },
  { key: "todas", label: "Todas", match: "all" },
];

export function RescisoesView({ linhas }: { linhas: RescisaoLinha[] }) {
  const [tab, setTab] = React.useState<TabKey>("pendentes");
  const [busca, setBusca] = React.useState("");
  const [linhaAberta, setLinhaAberta] = React.useState<RescisaoLinha | null>(
    null,
  );

  const contagem = React.useMemo(() => {
    const c: Record<TabKey, number> = {
      pendentes: 0,
      enviadas: 0,
      pagas: 0,
      canceladas: 0,
      todas: linhas.length,
    };
    for (const l of linhas) {
      if (l.status === "rascunho") c.pendentes += 1;
      else if (l.status === "enviada_financeiro") c.enviadas += 1;
      else if (l.status === "paga") c.pagas += 1;
      else if (l.status === "cancelada") c.canceladas += 1;
    }
    return c;
  }, [linhas]);

  const filtradas = React.useMemo(() => {
    const t = TABS.find((x) => x.key === tab)!;
    const q = busca.trim().toLowerCase();
    return linhas
      .filter((l) => (t.match === "all" ? true : t.match.includes(l.status)))
      .filter((l) =>
        !q
          ? true
          : l.colaborador.nome.toLowerCase().includes(q) ||
            (l.colaborador.cpf ?? "").includes(q),
      );
  }, [linhas, tab, busca]);

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Filtrar por status"
        className="flex items-center gap-1 border-b border-border overflow-x-auto"
      >
        {TABS.map((t) => (
          <TabButton
            key={t.key}
            active={tab === t.key}
            onClick={() => setTab(t.key)}
            count={contagem[t.key]}
            tomBadge={
              t.key === "pendentes" && contagem[t.key] > 0
                ? "vermelho"
                : t.key === "pagas" && contagem[t.key] > 0
                  ? "verde"
                  : undefined
            }
          >
            {t.label}
          </TabButton>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou CPF..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          Mostrando {filtradas.length} de {contagem[tab]}
        </span>
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <UserX className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nenhuma rescisão nesta aba.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <table className="w-full text-sm">
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[16%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[16%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left">Colaborador</th>
                <th className="px-5 py-3 text-left">Desligamento</th>
                <th className="px-5 py-3 text-left">Tipo</th>
                <th className="px-5 py-3 text-center">Avos 13º</th>
                <th className="px-5 py-3 text-right">Total líquido</th>
                <th className="px-5 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtradas.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => setLinhaAberta(l)}
                  className="cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <td className="px-5 py-3">
                    <p className="font-medium uppercase truncate">
                      {l.colaborador.nome}
                    </p>
                    {l.colaborador.cpf && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatarCpf(l.colaborador.cpf)}
                      </p>
                    )}
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {formatarData(l.data_rescisao)}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {tipoContratacaoLabel(l.colaborador.tipo_contratacao)}
                  </td>
                  <td className="px-5 py-3 text-center tabular-nums text-muted-foreground">
                    {l.avos_decimo ?? "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {l.total_liquido != null
                      ? brl.format(l.total_liquido)
                      : "—"}
                  </td>
                  <td className="px-5 py-3">
                    <BadgeStatus status={l.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DrawerRescisao
        linha={linhaAberta}
        onOpenChange={(open) => {
          if (!open) setLinhaAberta(null);
        }}
      />
    </div>
  );
}

function TabButton({
  active,
  count,
  tomBadge,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  tomBadge?: "vermelho" | "verde";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const badgeCor =
    tomBadge === "vermelho"
      ? "bg-california-red text-white"
      : tomBadge === "verde"
        ? "bg-emerald-600 text-white"
        : "bg-muted text-muted-foreground";
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
        active
          ? "border-california-red text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
          badgeCor,
        )}
      >
        {count}
      </span>
    </button>
  );
}

function BadgeStatus({ status }: { status: RescisaoStatus }) {
  const cores: Record<RescisaoStatus, string> = {
    rascunho: "bg-muted text-muted-foreground",
    enviada_financeiro: "bg-blue-50 text-blue-700",
    paga: "bg-emerald-600 text-white",
    cancelada: "bg-muted text-muted-foreground line-through",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cores[status]}`}
    >
      {rescisaoStatusLabel(status)}
    </span>
  );
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  if (!ano || !mes || !dia) return iso;
  return `${dia}/${mes}/${ano}`;
}

function formatarCpf(cpf: string): string {
  if (cpf.length !== 11) return cpf;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}
