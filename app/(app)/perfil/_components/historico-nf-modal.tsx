"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Upload } from "lucide-react";
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

interface LinhaHistorico {
  competencia_ano: number;
  competencia_mes: number;
  nf: { id: string; arquivo_nome: string; uploaded_at: string } | null;
  folha_status: string | null;
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
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico de Notas Fiscais</DialogTitle>
          <DialogDescription>
            Suas NFs por competência. Pode anexar as pendentes direto daqui.
          </DialogDescription>
        </DialogHeader>

        {erro && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {erro}
          </div>
        )}

        {!linhas ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sem histórico ainda.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr>
                <th className="text-left py-2 font-medium">Competência</th>
                <th className="text-left py-2 font-medium">NF enviada</th>
                <th className="text-left py-2 font-medium">Janela</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const janela = l.nf
                  ? janelaDaNf({
                      uploadedAt: l.nf.uploaded_at,
                      competenciaAno: l.competencia_ano,
                      competenciaMes: l.competencia_mes,
                    })
                  : null;
                return (
                  <tr
                    key={`${l.competencia_ano}-${l.competencia_mes}`}
                    className="border-b border-border"
                  >
                    <td className="py-2">
                      {NOMES_MES[l.competencia_mes - 1]}/{l.competencia_ano}
                    </td>
                    <td className="py-2">
                      {l.nf
                        ? new Date(l.nf.uploaded_at).toLocaleDateString("pt-BR")
                        : "—"}
                    </td>
                    <td className="py-2">
                      {janela
                        ? `${janela.janela === "salarios" ? "Salários" : "Fornecedores"} (${janela.data_prevista})`
                        : "—"}
                    </td>
                    <td className="py-2">{labelStatus(l.folha_status, !!l.nf)}</td>
                    <td className="py-2 text-right">
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
                          className="inline-flex items-center gap-1 text-xs text-california-red hover:underline"
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
      </DialogContent>
    </Dialog>
  );
}

function labelStatus(folhaStatus: string | null, temNf: boolean): string {
  if (!folhaStatus && temNf) return "Aguardando folha";
  if (!folhaStatus) return "Aguardando RH";
  switch (folhaStatus) {
    case "rascunho":
    case "enviada":
      return "Aguardando aprovação";
    case "pendente_correcao":
      return "Em correção";
    case "aprovada":
      return "Aprovada";
    case "paga":
      return "Paga";
    default:
      return folhaStatus;
  }
}
