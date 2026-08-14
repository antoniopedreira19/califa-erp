import { redirect } from "next/navigation";
import { ChevronRight, Receipt } from "lucide-react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { ContasReceberTabs } from "./tabs";
import { FaturamentoList, type FaturamentoPendenteRow } from "./faturamento-list";
import { TitulosList, type TituloRow } from "./titulos-list";
import type { ContaBancaria, PlanoContaTipo, PlanoContaSubtipo, TituloReceberStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ContasReceberPage() {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "financeiro") {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const [
    pendentesRes,
    contasRes,
    tiposRes,
    subtiposRes,
    empresasRes,
    clientesRes,
    fornecedoresRes,
    titulosRes,
  ] = await Promise.all([
    supabase
      .from("vw_faturamento_pendente")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .order("data_prevista", { ascending: true, nullsFirst: false }),
    supabase
      .from("contas_bancarias")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .returns<ContaBancaria[]>(),
    supabase
      .from("plano_contas_tipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaTipo[]>(),
    supabase
      .from("plano_contas_subtipos")
      .select("*")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("codigo")
      .returns<PlanoContaSubtipo[]>(),
    supabase
      .from("empresas")
      .select("id, razao_social, nome_fantasia")
      .eq("tenant_id", session.activeTenant.id)
      .eq("ativo", true)
      .order("razao_social"),
    supabase
      .from("clientes")
      .select("id, nome_fantasia, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome_fantasia"),
    supabase
      .from("fornecedores")
      .select("id, nome, razao_social")
      .eq("tenant_id", session.activeTenant.id)
      .eq("status", "ativo")
      .order("nome"),
    supabase
      .from("titulos_receber")
      .select(`
        id, numero_parcela, valor, data_vencimento, status,
        pago_em, empresa_id, faturamento_id,
        faturamento:faturamentos!inner(
          id, numero_nf, serie, data_emissao, descricao, status,
          origem_tipo, origem_id,
          cliente:clientes(id, nome_fantasia, razao_social),
          fornecedor:fornecedores(id, nome, razao_social)
        )
      `)
      .eq("tenant_id", session.activeTenant.id)
      .order("data_vencimento", { ascending: true }),
  ]);

  if (pendentesRes.error) {
    console.error("[cr.pendentes]", pendentesRes.error.message);
  }
  if (titulosRes.error) {
    console.error("[cr.titulos]", titulosRes.error.message);
  }

  const titulosRows: TituloRow[] = ((titulosRes.data ?? []) as unknown as Array<{
    id: string;
    numero_parcela: number;
    valor: string | number;
    data_vencimento: string;
    status: TituloReceberStatus;
    pago_em: string | null;
    empresa_id: string;
    faturamento_id: string;
    faturamento: {
      id: string;
      numero_nf: string;
      serie: string;
      descricao: string;
      status: "emitido" | "cancelado";
      origem_tipo: "job" | "bv" | "avulso";
      cliente: { nome_fantasia: string | null; razao_social: string | null } | null;
      fornecedor: { nome: string | null; razao_social: string | null } | null;
    };
  }>).map((r) => ({
    id: r.id,
    numero_parcela: r.numero_parcela,
    valor: Number(r.valor),
    data_vencimento: r.data_vencimento,
    status: r.status,
    pago_em: r.pago_em,
    empresa_id: r.empresa_id,
    faturamento_id: r.faturamento_id,
    fat_numero_nf: r.faturamento.numero_nf,
    fat_serie: r.faturamento.serie,
    fat_descricao: r.faturamento.descricao,
    fat_status: r.faturamento.status,
    contraparte_nome:
      r.faturamento.fornecedor?.razao_social ??
      r.faturamento.fornecedor?.nome ??
      r.faturamento.cliente?.razao_social ??
      r.faturamento.cliente?.nome_fantasia ??
      "—",
  }));

  const pendentes: FaturamentoPendenteRow[] = (pendentesRes.data ?? []).map((r) => ({
    origem_tipo: r.origem_tipo as FaturamentoPendenteRow["origem_tipo"],
    origem_id: r.origem_id as string,
    empresa_id: (r.empresa_id as string | null) ?? "",
    codigo: (r.codigo as string | null) ?? null,
    descricao: r.descricao as string,
    cliente_id: (r.cliente_id as string | null) ?? null,
    fornecedor_id: (r.fornecedor_id as string | null) ?? null,
    valor_previsto: Number(r.valor_previsto),
    valor_ja_faturado: Number(r.valor_ja_faturado),
    saldo: Number(r.saldo),
    data_prevista: (r.data_prevista as string | null) ?? null,
  }));

  const empresasList = (empresasRes.data ?? []).map(
    (e: { id: string; razao_social: string | null; nome_fantasia: string | null }) => ({
      id: e.id,
      nome: e.razao_social ?? e.nome_fantasia ?? "",
    }),
  );
  const clientesList = (clientesRes.data ?? []).map(
    (c: { id: string; nome_fantasia: string | null; razao_social: string | null }) => ({
      id: c.id,
      nome: c.razao_social ?? c.nome_fantasia ?? "",
    }),
  );
  const fornecedoresList = (fornecedoresRes.data ?? []).map(
    (f: { id: string; nome: string; razao_social: string | null }) => ({
      id: f.id,
      nome: f.razao_social ?? f.nome,
    }),
  );

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-2">
        <nav className="flex items-center gap-2 text-xs text-muted-foreground">
          <Link href="/financeiro" className="hover:text-california-red transition-colors">
            Financeiro
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-california-red">Contas a Receber</span>
        </nav>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Receipt className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Contas a Receber</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Emita NFs a partir de jobs abertos, BVs confirmados ou avulsos. Depois
          acompanhe os títulos até o recebimento.
        </p>
      </header>

      <ContasReceberTabs
        faturamento={
          <FaturamentoList
            pendentes={pendentes}
            contas={contasRes.data ?? []}
            tipos={tiposRes.data ?? []}
            subtipos={subtiposRes.data ?? []}
            empresas={empresasList}
            clientes={clientesList}
            fornecedores={fornecedoresList}
          />
        }
        faturamentoCount={pendentes.length}
        titulos={<TitulosList rows={titulosRows} contas={contasRes.data ?? []} />}
        titulosCount={titulosRows.filter((t) => t.status === "em_aberto").length}
      />
    </div>
  );
}
