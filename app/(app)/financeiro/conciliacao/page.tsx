import { Receipt } from "lucide-react";
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
  agruparGuiasDeImposto,
  carregarLancamentosDasGuias,
  type DetalheDoImposto,
} from "@/lib/data/imposto-extrato";
import {
  calcularSaldoAnterior,
  derivarSaldo,
} from "@/lib/calculos/saldo-conta";
import { FiltrosConta } from "./filtros-conta";
import { ConciliacaoList } from "./conciliacao-list";
import { HubConciliacao } from "./hub";
import { lerPeriodo } from "./hub-periodo";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { AbasDaConta, type AbaDaConta } from "./abas-da-conta";
import { AbaTitulos } from "./aba-titulos";
import { carregarTitulosDaConciliacao } from "./titulos-dados";

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
    /** A aba da conta: `titulos`, ou nada para o Extrato. */
    aba?: string;
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

  // As abas da conta (pedido do Tiago em 02/10/2026): o Extrato, de
  // sempre, e os Títulos — tudo que aguarda baixa, igual para todas as
  // contas. Cada aba é lida só quando está aberta: no Extrato os títulos
  // nem são consultados, e na aba Títulos o extrato também não.
  const aba: AbaDaConta = searchParams.aba === "titulos" ? "titulos" : "extrato";

  const [{ data: contas }, dadosTitulos] = await Promise.all([
    supabase
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
      .returns<ContaBancaria[]>(),
    aba === "titulos"
      ? carregarTitulosDaConciliacao(supabase, session.activeTenant.id)
      : Promise.resolve(null),
  ]);

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
  let detalhesImposto: Record<string, DetalheDoImposto> = {};
  /** De cada lançamento de uma guia de imposto para a linha que o mostra. */
  let linhaDoLancamento = new Map<string, string>();
  let creditos = 0;
  let debitos = 0;

  if (contaId && aba === "extrato") {
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
    //
    // A baixa de uma guia de imposto é UM débito no banco gravado como N
    // lançamentos — um por parte do rateio, mais a multa e os juros (módulo
    // fiscal, entrega 2). A leitura das guias só consulta o banco quando há
    // lançamento `imposto_baixa` no período, e corre junto com a montagem
    // das linhas: as duas só dependem da consulta acima.
    const brutos: unknown[] = data ?? [];
    const idsDasGuias = (brutos as Array<{ id: string; origem: string }>)
      .filter((r) => r.origem === "imposto_baixa")
      .map((r) => r.id);
    const [montadas, lancamentosDasGuias] = await Promise.all([
      montarLinhasDeLancamentos(supabase, session.activeTenant.id, brutos),
      carregarLancamentosDasGuias(supabase, session.activeTenant.id, idsDasGuias),
    ]);
    // Uma linha por guia, na posição do primeiro lançamento dela e com a
    // soma de todos: o saldo acumulado e os totais do período não mudam.
    const comGuias = agruparGuiasDeImposto(montadas, lancamentosDasGuias);
    const semSaldo = comGuias.linhas;
    detalhesImposto = comGuias.detalhes;
    linhaDoLancamento = comGuias.linhaDoLancamento;
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

  // A baixa de um imposto devolve o id de UM dos lançamentos dela para o
  // `&highlight=`; na tela, a guia é uma linha só, com o id de outro.
  const highlight = searchParams.highlight
    ? (linhaDoLancamento.get(searchParams.highlight) ?? searchParams.highlight)
    : undefined;

  return (
    <div className="space-y-6">
      <div>
        <BotaoVoltar reserva="/financeiro/conciliacao" />
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
        <AbasDaConta
          aba={aba}
          totalTitulos={
            dadosTitulos
              ? dadosTitulos.aPagar.length + dadosTitulos.aReceber.length + dadosTitulos.impostos.length
              : null
          }
        >
          {dadosTitulos ? (
            <AbaTitulos
              dados={dadosTitulos}
              contaId={contaId}
              dataDe={dataDe}
              dataAte={dataAte}
            />
          ) : (
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
                highlight={highlight}
                detalhesFatura={detalhesFatura}
                detalhesImposto={detalhesImposto}
                contexto={`${contaId}|${dataDe}|${dataAte}`}
              />
            </>
          )}
        </AbasDaConta>
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
