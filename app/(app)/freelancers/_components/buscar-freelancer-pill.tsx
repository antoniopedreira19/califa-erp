"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FreelancerPickerTable, type FreelancerLookup } from "./freelancer-picker-table";
import { NovaSolicitacaoDialog } from "../solicitacoes/_components/nova-solicitacao-dialog";
import type { FreelancerCargo } from "@/lib/types";
import type { JobItem } from "./job-picker";

/**
 * Pill no hero do dashboard que abre modal grande com TODOS os freelas do
 * tenant (via view `freelancers_lookup` SECURITY DEFINER — sem PII).
 *
 * Ao selecionar uma linha:
 *   - Admin/RH/financeiro: vai direto pra criar novo contrato (`/freelancers/contratos/novo?freelancer=<id>`)
 *   - GP/produtor: abre o NovaSolicitacaoDialog com freela travado + começando
 *     direto na tela de histórico (iniciarRevisandoHistorico).
 */

interface Props {
  freelancers: FreelancerLookup[];
  currentUserId: string;
  isAprovador: boolean;
  /** Variante visual: 'dark' pro hero escuro, 'light' pras outras páginas. */
  variant?: "dark" | "light";
  /** Pra GP: passar jobs e cargos pro NovaSolicitacaoDialog que vai abrir. */
  jobs?: JobItem[];
  cargos?: FreelancerCargo[];
}

export function BuscarFreelancerPill({
  freelancers,
  currentUserId,
  isAprovador,
  variant = "dark",
  jobs = [],
  cargos = [],
}: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  // Pra GP: freela escolhido pra abrir o dialog em cima do modal.
  const [solicitarPara, setSolicitarPara] = React.useState<{
    id: string;
    nome: string;
    cpf: string | null;
  } | null>(null);

  function handleSelect(freelancerId: string) {
    if (isAprovador) {
      setOpen(false);
      router.push(`/freelancers/contratos/novo?freelancer=${freelancerId}`);
      return;
    }
    const freela = freelancers.find((f) => f.id === freelancerId);
    if (!freela) return;
    setOpen(false);
    // View `freelancers_lookup` não expõe CPF (LGPD). O dialog só mostra nome.
    setSolicitarPara({
      id: freela.id,
      nome: freela.nome_social,
      cpf: null,
    });
  }

  React.useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const triggerClasses =
    variant === "dark"
      ? "bg-white/10 backdrop-blur border-white/15 text-white hover:bg-white/15"
      : "bg-white border-border text-foreground hover:border-california-red/40";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
          triggerClasses,
        )}
      >
        <Search className="h-3.5 w-3.5" />
        <span>Buscar freelancer</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-california-dark/70 backdrop-blur-sm animate-in fade-in duration-200"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-6xl h-[85vh] rounded-2xl border border-border bg-white shadow-elevated overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col">
            <div className="px-5 py-3.5 border-b border-border flex items-start justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-foreground">
                  Buscar freelancer
                </h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isAprovador
                    ? "Clique numa linha pra abrir o novo contrato pré-preenchido."
                    : "Clique numa linha pra abrir uma solicitação de contratação."}
                </p>
                <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                  Se o freelancer estiver{" "}
                  <strong className="font-semibold">ativo</strong>, o novo
                  contrato não pode coincidir com o vigente — finalize o atual
                  primeiro.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <FreelancerPickerTable
              freelancers={freelancers}
              currentUserId={currentUserId}
              isAprovador={isAprovador}
              onSelect={handleSelect}
            />
          </div>
        </div>
      )}

      {/* Dialog de solicitação pra GP — abre em cima do picker com freela
          travado e começando na tela de histórico. A key força remount a cada
          seleção pra garantir estado limpo. */}
      {solicitarPara && (
        <NovaSolicitacaoDialog
          key={solicitarPara.id}
          jobs={jobs}
          cargos={cargos}
          freelancer={solicitarPara}
          iniciarRevisandoHistorico
          defaultOpen
          onClose={() => setSolicitarPara(null)}
        />
      )}
    </>
  );
}
