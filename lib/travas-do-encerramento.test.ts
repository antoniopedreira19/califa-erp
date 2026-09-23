/**
 * Testes das travas de status e de verba do encerramento do job.
 *
 * Rode com:  node --import tsx --test lib/travas-do-encerramento.test.ts
 *
 * Regras do Tiago em 22/09/2026:
 *   * o `em_producao` legado conta como aberto: encerra, envia para
 *     faturamento e passa pela revisão da abertura;
 *   * o encerramento espera as pendências da PRODUÇÃO. A verba trava
 *     enquanto a prestação de contas não foi aprovada; o estorno do saldo
 *     por baixar fica com o financeiro e não trava mais (revê a 081 §7).
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  jobAceitaEnvioParaFaturamento,
  jobEstaAberto,
  situacaoDaVerba,
  verbaPendenteNoEncerramento,
  type JobStatus,
} from "./types";

test("aberto e em_producao contam como abertos; o resto não", () => {
  const abertos: JobStatus[] = ["aberto", "em_producao"];
  const outros: JobStatus[] = [
    "aguardando_abertura",
    "rejeitado_financeiro",
    "encerrado",
    "finalizado",
    "cancelado",
  ];
  for (const s of abertos) assert.equal(jobEstaAberto(s), true, s);
  for (const s of outros) assert.equal(jobEstaAberto(s), false, s);
});

test("envio para faturamento: aberto, em_producao e encerrado", () => {
  assert.equal(jobAceitaEnvioParaFaturamento("aberto"), true);
  assert.equal(jobAceitaEnvioParaFaturamento("em_producao"), true);
  assert.equal(jobAceitaEnvioParaFaturamento("encerrado"), true);
  assert.equal(jobAceitaEnvioParaFaturamento("finalizado"), false);
  assert.equal(jobAceitaEnvioParaFaturamento("aguardando_abertura"), false);
});

function verba(
  prestacao: { status: "em_avaliacao" | "aprovada" | "reprovada"; valor_devolvido: number } | null,
  devolvidaEm: string | null = null,
) {
  return situacaoDaVerba({
    verba_producao: true,
    status: "pago",
    prestacao: prestacao as any,
    devolucao: devolvidaEm === null ? null : ({ pago_em: devolvidaEm } as any),
  });
}

test("verba: trava enquanto a prestação não foi aprovada", () => {
  assert.equal(verbaPendenteNoEncerramento(verba(null)), true);
  assert.equal(
    verbaPendenteNoEncerramento(verba({ status: "em_avaliacao", valor_devolvido: 0 })),
    true,
  );
  assert.equal(
    verbaPendenteNoEncerramento(verba({ status: "reprovada", valor_devolvido: 0 })),
    true,
  );
});

test("verba: aprovada libera, com ou sem estorno do saldo por baixar", () => {
  const devolucaoPendente = verba({ status: "aprovada", valor_devolvido: 50 });
  assert.equal(devolucaoPendente, "devolucao_pendente");
  assert.equal(verbaPendenteNoEncerramento(devolucaoPendente), false);

  const concluida = verba({ status: "aprovada", valor_devolvido: 50 }, "2026-09-22");
  assert.equal(concluida, "concluida");
  assert.equal(verbaPendenteNoEncerramento(concluida), false);

  assert.equal(
    verbaPendenteNoEncerramento(verba({ status: "aprovada", valor_devolvido: 0 })),
    false,
  );
});

test("PP que não é verba não entra na conta da verba", () => {
  const situacao = situacaoDaVerba({
    verba_producao: false,
    status: "pago",
    prestacao: null,
    devolucao: null,
  });
  assert.equal(verbaPendenteNoEncerramento(situacao), false);
});
