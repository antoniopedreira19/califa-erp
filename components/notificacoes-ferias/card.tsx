import Link from "next/link";
import { Bell, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { FeriasNotificacaoTipo } from "@/lib/types";
import { LinhaNotificacao } from "./linha-notificacao";

type Props = {
  tenantId: string;
  userId: string;
  /** Máximo de notificações exibidas no card (default 5). */
  limite?: number;
  /** Se true, mostra só não-lidas; se false, mostra o mix (não-lidas em cima). */
  somenteNaoLidas?: boolean;
  /** Rota do "ver todas" — default /rh/ferias?tab=notificacoes.
   *  Pra colaborador puro, passar /perfil (fica no mesmo lugar). */
  verTodasHref?: string;
};

type NotifRow = {
  id: string;
  tipo: FeriasNotificacaoTipo;
  colaborador_id: string;
  lancamento_id: string | null;
  periodo_id: string | null;
  titulo: string;
  mensagem: string;
  criada_em: string;
  lida_em: string | null;
};

export async function CardNotificacoesFerias({
  tenantId,
  userId,
  limite = 5,
  somenteNaoLidas = false,
  verTodasHref = "/rh/ferias?tab=notificacoes",
}: Props) {
  const supabase = createClient();

  let query = supabase
    .from("colaboradores_ferias_notificacoes")
    .select(
      "id, tipo, colaborador_id, lancamento_id, periodo_id, titulo, mensagem, criada_em, lida_em",
    )
    .eq("tenant_id", tenantId)
    .eq("destinatario_user_id", userId)
    .order("lida_em", { ascending: true, nullsFirst: true })
    .order("criada_em", { ascending: false })
    .limit(limite);

  if (somenteNaoLidas) {
    query = query.is("lida_em", null);
  }

  const { data, count } = await query;
  const notificacoes = (data ?? []) as NotifRow[];

  // Conta total não-lidas separadamente (query leve head:true)
  const { count: naoLidasCount } = await supabase
    .from("colaboradores_ferias_notificacoes")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("destinatario_user_id", userId)
    .is("lida_em", null);

  const total = naoLidasCount ?? 0;

  if (notificacoes.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <header className="flex items-center gap-3 mb-4">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Bell className="h-4 w-4 text-california-red" />
          </div>
          <h3 className="text-base font-semibold">Notificações</h3>
        </header>
        <p className="text-sm text-muted-foreground text-center py-6">
          {somenteNaoLidas
            ? "Nenhuma notificação não-lida."
            : "Nenhuma notificação ainda."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
      <header className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="relative rounded-lg bg-california-red/10 p-2">
            <Bell className="h-4 w-4 text-california-red" />
            {total > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-california-red px-1 text-[10px] font-bold text-white">
                {total > 99 ? "99+" : total}
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold">
            Notificações
            {total > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {total} não {total === 1 ? "lida" : "lidas"}
              </span>
            )}
          </h3>
        </div>
        <Link
          href={verTodasHref}
          prefetch={false}
          className="inline-flex items-center gap-1 text-xs font-semibold text-california-red hover:underline"
        >
          Ver todas <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      <ul className="divide-y divide-border">
        {notificacoes.map((n) => (
          <LinhaNotificacao key={n.id} notificacao={n} />
        ))}
      </ul>
    </section>
  );
}
