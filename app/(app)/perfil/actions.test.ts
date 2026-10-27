import { test } from "node:test";
import assert from "node:assert/strict";
import { solicitarFeriasSchema as solicitarSchema } from "@/lib/ferias/solicitar-ferias-schema";

const UUID_FAKE = "11111111-1111-1111-1111-111111111111";

function dataFutura(offsetDias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return d.toISOString().slice(0, 10);
}

test("usufruto: dias_abono=0 obrigatório, periodo_id obrigatório", () => {
  const base = {
    tipo: "usufruto",
    periodo_id: UUID_FAKE,
    data_inicio: dataFutura(10),
    data_fim: dataFutura(20),
    dias_abono: 0,
  };
  assert.equal(solicitarSchema.safeParse(base).success, true);
  assert.equal(
    solicitarSchema.safeParse({ ...base, dias_abono: 5 }).success,
    false,
  );
  assert.equal(
    solicitarSchema.safeParse({ ...base, periodo_id: null }).success,
    false,
  );
});

test("abono_avulso: periodo_id null, dias_abono=0", () => {
  const base = {
    tipo: "abono_avulso",
    periodo_id: null,
    data_inicio: dataFutura(10),
    data_fim: dataFutura(15),
    dias_abono: 0,
  };
  assert.equal(solicitarSchema.safeParse(base).success, true);
  assert.equal(
    solicitarSchema.safeParse({ ...base, periodo_id: UUID_FAKE }).success,
    false,
  );
});

test("abono_combinado: periodo_id obrigatório, dias_abono > 0", () => {
  const base = {
    tipo: "abono_combinado",
    periodo_id: UUID_FAKE,
    data_inicio: dataFutura(10),
    data_fim: dataFutura(20),
    dias_abono: 10,
  };
  assert.equal(solicitarSchema.safeParse(base).success, true);
  assert.equal(
    solicitarSchema.safeParse({ ...base, dias_abono: 0 }).success,
    false,
  );
  assert.equal(
    solicitarSchema.safeParse({ ...base, periodo_id: null }).success,
    false,
  );
});

test("misto rejeitado (removido do enum)", () => {
  const r = solicitarSchema.safeParse({
    tipo: "misto",
    periodo_id: null,
    data_inicio: dataFutura(10),
    data_fim: dataFutura(15),
    dias_abono: 0,
  });
  assert.equal(r.success, false);
});

test("data_inicio dentro da antecedência mínima (< hoje+5) rejeitado", () => {
  const r = solicitarSchema.safeParse({
    tipo: "usufruto",
    periodo_id: UUID_FAKE,
    data_inicio: dataFutura(2), // só 2 dias de antecedência
    data_fim: dataFutura(10),
    dias_abono: 0,
  });
  assert.equal(r.success, false);
});
