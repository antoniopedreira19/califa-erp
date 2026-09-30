"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Empresa, FolhaLinhaStatus, TipoContratacao } from "@/lib/types";
import { folhaLinhaStatusLabel, tipoContratacaoLabel } from "@/lib/types";
import {
  formaDePagamento,
  type ColaboradorPagamento,
} from "@/lib/financeiro/colaboradores-pagamento";
import { RevisarFolhaDrawer } from "./revisar-folha-drawer";

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

export type FolhaLinhaFinanceiro = {
  id: string;
  competencia_ano: number;
  competencia_mes: number;
  salario_base: string;
  status: FolhaLinhaStatus;
  motivo_pendencia: string | null;
  /**
   * O colaborador inteiro como o financeiro enxerga (decisão 132): nome,
   * contratação, documentos e pagamento. Obrigatório de propósito — um
   * campo a menos aqui sumiria em silêncio da tela (CLAUDE.md).
   */
  colaborador: ColaboradorPagamento;
  alocacoes: {
    id: string;
    empresa_id: string;
    regional_id: string;
    percentual: string;
    empresa_nome: string;
    regional_nome: string;
  }[];
};

type StatusFiltro = "todos" | FolhaLinhaStatus;
type TipoFiltro = "todos" | TipoContratacao;

const ORDEM_TIPO: TipoContratacao[] = ["pj", "mei", "clt_recibo", "clt", "estagio", "socio"];

function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v);
}

export function FolhasPagarList({
  linhas,
  empresas,
  regionais,
}: {
  linhas: FolhaLinhaFinanceiro[];
  empresas: Pick<Empresa, "id" | "nome_fantasia">[];
  regionais: { id: string; nome: string; empresa_id: string }[];
}) {
  const [busca, setBusca] = React.useState("");
  const [status, setStatus] = React.useState<StatusFiltro>("todos");
  const [tipo, setTipo] = React.useState<TipoFiltro>("todos");
  // Pelo id, e não pelo objeto: depois de um refresh (salvar o pagamento,
  // por exemplo) o painel mostra a linha atualizada.
  const [revisandoId, setRevisandoId] = React.useState<string | null>(null);
  const linhaRevisando = linhas.find((l) => l.id === revisandoId) ?? null;

  const tiposPresentes = React.useMemo(() => {
    const presentes = new Set(linhas.map((l) => l.colaborador.tipo_contratacao));
    return ORDEM_TIPO.filter((t) => presentes.has(t));
  }, [linhas]);

  const filtradas = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (status !== "todos" && l.status !== status) return false;
      if (tipo !== "todos" && l.colaborador.tipo_contratacao !== tipo) return false;
      if (!q) return true;
      return (
        l.colaborador.nome.toLowerCase().includes(q) ||
        l.colaborador.funcao.toLowerCase().includes(q)
      );
    });
  }, [linhas, busca, status, tipo]);

  const contagem = React.useMemo(() => {
    const c = { enviada: 0, pendente_correcao: 0 };
    for (const l of linhas) {
      if (l.status === "enviada") c.enviada += 1;
      if (l.status === "pendente_correcao") c.pendente_correcao += 1;
    }
    return c;
  }, [linhas]);

  const totalFiltrado = filtradas.reduce(
    (acc, l) => acc + Math.round(Number(l.salario_base) * 100),
    0,
  ) / 100;
  const semPagamento = filtradas.filter(
    (l) => formaDePagamento(l.colaborador) === null,
  ).length;

  if (linhas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhuma folha aguardando ação. Quando o RH enviar, aparece aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-md min-w-[240px]">
          <Input
            placeholder="Buscar por nome ou função..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFiltro)}
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos ({linhas.length})</SelectItem>
            <SelectItem value="enviada">
              Aguardando aprovação ({contagem.enviada})
            </SelectItem>
            <SelectItem value="pendente_correcao">
              Aguardando o RH corrigir ({contagem.pendente_correcao})
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={(v) => setTipo(v as TipoFiltro)}>
          <SelectTrigger className="w-56" aria-label="Contratação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todas as contratações</SelectItem>
            {tiposPresentes.map((t) => (
              <SelectItem key={t} value={t}>
                {tipoContratacaoLabel(t)} (
                {linhas.filter((l) => l.colaborador.tipo_contratacao === t).length})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="ml-auto text-sm text-muted-foreground">
          {filtradas.length} {filtradas.length === 1 ? "linha" : "linhas"} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatBRL(totalFiltrado)}
          </span>
          {semPagamento > 0 && (
            <span className="text-california-red"> · {semPagamento} sem pagamento</span>
          )}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-32">
                Competência
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Colaborador
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Alocação
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-36">
                Pagamento
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground w-40">
                Valor
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground w-40">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr
                key={l.id}
                onClick={() => setRevisandoId(l.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setRevisandoId(l.id);
                  }
                }}
                className="cursor-pointer border-b border-border last:border-0 transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {NOMES_MES[l.competencia_mes - 1]}/{l.competencia_ano}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{l.colaborador.nome}</span>
                    <SeloContratacao tipo={l.colaborador.tipo_contratacao} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {l.colaborador.funcao}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {l.alocacoes.map((a) => (
                    <div key={a.id}>
                      {a.empresa_nome} · {a.regional_nome} ·{" "}
                      <span className="tabular-nums font-medium">
                        {Number(a.percentual).toFixed(2).replace(".", ",")}%
                      </span>
                    </div>
                  ))}
                </td>
                <td className="px-4 py-3">
                  <SeloPagamento colaborador={l.colaborador} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">
                  {formatBRL(Number(l.salario_base))}
                </td>
                <td className="px-4 py-3">
                  <BadgeStatus status={l.status} />
                  {l.status === "pendente_correcao" && l.motivo_pendencia && (
                    <div className="mt-1 flex items-start gap-1 text-[10px] text-california-red">
                      <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{l.motivo_pendencia}</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {filtradas.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Nenhuma linha corresponde aos filtros.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {linhaRevisando && (
        <RevisarFolhaDrawer
          linha={linhaRevisando}
          empresas={empresas}
          regionais={regionais}
          open={!!linhaRevisando}
          onOpenChange={(next) => {
            if (!next) setRevisandoId(null);
          }}
        />
      )}
    </div>
  );
}

/** CLT e estágio em âmbar: esperam o líquido da contabilidade. */
function SeloContratacao({ tipo }: { tipo: TipoContratacao }) {
  const clt = tipo === "clt" || tipo === "estagio";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-semibold ${
        clt
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-border text-muted-foreground"
      }`}
    >
      {tipoContratacaoLabel(tipo)}
    </span>
  );
}

function SeloPagamento({ colaborador }: { colaborador: ColaboradorPagamento }) {
  const forma = formaDePagamento(colaborador);
  if (forma === "pix") {
    return (
      <span className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        PIX
      </span>
    );
  }
  if (forma === "conta") {
    return (
      <span className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
        TED
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-md bg-california-red/10 px-2 py-0.5 text-[11px] font-semibold text-california-red">
      Sem dados
    </span>
  );
}

function BadgeStatus({ status }: { status: FolhaLinhaStatus }) {
  const cores: Record<FolhaLinhaStatus, string> = {
    rascunho: "bg-muted text-muted-foreground",
    enviada: "bg-blue-50 text-blue-700",
    aprovada: "bg-emerald-50 text-emerald-700",
    pendente_correcao: "bg-california-red/10 text-california-red",
    paga: "bg-emerald-600 text-white",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cores[status]}`}
    >
      {folhaLinhaStatusLabel(status)}
    </span>
  );
}
