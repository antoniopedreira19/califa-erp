/**
 * A leitura do anexo pela IA aplicada ao anexo em edição (decisão 192).
 * Rodar: node --import tsx --test lib/ia/leitura-do-anexo.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DadosLidosDoDocumento } from "@/lib/types";
import { aplicarLeitura, semSelo, type AnexoQueRecebeLeitura } from "./leitura-do-anexo";

const CNPJ_DA_PP = "est-salvador";
const OUTRO_CNPJ = "est-sao-paulo";

function anexoNovo(parte: Partial<AnexoQueRecebeLeitura> = {}): AnexoQueRecebeLeitura & { id: string } {
  return {
    id: "a1",
    tipo: null,
    numero: null,
    // O CNPJ nasce com o da PP (um palpite), como no `useAnexosEmEdicao`.
    nf: { numero: "", emissao: "", valor: 0, tomador: CNPJ_DA_PP },
    ...parte,
  };
}

function lido(parte: Partial<DadosLidosDoDocumento>): DadosLidosDoDocumento {
  return {
    tipo: null,
    numero: null,
    data_emissao: null,
    valor_total: null,
    tomador_estabelecimento_id: null,
    confianca_baixa: false,
    ...parte,
  };
}

test("fatura: preenche tipo, número e o CNPJ do documento, com o selo em cada um", () => {
  const r = aplicarLeitura(
    anexoNovo(),
    lido({ tipo: "fatura", numero: "149-2026", tomador_estabelecimento_id: OUTRO_CNPJ }),
    CNPJ_DA_PP,
  );
  assert.equal(r.tipo, "fatura");
  assert.equal(r.numero, "149-2026");
  assert.equal(r.nf.tomador, OUTRO_CNPJ);
  assert.equal(r.nf.numero, "", "fora da NF o número não vai para nf.numero");
  assert.deepEqual(r.leitura, { estado: "lido", campos: ["tipo", "numero", "tomador"], duvida: false });
  assert.equal((r as { id: string }).id, "a1", "o resto do anexo passa intacto");
});

test("NF: preenche número, emissão, valor e CNPJ", () => {
  const r = aplicarLeitura(
    anexoNovo(),
    lido({
      tipo: "nota_fiscal",
      numero: "1047",
      data_emissao: "2026-10-14",
      valor_total: 10000,
      tomador_estabelecimento_id: CNPJ_DA_PP,
    }),
    CNPJ_DA_PP,
  );
  assert.equal(r.tipo, "nota_fiscal");
  assert.deepEqual(r.nf, { numero: "1047", emissao: "2026-10-14", valor: 10000, tomador: CNPJ_DA_PP });
  assert.equal(r.numero, null, "na NF o número mora em nf.numero");
  assert.deepEqual(r.leitura?.campos, ["tipo", "numero", "emissao", "valor", "tomador"]);
});

test("o que alguém já preencheu fica: tipo, número, data, valor e CNPJ trocado", () => {
  const r = aplicarLeitura(
    anexoNovo({
      tipo: "nota_fiscal",
      nf: { numero: "77", emissao: "2026-10-01", valor: 500, tomador: OUTRO_CNPJ },
    }),
    lido({
      tipo: "fatura",
      numero: "1047",
      data_emissao: "2026-10-14",
      valor_total: 10000,
      tomador_estabelecimento_id: CNPJ_DA_PP,
    }),
    CNPJ_DA_PP,
  );
  assert.equal(r.tipo, "nota_fiscal", "o tipo escolhido não muda");
  assert.deepEqual(r.nf, { numero: "77", emissao: "2026-10-01", valor: 500, tomador: OUTRO_CNPJ });
  assert.deepEqual(r.leitura, { estado: "lido", campos: [], duvida: false });
});

test("tipo escolhido antes da leitura: ela completa só o número", () => {
  const r = aplicarLeitura(anexoNovo({ tipo: "recibo" }), lido({ tipo: "fatura", numero: "55" }), CNPJ_DA_PP);
  assert.equal(r.tipo, "recibo");
  assert.equal(r.numero, "55");
  assert.deepEqual(r.leitura?.campos, ["numero"]);
});

test("boleto não diz o CNPJ: o campo fica como estava", () => {
  const r = aplicarLeitura(
    anexoNovo(),
    lido({ tipo: "boleto", numero: "123", tomador_estabelecimento_id: OUTRO_CNPJ }),
    CNPJ_DA_PP,
  );
  assert.equal(r.nf.tomador, CNPJ_DA_PP);
  assert.deepEqual(r.leitura?.campos, ["tipo", "numero"]);
});

test("sem tipo lido: falha, e escolhe-se à mão", () => {
  const r = aplicarLeitura(anexoNovo(), lido({ numero: "9" }), CNPJ_DA_PP);
  assert.equal(r.tipo, null);
  assert.equal(r.numero, null);
  assert.deepEqual(r.leitura, { estado: "falhou", campos: [] });
});

test("a dúvida da IA segue no estado da leitura", () => {
  const r = aplicarLeitura(anexoNovo(), lido({ tipo: "recibo", numero: "3", confianca_baixa: true }), CNPJ_DA_PP);
  assert.equal(r.leitura?.duvida, true);
});

test("semSelo tira só os campos mexidos", () => {
  const leitura = { estado: "lido" as const, campos: ["tipo" as const, "numero" as const, "tomador" as const] };
  assert.deepEqual(semSelo(leitura, ["numero"])?.campos, ["tipo", "tomador"]);
  assert.equal(semSelo(leitura, []), leitura);
  assert.equal(semSelo(undefined, ["tipo"]), undefined);
});
