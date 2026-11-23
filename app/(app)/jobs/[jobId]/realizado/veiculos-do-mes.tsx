"use client";

/**
 * Os veículos de cada mês do job de Mídia Off (decisão 274), no pé do mês
 * da planilha: uma linha por veículo, com AP, PI, a NF do veículo e o BV.
 *
 * Regras do Tiago (15/10 e 23/11/2026): AP e PI por veículo e mês (a
 * veiculação só acontece com os dois); AP, PI e a NF do veículo liberam o
 * envio do mês ao faturamento — no A · Repasse a NF chega pela PP do
 * repasse; o BV é negociado com o veículo, por mês, segue o fluxo do BV de
 * hoje e trava o encerramento até ser recebido. O mês enviado não muda.
 * Anexam administrador, GP e produtor; o BV é de quem mexe no job.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, Lock, Upload } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { MoedaInput } from "@/components/ui/moeda-input";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalhaAcoes } from "@/app/(app)/_planilha/calha-acoes";
import { corDoDelta } from "@/app/(app)/_planilha/blocos";
import { acaoBv } from "@/app/(app)/_bv/bv-action-button";
import { BvDialog, type FornecedorOpcao } from "@/app/(app)/_bv/bv-dialog";
import type { BvSituacao, ChaveBvNoDialog, ItemBv, ItemPlanilhaJob } from "@/lib/types";
import { bvSituacaoLabel } from "@/lib/types";
import {
  listaDoQueFalta,
  nomeDoMesMidia,
  type SituacaoDoRepasse,
  type VeiculoNoMes,
} from "@/lib/calculos/midia-off";
import {
  BUCKET_DA_MIDIA,
  EXTENSOES_DO_DOCUMENTO,
  NOME_DO_DOCUMENTO,
  recusaDoDocumento,
  type DocumentoDaMidia,
  type TipoDocumentoMidia,
} from "@/lib/midia/documentos";
import {
  descartarArquivoDaMidia,
  removerDocumentoDaMidia,
  reservarDocumentoDaMidia,
  salvarDocumentoDaMidia,
  urlDoDocumentoDaMidia,
} from "./actions-midia-documentos";

const brl = (v: number) => formatCurrency(v, "BRL");
const comSinal = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${brl(Math.abs(v))}`;

function dataBr(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

function nomeCurtoDoMes(mes: string): string {
  return nomeDoMesMidia(mes).split(" ")[0].toLowerCase();
}

type Veiculo = VeiculoNoMes<DocumentoDaMidia>;

/** O BV do veículo no mês, como a tela do job o enxerga. */
export interface BvDoVeiculo {
  /** A linha onde o BV mora (o BV do sistema pendura numa linha do job). */
  ancora: ItemPlanilhaJob;
  bvs: ItemBv[];
}

export interface PropsDosVeiculos {
  jobId: string;
  /** `YYYY-MM-01`. */
  mes: string;
  veiculos: Veiculo[];
  nomeDoVeiculo: (id: string) => string;
  /** O mês já foi ao faturamento (pela produção ou pelo financeiro): o
   *  card vira consulta. `null` quando ainda não foi. */
  enviado: { em: string | null } | null;
  /** A leitura dos documentos falhou: nada se anexa, e o envio trava. */
  leituraFalhou: boolean;
  /** A nota do veículo no planejado inicial (decisão 275); a extensão
   *  não entra. */
  notaPlanejada: (v: Veiculo) => number;
  podeAnexar: boolean;
  /** BV: o que a tela do job sabe para abrir o formulário de sempre. */
  bv: {
    doVeiculo: (v: Veiculo) => BvDoVeiculo | null;
    fornecedores: FornecedorOpcao[];
    percentualImposto: number;
    versaoLabel: string;
    podeLancar: boolean;
    podeConfirmar: boolean;
  };
}

// ---- Pop-up do documento (AP, PI, NF) -------------------------------------

function DocumentoDialog({
  jobId,
  tipo,
  veiculo,
  nome,
  doc,
  podeEditar,
  onFechar,
}: {
  jobId: string;
  tipo: TipoDocumentoMidia;
  veiculo: Veiculo;
  nome: string;
  doc: DocumentoDaMidia | null;
  podeEditar: boolean;
  onFechar: () => void;
}) {
  const router = useRouter();
  const nomeMes = nomeCurtoDoMes(veiculo.mes);
  const nf = tipo === "nf";
  const [numero, setNumero] = React.useState(doc?.numero ?? "");
  const [valor, setValor] = React.useState<number>(doc?.valor ?? veiculo.notaDireto);
  const [data, setData] = React.useState<string | null>(doc?.dataEmissao ?? null);
  /** O arquivo novo, já no bucket, ainda sem linha. */
  const [novo, setNovo] = React.useState<{ path: string; nome: string; tamanho: number; tipo: string | null } | null>(
    null,
  );
  const [enviando, setEnviando] = React.useState(false);
  const [salvando, setSalvando] = React.useState(false);
  const [perguntaRemover, setPerguntaRemover] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const diferenca = Math.round((valor - veiculo.notaDireto) * 100) / 100;
  const temArquivo = novo !== null || doc !== null;
  const pode =
    podeEditar &&
    !enviando &&
    !salvando &&
    temArquivo &&
    numero.trim() !== "" &&
    (!nf || (valor > 0 && !!data)) &&
    // Sem arquivo novo, só vale salvar se algo mudou.
    (novo !== null || numero.trim() !== doc?.numero || (nf && (valor !== doc?.valor || data !== doc?.dataEmissao)));

  function fechar() {
    // O arquivo que subiu e não foi salvo sai do bucket.
    if (novo) void descartarArquivoDaMidia(jobId, novo.path).catch(() => undefined);
    onFechar();
  }

  async function escolher(file: File) {
    setErro(null);
    const recusa = recusaDoDocumento(file.name, file.size);
    if (recusa) {
      setErro(recusa);
      return;
    }
    setEnviando(true);
    try {
      const reserva = await reservarDocumentoDaMidia(jobId, { nome: file.name, tamanho: file.size });
      if (!reserva.ok) {
        setErro(reserva.message);
        return;
      }
      const { error } = await createClient()
        .storage.from(BUCKET_DA_MIDIA)
        .upload(reserva.path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (error) {
        console.error("[midia.documentos.enviar]", error.message);
        setErro(`${file.name}: não foi possível enviar. Confira a conexão e tente de novo.`);
        return;
      }
      if (novo) void descartarArquivoDaMidia(jobId, novo.path).catch(() => undefined);
      setNovo({ path: reserva.path, nome: file.name, tamanho: file.size, tipo: file.type || null });
    } finally {
      setEnviando(false);
    }
  }

  async function salvar() {
    // Sem arquivo novo, o de antes fica (só o número, o valor ou a data
    // mudaram): o servidor reconhece o caminho e não mexe no arquivo.
    const arquivo = novo ?? (doc ? { path: doc.path, nome: doc.nomeArquivo, tamanho: 0, tipo: null } : null);
    if (!arquivo) return;
    setErro(null);
    setSalvando(true);
    const res = await salvarDocumentoDaMidia(jobId, {
      fornecedorId: veiculo.veiculoId,
      mes: veiculo.mes,
      tipo,
      numero: numero.trim(),
      valor: nf ? valor : null,
      dataEmissao: nf ? data : null,
      arquivo,
    });
    setSalvando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setNovo(null);
    onFechar();
    router.refresh();
  }

  async function remover() {
    if (!doc) return;
    setErro(null);
    setSalvando(true);
    const res = await removerDocumentoDaMidia(jobId, doc.id);
    setSalvando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onFechar();
    router.refresh();
  }

  async function abrir() {
    if (!doc) return;
    const res = await urlDoDocumentoDaMidia(jobId, doc.path);
    if (res.ok) window.open(res.url, "_blank", "noopener,noreferrer");
    else setErro(res.message);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-california-red/10 p-2">
              <FileText className="h-4 w-4 text-california-red" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-[19px]">
                {doc ? NOME_DO_DOCUMENTO[tipo] : `Anexar ${NOME_DO_DOCUMENTO[tipo]}`} · {nome}
              </DialogTitle>
              <DialogDescription className="pt-1.5 text-[13px] leading-relaxed">
                {nf
                  ? `A nota que o veículo emitiu ao cliente pela veiculação de ${nomeMes} no A · Direto. O valor se confere com a nota do veículo no mês.`
                  : `O ${NOME_DO_DOCUMENTO[tipo]} do veículo para ${nomeMes}. Sem ele o mês não vai ao faturamento.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="doc-numero">{nf ? "Número da NF" : `Número do ${NOME_DO_DOCUMENTO[tipo]}`}</Label>
            <Input
              id="doc-numero"
              value={numero}
              maxLength={60}
              disabled={!podeEditar}
              onChange={(ev) => setNumero(ev.target.value)}
              placeholder={nf ? "Ex.: 1.284" : "Ex.: 0042/26"}
            />
          </div>
          {nf && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Data de emissão</Label>
                <DatePicker
                  name="doc-data"
                  defaultValue={data ?? undefined}
                  disabled={!podeEditar}
                  placeholder="Escolher"
                  onDateChange={(d) =>
                    setData(
                      d
                        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
                        : null,
                    )
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="doc-valor">Valor da NF</Label>
                <MoedaInput
                  id="doc-valor"
                  defaultValue={valor > 0 ? valor.toFixed(2) : ""}
                  disabled={!podeEditar}
                  onCentavosChange={(c) => setValor(Number(c || "0") / 100)}
                />
              </div>
            </div>
          )}
          {nf && (
            <div
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12px]",
                diferenca === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-900",
              )}
            >
              {diferenca === 0 ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
              )}
              <span>
                Nota do veículo em {nomeMes} (A · Direto):{" "}
                <strong className="font-mono">{brl(veiculo.notaDireto)}</strong>
                {diferenca === 0
                  ? ". A NF bate."
                  : `. A NF está ${comSinal(diferenca)} ${diferenca > 0 ? "acima" : "abaixo"}: confira as inserções antes de enviar o mês.`}
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Arquivo</Label>
            {temArquivo ? (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-[12.5px]">
                  <FileText className="h-3.5 w-3.5 flex-none text-muted-foreground" />
                  <span className="truncate">{novo?.nome ?? doc?.nomeArquivo}</span>
                </span>
                <span className="flex flex-none items-center gap-3">
                  {doc && !novo && (
                    <button
                      type="button"
                      onClick={abrir}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-california-red"
                    >
                      <ExternalLink className="h-3 w-3" /> Abrir
                    </button>
                  )}
                  {podeEditar && (
                    <button
                      type="button"
                      disabled={enviando}
                      onClick={() => inputRef.current?.click()}
                      className="text-xs font-semibold text-muted-foreground hover:text-california-red disabled:opacity-50"
                    >
                      Trocar
                    </button>
                  )}
                </span>
              </div>
            ) : (
              <button
                type="button"
                disabled={!podeEditar || enviando}
                onClick={() => inputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-white px-3 py-4 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red disabled:opacity-50"
              >
                {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {enviando ? "Enviando…" : "Escolher arquivo (PDF ou imagem)"}
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={EXTENSOES_DO_DOCUMENTO.join(",")}
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = "";
                if (f) void escolher(f);
              }}
            />
            {doc && !novo && (
              <p className="text-[11px] text-muted-foreground">
                Anexado em {dataBr(doc.criadoEm)}
                {doc.criadoPorNome ? ` por ${doc.criadoPorNome}` : ""}.
              </p>
            )}
          </div>
          {erro && (
            <p className="rounded-lg border border-california-red/25 bg-california-red/5 px-3 py-2 text-[12px] text-california-red">
              {erro}
            </p>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div>
            {doc && podeEditar && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={salvando}
                onClick={() => (perguntaRemover ? void remover() : setPerguntaRemover(true))}
                className={cn(perguntaRemover && "text-california-red")}
              >
                {perguntaRemover ? `Remover o ${NOME_DO_DOCUMENTO[tipo]} de vez` : "Remover"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={fechar}>
              {podeEditar ? "Cancelar" : "Fechar"}
            </Button>
            {podeEditar && (
              <Button type="button" disabled={!pode} onClick={() => void salvar()}>
                {salvando ? "Salvando…" : doc ? "Salvar" : "Anexar"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- O card ----------------------------------------------------------------

function BotaoAnexar({ onClick, rotulo = "Anexar" }: { onClick: () => void; rotulo?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-dashed border-california-red bg-california-red/5 px-2.5 py-1 text-[11px] font-semibold text-california-red transition-colors hover:bg-california-red/10"
    >
      <Upload className="h-3 w-3" />
      {rotulo}
    </button>
  );
}

function ChipDoc({ rotulo, aviso, titulo, onClick }: { rotulo: string; aviso: boolean; titulo: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-lg border bg-white px-2 py-1 text-[11px] font-semibold transition-colors hover:border-[#d7d7d7]",
        aviso ? "border-amber-300 text-amber-900" : "border-border text-foreground",
      )}
    >
      {aviso ? (
        <AlertTriangle className="h-3 w-3 flex-none text-amber-600" />
      ) : (
        <CheckCircle2 className="h-3 w-3 flex-none text-emerald-600" />
      )}
      <span className="truncate">{rotulo}</span>
    </button>
  );
}

const TEXTO_DO_REPASSE: Record<SituacaoDoRepasse, { texto: string; cor: string; ok: boolean }> = {
  a_gerar: { texto: "Vem pela PP do repasse: falta gerar", cor: "text-california-red", ok: false },
  a_enviar: { texto: "Vem pela PP do repasse: falta enviar", cor: "text-amber-700", ok: false },
  por_fechar: { texto: "Vem pela PP do repasse: falta a última PP", cor: "text-amber-700", ok: false },
  enviada: { texto: "Na PP do repasse (enviada)", cor: "text-emerald-700", ok: true },
  paga: { texto: "Na PP do repasse (paga)", cor: "text-emerald-700", ok: true },
};

const ORDEM_BV: BvSituacao[] = ["a_negociar", "confirmado", "recebido", "cancelado"];
const COR_BV: Record<BvSituacao, string> = {
  a_negociar: "text-amber-700",
  confirmado: "text-foreground",
  recebido: "text-emerald-700",
  cancelado: "text-muted-foreground",
};

export function VeiculosDoMes({
  jobId,
  mes,
  veiculos,
  nomeDoVeiculo,
  enviado,
  leituraFalhou,
  notaPlanejada,
  podeAnexar,
  bv,
}: PropsDosVeiculos) {
  const [aberto, setAberto] = React.useState<{ tipo: TipoDocumentoMidia; veiculo: Veiculo } | null>(null);
  const [bvAberto, setBvAberto] = React.useState<Veiculo | null>(null);
  if (veiculos.length === 0) return null;
  const nomeMes = nomeCurtoDoMes(mes);
  const editavel = podeAnexar && enviado === null && !leituraFalhou;
  const totalFalta = veiculos.reduce((s, v) => s + v.falta.length, 0);
  const th = "px-3 py-2 text-left font-semibold";

  return (
    <section className="rounded-2xl border border-border bg-card shadow-soft">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
          <h3 className="text-[13.5px] font-bold tracking-[-0.01em]">Veículos de {nomeMes}</h3>
          <span className="text-[11.5px] text-muted-foreground">
            AP, PI e a NF de cada veículo liberam o envio de {nomeMes} ao faturamento. O BV é por veículo, no mês.
          </span>
        </div>
        {leituraFalhou ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-california-red">
            <AlertTriangle className="h-3.5 w-3.5" /> Não foi possível ler os documentos. Recarregue a página.
          </span>
        ) : enviado ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            {enviado.em ? `Enviado ao faturamento em ${dataBr(enviado.em)}` : "Faturado pelo financeiro"}
          </span>
        ) : totalFalta === 0 ? (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Documentos completos
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-california-red">
            <AlertTriangle className="h-3.5 w-3.5" />
            {totalFalta === 1 ? "Falta 1 documento" : `Faltam ${totalFalta} documentos`}
          </span>
        )}
      </header>
      <div className="relative overflow-x-auto rounded-b-2xl">
        <table className="w-full min-w-[1180px] table-fixed border-collapse text-sm">
          <colgroup>
            <col />
            <col style={{ width: 124 }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 128 }} />
            <col style={{ width: 132 }} />
            <col style={{ width: 132 }} />
            <col style={{ width: 196 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 168 }} />
          </colgroup>
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className={th}>Veículo</th>
              <th className={th}>Tipo</th>
              <th className={cn(th, "text-right")}>Nota planejada</th>
              <th className={cn(th, "text-right")}>Nota realizada</th>
              <th className={th}>AP</th>
              <th className={th}>PI</th>
              <th className={th}>NF do veículo</th>
              <th className={th}>BV</th>
              <th className={th}>Para o faturamento</th>
            </tr>
          </thead>
          <tbody>
            {veiculos.map((v) => {
              const nome = nomeDoVeiculo(v.veiculoId);
              const semVeiculacao = !(v.nota > 0.004);
              const cel = "px-3 py-2.5 align-top text-[12px]";
              const slot = (tipo: "ap" | "pi") => {
                const doc = v[tipo];
                if (semVeiculacao && !doc) return <span className="text-[11.5px] text-muted-foreground">—</span>;
                if (!doc) {
                  return editavel ? (
                    <BotaoAnexar onClick={() => setAberto({ tipo, veiculo: v })} />
                  ) : (
                    <span className="text-[11.5px] text-muted-foreground">Não anexado</span>
                  );
                }
                // Decisão 275: o documento de antes da extensão não a cobre.
                const antes = tipo === "ap" ? v.apAntesDaExtensao : v.piAntesDaExtensao;
                return (
                  <div className="space-y-1">
                    <ChipDoc
                      rotulo={doc.numero}
                      aviso={antes}
                      titulo={antes ? `Anexado antes da extensão: anexe o ${tipo.toUpperCase()} da extensão.` : doc.nomeArquivo}
                      onClick={() => setAberto({ tipo, veiculo: v })}
                    />
                    {antes && editavel && (
                      <BotaoAnexar rotulo="Da extensão" onClick={() => setAberto({ tipo, veiculo: v })} />
                    )}
                  </div>
                );
              };
              const doBv = bv.doVeiculo(v);
              const ativos = (doBv?.bvs ?? []).filter((b) => b.situacao !== "cancelado");
              const somaBv = ativos.reduce((s, b) => s + Number(b.valor ?? 0), 0);
              const situacaoBv = ativos.length
                ? ativos.map((b) => b.situacao).sort((a, b) => ORDEM_BV.indexOf(a) - ORDEM_BV.indexOf(b))[0]
                : null;
              const repasse = v.repasse ? TEXTO_DO_REPASSE[v.repasse] : null;
              return (
                <tr key={v.veiculoId} className="border-t border-t-border/70">
                  <td className={cel}>
                    <TruncateTooltip text={nome} linhas={2} className="font-medium text-foreground" />
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {v.meios.join(", ")}
                      {v.meios.length ? " · " : ""}
                      {v.linhaIds.length} {v.linhaIds.length === 1 ? "linha" : "linhas"}
                    </div>
                  </td>
                  <td className={cel}>
                    <div className="flex flex-wrap gap-1">
                      {v.tipos.map((t) => (
                        <Badge key={t} variant="outline" className="whitespace-nowrap px-1.5 text-[10.5px]">
                          {t === "AR" ? "A · Repasse" : "A · Direto"}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className={cn(cel, "text-right font-mono text-[11.5px] text-muted-foreground")}>
                    {notaPlanejada(v) ? brl(notaPlanejada(v)) : "—"}
                  </td>
                  <td className={cn(cel, "text-right font-mono text-[11.5px]")}>
                    <div className="font-semibold text-foreground">{brl(v.nota)}</div>
                    {(() => {
                      const delta = Math.round((v.nota - notaPlanejada(v)) * 100) / 100;
                      return delta !== 0 ? (
                        <div className={cn("text-[10.5px] font-semibold", corDoDelta(delta))}>{comSinal(delta)}</div>
                      ) : null;
                    })()}
                  </td>
                  <td className={cel}>{slot("ap")}</td>
                  <td className={cel}>{slot("pi")}</td>
                  <td className={cel}>
                    <div className="space-y-1">
                      {v.tipos.includes("A") &&
                        (semVeiculacao && !v.nf ? (
                          <span className="text-[11.5px] text-muted-foreground">—</span>
                        ) : v.nf ? (
                          <ChipDoc
                            rotulo={`NF ${v.nf.numero} · ${brl(v.nf.valor ?? 0)}`}
                            aviso={Math.round(((v.nf.valor ?? 0) - v.notaDireto) * 100) !== 0}
                            titulo={v.nf.nomeArquivo}
                            onClick={() => setAberto({ tipo: "nf", veiculo: v })}
                          />
                        ) : editavel ? (
                          <BotaoAnexar rotulo="Anexar NF" onClick={() => setAberto({ tipo: "nf", veiculo: v })} />
                        ) : (
                          <span className="text-[11.5px] text-muted-foreground">Não anexada</span>
                        ))}
                      {repasse && (
                        <div className={cn("text-[11px] font-semibold leading-snug", repasse.cor)}>
                          {repasse.ok && <CheckCircle2 className="mr-1 inline h-3 w-3 align-[-2px]" />}
                          {repasse.texto}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className={cel}>
                    {doBv && situacaoBv ? (
                      <button
                        type="button"
                        onClick={() => setBvAberto(v)}
                        className="inline-flex flex-col items-start rounded-lg border border-border bg-white px-2 py-1 text-left transition-colors hover:border-[#d7d7d7]"
                      >
                        <span className="font-mono text-[11.5px] font-semibold text-foreground">{brl(somaBv)}</span>
                        <span className={cn("text-[10.5px] font-semibold", COR_BV[situacaoBv])}>
                          {ativos.length > 1 ? `${ativos.length} BVs · ` : ""}
                          {bvSituacaoLabel(situacaoBv)}
                        </span>
                      </button>
                    ) : doBv && bv.podeLancar ? (
                      <CalhaAcoes
                        acoes={[
                          acaoBv({
                            temBv: false,
                            itemNome: `${nome} em ${nomeMes}`,
                            onClick: () => setBvAberto(v),
                          }),
                        ]}
                      />
                    ) : (
                      <span className="text-[11.5px] text-muted-foreground">Sem BV</span>
                    )}
                  </td>
                  <td className={cel}>
                    {enviado ? (
                      <span className="text-[11.5px] font-semibold text-muted-foreground">Enviado</span>
                    ) : semVeiculacao ? (
                      <span className="text-[11.5px] text-muted-foreground">Sem veiculação no mês</span>
                    ) : v.falta.length === 0 ? (
                      <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Pronto
                      </span>
                    ) : (
                      <span className="text-[11.5px] font-semibold leading-snug text-california-red">
                        Falta {listaDoQueFalta(v.falta)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {aberto && (
        <DocumentoDialog
          jobId={jobId}
          tipo={aberto.tipo}
          veiculo={aberto.veiculo}
          nome={nomeDoVeiculo(aberto.veiculo.veiculoId)}
          doc={aberto.veiculo[aberto.tipo]}
          podeEditar={editavel}
          onFechar={() => setAberto(null)}
        />
      )}

      {bvAberto &&
        (() => {
          const doBv = bv.doVeiculo(bvAberto);
          if (!doBv) return null;
          const nome = nomeDoVeiculo(bvAberto.veiculoId);
          const ancora = doBv.ancora;
          const chaveDoItem: ChaveBvNoDialog = ancora.item_versao_id
            ? { espaco: "versao", id: ancora.item_versao_id }
            : { espaco: "job", id: ancora.id };
          return (
            <BvDialog
              open
              onOpenChange={(o) => !o && setBvAberto(null)}
              // O formulário de sempre, sobre o veículo no mês: o "orçado" é
              // o negociado do veículo no mês, e o planejado e o realizado,
              // a nota dele.
              item={{
                id: ancora.id,
                item: `${nome} em ${nomeMes}`,
                tipo_custo: ancora.tipo_custo,
                categoria_id: null,
                valor_unitario_orcado: bvAberto.negociado,
                quantidade_orcada: 1,
                dias_meses_orcado: 1,
                total_orcado: bvAberto.negociado,
                valor_unitario_planejado: bvAberto.nota,
                quantidade_planejada: 1,
                dias_meses_planejado: 1,
                total_planejado: bvAberto.nota,
              }}
              chaveDoItem={chaveDoItem}
              grupoNome={bvAberto.meios.join(", ")}
              versaoLabel={bv.versaoLabel}
              categoriaNome={null}
              moeda="BRL"
              bvs={doBv.bvs.filter((b) => b.situacao !== "cancelado")}
              fornecedores={bv.fornecedores}
              percentualImposto={bv.percentualImposto}
              origem="job"
              realizado={{ valorUnitario: bvAberto.nota, quantidade: 1, diasMeses: 1, total: bvAberto.nota }}
              readOnly={!bv.podeLancar}
              podeConfirmar={bv.podeLancar && bv.podeConfirmar}
              fornecedorPadrao={bvAberto.veiculoId}
            />
          );
        })()}
    </section>
  );
}
