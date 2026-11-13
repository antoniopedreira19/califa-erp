/**
 * O "Exportar Excel" da tela de Fornecedores (12/11/2026).
 *
 * Rode com:  node --import tsx --test lib/exportacao/planilha-de-fornecedores.test.ts
 *
 * O arquivo é lido de volta pelo ExcelJS: cada campo do cadastro na sua
 * coluna, na ordem recebida, e as datas no dia de Brasília.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import type { Fornecedor } from "@/lib/types";
import {
  COLUNAS_DA_PLANILHA_DE_FORNECEDORES,
  montarPlanilhaDeFornecedores,
  nomeDoArquivoDeFornecedores,
} from "./planilha-de-fornecedores";

function fornecedor(over: Partial<Fornecedor>): Fornecedor {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    tenant_id: "00000000-0000-4000-8000-0000000000aa",
    tipo_pessoa: "juridica",
    nome: "FORNECEDOR 001 EXEMPLO",
    empresa_de_fora: false,
    razao_social: "FORNECEDOR 001 EXEMPLO LTDA",
    cpf_cnpj: "11222333000181",
    email: "colaborador_001@exemplo.com",
    telefone: "00000000000",
    observacoes: null,
    status: "ativo",
    created_by: null,
    // 23h30 em Brasília do dia 11 = dia 12 em UTC: tem que sair 11/11.
    created_at: "2026-11-12T02:30:00+00:00",
    updated_at: "2026-11-12T15:00:00+00:00",
    cep: "01310100",
    logradouro: "Avenida Exemplo",
    numero: "100",
    complemento: null,
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    banco_codigo: "001",
    banco_nome: "Banco do Brasil",
    agencia: "0001",
    agencia_dv: null,
    conta: "000123",
    conta_dv: "4",
    tipo_conta: "corrente",
    pix_tipo: "cnpj",
    pix_chave: "11222333000181",
    regime_tributario: "simples",
    regime_consulta: "simples",
    regime_desde: "2020-01-01",
    regime_consultado_em: "2026-11-12",
    declaracao_simples_recebida: false,
    declaracao_simples_path: null,
    sem_dados_pagamento: false,
    cnae: "5911102",
    ...over,
  };
}

async function lerDeVolta(lista: Fornecedor[], veiculos: string[] = []) {
  const buf = await montarPlanilhaDeFornecedores(lista, new Set(veiculos)).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  const ws = wb.getWorksheet("Fornecedores");
  assert.ok(ws, "a aba Fornecedores existe");
  const cab = (ws.getRow(1).values as unknown[]).slice(1) as string[];
  const linha = (n: number) => {
    const v = (ws.getRow(n).values as unknown[]).slice(1);
    return Object.fromEntries(cab.map((c, i) => [c, v[i] ?? null])) as Record<string, unknown>;
  };
  return { ws, cab, linha };
}

test("o cabeçalho tem todos os campos, sem coluna repetida", async () => {
  const { cab } = await lerDeVolta([fornecedor({})]);
  assert.deepEqual(cab, COLUNAS_DA_PLANILHA_DE_FORNECEDORES.map((c) => c.cabecalho));
  assert.equal(new Set(cab).size, cab.length);
  for (const c of ["Nome", "CNPJ / CPF", "Regime tributário", "CNAE", "Atividade (CNAE)", "Chave PIX", "Conta"]) {
    assert.ok(cab.includes(c), c);
  }
});

test("pessoa jurídica: documento, regime, CNAE com a atividade, conta e PIX", async () => {
  const { linha } = await lerDeVolta([fornecedor({})], ["00000000-0000-4000-8000-000000000001"]);
  const l = linha(2);
  assert.equal(l["Nome"], "FORNECEDOR 001 EXEMPLO");
  assert.equal(l["Tipo"], "Pessoa jurídica");
  assert.equal(l["CNPJ / CPF"], "11.222.333/0001-81");
  assert.equal(l["Status"], "Ativo");
  assert.equal(l["Regime tributário"], "Simples Nacional");
  assert.equal(l["CNAE"], "5911-1/02");
  assert.equal(l["Atividade (CNAE)"], "Produção de filmes para publicidade");
  assert.equal(l["Agência"], "0001", "zero à esquerda fica: é texto");
  assert.equal(l["Conta"], "000123");
  assert.equal(l["Tipo de conta"], "Conta corrente");
  assert.equal(l["Tipo da chave PIX"], "CNPJ");
  assert.equal(l["Veículo de mídia"], "Sim");
  assert.equal(l["Declaração do Simples recebida"], "Não");
  assert.equal(l["CEP"], "01310-100");
});

test("datas no dia de Brasília, como data do Excel", async () => {
  const { linha, ws, cab } = await lerDeVolta([fornecedor({})]);
  const l = linha(2);
  const cadastrado = l["Cadastrado em"] as Date;
  assert.ok(cadastrado instanceof Date);
  assert.equal(cadastrado.toISOString().slice(0, 10), "2026-11-11");
  assert.equal((l["Optante desde"] as Date).toISOString().slice(0, 10), "2020-01-01");
  assert.equal(ws.getRow(2).getCell(cab.indexOf("Cadastrado em") + 1).numFmt, "dd/mm/yyyy");
});

test("pessoa física: sem regime nem CNAE, sem a declaração do Simples", async () => {
  const { linha } = await lerDeVolta([
    fornecedor({
      tipo_pessoa: "fisica",
      cpf_cnpj: "11144477735",
      regime_tributario: null,
      regime_consulta: null,
      regime_desde: null,
      regime_consultado_em: null,
      cnae: null,
      status: "inativo",
    }),
  ]);
  const l = linha(2);
  assert.equal(l["Tipo"], "Pessoa física");
  assert.equal(l["CNPJ / CPF"], "111.444.777-35");
  assert.equal(l["Status"], "Inativo");
  assert.equal(l["Regime tributário"], null);
  assert.equal(l["CNAE"], null);
  assert.equal(l["Atividade (CNAE)"], null);
  assert.equal(l["Declaração do Simples recebida"], null);
  assert.equal(l["Veículo de mídia"], "Não");
});

test("as linhas saem na ordem recebida (a da tela)", async () => {
  const { linha } = await lerDeVolta([
    fornecedor({ id: "00000000-0000-4000-8000-000000000002", nome: "FORNECEDOR 002 EXEMPLO" }),
    fornecedor({ id: "00000000-0000-4000-8000-000000000001", nome: "FORNECEDOR 001 EXEMPLO" }),
  ]);
  assert.equal(linha(2)["Nome"], "FORNECEDOR 002 EXEMPLO");
  assert.equal(linha(3)["Nome"], "FORNECEDOR 001 EXEMPLO");
});

test("o nome do arquivo leva o dia de Brasília e diz quando está filtrado", () => {
  // 01h UTC do dia 13 = 22h do dia 12 em Brasília.
  const agora = new Date("2026-11-13T01:00:00Z");
  assert.equal(nomeDoArquivoDeFornecedores(false, agora), "Fornecedores - 12-11-2026.xlsx");
  assert.equal(nomeDoArquivoDeFornecedores(true, agora), "Fornecedores (filtrado) - 12-11-2026.xlsx");
});
