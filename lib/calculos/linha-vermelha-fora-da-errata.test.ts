/**
 * Decisão 226: a linha vermelha nova sai da errata antes de gravar. Dados
 * sintéticos.
 *
 * Rodar: `npm run test:linha-vermelha-fora-da-errata`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gruposSoDeVermelhas,
  separarLinhasVermelhas,
  sobraErrata,
  trocarMarcadores,
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

test("29/10: agrupamento novo só de vermelhas sai junto com elas", () => {
  const { conteudo, vermelhas, grupos } = separarLinhasVermelhas({
    ...vazio,
    novas: [nova("grupo-novo:1", "Van", true), nova("grupo-novo:1", "Gelo seco", true)],
    estrutura: {
      grupos_novos: [{ chave: "grupo-novo:1", nome: " LINHA VERMELHA ", mes_id: null }],
      grupos_renomeados: [],
      ordem: null,
    },
  });
  assert.deepEqual(grupos, [{ chave: "grupo-novo:1", nome: "LINHA VERMELHA", mes_id: null }]);
  assert.deepEqual(vermelhas.map((v) => [v.chave, v.grupo_id]), [["nova:1", "grupo-novo:1"], ["nova:2", "grupo-novo:1"]]);
  assert.equal(sobraErrata(conteudo), false);
});

test("29/10: agrupamento novo com item normal fica na errata, com as vermelhas", () => {
  const { conteudo, vermelhas } = separarLinhasVermelhas({
    ...vazio,
    novas: [nova("grupo-novo:1", "Van", true), nova("grupo-novo:1", "Painel", false)],
    estrutura: {
      grupos_novos: [{ chave: "grupo-novo:1", nome: "Extras", mes_id: null }],
      grupos_renomeados: [],
      ordem: null,
    },
  });
  assert.equal(vermelhas.length, 0);
  assert.equal(conteudo.novas.length, 2);
});

test("29/10: agrupamento novo que recebe linha movida fica na errata", () => {
  assert.equal(
    gruposSoDeVermelhas({
      novas: [nova("grupo-novo:1", "Van", true)],
      estrutura: {
        grupos_novos: [{ chave: "grupo-novo:1", nome: "Extras", mes_id: null }],
        ordem: [
          { item: L1, grupo: "grupo-novo:1" },
          { item: "nova:1", grupo: "grupo-novo:1" },
        ],
      },
    }).size,
    0,
  );
});

test("29/10: o agrupamento que fica é renumerado e a ordem leva os marcadores", () => {
  const { conteudo, grupos } = separarLinhasVermelhas({
    ...vazio,
    novas: [nova("grupo-novo:1", "Van", true), nova("grupo-novo:2", "Painel", false)],
    estrutura: {
      grupos_novos: [
        { chave: "grupo-novo:1", nome: "LINHA VERMELHA", mes_id: null },
        { chave: "grupo-novo:2", nome: "Extras", mes_id: null },
      ],
      grupos_renomeados: [],
      ordem: [
        { item: L1, grupo: G1 },
        { item: "nova:1", grupo: "grupo-novo:1" },
        { item: "nova:2", grupo: "grupo-novo:2" },
      ],
    },
  });
  assert.deepEqual(grupos.map((g) => g.chave), ["grupo-novo:1"]);
  assert.deepEqual(conteudo.estrutura?.grupos_novos.map((g) => [g.chave, g.nome]), [["grupo-novo:1", "Extras"]]);
  assert.deepEqual(conteudo.novas.map((n) => n.grupo_id), ["grupo-novo:1"]);
  const comIds = trocarMarcadores(conteudo, { "nova:1": "id-da-van" }, { "grupo-novo:1": "id-do-grupo" });
  assert.deepEqual(
    comIds.estrutura?.ordem?.map((o) => [o.item, o.grupo]),
    [[L1, G1], ["id-da-van", "id-do-grupo"], ["nova:1", "grupo-novo:1"]],
  );
});

test("sem vermelha o conteúdo volta igual", () => {
  const entrada = { ...vazio, novas: [nova(G1, "Painel", false)], estrutura: null };
  const { conteudo, vermelhas } = separarLinhasVermelhas(entrada);
  assert.equal(vermelhas.length, 0);
  assert.equal(conteudo, entrada);
});
