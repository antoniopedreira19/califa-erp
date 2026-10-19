/**
 * Decisão 186: o histórico de versões da Planilha Interna, remontado de trás
 * para a frente a partir da planilha de hoje. Dados sintéticos — nenhum job
 * real.
 *
 * Rodar: `npm run test:historico-da-planilha`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  JobAlteracaoFinanceiroComItens,
  JobAlteracaoFinanceiroItem,
  JobErrataComItens,
  JobErrataItem,
  JobGrupo,
} from "@/lib/types";
import {
  montarHistorico,
  type DadosDoHistorico,
  type LinhaDaVersaoNoHistorico,
  type LinhaDoJobNoHistorico,
} from "./historico-da-planilha";

const T = "tenant";
const VERSAO = "versao";

function grupo(id: string, nome: string, ordem: number, extra: Partial<JobGrupo> = {}): JobGrupo {
  return {
    id,
    tenant_id: T,
    job_id: "job",
    grupo_versao_id: `v-${id}`,
    mes_id: null,
    nome,
    ordem,
    criado_na_errata_id: null,
    removido_em: null,
    removido_na_errata_id: null,
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-01T12:00:00Z",
    ...extra,
  };
}

function linha(
  id: string,
  grupoId: string,
  ordem: number,
  orcado: number,
  planejado: number,
  extra: Partial<LinhaDoJobNoHistorico> = {},
): LinhaDoJobNoHistorico {
  return {
    id,
    item_versao_id: `v-${id}`,
    linha_vermelha: false,
    grupo_id: `v-${grupoId}`,
    job_grupo_id: grupoId,
    ordem,
    item: `Item ${id}`,
    tipo_custo: "B",
    categoria_id: null,
    valor_unitario_orcado: orcado,
    quantidade_orcada: 1,
    dias_meses_orcado: 1,
    valor_unitario_planejado: planejado,
    quantidade_planejada: 1,
    dias_meses_planejado: 1,
    bv_liquido_planejado: null,
    em_save: false,
    save_consumido: 0,
    cancelada_em: null,
    planejado_antes_save: null,
    ...extra,
  };
}

function itemDeErrata(e: Partial<JobErrataItem> & Pick<JobErrataItem, "acao" | "job_item_orcado_id">): JobErrataItem {
  return {
    id: `ei-${e.job_item_orcado_id}`,
    tenant_id: T,
    errata_id: "e1",
    linha_vermelha: false,
    grupo_id: null,
    item_nome: `Item ${e.job_item_orcado_id}`,
    grupo_nome: "Agrupamento A",
    tipo_custo_de: "B",
    tipo_custo_para: "B",
    valor_unitario_de: 0,
    valor_unitario_para: 0,
    quantidade_de: 1,
    quantidade_para: 1,
    dias_meses_de: 1,
    dias_meses_para: 1,
    total_de: 0,
    total_para: 0,
    valor_unitario_planejado_de: 0,
    valor_unitario_planejado_para: 0,
    quantidade_planejada_de: 1,
    quantidade_planejada_para: 1,
    dias_meses_planejado_de: 1,
    dias_meses_planejado_para: 1,
    total_planejado_de: 0,
    total_planejado_para: 0,
    efeito_valor_job: 0,
    efeito_faturamento_previsto: null,
    ...e,
  };
}

function errata(id: string, quando: string, itens: JobErrataItem[], extra: Partial<JobErrataComItens> = {}): JobErrataComItens {
  return {
    id,
    tenant_id: T,
    job_id: "job",
    titulo: `Errata ${id}`,
    custo_orcado_antes: 0,
    custo_orcado_depois: 0,
    valor_job_antes: 0,
    valor_job_depois: 0,
    faturamento_previsto_antes: null,
    faturamento_previsto_depois: null,
    created_by: null,
    created_at: quando,
    preparada_por: null,
    estrutura: null,
    autor_nome: "Pessoa da produção",
    preparada_por_nome: null,
    itens: itens.map((i) => ({ ...i, errata_id: id })),
    ...extra,
  };
}

function alteracao(
  id: string,
  quando: string,
  itens: Array<Partial<JobAlteracaoFinanceiroItem> & Pick<JobAlteracaoFinanceiroItem, "job_item_orcado_id">>,
): JobAlteracaoFinanceiroComItens {
  return {
    id,
    tenant_id: T,
    job_id: "job",
    motivo: "Ajuste do financeiro",
    custo_orcado_antes: 0,
    custo_orcado_depois: 0,
    valor_job_antes: 0,
    valor_job_depois: 0,
    faturamento_previsto_antes: 0,
    faturamento_previsto_depois: 0,
    recebimento_antes: [],
    recebimento_depois: [],
    impostos_antes: [],
    impostos_depois: [],
    envio_antes: [],
    envio_depois: [],
    created_by: null,
    created_at: quando,
    autor_nome: "Pessoa do financeiro",
    itens: itens.map((i) => ({
      id: `ai-${i.job_item_orcado_id}`,
      tenant_id: T,
      alteracao_id: id,
      item_nome: `Item ${i.job_item_orcado_id}`,
      grupo_nome: "Agrupamento A",
      mes: null,
      tipo_custo: "B",
      tipo_custo_para: "B",
      valor_unitario_de: 0,
      valor_unitario_para: 0,
      quantidade_de: 1,
      quantidade_para: 1,
      dias_meses_de: 1,
      dias_meses_para: 1,
      total_de: 0,
      total_para: 0,
      valor_unitario_planejado_de: null,
      valor_unitario_planejado_para: null,
      quantidade_planejada_de: null,
      quantidade_planejada_para: null,
      dias_meses_planejado_de: null,
      dias_meses_planejado_para: null,
      total_planejado_de: null,
      total_planejado_para: null,
      efeito_valor_job: 0,
      efeito_faturamento_previsto: 0,
      created_at: quando,
      ...i,
    })),
  };
}

function base(extra: Partial<DadosDoHistorico>): DadosDoHistorico {
  return {
    versaoAprovadaId: VERSAO,
    enviadoAberturaEm: "2026-10-01T12:00:00Z",
    enviadoAberturaPor: "Pessoa da produção",
    abertoEm: "2026-10-03T12:00:00Z",
    abertoPor: "Pessoa do financeiro",
    criadoEm: "2026-10-01T11:00:00Z",
    linhas: [],
    grupos: [grupo("ga", "Agrupamento A", 1)],
    linhasDaVersao: [],
    erratas: [],
    alteracoes: [],
    saves: [],
    savesDesfeitos: [],
    revisoes: [],
    ...extra,
  };
}

const porId = <T extends { id: string }>(itens: T[], id: string) => itens.find((i) => i.id === id);

test("os momentos saem do mais novo para o mais antigo, com a atual no topo", () => {
  const versoes = montarHistorico(
    base({
      linhas: [linha("1", "ga", 1, 1000, 800)],
      alteracoes: [
        alteracao("a1", "2026-10-02T12:00:00Z", [
          { job_item_orcado_id: "1", valor_unitario_de: 900, valor_unitario_para: 1000 },
        ]),
      ],
      erratas: [errata("e1", "2026-10-05T12:00:00Z", [])],
    }),
  );
  assert.deepEqual(
    versoes.map((v) => v.chave),
    ["atual", "errata-e1", "abertura", "alteracao-a1", "envio"],
  );
  assert.equal(versoes.find((v) => v.chave === "alteracao-a1")?.rotulo, "Edição do financeiro na fila");
  assert.equal(versoes[0].quando, "2026-10-05T12:00:00Z");
});

test("a alteração do financeiro volta o orçado, o tipo e o planejado de antes", () => {
  const versoes = montarHistorico(
    base({
      linhas: [linha("1", "ga", 1, 1000, 700, { tipo_custo: "C" })],
      alteracoes: [
        alteracao("a1", "2026-10-02T12:00:00Z", [
          {
            job_item_orcado_id: "1",
            tipo_custo: "B",
            tipo_custo_para: "C",
            valor_unitario_de: 900,
            valor_unitario_para: 1000,
            valor_unitario_planejado_de: 800,
            quantidade_planejada_de: 1,
            dias_meses_planejado_de: 1,
            total_planejado_de: 800,
          },
        ]),
      ],
    }),
  );
  const depois = versoes.find((v) => v.chave === "alteracao-a1")!;
  const envio = versoes.find((v) => v.chave === "envio")!;
  assert.equal(porId(depois.itens, "1")?.total_orcado, 1000);
  const l = porId(envio.itens, "1")!;
  assert.equal(l.total_orcado, 900);
  assert.equal(l.total_planejado, 800);
  assert.equal(l.tipo_custo, "B");
  assert.deepEqual(
    [depois.mudancas[0].orcadoDe, depois.mudancas[0].orcadoPara, depois.mudancas[0].tipoDe, depois.mudancas[0].tipoPara],
    [900, 1000, "B", "C"],
  );
});

test("a errata desfaz a alterada, a nova e a cancelada (orçado e planejado, decisão 175)", () => {
  const versoes = montarHistorico(
    base({
      linhas: [
        linha("1", "ga", 1, 10000, 9000),
        linha("2", "ga", 2, 0, 0, { cancelada_em: "2026-10-05T12:00:00Z" }),
        linha("3", "ga", 3, 1000, 800, { item_versao_id: null }),
      ],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [
          itemDeErrata({
            acao: "alterada",
            job_item_orcado_id: "1",
            valor_unitario_de: 10000,
            total_de: 10000,
            valor_unitario_planejado_de: 8000,
            total_planejado_de: 8000,
          }),
          itemDeErrata({
            acao: "cancelada",
            job_item_orcado_id: "2",
            valor_unitario_de: 10000,
            total_de: 10000,
            valor_unitario_planejado_de: 8000,
            total_planejado_de: 8000,
          }),
          itemDeErrata({ acao: "nova", job_item_orcado_id: "3", total_para: 1000, total_planejado_para: 800 }),
        ]),
      ],
    }),
  );
  const aberto = versoes.find((v) => v.chave === "abertura")!;
  assert.deepEqual(
    aberto.itens.map((i) => [i.id, i.total_orcado, i.total_planejado, i.cancelada_em]),
    [
      ["1", 10000, 8000, null],
      ["2", 10000, 8000, null],
    ],
  );
  const daErrata = versoes.find((v) => v.chave === "errata-e1")!;
  assert.deepEqual(
    daErrata.mudancas.map((m) => [m.itemId, m.acao, m.planejadoDe, m.planejadoPara]),
    [
      ["1", "alterada", 8000, 9000],
      ["2", "cancelada", 8000, 0],
      ["3", "nova", null, 800],
    ],
  );
});

test("errata antiga sem QT, D/M e planejado mantém o que a linha tem", () => {
  const versoes = montarHistorico(
    base({
      linhas: [linha("1", "ga", 1, 1500, 700, { quantidade_orcada: 2 })],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [
          itemDeErrata({
            acao: "alterada",
            job_item_orcado_id: "1",
            valor_unitario_de: 1000,
            quantidade_de: null,
            dias_meses_de: null,
            total_planejado_de: null,
          }),
        ]),
      ],
    }),
  );
  const l = porId(versoes.find((v) => v.chave === "envio")!.itens, "1")!;
  assert.equal(l.quantidade_orcada, 2);
  assert.equal(l.total_orcado, 2000);
  assert.equal(l.total_planejado, 700);
});

test("o save da errata tira a linha do save e devolve o planejado de antes dele", () => {
  const versoes = montarHistorico(
    base({
      linhas: [
        linha("1", "ga", 1, 5000, 0, {
          em_save: true,
          planejado_antes_save: { valor_unitario: 4000, quantidade: 1, dias_meses: 1 },
        }),
      ],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [
          itemDeErrata({ acao: "alterada", job_item_orcado_id: "1", valor_unitario_de: 5000, total_planejado_de: null }),
        ]),
      ],
      saves: [{ errata_id: "e1", job_item_orcado_id: "1" }],
    }),
  );
  const daErrata = versoes.find((v) => v.chave === "errata-e1")!;
  assert.equal(daErrata.rotulo, "Errata de save");
  assert.equal(daErrata.mudancas[0].acao, "save");
  const l = porId(versoes.find((v) => v.chave === "abertura")!.itens, "1")!;
  assert.equal(l.em_save, false);
  assert.equal(l.total_planejado, 4000);
});

test("a organização volta: nome de antes, agrupamento novo sai, item volta ao lugar", () => {
  const versoes = montarHistorico(
    base({
      grupos: [
        grupo("ga", "Produção", 1),
        grupo("gb", "Extras", 2, { criado_na_errata_id: "e1" }),
        grupo("gc", "Antigo", 3, { removido_em: "2026-10-05T12:00:00Z", removido_na_errata_id: "e1" }),
      ],
      linhas: [linha("1", "ga", 1, 100, 50), linha("2", "gb", 2, 100, 50)],
      linhasDaVersao: [
        { ...linha("1", "ga", 2, 100, 50), id: "v-1", grupo_id: "v-ga" } as LinhaDaVersaoNoHistorico,
        { ...linha("2", "gc", 1, 100, 50), id: "v-2", grupo_id: "v-gc" } as LinhaDaVersaoNoHistorico,
      ],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [], {
          estrutura: [
            { tipo: "grupo_renomeado", chave: "ga", de: "Agrupamento A", para: "Produção" },
            { tipo: "grupo_novo", chave: "grupo-novo:0", nome: "Extras" },
            { tipo: "grupo_removido", chave: "gc", nome: "Antigo" },
            { tipo: "item_movido", chave: "2", item: "Item 2", de: "Antigo", para: "Extras" },
          ],
        }),
      ],
    }),
  );
  const antes = versoes.find((v) => v.chave === "abertura")!;
  assert.deepEqual(
    antes.grupos.map((g) => g.nome),
    ["Agrupamento A", "Antigo"],
  );
  assert.equal(porId(antes.itens, "2")?.grupo_id, "gc");
  // A ordem de antes da organização é a da versão aprovada.
  assert.deepEqual(
    antes.itens.map((i) => i.id),
    ["2", "1"],
  );
  assert.equal(versoes.find((v) => v.chave === "errata-e1")!.estrutura.length, 3);
});

test("a linha removida antes da decisão 151 volta pela versão aprovada", () => {
  const versoes = montarHistorico(
    base({
      linhas: [linha("1", "ga", 1, 100, 50)],
      linhasDaVersao: [
        { ...linha("1", "ga", 1, 100, 50), id: "v-1", grupo_id: "v-ga" } as LinhaDaVersaoNoHistorico,
        { ...linha("x", "ga", 2, 300, 200), id: "v-x", grupo_id: "v-ga", item: "Item x" } as LinhaDaVersaoNoHistorico,
      ],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [
          itemDeErrata({ acao: "removida", job_item_orcado_id: null, item_nome: "Item x", total_de: 300 }),
        ]),
      ],
    }),
  );
  const antes = versoes.find((v) => v.chave === "abertura")!;
  assert.deepEqual(
    antes.itens.map((i) => [i.item, i.total_orcado, i.total_planejado, i.grupo_id]),
    [
      ["Item 1", 100, 50, "ga"],
      ["Item x", 300, 200, "ga"],
    ],
  );
});

test("job sem momento algum: só a planilha atual", () => {
  const versoes = montarHistorico(
    base({ enviadoAberturaEm: null, abertoEm: null, linhas: [linha("1", "ga", 1, 100, 50)] }),
  );
  assert.deepEqual(
    versoes.map((v) => v.chave),
    ["atual"],
  );
  assert.equal(versoes[0].quando, "2026-10-01T11:00:00Z");
});

test("save sem pedido ligado: o efeito gravado diz se a linha entrou ou saiu do save", () => {
  const versoes = montarHistorico(
    base({
      linhas: [linha("1", "ga", 1, 10000, 0, { em_save: false })],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [
          itemDeErrata({
            acao: "alterada",
            job_item_orcado_id: "1",
            total_de: 10000,
            total_para: 10000,
            efeito_valor_job: -13918.23,
            total_planejado_de: null,
          }),
        ]),
        errata("e2", "2026-10-06T12:00:00Z", [
          itemDeErrata({
            acao: "alterada",
            job_item_orcado_id: "1",
            total_de: 10000,
            total_para: 10000,
            efeito_valor_job: 13918.23,
            total_planejado_de: null,
          }),
        ]),
      ],
    }),
  );
  assert.equal(porId(versoes.find((v) => v.chave === "errata-e1")!.itens, "1")?.em_save, true);
  assert.equal(porId(versoes.find((v) => v.chave === "abertura")!.itens, "1")?.em_save, false);
  const saiu = versoes.find((v) => v.chave === "errata-e2")!.mudancas[0];
  assert.deepEqual([saiu.acao, saiu.saveDe, saiu.savePara], ["alterada", true, false]);
});

test("pedido de save cancelado sem errata: a linha volta ao save antes dele", () => {
  const versoes = montarHistorico(
    base({
      linhas: [linha("1", "ga", 1, 10000, 0, { em_save: false })],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [
          itemDeErrata({
            acao: "alterada",
            job_item_orcado_id: "1",
            total_de: 10000,
            total_para: 10000,
            efeito_valor_job: -13918.23,
            total_planejado_de: null,
          }),
        ]),
      ],
      savesDesfeitos: [
        {
          id: "s1",
          job_item_orcado_id: "1",
          item: "Item 1",
          grupo: "Agrupamento A",
          como: "cancelado",
          quando: "2026-10-05T13:00:00Z",
          por: null,
        },
      ],
    }),
  );
  assert.deepEqual(
    versoes.map((v) => v.chave),
    ["atual", "save-s1", "errata-e1", "abertura", "envio"],
  );
  assert.equal(porId(versoes.find((v) => v.chave === "errata-e1")!.itens, "1")?.em_save, true);
  assert.equal(versoes.find((v) => v.chave === "save-s1")!.rotulo, "Pedido de save cancelado");
});

test("linha nova apagada antes da decisão 151: a nova sem id sai com a que a remoção devolveu", () => {
  const versoes = montarHistorico(
    base({
      linhas: [linha("1", "ga", 1, 100, 50)],
      erratas: [
        errata("e1", "2026-10-05T12:00:00Z", [
          itemDeErrata({ acao: "nova", job_item_orcado_id: null, item_nome: "Extra", total_para: 300 }),
        ]),
        errata("e2", "2026-10-06T12:00:00Z", [
          itemDeErrata({
            acao: "removida",
            job_item_orcado_id: null,
            item_nome: "Extra",
            grupo_id: "v-ga",
            valor_unitario_de: 300,
            total_de: 300,
          }),
        ]),
      ],
    }),
  );
  assert.deepEqual(
    versoes.find((v) => v.chave === "errata-e1")!.itens.map((i) => [i.item, i.total_orcado]),
    [
      ["Item 1", 100],
      ["Extra", 300],
    ],
  );
  assert.deepEqual(
    versoes.find((v) => v.chave === "abertura")!.itens.map((i) => i.item),
    ["Item 1"],
  );
});
