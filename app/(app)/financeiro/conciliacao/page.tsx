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
         fornecedores(nome, razao_social),
         jobs(codigo),
         plano_contas_tipos!inner(codigo, nome),
         plano_contas_subtipos!inner(codigo, nome),
         conta_avulsa:contas_avulsas!conta_avulsa_id(
           rateio:contas_avulsas_regionais(
             percentual,
             regional:regionais(nome)
           )
         )`,
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
      fornecedores: { nome: string | null; razao_social: string | null } | null;
      jobs: { codigo: string } | null;
      plano_contas_tipos: { codigo: string; nome: string };
      plano_contas_subtipos: { codigo: string; nome: string };
      conta_avulsa: {
        rateio: Array<{
          percentual: number;
          regional: { nome: string } | null;
        }>;
      } | null;
    };

    const raw = ((data ?? []) as unknown as RawRow[]).map((r) => {
      const rateio = (r.conta_avulsa?.rateio ?? []).map((rr: { percentual: number; regional: { nome: string } | null }) => ({
        percentual: Number(rr.percentual),
        regional_nome: rr.regional?.nome ?? "—",
      }));
      return {
        id: r.id,
        data_movimento: r.data_movimento,
        descricao: r.descricao,
        natureza: r.natureza,
        valor: Number(r.valor),
        fornecedor_nome:
          r.fornecedores?.razao_social ?? r.fornecedores?.nome ?? null,
        job_codigo: r.jobs?.codigo ?? null,
        tipo_codigo: r.plano_contas_tipos.codigo,
        tipo_nome: r.plano_contas_tipos.nome,
        subtipo_codigo: r.plano_contas_subtipos.codigo,
        subtipo_nome: r.plano_contas_subtipos.nome,
        origem: r.origem,
        rateio,
      };
    });

    // De onde vem o dinheiro de cada baixa: os jobs cobertos pela nota e
    // o saldo em save. Só existe em lançamento de título; nos demais a
    // consulta volta vazia e a linha fica sem expansão
    // (docs/decisions/028-save-entre-jobs.md).
    const ids = raw.map((r) => r.id);
    const origensPorLancamento = new Map<
      string,
      Array<{ tipo: "job" | "save"; codigo: string | null; nome: string | null; valor: number }>
    >();
    if (ids.length > 0) {
      // Sem embed: `vw_lancamento_origens` é VIEW, e o PostgREST não tem
      // chave estrangeira para inferir o join com `jobs` a partir dela —
      // pedir `job:jobs!job_id(...)` volta erro, e o erro silencioso
      // deixava a linha sem expansão nenhuma. O nome do job vem numa
      // segunda leitura, pelos ids que a view devolveu.
      const { data: origens, error: origensErro } = await supabase
        .from("vw_lancamento_origens")
        .select("lancamento_id, tipo, valor, job_id, save_job_id")
        .eq("tenant_id", session.activeTenant.id)
        .in("lancamento_id", ids);

      if (origensErro) {
        console.error("[conciliacao.origens]", origensErro.message);
      }

      const jobIds = [
        ...new Set(
          ((origens ?? []) as any[])
            .map((o) => o.job_id ?? o.save_job_id)
            .filter((id: string | null): id is string => !!id),
        ),
      ];
      const { data: jobsDasOrigens } = jobIds.length
        ? await supabase
            .from("jobs")
            .select("id, codigo, nome")
            .eq("tenant_id", session.activeTenant.id)
            .in("id", jobIds)
        : { data: [] as any[] };
      const jobPorId = new Map(
        ((jobsDasOrigens ?? []) as any[]).map((j) => [j.id, j]),
      );

      for (const o of (origens ?? []) as any[]) {
        const lista = origensPorLancamento.get(o.lancamento_id) ?? [];
        const alvo = jobPorId.get(o.tipo === "save" ? o.save_job_id : o.job_id);
        lista.push({
          tipo: o.tipo,
          codigo: alvo?.codigo ?? null,
          nome: alvo?.nome ?? null,
          valor: Number(o.valor ?? 0),
        });
        origensPorLancamento.set(o.lancamento_id, lista);
      }
    }

    linhas = derivarSaldo(
      raw.map((r) => ({ ...r, origens: origensPorLancamento.get(r.id) ?? [] })),
      saldoAnterior,
    );
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
