"use client";

/**
 * A NF tomada — o olho da aba Tomadas (decisão 271).
 *
 * O mesmo desenho do painel da nota emitida (Contas a Receber): os
 * documentos que a nota cobre, os dados da nota, o que a leitura da NF
 * trouxe, quem registrou e o PDF. O olho de uma PP abre a tela da PP do
 * financeiro em leitura AO LADO do painel (a `PPTela` com `aoLadoDoPainel`,
 * decisão 241); no desembolso e na prestação, abre o PDF da nota naquele
 * documento, no visualizador do navegador.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CheckCircle2, Eye, FileText, Info, Loader2, Sparkles } from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { VisualizadorDeArquivo } from "@/components/documentos/painel-documento";
import { PPTela } from "@/app/(app)/financeiro/contas-a-pagar/pp-tela";
import type { PPRow } from "@/app/(app)/financeiro/contas-a-pagar/pedidos-compra-list";
import type { EstabelecimentoDaNota } from "@/app/(app)/financeiro/contas-a-pagar/pp-dossie";
import { carregarPPParaVisualizar } from "@/app/(app)/jobs/[jobId]/pps/actions-visualizar";
import { cn, formatCnpj, formatDocumento } from "@/lib/utils";
import { ROTULO_DA_ORIGEM, type DocumentoDaNota, type NotaTomada } from "./dados";
import { Selo, dataBR, moeda } from "./comum";
import { OrigemSelo } from "./aba-tomadas";
import { urlDoAnexoDaNota } from "./actions";
import { lerEmLotes } from "./leitura-das-notas";

const LARGURA_DO_PAINEL = 620;

// Os valores do cadastro de fornecedores (simples, mei, normal).
const REGIME: Record<string, string> = {
  simples: "Simples Nacional",
  mei: "MEI",
  normal: "Regime normal (fora do Simples)",
};

export function NotaTomadaDrawer({ nota, onClose }: { nota: NotaTomada; onClose: () => void }) {
  const router = useRouter();
  const [erro, setErro] = React.useState<string | null>(null);
  const [lendo, setLendo] = React.useState(false);
  const [erroDaLeitura, setErroDaLeitura] = React.useState<string | null>(null);
  const [isPending, startTransition] = React.useTransition();
  const [visualizando, setVisualizando] = React.useState<{ pp: PPRow; estabelecimentos: EstabelecimentoDaNota[]; id: string } | null>(null);
  const [visorAberto, setVisorAberto] = React.useState(false);
  /** O documento cujo PDF da nota está aberto embaixo (null = fechado). */
  const [pdf, setPdf] = React.useState<{ chave: string; nome: string; url: string | null; imagem: boolean; carregando: boolean } | null>(null);

  const valem = nota.documentos.filter((d) => d.vale);
  const falta = Math.round((nota.valor - nota.nasDocumentos) * 100) / 100;
  const chave = (d: DocumentoDaNota) => d.origem + d.id;
  const primeiro = valem[0] ?? nota.documentos[0] ?? null;
  const documento = nota.fornecedor.documento ? ` · ${formatDocumento(nota.fornecedor.documento)}` : "";

  function abrirPdf(d: DocumentoDaNota) {
    if (!d.anexo) return;
    if (pdf?.chave === chave(d)) {
      setPdf(null);
      return;
    }
    const anexo = d.anexo;
    setErro(null);
    setPdf({ chave: chave(d), nome: anexo.nome, url: null, imagem: false, carregando: true });
    startTransition(async () => {
      const r = await urlDoAnexoDaNota(anexo.tabela, anexo.id);
      if (!r.ok) {
        setPdf(null);
        setErro(r.message);
        return;
      }
      setPdf({ chave: chave(d), nome: anexo.nome, url: r.url, imagem: r.imagem, carregando: false });
    });
  }

  async function lerEsta() {
    setLendo(true);
    setErroDaLeitura(null);
    const r = await lerEmLotes([nota.id], () => {});
    setLendo(false);
    if (typeof r === "string") setErroDaLeitura(r);
    else if (r.lidas === 0) setErroDaLeitura([...r.recusadas, ...r.falhas][0]?.motivo ?? "A leitura não foi gravada.");
    router.refresh();
  }

  function ver(d: DocumentoDaNota) {
    if (d.origem === "pp" && d.ppId) {
      const ppId = d.ppId;
      startTransition(async () => {
        const res = await carregarPPParaVisualizar(ppId);
        if (!res.ok) {
          setErro(res.message);
          return;
        }
        setVisualizando({ pp: res.pp, estabelecimentos: res.estabelecimentos, id: ppId });
        setVisorAberto(true);
      });
      return;
    }
    abrirPdf(d);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DrawerContent className="sm:max-w-[620px]">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="flex flex-wrap items-center gap-2.5">
            <FileText className="h-4.5 w-4.5 shrink-0 text-california-red" />
            NF {nota.numero}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            Tomada · emitida em {dataBR(nota.data_emissao)} por {nota.fornecedor.nome}
            {documento}.
          </p>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <div className="space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Documentos desta NF</span>
            <div className="overflow-hidden rounded-xl border border-border">
              {nota.documentos.length === 0 && <div className="px-3.5 py-3 text-[13px] text-muted-foreground">Nenhum documento traz esta nota.</div>}
              {nota.documentos.map((d, idx) => {
                const aberta = (d.origem === "pp" && visorAberto && visualizando?.id === d.ppId) || pdf?.chave === chave(d);
                return (
                  <div
                    key={chave(d)}
                    className={cn("flex items-center gap-3 px-3.5 py-3", idx > 0 && "border-t border-border", aberta && "bg-california-red/[0.04]")}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 items-center gap-2">
                        <OrigemSelo origem={d.origem} />
                        <span className={cn("truncate font-mono text-[13px] font-bold", !d.vale && "text-muted-foreground line-through")}>{d.codigo}</span>
                        <Selo cor={d.cor}>{d.rotuloStatus}</Selo>
                      </span>
                      <span className="truncate text-[12px] text-muted-foreground" title={d.job ? `${d.job.codigo} · ${d.job.nome}` : d.descricao}>
                        {d.job ? (
                          <>
                            <span className="font-mono">{d.job.codigo}</span> · {d.job.nome}
                          </>
                        ) : (
                          <>
                            {ROTULO_DA_ORIGEM[d.origem]}
                            {d.descricao ? ` · ${d.descricao}` : ""}
                          </>
                        )}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className={cn("whitespace-nowrap font-mono text-sm font-bold", !d.vale && "text-muted-foreground line-through")}>{moeda(d.parte)}</span>
                      {Math.abs(d.parte - nota.valor) > 0.004 && <span className="text-[10.5px] text-muted-foreground">neste documento</span>}
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => ver(d)}
                          disabled={isPending}
                          aria-label={d.origem === "pp" ? `Visualizar a ${d.codigo}` : `Ver a NF em ${d.codigo}`}
                          className={cn(
                            "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-white transition-colors hover:border-california-red/40 hover:text-california-red disabled:opacity-60",
                            aberta ? "border-california-red/40 text-california-red" : "border-border text-muted-foreground",
                          )}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left">{d.origem === "pp" ? "Visualizar a PP" : "Ver a NF anexada neste documento"}</TooltipContent>
                    </Tooltip>
                  </div>
                );
              })}
              <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-3.5 py-3">
                <span className="text-xs font-semibold text-muted-foreground">Valor total da NF</span>
                {falta > 0.004 && nota.situacao !== "sem_pp" && (
                  <span className="text-[11.5px] font-semibold text-amber-700">
                    Só {moeda(nota.nasDocumentos)} desta NF estão lançados. Falta lançar {moeda(falta)} em outra PP, desembolso ou prestação.
                  </span>
                )}
                <span className="ml-auto font-mono text-[17px] font-bold tabular-nums">{moeda(nota.valor)}</span>
              </div>
            </div>
          </div>

          {pdf && (
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[12px]">
                <FileText className="h-3.5 w-3.5 text-california-red" />
                <span className="min-w-0 flex-1 truncate font-medium">{pdf.nome}</span>
                <button type="button" onClick={() => setPdf(null)} className="text-[11.5px] font-semibold text-muted-foreground hover:text-california-red">
                  Fechar
                </button>
              </div>
              <div className="h-[420px]">
                {pdf.url ? (
                  <VisualizadorDeArquivo url={pdf.url} nome={pdf.nome} imagem={pdf.imagem} />
                ) : (
                  <div className="flex h-full items-center justify-center text-[12.5px] text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Abrindo o arquivo…
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label>Emitente</Label>
              <div className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 text-[13px] text-muted-foreground">
                <span className="truncate" title={nota.fornecedor.razao_social ?? nota.fornecedor.nome}>
                  {nota.fornecedor.razao_social ?? nota.fornecedor.nome}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>CNPJ tomador</Label>
              <div className="flex h-9 items-center rounded-lg border border-border px-3 text-[13px]">
                {nota.tomador ? (
                  <span className="truncate">
                    {nota.tomador.nome} · {formatCnpj(nota.tomador.cnpj)}
                  </span>
                ) : (
                  <span className="truncate text-muted-foreground">Não informado nesta nota.</span>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="numero-nf-tomada">Nº NF</Label>
              <Input id="numero-nf-tomada" type="text" value={nota.numero} readOnly className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Emissão</Label>
              <div className="flex h-9 items-center rounded-lg border border-border px-3 font-mono text-[13px]">{dataBR(nota.data_emissao)}</div>
            </div>
          </div>

          {/* O que a leitura da NF traz (decisão 271). */}
          <div className="space-y-2.5 rounded-xl border border-border px-4 py-3">
            <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Da leitura da NF
              {nota.leitura.lida && (
                <span
                  title="Preenchido pela leitura automática da NF."
                  className="rounded border border-amber-300 bg-amber-50 px-1 text-[9.5px] font-bold normal-case tracking-normal text-amber-800"
                >
                  IA
                </span>
              )}
            </span>
            {!nota.leitura.lida && (
              <div className="flex items-center gap-2.5">
                <p className="flex-1 text-[12px] text-muted-foreground">Esta nota ainda não foi lida: o CNAE abaixo é o do cadastro do emitente.</p>
                {primeiro?.anexo && (
                  <button
                    type="button"
                    onClick={lerEsta}
                    disabled={lendo}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red disabled:opacity-60"
                  >
                    {lendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-amber-600" />}
                    {lendo ? "Lendo…" : "Ler esta NF"}
                  </button>
                )}
              </div>
            )}
            {erroDaLeitura && (
              <p className="flex items-start gap-1.5 text-[12px] text-california-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {erroDaLeitura}
              </p>
            )}
            <DadoDaLeitura rotulo="Descrição do serviço" valor={nota.leitura.descricao} />
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <DadoDaLeitura
                rotulo="CNAE"
                valor={nota.leitura.cnae ?? (nota.leitura.cnaeDoCadastro ? `${nota.leitura.cnaeDoCadastro} (do cadastro do emitente)` : null)}
                mono
              />
              <DadoDaLeitura rotulo="Código do serviço" valor={nota.leitura.codigoServico} mono />
              <DadoDaLeitura rotulo="Regime do emitente" valor={REGIME[nota.fornecedor.regime ?? ""] ?? null} />
              <DadoDaLeitura rotulo="Município da prestação" valor={nota.leitura.municipio} />
              <DadoDaLeitura
                rotulo="Competência"
                valor={nota.leitura.competencia ? `${nota.leitura.competencia.slice(5, 7)}/${nota.leitura.competencia.slice(0, 4)}` : null}
                mono
              />
              <DadoDaLeitura rotulo="Código de verificação" valor={nota.leitura.codigoVerificacao} mono />
            </div>
            <div className="space-y-1 border-t border-border pt-2.5">
              <span className="text-[11.5px] font-semibold text-muted-foreground">Retenções destacadas na NF</span>
              {nota.leitura.retencoes.length === 0 ? (
                <p className="text-[12.5px] text-muted-foreground">{nota.leitura.lida ? "Nenhuma." : "—"}</p>
              ) : (
                <>
                  {nota.leitura.retencoes.map((r) => (
                    <p key={r.imposto} className="flex justify-between text-[12.5px]">
                      <span>
                        {r.imposto}
                        {r.aliquota != null && <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{r.aliquota.toLocaleString("pt-BR")}%</span>}
                      </span>
                      <span className="font-mono">{moeda(r.valor)}</span>
                    </p>
                  ))}
                  <p className="flex justify-between text-[12.5px] font-semibold">
                    <span>Valor líquido</span>
                    <span className="font-mono">{moeda(nota.leitura.liquido)}</span>
                  </p>
                </>
              )}
            </div>
          </div>

          {nota.registrada_em ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[12.5px] text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Registrada pelo financeiro em {dataBR(nota.registrada_em)}
                {nota.registrada_onde ? `, ${nota.registrada_onde}` : ""}.
              </span>
            </div>
          ) : nota.situacao === "sem_pp" ? (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12.5px] text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Os documentos desta nota foram rejeitados ou cancelados. Ela não foi registrada.</span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-[#fffbeb] px-3 py-2.5 text-[12.5px] text-[#92400e]">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{primeiro ? `Informada no envio de ${primeiro.codigo}.` : "Informada no envio do documento."} O financeiro confere na aprovação.</span>
            </div>
          )}

          {(nota.credito_retirado || nota.iss_retido_aliquota != null) && (
            <div className="space-y-1.5 rounded-xl border border-border bg-muted/30 px-4 py-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">No fiscal</span>
              {nota.iss_retido_aliquota != null && (
                <p className="text-[12.5px]">
                  ISS retido: <span className="font-mono font-semibold">{nota.iss_retido_aliquota.toLocaleString("pt-BR")}%</span> ·{" "}
                  <span className="font-mono">{moeda((nota.valor * nota.iss_retido_aliquota) / 100)}</span>
                </p>
              )}
              {nota.credito_retirado && (
                <p className="flex items-start gap-1.5 text-[12.5px] text-amber-800">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>Crédito de PIS/COFINS retirado{nota.credito_motivo ? `: ${nota.credito_motivo}` : "."}</span>
                </p>
              )}
            </div>
          )}

          {!pdf && primeiro?.anexo && (
            <div className="space-y-1.5">
              <Label>Anexo da NF</Label>
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12.5px]">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate">{primeiro.anexo.nome}</span>
                <button
                  type="button"
                  onClick={() => abrirPdf(primeiro)}
                  disabled={isPending}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red disabled:opacity-60"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Visualizar NF
                </button>
              </div>
            </div>
          )}

          {erro && (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2.5 border-t border-border px-6 py-3.5">
          <p className="text-pretty text-[11.5px] text-muted-foreground">Os dados são os do cadastro da nota — os mesmos em todos os documentos dela.</p>
          <div className="flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border bg-white px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-muted"
            >
              Fechar
            </button>
          </div>
        </div>

        {visualizando && (
          <PPTela
            somenteLeitura
            pp={visualizando.pp}
            estabelecimentos={visualizando.estabelecimentos}
            open={visorAberto}
            onOpenChange={setVisorAberto}
            aoLadoDoPainel={LARGURA_DO_PAINEL}
          />
        )}
      </DrawerContent>
    </Dialog>
  );
}

/** Um dado da leitura da NF, no painel. */
function DadoDaLeitura({ rotulo, valor, mono }: { rotulo: string; valor: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[11.5px] font-semibold text-muted-foreground">{rotulo}</p>
      <p className={cn("truncate text-[13px]", mono && "font-mono text-[12.5px]", !valor && "text-muted-foreground")} title={valor ?? undefined}>
        {valor ?? "—"}
      </p>
    </div>
  );
}
