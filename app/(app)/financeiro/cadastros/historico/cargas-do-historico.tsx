"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileJson, Loader2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDataEHoraBr, formatDiaBr } from "@/lib/formatar-data-hora";
import {
  COLUNAS_DO_PACOTE,
  NOME_DA_TABELA,
  TABELAS_DO_PACOTE,
  lerPacote,
  partesDaTabela,
  type Pacote,
  type TabelaDoPacote,
} from "@/lib/historico-financeiro/pacote";
import type { HistoricoCarga, SituacaoDaCargaHistorico } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { concluirCarga, conferirCadastros, desfazerCarga, gravarParte, iniciarCarga } from "./actions";

/** Uma carga na lista, com o nome de quem carregou. */
export type CargaNaLista = Pick<
  HistoricoCarga,
  | "id"
  | "nome"
  | "tipo"
  | "periodo_de"
  | "periodo_ate"
  | "planilha_versao"
  | "pacote_arquivo"
  | "esperado"
  | "gravado"
  | "situacao"
  | "created_at"
  | "concluida_em"
  | "encerrada_em"
> & { criada_por_nome: string | null };

const ROTULO_DA_SITUACAO: Record<SituacaoDaCargaHistorico, string> = {
  carregando: "Incompleta",
  ativa: "Ativa",
  substituida: "Substituída",
  desfeita: "Desfeita",
  descartada: "Descartada",
};

const numero = (n: number) => n.toLocaleString("pt-BR");

/** "510 movimentos · 14 notas · 90 jobs": as tabelas grandes; rateio e saldos ficam no detalhe. */
function resumoDasLinhas(linhas: Partial<Record<TabelaDoPacote, number>>): string {
  const partes = (["movimentos", "notas", "jobs"] as const)
    .filter((t) => linhas[t] !== undefined)
    .map((t) => `${numero(linhas[t]!)} ${NOME_DA_TABELA[t].toLowerCase()}`);
  return partes.length > 0 ? partes.join(" · ") : "—";
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Os nomes distintos de uma coluna do pacote, com quantas linhas cada um tem. */
function contagemDaColuna(pacote: Pacote, tabela: TabelaDoPacote, coluna: string): Map<string, number> {
  const k = COLUNAS_DO_PACOTE[tabela].findIndex((c) => c.nome === coluna);
  const contagem = new Map<string, number>();
  for (const linha of pacote.tabelas[tabela].linhas) {
    const valor = linha[k];
    if (typeof valor === "string") contagem.set(valor, (contagem.get(valor) ?? 0) + 1);
  }
  return contagem;
}

type Lido = {
  arquivo: string;
  sha256: string;
  pacote: Pacote;
  /** Contas e empresas que faltam no cadastro, com quantas linhas cada uma tem. */
  faltam: { nome: string; linhas: number }[];
};

type Progresso = { tabela: TabelaDoPacote; enviadas: number; total: number; feitas: number; todas: number };

type Estado =
  | { fase: "escolher"; erro?: string }
  | { fase: "lendo" }
  | { fase: "lido"; lido: Lido }
  | { fase: "enviando"; lido: Lido; progresso: Progresso }
  | { fase: "concluida"; lido: Lido; linhas: Partial<Record<TabelaDoPacote, number>>; substituidas: number }
  | { fase: "falhou"; lido: Lido; erro: string; cargaId: string | null };

export function CargasDoHistorico({ cargas }: { cargas: CargaNaLista[] }) {
  const router = useRouter();
  const [estado, setEstado] = React.useState<Estado>({ fase: "escolher" });
  const [desfazer, setDesfazer] = React.useState<CargaNaLista | null>(null);
  const [desfazendo, setDesfazendo] = React.useState(false);
  const [erroDaLista, setErroDaLista] = React.useState<string | null>(null);
  const entrada = React.useRef<HTMLInputElement>(null);

  const emAndamento = cargas.find((c) => c.situacao === "carregando") ?? null;

  // Sair da tela no meio do envio deixa a carga incompleta: o navegador pergunta antes.
  React.useEffect(() => {
    if (estado.fase !== "enviando") return;
    const aviso = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [estado.fase]);

  async function escolher(arquivo: File) {
    setEstado({ fase: "lendo" });
    const buffer = await arquivo.arrayBuffer();
    const texto = new TextDecoder().decode(buffer);
    const lido = lerPacote(texto);
    if (!lido.ok) {
      setEstado({ fase: "escolher", erro: lido.message });
      return;
    }
    const pacote = lido.pacote;
    const porConta = contagemDaColuna(pacote, "movimentos", "conta");
    for (const [conta, n] of contagemDaColuna(pacote, "saldos", "conta")) if (!porConta.has(conta)) porConta.set(conta, n);
    const porEmpresa = contagemDaColuna(pacote, "rateio", "empresa");
    const conferido = await conferirCadastros({ contas: [...porConta.keys()], empresas: [...porEmpresa.keys()] });
    if (!conferido.ok) {
      setEstado({ fase: "escolher", erro: conferido.message });
      return;
    }
    const faltam = [
      ...conferido.contas.map((nome) => ({ nome: `a conta ${nome}`, linhas: porConta.get(nome) ?? 0 })),
      ...conferido.empresas.map((nome) => ({ nome: `a empresa ${nome}`, linhas: porEmpresa.get(nome) ?? 0 })),
    ];
    setEstado({ fase: "lido", lido: { arquivo: arquivo.name, sha256: await sha256(buffer), pacote, faltam } });
  }

  async function carregar(lido: Lido) {
    const { pacote } = lido;
    const partes = TABELAS_DO_PACOTE.map((tabela) => ({ tabela, partes: partesDaTabela(pacote.tabelas[tabela].linhas) }));
    const todas = partes.reduce((s, p) => s + p.partes.length, 0);
    let feitas = 0;
    let cargaId: string | null = null;
    const falhar = (erro: string) => {
      setEstado({ fase: "falhou", lido, erro, cargaId });
      router.refresh();
    };

    setEstado({
      fase: "enviando",
      lido,
      progresso: { tabela: TABELAS_DO_PACOTE[0], enviadas: 0, total: pacote.esperado[TABELAS_DO_PACOTE[0]].linhas, feitas, todas },
    });
    try {
      const iniciada = await iniciarCarga({
        formato: pacote.formato,
        carga: pacote.carga,
        planilha: pacote.planilha,
        esperado: pacote.esperado,
        pacote: { arquivo: lido.arquivo, sha256: lido.sha256 },
      });
      if (!iniciada.ok) return falhar(iniciada.message);
      cargaId = iniciada.cargaId;

      for (const { tabela, partes: daTabela } of partes) {
        const colunas = pacote.tabelas[tabela].colunas;
        const total = pacote.esperado[tabela].linhas;
        let enviadas = 0;
        for (const parte of daTabela) {
          setEstado({ fase: "enviando", lido, progresso: { tabela, enviadas, total, feitas, todas } });
          const r = await gravarParte(cargaId, tabela, colunas, parte);
          if (!r.ok) return falhar(r.message);
          enviadas += parte.length;
          feitas += 1;
        }
      }

      const concluida = await concluirCarga(cargaId);
      if (!concluida.ok) return falhar(concluida.message);
      setEstado({ fase: "concluida", lido, linhas: concluida.linhas, substituidas: concluida.substituidas });
      router.refresh();
    } catch (erro) {
      console.error("[historico.carregar]", erro);
      falhar("A conexão caiu no meio do envio. A carga ficou incompleta: descarte-a e carregue de novo.");
    }
  }

  async function confirmarDesfazer() {
    if (!desfazer) return;
    setDesfazendo(true);
    setErroDaLista(null);
    const r = await desfazerCarga(desfazer.id);
    setDesfazendo(false);
    if (!r.ok) {
      setErroDaLista(r.message);
      return;
    }
    setDesfazer(null);
    if (estado.fase === "falhou") setEstado({ fase: "escolher" });
    router.refresh();
  }

  const incompletaDoEnvio = estado.fase === "falhou" && estado.cargaId ? cargas.find((c) => c.id === estado.cargaId) : undefined;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-6 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-california-red/10 text-california-red">
            <FileJson className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-foreground">Carregar um pacote</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              O pacote (.json) sai do script de empacotamento do histórico. Ele é lido aqui no navegador e enviado em partes.
            </p>
          </div>
        </div>

        <input
          ref={entrada}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (arquivo) void escolher(arquivo);
          }}
        />

        <div className="mt-5">
          {estado.fase === "escolher" && (
            <div className="space-y-3">
              <Button onClick={() => entrada.current?.click()} disabled={emAndamento !== null}>
                <Upload className="h-4 w-4" />
                Escolher o pacote
              </Button>
              {emAndamento && (
                <Aviso tom="alerta">
                  A carga “{emAndamento.nome}” ficou incompleta. Descarte-a na lista abaixo antes de carregar outro pacote.
                </Aviso>
              )}
              {estado.erro && <Aviso tom="erro">{estado.erro}</Aviso>}
            </div>
          )}

          {estado.fase === "lendo" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Lendo e conferindo o pacote…
            </p>
          )}

          {estado.fase !== "escolher" && estado.fase !== "lendo" && (
            <ResumoDoPacote lido={estado.lido} cargas={cargas} comAvisos={estado.fase === "lido"} />
          )}

          {estado.fase === "lido" && (
            <div className="mt-4 space-y-3">
              {estado.lido.faltam.length > 0 && (
                <Aviso tom="erro">
                  Falta cadastrar {estado.lido.faltam.map((f) => `${f.nome} (${numero(f.linhas)} linhas)`).join(", ")}. O histórico não cria
                  cadastro: cadastre e escolha o pacote de novo.
                </Aviso>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void carregar(estado.lido)}
                  disabled={
                    estado.lido.faltam.length > 0 ||
                    emAndamento !== null ||
                    cargasDoPeriodo(cargas, estado.lido.pacote.carga).cruzada !== undefined
                  }
                >
                  Carregar
                </Button>
                <Button variant="outline" onClick={() => setEstado({ fase: "escolher" })}>
                  Trocar o pacote
                </Button>
              </div>
            </div>
          )}

          {estado.fase === "enviando" && <BarraDeEnvio progresso={estado.progresso} />}

          {estado.fase === "concluida" && (
            <div className="mt-4 space-y-3">
              <Aviso tom="ok">
                Carga concluída: {resumoDasLinhas(estado.linhas)}, conferidos com o pacote.
                {estado.substituidas > 0 && " A carga anterior do mesmo período foi substituída."}
              </Aviso>
              <Button variant="outline" onClick={() => setEstado({ fase: "escolher" })}>
                Carregar outro pacote
              </Button>
            </div>
          )}

          {estado.fase === "falhou" && (
            <div className="mt-4 space-y-3">
              <Aviso tom="erro">{estado.erro}</Aviso>
              <div className="flex flex-wrap gap-2">
                {incompletaDoEnvio?.situacao === "carregando" && (
                  <Button variant="outline" onClick={() => setDesfazer(incompletaDoEnvio)}>
                    Descartar a carga incompleta
                  </Button>
                )}
                <Button variant="outline" onClick={() => setEstado({ fase: "escolher" })}>
                  Voltar
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Cargas</h2>
        {erroDaLista && <Aviso tom="erro">{erroDaLista}</Aviso>}
        {cargas.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border py-12 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma carga ainda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[880px] table-fixed text-sm">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[16%]" />
                <col className="w-[11%]" />
                <col className="w-[22%]" />
                <col className="w-[10%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead className="border-b border-border bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Carga</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Período</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Planilha</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Linhas</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Situação</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Carregada</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>
                </tr>
              </thead>
              <tbody>
                {cargas.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 align-top">
                      <p className="truncate font-medium text-foreground" title={c.nome}>
                        {c.nome}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={c.pacote_arquivo}>
                        {c.pacote_arquivo}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums text-foreground">
                      {formatDiaBr(c.periodo_de)} a {formatDiaBr(c.periodo_ate)}
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums text-foreground">{formatDiaBr(c.planilha_versao)}</td>
                    <td className="px-4 py-3 align-top text-foreground">
                      {c.situacao === "carregando" ? (
                        <span className="text-muted-foreground">de {resumoDasLinhas(linhasEsperadas(c))}</span>
                      ) : (
                        resumoDasLinhas(Object.keys(c.gravado).length > 0 ? c.gravado : linhasEsperadas(c))
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge variant={c.situacao === "ativa" ? "soft" : c.situacao === "carregando" ? "outline" : "neutral"}>
                        {ROTULO_DA_SITUACAO[c.situacao]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                      <p className="tabular-nums">{formatDataEHoraBr(c.concluida_em ?? c.created_at)}</p>
                      <p className="truncate" title={c.criada_por_nome ?? undefined}>
                        {c.criada_por_nome ?? "—"}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      {(c.situacao === "ativa" || c.situacao === "carregando") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDesfazer(c)}
                          disabled={estado.fase === "enviando"}
                        >
                          {c.situacao === "ativa" ? "Desfazer" : "Descartar"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={desfazer !== null}
        onOpenChange={(aberto) => !aberto && !desfazendo && setDesfazer(null)}
        title={desfazer?.situacao === "ativa" ? `Desfazer a carga “${desfazer?.nome}”?` : `Descartar a carga “${desfazer?.nome}”?`}
        description={
          desfazer?.situacao === "ativa"
            ? `As linhas dela saem do histórico (${resumoDasLinhas(desfazer.gravado)}). O registro da carga fica, como desfeita.`
            : "As partes que já entraram saem do histórico, e o registro da carga fica, como descartada."
        }
        confirmLabel={desfazer?.situacao === "ativa" ? "Desfazer" : "Descartar"}
        variant="destructive"
        pending={desfazendo}
        onConfirm={confirmarDesfazer}
      />
    </div>
  );
}

/** A carga ativa do mesmo período (que a nova substitui) e a que cruza o período sem ser igual (que impede).
 *  A cauda substitui a cauda ativa, qualquer que seja o período: a planilha nova estende a mesma cauda. */
function cargasDoPeriodo(cargas: CargaNaLista[], carga: { de: string; ate: string; tipo: string }) {
  const ativas = cargas.filter((c) => c.situacao === "ativa" && c.tipo === carga.tipo);
  if (carga.tipo === "cauda") return { mesmoPeriodo: ativas[0], cruzada: undefined };
  const cruzam = ativas.filter((c) => c.periodo_de <= carga.ate && c.periodo_ate >= carga.de);
  return {
    mesmoPeriodo: cruzam.find((c) => c.periodo_de === carga.de && c.periodo_ate === carga.ate),
    cruzada: cruzam.find((c) => c.periodo_de !== carga.de || c.periodo_ate !== carga.ate),
  };
}

function linhasEsperadas(c: Pick<CargaNaLista, "esperado">): Partial<Record<TabelaDoPacote, number>> {
  return Object.fromEntries(TABELAS_DO_PACOTE.map((t) => [t, c.esperado?.[t]?.linhas ?? 0]));
}

/** `comAvisos`: antes de carregar. Depois, a carga nova já está na lista e seria o "mesmo período" dela mesma. */
function ResumoDoPacote({ lido, cargas, comAvisos }: { lido: Lido; cargas: CargaNaLista[]; comAvisos: boolean }) {
  const { carga, planilha, esperado } = lido.pacote;
  const { mesmoPeriodo, cruzada } = cargasDoPeriodo(cargas, carga);
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">
          {carga.nome} · {formatDiaBr(carga.de)} a {formatDiaBr(carga.ate)}
        </p>
        <p className="text-xs text-muted-foreground">
          {lido.arquivo} · planilha baixada em {formatDiaBr(planilha.versao)} · SHA-256 {planilha.sha256.slice(0, 12)}…
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {TABELAS_DO_PACOTE.map((t) => {
          const declarado: { linhas: number; soma?: string } = esperado[t];
          return (
            <div key={t} className="rounded-lg border border-border px-3 py-2">
              <dt className="text-xs text-muted-foreground">{NOME_DA_TABELA[t]}</dt>
              <dd className="text-sm font-semibold tabular-nums text-foreground">{numero(declarado.linhas)}</dd>
              {declarado.soma !== undefined && (
                <dd className="truncate text-xs tabular-nums text-muted-foreground" title="Soma do valor">
                  {formatCurrency(Number(declarado.soma))}
                </dd>
              )}
            </div>
          );
        })}
      </dl>
      {comAvisos && mesmoPeriodo && (
        <Aviso tom="alerta">
          Substitui a carga ativa “{mesmoPeriodo.nome}”, {carga.tipo === "cauda" ? "a cauda de antes" : "do mesmo período"}, quando terminar.
        </Aviso>
      )}
      {comAvisos && cruzada && (
        <Aviso tom="erro">
          O período cruza o da carga ativa “{cruzada.nome}” ({formatDiaBr(cruzada.periodo_de)} a {formatDiaBr(cruzada.periodo_ate)}).
          Desfaça aquela carga antes, ou carregue o mesmo período dela.
        </Aviso>
      )}
    </div>
  );
}

function BarraDeEnvio({ progresso }: { progresso: Progresso }) {
  const pct = progresso.todas > 0 ? Math.round((progresso.feitas / progresso.todas) * 100) : 0;
  return (
    <div className="mt-4 space-y-2">
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-california-red transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Gravando {NOME_DA_TABELA[progresso.tabela].toLowerCase()}: {numero(progresso.enviadas)} de {numero(progresso.total)} ·{" "}
        {pct}% da carga. Não feche esta tela.
      </p>
    </div>
  );
}

function Aviso({ tom, children }: { tom: "ok" | "alerta" | "erro"; children: React.ReactNode }) {
  const estilo =
    tom === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tom === "alerta"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : "border-california-red/30 bg-california-red/5 text-foreground";
  const Icone = tom === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${estilo}`}>
      <Icone className={`mt-0.5 h-4 w-4 shrink-0 ${tom === "erro" ? "text-california-red" : ""}`} />
      <div>{children}</div>
    </div>
  );
}
