"use client";

import * as React from "react";
import { Loader2, ArrowLeft, UserCheck, Ban, AlertTriangle } from "lucide-react";
import { cn, formatCpf } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

/**
 * Tela "Revisar histórico" — mostrada quando o GP/produtor tenta criar uma
 * solicitação pra um freela que já existe (via picker Buscar Freelancer ou via
 * CPF digitado no form). Lista TODOS os contratos anteriores, bloqueia se tem
 * algum contrato ativo, e devolve controle via onProsseguir / onVoltar.
 *
 * Status derivado client-side por contrato — não dá pra usar
 * `freelancers_com_status` porque essa view só expõe o "último contrato",
 * aqui precisamos avaliar cada um.
 *
 * Fonte: RPC `get_historico_contratos_freela` (SECURITY DEFINER) — passa a
 * RLS que limitaria GP aos próprios contratos.
 */

type StatusContrato =
  | "vigente"
  | "vencendo"
  | "vencido"
  | "agendado"
  | "encerrado"
  | "sem_data"
  | "stub";

const STATUS_META: Record<StatusContrato, { label: string; pill: string }> = {
  vigente: {
    label: "Vigente",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-500/30",
  },
  vencendo: {
    label: "Vencendo",
    pill: "bg-amber-50 text-amber-700 border-amber-500/30",
  },
  vencido: {
    label: "Vencido",
    pill: "bg-california-red/10 text-california-red border-california-red/30",
  },
  agendado: {
    label: "Agendado",
    pill: "bg-violet-50 text-violet-700 border-violet-500/30",
  },
  encerrado: {
    label: "Encerrado",
    pill: "bg-muted text-muted-foreground border-border",
  },
  sem_data: {
    label: "Sem data",
    pill: "bg-sky-50 text-sky-700 border-sky-500/30",
  },
  stub: {
    label: "Pendente",
    pill: "bg-sky-50 text-sky-700 border-sky-500/30",
  },
};

interface Contrato {
  id: string;
  nome_job: string | null;
  cargo: string | null;
  data_inicio: string | null;
  data_termino: string | null;
  status_real: boolean | null;
  arquivo_url: string | null;
  minuta_url: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
}

interface Props {
  freelancer: { id: string; nome: string; cpf: string | null };
  onProsseguir: () => void;
  onVoltar: () => void;
  /** Botão "Prosseguir" ganha label diferente conforme o chamador. */
  labelProsseguir?: string;
  /**
   * Quando true, o botão Prosseguir fica HABILITADO mesmo com contrato
   * ativo — vira "Prosseguir mesmo assim" com estilo warning. Útil pra
   * admin/RH/financeiro que podem criar aditivos legítimos.
   * Default false (comportamento conservador do GP/produtor).
   */
  permiteOverride?: boolean;
}

function calcularStatus(c: Contrato): StatusContrato {
  const stub =
    !c.nome_job && !c.data_inicio && !c.arquivo_url && !c.minuta_url;
  if (stub) return "stub";

  if (c.status_real === false) return "encerrado";

  if (!c.data_inicio) return "sem_data";

  const hoje = new Date().toISOString().slice(0, 10);
  if (c.data_inicio > hoje) return "agendado";

  if (c.data_termino) {
    if (c.data_termino < hoje) return "vencido";
    const limite = new Date();
    limite.setDate(limite.getDate() + 15);
    const limiteISO = limite.toISOString().slice(0, 10);
    if (c.data_termino <= limiteISO) return "vencendo";
  }

  return "vigente";
}

function temContratoAtivo(contratos: Contrato[]): boolean {
  return contratos.some((c) => {
    const s = calcularStatus(c);
    return (
      s === "vigente" || s === "vencendo" || s === "agendado" || s === "sem_data"
    );
  });
}

function formatarData(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

export function HistoricoContratosFreela({
  freelancer,
  onProsseguir,
  onVoltar,
  labelProsseguir = "Prosseguir pra solicitação",
  permiteOverride = false,
}: Props) {
  const supabase = React.useMemo(() => createClient(), []);
  const [contratos, setContratos] = React.useState<Contrato[]>([]);
  const [carregando, setCarregando] = React.useState(true);

  React.useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data } = await supabase.rpc("get_historico_contratos_freela", {
        p_freelancer_id: freelancer.id,
      });
      if (cancelado) return;
      setContratos((data ?? []) as Contrato[]);
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [freelancer.id, supabase]);

  // Esconde stubs (sem job + sem data + sem arquivo) do histórico — não é
  // "contrato" sob a perspectiva do GP revisando. Entraram só pra vincular.
  const historico = React.useMemo(
    () => contratos.filter((c) => calcularStatus(c) !== "stub"),
    [contratos],
  );

  const totalContratos = historico.length;
  const responsaveisUnicos = React.useMemo(() => {
    const set = new Set<string>();
    for (const c of historico) {
      if (c.responsavel_nome) set.add(c.responsavel_nome);
    }
    return set.size;
  }, [historico]);
  const temAtivo = React.useMemo(() => temContratoAtivo(contratos), [contratos]);

  return (
    <div className="flex flex-col max-h-[85vh]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border shrink-0">
        <button
          type="button"
          onClick={onVoltar}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </button>
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-california-red flex items-center gap-1.5">
          <UserCheck className="h-3.5 w-3.5" />
          Revisar histórico
        </p>
        <h2 className="text-lg font-bold text-foreground mt-0.5">
          {freelancer.nome}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {freelancer.cpf ? `CPF ${formatCpf(freelancer.cpf)} · ` : ""}
          {carregando
            ? "Carregando contratos..."
            : totalContratos === 0
              ? "Sem contratos anteriores no sistema"
              : `${totalContratos} ${totalContratos === 1 ? "contrato" : "contratos"} · ${responsaveisUnicos} ${responsaveisUnicos === 1 ? "responsável" : "responsáveis"}`}
        </p>
      </div>

      {/* Banner de bloqueio quando tem contrato ativo */}
      {!carregando && temAtivo && (
        <div className="mx-6 mt-4 rounded-lg border border-california-red/30 bg-california-red/5 p-3 flex items-start gap-2 shrink-0">
          <Ban className="h-4 w-4 text-california-red shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-xs font-bold text-california-red">
              Freela em contratação ativa
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Não pode entrar em nova solicitação enquanto houver contrato
              vigente ou agendado. Finalize o atual primeiro.
            </p>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {carregando ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : historico.length === 0 ? (
          <div className="text-center py-12">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-muted/50 mb-3">
              <AlertTriangle className="h-5 w-5 text-muted-foreground/60" />
            </div>
            <p className="text-sm text-muted-foreground">
              Sem contratos anteriores
            </p>
            <p className="text-[11px] text-muted-foreground/80 mt-1">
              Freela cadastrado mas nunca efetivou contrato na agência.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <Th>Período</Th>
                  <Th>Job</Th>
                  <Th>Cargo</Th>
                  <Th>Responsável</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {historico.map((c) => {
                  const status = calcularStatus(c);
                  return (
                    <tr
                      key={c.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-foreground tabular-nums">
                          {c.data_inicio ? formatarData(c.data_inicio) : "—"}
                          {c.data_termino && (
                            <>
                              <span className="text-muted-foreground/60"> → </span>
                              {formatarData(c.data_termino)}
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-semibold text-foreground">
                          {c.nome_job ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-muted-foreground">
                          {c.cargo ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-foreground">
                          {c.responsavel_nome ?? "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                            STATUS_META[status].pill,
                          )}
                        >
                          {STATUS_META[status].label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-border bg-muted/10 flex items-center justify-end gap-2 shrink-0">
        <button
          type="button"
          onClick={onVoltar}
          className="rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted/40"
        >
          Voltar
        </button>
        <button
          type="button"
          onClick={onProsseguir}
          disabled={carregando || (temAtivo && !permiteOverride)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold px-4 py-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
            temAtivo && permiteOverride
              ? "bg-amber-500 text-white hover:bg-amber-600"
              : "bg-california-red text-white hover:bg-california-red-hover",
          )}
          title={
            temAtivo && !permiteOverride
              ? "Freela com contrato ativo — não pode entrar em nova solicitação"
              : temAtivo && permiteOverride
                ? "Freela já tem contrato ativo. Aditivo deve ser compatível com o vigente."
                : undefined
          }
        >
          {temAtivo && permiteOverride ? "Prosseguir mesmo assim" : labelProsseguir}
        </button>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      {children}
    </th>
  );
}
