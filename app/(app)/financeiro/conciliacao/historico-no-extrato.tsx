import Link from "next/link";
import { History, Info } from "lucide-react";
import { colunasDoExtratoNaGrade } from "@/components/financeiro/planilha-de-titulos/colunas";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { siglaDaRegional, trimestreDe } from "@/lib/financeiro/planilha-de-titulos";
import { cn } from "@/lib/utils";
import type { HistoricoDoExtrato, LinhaDoHistorico } from "./historico-dados";

/**
 * O histórico da planilha no Extrato da conta (decisão 211, A3): o pedaço do
 * período antes de a conta começar no sistema, só para leitura, na mesma
 * grade do Extrato (decisão 195) e com os mesmos quatro cartões. O saldo
 * parte da abertura da carga mais antiga e soma os movimentos da planilha.
 *
 * Sem ação nenhuma: o histórico não se concilia nem se corrige por aqui, e as
 * dicas são o `title` do navegador — num mês da conta principal são mais de
 * mil linhas. O ⓘ diz de onde a linha veio: a aba e a linha da planilha, o
 * Tipo e o Cod.
 */
export function HistoricoNoExtrato({
  historico,
  saldoInicial,
  continuaNoSistema,
}: {
  historico: HistoricoDoExtrato & { periodo: NonNullable<HistoricoDoExtrato["periodo"]> };
  /** O saldo inicial da conta no sistema, para a nota da virada. */
  saldoInicial: number;
  /** O período escolhido passa do início da conta: os lançamentos do sistema vêm embaixo. */
  continuaNoSistema: boolean;
}) {
  const { periodo, cobertura, corte, linhas } = historico;
  const saldoFinal = r2(historico.saldoAnterior + historico.creditos - historico.debitos);
  const grade = colunasDoExtratoNaGrade();
  const semCargaDepois = cobertura && cobertura.ate < periodo.ate ? cobertura.ate : null;

  return (
    <section className="space-y-3" aria-label="Histórico da planilha">
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
        <p>
          <strong className="text-foreground">Histórico da planilha</strong>, só para leitura, de {formatDiaBr(periodo.de)} a{" "}
          {formatDiaBr(periodo.ate)}. A conta começa no sistema em {formatDiaBr(corte)}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cartao rotulo="Saldo anterior" valor={historico.saldoAnterior} tom="neutro" />
        <Cartao rotulo="Créditos no período" valor={historico.creditos} tom="entrada" />
        <Cartao rotulo="Débitos no período" valor={historico.debitos} tom="saida" />
        <Cartao rotulo="Saldo final" valor={saldoFinal} tom="destaque" />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1480px] table-fixed text-sm">
          <colgroup>
            {grade.map(([k, w]) => (
              <col key={k} style={w ? { width: w } : undefined} />
            ))}
          </colgroup>
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-3 text-left font-semibold">Data</th>
              <th className="px-3 py-3 text-right font-semibold">Crédito</th>
              <th className="px-3 py-3 text-right font-semibold">Débito</th>
              <th className="px-3 py-3 text-right font-semibold">Saldo</th>
              <th className="px-3 py-3 text-left font-semibold">Descrição</th>
              <th className="px-3 py-3 text-left font-semibold">Fornecedor</th>
              <th className="px-3 py-3 text-left font-semibold">Job</th>
              <th className="px-3 py-3 text-left font-semibold">Centro de Custo</th>
              <th className="px-3 py-3 text-center font-semibold" title="Trimestre de competência, como a planilha anotou">
                TRI
              </th>
              <th className="px-3 py-3 text-left font-semibold">Empresa</th>
              <th className="px-3 py-3 text-left font-semibold">REG</th>
              <th className="px-2 py-3 text-center" aria-label="Origem na planilha" />
            </tr>
          </thead>
          <tbody>
            {linhas.length === 0 ? (
              <tr>
                <td colSpan={grade.length} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  Nenhum movimento da planilha nesse período.
                </td>
              </tr>
            ) : (
              linhas.map((l) => <Linha key={l.id} l={l} />)
            )}
          </tbody>
        </table>
      </div>

      {historico.total > linhas.length && (
        <p className="text-xs text-muted-foreground">
          Aparecem as primeiras {numero(linhas.length)} das {numero(historico.total)} linhas do período; os cartões valem para
          todas. Vá mês a mês pelas setas do filtro para ver o resto.
        </p>
      )}
      {semCargaDepois && (
        <p className="text-xs text-muted-foreground">
          O histórico carregado desta conta vai até {formatDiaBr(semCargaDepois)}: depois disso, ainda não há carga da planilha.
        </p>
      )}
      {continuaNoSistema && (
        <p className="text-xs text-muted-foreground">
          O histórico termina com {dinheiro(saldoFinal)}. A conta começa no sistema em {formatDiaBr(corte)}, com saldo inicial de{" "}
          {dinheiro(saldoInicial)}: os lançamentos do sistema vêm abaixo.
        </p>
      )}
    </section>
  );
}

/**
 * Sem histórico no período escolhido, mas com histórico na conta: o caminho
 * até ele, no primeiro e no último mês que a planilha cobre.
 */
export function AvisoDoHistorico({ historico, contaId }: { historico: HistoricoDoExtrato; contaId: string }) {
  const { cobertura, corte } = historico;
  if (!cobertura || historico.periodo) return null;
  const primeiro = mesDe(cobertura.de);
  const ultimo = mesDe(cobertura.ate);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
      <History className="h-4 w-4 shrink-0 text-foreground" />
      <span>
        Esta conta tem histórico da planilha de {formatDiaBr(cobertura.de)} a {formatDiaBr(cobertura.ate)}, antes de começar no
        sistema em {formatDiaBr(corte)}.
      </span>
      <Link
        href={`/financeiro/conciliacao?conta=${contaId}&de=${primeiro.de}&ate=${primeiro.ate}`}
        prefetch={false}
        className="font-semibold text-california-red hover:underline"
      >
        Ver o primeiro mês
      </Link>
      <Link
        href={`/financeiro/conciliacao?conta=${contaId}&de=${ultimo.de}&ate=${ultimo.ate}`}
        prefetch={false}
        className="font-semibold text-california-red hover:underline"
      >
        Ver o último mês
      </Link>
    </div>
  );
}

function Linha({ l }: { l: LinhaDoHistorico }) {
  const centro = l.tipoCodigo ? `${l.tipoCodigo} · ${l.tipoNome}` : null;
  const origem = [
    `Planilha: aba ${l.aba}, linha ${l.linha}`,
    l.tipoPlanilha ? `Tipo ${l.tipoPlanilha}` : null,
    l.cod ? `Cod ${l.cod}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/30">
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{formatDiaBr(l.data)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">
        {l.credito > 0 ? dinheiro(l.credito) : ""}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">
        {l.debito > 0 ? dinheiro(l.debito) : ""}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs font-semibold">{dinheiro(l.saldo)}</td>
      <td className="px-3 py-2 text-xs">
        <span className="break-words">{l.descricao ?? <span className="text-muted-foreground">—</span>}</span>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="block truncate" title={l.fornecedor ?? undefined}>
          {l.fornecedor ?? <span className="text-muted-foreground">—</span>}
        </span>
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="block truncate" title={l.job ?? undefined}>
          {l.job ?? <span className="text-muted-foreground">—</span>}
        </span>
      </td>
      <td className="px-3 py-2 text-xs">
        {l.classe === "transferencia" ? (
          <span className="block truncate italic text-muted-foreground" title="Transferência entre contas · fora do DRE">
            Fora do DRE
          </span>
        ) : centro ? (
          <span className="block truncate" title={l.subtipoNome ? `${centro} · ${l.subtipoNome}` : centro}>
            {centro}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td
        className="whitespace-nowrap px-3 py-2 text-center font-mono text-xs text-muted-foreground"
        title={l.competencia ? `Competência ${l.competencia.trimestre}T ${l.competencia.ano}` : "Sem competência: o trimestre da data"}
      >
        {l.competencia
          ? // Competência de outro ano (a receita de 2023 que entrou em 2024) leva o ano.
            `T${l.competencia.trimestre}${String(l.competencia.ano) === l.data.slice(0, 4) ? "" : `/${String(l.competencia.ano).slice(2)}`}`
          : trimestreDe(l.data)}
      </td>
      <td className="px-3 py-2 text-xs">
        <span className="block truncate" title={l.empresa ?? undefined}>
          {l.empresa ?? <span className="text-muted-foreground">—</span>}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">
        {l.todas ? (
          <span title="Todas as regionais: o rateio fica no relatório por regional">TD</span>
        ) : l.regional ? (
          <span title={l.regional}>{siglaDaRegional(l.regional)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-center">
        <span className="inline-flex text-muted-foreground" title={origem} aria-label={origem}>
          <Info className="h-3.5 w-3.5" />
        </span>
      </td>
    </tr>
  );
}

function Cartao({ rotulo, valor, tom }: { rotulo: string; valor: number; tom: "neutro" | "entrada" | "saida" | "destaque" }) {
  const cor =
    tom === "destaque"
      ? valor >= 0
        ? "text-emerald-700"
        : "text-california-red"
      : tom === "entrada"
        ? "text-emerald-700"
        : tom === "saida"
          ? "text-california-red"
          : "text-muted-foreground";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", cor)}>{dinheiro(valor)}</p>
    </div>
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const numero = (n: number) => n.toLocaleString("pt-BR");
const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O mês da data, do primeiro ao último dia. */
function mesDe(data: string): { de: string; ate: string } {
  const [ano, mes] = data.split("-").map(Number);
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, "0");
  return { de: `${ano}-${mm}-01`, ate: `${ano}-${mm}-${String(ultimo).padStart(2, "0")}` };
}
