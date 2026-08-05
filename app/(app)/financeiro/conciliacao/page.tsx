import Link from "next/link";
import { Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { ContaBancaria } from "@/lib/types";
import {
  calcularSaldoAnterior,
  derivarSaldo,
} from "@/lib/calculos/saldo-conta";
import { FiltrosConta } from "./filtros-conta";
import { ConciliacaoList } from "./conciliacao-list";

export const dynamic = "force-dynamic";

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: {
    conta?: string;
    de?: string;
    ate?: string;
    highlight?: string;
  };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const supabase = createClient();

  const { data: contas } = await supabase
    .from("contas_bancarias")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true)
    .order("ordem")
    .order("nome")
    .returns<ContaBancaria[]>();

  const listaContas = contas ?? [];
  const contaId = searchParams.conta ?? listaContas[0]?.id ?? null;

  // Default: mês corrente
  const hoje = new Date();
  const dataDe =
    searchParams.de ??
    new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
  const dataAte =
    searchParams.ate ??
    new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);

  let saldoAnterior = 0;
  let linhas: ReturnType<typeof derivarSaldo> = [];
  let creditos = 0;
  let debitos = 0;

  if (contaId) {
    const s = await calcularSaldoAnterior(supabase, {
      tenantId: session.activeTenant.id,
      contaId,
      dataDe,
    });
    saldoAnterior = s.saldoAnterior;

    const { data } = await supabase
      .from("lancamentos_financeiros")
      .select(
        `id, data_movimento, descricao, natureza, valor, origem, created_at,
         fornecedores(nome_fantasia, razao_social),
         jobs(codigo),
         plano_contas_tipos!inner(codigo, nome),
         plano_contas_subtipos!inner(nome)`,
      )
      .eq("tenant_id", session.activeTenant.id)
      .eq("conta_bancaria_id", contaId)
      .gte("data_movimento", dataDe)
      .lte("data_movimento", dataAte)
      .order("data_movimento", { ascending: true })
      .order("created_at", { ascending: true });

    type RawRow = {
      id: string;
      data_movimento: string;
      descricao: string;
      natureza: "entrada" | "saida";
      valor: string | number;
      origem: string;
      fornecedores: { nome_fantasia: string | null; razao_social: string | null } | null;
      jobs: { codigo: string } | null;
      plano_contas_tipos: { codigo: string; nome: string };
      plano_contas_subtipos: { nome: string };
    };

    const raw = ((data ?? []) as unknown as RawRow[]).map((r) => ({
      id: r.id,
      data_movimento: r.data_movimento,
      descricao: r.descricao,
      natureza: r.natureza,
      valor: Number(r.valor),
      fornecedor_nome:
        r.fornecedores?.nome_fantasia ?? r.fornecedores?.razao_social ?? null,
      job_codigo: r.jobs?.codigo ?? null,
      tipo_codigo: r.plano_contas_tipos.codigo,
      tipo_nome: r.plano_contas_tipos.nome,
      subtipo_nome: r.plano_contas_subtipos.nome,
      origem: r.origem,
    }));

    linhas = derivarSaldo(raw, saldoAnterior);
    creditos = linhas.reduce((acc, l) => acc + l.credito, 0);
    debitos = linhas.reduce((acc, l) => acc + l.debito, 0);
  }

  const saldoFinal = saldoAnterior + creditos - debitos;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-california-red">
          Financeiro
        </p>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <Receipt className="h-5 w-5 text-california-red" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Conciliação</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Extrato por conta bancária — base pra bater com o extrato do banco e
          alimentar o DRE.
        </p>
      </header>

      <FiltrosConta
        contas={listaContas}
        contaAtual={contaId ?? undefined}
        dataDe={dataDe}
        dataAte={dataAte}
      />

      {contaId && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SaldoCard label="Saldo anterior" valor={saldoAnterior} muted />
            <SaldoCard
              label="Créditos no período"
              valor={creditos}
              tone="entrada"
            />
            <SaldoCard
              label="Débitos no período"
              valor={debitos}
              tone="saida"
            />
            <SaldoCard label="Saldo final" valor={saldoFinal} destaque />
          </div>

          <ConciliacaoList linhas={linhas} highlight={searchParams.highlight} />
        </>
      )}

      {!contaId && (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta bancária cadastrada. Vá em{" "}
            <Link
              href="/cadastros/contas-bancarias"
              prefetch={false}
              className="text-california-red hover:underline"
            >
              cadastros
            </Link>{" "}
            pra criar a primeira.
          </p>
        </div>
      )}
    </div>
  );
}

function SaldoCard({
  label,
  valor,
  muted,
  destaque,
  tone,
}: {
  label: string;
  valor: number;
  muted?: boolean;
  destaque?: boolean;
  tone?: "entrada" | "saida";
}) {
  const cor = destaque
    ? valor >= 0
      ? "text-emerald-700"
      : "text-california-red"
    : tone === "entrada"
      ? "text-emerald-700"
      : tone === "saida"
        ? "text-california-red"
        : muted
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 font-mono text-lg font-semibold ${cor}`}>
        {valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
      </p>
    </div>
  );
}
