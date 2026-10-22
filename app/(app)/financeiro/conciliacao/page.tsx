import Link from "next/link";
import { AlertTriangle, Receipt } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import type { ContaBancaria } from "@/lib/types";
import {
  SELECT_LANCAMENTO_LINHA,
  montarLinhasDeLancamentos,
} from "@/lib/data/lancamento-linha";
import { carregarExtratoDaFatura } from "@/lib/data/fatura-cartao-extrato";
import { itensDoExtratoDaFatura } from "@/lib/data/planilha-de-titulos";
import { juntarJurosNaBaixa } from "@/lib/financeiro/juros-no-extrato";
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
import { ConciliacaoList, type MarcasDoBanco } from "./conciliacao-list";
import { HubConciliacao } from "./hub";
import { lerPeriodo, lerVisao } from "./hub-periodo";
import { BotaoVoltar } from "@/components/voltar/botao-voltar";
import { AbasDaConta, type AbaDaConta } from "./abas-da-conta";
import { AbaTitulos } from "./aba-titulos";
import { AbaBanco } from "./aba-banco";
import { carregarTitulosDaConciliacao } from "./titulos-dados";
import { carregarBancoDaConciliacao } from "./banco-dados";
import { carregarFechamentoDaConciliacao } from "./fechamento-dados";
import { FaixaDoFechamento } from "./fechamento";
import { alertasDoExtrato } from "./motor-da-conta";
import { hojeEmSaoPauloIso } from "@/lib/calculos/janelas-pagamento";
import { fimDoMes, somaDias, type ItemDaFatura } from "@/lib/financeiro/planilha-de-titulos";

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
    /** Na lista: `teste` mostra só as empresas de teste. */
    visao?: string;
    /** A aba da conta: `titulos`, `banco`, ou nada para o Extrato. */
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
        visao={lerVisao(searchParams.visao)}
      />
    );
  }

  // As abas da conta (pedido do Tiago em 02/10/2026): o Extrato, de
  // sempre, os Títulos — tudo que aguarda baixa, igual para todas as
  // contas — e a Conciliação automática, com o extrato importado do banco
  // (task 029, fase 3). Cada aba é lida só quando está aberta: no Extrato
  // os títulos nem são consultados, e na aba Títulos o extrato também não.
  // A Conciliação automática lê os títulos (o motor os procura) e o
  // extrato importado.
  const aba: AbaDaConta =
    searchParams.aba === "titulos" ? "titulos" : searchParams.aba === "banco" ? "banco" : "extrato";

  // "Hoje" é o dia de Brasília (o servidor e o banco rodam em UTC).
  const hojeBr = hojeEmSaoPauloIso();

  // Default: o mês corrente, pelo dia de Brasília. O `toISOString` de antes
  // dava o dia em UTC e, à noite, podia pular para o mês seguinte.
  const dataDe = searchParams.de ?? `${hojeBr.slice(0, 8)}01`;
  const dataAte = searchParams.ate ?? fimDoMes(hojeBr);

  const [{ data: contas }, dadosTitulos, saldoDeHoje, dadosBanco, fechamento] = await Promise.all([
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
    aba === "titulos" || aba === "banco"
      ? carregarTitulosDaConciliacao(supabase, session.activeTenant.id)
      : Promise.resolve(null),
    // O saldo da conta no fim de hoje: o ponto de partida do saldo previsto
    // da aba Títulos (decisão 195).
    aba === "titulos"
      ? calcularSaldoAnterior(supabase, {
          tenantId: session.activeTenant.id,
          contaId,
          dataDe: somaDias(hojeBr, 1),
        }).then((s) => s.saldoAnterior)
      : Promise.resolve(0),
    // O extrato importado do banco: as linhas pendentes de qualquer data e
    // as resolvidas do período aberto (decisão 199). As três abas o leem: o
    // Extrato para as marcas da coluna Banco e os Títulos para o sinal do
    // título que já está no banco (decisão 202).
    carregarBancoDaConciliacao(supabase, {
      tenantId: session.activeTenant.id,
      contaId,
      dataDe,
      dataAte,
    }),
    // O fechamento da conciliação (decisão 205): a faixa das três abas, o
    // cadeado do Extrato e, na Conciliação automática, as condições do botão
    // de fechar.
    carregarFechamentoDaConciliacao(supabase, {
      tenantId: session.activeTenant.id,
      contaId,
      comCondicoes: aba === "banco",
    }),
  ]);

  const listaContas = contas ?? [];

  let saldoAnterior = 0;
  let linhas: ReturnType<typeof derivarSaldo> = [];
  const itensDasFaturas: Record<string, ItemDaFatura[]> = {};
  let detalhesImposto: Record<string, DetalheDoImposto> = {};
  /** De cada lançamento de uma guia de imposto para a linha que o mostra. */
  let linhaDoLancamento = new Map<string, string>();
  /** A baixa com juros e multa (decisão 196): os juros que cada linha inclui. */
  let jurosDasBaixas: Record<string, number> = {};
  let creditos = 0;
  let debitos = 0;
  /** As marcas da coluna Banco (decisão 202); `null` sem extrato importado. */
  let marcasDoBanco: MarcasDoBanco | null = null;

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
    const [montadas, lancamentosDasGuias, conciliadosRes] = await Promise.all([
      montarLinhasDeLancamentos(supabase, session.activeTenant.id, brutos),
      carregarLancamentosDasGuias(supabase, session.activeTenant.id, idsDasGuias),
      // Os lançamentos do período já ligados a uma linha do extrato do banco
      // (o ✓ da coluna Banco). Só com extrato importado.
      dadosBanco.ultima
        ? supabase
            .from("lancamentos_financeiros")
            .select("id")
            .eq("tenant_id", session.activeTenant.id)
            .eq("conta_bancaria_id", contaId)
            .gte("data_movimento", dataDe)
            .lte("data_movimento", dataAte)
            .not("extrato_linha_id", "is", null)
            .returns<Array<{ id: string }>>()
        : Promise.resolve({ data: [] as Array<{ id: string }>, error: null }),
    ]);
    if (conciliadosRes.error) console.error("[conciliacao.conciliados]", conciliadosRes.error.message);
    // Uma linha por guia, na posição do primeiro lançamento dela e com a
    // soma de todos: o saldo acumulado e os totais do período não mudam.
    const comGuias = agruparGuiasDeImposto(montadas, lancamentosDasGuias);
    // A baixa e os juros dela também são um débito só no banco (decisão
    // 196): uma linha, com a soma, e "inclui R$ X de juros".
    const comJuros = juntarJurosNaBaixa(comGuias.linhas);
    const semSaldo = comJuros.linhas;
    detalhesImposto = comGuias.detalhes;
    jurosDasBaixas = comJuros.juros;
    linhaDoLancamento = new Map([...comGuias.linhaDoLancamento, ...comJuros.linhaDoLancamento]);
    linhas = derivarSaldo(semSaldo, saldoAnterior);

    // O pagamento de uma fatura de cartão abre nos itens, cada um com o
    // centro de custo dele (decisão 195; antes, em dois níveis, decisão 093).
    // Só a perna do BANCO (esta conta) e só o pagamento vivo: o estorno é a
    // linha reversa, e não se expande. Uma leitura por fatura paga no período.
    const pagamentos = semSaldo.filter(
      (l) => l.papel_na_fatura === "pagamento" && l.fatura_cartao_id !== null,
    );
    const faturaIds = [...new Set(pagamentos.map((l) => l.fatura_cartao_id as string))];
    const extratos = await Promise.all(
      faturaIds.map((id) =>
        carregarExtratoDaFatura(supabase, session.activeTenant.id, id),
      ),
    );
    const itensPorFatura = new Map<string, ItemDaFatura[]>();
    extratos.forEach((e, i) => {
      if (e) itensPorFatura.set(faturaIds[i], itensDoExtratoDaFatura(e));
    });
    for (const l of pagamentos) {
      const itens = itensPorFatura.get(l.fatura_cartao_id as string);
      if (itens) itensDasFaturas[l.id] = itens;
    }
    creditos = linhas.reduce((acc, l) => acc + l.credito, 0);
    debitos = linhas.reduce((acc, l) => acc + l.debito, 0);

    if (dadosBanco.ultima) {
      let alertas: Record<string, string> = {};
      try {
        alertas = alertasDoExtrato(dadosBanco, contaId, hojeBr);
      } catch (e) {
        // Sem o ⚠, o Extrato continua de pé; a Conciliação automática avisa.
        console.error("[conciliacao.alertas]", e);
      }
      marcasDoBanco = {
        conciliados: (conciliadosRes.data ?? []).map((r) => r.id),
        alertas,
        fechadoAte: fechamento.ativo?.ate ?? null,
      };
    }
  }
  const lancamentosQueNaoBatem = marcasDoBanco
    ? linhas.filter((l) => marcasDoBanco?.alertas[l.id]).length
    : 0;

  const saldoFinal = saldoAnterior + creditos - debitos;
  const contaAberta = listaContas.find((c) => c.id === contaId);

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
        <FaixaDoFechamento
          contaId={contaId}
          contaNome={contaAberta?.nome ?? "Conta"}
          bancoNome={contaAberta?.banco ?? ""}
          fechamento={fechamento}
        />
      )}

      {contaId && (
        <AbasDaConta
          aba={aba}
          totalTitulos={
            dadosTitulos && aba === "titulos"
              ? dadosTitulos.aPagar.length + dadosTitulos.aReceber.length + dadosTitulos.impostos.length
              : null
          }
          pendentesNoBanco={
            dadosBanco.ultima ? dadosBanco.linhas.filter((l) => !l.conciliada && !l.ignorada).length : "novo"
          }
        >
          {aba === "banco" && dadosTitulos ? (
            <AbaBanco banco={dadosBanco} dados={dadosTitulos} contaId={contaId} fechamento={fechamento} />
          ) : dadosTitulos ? (
            <AbaTitulos
              dados={dadosTitulos}
              contaId={contaId}
              nomeDaConta={contaAberta?.nome ?? "Conta"}
              saldoHoje={saldoDeHoje}
              dataDe={dataDe}
              dataAte={dataAte}
              banco={dadosBanco}
            />
          ) : (
            <>
              {lancamentosQueNaoBatem > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-900">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-california-red" />
                  <span className="flex-1">
                    <strong>
                      {lancamentosQueNaoBatem === 1
                        ? "1 lançamento não bate"
                        : `${lancamentosQueNaoBatem} lançamentos não batem`}
                    </strong>{" "}
                    com o extrato do banco importado: {lancamentosQueNaoBatem === 1 ? "está marcado" : "estão marcados"} com
                    ⚠ na coluna Banco. A conciliação não fecha até a correção.
                  </span>
                  <Link
                    href={`/financeiro/conciliacao?conta=${contaId}&aba=banco`}
                    prefetch={false}
                    className="rounded-lg bg-california-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-california-red-hover"
                  >
                    Corrigir na Conciliação automática
                  </Link>
                </div>
              )}
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
                itensDasFaturas={itensDasFaturas}
                detalhesImposto={detalhesImposto}
                jurosDasBaixas={jurosDasBaixas}
                contexto={`${contaId}|${dataDe}|${dataAte}`}
                contaId={contaId}
                banco={marcasDoBanco}
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
