import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { FeriasNotificacaoTipo } from "@/lib/types";
import { LinhaNotificacao } from "@/components/notificacoes-ferias/linha-notificacao";

type Props = {
  tenantId: string;
  userId: string;
  tipoFiltro?: string;
  somenteNaoLidas?: boolean;
};

const FILTROS_TIPO: {
  valor: FeriasNotificacaoTipo | "todos";
  label: string;
}[] = [
  { valor: "todos", label: "Todos os tipos" },
  { valor: "solicitacao", label: "Solicitações" },
  { valor: "aprovada", label: "Aprovações" },
  { valor: "reprovada", label: "Reprovações" },
  { valor: "concessivo_em_alerta", label: "Em alerta" },
  { valor: "concessivo_liberado", label: "Liberados" },
  { valor: "ferias_vencidas", label: "Vencidas" },
  { valor: "emitir_nf", label: "Emitir NF" },
  { valor: "retorno", label: "Retornos" },
  { valor: "inicio", label: "Inícios" },
];

export async function AbaNotificacoes({
  tenantId,
  userId,
  tipoFiltro,
  somenteNaoLidas,
}: Props) {
  const supabase = createClient();

  let query = supabase
    .from("colaboradores_ferias_notificacoes")
    .select(
      "id, tipo, colaborador_id, lancamento_id, periodo_id, titulo, mensagem, criada_em, lida_em",
    )
    .eq("tenant_id", tenantId)
    .eq("destinatario_user_id", userId)
    .order("criada_em", { ascending: false })
    .limit(200);

  if (tipoFiltro && tipoFiltro !== "todos") {
    query = query.eq("tipo", tipoFiltro);
  }
  if (somenteNaoLidas) {
    query = query.is("lida_em", null);
  }

  const { data } = await query;
  const notificacoes = (data ?? []) as Array<{
    id: string;
    tipo: FeriasNotificacaoTipo;
    colaborador_id: string;
    lancamento_id: string | null;
    periodo_id: string | null;
    titulo: string;
    mensagem: string;
    criada_em: string;
    lida_em: string | null;
  }>;

  return (
    <div className="space-y-5">
      {/* Filtros */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex flex-wrap gap-2">
          {FILTROS_TIPO.map((f) => {
            const ativo =
              (tipoFiltro ?? "todos") === f.valor;
            const params = new URLSearchParams();
            params.set("tab", "notificacoes");
            if (f.valor !== "todos") params.set("notif_tipo", f.valor);
            if (somenteNaoLidas) params.set("nao_lidas", "1");
            return (
              <Link
                key={f.valor}
                href={`/rh/ferias?${params.toString()}`}
                prefetch={false}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  ativo
                    ? "bg-california-red text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={(() => {
              const p = new URLSearchParams();
              p.set("tab", "notificacoes");
              if (tipoFiltro && tipoFiltro !== "todos")
                p.set("notif_tipo", tipoFiltro);
              if (!somenteNaoLidas) p.set("nao_lidas", "1");
              return `/rh/ferias?${p.toString()}`;
            })()}
            prefetch={false}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              somenteNaoLidas
                ? "bg-california-red text-white"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {somenteNaoLidas ? "✓ Só não lidas" : "Só não lidas"}
          </Link>
        </div>
      </div>

      {/* Lista */}
      {notificacoes.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma notificação com esses filtros.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-soft overflow-hidden">
          <ul className="divide-y divide-border">
            {notificacoes.map((n) => (
              <LinhaNotificacao key={n.id} notificacao={n} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
