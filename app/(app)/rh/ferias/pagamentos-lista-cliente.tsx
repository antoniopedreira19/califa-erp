"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileText,
  Paperclip,
  Send,
  Trash2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  enviarFolhasFerias,
  cancelarFolhaFerias,
} from "./actions-pagamentos";
import { ModalAnexarRecibo } from "./modal-anexar-recibo";
import type { PagamentoFerias } from "./aba-pagamentos";

type Props = {
  pagamentos: PagamentoFerias[];
};

type Grupo = {
  key: PagamentoFerias["status"];
  label: string;
  tom: "atencao" | "info" | "sucesso";
  itens: PagamentoFerias[];
};

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

function fmtDiaSemana(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  return dias[d.getDay()];
}

function fmtMoeda(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function fluxoLabel(origem: PagamentoFerias["origem"]): string {
  return origem === "california" ? "PJ" : "CLT";
}

export function PagamentosListaCliente({ pagamentos }: Props) {
  const router = useRouter();
  const [selecionados, setSelecionados] = React.useState<Set<string>>(
    new Set(),
  );
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [folhaParaAnexar, setFolhaParaAnexar] =
    React.useState<PagamentoFerias | null>(null);
  const [folhaParaCancelar, setFolhaParaCancelar] =
    React.useState<PagamentoFerias | null>(null);

  // Agrupa por status.
  const grupos: Grupo[] = React.useMemo(() => {
    const rascunho: PagamentoFerias[] = [];
    const enviadas: PagamentoFerias[] = [];
    const pagas: PagamentoFerias[] = [];
    for (const p of pagamentos) {
      if (p.status === "rascunho") rascunho.push(p);
      else if (p.status === "paga") pagas.push(p);
      else enviadas.push(p);
    }
    return [
      {
        key: "rascunho",
        label: "Rascunho — precisam de ação",
        tom: "atencao",
        itens: rascunho,
      },
      {
        key: "enviada",
        label: "Enviadas ao financeiro",
        tom: "info",
        itens: enviadas,
      },
      { key: "paga", label: "Pagas", tom: "sucesso", itens: pagas },
    ];
  }, [pagamentos]);

  const idsRascunho = React.useMemo(
    () => grupos[0].itens.map((p) => p.id),
    [grupos],
  );

  // Rascunhos "enviáveis" = PJ sempre; CLT só se já tem anexo.
  const enviaveis = React.useMemo(
    () =>
      grupos[0].itens.filter(
        (p) => p.origem === "california" || !!p.anexo_url,
      ),
    [grupos],
  );
  const idsEnviaveis = enviaveis.map((p) => p.id);
  const idsSelecionadosEnviaveis = idsEnviaveis.filter((id) =>
    selecionados.has(id),
  );

  const totalSelecionado = idsSelecionadosEnviaveis.reduce((acc, id) => {
    const p = enviaveis.find((x) => x.id === id);
    return acc + (p?.salario_base ?? 0);
  }, 0);

  function toggleOne(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllRascunho() {
    if (idsSelecionadosEnviaveis.length === idsEnviaveis.length) {
      // Desmarca todos os rascunhos
      setSelecionados((prev) => {
        const next = new Set(prev);
        for (const id of idsRascunho) next.delete(id);
        return next;
      });
    } else {
      // Marca só os enviáveis (ignora CLT sem anexo)
      setSelecionados((prev) => {
        const next = new Set(prev);
        for (const id of idsEnviaveis) next.add(id);
        return next;
      });
    }
  }

  function handleEnviarLote() {
    setErro(null);
    const ids = idsSelecionadosEnviaveis;
    if (ids.length === 0) return;
    startTransition(async () => {
      const res = await enviarFolhasFerias({ ids });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setSelecionados(new Set());
      router.refresh();
    });
  }

  function handleCancelar() {
    if (!folhaParaCancelar) return;
    setErro(null);
    startTransition(async () => {
      const res = await cancelarFolhaFerias({
        folha_id: folhaParaCancelar.id,
      });
      if (!res.ok) {
        setErro(res.message);
        return;
      }
      setFolhaParaCancelar(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {/* Barra de ação em lote */}
      {idsSelecionadosEnviaveis.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-california-red/30 bg-california-red/5 px-4 py-2.5 shadow-sm">
          <div className="text-sm">
            <strong>{idsSelecionadosEnviaveis.length}</strong> folha(s)
            selecionada(s) · total {fmtMoeda(totalSelecionado)}
          </div>
          <button
            type="button"
            onClick={handleEnviarLote}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-california-red px-3 py-1.5 text-sm font-medium text-white hover:bg-california-red/90 transition-colors disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {pending ? "Enviando..." : "Enviar ao financeiro"}
          </button>
        </div>
      )}

      {/* Grupos */}
      {grupos.map((g) => (
        <GrupoSecao
          key={g.key}
          grupo={g}
          selecionados={selecionados}
          toggleOne={toggleOne}
          toggleAllRascunho={g.key === "rascunho" ? toggleAllRascunho : null}
          numeroEnviaveisMarcados={
            g.key === "rascunho"
              ? idsSelecionadosEnviaveis.length
              : 0
          }
          totalEnviaveisDoGrupo={g.key === "rascunho" ? idsEnviaveis.length : 0}
          onAnexar={(p) => setFolhaParaAnexar(p)}
          onCancelar={(p) => setFolhaParaCancelar(p)}
        />
      ))}

      {folhaParaAnexar && (
        <ModalAnexarRecibo
          folha={folhaParaAnexar}
          onFechar={() => setFolhaParaAnexar(null)}
          onSucesso={() => {
            setFolhaParaAnexar(null);
            router.refresh();
          }}
        />
      )}

      <ConfirmDialog
        open={folhaParaCancelar !== null}
        onOpenChange={(o) => !o && setFolhaParaCancelar(null)}
        title="Cancelar essa folha de férias?"
        description={
          folhaParaCancelar
            ? `A folha de ${folhaParaCancelar.colaborador_nome} (${fmtData(folhaParaCancelar.data_pagamento_prevista)}) será removida. Essa ação é só pra rascunhos — já enviada precisa cancelar pelo fluxo financeiro.`
            : ""
        }
        variant="destructive"
        confirmLabel="Cancelar folha"
        cancelLabel="Voltar"
        pending={pending}
        onConfirm={handleCancelar}
      />
    </div>
  );
}

/* ----------------------- Grupo (uma seção por status) ----------------------- */

function GrupoSecao({
  grupo,
  selecionados,
  toggleOne,
  toggleAllRascunho,
  numeroEnviaveisMarcados,
  totalEnviaveisDoGrupo,
  onAnexar,
  onCancelar,
}: {
  grupo: Grupo;
  selecionados: Set<string>;
  toggleOne: (id: string) => void;
  toggleAllRascunho: (() => void) | null;
  numeroEnviaveisMarcados: number;
  totalEnviaveisDoGrupo: number;
  onAnexar: (p: PagamentoFerias) => void;
  onCancelar: (p: PagamentoFerias) => void;
}) {
  const [aberto, setAberto] = React.useState(
    grupo.key === "rascunho" || grupo.key === "enviada",
  );

  const corTitulo =
    grupo.tom === "atencao"
      ? "text-amber-900"
      : grupo.tom === "sucesso"
        ? "text-emerald-800"
        : "text-sky-800";

  const corFundo =
    grupo.tom === "atencao"
      ? "bg-amber-50 border-amber-200"
      : grupo.tom === "sucesso"
        ? "bg-emerald-50 border-emerald-200"
        : "bg-sky-50 border-sky-200";

  const todosEnviaveisMarcados =
    totalEnviaveisDoGrupo > 0 &&
    numeroEnviaveisMarcados === totalEnviaveisDoGrupo;
  const algumMarcado =
    numeroEnviaveisMarcados > 0 && !todosEnviaveisMarcados;

  return (
    <section className={`rounded-2xl border ${corFundo} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-black/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${aberto ? "" : "-rotate-90"}`}
          />
          <h3 className={`text-sm font-semibold ${corTitulo}`}>
            {grupo.label}
          </h3>
          <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            {grupo.itens.length}
          </span>
        </div>
      </button>

      {aberto && (
        <div className="bg-card border-t border-border">
          {grupo.itens.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground text-center">
              Nada aqui.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="w-10 text-center py-2.5 pl-4">
                    {toggleAllRascunho && (
                      <Checkbox
                        checked={
                          todosEnviaveisMarcados
                            ? true
                            : algumMarcado
                              ? "indeterminate"
                              : false
                        }
                        onCheckedChange={() => toggleAllRascunho()}
                        aria-label="Selecionar todos os enviáveis"
                      />
                    )}
                  </th>
                  <th className="text-left py-2.5">Colaborador</th>
                  <th className="text-left py-2.5">Período</th>
                  <th className="text-center py-2.5">Dias</th>
                  <th className="text-center py-2.5">Fluxo</th>
                  <th className="text-left py-2.5">Vencimento</th>
                  <th className="text-right py-2.5">Valor</th>
                  <th className="text-right py-2.5 pr-4">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {grupo.itens.map((p) => (
                  <LinhaPagamento
                    key={p.id}
                    pagamento={p}
                    selecionavel={grupo.key === "rascunho"}
                    enviavel={
                      grupo.key === "rascunho" &&
                      (p.origem === "california" || !!p.anexo_url)
                    }
                    marcado={selecionados.has(p.id)}
                    onToggle={() => toggleOne(p.id)}
                    onAnexar={() => onAnexar(p)}
                    onCancelar={() => onCancelar(p)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

/* ----------------------- Linha de uma folha ----------------------- */

function LinhaPagamento({
  pagamento: p,
  selecionavel,
  enviavel,
  marcado,
  onToggle,
  onAnexar,
  onCancelar,
}: {
  pagamento: PagamentoFerias;
  selecionavel: boolean;
  enviavel: boolean;
  marcado: boolean;
  onToggle: () => void;
  onAnexar: () => void;
  onCancelar: () => void;
}) {
  const vencimentoStr = fmtData(p.data_pagamento_prevista);
  const vencimentoDia = fmtDiaSemana(p.data_pagamento_prevista);
  const isCLT = p.origem === "contabilidade";
  const semAnexoCLT = isCLT && !p.anexo_url;

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="text-center py-3 pl-4">
        {selecionavel && (
          <Checkbox
            checked={marcado}
            onCheckedChange={onToggle}
            disabled={!enviavel}
            aria-label={`Selecionar ${p.colaborador_nome}`}
          />
        )}
      </td>
      <td className="py-3">
        <p className="font-medium">{p.colaborador_nome}</p>
      </td>
      <td className="py-3 text-xs text-muted-foreground">
        {p.lancamento_data_inicio
          ? `${fmtData(p.lancamento_data_inicio)} a ${fmtData(p.lancamento_data_fim)}`
          : "—"}
      </td>
      <td className="py-3 text-center">
        {p.lancamento_dias ?? "—"}
      </td>
      <td className="py-3 text-center">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            p.origem === "california"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-sky-100 text-sky-800"
          }`}
        >
          {fluxoLabel(p.origem)}
        </span>
      </td>
      <td className="py-3">
        <span className="font-medium">{vencimentoStr}</span>
        {vencimentoDia && (
          <span className="text-xs text-muted-foreground ml-1">
            ({vencimentoDia})
          </span>
        )}
      </td>
      <td className="py-3 text-right tabular-nums font-medium">
        {semAnexoCLT ? (
          <span className="text-xs text-amber-700">aguarda recibo</span>
        ) : (
          fmtMoeda(p.salario_base)
        )}
      </td>
      <td className="py-3 pr-4 text-right">
        <div className="inline-flex items-center gap-1 justify-end">
          {p.anexo_url && (
            <a
              href={p.anexo_url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Ver recibo anexado"
            >
              <FileText className="h-3.5 w-3.5" />
            </a>
          )}
          {p.status === "rascunho" && isCLT && (
            <button
              type="button"
              onClick={onAnexar}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              title="Anexar recibo contábil"
            >
              <Paperclip className="h-3 w-3" />
              {p.anexo_url ? "Substituir" : "Anexar"}
            </button>
          )}
          {p.status === "rascunho" && (
            <button
              type="button"
              onClick={onCancelar}
              className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-700"
              title="Cancelar folha"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {p.status === "paga" && (
            <span className="inline-flex items-center gap-1 text-emerald-700 text-xs">
              <Check className="h-3.5 w-3.5" />
              Pago em {fmtData(p.data_pagamento)}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
