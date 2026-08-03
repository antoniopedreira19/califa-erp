import { redirect } from "next/navigation";
import { FileText, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PedidosCompraList, type PPRow } from "./pedidos-compra-list";
import type { PPStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PedidosCompraFinanceiroPage() {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const { data, error } = await supabase
    .from("pedidos_compra")
    .select(
      `
      id, codigo, status, valor, quantidade, servico, especificacoes,
      prazo_pagamento, prazo_pagamento_financeiro, pdf_path, created_at,
      cancelada_em, motivo_cancelamento,
      fornecedor:fornecedores(id, nome, razao_social),
      empresa:empresas(id, razao_social, nome_fantasia),
      cancelada_por_profile:profiles!cancelada_por(nome),
      emitida_por_profile:profiles!emitida_por(nome),
      job:jobs(
        id, codigo, nome,
        projeto:projetos(codigo, nome, cliente:clientes(nome_fantasia))
      ),
      anexos:pedidos_compra_anexos(id, arquivo_nome_original, arquivo_tamanho_bytes)
    `,
    )
    .eq("tenant_id", session.activeTenant.id)
    .order("created_at", { ascending: false });

  if (error) console.error("[financeiro.pp.list]", error.message);

  const rows: PPRow[] = ((data ?? []) as unknown as Array<{
    id: string;
    codigo: string;
    status: PPStatus;
    valor: string | number;
    quantidade: string | number;
    servico: string;
    especificacoes: string | null;
    prazo_pagamento: string;
    prazo_pagamento_financeiro: string | null;
    pdf_path: string;
    created_at: string;
    cancelada_em: string | null;
    motivo_cancelamento: string | null;
    fornecedor: { id: string; nome: string; razao_social: string | null } | null;
    empresa: { id: string; razao_social: string; nome_fantasia: string | null } | null;
    cancelada_por_profile: { nome: string } | null;
    emitida_por_profile: { nome: string } | null;
    job: {
      id: string;
      codigo: string;
      nome: string;
      projeto: {
        codigo: string;
        nome: string;
        cliente: { nome_fantasia: string } | null;
      } | null;
    } | null;
    anexos: Array<{
      id: string;
      arquivo_nome_original: string;
      arquivo_tamanho_bytes: number;
    }>;
  }>).map((r) => ({
    id: r.id,
    codigo: r.codigo,
    status: r.status,
    valor: Number(r.valor),
    quantidade: Number(r.quantidade),
    servico: r.servico,
    especificacoes: r.especificacoes,
    prazo_pagamento: r.prazo_pagamento,
    prazo_pagamento_financeiro: r.prazo_pagamento_financeiro,
    pdf_path: r.pdf_path,
    created_at: r.created_at,
    cancelada_em: r.cancelada_em,
    motivo_cancelamento: r.motivo_cancelamento,
    fornecedor_id: r.fornecedor?.id ?? "",
    fornecedor_nome: r.fornecedor?.razao_social ?? r.fornecedor?.nome ?? "",
    empresa_id: r.empresa?.id ?? "",
    empresa_nome: r.empresa?.razao_social ?? r.empresa?.nome_fantasia ?? "",
    job_id: r.job?.id ?? "",
    job_codigo: r.job?.codigo ?? "",
    job_nome: r.job?.nome ?? "",
    projeto_codigo: r.job?.projeto?.codigo ?? null,
    projeto_nome: r.job?.projeto?.nome ?? null,
    cliente_nome: r.job?.projeto?.cliente?.nome_fantasia ?? null,
    cancelada_por_nome: r.cancelada_por_profile?.nome ?? null,
    emitida_por_nome: r.emitida_por_profile?.nome ?? null,
    anexos: r.anexos ?? [],
  }));

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Pedidos de Compra</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FileText className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Pedidos de Compra</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Visualize as PPs emitidas pelos GPs, ajuste o prazo de pagamento financeiro e cancele com motivo justificado.
        </p>
      </header>

      <PedidosCompraList rows={rows} />
    </div>
  );
}
