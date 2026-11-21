import { createClient } from "@/lib/supabase/server";
import type { FeriasLancamentoStatus, FeriasLancamentoTipo } from "@/lib/types";
import { CardPendenteAprovacao } from "./card-pendente-aprovacao";

const TIPO_LABEL: Record<FeriasLancamentoTipo, string> = {
  usufruto: "Férias",
  abono_combinado: "Férias + abono",
  abono_avulso: "Abono avulso",
  abono_excepcional: "Abono excepcional",
};

type Pendente = {
  id: string;
  data_inicio: string;
  data_fim: string;
  dias: number;
  dias_abono: number;
  tipo: FeriasLancamentoTipo;
  observacao: string | null;
  colaborador_id: string;
  colaboradores: { nome: string } | null;
};

type HistoricoLinha = {
  id: string;
  data_inicio: string;
  data_fim: string;
  dias: number;
  tipo: FeriasLancamentoTipo;
  status: FeriasLancamentoStatus;
  colaborador_id: string;
  colaboradores: { nome: string } | null;
};

function fmtData(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

const STATUS_LABEL: Record<FeriasLancamentoStatus, string> = {
  aguardando_gestor: "Aguardando você",
  pendente_aprovacao: "Aguardando RH",
  aguardando_financeiro: "Aguardando financeiro",
  aprovado: "Aprovado",
  nf_anexada: "NF anexada",
  enviado_financeiro: "Enviado p/ financeiro",
  reprovado: "Reprovado",
  cancelado: "Cancelado",
  concluido: "Concluído",
};

const STATUS_CLS: Record<FeriasLancamentoStatus, string> = {
  aguardando_gestor: "bg-amber-100 text-amber-900",
  pendente_aprovacao: "bg-sky-100 text-sky-800",
  aguardando_financeiro: "bg-purple-100 text-purple-800",
  aprovado: "bg-emerald-100 text-emerald-800",
  nf_anexada: "bg-sky-100 text-sky-800",
  enviado_financeiro: "bg-purple-100 text-purple-800",
  reprovado: "bg-red-100 text-red-800",
  cancelado: "bg-muted text-muted-foreground",
  concluido: "bg-slate-200 text-slate-700",
};

export async function AbaFerias() {
  const supabase = createClient();

  // A RLS `ferias_lancamentos_lider_select` (PR 1) filtra pros liderados do caller.
  const [pendentesRes, historicoRes] = await Promise.all([
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, data_inicio, data_fim, dias, dias_abono, tipo, observacao, colaborador_id, colaboradores!inner(nome)",
      )
      .eq("status", "aguardando_gestor")
      .order("created_at", { ascending: true }),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, data_inicio, data_fim, dias, tipo, status, colaborador_id, colaboradores!inner(nome)",
      )
      .in("status", ["aprovado", "nf_anexada", "enviado_financeiro", "concluido", "reprovado"])
      .order("data_inicio", { ascending: false })
      .limit(20),
  ]);

  const pendentes = (pendentesRes.data ?? []) as unknown as Pendente[];
  const historico = (historicoRes.data ?? []) as unknown as HistoricoLinha[];

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Aguardando sua aprovação
        </h2>
        <div className="mt-3 space-y-3">
          {pendentes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
              Nenhuma solicitação aguardando você no momento.
            </div>
          ) : (
            pendentes.map((p) => (
              <CardPendenteAprovacao
                key={p.id}
                lancamento={{
                  id: p.id,
                  colaboradorNome: p.colaboradores?.nome ?? "—",
                  dataInicio: p.data_inicio,
                  dataFim: p.data_fim,
                  dias: p.dias,
                  diasAbono: p.dias_abono ?? 0,
                  tipoLabel: TIPO_LABEL[p.tipo],
                  observacao: p.observacao,
                }}
              />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Histórico recente
        </h2>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full table-fixed">
            <colgroup>
              <col style={{ width: 280 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 240 }} />
              <col style={{ width: 100 }} />
              <col />
            </colgroup>
            <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Colaborador</th>
                <th className="px-4 py-3 text-left font-medium">Tipo</th>
                <th className="px-4 py-3 text-left font-medium">Período</th>
                <th className="px-4 py-3 text-left font-medium">Dias</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {historico.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    Sem histórico recente.
                  </td>
                </tr>
              ) : (
                historico.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-3 align-middle text-sm">
                      {h.colaboradores?.nome ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-middle text-sm">
                      {TIPO_LABEL[h.tipo]}
                    </td>
                    <td className="px-4 py-3 align-middle text-sm">
                      {fmtData(h.data_inicio)} – {fmtData(h.data_fim)}
                    </td>
                    <td className="px-4 py-3 align-middle text-sm">{h.dias}</td>
                    <td className="px-4 py-3 align-middle">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLS[h.status]}`}
                      >
                        {STATUS_LABEL[h.status]}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
