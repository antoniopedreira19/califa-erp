import Link from "next/link";
import { ArrowLeft, Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import type { ContaBancaria } from "@/lib/types";
import {
  SELECT_LANCAMENTO_LINHA,
  montarLinhasDeLancamentos,
} from "@/lib/data/lancamento-linha";
import {
  agruparPorCentro,
  carregarExtratoDaFatura,
  type DetalheDaFatura,
} from "@/lib/data/fatura-cartao-extrato";
import {
  calcularSaldoAnterior,
  derivarSaldo,
} from "@/lib/calculos/saldo-conta";
import { FiltrosConta } from "./filtros-conta";
import { ConciliacaoList } from "./conciliacao-list";
import { HubConciliacao } from "./hub";
import { lerPeriodo } from "./hub-periodo";

export const dynamic = "force-dynamic";

export default async function ConciliacaoPage({
  searchParams,
}: {
  searchParams: {
    conta?: string;
    de?: string;
    ate?: string;
    highlight?: string;
    periodo?: string;
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

  // Sem conta escolhida, esta rota é a PÁGINA INICIAL da conciliação
  // (decisão 091) — antes ela abria direto no extrato da primeira conta.
  // Com `?conta=`, segue no extrato de sempre: os
  // `revalidatePath("/financeiro/conciliacao")` das baixas e os links com
  // `&highlight=` continuam valendo sem mudança nenhuma.
  //
  // O id é conferido antes de entrar na consulta: `?conta=qualquer-coisa`
  // faria o PostgREST recusar a query inteira, e a tela apareceria vazia
  // em vez de mostrar a lista.
  const contaId =
    searchParams.conta &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      searchParams.conta,
    )
      ? searchParams.conta
      : null;

  if (!contaId) {
    return (
      <HubConciliacao
        supabase={supabase}
        tenantId={session.activeTenant.id}
        periodo={lerPeriodo(searchParams.periodo)}
      />
    );
  }

  const { data: contas } = await supabase
    .from("contas_bancarias")
    .select("*")
    .eq("tenant_id", session.activeTenant.id)
    .eq("ativo", true)
    // A conta-espelho do cartão saiu da conciliação (decisão 091): fatura
    // é passivo, não saldo em banco — as outras telas do financeiro já a
    // filtram assim. Ela continua abrindo por link direto, e nesse caso
    // precisa aparecer no seletor, senão o campo fica vazio.
    .or(`tipo.neq.cartao_credito,id.eq.${contaId}`)
    .order("ordem")
    .order("nome")
    .returns<ContaBancaria[]>();

  const listaContas = contas ?? [];

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
  const detalhesFatura: Record<string, DetalheDaFatura> = {};
  let creditos = 0;
  let debitos = 0;

  if (contaId) {
    const s = await calcularSaldoAnterior(supabase, {
      tenantId: session.activeTenant.id,
      contaId,
      dataDe,
    });
    saldoAnterior = s.saldoAnterior;

    // ⚠️ O erro é LIDO. Ele era descartado, e o efeito de qualquer engano
    // na query — um embed ambíguo, por exemplo — era a tela dizer
    // "nenhum lançamento nesse período", que é indistinguível de um
    // período vazio de verdade. Foi assim que a coluna Origem entrou
    // quebrada em 28/08/2026: `titulos_receber` tem FK nas DUAS direções
    // e o PostgREST não escolhe sozinho.
    const { data, error: lancamentosErr } = await supabase
      .from("lancamentos_financeiros")
      .select(SELECT_LANCAMENTO_LINHA)
      .eq("tenant_id", session.activeTenant.id)
      .eq("conta_bancaria_id", contaId)
      .gte("data_movimento", dataDe)
      .lte("data_movimento", dataAte)
      .order("data_movimento", { ascending: true })
      .order("created_at", { ascending: true });

    if (lancamentosErr) {
      console.error("[conciliacao.lancamentos]", lancamentosErr.message);
    }

    // A tradução de linha crua para linha do extrato mora em
    // `lib/data/lancamento-linha.ts` desde 20/09/2026: a fatura do cartão
    // (aba Cartão, decisão 093) usa a MESMA, porque é o mesmo extrato.
    const semSaldo = await montarLinhasDeLancamentos(
      supabase,
      session.activeTenant.id,
      data ?? [],
    );
    linhas = derivarSaldo(semSaldo, saldoAnterior);

    // O pagamento de uma fatura de cartão abre em dois níveis — centro de
    // custo e, dentro dele, os itens (decisão 093, entrega 3). Só a perna
    // do BANCO (esta conta) e só o pagamento vivo: o estorno é a linha
    // reversa, e não se expande. Uma leitura por fatura paga no período.
    const pagamentos = semSaldo.filter(
      (l) => l.papel_na_fatura === "pagamento" && l.fatura_cartao_id !== null,
    );
    const faturaIds = [...new Set(pagamentos.map((l) => l.fatura_cartao_id as string))];
    const extratos = await Promise.all(
      faturaIds.map((id) =>
        carregarExtratoDaFatura(supabase, session.activeTenant.id, id),
      ),
    );
    const detalhePorFatura = new Map<string, DetalheDaFatura>();
    extratos.forEach((e, i) => {
      if (e) detalhePorFatura.set(faturaIds[i], agruparPorCentro(e));
    });
    for (const l of pagamentos) {
      const d = detalhePorFatura.get(l.fatura_cartao_id as string);
      if (d) detalhesFatura[l.id] = d;
    }
    creditos = linhas.reduce((acc, l) => acc + l.credito, 0);
    debitos = linhas.reduce((acc, l) => acc + l.debito, 0);
  }

  const saldoFinal = saldoAnterior + creditos - debitos;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/financeiro/conciliacao"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para a lista de contas
        </Link>
      </div>
      <PageHeader
        eyebrow="FINANCEIRO"
        title="Conciliação"
        description="Extrato por conta bancária — base pra bater com o extrato do banco e alimentar o DRE."
        icon={Receipt}
      />

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

          <ConciliacaoList
            linhas={linhas}
            highlight={searchParams.highlight}
            detalhesFatura={detalhesFatura}
          />
        </>
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
