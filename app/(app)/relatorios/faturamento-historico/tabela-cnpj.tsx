import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LinhaDoCnpj, NotaDoHistorico } from "@/lib/historico-financeiro/faturamento";
import { formatDiaBr } from "@/lib/formatar-data-hora";
import { Valor } from "../_historico/filtros";

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const LARGURA_DO_MES = 112;
const LARGURA_DO_TOTAL = 132;

function AReceber({ valor, destaque }: { valor: number; destaque: boolean }) {
  if (!destaque || valor <= 0) return <Valor valor={valor} />;
  return (
    <span className="font-semibold text-california-red">
      <Valor valor={valor} />
    </span>
  );
}

/**
 * O faturamento por CNPJ emissor, como as abas de Faturamento da planilha: o
 * valor emitido em cada mês, pela data de emissão, e o faturado, o recebido e
 * o a receber do ano. Cada CNPJ abre a lista das notas dele.
 */
export function TabelaPorCnpj({
  linhas,
  total,
  hrefDoCnpj,
}: {
  linhas: LinhaDoCnpj[];
  total: LinhaDoCnpj;
  hrefDoCnpj: (estabelecimento: string) => string;
}) {
  const linha = (l: LinhaDoCnpj, ehTotal: boolean) => (
    <tr key={l.estabelecimento} className={cn(ehTotal && "bg-muted/30 font-semibold")}>
      <td className="sticky left-0 z-10 bg-card px-4 py-2.5">
        {ehTotal ? (
          <span>
            Total <span className="font-normal text-muted-foreground">· {l.notas} {l.notas === 1 ? "nota" : "notas"}</span>
          </span>
        ) : (
          <>
            <Link href={hrefDoCnpj(l.estabelecimento)} prefetch={false} className="block truncate font-medium text-foreground hover:text-california-red hover:underline" title={l.estabelecimento}>
              {l.rotulo}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {l.notas} {l.notas === 1 ? "nota" : "notas"}
              {l.foraDeJob > 0 && (
                <>
                  {" "}· inclui <Valor valor={l.foraDeJob} /> fora de job
                </>
              )}
            </p>
          </>
        )}
        {ehTotal && l.foraDeJob > 0 && (
          <p className="text-xs font-normal text-muted-foreground">
            inclui <Valor valor={l.foraDeJob} /> fora de job
          </p>
        )}
      </td>
      {l.meses.map((v, i) => (
        <td key={i} className="px-2 py-2.5 text-right font-mono text-xs">
          <Valor valor={v} />
        </td>
      ))}
      <td className="px-3 py-2.5 text-right font-mono font-semibold">
        <Valor valor={l.faturado} />
      </td>
      <td className="px-3 py-2.5 text-right font-mono">
        <Valor valor={l.recebido} />
      </td>
      <td className="px-3 py-2.5 text-right font-mono">
        <AReceber valor={l.aReceber} destaque={!ehTotal} />
      </td>
    </tr>
  );
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full table-fixed text-sm" style={{ minWidth: 240 + 12 * LARGURA_DO_MES + 3 * LARGURA_DO_TOTAL }}>
        <colgroup>
          <col style={{ width: 240 }} />
          {MESES.map((m) => (
            <col key={m} style={{ width: LARGURA_DO_MES }} />
          ))}
          <col style={{ width: LARGURA_DO_TOTAL }} />
          <col style={{ width: LARGURA_DO_TOTAL }} />
          <col style={{ width: LARGURA_DO_TOTAL }} />
        </colgroup>
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-10 bg-muted px-4 py-3 text-left font-semibold">CNPJ emissor</th>
            {MESES.map((m) => (
              <th key={m} className="px-2 py-3 text-right font-semibold" title="O valor das notas emitidas no mês">
                {m}
              </th>
            ))}
            <th className="px-3 py-3 text-right font-semibold" title="O valor das notas emitidas no ano">Faturado</th>
            <th className="px-3 py-3 text-right font-semibold" title="O valor das notas com data de recebimento na planilha">Recebido</th>
            <th className="px-3 py-3 text-right font-semibold" title="O valor das notas sem data de recebimento">A receber</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {linha(total, true)}
          {linhas.map((l) => linha(l, false))}
        </tbody>
      </table>
    </div>
  );
}

const ROTULO_DA_CLASSE: Record<string, string> = { "sem job": "Sem job", "distribuição de lucro": "Distribuição de lucro" };

const dia = (d: string | null) => (d ? formatDiaBr(d) : "—");

/** As notas emitidas de um CNPJ no ano, na ordem da emissão, como a aba de Faturamento. */
export function ListaDeNotas({ notas }: { notas: NotaDoHistorico[] }) {
  const larguras = [88, 0, 220, 104, 104, 112, 136, 120];
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full table-fixed text-sm" style={{ minWidth: 1260 }}>
        <colgroup>
          {larguras.map((w, i) => (
            <col key={i} style={w ? { width: w } : undefined} />
          ))}
        </colgroup>
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-3 text-left font-semibold">NF</th>
            <th className="px-3 py-3 text-left font-semibold">Job</th>
            <th className="px-3 py-3 text-left font-semibold">Cliente</th>
            <th className="px-3 py-3 text-center font-semibold">Emissão</th>
            <th className="px-3 py-3 text-center font-semibold">Vencimento</th>
            <th className="px-3 py-3 text-center font-semibold">Recebimento</th>
            <th className="px-3 py-3 text-right font-semibold">Valor</th>
            <th className="px-3 py-3 text-right font-semibold" title="Total Impostos da nota">Impostos</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {notas.map((n) => (
            <tr key={`${n.aba}:${n.linha}`}>
              <td className="px-3 py-2 font-mono text-xs">{n.numero}</td>
              <td className="px-3 py-2">
                <p className="truncate" title={n.job ?? undefined}>
                  {n.job ?? "—"}
                </p>
                {n.classe !== "job" && <p className="text-xs text-muted-foreground">{ROTULO_DA_CLASSE[n.classe] ?? n.classe}</p>}
              </td>
              <td className="px-3 py-2">
                <p className="truncate" title={n.cliente ?? undefined}>
                  {n.cliente ?? "—"}
                </p>
              </td>
              <td className="px-3 py-2 text-center">{dia(n.emissao)}</td>
              <td className="px-3 py-2 text-center text-muted-foreground">{dia(n.vencimento)}</td>
              <td className={cn("px-3 py-2 text-center", !n.recebimento && "font-semibold text-california-red")}>
                {n.recebimento ? dia(n.recebimento) : "A receber"}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                <Valor valor={n.valor} />
              </td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                <Valor valor={n.impostos} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
