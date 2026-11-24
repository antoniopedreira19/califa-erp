import { Palmtree } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { FeriasLancamentoTipo } from "@/lib/types";
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
};

type EmFerias = {
  id: string;
  data_inicio: string;
  data_fim: string;
  tipo: FeriasLancamentoTipo;
  colaborador_id: string;
};

function fmtData(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export async function AbaFerias({
  lideradoIds,
}: {
  lideradoIds: string[];
}) {
  const supabase = createClient();

  const hoje = new Date();
  const hojeISO = hoje.toISOString().slice(0, 10);
  const daqui30 = new Date(hoje);
  daqui30.setDate(hoje.getDate() + 30);
  const daqui30ISO = daqui30.toISOString().slice(0, 10);

  // Filtro explícito por `colaborador_id IN (liderados do caller)` em vez
  // de confiar só na RLS: a tabela tem policy que libera tudo do tenant
  // pra `administrador` e `rh`, então admin-que-também-é-líder veria
  // pendências de outros times sem o filtro. O nome vem da
  // `vw_equipe_do_lider` (filtrada por auth.uid()) porque a RLS da
  // `colaboradores` é admin+rh — embed direto zeraria o resultado pro
  // gerente_producao.
  const [pendentesRes, emFeriasRes, equipeRes] = await Promise.all([
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select(
        "id, data_inicio, data_fim, dias, dias_abono, tipo, observacao, colaborador_id",
      )
      .in("colaborador_id", lideradoIds)
      .eq("status", "aguardando_gestor")
      .order("created_at", { ascending: true }),
    supabase
      .from("colaboradores_ferias_lancamentos")
      .select("id, data_inicio, data_fim, tipo, colaborador_id")
      .in("colaborador_id", lideradoIds)
      .in("status", ["aprovado", "nf_anexada", "enviado_financeiro", "concluido"])
      // Abono puro (avulso/excepcional) é venda — não tira o colaborador de serviço.
      .in("tipo", ["usufruto", "abono_combinado"])
      .lte("data_inicio", daqui30ISO)
      .gte("data_fim", hojeISO)
      .order("data_inicio", { ascending: true }),
    supabase.from("vw_equipe_do_lider").select("colaborador_id, nome"),
  ]);

  const pendentes = (pendentesRes.data ?? []) as Pendente[];
  const emFerias = (emFeriasRes.data ?? []) as EmFerias[];
  const nomesPorId = new Map<string, string>(
    (equipeRes.data ?? []).map(
      (l: { colaborador_id: string; nome: string }) => [l.colaborador_id, l.nome],
    ),
  );

  return (
    <div className="space-y-6">
      {emFerias.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            De férias agora e em breve
          </h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full table-fixed">
              <colgroup>
                <col style={{ width: 320 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 240 }} />
                <col />
              </colgroup>
              <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Colaborador</th>
                  <th className="px-4 py-3 text-left font-medium">Tipo</th>
                  <th className="px-4 py-3 text-left font-medium">Período</th>
                  <th className="px-4 py-3 text-left font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {emFerias.map((e) => {
                  const inicio = e.data_inicio;
                  const fim = e.data_fim;
                  const estaFora = inicio <= hojeISO && fim >= hojeISO;
                  const situacao = estaFora
                    ? `Volta em ${fmtData(fim)}`
                    : `Sai em ${fmtData(inicio)}`;
                  return (
                    <tr key={e.id}>
                      <td className="px-4 py-3 align-middle text-sm">
                        <div className="flex items-center gap-2">
                          {estaFora ? (
                            <Palmtree className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          ) : null}
                          <span>{nomesPorId.get(e.colaborador_id) ?? "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-sm">
                        {TIPO_LABEL[e.tipo]}
                      </td>
                      <td className="px-4 py-3 align-middle text-sm">
                        {fmtData(inicio)} – {fmtData(fim)}
                      </td>
                      <td className="px-4 py-3 align-middle text-sm">
                        <span
                          className={
                            estaFora
                              ? "font-medium text-emerald-700"
                              : "text-muted-foreground"
                          }
                        >
                          {situacao}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
                  colaboradorNome: nomesPorId.get(p.colaborador_id) ?? "—",
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
    </div>
  );
}
