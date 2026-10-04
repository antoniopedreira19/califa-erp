"use client";

/**
 * A aba Apuração da seção Fiscal (módulo fiscal, entrega 2 — protótipo
 * aprovado pelo Tiago em 02/10/2026, `telas/apuracao.tsx`): as guias da
 * competência escolhida, agrupadas por PJ, com débito, créditos, retido,
 * apurado, guia aprovada, vencimento e situação (em curso · a aprovar ·
 * aprovada · diferença). Clicar abre a memória de cálculo; "Aprovar" leva a
 * guia para Impostos a Pagar.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCheck,
  ClipboardCheck,
  Eye,
  Hourglass,
  Info,
  ListChecks,
  Loader2,
  Undo2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { dataBr, mesDe, nomeDoMes, proximoMes, r2 } from "@/lib/fiscal/datas";
import { aprovarGuiasPeloCalculado } from "./actions";
import type { DadosDaApuracao, EstabelecimentoDaTela, GuiaDaTela, PJDaTela } from "./dados";
import { MemoriaDialog } from "./memoria-dialog";
import { Nota, ResumoItem, fimDoPeriodo, moeda, nomeGuia, situacaoDa, somaGrupo } from "./ui";

const ORDEM: Record<string, number> = { ISS: 1, PIS: 2, COFINS: 3, ISS_RET: 4, CSRF: 5, IRRF: 6, IRPJ: 7, CSLL: 8 };

interface Periodo {
  id: string;
  rotulo: string;
  trimestral: boolean;
  guias: GuiaDaTela[];
}

export function AbaApuracao({ dados }: { dados: DadosDaApuracao }) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const { guias, pjs, estabelecimentos } = dados;

  const estabPorId = React.useMemo(() => new Map(estabelecimentos.map((e) => [e.id, e])), [estabelecimentos]);
  const pjPorId = React.useMemo(() => new Map(pjs.map((p) => [p.id, p])), [pjs]);

  const periodos = React.useMemo(() => {
    const m = new Map<string, Periodo>();
    for (const g of guias) {
      const p = m.get(g.competencia) ?? {
        id: g.competencia,
        rotulo: g.rotulo_competencia,
        trimestral: g.periodo === "trimestral",
        guias: [],
      };
      p.guias.push(g);
      m.set(g.competencia, p);
    }
    // Pelo fim do período; o trimestre entra depois do último mês dele.
    const chave = (p: Periodo) => `${fimDoPeriodo(p.trimestral ? "trimestral" : "mensal", p.id)}${p.trimestral ? "z" : ""}`;
    return [...m.values()].sort((a, b) => chave(a).localeCompare(chave(b)));
  }, [guias]);

  const pendente = periodos.find((p) => p.guias.some((g) => g.estado === "a_aprovar" || g.estado === "diferenca"));
  const [sel, setSel] = React.useState<string | undefined>(pendente?.id ?? periodos[periodos.length - 1]?.id);
  React.useEffect(() => {
    if (!periodos.some((p) => p.id === sel)) setSel(pendente?.id ?? periodos[periodos.length - 1]?.id);
  }, [periodos, sel, pendente]);
  const periodo = periodos.find((p) => p.id === sel) ?? periodos[0];

  const [aberta, setAberta] = React.useState<string | null>(null);
  const [confirmarLote, setConfirmarLote] = React.useState(false);
  const [aprovandoLote, setAprovandoLote] = React.useState(false);
  const [erroLote, setErroLote] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ texto: string; link: boolean } | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  // Só os feriados e os parâmetros vão para as cotas (o resto do cadastro fica no servidor).
  const cadastroDasCotas: CadastroFiscal = React.useMemo(
    () => ({ regimes: [], estabelecimentos: [], cnaes: [], feriados: dados.feriados, parametros: dados.parametros }),
    [dados.feriados, dados.parametros],
  );

  function nomeDoLocal(g: GuiaDaTela) {
    return g.estabelecimento_id ? estabPorId.get(g.estabelecimento_id)?.nome ?? g.local : pjPorId.get(g.empresa_contabil_id)?.nome ?? g.local;
  }

  if (dados.erro) {
    return (
      <Nota tom="ambar" icone={<AlertTriangle className="h-3.5 w-3.5" />}>
        Não foi possível calcular a apuração agora: {dados.erro}
      </Nota>
    );
  }

  const avisoDosFatos = <AvisoDosFatos dados={dados} />;

  if (!periodo) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-card px-5 py-8 text-center shadow-soft">
          <p className="text-sm font-semibold">Nenhuma guia em {nomeDoMes(mesDe(dados.hoje))} até agora.</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            As guias nascem das notas emitidas, dos recebimentos e das NFs de fornecedor registradas na aprovação das PPs.
          </p>
        </div>
        {avisoDosFatos}
        <BlocosAApurar dados={dados} pjPorId={pjPorId} />
      </div>
    );
  }

  const ordemPj = (id: string) => {
    const i = pjs.findIndex((p) => p.id === id);
    return i < 0 ? 999 : i;
  };
  const ordemEstab = (id: string | null) => (id ? estabelecimentos.findIndex((e) => e.id === id) : -1);
  const lista = [...periodo.guias].sort(
    (a, b) =>
      ordemPj(a.empresa_contabil_id) - ordemPj(b.empresa_contabil_id) ||
      (ORDEM[a.tributo] ?? 99) - (ORDEM[b.tributo] ?? 99) ||
      ordemEstab(a.estabelecimento_id) - ordemEstab(b.estabelecimento_id),
  );
  const aAprovar = lista.filter((g) => g.estado === "a_aprovar");
  const comDiferenca = lista.filter((g) => g.estado === "diferenca");
  const apurado = r2(lista.reduce((s, g) => s + g.apurado, 0));
  const proxima = [...aAprovar, ...comDiferenca].sort((a, b) => a.vencimento.localeCompare(b.vencimento))[0];
  const emCurso = lista.some((g) => g.estado === "em_curso");
  const fim = fimDoPeriodo(periodo.trimestral ? "trimestral" : "mensal", periodo.id);
  const guiaAberta = aberta ? guias.find((g) => g.chave === aberta) ?? null : null;
  const pjsDaLista = [...new Set(lista.map((g) => g.empresa_contabil_id))].sort((a, b) => ordemPj(a) - ordemPj(b));

  async function aprovarLote() {
    if (aprovandoLote) return;
    setAprovandoLote(true);
    setErroLote(null);
    let r: Awaited<ReturnType<typeof aprovarGuiasPeloCalculado>>;
    try {
      r = await aprovarGuiasPeloCalculado({ chaves: aAprovar.map((g) => g.chave) });
    } catch {
      r = { ok: false, message: "Não foi possível falar com o servidor. Tente de novo." };
    }
    setAprovandoLote(false);
    if (!r.ok) {
      setErroLote(r.message);
      // Uma falha no meio do lote pode deixar parte aprovada: a tela relê.
      startTransition(() => router.refresh());
      return;
    }
    if (r.falhas.length) {
      setErroLote(
        `${r.aprovadas} ${r.aprovadas === 1 ? "guia aprovada" : "guias aprovadas"}. Não deu para aprovar: ${r.falhas
          .map((f) => `${f.titulo} (${f.message})`)
          .join("; ")}`,
      );
      startTransition(() => router.refresh());
      return;
    }
    setConfirmarLote(false);
    setToast({
      texto: `${r.aprovadas} ${r.aprovadas === 1 ? "guia aprovada" : "guias aprovadas"}. As que têm valor já estão em Impostos a Pagar.`,
      link: true,
    });
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Competência</span>
          {periodos.map((p) => {
            const n = p.guias.filter((g) => g.estado === "a_aprovar" || g.estado === "diferenca").length;
            const curso = p.guias.some((g) => g.estado === "em_curso");
            const ok = !n && !curso;
            const ativo = p.id === periodo.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSel(p.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                  ativo
                    ? "border-california-red bg-california-red text-white"
                    : "border-border bg-white text-muted-foreground hover:border-california-red/50",
                )}
              >
                {p.trimestral ? `${p.rotulo.replace("º trimestre", "º tri")} · IRPJ e CSLL` : p.rotulo}
                {n > 0 && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[10px] font-bold tabular-nums",
                      ativo ? "bg-white/25 text-white" : "bg-amber-100 text-amber-800",
                    )}
                  >
                    {n}
                  </span>
                )}
                {curso && <Hourglass className={cn("h-3 w-3", ativo ? "text-white/85" : "text-muted-foreground/70")} />}
                {ok && <Check className={cn("h-3 w-3", ativo ? "text-white/85" : "text-emerald-600")} />}
              </button>
            );
          })}
        </div>
        {aAprovar.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setErroLote(null);
              setConfirmarLote(true);
            }}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
          >
            <ListChecks className="h-4 w-4" />
            Aprovar {aAprovar.length === 1 ? "a guia" : `as ${aAprovar.length} guias`} pelo valor calculado
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <ResumoItem
          icone={<ClipboardCheck className="h-3.5 w-3.5 text-california-red" />}
          label={emCurso ? "Apurado até hoje (estimativa)" : "Apurado na competência"}
          valor={moeda(apurado)}
        />
        <div className="h-5 w-px bg-border" />
        <ResumoItem
          icone={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
          label="A aprovar"
          valor={`${aAprovar.length + comDiferenca.length} ${aAprovar.length + comDiferenca.length === 1 ? "guia" : "guias"}`}
        />
        {proxima && (
          <>
            <div className="h-5 w-px bg-border" />
            <ResumoItem
              icone={<CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />}
              label="Vence primeiro"
              valor={dataBr(proxima.vencimento)}
              extra={
                <span className="text-xs text-muted-foreground">
                  · {proxima.titulo} · {nomeDoLocal(proxima)}
                </span>
              }
            />
          </>
        )}
        {emCurso && (
          <>
            <div className="h-5 w-px bg-border" />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Hourglass className="h-3.5 w-3.5" />
              Em curso até {dataBr(fim)}: os valores mudam a cada nota, custo ou recebimento, e entram no fluxo de caixa como estimativa.
            </span>
          </>
        )}
      </div>

      {avisoDosFatos}

      <div className="rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-[21%] px-3 py-3 text-left font-semibold">Guia</th>
              <th className="w-[9%] px-3 py-3 text-right font-semibold">Base</th>
              <th className="w-[9%] px-3 py-3 text-right font-semibold">Débito</th>
              <th className="w-[10%] px-3 py-3 text-right font-semibold">(−) Créditos</th>
              <th className="w-[10%] px-3 py-3 text-right font-semibold">(−) Retido / saldo</th>
              <th className="w-[9%] px-3 py-3 text-right font-semibold">(=) Apurado</th>
              <th className="w-[9%] px-3 py-3 text-right font-semibold">Guia aprovada</th>
              <th className="w-[8%] px-2 py-3 font-semibold">Vencimento</th>
              <th className="w-[7%] px-2 py-3 font-semibold">Situação</th>
              <th className="w-[8%] px-3 py-3 font-semibold">Ação</th>
            </tr>
          </thead>
          <tbody>
            {pjsDaLista.map((pjId) => {
              const p = pjPorId.get(pjId);
              const doPj = lista.filter((g) => g.empresa_contabil_id === pjId);
              return (
                <React.Fragment key={pjId}>
                  <tr className="border-b border-border bg-muted/20">
                    <td colSpan={10} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className="text-foreground">{p?.nome ?? "—"}</span>
                      {p && <> · {p.rotulo_regime}</>}
                      {p?.como_apura && <span className="normal-case tracking-normal"> · {p.como_apura}</span>}
                    </td>
                  </tr>
                  {doPj.map((g) => (
                    <LinhaGuia
                      key={g.chave}
                      g={g}
                      pj={p}
                      estab={g.estabelecimento_id ? estabPorId.get(g.estabelecimento_id) : undefined}
                      onAbrir={() => setAberta(g.chave)}
                    />
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {dados.aRecuperar.length > 0 && (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/60 px-5 py-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-sky-900">
            <Undo2 className="h-4 w-4" />
            ISS a recuperar · {moeda(r2(dados.aRecuperar.reduce((s, a) => s + a.valor, 0)))}
          </p>
          <ul className="mt-2 space-y-1 text-[12.5px] text-sky-900">
            {dados.aRecuperar.map((a) => {
              const e = estabPorId.get(a.estabelecimento_id);
              const mes = mesDe(a.data) > a.competencia_nota ? mesDe(a.data) : proximoMes(mesDe(a.data));
              return (
                <li key={a.id}>
                  NF {a.nota_numero}
                  {a.jobs ? ` (${a.jobs})` : ""} · {e?.nome ?? "—"}: o cliente reteve {moeda(a.valor)} em {dataBr(a.data)}, depois de paga a
                  guia de {nomeDoMes(a.competencia_nota)}.{" "}
                  {a.forma === "compensar" ? (
                    <b className="font-semibold">
                      {e?.municipio ?? "O município"} permite compensar: entra como sugestão na guia de ISS de {nomeDoMes(mes)}.
                    </b>
                  ) : (
                    <b className="font-semibold">
                      {e?.municipio ?? "O município"} pede restituição: fica aqui até a contabilidade concluir o pedido.
                    </b>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <BlocosAApurar dados={dados} pjPorId={pjPorId} />

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Clique numa guia para ver a memória de cálculo. A competência em curso é estimativa e não se aprova. Aprovada, a guia vira imposto a
          pagar com o valor que a contabilidade mandou. Uma nota registrada com data de uma competência já aprovada reabre a guia como
          diferença a aprovar. Fora desta versão (pendência): rendimento de aplicação, recebimento avulso e as mudanças da reforma tributária.
        </span>
      </p>

      {guiaAberta && (
        <MemoriaDialog
          key={guiaAberta.chave}
          g={guiaAberta}
          tenantId={dados.tenantId}
          pj={pjPorId.get(guiaAberta.empresa_contabil_id)}
          estab={guiaAberta.estabelecimento_id ? estabPorId.get(guiaAberta.estabelecimento_id) : undefined}
          cidadeDaMatriz={matrizDa(guiaAberta.empresa_contabil_id, pjPorId, estabPorId)?.municipio ?? ""}
          cnpjDaMatriz={matrizDa(guiaAberta.empresa_contabil_id, pjPorId, estabPorId)?.cnpj ?? "—"}
          cadastroDasCotas={cadastroDasCotas}
          hoje={dados.hoje}
          onClose={() => setAberta(null)}
          onAprovada={(texto) => {
            setAberta(null);
            setToast({ texto, link: true });
            startTransition(() => router.refresh());
          }}
        />
      )}

      <Dialog open={confirmarLote} onOpenChange={(o) => !aprovandoLote && setConfirmarLote(o)}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCheck className="h-5 w-5 text-california-red" />
              Aprovar pelo valor calculado
            </DialogTitle>
            <DialogDescription>
              Use quando as guias da contabilidade batem com o sistema. Cada guia vira um imposto a pagar com o valor abaixo; guia sem valor só
              fica confirmada.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border rounded-xl border border-border text-[13px]">
            {aAprovar.map((g) => (
              <div key={g.chave} className="flex items-center justify-between gap-3 px-3.5 py-2">
                <span className="min-w-0 truncate">
                  {nomeGuia(g)} · <span className="text-muted-foreground">{nomeDoLocal(g)}</span>
                </span>
                <span className="font-mono font-semibold">{moeda(g.apurado)}</span>
              </div>
            ))}
          </div>
          {erroLote && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-[12.5px] text-california-red">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{erroLote}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setConfirmarLote(false)}
              disabled={aprovandoLote}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void aprovarLote()}
              disabled={aprovandoLote || aAprovar.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
            >
              {aprovandoLote ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              Aprovar {aAprovar.length === 1 ? "a guia" : `as ${aAprovar.length} guias`}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 flex max-w-[560px] items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
        >
          <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
          <span className="text-sm font-semibold text-emerald-900">
            {toast.texto}
            {toast.link && (
              <>
                {" "}
                <Link href="/financeiro/fiscal?aba=impostos" prefetch={false} className="whitespace-nowrap text-california-red hover:underline">
                  Ver em Impostos a Pagar →
                </Link>
              </>
            )}
          </span>
          <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso" className="text-emerald-700 hover:text-emerald-900">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * "<PJ> · a apurar no recebimento" (protótipo `telas/apuracao.tsx`): no lucro
 * presumido pelo caixa, PIS, COFINS, IRPJ e CSLL só nascem no recebimento.
 * Até lá, os títulos em aberto das notas da PJ são projetados pela previsão
 * de recebimento (`lib/fiscal/a-apurar.ts`), e a projeção entra no fluxo de
 * caixa como estimativa. Vale para todas as competências; sem título em
 * aberto, o bloco não aparece.
 */
function BlocosAApurar({ dados, pjPorId }: { dados: DadosDaApuracao; pjPorId: Map<string, PJDaTela> }) {
  return (
    <>
      {dados.aApurarErro && (
        <Nota tom="ambar" icone={<AlertTriangle className="h-3.5 w-3.5" />}>
          Não foi possível projetar o que falta apurar no recebimento: {dados.aApurarErro}
        </Nota>
      )}
      {dados.aApurar.map((b) => (
        <div key={b.pj} className="rounded-2xl border border-border bg-card px-5 py-4 shadow-soft">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Hourglass className="h-4 w-4 text-muted-foreground" />
            {pjPorId.get(b.pj)?.nome ?? b.pj_nome} · a apurar no recebimento
          </p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            No regime de caixa, PIS, COFINS, IRPJ e CSLL só nascem quando o cliente paga. Enquanto isso, o sistema projeta pela previsão de
            recebimento dos títulos em aberto, e a projeção entra no fluxo de caixa como estimativa.
          </p>
          <table className="mt-3 w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1 font-semibold">Nota</th>
                <th className="py-1 font-semibold">Recebimento previsto</th>
                <th className="py-1 text-right font-semibold">A receber</th>
                <th className="py-1 text-right font-semibold">PIS + COFINS</th>
                <th className="py-1 text-right font-semibold">Vencem em</th>
                <th className="py-1 pl-4 font-semibold">IRPJ e CSLL</th>
              </tr>
            </thead>
            <tbody>
              {b.linhas.map((l) => (
                <tr key={l.titulo_id} className="border-t border-border">
                  <td className="py-1.5">{l.rotulo}</td>
                  <td className="py-1.5 font-mono">
                    {dataBr(l.previsao)}
                    {/* Previsão que já passou: a projeção conta o recebimento a partir de amanhã. */}
                    {l.recebimento !== l.previsao && (
                      <span className="block font-sans text-[10.5px] text-muted-foreground">
                        vencida · projetada para {dataBr(l.recebimento)}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono">{moeda(l.a_receber)}</td>
                  <td className="py-1.5 text-right font-mono">{moeda(l.pis_cofins)}</td>
                  <td className="py-1.5 text-right font-mono">{dataBr(l.vencimento)}</td>
                  <td className="py-1.5 pl-4 text-muted-foreground">entra na base do {l.rotulo_trimestre}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function matrizDa(pjId: string, pjs: Map<string, PJDaTela>, estabs: Map<string, EstabelecimentoDaTela>) {
  const id = pjs.get(pjId)?.matriz_id;
  return id ? estabs.get(id) : undefined;
}

/**
 * O que entra e o que fica fora da apuração hoje: sem nota de saída com CNPJ
 * emissor, as guias só têm o que vem das NFs de fornecedor (crédito,
 * retenções, custo do trimestre).
 */
function AvisoDosFatos({ dados }: { dados: DadosDaApuracao }) {
  if (dados.notasNaApuracao > 0 && dados.notasSemCnpj === 0) return null;
  const fora =
    dados.notasSemCnpj > 0
      ? ` ${dados.notasSemCnpj === 1 ? "Uma nota emitida" : `${dados.notasSemCnpj} notas emitidas`} desde 01/10/2026 ${
          dados.notasSemCnpj === 1 ? "não diz" : "não dizem"
        } por qual CNPJ ${dados.notasSemCnpj === 1 ? "saiu e fica" : "saíram e ficam"} fora da apuração.`
      : "";
  if (dados.notasNaApuracao > 0) {
    return (
      <Nota tom="ambar" icone={<Info className="h-3.5 w-3.5" />}>
        {fora.trim()} O CNPJ emissor e o CNAE se escolhem no Faturar.
      </Nota>
    );
  }
  return (
    <Nota tom="ambar" icone={<Info className="h-3.5 w-3.5" />}>
      Ainda não há nota de saída com CNPJ emissor: o ISS, o PIS e a COFINS das vendas (e a receita na base do IRPJ e da CSLL) aparecem a partir da
      primeira nota emitida pelo Faturar com o CNPJ e o CNAE.{fora}{" "}
      {dados.nfsDeFornecedor > 0
        ? `Por enquanto, a apuração só tem ${
            dados.nfsDeFornecedor === 1 ? "a NF de fornecedor registrada" : `as ${dados.nfsDeFornecedor} NFs de fornecedor registradas`
          } na aprovação das PPs: o crédito de PIS e COFINS e o custo do trimestre. As retenções de CSRF e IRRF entram no mês em que a PP é paga.`
        : "Também não há NF de fornecedor registrada na aprovação das PPs."}
    </Nota>
  );
}

function LinhaGuia({
  g,
  pj,
  estab,
  onAbrir,
}: {
  g: GuiaDaTela;
  pj: PJDaTela | undefined;
  estab: EstabelecimentoDaTela | undefined;
  onAbrir: () => void;
}) {
  const debito = somaGrupo(g, ["debito"]);
  const creditos = somaGrupo(g, ["credito", "estorno"]);
  const retido = somaGrupo(g, ["retido", "saldo", "compensacao"]);
  const temEstorno = g.memoria.some((m) => m.grupo === "estorno");
  const baseRotulo = g.periodo === "trimestral" ? g.memoria.filter((m) => m.grupo === "base").slice(-1)[0] : null;
  const base = baseRotulo ? baseRotulo.valor : g.base;
  const aprovado = r2(g.aprovacoes.reduce((s, a) => s + a.valor_guia, 0));
  const original = g.aprovacoes.find((a) => !a.diferenca);
  const local = estab ? `${estab.nome} · ${estab.municipio}-${estab.uf}` : g.local;
  const motivoCurto = g.vencimento_motivo?.split("·")[1]?.trim();
  return (
    <tr onClick={onAbrir} className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/40">
      <td className="px-3 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold">
            {g.titulo}
            {g.codigo && <span className="ml-1.5 font-mono text-[11px] font-medium text-muted-foreground">DARF {g.codigo}</span>}
          </span>
          <span className="truncate text-[11.5px] text-muted-foreground" title={local}>
            {local}
          </span>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-muted-foreground">
        {base ? moeda(base) : "—"}
        {g.periodo === "trimestral" && (
          <span className="block font-sans text-[10px]">{pj?.regime === "lucro_presumido" ? "base presumida" : "lucro bruto"}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs">{debito ? moeda(debito) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-emerald-700">
        {creditos ? moeda(creditos) : "—"}
        {temEstorno && <span className="block font-sans text-[10px] font-semibold text-rose-700">com estorno 12.08</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs text-emerald-700">{retido ? moeda(retido) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-sm font-bold tabular-nums">
        {moeda(g.apurado)}
        {g.saldo_credor_gerado > 0 && (
          <span className="block font-sans text-[10px] font-semibold text-sky-700">saldo credor {moeda(g.saldo_credor_gerado)}</span>
        )}
        {g.estado === "diferenca" && (
          <span className="block font-sans text-[10.5px] font-semibold text-rose-700">
            {g.delta > 0 ? "+" : "−"}
            {moeda(Math.abs(g.delta))} desde a aprovação
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right font-mono text-xs">
        {g.aprovacoes.length ? moeda(aprovado) : <span className="text-muted-foreground">—</span>}
        {original && Math.abs(original.valor_guia - original.valor_calculado) >= 0.01 && (
          <span className="block font-sans text-[10px] text-amber-700">calculado {moeda(original.valor_calculado)}</span>
        )}
      </td>
      <td className="px-2 py-3 text-center">
        <span className="whitespace-nowrap font-mono text-xs">{dataBr(g.vencimento)}</span>
        {g.periodo === "trimestral" && g.cotas && g.cotas.length > 1 && (
          <span className="block text-[10px] text-muted-foreground">1ª de {g.cotas.length} cotas</span>
        )}
        {motivoCurto && (
          <span className="block text-[10px] leading-tight text-muted-foreground" title={g.vencimento_motivo ?? undefined}>
            {motivoCurto}
          </span>
        )}
      </td>
      <td className="px-2 py-3 text-center">{situacaoDa(g)}</td>
      <td className="px-3 py-3 text-center">
        <div className="flex items-center justify-center gap-1">
          {(g.estado === "a_aprovar" || g.estado === "diferenca") && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAbrir();
              }}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-california-red px-2 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-california-red-hover"
            >
              <ClipboardCheck className="h-3 w-3" />
              {g.estado === "diferenca" ? "Diferença" : g.apurado > 0 ? "Aprovar" : "Confirmar"}
            </button>
          )}
          <button
            type="button"
            title="Ver a memória de cálculo"
            aria-label="Ver a memória de cálculo"
            onClick={(e) => {
              e.stopPropagation();
              onAbrir();
            }}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-california-red hover:text-california-red"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
