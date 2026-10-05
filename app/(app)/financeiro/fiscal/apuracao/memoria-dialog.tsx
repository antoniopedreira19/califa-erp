"use client";

/**
 * A memória de cálculo de uma guia e a aprovação dela (protótipo aprovado,
 * `memoria-dialog.tsx`): à esquerda a origem de cada valor e o rateio entre
 * as regionais; à direita o painel do estado — em curso, aprovada, ou o
 * formulário de aprovação (valor da guia da contabilidade, justificativa
 * quando difere, compensação do ISS a recuperar, cotas do IRPJ/CSLL e o
 * anexo da guia).
 *
 * O formulário só manda as decisões da pessoa: o servidor recalcula a guia
 * (`aprovarGuia`). As cotas mostradas aqui saem da mesma função que o
 * servidor usa (`cotasDaAprovacao`), sobre o valor da guia.
 */

import * as React from "react";
import Link from "next/link";
import { AlertCircle, CalendarClock, ClipboardCheck, FileText, Hourglass, Info, Loader2, Paperclip, Upload, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoneyInput } from "@/components/ui/money-input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { vencimentoDaComplementar, type Cota, type ItemMemoria } from "@/lib/fiscal/apuracao";
import { dataBr, r2 } from "@/lib/fiscal/datas";
import { aprovarGuia, urlDaGuiaAprovada } from "./actions";
import { JUSTIFICATIVA_MINIMA, calculadoParaAGuia, cotasDaAprovacao } from "./aprovacao";
import type { EstabelecimentoDaTela, GuiaDaTela, PJDaTela } from "./dados";
import { Nota, fimDoPeriodo, moeda, pct, situacaoDa } from "./ui";

const GRUPOS: Array<{ grupos: ItemMemoria["grupo"][]; titulo: string }> = [
  { grupos: ["base"], titulo: "Base de cálculo do trimestre" },
  { grupos: ["debito"], titulo: "Débito" },
  { grupos: ["credito"], titulo: "Créditos sobre custos (NF de fornecedor emitida no mês)" },
  { grupos: ["rateio_credito"], titulo: "Rateio proporcional do crédito (receita do mês no 12.08)" },
  { grupos: ["info"], titulo: "Custos sem crédito" },
  { grupos: ["retido"], titulo: "Retido pelo cliente" },
  { grupos: ["compensacao"], titulo: "ISS a compensar" },
  { grupos: ["saldo"], titulo: "Saldo credor" },
];

const TAMANHO_MAXIMO = 10 * 1024 * 1024;

/** "DARF out/26 (cópia).pdf" → "DARF-out-26-copia.pdf": o caminho do bucket sem acento nem espaço. */
function nomeSeguro(nome: string) {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return limpo || "guia.pdf";
}

export function MemoriaDialog({
  g,
  tenantId,
  pj,
  estab,
  cidadeDaMatriz,
  cnpjDaMatriz,
  cadastroDasCotas,
  hoje,
  onClose,
  onAprovada,
}: {
  g: GuiaDaTela;
  tenantId: string;
  pj: PJDaTela | undefined;
  estab: EstabelecimentoDaTela | undefined;
  cidadeDaMatriz: string;
  cnpjDaMatriz: string;
  /** Só os feriados e os parâmetros: o que as cotas precisam. */
  cadastroDasCotas: CadastroFiscal;
  /** Hoje em São Paulo ("AAAA-MM-DD"): diz se a complementar já nasce vencida. */
  hoje: string;
  onClose: () => void;
  onAprovada: (mensagem: string) => void;
}) {
  const podeAprovar = g.estado === "a_aprovar" || g.estado === "diferenca";
  const diferenca = g.estado === "diferenca";
  const aprovacao = g.aprovacoes.find((a) => !a.diferenca) ?? null;
  const temComp = !diferenca && (g.compensacoes ?? []).length > 0;
  const valorComp = r2((g.compensacoes ?? []).reduce((s, c) => s + c.valor, 0));

  const [usarComp, setUsarComp] = React.useState(true);
  const calculado = calculadoParaAGuia(g, g.estado, g.delta, usarComp);
  const [valorGuia, setValorGuia] = React.useState<number>(calculado);
  const [justificativa, setJustificativa] = React.useState("");
  const [arquivo, setArquivo] = React.useState<File | null>(null);
  const [cotaUnica, setCotaUnica] = React.useState(false);
  const [jurosPct, setJurosPct] = React.useState<Array<number | null>>(() => (g.cotas ?? []).map((c) => c.jurosPct));
  const [erro, setErro] = React.useState<string | null>(null);
  const [enviando, setEnviando] = React.useState(false);
  const inputArquivo = React.useRef<HTMLInputElement>(null);

  // Sem a compensação, a guia volta ao valor cheio (e o valor sugerido acompanha).
  React.useEffect(() => {
    if (!diferenca) setValorGuia(calculado);
  }, [calculado, diferenca]);
  const dif = r2(valorGuia - calculado);

  const cotas: Cota[] = React.useMemo(
    () =>
      g.periodo === "trimestral" && !diferenca
        ? cotasDaAprovacao(valorGuia, g.competencia, cidadeDaMatriz, cadastroDasCotas, cotaUnica, jurosPct)
        : [],
    [g.periodo, g.competencia, diferenca, valorGuia, cidadeDaMatriz, cadastroDasCotas, cotaUnica, jurosPct],
  );

  const fim = fimDoPeriodo(g.periodo, g.competencia);
  const local = estab
    ? `${estab.nome} · CNPJ ${estab.cnpj}`
    : `${pj?.nome ?? g.local} · CNPJ ${cnpjDaMatriz} (matriz)`;

  function escolherArquivo(f: File | undefined) {
    setErro(null);
    if (!f) return;
    if (f.type !== "application/pdf") {
      setErro("A guia precisa ser um PDF.");
      return;
    }
    if (f.size > TAMANHO_MAXIMO) {
      setErro(`"${f.name}" passa de 10 MB.`);
      return;
    }
    setArquivo(f);
  }

  async function confirmar() {
    if (enviando) return;
    if (Math.abs(dif) >= 0.01 && justificativa.trim().length < JUSTIFICATIVA_MINIMA) {
      setErro(
        `Explique a diferença entre a guia da contabilidade e o valor calculado (mínimo ${JUSTIFICATIVA_MINIMA} caracteres).`,
      );
      return;
    }
    setEnviando(true);
    setErro(null);
    const supabase = createClient();
    let guiaPath: string | null = null;
    if (arquivo) {
      guiaPath = `${tenantId}/guias/${crypto.randomUUID()}/${nomeSeguro(arquivo.name)}`;
      const { error } = await supabase.storage
        .from("impostos")
        .upload(guiaPath, arquivo, { contentType: "application/pdf", upsert: false });
      if (error) {
        setEnviando(false);
        setErro(`Falha ao enviar a guia: ${error.message}`);
        return;
      }
    }
    let r: Awaited<ReturnType<typeof aprovarGuia>>;
    try {
      r = await aprovarGuia({
        chave: g.chave,
        valor_guia: valorGuia,
        justificativa,
        usar_compensacao: usarComp,
        cota_unica: cotaUnica,
        juros_pct: g.periodo === "trimestral" ? jurosPct : null,
        guia_path: guiaPath,
      });
    } catch {
      r = { ok: false, message: "Não foi possível falar com o servidor. Tente de novo." };
    }
    if (!r.ok) {
      // A guia não foi aprovada: o anexo enviado agora não fica órfão no bucket.
      if (guiaPath) await supabase.storage.from("impostos").remove([guiaPath]);
      setEnviando(false);
      setErro(r.message);
      return;
    }
    setEnviando(false);
    onAprovada(
      r.titulos > 0
        ? `${g.titulo} de ${g.rotulo_competencia} ${diferenca ? "· diferença aprovada" : "aprovado"}. ${
            r.titulos === 1 ? "Título criado" : `${r.titulos} títulos criados`
          } em Impostos a Pagar.`
        : diferenca
          ? `${g.titulo} de ${g.rotulo_competencia}: saldo registrado, sem valor a pagar.`
          : `${g.titulo} de ${g.rotulo_competencia} confirmado sem valor a pagar.`,
    );
  }

  async function abrirGuia(aprovacaoId: string) {
    const r = await urlDaGuiaAprovada(aprovacaoId);
    if (r.ok) window.open(r.url, "_blank", "noopener,noreferrer");
    else setErro(r.message);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !enviando && onClose()}>
      <DialogContent className="sm:max-w-[1240px]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-california-red" />
            {g.titulo} · {g.rotulo_competencia}
            {g.codigo && <span className="font-mono text-sm font-medium text-muted-foreground">DARF {g.codigo}</span>}
            {situacaoDa(g)}
          </DialogTitle>
          <DialogDescription>{local}</DialogDescription>
        </DialogHeader>

        <div className="grid items-start gap-5 lg:grid-cols-[1fr_460px]">
          {/* Memória de cálculo */}
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-[max-content_1fr_max-content_1fr] gap-x-4 gap-y-1.5 rounded-xl border border-border bg-muted/40 p-4 text-[13px]">
              <span className="text-muted-foreground">Vencimento</span>
              <span className="font-mono text-xs font-semibold">
                {dataBr(g.vencimento)}
                {g.vencimento_motivo && (
                  <span className="ml-1 font-sans font-normal text-muted-foreground">({g.vencimento_motivo})</span>
                )}
              </span>
              <span className="text-muted-foreground">Regra</span>
              <span className="text-xs">{g.regra_vencimento}</span>
              <span className="text-muted-foreground">Local</span>
              <span className="text-xs">{g.local}</span>
              <span className="text-muted-foreground">Período</span>
              <span className="text-xs">{g.estado === "em_curso" ? `em curso até ${dataBr(fim)}` : `fechado em ${dataBr(fim)}`}</span>
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full table-fixed text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    <th className="w-[52%] px-3 py-2 text-left font-semibold">Origem</th>
                    <th className="w-[17%] px-3 py-2 text-right font-semibold">Base</th>
                    <th className="w-[12%] px-3 py-2 text-right font-semibold">Alíquota</th>
                    <th className="w-[19%] px-3 py-2 text-right font-semibold">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {GRUPOS.map(({ grupos, titulo }) => {
                    const itens = g.memoria.filter((m) => grupos.includes(m.grupo));
                    if (!itens.length) return null;
                    const ehBase = grupos[0] === "base";
                    return (
                      <React.Fragment key={titulo}>
                        <tr className="border-b border-border bg-muted/15">
                          <td colSpan={4} className="px-3 py-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                            {titulo}
                          </td>
                        </tr>
                        {itens.map((m, i) => (
                          <tr
                            key={i}
                            className={cn(
                              "border-b border-border/70 last:border-0",
                              ehBase && m.rotulo.startsWith("(=)") && "bg-muted/10 font-semibold",
                            )}
                          >
                            <td className="px-3 py-1.5">
                              <span className={cn(m.grupo === "info" && "text-muted-foreground")}>{m.rotulo}</span>
                              {m.detalhe && <span className="block text-[11px] leading-snug text-muted-foreground">{m.detalhe}</span>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-muted-foreground">
                              {m.base !== undefined ? moeda(m.base) : ""}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-muted-foreground">
                              {m.aliquota !== undefined ? pct(m.aliquota) : ""}
                            </td>
                            <td
                              className={cn(
                                "whitespace-nowrap px-3 py-1.5 text-right font-mono",
                                !ehBase && m.valor < 0 && "text-emerald-700",
                                !ehBase && m.grupo === "rateio_credito" && "text-rose-700",
                                m.grupo === "info" && "text-muted-foreground",
                              )}
                            >
                              {m.grupo === "info"
                                ? "sem crédito"
                                : ehBase
                                  ? moeda(m.valor)
                                  : `${m.valor < 0 ? "−" : "+"} ${moeda(Math.abs(m.valor))}`}
                            </td>
                          </tr>
                        ))}
                      </React.Fragment>
                    );
                  })}
                  <tr className="border-t-2 border-border bg-muted/20">
                    <td colSpan={3} className="px-3 py-2 text-[12.5px] font-bold">
                      (=) Apurado{" "}
                      {g.estado === "em_curso" && <span className="font-normal text-muted-foreground">· estimativa até hoje</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-sm font-bold">{moeda(g.apurado)}</td>
                  </tr>
                  {g.saldo_credor_gerado > 0 && (
                    <tr className="bg-sky-50/60">
                      <td colSpan={3} className="px-3 py-1.5 text-[12px] text-sky-800">
                        Saldo credor que passa para o mês seguinte
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-[12px] text-sky-800">
                        {moeda(g.saldo_credor_gerado)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {g.avisos.map((a) => (
              <Nota key={a} tom="ambar" icone={<AlertCircle className="h-3.5 w-3.5" />}>
                {a}
              </Nota>
            ))}

            {g.rateio.length > 0 && (
              <div className="rounded-xl border border-border">
                <p className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Users className="h-3.5 w-3.5" />
                  Rateio entre as regionais{" "}
                  {g.tributo === "CSRF" || g.tributo === "IRRF" || g.tributo === "ISS_RET"
                    ? "· pelas PPs de origem"
                    : "· pela participação no faturamento"}
                </p>
                <table className="w-full text-[12.5px]">
                  <tbody>
                    {g.rateio.map((r) => (
                      <tr key={`${r.empresa_id}|${r.regional_id ?? ""}`} className="border-b border-border/70 last:border-0">
                        <td className="px-3 py-1.5">{r.empresa_nome}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{r.regional_nome ?? "Sem regional"}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{pct(r.pct)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{moeda(r.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Painel da aprovação */}
          <div className="space-y-4 rounded-xl border border-border bg-white p-4">
            {g.estado === "em_curso" && (
              <>
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <Hourglass className="h-4 w-4 text-muted-foreground" />
                  Competência em curso
                </p>
                <p className="text-[12.5px] text-muted-foreground">
                  O valor muda a cada nota, custo ou recebimento até {dataBr(fim)}. A aprovação abre depois do fechamento; enquanto isso, a estimativa entra no fluxo de caixa no vencimento.
                </p>
                {g.cotas && g.cotas.length > 0 && <CotasTabela cotas={g.cotas} />}
              </>
            )}

            {g.estado === "aprovada" && (
              <>
                <p className="text-sm font-semibold">Aprovada</p>
                {g.aprovacoes.map((a) => (
                  <div key={a.id} className="space-y-1 rounded-lg border border-border bg-muted/30 p-3 text-[12.5px]">
                    <p>
                      {a.diferenca ? "Diferença" : "Guia"} de <b className="font-mono">{moeda(a.valor_guia)}</b> em {dataBr(a.data)} ·{" "}
                      {a.autor}
                    </p>
                    {Math.abs(a.valor_guia - a.valor_calculado) >= 0.01 && !a.diferenca && (
                      <p className="text-amber-800">
                        Calculado: {moeda(a.valor_calculado)} · {a.justificativa}
                      </p>
                    )}
                    {a.diferenca && a.justificativa && <p className="text-muted-foreground">{a.justificativa}</p>}
                    <p className="text-muted-foreground">
                      Guia:{" "}
                      {a.guia_nome ? (
                        <button
                          type="button"
                          onClick={() => void abrirGuia(a.id)}
                          className="inline-flex max-w-full items-center gap-1 text-california-red"
                        >
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="truncate underline-offset-2 hover:underline">{a.guia_nome}</span>
                        </button>
                      ) : (
                        <span>—</span>
                      )}
                    </p>
                  </div>
                ))}
                <Link
                  href="/financeiro/fiscal?aba=impostos"
                  prefetch={false}
                  className="inline-block text-[12.5px] font-semibold text-california-red hover:underline"
                >
                  Ver em Impostos a Pagar →
                </Link>
              </>
            )}

            {podeAprovar && (
              <>
                <div>
                  <p className="text-sm font-semibold">
                    {diferenca
                      ? "Aprovar a diferença"
                      : g.apurado > 0 || temComp
                        ? "Aprovar a guia"
                        : "Confirmar sem valor a pagar"}
                  </p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    {diferenca
                      ? `A guia foi aprovada em ${dataBr(aprovacao?.data)} por ${moeda(aprovacao?.valor_guia ?? 0)}. Depois disso o cálculo mudou ${
                          g.delta > 0 ? "para mais" : "para menos"
                        }: ${g.delta > 0 ? "a diferença vira uma guia complementar" : "a diferença fica como saldo a compensar"}.`
                      : "Confira com a guia que a contabilidade mandou. Vale o valor da guia; o calculado fica guardado ao lado."}
                  </p>
                  {diferenca && g.delta < 0 && (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      O imposto diminuiu {moeda(Math.abs(g.delta))}. Se o título desta guia ainda não foi pago, corrija o
                      valor ou cancele o imposto em Impostos a Pagar, com o motivo; se já foi pago, a diferença fica a
                      recuperar, com a contabilidade. Aprovar aqui registra a diferença, sem gerar título.
                    </p>
                  )}
                  {diferenca && g.delta > 0 && (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      A complementar vence em {dataBr(vencimentoDaComplementar(g))}, a data da guia original.
                      {vencimentoDaComplementar(g) < hoje && (
                        <span className="font-semibold text-amber-700">
                          {" "}
                          Essa data já passou: a guia sai com multa e juros, que entram na baixa.
                        </span>
                      )}
                    </p>
                  )}
                </div>

                {temComp && (
                  <label className="flex items-start gap-2.5 rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-[12.5px] text-sky-900">
                    <Checkbox checked={usarComp} onCheckedChange={(v) => setUsarComp(v === true)} className="mt-0.5" />
                    <span>
                      Compensar o ISS a recuperar ({moeda(valorComp)}) nesta guia
                      <span className="block text-[11.5px] text-sky-800/80">
                        {estab?.municipio ?? "O município"} permite compensar o ISS pago em duplicidade nos meses seguintes. Confirme
                        com a contabilidade antes.
                      </span>
                    </span>
                  </label>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">
                    {diferenca ? "Valor da guia complementar" : "Valor da guia (contabilidade)"}{" "}
                    <span className="text-california-red">*</span>
                  </label>
                  <MoneyInput
                    value={valorGuia}
                    onValueChange={(v) => {
                      setValorGuia(v);
                      setErro(null);
                    }}
                  />
                  <p className={cn("text-[11.5px]", Math.abs(dif) >= 0.01 ? "font-semibold text-amber-700" : "text-muted-foreground")}>
                    {Math.abs(dif) < 0.01
                      ? `Igual ao calculado (${moeda(calculado)}).`
                      : `${moeda(Math.abs(dif))} ${dif > 0 ? "acima" : "abaixo"} do calculado (${moeda(calculado)}).`}
                  </p>
                </div>

                {Math.abs(dif) >= 0.01 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold">
                      Por que a guia é diferente? <span className="text-california-red">*</span>
                    </label>
                    <Textarea
                      rows={3}
                      value={justificativa}
                      onChange={(e) => {
                        setJustificativa(e.target.value);
                        setErro(null);
                      }}
                      placeholder="Ex.: a contabilidade incluiu o rendimento de aplicação de outubro."
                    />
                  </div>
                )}

                {g.periodo === "trimestral" && !diferenca && valorGuia > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">Cotas</p>
                      <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                        <Checkbox checked={cotaUnica} onCheckedChange={(v) => setCotaUnica(v === true)} />
                        Pagar em cota única
                      </label>
                    </div>
                    <CotasTabela
                      cotas={cotas}
                      editavel={!cotaUnica}
                      onJuros={(i, v) =>
                        setJurosPct((a) => {
                          const n = [...a];
                          n[i] = v;
                          return n;
                        })
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      A 2ª cota leva 1% e a 3ª, a Selic do mês anterior mais 1% (Lei 9.430/1996, art. 5º). Os juros entram no título de
                      cada cota e, na baixa, vão para 11 · Despesa com Juros. Cota mínima de R$ 1.000; abaixo de R$ 2.000, cota única.
                    </p>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Guia (DARF ou guia municipal)</p>
                  {arquivo ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="h-4 w-4 shrink-0 text-california-red" />
                        <span className="truncate">{arquivo.name}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setArquivo(null)}
                        disabled={enviando}
                        className="rounded p-1 text-muted-foreground hover:text-california-red"
                        aria-label="Remover arquivo"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => inputArquivo.current?.click()}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-white px-3 py-3 text-sm text-muted-foreground transition-colors hover:border-california-red/50 hover:text-california-red"
                    >
                      <Upload className="h-4 w-4" />
                      Selecionar arquivo
                      <span className="text-[11px] text-muted-foreground/80">· PDF, até 10 MB</span>
                    </button>
                  )}
                  <p className="text-[11.5px] text-muted-foreground">Pode anexar agora ou na baixa.</p>
                  <input
                    ref={inputArquivo}
                    type="file"
                    className="hidden"
                    accept="application/pdf"
                    onChange={(ev) => {
                      escolherArquivo(ev.target.files?.[0]);
                      ev.target.value = "";
                    }}
                  />
                </div>

                {erro && (
                  <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-[12.5px] text-california-red">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{erro}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={enviando}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirmar()}
                    disabled={enviando}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-california-red px-3 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-60"
                  >
                    {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                    {diferenca
                      ? g.delta > 0
                        ? "Aprovar complementar"
                        : "Registrar saldo a compensar"
                      : valorGuia > 0
                        ? "Aprovar guia"
                        : "Confirmar"}
                  </button>
                </div>
              </>
            )}

            {!podeAprovar && erro && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-[12.5px] text-california-red">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
            {!podeAprovar && g.estado !== "em_curso" && g.estado !== "aprovada" && (
              <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <Info className="h-4 w-4" />
                Nada a aprovar.
              </p>
            )}
            {g.estado === "aprovada" && g.aprovacoes.some((a) => a.guia_nome) && (
              <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                A guia anexada segue para a baixa.
              </p>
            )}
            {g.estado !== "em_curso" && (
              <p className="flex items-center gap-1.5 border-t border-border pt-3 text-[11.5px] text-muted-foreground">
                <CalendarClock className="h-3.5 w-3.5" />
                Vence em {dataBr(g.vencimento)} · {g.regra_vencimento}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CotasTabela({
  cotas,
  editavel,
  onJuros,
}: {
  cotas: Cota[];
  editavel?: boolean;
  onJuros?: (i: number, v: number | null) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-semibold">Cota</th>
            <th className="px-2 py-1.5 text-left font-semibold">Vence</th>
            <th className="px-2 py-1.5 text-right font-semibold">Principal</th>
            <th className="px-2 py-1.5 text-right font-semibold">Juros</th>
            <th className="px-2 py-1.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {cotas.map((c, i) => (
            <tr key={c.numero} className="border-b border-border/70 last:border-0">
              <td className="px-2 py-1.5">{c.numero}ª</td>
              <td className="px-2 py-1.5 font-mono">{dataBr(c.vencimento)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{moeda(c.principal)}</td>
              <td className="px-2 py-1.5 text-right font-mono">
                {editavel && i > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={c.jurosPct}
                      onChange={(e) => onJuros?.(i, Number(e.target.value))}
                      aria-label={`Juros da ${c.numero}ª cota (%)`}
                      className="no-spinner h-7 w-14 rounded-md border border-border bg-white px-1.5 text-right font-mono text-[12px] focus:border-california-red focus:outline-none"
                    />
                    %
                  </span>
                ) : (
                  `${c.jurosPct.toLocaleString("pt-BR")}%`
                )}
                <span className="block text-[10.5px] text-muted-foreground">{moeda(c.juros)}</span>
              </td>
              <td className="px-2 py-1.5 text-right font-mono font-semibold">{moeda(r2(c.principal + c.juros))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
