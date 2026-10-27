import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarColunaFluxo } from "./classificar-coluna-fluxo";
import type { RhFeriasFluxoRow } from "@/lib/types";

function row(partial: Partial<RhFeriasFluxoRow>): RhFeriasFluxoRow {
  return {
    lancamento_id: "x",
    tenant_id: "t",
    colaborador_id: "c",
    colaborador_nome: "COLABORADOR TESTE",
    tipo_contratacao: "pj",
    tipo_lancamento: "usufruto",
    data_inicio: "2027-01-01",
    data_fim: "2027-01-20",
    dias: 20,
    dias_abono: 0,
    status_lancamento: "pendente_aprovacao",
    created_at: "2026-10-01T00:00:00Z",
    aprovado_em: null,
    motivo_reprovacao: null,
    observacao: null,
    folhas_total: 0,
    folhas_clt_com_recibo: 0,
    folhas_clt_total: 0,
    folhas_pj_total: 0,
    folhas_pj_com_nf: 0,
    folhas_pagas: 0,
    vencimento_mais_proximo: null,
    todas_pagas: null,
    todas_enviadas: null,
    ...partial,
  };
}

test("pendente_aprovacao → pendente", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "pendente_aprovacao" })), "pendente");
});

test("reprovado → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "reprovado" })), "finalizada");
});

test("cancelado → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "cancelado" })), "finalizada");
});

test("concluido → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "concluido" })), "finalizada");
});

test("aprovado sem folhas → em_andamento (edge case bug anterior)", () => {
  assert.equal(classificarColunaFluxo(row({ status_lancamento: "aprovado", folhas_total: 0 })), "em_andamento");
});

test("aprovado, todas pagas → finalizada", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 4, folhas_pagas: 4,
    todas_pagas: true, todas_enviadas: true,
  })), "finalizada");
});

test("aprovado, parcial (algumas pagas) → parcial", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 4, folhas_pagas: 2,
    todas_pagas: false, todas_enviadas: true,
  })), "parcial");
});

test("aprovado, todas enviadas (nenhuma paga) → enviada", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 2, folhas_pagas: 0,
    todas_pagas: false, todas_enviadas: true,
  })), "enviada");
});

test("aprovado, alguma folha ainda em rascunho → em_andamento", () => {
  assert.equal(classificarColunaFluxo(row({
    status_lancamento: "aprovado",
    folhas_total: 2, folhas_pagas: 0,
    todas_pagas: false, todas_enviadas: false,
  })), "em_andamento");
});
