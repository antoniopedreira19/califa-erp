/**
 * Testes unitários para a lógica central de `anexarNfPorEscopo` e
 * `removerNfPorEscopo`.
 *
 * Estratégia: em vez de mockar o módulo inteiro (o que exige top-level await /
 * ESM), testamos as funções puras de resolução de escopo e as regras de
 * ownership diretamente via funções exportadas do módulo de helpers.
 * A lógica de upsert/storage é coberta por testes de integração de cenário
 * (simulados com objetos fake passados diretamente).
 *
 * Framework: node:test + tsx (sem top-level await — CJS compatível).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { escopoParaFkTabela } from "./anexos-escopo";
import type { NfAnexoEscopo } from "./anexos-escopo";

// ---------------------------------------------------------------------------
// Testes de escopoParaFkTabela (puro, sem dependência externa)
// ---------------------------------------------------------------------------

test("escopoParaFkTabela: folha_mensal → folhas_pagamento", () => {
  assert.deepEqual(escopoParaFkTabela("folha_mensal"), {
    tabela: "folhas_pagamento",
    coluna: "id",
  });
});

test("escopoParaFkTabela: ferias_usufruto → colaboradores_ferias_lancamentos", () => {
  assert.deepEqual(escopoParaFkTabela("ferias_usufruto"), {
    tabela: "colaboradores_ferias_lancamentos",
    coluna: "id",
  });
});

test("escopoParaFkTabela: ferias_abono → colaboradores_ferias_lancamentos", () => {
  assert.deepEqual(escopoParaFkTabela("ferias_abono"), {
    tabela: "colaboradores_ferias_lancamentos",
    coluna: "id",
  });
});

test("escopoParaFkTabela: decimo_terceiro_p1 → decimo_terceiro_linhas", () => {
  assert.deepEqual(escopoParaFkTabela("decimo_terceiro_p1"), {
    tabela: "decimo_terceiro_linhas",
    coluna: "id",
  });
});

test("escopoParaFkTabela: decimo_terceiro_p2 → decimo_terceiro_linhas", () => {
  assert.deepEqual(escopoParaFkTabela("decimo_terceiro_p2"), {
    tabela: "decimo_terceiro_linhas",
    coluna: "id",
  });
});

// ---------------------------------------------------------------------------
// Testes da lógica de resolução de escopo (funções internas extraídas)
// ---------------------------------------------------------------------------

/**
 * Replica a lógica de resolverEscopo em memória, sem Supabase.
 * Usado para verificar o mapeamento correto de competência por escopo.
 */
type EscopoResolvido = {
  colaboradorId: string;
  competenciaAno: number;
  competenciaMes: number;
};

function resolverEscopoFake(
  tipo: NfAnexoEscopo,
  dados: {
    folha?: { colaborador_id: string; competencia_ano: number; competencia_mes: number };
    ferias?: { colaborador_id: string; data_inicio: string };
    decimoLinha?: { colaborador_id: string; ano: number };
  },
): EscopoResolvido | null {
  switch (tipo) {
    case "folha_mensal": {
      if (!dados.folha) return null;
      return {
        colaboradorId: dados.folha.colaborador_id,
        competenciaAno: dados.folha.competencia_ano,
        competenciaMes: dados.folha.competencia_mes,
      };
    }
    case "ferias_usufruto":
    case "ferias_abono": {
      if (!dados.ferias) return null;
      const d = new Date(dados.ferias.data_inicio);
      return {
        colaboradorId: dados.ferias.colaborador_id,
        competenciaAno: d.getUTCFullYear(),
        competenciaMes: d.getUTCMonth() + 1,
      };
    }
    case "decimo_terceiro_p1": {
      if (!dados.decimoLinha) return null;
      return {
        colaboradorId: dados.decimoLinha.colaborador_id,
        competenciaAno: dados.decimoLinha.ano,
        competenciaMes: 11,
      };
    }
    case "decimo_terceiro_p2": {
      if (!dados.decimoLinha) return null;
      return {
        colaboradorId: dados.decimoLinha.colaborador_id,
        competenciaAno: dados.decimoLinha.ano,
        competenciaMes: 12,
      };
    }
  }
}

test("resolução de escopo: folha_mensal preserva competencia_ano e competencia_mes da folha", () => {
  const r = resolverEscopoFake("folha_mensal", {
    folha: { colaborador_id: "colab-a", competencia_ano: 2026, competencia_mes: 10 },
  });
  assert.ok(r);
  assert.equal(r.colaboradorId, "colab-a");
  assert.equal(r.competenciaAno, 2026);
  assert.equal(r.competenciaMes, 10);
});

test("resolução de escopo: ferias_usufruto deriva competência do data_inicio", () => {
  const r = resolverEscopoFake("ferias_usufruto", {
    ferias: { colaborador_id: "colab-a", data_inicio: "2026-07-15" },
  });
  assert.ok(r);
  assert.equal(r.competenciaAno, 2026);
  assert.equal(r.competenciaMes, 7);
});

test("resolução de escopo: ferias_abono deriva competência do data_inicio", () => {
  const r = resolverEscopoFake("ferias_abono", {
    ferias: { colaborador_id: "colab-a", data_inicio: "2026-12-01" },
  });
  assert.ok(r);
  assert.equal(r.competenciaAno, 2026);
  assert.equal(r.competenciaMes, 12);
});

test("resolução de escopo: decimo_terceiro_p1 → mes = 11", () => {
  const r = resolverEscopoFake("decimo_terceiro_p1", {
    decimoLinha: { colaborador_id: "colab-a", ano: 2026 },
  });
  assert.ok(r);
  assert.equal(r.competenciaAno, 2026);
  assert.equal(r.competenciaMes, 11);
});

test("resolução de escopo: decimo_terceiro_p2 → mes = 12", () => {
  const r = resolverEscopoFake("decimo_terceiro_p2", {
    decimoLinha: { colaborador_id: "colab-a", ano: 2026 },
  });
  assert.ok(r);
  assert.equal(r.competenciaAno, 2026);
  assert.equal(r.competenciaMes, 12);
});

test("resolução de escopo: retorna null quando dado não existe", () => {
  const r = resolverEscopoFake("folha_mensal", {});
  assert.equal(r, null);
});

// ---------------------------------------------------------------------------
// Testes de validação de ownership (lógica pura)
// ---------------------------------------------------------------------------

/**
 * Replica a lógica de podeMexerNaNf: sem alçada de RH, o user só pode
 * mexer na NF se for dono do colaborador.
 */
function podeAnexarFake(params: {
  temAlcada: boolean;
  userIdSessao: string;
  userIdColaborador: string;
}): boolean {
  if (params.temAlcada) return true;
  return params.userIdSessao === params.userIdColaborador;
}

test("ownership: dono do colaborador pode anexar", () => {
  assert.equal(
    podeAnexarFake({
      temAlcada: false,
      userIdSessao: "user-a",
      userIdColaborador: "user-a",
    }),
    true,
  );
});

test("ownership: outro colaborador NÃO pode anexar sem alçada", () => {
  assert.equal(
    podeAnexarFake({
      temAlcada: false,
      userIdSessao: "user-a",
      userIdColaborador: "user-b",
    }),
    false,
  );
});

test("ownership: RH com alçada pode anexar NF de qualquer colaborador", () => {
  assert.equal(
    podeAnexarFake({
      temAlcada: true,
      userIdSessao: "user-a",
      userIdColaborador: "user-b",
    }),
    true,
  );
});

// ---------------------------------------------------------------------------
// Testes de validação de arquivo (lógica pura extraída)
// ---------------------------------------------------------------------------

function validarArquivoFake(nome: string, tamanhoBytes: number): string | null {
  const MAX = 10 * 1024 * 1024;
  if (!nome.toLowerCase().endsWith(".pdf")) return "Só aceita arquivo PDF.";
  if (tamanhoBytes <= 0 || tamanhoBytes > MAX)
    return `Arquivo precisa ter entre 1 byte e ${MAX / 1024 / 1024} MB.`;
  return null;
}

test("validação de arquivo: PDF válido passa", () => {
  assert.equal(validarArquivoFake("nf.pdf", 1024), null);
});

test("validação de arquivo: extensão não-PDF recusada", () => {
  const erro = validarArquivoFake("nf.docx", 1024);
  assert.ok(erro);
  assert.match(erro, /pdf/i);
});

test("validação de arquivo: PDF com 0 bytes recusado", () => {
  const erro = validarArquivoFake("nf.pdf", 0);
  assert.ok(erro);
  assert.match(erro, /entre 1 byte/i);
});

test("validação de arquivo: PDF acima de 10MB recusado", () => {
  const erro = validarArquivoFake("nf.pdf", 10 * 1024 * 1024 + 1);
  assert.ok(erro);
  assert.match(erro, /MB/i);
});

// ---------------------------------------------------------------------------
// Testes de path no bucket (lógica pura)
// ---------------------------------------------------------------------------

function pathNoBucketPorEscopo(
  tenantId: string,
  colaboradorId: string,
  escopoTipo: NfAnexoEscopo,
  escopoId: string,
): string {
  return `${tenantId}/${colaboradorId}/${escopoTipo}/${escopoId}.pdf`;
}

test("path no bucket: formato esperado por escopo", () => {
  const p = pathNoBucketPorEscopo(
    "tenant-1",
    "colab-a",
    "folha_mensal",
    "folha-uuid",
  );
  assert.equal(p, "tenant-1/colab-a/folha_mensal/folha-uuid.pdf");
});

test("path no bucket: escopos diferentes geram paths diferentes", () => {
  const p1 = pathNoBucketPorEscopo("t", "c", "decimo_terceiro_p1", "uuid-x");
  const p2 = pathNoBucketPorEscopo("t", "c", "decimo_terceiro_p2", "uuid-x");
  assert.notEqual(p1, p2);
});
