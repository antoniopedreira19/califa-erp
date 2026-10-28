import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validarInputPacote,
  type InputPacote,
} from "./validar-input-pacote";

test("validarInputPacote: itens vazios → erro 'pelo menos uma empresa'", () => {
  const input: InputPacote = {
    itens: [],
  };

  const result = validarInputPacote(input);

  assert.equal(result.ok, false);
  assert.ok(result.ok === false);
  if (!result.ok) {
    assert.ok(
      result.erros.some((e) =>
        e.toLowerCase().includes("pelo menos uma empresa")
      )
    );
  }
});

test("validarInputPacote: soma % empresa = 100 com 1 item → ok=true", () => {
  const input: InputPacote = {
    itens: [
      {
        empresa_id: "emp-001",
        percentual_empresa: 100,
        usa_rateio_empresa: true,
        regionais: [],
      },
    ],
  };

  const result = validarInputPacote(input);

  assert.equal(result.ok, true);
});

test("validarInputPacote: soma % empresa = 99.99 → erro 'soma 100'", () => {
  const input: InputPacote = {
    itens: [
      {
        empresa_id: "emp-001",
        percentual_empresa: 99.99,
        usa_rateio_empresa: true,
        regionais: [],
      },
    ],
  };

  const result = validarInputPacote(input);

  assert.equal(result.ok, false);
  assert.ok(result.ok === false);
  if (!result.ok) {
    assert.ok(result.erros.some((e) => e.toLowerCase().includes("100")));
  }
});

test("validarInputPacote: item usa_rateio_empresa=true com regionais não vazio → erro", () => {
  const input: InputPacote = {
    itens: [
      {
        empresa_id: "emp-001",
        percentual_empresa: 100,
        usa_rateio_empresa: true,
        regionais: [
          {
            regional_id: "reg-001",
            percentual_regional: 100,
          },
        ],
      },
    ],
  };

  const result = validarInputPacote(input);

  assert.equal(result.ok, false);
  assert.ok(result.ok === false);
  if (!result.ok) {
    assert.ok(result.erros.length > 0, "Should have at least one error");
    assert.ok(
      result.erros.some((e) => e.toLowerCase().includes("regional")),
      `Expected error to mention regional, got: ${JSON.stringify(result.erros)}`
    );
  }
});

test("validarInputPacote: item usa_rateio_empresa=false, 2 regionais somando 100 → ok=true", () => {
  const input: InputPacote = {
    itens: [
      {
        empresa_id: "emp-001",
        percentual_empresa: 100,
        usa_rateio_empresa: false,
        regionais: [
          {
            regional_id: "reg-001",
            percentual_regional: 50,
          },
          {
            regional_id: "reg-002",
            percentual_regional: 50,
          },
        ],
      },
    ],
  };

  const result = validarInputPacote(input);

  assert.equal(result.ok, true);
});

test("validarInputPacote: item usa_rateio_empresa=false, 2 regionais somando 99 → erro", () => {
  const input: InputPacote = {
    itens: [
      {
        empresa_id: "emp-001",
        percentual_empresa: 100,
        usa_rateio_empresa: false,
        regionais: [
          {
            regional_id: "reg-001",
            percentual_regional: 50,
          },
          {
            regional_id: "reg-002",
            percentual_regional: 49,
          },
        ],
      },
    ],
  };

  const result = validarInputPacote(input);

  assert.equal(result.ok, false);
  assert.ok(result.ok === false);
  if (!result.ok) {
    assert.ok(result.erros.some((e) => e.toLowerCase().includes("100")));
  }
});

test("validarInputPacote: mesma empresa 2x no mesmo pacote → erro 'empresa duplicada'", () => {
  const input: InputPacote = {
    itens: [
      {
        empresa_id: "emp-001",
        percentual_empresa: 50,
        usa_rateio_empresa: true,
        regionais: [],
      },
      {
        empresa_id: "emp-001",
        percentual_empresa: 50,
        usa_rateio_empresa: true,
        regionais: [],
      },
    ],
  };

  const result = validarInputPacote(input);

  assert.equal(result.ok, false);
  assert.ok(result.ok === false);
  if (!result.ok) {
    assert.ok(result.erros.some((e) => e.toLowerCase().includes("duplicada")));
  }
});
