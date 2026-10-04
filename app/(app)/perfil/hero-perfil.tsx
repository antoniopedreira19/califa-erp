"use client";

import * as React from "react";
import {
  Shield,
  Briefcase,
  CalendarDays,
  Mail,
  Pencil,
} from "lucide-react";
import { roleLabel, tipoContratacaoLabel } from "@/lib/types";
import type { AppRole, Colaborador, TipoContratacao } from "@/lib/types";
import { EditarMeusDadosDrawer } from "./editar-meus-dados-drawer";

type Props = {
  nome: string;
  email: string;
  role: AppRole;
  tipoContratacao?: TipoContratacao | null;
  funcao?: string | null;
  dataAdmissao?: string | null;
  empresaPrincipal?: string | null;
  /**
   * Dados editáveis do colaborador. Quando presente, o botão "Editar"
   * aparece e abre o modal com os campos permitidos. Null = sem colab
   * vinculado (admin logado antes de cadastrar colaborador próprio).
   */
  colaboradorEditavel: Pick<
    Colaborador,
    | "telefone"
    | "email_pessoal"
    | "cep"
    | "logradouro"
    | "numero"
    | "complemento"
    | "bairro"
    | "cidade"
    | "uf"
    | "banco_codigo"
    | "banco_nome"
    | "agencia"
    | "agencia_dv"
    | "conta"
    | "conta_dv"
    | "tipo_conta"
    | "pix_tipo"
    | "pix_chave"
  > | null;
};

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

function fmtDataLonga(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function HeroPerfil({
  nome,
  email,
  role,
  tipoContratacao,
  funcao,
  dataAdmissao,
  empresaPrincipal,
  colaboradorEditavel,
}: Props) {
  const [editando, setEditando] = React.useState(false);
  const admissaoFmt = fmtDataLonga(dataAdmissao);
  const podeEditar = !!colaboradorEditavel;

  return (
    <>
      <section
        className="relative overflow-hidden rounded-2xl text-white shadow-elevated"
        style={{ backgroundColor: "#171717" }}
        aria-label="Cabeçalho do perfil"
      >
        {/* Textura sutil (points) pra o fundo não ficar flat */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.8) 1px, transparent 0)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative flex flex-col gap-5 p-6 md:flex-row md:items-start md:justify-between md:p-7">
          {/* Esquerda: avatar + nome + chips */}
          <div className="flex gap-5 min-w-0 flex-1">
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-california-red text-2xl font-bold tracking-tight text-white shadow-lg ring-1 ring-white/20"
              aria-hidden
            >
              {iniciais(nome)}
            </div>

            <div className="min-w-0 flex-1 flex flex-col gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold tracking-tight md:text-3xl">
                  {nome}
                </h1>
                <p className="mt-0.5 flex items-center gap-1.5 text-sm text-white/70">
                  <Mail className="h-3.5 w-3.5" />
                  <span className="truncate">{email}</span>
                </p>
              </div>

              {/* Chips */}
              <div className="flex flex-wrap items-center gap-2">
                <Chip icon={Shield}>{roleLabel(role)}</Chip>
                {tipoContratacao && (
                  <Chip icon={Briefcase}>
                    {tipoContratacaoLabel(tipoContratacao)}
                  </Chip>
                )}
                {funcao && <Chip>{funcao}</Chip>}
                {empresaPrincipal && <Chip>{empresaPrincipal}</Chip>}
                {admissaoFmt && (
                  <Chip icon={CalendarDays}>desde {admissaoFmt}</Chip>
                )}
              </div>
            </div>
          </div>

          {/* Direita: ações */}
          {podeEditar && (
            <div className="shrink-0">
              <button
                type="button"
                onClick={() => setEditando(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <Pencil className="h-3.5 w-3.5" />
                Editar
              </button>
            </div>
          )}
        </div>
      </section>

      {editando && colaboradorEditavel && (
        <EditarMeusDadosDrawer
          colaborador={colaboradorEditavel}
          onFechar={() => setEditando(false)}
        />
      )}
    </>
  );
}

function Chip({
  icon: Icon,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">
      {Icon && <Icon className="h-3 w-3 opacity-80" />}
      {children}
    </span>
  );
}
