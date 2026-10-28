/**
 * Decisão 226: a linha vermelha nova sai da errata antes de gravar. Dados
 * sintéticos.
 *
 * Rodar: `npm run test:linha-vermelha-fora-da-errata`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  separarLinhasVermelhas,
  sobraErrata,
  trocarMarcadores,
  vermelhaForaDaErrata,
} from "./linha-vermelha-fora-da-errata";

const G1 = "00000000-0000-4000-8000-000000000001";
const G2 = "00000000-0000-4000-8000-000000000002";
const L1 = "00000000-0000-4000-8000-0000000000a1";

const nova = (grupo_id: string, item: string, linha_vermelha: boolean) => ({
  grupo_id,
  item,
  tipo_custo: "B",
  linha_vermelha,
  valor_unitario: 0,
  quantidade: 1,
  dias_meses: 1,
});

const vazio = { alteracoes: [], cancelamentos: [], remocoes: [], meses_novos: [] };

test("só linha vermelha: nada sobra para a errata", () => {
  const { conteudo, vermelhas } = separarLinhasVermelhas({
    ...vazio,
    novas: [nova(G1, " Van extra ", true)],
    estrutura: null,
  });
  assert.deepEqual(vermelhas, [{ chave: "nova:1", grupo_id: G1, item: "Van extra", tipo_custo: "B" }]);
  assert.equal(conteudo.novas.length, 0);
  assert.equal(sobraErrata(conteudo), false);
});

test("errata com vermelha junto: a normal fica e é renumerada", () => {
  const { conteudo, vermelhas } = separarLinhasVermelhas({
    ...vazio,
    novas: [nova(G1, "Van extra", true), nova(G2, "Painel de LED", false)],
    estrutura: null,
  });
  assert.deepEqual(vermelhas.map((v) => v.chave), ["nova:1"]);
  assert.deepEqual(conteudo.novas.map((n) => n.item), ["Painel de LED"]);
  assert.equal(sobraErrata(conteudo), true);
});

test("a nova ordem renumera as normais e marca a vermelha", () => {
  const { conteudo } = separarLinhasVermelhas({
    ...vazio,
    novas: [nova(G1, "Van extra", true), nova(G1, "Painel de LED", false)],
    estrutura: {
      grupos_novos: [],
      grupos_renomeados: [],
      ordem: [
        { item: "nova:2", grupo: G1 },
        { item: L1, grupo: G1 },
        { item: "nova:1", grupo: G1 },
      ],
    },
  });
  assert.deepEqual(
    conteudo.estrutura?.ordem?.map((o) => o.item),
    ["nova:1", L1, "vermelha:nova:1"],
  );
  const comIds = trocarMarcadores(conteudo, { "nova:1": "id-da-van" });
  assert.deepEqual(comIds.estrutura?.ordem?.map((o) => o.item), ["nova:1", L1, "id-da-van"]);
});

test("vermelha em agrupamento novo desta errata fica na errata", () => {
  assert.equal(vermelhaForaDaErrata(nova("grupo-novo:1", "Van", true)), false);
  const { conteudo, vermelhas } = separarLinhasVermelhas({
    ...vazio,
    novas: [nova("grupo-novo:1", "Van", true)],
    estrutura: { grupos_novos: [{ chave: "grupo-novo:1" }], grupos_renomeados: [], ordem: null },
  });
  assert.equal(vermelhas.length, 0);
  assert.equal(conteudo.novas.length, 1);
});

test("sem vermelha o conteúdo volta igual", () => {
  const entrada = { ...vazio, novas: [nova(G1, "Painel", false)], estrutura: null };
  const { conteudo, vermelhas } = separarLinhasVermelhas(entrada);
  assert.equal(vermelhas.length, 0);
  assert.equal(conteudo, entrada);
});
