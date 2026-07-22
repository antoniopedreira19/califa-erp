import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileStack, Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { listActiveMembers } from "@/lib/data/members";
import {
  orcamentoStatusLabel,
  type Cliente,
  type Orcamento,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { OrcamentoForm } from "../orcamento-form";

export const dynamic = "force-dynamic";

function statusBadgeClasses(status: Orcamento["status"]): string {
  switch (status) {
    case "rascunho":
      return "bg-muted text-muted-foreground border-border";
    case "em_revisao":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "enviado_cliente":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "aprovado":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "job_criado":
      return "bg-california-red/10 text-california-red border-california-red/20";
    case "recusado":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "cancelado":
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

export default async function OrcamentoDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await requireSession();
  const supabase = createClient();

  const [orcRes, clientesRes, responsaveis] = await Promise.all([
    supabase
      .from("orcamentos")
      .select("*")
      .eq("id", params.id)
      .eq("tenant_id", session.activeTenant.id)
      .maybeSingle<Orcamento>(),
    supabase
      .from("clientes")
      .select("id, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    listActiveMembers(session.activeTenant.id),
  ]);

  if (orcRes.error) console.error("[orcamentos.detail]", orcRes.error.message);
  const orcamento = orcRes.data;
  if (!orcamento) notFound();

  const clientes = (clientesRes.data ?? []) as Pick<Cliente, "id" | "nome_fantasia">[];

  const protegido =
    orcamento.status === "aprovado" || orcamento.status === "job_criado";

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href="/orcamentos"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para orçamentos
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="font-mono text-xs font-semibold text-muted-foreground">
            {orcamento.codigo}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">{orcamento.nome}</h1>
          <Badge className={cn("border", statusBadgeClasses(orcamento.status))}>
            {orcamentoStatusLabel(orcamento.status)}
          </Badge>
        </div>
      </div>

      {/* Edição / dados */}
      <Card>
        <CardHeader>
          <CardTitle>Dados do orçamento</CardTitle>
          <CardDescription>
            Alterações são registradas em auditoria.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {protegido ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 flex items-start gap-3">
              <Lock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground">
                Este orçamento está em estado protegido (
                <strong>{orcamentoStatusLabel(orcamento.status)}</strong>).
                Alterações neste estágio precisam ser feitas pelas rotinas de
                aprovação (Task 004) ou criação de job (Task 005), que ainda
                serão implementadas.
              </div>
            </div>
          ) : (
            <OrcamentoForm
              orcamento={orcamento}
              clientes={clientes}
              responsaveis={responsaveis}
            />
          )}
        </CardContent>
      </Card>

      {/* Slot de versões — implementação vem na Task 004 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileStack className="h-5 w-5 text-california-red" />
            Versões do orçamento
          </CardTitle>
          <CardDescription>
            v1, v2, v3... com itens, importação de planilha e aprovação.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Disponível na <span className="font-semibold text-foreground">Task 004</span>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
