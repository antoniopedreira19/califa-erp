"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Loader2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  anexarNfColaborador,
  baixarNfColaborador,
} from "@/lib/nf/anexos-actions";
import { janelaDaNf } from "@/lib/folha/janela-pagamento";

const NOMES_MES = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
];

type TipoFolha = "salario" | "ferias" | "13";

interface LinhaHistorico {
  competencia_ano: number;
  competencia_mes: number;
  tipo: TipoFolha;
  nf: { id: string; arquivo_nome: string; uploaded_at: string } | null;
  folha_status: string | null;
  data_pagamento: string | null;
}

export function HistoricoNfModal(props: {
  colaboradorId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [linhas, setLinhas] = React.useState<LinhaHistorico[] | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    if (!props.open) return;
    (async () => {
      const res = await fetch(
        `/api/nf-historico?colaborador=${props.colaboradorId}`,
      );
      if (!res.ok) {
        setErro("Falha ao carregar histórico.");
        return;
      }
      setLinhas(await res.json());
    })();
  }, [props.open, props.colaboradorId]);

  async function baixar(anexoId: string) {
    const r = await baixarNfColaborador(anexoId);
    if (!r.ok) {
      alert(r.message);
      return;
    }
    window.open(r.url, "_blank");
  }

  function anexarPara(ano: number, mes: number) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      startTransition(async () => {
        const buf = await file.arrayBuffer();
        const r = await anexarNfColaborador({
          colaboradorId: props.colaboradorId,
          ano,
          mes,
          arquivoBuffer: buf,
          arquivoNome: file.name,
          arquivoTamanhoBytes: file.size,
        });
        if (!r.ok) {
          setErro(r.message);
          return;
        }
        router.refresh();
        props.onOpenChange(false);
      });
    };
    input.click();
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-4xl w-[95vw] h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-border bg-muted/30 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-california-red/10 text-california-red">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-lg">
                Histórico de Notas Fiscais
              </DialogTitle>
              <DialogDescription className="text-sm">
                Suas NFs por competência. Pode anexar as pendentes direto daqui.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {erro && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {erro}
            </div>
          )}

          {!linhas ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : linhas.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Sem histórico ainda.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Tipo
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Competência
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    NF enviada
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Pagamento
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Status
                  </th>
                  <th className="text-right py-3 px-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const dataPagamento = resolverDataPagamento(l);
                  const statusInfo = statusBadge(l.folha_status, !!l.nf);
                  return (
                    <tr
                      key={`${l.competencia_ano}-${l.competencia_mes}-${l.tipo}`}
                      className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors"
                    >
                      <td className="py-3 px-3">
                        <TipoBadge tipo={l.tipo} />
                      </td>
                      <td className="py-3 px-3 font-medium">
                        {NOMES_MES[l.competencia_mes - 1]}/{l.competencia_ano}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">
                        {l.nf
                          ? new Date(l.nf.uploaded_at).toLocaleDateString(
                              "pt-BR",
                              { day: "2-digit", month: "2-digit", year: "2-digit" },
                            )
                          : "—"}
                      </td>
                      <td className="py-3 px-3 text-muted-foreground">
                        {dataPagamento ?? "—"}
                      </td>
                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusInfo.classe}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        {l.nf ? (
                          <button
                            type="button"
                            onClick={() => baixar(l.nf!.id)}
                            className="inline-flex items-center gap-1 text-xs text-california-red hover:underline"
                          >
                            <Download className="h-3 w-3" />
                            Baixar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              anexarPara(l.competencia_ano, l.competencia_mes)
                            }
                            disabled={pending}
                            className="inline-flex items-center gap-1 text-xs text-california-red hover:underline disabled:opacity-50"
                          >
                            <Upload className="h-3 w-3" />
                            Anexar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resolverDataPagamento(l: LinhaHistorico): string | null {
  // Preferência: data real do banco (férias/13° trazem data_pagamento_prevista).
  if (l.data_pagamento) {
    const [ano, mes, dia] = l.data_pagamento.split("-");
    return `${dia}/${mes}/${ano.slice(2)}`;
  }
  // Fallback para salário sem data gravada: calcula pela janela do upload.
  if (l.nf) {
    const janela = janelaDaNf({
      uploadedAt: l.nf.uploaded_at,
      competenciaAno: l.competencia_ano,
      competenciaMes: l.competencia_mes,
    });
    const [ano, mes, dia] = janela.data_prevista.split("-");
    return `${dia}/${mes}/${ano.slice(2)}`;
  }
  return null;
}

const LABELS_TIPO: Record<TipoFolha, string> = {
  salario: "Salário",
  ferias: "Férias",
  "13": "13°",
};
const CLASSES_TIPO: Record<TipoFolha, string> = {
  salario: "bg-blue-50 text-blue-700 ring-1 ring-blue-200",
  ferias: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  "13": "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
};

function TipoBadge({ tipo }: { tipo: TipoFolha }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${CLASSES_TIPO[tipo]}`}
    >
      {LABELS_TIPO[tipo]}
    </span>
  );
}

function statusBadge(
  folhaStatus: string | null,
  temNf: boolean,
): { label: string; classe: string } {
  if (!folhaStatus) {
    return {
      label: temNf ? "Aguardando RH" : "Aguardando RH",
      classe: "bg-slate-100 text-slate-700",
    };
  }
  switch (folhaStatus) {
    case "rascunho":
      return { label: "Aguardando RH", classe: "bg-slate-100 text-slate-700" };
    case "enviada":
      return {
        label: "Enviada Financeiro",
        classe: "bg-blue-50 text-blue-700",
      };
    case "pendente_correcao":
      return { label: "Em correção", classe: "bg-amber-50 text-amber-700" };
    case "aprovada":
      return { label: "Aprovada", classe: "bg-emerald-50 text-emerald-700" };
    case "paga":
      return { label: "Paga", classe: "bg-emerald-100 text-emerald-800" };
    default:
      return { label: folhaStatus, classe: "bg-slate-100 text-slate-700" };
  }
}
