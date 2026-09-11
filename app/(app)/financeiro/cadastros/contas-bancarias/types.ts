import type { EmpresaContabil } from "@/lib/types";

export type EmpresaContabilSumario = Pick<
  EmpresaContabil,
  "id" | "razao_social" | "nome_fantasia"
>;
