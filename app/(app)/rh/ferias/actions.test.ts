import { test } from "node:test";
import assert from "node:assert/strict";
import { lancarDiretoSchema } from "@/lib/ferias/lancar-direto-schema";

const UUID_FAKE = "11111111-1111-1111-1111-111111111111";
const COLAB_UUID = "22222222-2222-2222-2222-222222222222";

test("abono_combinado requer dias_abono > 0 + periodo_id", () => {
  const base = {
    colaborador_id: COLAB_UUID,
    periodo_id: UUID_FAKE,
    tipo: "abono_combinado",
    data_inicio: "2027-01-01",
    data_fim: "2027-01-20",
    dias_abono: 10,
  };
  assert.equal(lancarDiretoSchema.safeParse(base).success, true);
  assert.equal(
    lancarDiretoSchema.safeParse({ ...base, dias_abono: 0 }).success,
    false,
  );
  assert.equal(
    lancarDiretoSchema.safeParse({ ...base, periodo_id: null }).success,
    false,
  );
});

test("abono_excepcional requer dias_abono = 0 (não é combinado)", () => {
  const base = {
    colaborador_id: COLAB_UUID,
    periodo_id: UUID_FAKE,
    tipo: "abono_excepcional",
    data_inicio: "2027-01-01",
    data_fim: "2027-01-15",
    dias_abono: 0,
  };
  assert.equal(lancarDiretoSchema.safeParse(base).success, true);
  assert.equal(
    lancarDiretoSchema.safeParse({ ...base, dias_abono: 5 }).success,
    false,
  );
});

test("usufruto proíbe dias_abono > 0", () => {
  const r = lancarDiretoSchema.safeParse({
    colaborador_id: COLAB_UUID,
    periodo_id: UUID_FAKE,
    tipo: "usufruto",
    data_inicio: "2027-01-01",
    data_fim: "2027-01-20",
    dias_abono: 5,
  });
  assert.equal(r.success, false);
});

test("abono_avulso: periodo_id null + dias_abono=0", () => {
  const base = {
    colaborador_id: COLAB_UUID,
    periodo_id: null,
    tipo: "abono_avulso",
    data_inicio: "2027-01-01",
    data_fim: "2027-01-10",
    dias_abono: 0,
  };
  assert.equal(lancarDiretoSchema.safeParse(base).success, true);
  assert.equal(
    lancarDiretoSchema.safeParse({ ...base, periodo_id: UUID_FAKE }).success,
    false,
  );
});
