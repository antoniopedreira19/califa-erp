import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Calculator, FolderKanban } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { competenciaLabel } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";
import { carregarProjetoFinanceiro } from "@/lib/data/projetos-financeiro";
import { SITUACAO_META } from "../../abertura-de-job/situacao-faturamento";

export const dynamic = "force-dynamic";

/**
 * A visão agregada do projeto NO FINANCEIRO.
 *
 * Rota própria do módulo, e não a tela de projeto da produção
 * (`/jobs/projeto/[id]`): o financeiro não encaminha para telas de outros
 * módulos (decisão do Tiago, 20/08/2026). E não daria para reusar aquela
 * mesmo querendo — lá o agrupamento é por `jobs.projeto_id`, e aqui é
 * pelo projeto do financeiro, que pode juntar jobs que na produção estão
 * em projetos diferentes.
 *
 * ---------------------------------------------------------------------
 * A margem
 * ---------------------------------------------------------------------
 *
 * `faturamento previsto − custo previsto`, e NÃO `valor total − custo`,
 * que é o que o protótipo desenhava. O valor total inclui o que o cliente
 * paga direto ao fornecedor (tipos A/D) e esse dinheiro nunca passa pelo
 * caixa da California (decisão 004) — somá-lo na margem inflaria o
 * resultado do projeto. Em PEVETE-0001/26 a diferença entre as duas
 * contas era de R$ 88.000 em três jobs. É a mesma conta da "Margem
 * prevista" do formulário de abertura, e é o que o próprio subtítulo do
 * protótipo diz: "valor faturável × custo previsto".
 */
export default async function ProjetoNoFinanceiroPage({
  params,
}: {
  params: { projetoId: string };
}) {
  const session = await requireSession();
  if (
    session.activeRole !== "administrador" &&
    session.activeRole !== "financeiro"
  ) {
    redirect("/home?reason=sem_permissao_financeira");
  }

  const projeto = await carregarProjetoFinanceiro(
    session.activeTenant.id,
    params.projetoId,
  );
  if (!projeto) notFound();

  const cards = [
    { rotulo: "Cliente", valor: projeto.cliente_nome ?? "—", mono: false },
    {
      rotulo: "Jobs no financeiro",
      valor: String(projeto.jobsNoFinanceiro),
      mono: true,
    },
    { rotulo: "Valor total", valor: formatCurrency(projeto.totalValor), mono: true },
    {
      rotulo: "Faturados",
      valor: `${projeto.faturados} de ${projeto.jobsNoFinanceiro}`,
      mono: true,
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/financeiro/abertura-de-job"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Voltar para Visualizar Jobs
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="rounded-lg bg-california-red/10 p-2">
            <FolderKanban className="h-5 w-5 text-california-red" />
          </div>
          <div>
            <p className="font-mono text-xs font-semibold text-muted-foreground">
              {projeto.codigo}
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              {projeto.nome}
            </h1>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.rotulo}
            className="rounded-2xl border border-border bg-card px-[18px] py-4 shadow-soft"
          >
            <p className="text-[10px] font-bold uppercase tracking-[0.09em] text-muted-foreground">
              {c.rotulo}
            </p>
            <p
              className={cn(
                "mt-1.5 truncate text-lg font-bold",
                c.mono && "font-mono",
              )}
            >
              {c.valor}
            </p>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/50 px-5 py-3.5">
          <Calculator className="h-4 w-4 text-california-red" />
          <h2 className="text-[15px] font-semibold">Jobs do projeto</h2>
          <span className="text-xs text-muted-foreground">
            Valor faturável × custo previsto no financeiro
          </span>
        </header>

        {projeto.jobs.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nenhum job neste projeto do financeiro.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
                  <th className="px-5 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 font-semibold">Competência</th>
                  <th className="px-4 py-3 font-semibold">Faturamento</th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Valor total
                  </th>
                  {/* Coluna a mais do que o protótipo, de propósito: a
                      margem passou a sair do faturável, e sem ele na tela
                      a subtração não fecha aos olhos de quem lê. */}
                  <th className="px-4 py-3 text-right font-semibold">
                    Faturável
                  </th>
                  <th className="px-4 py-3 text-right font-semibold">
                    Custo previsto
                  </th>
                  <th className="px-5 py-3 text-right font-semibold">Margem</th>
                </tr>
              </thead>
              <tbody>
                {projeto.jobs.map((j) => {
                  const meta = SITUACAO_META[j.situacao_faturamento];
                  // Sem curva de desembolso não há margem: o job ainda
                  // não passou pela abertura. Tratar o custo como zero
                  // faria a linha afirmar margem de 100%.
                  const margem =
                    j.custo_previsto === null
                      ? null
                      : j.faturamento_previsto - j.custo_previsto;

                  return (
                    <tr
                      key={j.id}
                      className={cn(
                        "border-b border-b-[#f4f2f2] transition-colors last:border-0 hover:bg-muted/60",
                        // Job que ainda aguarda abertura aparece, mas não
                        // soma: fica apagado para a leitura de relance não
                        // confundir os números dele com os do total.
                        !j.aberto_no_financeiro && "bg-muted/30 text-muted-foreground",
                      )}
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/financeiro/jobs/${j.id}`}
                          prefetch={false}
                          className="flex flex-col gap-0.5"
                        >
                          <span className="font-mono text-[11px] font-semibold text-[#b3323c]">
                            {j.codigo}
                          </span>
                          <span className="font-medium">{j.nome}</span>
                        </Link>
                        {!j.aberto_no_financeiro && (
                          <span className="mt-1 inline-flex w-fit items-center whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-amber-700">
                            Aguarda abertura · não soma
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[12.5px] text-muted-foreground">
                        {competenciaLabel(
                          j.competencia_trimestre,
                          j.competencia_ano,
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                            meta.classes,
                          )}
                        >
                          {meta.rotulo}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">
                        {formatCurrency(j.valor_total)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums">
                        {formatCurrency(j.faturamento_previsto)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-[#1e4fa3]">
                        {/* Job que ainda não passou pela abertura não tem
                            curva — travessão, e não R$ 0,00, que leria
                            como "não vai custar nada". */}
                        {j.custo_previsto === null
                          ? "—"
                          : formatCurrency(j.custo_previsto)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-5 py-3 text-right font-mono font-semibold tabular-nums",
                          margem === null
                            ? "text-muted-foreground"
                            : margem >= 0
                              ? "text-emerald-700"
                              : "text-[#b3323c]",
                        )}
                      >
                        {margem === null ? "—" : formatCurrency(margem)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td
                    colSpan={3}
                    className="border-t-2 border-foreground px-5 py-3.5 text-[13px] font-bold"
                  >
                    Total do projeto
                  </td>
                  <td className="whitespace-nowrap border-t-2 border-foreground px-4 py-3.5 text-right font-mono text-sm font-bold tabular-nums">
                    {formatCurrency(projeto.totalValor)}
                  </td>
                  <td className="whitespace-nowrap border-t-2 border-foreground px-4 py-3.5 text-right font-mono text-sm font-bold tabular-nums">
                    {formatCurrency(projeto.totalFaturamento)}
                  </td>
                  <td className="whitespace-nowrap border-t-2 border-foreground px-4 py-3.5 text-right font-mono text-sm font-bold tabular-nums text-[#1e4fa3]">
                    {formatCurrency(projeto.totalCusto)}
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap border-t-2 border-foreground px-5 py-3.5 text-right font-mono text-sm font-bold tabular-nums",
                      projeto.totalMargem >= 0
                        ? "text-emerald-700"
                        : "text-[#b3323c]",
                    )}
                  >
                    {formatCurrency(projeto.totalMargem)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Job que aguarda abertura não tem linha no fluxo de caixa: nem
            previsão de recebimento, nem curva — as duas nascem na
            abertura. Por isso ele aparece aqui mas fica fora de todos os
            totais, e a nota diz isso em vez de deixar a diferença entre a
            lista e a soma sem explicação. */}
        {projeto.aguardandoAbertura > 0 && (
          <p className="border-t border-border px-5 py-3 text-[11.5px] text-muted-foreground">
            {projeto.aguardandoAbertura === 1
              ? "1 job ainda aguarda abertura no financeiro"
              : `${projeto.aguardandoAbertura} jobs ainda aguardam abertura no financeiro`}
            {" "}— aparece na lista, mas fica fora dos totais: sem abertura não
            há previsão de recebimento nem curva de desembolso, e nada dele
            entra no fluxo de caixa.
          </p>
        )}
      </section>
    </div>
  );
}
