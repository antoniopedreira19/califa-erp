/**
 * Classificação de pendências do cadastro de colaborador.
 *
 * Função pura — recebe a foto de um colaborador (dados fixos + status
 * derivado de salário e alocação vigentes) e devolve o nível da
 * pendência mais o detalhe do que falta.
 *
 * Régua travada em 2026-09-25:
 *   Nível 1 (crítica, impede pagamento):
 *     - CPF ausente
 *     - CNPJ ausente quando tipo_contratacao é pj ou clt_recibo
 *     - Sem meio de pagamento válido: nem conta bancária completa
 *       nem PIX preenchido
 *     - Sem salário vigente
 *     - Sem alocação vigente
 *
 *   Nível 2 (parcial, cadastro incompleto):
 *     - Email
 *     - Telefone
 *     - Nível
 *     - Data de nascimento
 *     - Área
 *
 *   Nível 3 (completo) — nenhum item dos dois níveis acima pendente.
 *
 * A régua não valida FORMATO dos dados presentes (isso é responsabilidade
 * do Zod e do CHECK). Aqui só olha "está preenchido?".
 */

import type { TipoContratacao } from "@/lib/types";

export type CampoCritico =
  | "cpf"
  | "cnpj"
  | "meio_pagamento"
  | "salario_vigente"
  | "alocacao_vigente";

export type CampoParcial =
  | "email"
  | "telefone"
  | "nivel"
  | "data_nascimento"
  | "area";

export type NivelPendencia = "critica" | "parcial" | "completo";

export type Pendencias = {
  nivel: NivelPendencia;
  criticas: CampoCritico[];
  parciais: CampoParcial[];
  /** total = criticas.length + parciais.length */
  total: number;
};

export type ColaboradorParaPendencias = {
  tipo_contratacao: TipoContratacao;
  cpf: string | null;
  cnpj: string | null;
  email: string | null;
  telefone: string | null;
  nivel_id: string | null;
  data_nascimento: string | null;
  area: string | null;
  banco_codigo: string | null;
  agencia: string | null;
  conta: string | null;
  conta_dv: string | null;
  tipo_conta: string | null;
  pix_chave: string | null;
};

function ehVazio(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim().length === 0;
}

function temContaCompleta(c: ColaboradorParaPendencias): boolean {
  return (
    !ehVazio(c.banco_codigo) &&
    !ehVazio(c.agencia) &&
    !ehVazio(c.conta) &&
    !ehVazio(c.conta_dv) &&
    !ehVazio(c.tipo_conta)
  );
}

function temPix(c: ColaboradorParaPendencias): boolean {
  return !ehVazio(c.pix_chave);
}

export function avaliarPendencias(input: {
  colaborador: ColaboradorParaPendencias;
  temSalarioVigente: boolean;
  temAlocacaoVigente: boolean;
}): Pendencias {
  const { colaborador: c, temSalarioVigente, temAlocacaoVigente } = input;
  const criticas: CampoCritico[] = [];
  const parciais: CampoParcial[] = [];

  // Nível 1 — críticas
  if (ehVazio(c.cpf)) criticas.push("cpf");
  const ehPJ =
    c.tipo_contratacao === "pj" || c.tipo_contratacao === "clt_recibo";
  if (ehPJ && ehVazio(c.cnpj)) criticas.push("cnpj");
  if (!temContaCompleta(c) && !temPix(c)) criticas.push("meio_pagamento");
  if (!temSalarioVigente) criticas.push("salario_vigente");
  if (!temAlocacaoVigente) criticas.push("alocacao_vigente");

  // Nível 2 — parciais
  if (ehVazio(c.email)) parciais.push("email");
  if (ehVazio(c.telefone)) parciais.push("telefone");
  if (ehVazio(c.nivel_id)) parciais.push("nivel");
  if (ehVazio(c.data_nascimento)) parciais.push("data_nascimento");
  if (ehVazio(c.area)) parciais.push("area");

  const nivel: NivelPendencia =
    criticas.length > 0
      ? "critica"
      : parciais.length > 0
        ? "parcial"
        : "completo";

  return {
    nivel,
    criticas,
    parciais,
    total: criticas.length + parciais.length,
  };
}

/** Rótulo humano em pt-BR pra cada campo. Usado no banner e nos selos. */
export const ROTULO_CRITICO: Record<CampoCritico, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  meio_pagamento: "Conta bancária ou PIX",
  salario_vigente: "Salário vigente",
  alocacao_vigente: "Alocação vigente",
};

export const ROTULO_PARCIAL: Record<CampoParcial, string> = {
  email: "E-mail",
  telefone: "Telefone",
  nivel: "Nível",
  data_nascimento: "Data de nascimento",
  area: "Área",
};

export function rotuloCampo(campo: CampoCritico | CampoParcial): string {
  return (
    (ROTULO_CRITICO as Record<string, string>)[campo] ??
    (ROTULO_PARCIAL as Record<string, string>)[campo] ??
    campo
  );
}
