import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { FluxoCaixaView, type FluxoItem } from "./fluxo-caixa-view";

export const dynamic = "force-dynamic";

export default async function FluxoCaixaPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }
  const supabase = createClient();

  // Janela default: 60 dias atrás até 90 dias à frente (client filtra fino)
  const hoje = new Date();
  const inicio = new Date(hoje);
  inicio.setDate(hoje.getDate() - 60);
  const fim = new Date(hoje);
  fim.setDate(hoje.getDate() + 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const [fluxoRes, contasRes] = await Promise.all([
    supabase
      .from("vw_fluxo_caixa")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .gte("data_evento", iso(inicio))
      .lte("data_evento", iso(fim))
      .order("data_evento", { ascending: true }),
    supabase
      .from("contas_bancarias")
      .select("id, nome, banco, empresa_id, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (fluxoRes.error)
    console.error("[fluxo-caixa]", fluxoRes.error.message);

  const itens: FluxoItem[] = (fluxoRes.data ?? []).map((r) => ({
    situacao: r.situacao as "previsto" | "realizado",
    origem_tipo: r.origem_tipo as FluxoItem["origem_tipo"],
    origem_id: r.origem_id as string,
    empresa_id: r.empresa_id as string,
    conta_bancaria_id: r.conta_bancaria_id as string | null,
    data_evento: r.data_evento as string,
    valor: Number(r.valor),
    natureza: r.natureza as "entrada" | "saida",
    descricao: r.descricao as string,
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link
            href="/financeiro"
            prefetch={false}
            className="hover:text-california-red transition-colors"
          >
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Fluxo de caixa</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <TrendingUp className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Fluxo de caixa</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Previsto (aprovados aguardando pagamento) + realizado (já baixados).
          Serve pra decidir prioridade de pagamento e antecipar saldos por
          conta.
        </p>
      </header>

      <FluxoCaixaView itens={itens} contas={contasRes.data ?? []} />
    </div>
  );
}
