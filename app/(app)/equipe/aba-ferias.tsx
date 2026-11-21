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
  colaboradores: { nome: string } | null;
};

export async function AbaFerias() {
  const supabase = createClient();

  // A RLS `ferias_lancamentos_lider_select` filtra pros liderados do caller.
  const { data: pendentesRes } = await supabase
    .from("colaboradores_ferias_lancamentos")
    .select(
      "id, data_inicio, data_fim, dias, dias_abono, tipo, observacao, colaborador_id, colaboradores!inner(nome)",
    )
    .eq("status", "aguardando_gestor")
    .order("created_at", { ascending: true });

  const pendentes = (pendentesRes ?? []) as unknown as Pendente[];

  return (
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
  );
}
