/**
 * A PP do job Mídia System (decisão 216): quando a NF é dispensada, onde a
 * PP que foi sem nota está, e quando ela trava o encerramento.
 * Rodar: node --import tsx --test lib/calculos/midia-system.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  envioDispensaNf,
  midiaAguardaProducao,
  midiaPendenteNoEncerramento,
  midiaSystemDoJob,
  situacaoMidiaDaPP,
  type PPDaAuditoria,
} from "./midia-system";

const emAuditoria = { liberadoEm: null };
const liberado = { liberadoEm: "2026-10-27T15:00:00.000Z" };

const pp = (p: Partial<PPDaAuditoria> = {}): PPDaAuditoria => ({
  sem_nf_na_auditoria: true,
  verba_producao: false,
  status: "pago",
  prestacao: null,
  ...p,
});

test("o job lido do banco: só o marcado é Mídia System", () => {
  assert.equal(midiaSystemDoJob({ midia_system: false, midia_system_liberado_em: null }), null);
  assert.deepEqual(midiaSystemDoJob({ midia_system: true, midia_system_liberado_em: null }), emAuditoria);
  assert.deepEqual(midiaSystemDoJob({ midia_system: true, midia_system_liberado_em: liberado.liberadoEm }), liberado);
});

test("a NF é dispensada só com a auditoria em andamento", () => {
  assert.equal(envioDispensaNf(null), false);
  assert.equal(envioDispensaNf(emAuditoria), true);
  assert.equal(envioDispensaNf(liberado), false);
});

test("PP que foi com NF, verba, cancelada ou rejeitada não é da auditoria", () => {
  assert.equal(situacaoMidiaDaPP(pp({ sem_nf_na_auditoria: false }), liberado), null);
  assert.equal(situacaoMidiaDaPP(pp({ verba_producao: true }), liberado), null);
  assert.equal(situacaoMidiaDaPP(pp({ status: "cancelada" }), liberado), null);
  assert.equal(situacaoMidiaDaPP(pp({ status: "rejeitada" }), liberado), null);
});

test("na auditoria a PP fica sem NF; liberada, aguarda a prestação", () => {
  assert.equal(situacaoMidiaDaPP(pp(), emAuditoria), "sem_nf");
  assert.equal(situacaoMidiaDaPP(pp({ status: "em_avaliacao" }), liberado), "aguardando");
  assert.equal(situacaoMidiaDaPP(pp({ prestacao: { status: "rascunho" } }), liberado), "aguardando");
  assert.equal(situacaoMidiaDaPP(pp({ prestacao: { status: "em_avaliacao" } }), liberado), "em_avaliacao");
  assert.equal(situacaoMidiaDaPP(pp({ prestacao: { status: "reprovada" } }), liberado), "reprovada");
  assert.equal(situacaoMidiaDaPP(pp({ prestacao: { status: "aprovada" } }), liberado), "aprovada");
});

test("a produção age na aguardando e na reprovada", () => {
  assert.equal(midiaAguardaProducao("aguardando"), true);
  assert.equal(midiaAguardaProducao("reprovada"), true);
  assert.equal(midiaAguardaProducao("sem_nf"), false);
  assert.equal(midiaAguardaProducao("em_avaliacao"), false);
  assert.equal(midiaAguardaProducao(null), false);
});

test("trava o encerramento até a prestação aprovada, também na auditoria", () => {
  assert.equal(midiaPendenteNoEncerramento(pp()), true);
  assert.equal(midiaPendenteNoEncerramento(pp({ prestacao: { status: "em_avaliacao" } })), true);
  assert.equal(midiaPendenteNoEncerramento(pp({ prestacao: { status: "aprovada" } })), false);
  assert.equal(midiaPendenteNoEncerramento(pp({ sem_nf_na_auditoria: false })), false);
  assert.equal(midiaPendenteNoEncerramento(pp({ status: "cancelada" })), false);
});
