import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avaliarPendenciasFerias,
  type PeriodoParaPendencias,
  type LancamentoParaPendencias,
} from "./pendencias-ferias";

// === Dados fake pra testes — nenhum dado real de colaborador ===
// UUIDs ilustrativos, zeros e letras iniciais sequenciais.

const PERIODO_2022_2023: PeriodoParaPendencias = {
  id: "00000000-0000-0000-0000-000000000001",
  aquisitivo_inicio: "2022-01-01",
  aquisitivo_fim: "2023-01-01",
  concessivo_fim: "2024-01-01",
  dias_direito: 30,
};

const PERIODO_2023_2024: PeriodoParaPendencias = {
  id: "00000000-0000-0000-0000-000000000002",
  aquisitivo_inicio: "2023-01-01",
  aquisitivo_fim: "2024-01-01",
  concessivo_fim: "2025-01-01",
  dias_direito: 30,
};

const HOJE_2026 = new Date("2026-11-13T12:00:00Z");

// ----------------------------------------------------------------------
test("sem lançamentos e período futuro: nivel = ok", () => {
  const futuro: PeriodoParaPendencias = {
    ...PERIODO_2022_2023,
    concessivo_fim: "2027-01-01",
  };
  const r = avaliarPendenciasFerias({
    periodos: [futuro],
    lancamentos: [],
    hoje: HOJE_2026,
  });
  assert.equal(r.nivel, "ok");
  assert.equal(r.total, 0);
});

// ----------------------------------------------------------------------
test("usufruto normal dentro do direito: ok", () => {
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2022_2023],
    lancamentos: [
      {
        id: "a1",
        periodo_id: PERIODO_2022_2023.id,
        tipo: "usufruto",
        dias: 20,
        dias_abono: 0,
        data_inicio: "2023-06-01",
        data_fim: "2023-06-20",
      },
      {
        id: "a2",
        periodo_id: PERIODO_2022_2023.id,
        tipo: "abono_excepcional",
        dias: 10,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
    ],
    hoje: HOJE_2026,
  });
  assert.equal(r.nivel, "ok");
});

// ----------------------------------------------------------------------
test("saldo estourado: 60d consumidos de 30d de direito -> crítica", () => {
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2022_2023],
    lancamentos: [
      {
        id: "b1",
        periodo_id: PERIODO_2022_2023.id,
        tipo: "usufruto",
        dias: 30,
        dias_abono: 0,
        data_inicio: "2023-06-01",
        data_fim: "2023-06-30",
      },
      {
        id: "b2",
        periodo_id: PERIODO_2022_2023.id,
        tipo: "abono_excepcional",
        dias: 30,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
    ],
    hoje: HOJE_2026,
  });
  assert.equal(r.nivel, "critica");
  const estouro = r.itens.find((i) => i.tipo === "saldo_estourado");
  assert.ok(estouro, "deveria ter saldo_estourado");
  assert.equal(estouro.aquisitivo, "2022/2023");
  assert.equal(estouro.lancamentos_envolvidos.length, 2);
});

// ----------------------------------------------------------------------
test("abono acima do teto (30d > 10d) -> alerta separado", () => {
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2022_2023],
    lancamentos: [
      {
        id: "c1",
        periodo_id: PERIODO_2022_2023.id,
        tipo: "abono_excepcional",
        dias: 30,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
    ],
    hoje: HOJE_2026,
  });
  // 30d só de abono = direito 30, mas >10 => alerta abono
  const alertaAbono = r.itens.find((i) => i.tipo === "abono_excessivo");
  assert.ok(alertaAbono, "deveria ter abono_excessivo");
  assert.equal(alertaAbono.nivel, "alerta");
});

// ----------------------------------------------------------------------
test("duplicata exata (2 abonos iguais) -> alerta", () => {
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2023_2024],
    lancamentos: [
      {
        id: "d1",
        periodo_id: PERIODO_2023_2024.id,
        tipo: "abono_excepcional",
        dias: 10,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
      {
        id: "d2",
        periodo_id: PERIODO_2023_2024.id,
        tipo: "abono_excepcional",
        dias: 10,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
    ],
    hoje: HOJE_2026,
  });
  const dup = r.itens.find((i) => i.tipo === "duplicata_provavel");
  assert.ok(dup, "deveria detectar duplicata");
  assert.equal(dup.lancamentos_envolvidos.length, 2);
  // 20d abono > 10d também gera abono_excessivo
  assert.ok(r.itens.find((i) => i.tipo === "abono_excessivo"));
});

// ----------------------------------------------------------------------
test("período vencido sem usufruto -> info", () => {
  // concessivo_fim de PERIODO_2022_2023 é 2024-01-01 — já venceu em 2026
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2022_2023],
    lancamentos: [],
    hoje: HOJE_2026,
  });
  assert.equal(r.nivel, "info");
  const venc = r.itens.find((i) => i.tipo === "vencido_sem_usufruto");
  assert.ok(venc, "deveria ter vencido_sem_usufruto");
  assert.equal(venc.lancamentos_envolvidos.length, 0);
});

// ----------------------------------------------------------------------
test("nivelMaximo = crítica quando há crítica + alerta + info juntos", () => {
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2022_2023, PERIODO_2023_2024],
    lancamentos: [
      // PERIODO_2022_2023: 2 abonos iguais 20d (duplicata + saldo estourado + abono excessivo)
      {
        id: "e1",
        periodo_id: PERIODO_2022_2023.id,
        tipo: "abono_excepcional",
        dias: 20,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
      {
        id: "e2",
        periodo_id: PERIODO_2022_2023.id,
        tipo: "abono_excepcional",
        dias: 20,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
    ],
    hoje: HOJE_2026,
  });
  assert.equal(r.nivel, "critica");
  assert.ok(r.resumo.criticas >= 1);
  assert.ok(r.resumo.alertas >= 2);
});

// ----------------------------------------------------------------------
test("abono_combinado: dias_abono conta só pra teto de abono, usufruto pro saldo", () => {
  // Um abono_combinado de 25 dias totais, sendo 10 de abono -> usufruto 15 + abono 10
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2023_2024],
    lancamentos: [
      {
        id: "f1",
        periodo_id: PERIODO_2023_2024.id,
        tipo: "abono_combinado",
        dias: 25,
        dias_abono: 10,
        data_inicio: "2024-06-01",
        data_fim: "2024-06-15",
      },
    ],
    hoje: HOJE_2026,
  });
  // 15 usufruto + 10 abono = 25 <= 30, abono = 10 <= 10 => ok
  assert.equal(r.resumo.criticas, 0);
  assert.equal(r.resumo.alertas, 0);
});

// ----------------------------------------------------------------------
test("lançamento com periodo_id null é ignorado (abono avulso)", () => {
  const r = avaliarPendenciasFerias({
    periodos: [PERIODO_2023_2024],
    lancamentos: [
      {
        id: "g1",
        periodo_id: null,
        tipo: "abono_avulso",
        dias: 50,
        dias_abono: 0,
        data_inicio: null,
        data_fim: null,
      },
    ],
    hoje: HOJE_2026,
  });
  // Abono avulso não impacta o saldo do período aquisitivo
  const critica = r.itens.find((i) => i.nivel === "critica");
  assert.equal(critica, undefined);
});
