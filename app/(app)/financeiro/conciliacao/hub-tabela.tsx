"use client";

/**
 * A tabela da página inicial da Conciliação (decisão 091): uma linha por
 * conta, agrupada por empresa contábil.
 *
 * Um só `thead` no topo (os títulos das colunas não se repetem por grupo);
 * cada empresa é um `tbody` com faixa de abertura e linha de subtotal; o
 * `tfoot` fecha o total geral. Client por causa da busca — recebe dados
 * prontos do server component.
 *
 * A coluna Situação é a razão de a lista trazer conta inativa: sem ela a
 * tela seria de contas ativas e a coluna diria sempre a mesma coisa.
 */
import * as React from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { dataCurta, hrefExtrato, TIPO_CONTA_LABEL, type ContaResumo } from "./hub-periodo";

export function HubTabela({
  contas,
  de,
  ate,
  totais,
}: {
  contas: ContaResumo[];
  de: string;
  ate: string;
  totais: {
    saldo: number;
    creditos: number;
    debitos: number;
    lancamentos: number;
    /** Quantas contas ATIVAS entraram no consolidado. */
    contas: number;
  };
}) {
  const [busca, setBusca] = React.useState("");

  const grupos = React.useMemo(() => {
    const q = busca.trim().toLowerCase();
    const filtradas = q
      ? contas.filter(
          (c) =>
            c.nome.toLowerCase().includes(q) ||
            c.banco.toLowerCase().includes(q) ||
            c.empresaContabil.toLowerCase().includes(q),
        )
      : contas;

    const mapa = new Map<string, ContaResumo[]>();
    for (const c of filtradas) {
      const lista = mapa.get(c.empresaContabil) ?? [];
      lista.push(c);
      mapa.set(c.empresaContabil, lista);
    }
    return [...mapa.entries()]
      // Subtotal e total somam só conta ATIVA — é o mesmo critério do card
      // de consolidado. A linha da conta inativa continua na lista, com o
      // saldo dela em cinza, para deixar claro que está fora da conta.
      .map(([empresa, lista]) => {
        const ativas = lista.filter((c) => c.ativa);
        return {
          empresa,
          contas: lista,
          inativas: lista.length - ativas.length,
          saldo: ativas.reduce((a, c) => a + c.saldoAtual, 0),
          creditos: ativas.reduce((a, c) => a + c.creditosPeriodo, 0),
          debitos: ativas.reduce((a, c) => a + c.debitosPeriodo, 0),
          lancamentos: ativas.reduce((a, c) => a + c.lancamentosPeriodo, 0),
        };
      })
      .sort((a, b) => b.saldo - a.saldo || a.empresa.localeCompare(b.empresa));
  }, [contas, busca]);

  const filtrando = busca.trim().length > 0;
  const vistas = grupos.reduce(
    (a, g) => a + g.contas.filter((c) => c.ativa).length,
    0,
  );
  const inativasVistas = grupos.reduce(
    (a, g) => a + g.contas.filter((c) => !c.ativa).length,
    0,
  );
  const saldoInativasVistas = grupos.reduce(
    (a, g) =>
      a + g.contas.filter((c) => !c.ativa).reduce((s, c) => s + c.saldoAtual, 0),
    0,
  );
  const somaVisivel = {
    saldo: grupos.reduce((a, g) => a + g.saldo, 0),
    creditos: grupos.reduce((a, g) => a + g.creditos, 0),
    debitos: grupos.reduce((a, g) => a + g.debitos, 0),
    lancamentos: grupos.reduce((a, g) => a + g.lancamentos, 0),
  };
  const rodape = filtrando ? somaVisivel : totais;

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Buscar por conta, banco ou empresa..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="pl-9"
        />
      </div>

      {grupos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta corresponde à busca.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-border bg-muted/40">
              <tr>
                <th className="min-w-[220px] px-4 py-3 text-left font-medium text-muted-foreground">
                  Conta
                </th>
                <th className="whitespace-nowrap px-3 py-3 text-left font-medium text-muted-foreground">
                  Banco
                </th>
                <th className="w-28 whitespace-nowrap px-3 py-3 text-left font-medium text-muted-foreground">
                  Situação
                </th>
                <th className="w-24 whitespace-nowrap px-3 py-3 text-right font-medium text-muted-foreground">
                  Último mov.
                </th>
                <th className="w-16 px-3 py-3 text-right font-medium text-muted-foreground">
                  Lanç.
                </th>
                <th className="w-36 whitespace-nowrap px-3 py-3 text-right font-medium text-muted-foreground">
                  Entradas
                </th>
                <th className="w-36 whitespace-nowrap px-3 py-3 text-right font-medium text-muted-foreground">
                  Saídas
                </th>
                <th className="w-40 whitespace-nowrap px-4 py-3 text-right font-medium text-muted-foreground">
                  Saldo atual
                </th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>

            {grupos.map((g) => (
              <tbody key={g.empresa}>
                <tr className="border-y border-border bg-muted/20">
                  <td colSpan={7} className="px-4 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                      {g.empresa}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {g.contas.length}{" "}
                      {g.contas.length === 1 ? "conta" : "contas"}
                      {g.inativas > 0 &&
                        ` · ${g.inativas} ${g.inativas === 1 ? "inativa" : "inativas"}`}
                    </span>
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-2 text-right font-mono text-sm font-semibold ${
                      g.saldo < 0 ? "text-california-red" : "text-foreground"
                    }`}
                  >
                    {formatCurrency(g.saldo)}
                  </td>
                  <td />
                </tr>

                {g.contas.map((c) => (
                  <tr
                    key={c.id}
                    className="group relative border-b border-border transition-colors hover:bg-muted/50"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={hrefExtrato(c.id, de, ate)}
                        prefetch={false}
                        className="block whitespace-nowrap font-medium text-foreground after:absolute after:inset-0 group-hover:text-california-red"
                      >
                        {c.nome}
                      </Link>
                      <span className="text-xs text-muted-foreground">
                        {TIPO_CONTA_LABEL[c.tipo] ?? c.tipo}
                        {c.agenciaConta ? ` · ${c.agenciaConta}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                      {c.banco}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.ativa
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            c.ativa ? "bg-emerald-500" : "bg-muted-foreground"
                          }`}
                        />
                        {c.ativa ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-muted-foreground tabular-nums">
                      {dataCurta(c.ultimoMovimento)}
                    </td>
                    <td className="px-3 py-3 text-right text-muted-foreground tabular-nums">
                      {c.lancamentosPeriodo || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {c.creditosPeriodo > 0 ? (
                        <span className="text-emerald-700">
                          {formatCurrency(c.creditosPeriodo)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {c.debitosPeriodo > 0 ? (
                        <span className="text-california-red">
                          {formatCurrency(c.debitosPeriodo)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-mono font-semibold tabular-nums ${
                        !c.ativa
                          ? "text-muted-foreground"
                          : c.saldoAtual < 0
                            ? "text-california-red"
                            : "text-foreground"
                      }`}
                      title={
                        c.ativa
                          ? undefined
                          : "Conta inativa — fora do saldo consolidado"
                      }
                    >
                      {formatCurrency(c.saldoAtual)}
                    </td>
                    <td className="px-2 py-3 text-right">
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-california-red" />
                    </td>
                  </tr>
                ))}

                <tr className="border-b border-border bg-muted/10 text-xs">
                  <td className="px-4 py-2 font-medium" colSpan={4}>
                    Subtotal · {g.empresa}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                    {g.lancamentos || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-emerald-700 tabular-nums">
                    {g.creditos > 0 ? formatCurrency(g.creditos) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-california-red tabular-nums">
                    {g.debitos > 0 ? formatCurrency(g.debitos) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-sm font-semibold tabular-nums">
                    {formatCurrency(g.saldo)}
                  </td>
                  <td />
                </tr>
              </tbody>
            ))}

            <tfoot className="border-t-2 border-border bg-muted/30">
              <tr>
                <td className="px-4 py-3 font-semibold" colSpan={4}>
                  {filtrando
                    ? `Total do filtro · ${vistas} ${vistas === 1 ? "conta ativa" : "contas ativas"}`
                    : `Total geral · ${totais.contas} contas ativas`}
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums">
                  {rodape.lancamentos || "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-emerald-700 tabular-nums">
                  {formatCurrency(rodape.creditos)}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right font-medium text-california-red tabular-nums">
                  {formatCurrency(rodape.debitos)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-bold tabular-nums">
                  {formatCurrency(rodape.saldo)}
                </td>
                <td />
              </tr>
              {inativasVistas > 0 && (
                <tr className="text-[11px] text-muted-foreground">
                  <td className="px-4 pb-3" colSpan={7}>
                    Fora do total: {inativasVistas}{" "}
                    {inativasVistas === 1 ? "conta inativa" : "contas inativas"}
                    , com {formatCurrency(saldoInativasVistas)} em saldo.
                  </td>
                  <td className="whitespace-nowrap px-4 pb-3 text-right font-mono">
                    {formatCurrency(saldoInativasVistas)}
                  </td>
                  <td />
                </tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
