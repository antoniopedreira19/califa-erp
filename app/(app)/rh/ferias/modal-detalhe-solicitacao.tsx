"use client";

import * as React from "react";
import {
  Loader2,
  AlertCircle,
  Check,
  X,
  Palmtree,
  FileText,
  TrendingDown,
  Info,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { tipoContratacaoLabel } from "@/lib/types";
import type { SolicitacaoRow } from "./aba-fluxo";
import {
  aprovarLancamento,
  reprovarLancamento,
  previewValoresFerias,
} from "./actions";

type Props = {
  row: SolicitacaoRow;
  onFechar: () => void;
  onSucesso: () => void;
};

type ValoresPreview = {
  valor_base_remuneracao: number;
  valor_ferias: number;
  valor_um_terco: number;
  valor_abono: number;
  valor_total: number;
};

type Preview = {
  valores: ValoresPreview | null;
  valores_clt: ValoresPreview | null;
};

export function ModalDetalheSolicitacao({ row, onFechar, onSucesso }: Props) {
  const [carregando, setCarregando] = React.useState(true);
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [erroCalc, setErroCalc] = React.useState<string | null>(null);
  const [modoReprovar, setModoReprovar] = React.useState(false);
  const [motivo, setMotivo] = React.useState("");
  const [enviando, setEnviando] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

  React.useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      setErroCalc(null);
      const res = await previewValoresFerias(row.id);
      if (!vivo) return;
      if (!res.ok) {
        setErroCalc(res.message);
        setCarregando(false);
        return;
      }
      setPreview({ valores: res.valores, valores_clt: res.valores_clt });
      setCarregando(false);
    })();
    return () => {
      vivo = false;
    };
  }, [row.id]);

  async function handleAprovar() {
    setEnviando(true);
    setErro(null);
    const res = await aprovarLancamento(row.id);
    setEnviando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onSucesso();
  }

  async function handleReprovar() {
    setEnviando(true);
    setErro(null);
    const res = await reprovarLancamento({
      lancamento_id: row.id,
      motivo,
    });
    setEnviando(false);
    if (!res.ok) {
      setErro(res.message);
      return;
    }
    onSucesso();
  }

  const pendente = row.status === "pendente_aprovacao";
  const regimeLabel = tipoContratacaoLabel(row.tipo_contratacao);
  const inicio = new Date(row.data_inicio + "T00:00:00").toLocaleDateString(
    "pt-BR",
  );
  const fim = new Date(row.data_fim + "T00:00:00").toLocaleDateString("pt-BR");
  const diasFolga = row.dias - row.dias_abono;
  const hibrido = row.tipo_contratacao === "clt_recibo";

  // Lista de NFs que vão ser geradas (parte California / PJ)
  const nfs: Array<{ rotulo: string; valor: number }> = [];
  if (preview?.valores) {
    const v = preview.valores;
    if (row.tipo === "usufruto") {
      nfs.push({
        rotulo: "NF de férias (usufruto + 1/3)",
        valor: v.valor_ferias + v.valor_um_terco,
      });
    } else if (
      row.tipo === "abono_avulso" ||
      row.tipo === "abono_excepcional"
    ) {
      nfs.push({ rotulo: "NF de abono", valor: v.valor_abono });
    } else if (row.tipo === "abono_combinado") {
      nfs.push({
        rotulo: "NF de férias (usufruto + 1/3)",
        valor: v.valor_ferias + v.valor_um_terco,
      });
      nfs.push({ rotulo: "NF de abono", valor: v.valor_abono });
    }
  }

  const descontaFolhaMensal =
    row.tipo === "usufruto" || row.tipo === "abono_combinado";

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row.nome}</DialogTitle>
          <DialogDescription>
            {regimeLabel}
            {row.funcao && <> · {row.funcao}</>}
            {" · "}
            {row.dias} dia{row.dias === 1 ? "" : "s"} · {inicio} → {fim}
          </DialogDescription>
        </DialogHeader>

        {/* Conteúdo */}
        <div className="space-y-4">
          {carregando ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : erroCalc ? (
            <div className="flex items-start gap-2 rounded-lg border border-california-red/20 bg-california-red/5 px-3 py-2 text-sm text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Não foi possível calcular os valores: {erroCalc}</span>
            </div>
          ) : (
            <>
              {/* Valores */}
              {preview?.valores && (
                <BlocoValores
                  titulo="Valores a pagar (parte California)"
                  valores={preview.valores}
                  tipo={row.tipo}
                  dias={row.dias}
                  diasFolga={diasFolga}
                  diasAbono={row.dias_abono}
                />
              )}

              {/* Parte CLT do híbrido (estimativa) */}
              {hibrido && preview?.valores_clt && (
                <BlocoValores
                  titulo="Parte CLT (estimativa, folha pela contabilidade)"
                  valores={preview.valores_clt}
                  tipo={row.tipo}
                  dias={row.dias}
                  diasFolga={diasFolga}
                  diasAbono={row.dias_abono}
                  variantSecundario
                />
              )}

              {/* NFs */}
              {nfs.length > 0 && (
                <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-sky-900 mb-2 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    NFs que o colaborador vai emitir ao ser aprovado
                  </p>
                  <ul className="space-y-1.5">
                    {nfs.map((nf, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="text-sky-900">{nf.rotulo}</span>
                        <span className="font-mono font-semibold text-sky-900">
                          R$ {formatarValor(nf.valor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Alerta desconto da folha mensal */}
              {descontaFolhaMensal && diasFolga > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 flex gap-3">
                  <TrendingDown className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1 text-sm text-amber-900">
                    <p className="font-semibold">
                      Folha mensal será ajustada automaticamente
                    </p>
                    <p className="text-xs mt-1 opacity-90">
                      Ao aprovar, a folha mensal do mês {" "}
                      {inicio.slice(3)} desconta{" "}
                      <strong>{diasFolga} dia{diasFolga === 1 ? "" : "s"}</strong>{" "}
                      do salário (não paga duplicado pelos dias de férias).
                      Esse ajuste só vale se a folha ainda estiver em
                      rascunho — se já foi enviada, o RH precisa editar
                      manualmente.
                    </p>
                  </div>
                </div>
              )}

              {/* Info de abono puro */}
              {row.tipo === "abono_avulso" ||
              row.tipo === "abono_excepcional" ? (
                <div className="rounded-xl border border-border bg-muted/30 p-4 flex gap-3 text-xs text-muted-foreground">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <p>
                    Abono é venda de dias de férias futuras — o colaborador
                    continua trabalhando. A folha mensal paga normal e o abono
                    vem na NF à parte.
                  </p>
                </div>
              ) : null}
            </>
          )}

          {/* Modo reprovar: textarea */}
          {modoReprovar && (
            <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
              <Label htmlFor="motivo-reprovar">
                Motivo da reprovação{" "}
                <span className="text-muted-foreground">
                  (pelo menos 3 caracteres)
                </span>
              </Label>
              <Textarea
                id="motivo-reprovar"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Explica pro colaborador o porquê"
                rows={3}
              />
            </div>
          )}

          {erro && (
            <div className="flex items-start gap-2 text-sm text-california-red">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{erro}</span>
            </div>
          )}
        </div>

        {/* Rodapé — botões */}
        {!pendente ? (
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Fechar</Button>
            </DialogClose>
          </DialogFooter>
        ) : modoReprovar ? (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setModoReprovar(false);
                setMotivo("");
              }}
              disabled={enviando}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              onClick={handleReprovar}
              disabled={enviando || motivo.trim().length < 3}
            >
              {enviando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Confirmar reprovação
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModoReprovar(true)}
              disabled={enviando || carregando}
              className="hover:bg-california-red/5 hover:text-california-red hover:border-california-red/30"
            >
              <X className="h-4 w-4 mr-1" />
              Reprovar
            </Button>
            <Button
              onClick={handleAprovar}
              disabled={enviando || carregando}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {enviando ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Aprovar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------- Bloco de valores (reutilizável) --------------------- */

function BlocoValores({
  titulo,
  valores,
  tipo,
  dias,
  diasFolga,
  diasAbono,
  variantSecundario = false,
}: {
  titulo: string;
  valores: ValoresPreview;
  tipo: string;
  dias: number;
  diasFolga: number;
  diasAbono: number;
  variantSecundario?: boolean;
}) {
  const borderCls = variantSecundario
    ? "border-border bg-muted/20"
    : "border-emerald-200 bg-emerald-50/50";
  const headerCls = variantSecundario ? "text-muted-foreground" : "text-emerald-900";
  return (
    <div className={`rounded-xl border p-4 ${borderCls}`}>
      <div className="flex items-center gap-2 mb-3">
        <Palmtree className={`h-4 w-4 ${headerCls}`} />
        <h3 className={`text-xs font-semibold uppercase tracking-wider ${headerCls}`}>
          {titulo}
        </h3>
      </div>

      {/* Base: salário e dias */}
      <div className="grid grid-cols-2 gap-3 text-xs mb-3 pb-3 border-b border-current/10">
        <div>
          <p className="text-muted-foreground">Base salarial</p>
          <p className="font-mono font-semibold text-sm mt-0.5">
            R$ {formatarValor(valores.valor_base_remuneracao)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Diário (/ 30)</p>
          <p className="font-mono font-semibold text-sm mt-0.5">
            R$ {formatarValor(valores.valor_base_remuneracao / 30)}
          </p>
        </div>
      </div>

      {/* Linhas de composição */}
      <div className="space-y-1.5 text-sm">
        {(tipo === "usufruto" || tipo === "abono_combinado") && (
          <>
            <LinhaValor
              label={`Férias (${diasFolga} dia${diasFolga === 1 ? "" : "s"} × diário)`}
              valor={valores.valor_ferias}
            />
            <LinhaValor
              label="1/3 constitucional"
              valor={valores.valor_um_terco}
            />
          </>
        )}
        {(tipo === "abono_combinado" ||
          tipo === "abono_avulso" ||
          tipo === "abono_excepcional") && (
          <LinhaValor
            label={`Abono (${tipo === "abono_combinado" ? diasAbono : dias} dia${(tipo === "abono_combinado" ? diasAbono : dias) === 1 ? "" : "s"} × diário)`}
            valor={valores.valor_abono}
          />
        )}
      </div>

      {/* Total */}
      <div className="mt-3 pt-3 border-t border-current/10 flex items-center justify-between">
        <span className={`text-xs font-semibold uppercase tracking-wider ${headerCls}`}>
          Total bruto
        </span>
        <span className={`font-mono text-lg font-bold ${headerCls}`}>
          R$ {formatarValor(valores.valor_total)}
        </span>
      </div>
    </div>
  );
}

function LinhaValor({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-foreground/80">{label}</span>
      <span className="font-mono font-semibold">
        R$ {formatarValor(valor)}
      </span>
    </div>
  );
}

function formatarValor(v: number): string {
  return v.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
