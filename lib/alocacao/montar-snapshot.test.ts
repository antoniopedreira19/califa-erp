import { test } from "node:test";
import assert from "node:assert/strict";
import {
  montarSnapshot,
  type MontarSnapshotInput,
} from "./montar-snapshot";
import type {
  ColaboradorAlocacao,
  ColaboradorAlocacaoItem,
  ColaboradorAlocacaoItemRegional,
} from "../types";

test("montarSnapshot: pacote null → snapshot null", () => {
  const result = montarSnapshot({ pacote: null, itens: [], regionais: [] });
  assert.equal(result, null);
});

test("montarSnapshot: pacote + 1 item + 1 regional → estrutura aninhada", () => {
  const pacote: ColaboradorAlocacao = {
    id: "pac-001",
    tenant_id: "tenant-001",
    colaborador_id: "colab-001",
    empresa_id: null, // legado
    regional_id: null, // legado
    usa_rateio_empresa: null, // legado
    data_inicio: "2026-10-01",
    data_fim: null,
    motivo: null,
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
  };

  const itens: ColaboradorAlocacaoItem[] = [
    {
      id: "item-001",
      tenant_id: "tenant-001",
      alocacao_id: "pac-001",
      empresa_id: "emp-001",
      percentual_empresa: 100,
      usa_rateio_empresa: false,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];

  const regionais: (ColaboradorAlocacaoItemRegional & {
    regional_nome: string;
  })[] = [
    {
      id: "reg-001",
      tenant_id: "tenant-001",
      alocacao_item_id: "item-001",
      regional_id: "reg-calc-001",
      percentual_regional: 100,
      created_at: "2026-10-01T00:00:00Z",
      regional_nome: "São Paulo",
    },
  ];

  const result = montarSnapshot({ pacote, itens, regionais });

  assert.ok(result, "snapshot não deve ser null");
  assert.deepStrictEqual(result.pacote, pacote);
  assert.equal(result.itens.length, 1);
  assert.equal(result.itens[0].id, "item-001");
  assert.equal(result.itens[0].regionais.length, 1);
  assert.equal(result.itens[0].regionais[0].id, "reg-001");
  assert.equal(result.itens[0].regionais[0].regional_nome, "São Paulo");
});

test("montarSnapshot: pacote + 2 itens, cada um com 2 regionais", () => {
  const pacote: ColaboradorAlocacao = {
    id: "pac-002",
    tenant_id: "tenant-001",
    colaborador_id: "colab-001",
    empresa_id: null,
    regional_id: null,
    usa_rateio_empresa: null,
    data_inicio: "2026-10-01",
    data_fim: null,
    motivo: null,
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
  };

  const itens: ColaboradorAlocacaoItem[] = [
    {
      id: "item-001",
      tenant_id: "tenant-001",
      alocacao_id: "pac-002",
      empresa_id: "emp-001",
      percentual_empresa: 60,
      usa_rateio_empresa: false,
      created_at: "2026-10-01T00:00:00Z",
    },
    {
      id: "item-002",
      tenant_id: "tenant-001",
      alocacao_id: "pac-002",
      empresa_id: "emp-002",
      percentual_empresa: 40,
      usa_rateio_empresa: false,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];

  const regionais: (ColaboradorAlocacaoItemRegional & {
    regional_nome: string;
  })[] = [
    {
      id: "reg-001",
      tenant_id: "tenant-001",
      alocacao_item_id: "item-001",
      regional_id: "reg-calc-001",
      percentual_regional: 50,
      created_at: "2026-10-01T00:00:00Z",
      regional_nome: "São Paulo",
    },
    {
      id: "reg-002",
      tenant_id: "tenant-001",
      alocacao_item_id: "item-001",
      regional_id: "reg-calc-002",
      percentual_regional: 50,
      created_at: "2026-10-01T00:00:00Z",
      regional_nome: "Minas Gerais",
    },
    {
      id: "reg-003",
      tenant_id: "tenant-001",
      alocacao_item_id: "item-002",
      regional_id: "reg-calc-003",
      percentual_regional: 75,
      created_at: "2026-10-01T00:00:00Z",
      regional_nome: "Rio de Janeiro",
    },
    {
      id: "reg-004",
      tenant_id: "tenant-001",
      alocacao_item_id: "item-002",
      regional_id: "reg-calc-004",
      percentual_regional: 25,
      created_at: "2026-10-01T00:00:00Z",
      regional_nome: "São Paulo",
    },
  ];

  const result = montarSnapshot({ pacote, itens, regionais });

  assert.ok(result);
  assert.equal(result.itens.length, 2);
  assert.equal(result.itens[0].regionais.length, 2);
  assert.equal(result.itens[0].regionais[0].regional_nome, "São Paulo");
  assert.equal(result.itens[0].regionais[1].regional_nome, "Minas Gerais");
  assert.equal(result.itens[1].regionais.length, 2);
  assert.equal(result.itens[1].regionais[0].regional_nome, "Rio de Janeiro");
  assert.equal(result.itens[1].regionais[1].regional_nome, "São Paulo");
});

test("montarSnapshot: item com usa_rateio_empresa=true + 0 regionais → item.regionais = []", () => {
  const pacote: ColaboradorAlocacao = {
    id: "pac-003",
    tenant_id: "tenant-001",
    colaborador_id: "colab-001",
    empresa_id: null,
    regional_id: null,
    usa_rateio_empresa: null,
    data_inicio: "2026-10-01",
    data_fim: null,
    motivo: null,
    created_by: null,
    created_at: "2026-10-01T00:00:00Z",
  };

  const itens: ColaboradorAlocacaoItem[] = [
    {
      id: "item-001",
      tenant_id: "tenant-001",
      alocacao_id: "pac-003",
      empresa_id: "emp-001",
      percentual_empresa: 100,
      usa_rateio_empresa: true,
      created_at: "2026-10-01T00:00:00Z",
    },
  ];

  const regionais: (ColaboradorAlocacaoItemRegional & {
    regional_nome: string;
  })[] = [];

  const result = montarSnapshot({ pacote, itens, regionais });

  assert.ok(result);
  assert.equal(result.itens.length, 1);
  assert.equal(result.itens[0].usa_rateio_empresa, true);
  assert.deepStrictEqual(result.itens[0].regionais, []);
});
