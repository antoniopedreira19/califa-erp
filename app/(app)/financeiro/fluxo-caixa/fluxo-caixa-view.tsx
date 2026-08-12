"use client";

import * as React from "react";
import { formatBRL } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type FluxoItem = {
  situacao: "previsto" | "realizado";
  origem_tipo: "pp" | "avulsa" | "recorrente" | "lancamento";
  origem_id: string;
  empresa_id: string;
  conta_bancaria_id: string | null;
  data_evento: string;
  valor: number;
  natureza: "entrada" | "saida";
  descricao: string;
};

type Conta = { id: string; nome: string; empresa_id: string };
type Agrupamento = "dia" | "semana" | "mes";

function chaveBucket(iso: string, agrup: Agrupamento): string {
  if (agrup === "dia") return iso;
  if (agrup === "mes") return iso.slice(0, 7);
  // semana: YYYY-Www (ISO aproximado)
  const d = new Date(iso + "T00:00:00");
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const dias = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const week = Math.ceil((dias + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
}

function labelBucket(k: string, agrup: Agrupamento): string {
  if (agrup === "mes") {
    const [ano, mes] = k.split("-");
    const d = new Date(Number(ano), Number(mes) - 1, 1);
    return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }
  if (agrup === "semana") return `Semana ${k}`;
  // dia — YYYY-MM-DD → DD/MM/YYYY
  const [ano, mes, dia] = k.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function FluxoCaixaView({
  itens,
  contas,
}: {
  itens: FluxoItem[];
  contas: Conta[];
}) {
  const [agrup, setAgrup] = React.useState<Agrupamento>("dia");
  const [contaFiltro, setContaFiltro] = React.useState<
    string | "todas" | "sem_alocacao"
  >("todas");

  const filtrados = itens.filter((i) => {
    if (contaFiltro === "todas") return true;
    if (contaFiltro === "sem_alocacao") return i.conta_bancaria_id === null;
    return i.conta_bancaria_id === contaFiltro;
  });

  const buckets = new Map<
    string,
    { previsto: number; realizado: number; qtd: number }
  >();
  for (const item of filtrados) {
    const k = chaveBucket(item.data_evento, agrup);
    if (!buckets.has(k)) buckets.set(k, { previsto: 0, realizado: 0, qtd: 0 });
    const b = buckets.get(k)!;
    const sinal = item.natureza === "saida" ? -1 : 1;
    if (item.situacao === "previsto") b.previsto += item.valor * sinal;
    else b.realizado += item.valor * sinal;
    b.qtd += 1;
  }

  const bucketsOrdenados = [...buckets.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  let saldoAcum = 0;

  return (
    <div className="space-y-4">
      {/* Controles */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-border p-1 bg-card">
          {(["dia", "semana", "mes"] as const).map((a) => (
            <Button
              key={a}
              size="sm"
              variant={agrup === a ? "default" : "ghost"}
              onClick={() => setAgrup(a)}
            >
              {a === "dia" ? "Dia" : a === "semana" ? "Semana" : "Mês"}
            </Button>
          ))}
        </div>

        <select
          className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/30"
          value={contaFiltro}
          onChange={(e) =>
            setContaFiltro(e.target.value as typeof contaFiltro)
          }
        >
          <option value="todas">Todas as contas</option>
          <option value="sem_alocacao">Sem conta alocada (previstos)</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>

      {/* Tabela de buckets */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-3 text-left">Período</th>
              <th className="p-3 text-right">Previsto</th>
              <th className="p-3 text-right">Realizado</th>
              <th className="p-3 text-right">Saldo acumulado</th>
              <th className="p-3 text-right">Itens</th>
            </tr>
          </thead>
          <tbody>
            {bucketsOrdenados.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="p-8 text-center text-muted-foreground"
                >
                  Sem movimento no período selecionado.
                </td>
              </tr>
            )}
            {bucketsOrdenados.map(([k, b]) => {
              saldoAcum += b.previsto + b.realizado;
              return (
                <tr
                  key={k}
                  className="border-t border-border hover:bg-muted/40 transition-colors"
                >
                  <td className="p-3 font-medium">
                    {labelBucket(k, agrup)}
                  </td>
                  <td
                    className={`p-3 text-right font-mono ${
                      b.previsto < 0 ? "text-orange-600" : "text-green-600"
                    }`}
                  >
                    {formatBRL(b.previsto)}
                  </td>
                  <td
                    className={`p-3 text-right font-mono ${
                      b.realizado < 0 ? "text-red-600" : "text-green-700"
                    }`}
                  >
                    {formatBRL(b.realizado)}
                  </td>
                  <td
                    className={`p-3 text-right font-mono font-semibold ${
                      saldoAcum < 0 ? "text-red-600" : ""
                    }`}
                  >
                    {formatBRL(saldoAcum)}
                  </td>
                  <td className="p-3 text-right text-muted-foreground">
                    {b.qtd}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {contaFiltro === "sem_alocacao" && (
        <p className="text-xs text-muted-foreground">
          <Badge variant="neutral">Sem conta alocada</Badge>{" "}
          previstos (PP e avulsas aprovadas) ainda não têm conta bancária
          escolhida; a conta é definida no ato da baixa.
        </p>
      )}
    </div>
  );
}
