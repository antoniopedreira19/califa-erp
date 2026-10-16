import Link from "next/link";
import { Edit2, Plus, Mail, Phone, MapPin, FileText } from "lucide-react";
import type { Freelancer, AcaoPrevistaFreelancer } from "@/lib/types";
import { formatCpf, formatTelefone, initials } from "@/lib/utils";
import { AcaoPrevistaBadge } from "../lista/_components/acao-prevista-badge";

interface Props {
  freelancer: Freelancer;
  podeEditar: boolean;
}

export function HeroFreelancer({ freelancer: f, podeEditar }: Props) {
  const avatarIniciais = initials(f.nome_social);

  return (
    <div className="rounded-2xl border border-border bg-white p-6 shadow-soft">
      <div className="flex items-start gap-5">
        {/* Avatar */}
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-california-red text-white text-2xl font-bold shrink-0">
          {avatarIniciais}
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground truncate">
                {f.nome_social}
              </h1>
              {f.nome_completo && f.nome_completo !== f.nome_social && (
                <p className="text-sm text-muted-foreground truncate mt-0.5">
                  {f.nome_completo}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <AcaoPrevistaBadge
                  acao={f.acao_prevista as AcaoPrevistaFreelancer | null}
                />
                {f.origem === "migracao" && (
                  <span className="inline-flex items-center rounded-full bg-zinc-100 text-zinc-600 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                    Migrado
                  </span>
                )}
              </div>
            </div>

            {/* Ações */}
            {podeEditar && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled
                  title="Novo contrato chega na Fase 2"
                  className="inline-flex items-center gap-2 rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white opacity-50 cursor-not-allowed shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  Novo contrato
                </button>
                <Link
                  href={`/freelancers/${f.id}/editar`}
                  prefetch={false}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground hover:border-california-red/40 hover:text-california-red transition-all"
                >
                  <Edit2 className="h-4 w-4" />
                  Editar
                </Link>
              </div>
            )}
          </div>

          {/* Linha de contato / resumo */}
          <div className="mt-4 flex items-center gap-x-5 gap-y-2 flex-wrap text-xs text-muted-foreground">
            {f.cpf && (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <FileText className="h-3.5 w-3.5" />
                {formatCpf(f.cpf)}
              </span>
            )}
            {f.cidade && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" />
                {f.cidade}
              </span>
            )}
            {f.email && (
              <span className="inline-flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                {f.email}
              </span>
            )}
            {f.celular && (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Phone className="h-3.5 w-3.5" />
                {formatTelefone(f.celular)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
