import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Wallet } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ListaAPagar, type ItemAPagar } from "./lista-a-pagar";

export const dynamic = "force-dynamic";

export default async function APagarPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const [itensRes, contasRes, tiposRes, subtiposRes] = await Promise.all([
    supabase
      .from("vw_a_pagar")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista", { ascending: true, nullsFirst: true }),
    supabase
      .from("contas_bancarias")
      .select("id, nome, banco, empresa_id, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
    supabase
      .from("plano_contas_tipos")
      .select("id, codigo, nome, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("ordem"),
    supabase
      .from("plano_contas_subtipos")
      .select("id, tipo_id, nome, ativo")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("nome"),
  ]);

  if (itensRes.error) {
    console.error("[a-pagar] erro ao carregar lista:", itensRes.error.message);
  }

  const itens: ItemAPagar[] = (itensRes.data ?? []).map((r) => ({
    origem_tipo: r.origem_tipo as ItemAPagar["origem_tipo"],
    origem_id: r.origem_id as string,
    empresa_id: r.empresa_id as string,
    data_prevista: r.data_prevista as string | null,
    valor: Number(r.valor),
    natureza: r.natureza as "entrada" | "saida",
    descricao: r.descricao as string,
    fornecedor_id: r.fornecedor_id as string | null,
    cliente_id: r.cliente_id as string | null,
    job_id: r.job_id as string | null,
    aprovada_em: r.aprovada_em as string | null,
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
          <span className="text-california-red">A pagar</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Wallet className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">A pagar</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Pedidos de Compra aprovados e lançamentos avulsos aguardando pagamento.
          Dê baixa quando o dinheiro sair do banco.
        </p>
      </header>

      <ListaAPagar
        itens={itens}
        contas={contasRes.data ?? []}
        tipos={tiposRes.data ?? []}
        subtipos={subtiposRes.data ?? []}
      />
    </div>
  );
}
