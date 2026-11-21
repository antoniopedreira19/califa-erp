import {
  calcularValoresLancamentoAuto,
  type ValoresLancamento,
} from "./calcular-valores";
import { criarFolhasDePagamentoDeFerias } from "./criar-folhas-pagamento";
import type {
  FeriasLancamentoTipo,
  TipoContratacao,
} from "@/lib/types";

/** Dados mínimos do lançamento que o helper precisa pra calcular valores
 *  e criar folhas. Replica o shape que o `select(...)` do RH monta. */
export type LancamentoParaAprovar = {
  id: string;
  tenant_id: string;
  colaborador_id: string;
  periodo_id: string | null;
  tipo: FeriasLancamentoTipo;
  data_inicio: string;
  data_fim: string;
  dias: number;
  dias_abono?: number;
  status: string;
  solicitado_por: string;
};

/** Monta a parte do UPDATE que grava valores (PJ/CLT_RECIBO). Pros tipos
 *  que não têm valor calculado (ex: CLT puro), retorna objeto vazio. */
export async function calcularValoresParaAprovar(args: {
  colaboradorId: string;
  dataInicio: string;
  tipoContratacao: TipoContratacao;
  tipo: FeriasLancamentoTipo;
  dias: number;
  diasAbono: number;
}): Promise<Partial<ValoresLancamento> | null> {
  const valores = await calcularValoresLancamentoAuto(
    args.colaboradorId,
    args.dataInicio,
    args.tipoContratacao,
    args.tipo,
    args.dias,
    args.diasAbono,
  );
  return valores;
}

/** Dispara a criação de folhas de pagamento do lançamento recém-aprovado.
 *  Retorna `{ aviso }` com a string pronta pra devolver ao usuário quando
 *  falhar — o lançamento JÁ FOI aprovado antes desta chamada, então
 *  falha de folhas é aviso, não erro. */
export async function dispararFolhasPagamento(args: {
  lancamento: LancamentoParaAprovar;
  colaborador: { id: string; tipo_contratacao: TipoContratacao };
  actorUserId: string;
}): Promise<{ aviso?: string }> {
  const resFolhas = await criarFolhasDePagamentoDeFerias({
    lancamento: args.lancamento,
    colaborador: args.colaborador,
    actorUserId: args.actorUserId,
  });
  if (resFolhas.erro) {
    return {
      aviso:
        "Lançamento aprovado, mas falhou ao gerar folhas de pagamento: " +
        resFolhas.erro +
        ". Avise o administrador do sistema.",
    };
  }
  return {};
}
