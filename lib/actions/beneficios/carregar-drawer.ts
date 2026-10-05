"use server";

import { requireSession } from "@/lib/auth/session";
import {
  colaboradorPorId,
  listarVinculosDoColaborador,
  listarDependentesDoColaborador,
  custoMensalDoColaborador,
  type ColaboradorBasico,
  type VinculoDoColaborador,
  type DependenteComPlanos,
} from "@/lib/queries/beneficios";
import type { BeneficioCustoMensalLinha } from "@/lib/types";

export interface DrawerColaboradorPayload {
  colaborador: ColaboradorBasico;
  vinculos: VinculoDoColaborador[];
  dependentes: DependenteComPlanos[];
  breakdown: BeneficioCustoMensalLinha[];
}

export type DrawerLoadResult =
  | { ok: true; data: DrawerColaboradorPayload }
  | { ok: false; message: string };

/**
 * Carrega todos os dados do drawer de benefícios de um colaborador numa
 * única chamada. Chamado pelo Client Component via fetch na montagem.
 */
export async function carregarDadosDrawerColaborador(
  colaboradorId: string,
  ano: number,
  mes: number,
): Promise<DrawerLoadResult> {
  const session = await requireSession();
  if (session.activeRole !== "administrador" && session.activeRole !== "rh") {
    return { ok: false, message: "Sem permissão." };
  }

  const tenantId = session.activeTenant.id;

  const [colaborador, vinculos, dependentes, breakdown] = await Promise.all([
    colaboradorPorId({ tenantId, colaboradorId }),
    listarVinculosDoColaborador({ tenantId, colaboradorId }),
    listarDependentesDoColaborador({ tenantId, colaboradorId }),
    custoMensalDoColaborador({ ano, mes, colaboradorId }),
  ]);

  if (!colaborador) {
    return { ok: false, message: "Colaborador não encontrado." };
  }

  return { ok: true, data: { colaborador, vinculos, dependentes, breakdown } };
}
