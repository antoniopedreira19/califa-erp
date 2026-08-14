import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Cliente, ClienteProduto, ClientePortal } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { ClienteForm } from "../cliente-form";
import { ProdutosCard } from "./produtos-card";
import { PortaisCard } from "./portais-card";

export const dynamic = "force-dynamic";

export default async function EditarClientePage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [clienteRes, produtosRes, portaisRes] = await Promise.all([
    supabase
      .from("clientes")
      .select("*")
      .eq("id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<Cliente>(),
    // O produto padrão (a marca do cliente) encabeça a lista; os demais
    // seguem por código.
    supabase
      .from("cliente_produtos")
      .select("*")
      .eq("cliente_id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("padrao", { ascending: false })
      .order("codigo"),
    // Portais de fornecedor: os ativos primeiro, porque são os que o
    // envio do job oferece.
    supabase
      .from("cliente_portais")
      .select("*")
      .eq("cliente_id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .order("ativo", { ascending: false })
      .order("nome"),
  ]);

  const cliente = clienteRes.data;
  if (clienteRes.error) console.error("[clientes.detail]", clienteRes.error.message);
  if (produtosRes.error) console.error("[cliente_produtos.list]", produtosRes.error.message);
  if (portaisRes.error) console.error("[cliente_portais.list]", portaisRes.error.message);
  if (!cliente) notFound();

  const produtos = (produtosRes.data ?? []) as ClienteProduto[];
  const portais = (portaisRes.data ?? []) as ClientePortal[];

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <Link
          href="/clientes"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para clientes
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {cliente.nome_fantasia}
          </h1>
          {cliente.status === "ativo" ? (
            <Badge variant="soft">Ativo</Badge>
          ) : (
            <Badge variant="neutral">Inativo</Badge>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <ClienteForm cliente={cliente} />
      </div>

      <ProdutosCard clienteId={cliente.id} produtos={produtos} />

      <PortaisCard clienteId={cliente.id} portais={portais} />
    </div>
  );
}
