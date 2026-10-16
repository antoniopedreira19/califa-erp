"use client";

/**
 * A nota já emitida, só leitura — o "NF X emitida" da aba Faturamento.
 *
 * Até a decisão 184 morava dentro do `faturar-drawer.tsx`, como um dos
 * quatro modos do formulário. O formulário de emitir foi redesenhado (drawer
 * que abre a nota ao lado) e a leitura ficou como era: esta é a mesma
 * marcação de antes, só com o que a leitura usa.
 */

import * as React from "react";
import { CheckCircle2, Eye, FileText, AlertCircle } from "lucide-react";
import { Dialog, DrawerContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCnpj } from "@/lib/utils";
import {
  BotaoInfo,
  InfoFaturamentoModal,
  type InfoFaturamento,
} from "@/components/financeiro/info-faturamento-modal";
import { rotuloDoCnae } from "@/lib/fiscal/calculos";
import { rotuloDoEstabelecimento, type FiscalDoFaturar } from "@/lib/fiscal/faturar";
import { urlAnexoNf } from "./actions";
import type { FaturadoRow } from "./faturamento-list";
import type { InfoJob } from "./faturar-drawer";

interface Props {
  nota: FaturadoRow;
  onClose: () => void;
  empresas: Array<{ id: string; nome: string }>;
  infoPorJob: Record<string, InfoJob>;
  fiscal: FiscalDoFaturar;
}

function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarData(iso: string): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

export function NotaEmitidaDrawer({ nota, onClose, empresas, infoPorJob, fiscal }: Props) {
  const cad = fiscal.cadastro;
  const [erro, setErro] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<InfoFaturamento | null>(null);
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);

  const estabDaNota = nota.estabelecimento_id
    ? (cad.estabelecimentos.find((e) => e.id === nota.estabelecimento_id) ?? null)
    : null;
  const cnaeDaNota = nota.fiscal_cnae_id ? (cad.cnaes.find((c) => c.id === nota.fiscal_cnae_id) ?? null) : null;

  // As parcelas REAIS da nota, na ordem em que foram geradas. O fallback só
  // existe para nota antiga sem título vinculado.
  const parcelas =
    nota.parcelas.length > 0
      ? nota.parcelas.map((p) => ({ valor: p.valor, data_vencimento: p.data_vencimento }))
      : [{ valor: nota.valor_total, data_vencimento: nota.primeiro_vencimento ?? nota.data_emissao }];
  const somaParcelas = parcelas.reduce((s, p) => s + p.valor, 0);
  const somaOk = Math.abs(somaParcelas - nota.valor_total) < 0.01;

  const cnpjTexto = nota.cnpj_tomador ? ` · CNPJ ${formatCnpj(nota.cnpj_tomador)}` : "";

  /** O conteúdo do botão `i` de um job da nota. */
  function montarInfo(jobId: string | null, referencia: string, codigoJob: string): InfoFaturamento {
    const dados = jobId ? infoPorJob[jobId] : undefined;
    return {
      referencia,
      pos: [{ job: codigoJob, po: dados?.po ?? null }],
      descricaoNf: dados?.descricaoNf ?? null,
      anexosPo: dados?.anexos ?? [],
      cnpj: null,
      cnaeSugerido: null,
      contatos: dados?.contatos ?? [],
      quebra: null,
    };
  }

  async function alternarPdf() {
    if (pdfUrl) {
      setPdfUrl(null);
      return;
    }
    const res = await urlAnexoNf(nota.anexo_nf_path);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    setPdfUrl(res.url);
  }

  return (
    <>
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
              NF {nota.numero_nf} emitida
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Somente leitura · emitida em {formatarData(nota.data_emissao)} para {nota.contraparte_nome}
              {cnpjTexto}.
            </p>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Jobs nesta NF
                </span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border">
                {nota.itens.map((i, idx) => (
                  <div
                    key={idx}
                    className={cn("flex items-center gap-3 px-3.5 py-3", idx > 0 && "border-t border-border")}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] font-semibold">{i.descricao}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{i.codigo}</span>
                    </div>
                    <span className="whitespace-nowrap font-mono text-sm font-bold">{formatMoney(i.valor)}</span>
                    {/* O item de save aponta para o MESMO job do item
                        próprio: dois botões abririam o mesmo modal. */}
                    {i.origem_tipo !== "save" && i.origem_id && (
                      <BotaoInfo
                        className="shrink-0"
                        onClick={() => setInfo(montarInfo(i.origem_id, `${i.codigo} · ${i.descricao}`, i.codigo))}
                      />
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-3 border-t border-border bg-muted/50 px-3.5 py-3">
                  <span className="text-xs font-semibold text-muted-foreground">Valor total da NF</span>
                  <span className="ml-auto font-mono text-[17px] font-bold tabular-nums">
                    {formatMoney(nota.valor_total)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label>Empresa (gerencial)</Label>
                <Select value={nota.empresa_id} onValueChange={() => undefined} disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a empresa" />
                  </SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <div className="flex h-9 items-center gap-2 rounded-lg border border-dashed border-border bg-muted/50 px-3 text-[13px] text-muted-foreground">
                  <span className="truncate">{nota.contraparte_nome ?? "—"}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>CNPJ emissor</Label>
              <div className="flex h-9 items-center rounded-lg border border-border px-3 text-[13px]">
                {estabDaNota ? (
                  <span className="truncate">{rotuloDoEstabelecimento(estabDaNota)}</span>
                ) : (
                  <span className="truncate text-muted-foreground">Não registrado nesta nota.</span>
                )}
              </div>
            </div>

            {nota.origem_tipo === "avulso" && (
              <div className="space-y-1.5">
                <Label>Rateio de regional</Label>
                {nota.rateio.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {nota.rateio.map((r) => (
                      <span
                        key={r.regional_nome}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-[12.5px]"
                      >
                        {r.regional_nome}
                        <span className="font-mono font-semibold">
                          {r.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                        </span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted-foreground">
                    Nota emitida antes do rateio de regional existir — sem divisão registrada.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="numero-nf">Nº NF</Label>
                <Input id="numero-nf" type="text" value={nota.numero_nf} readOnly className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label>Emissão</Label>
                <div className="flex h-9 items-center rounded-lg border border-border px-3 font-mono text-[13px]">
                  {formatarData(nota.data_emissao)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cnae-nf">CNAE a ser utilizado</Label>
              {/* Na nota emitida, o CNAE da lista por extenso; na nota de
                  antes do módulo fiscal, o texto que foi gravado. */}
              <Input id="cnae-nf" type="text" value={cnaeDaNota ? rotuloDoCnae(cnaeDaNota) : (nota.cnae ?? "")} readOnly />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="descricao-nf">Descrição da NF</Label>
              <textarea
                id="descricao-nf"
                rows={2}
                value={nota.descricao}
                readOnly
                className="w-full resize-none rounded-lg border border-border px-3 py-2.5 text-[13px] focus:border-california-red/40 focus:outline-none"
              />
              <p className="text-[11.5px] text-muted-foreground text-pretty">
                Cada job traz a instrução do seu gerente de projetos — leia uma a uma no botão de informações da linha
                e escreva aqui o texto da nota.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Anexo da NF (PDF)</Label>
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12.5px]">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 truncate">NF-{nota.numero_nf}.pdf</span>
                <button
                  type="button"
                  onClick={alternarPdf}
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors hover:border-california-red hover:text-california-red"
                >
                  <Eye className="h-3.5 w-3.5" />
                  {pdfUrl ? "Ocultar NF" : "Visualizar NF"}
                </button>
              </div>
              {pdfUrl && (
                <iframe src={pdfUrl} title="PDF da nota fiscal" className="h-[260px] w-full rounded-xl border border-border" />
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-border bg-muted/30 px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Parcelas do recebimento desta NF
                </span>
              </div>
              <div className="grid grid-cols-[22px_1fr_1fr_30px] gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <span />
                <span className="text-right">Valor</span>
                <span>Vencimento</span>
                <span />
              </div>
              <div className="space-y-2">
                {parcelas.map((p, i) => (
                  <div key={i} className="grid grid-cols-[22px_1fr_1fr_30px] items-center gap-2">
                    <span className="text-center font-mono text-[11.5px] text-muted-foreground">{i + 1}</span>
                    <div className="flex h-9 items-center justify-end rounded-lg border border-border bg-white px-2.5 font-mono text-[12.5px] font-semibold">
                      {formatMoney(p.valor)}
                    </div>
                    <div className="flex h-9 items-center rounded-lg border border-border bg-white px-2.5 font-mono text-[12.5px]">
                      {formatarData(p.data_vencimento)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2.5 border-t border-border pt-3">
                <span className={cn("ml-auto text-[11.5px] font-semibold", somaOk ? "text-emerald-700" : "text-california-red")}>
                  Soma {formatMoney(somaParcelas)} / NF {formatMoney(nota.valor_total)}
                </span>
              </div>
            </div>

            {erro && (
              <div className="flex items-start gap-2 rounded-lg border border-california-red/35 bg-california-red/[0.06] px-3 py-2.5 text-[12.5px] text-california-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2.5 border-t border-border px-6 py-3.5">
            <p className="text-[11.5px] text-muted-foreground text-pretty">
              NF já emitida — os jobs receberam a baixa do valor faturado e as parcelas estão em Títulos a Receber.
            </p>
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
        </DrawerContent>
      </Dialog>

      {/* Fora do <Dialog> do drawer: o modal abre POR CIMA sem fechá-lo. */}
      <InfoFaturamentoModal
        info={info}
        onOpenChange={(aberto) => {
          if (!aberto) setInfo(null);
        }}
      />
    </>
  );
}
