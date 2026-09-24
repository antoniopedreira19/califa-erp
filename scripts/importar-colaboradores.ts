/**
 * Importa colaboradores do CSV da Kika.
 *
 * Uso:
 *   npx tsx scripts/importar-colaboradores.ts
 *
 * Gera SQL em stdout com todos os INSERTs (colaborador + salario + alocação),
 * pronto pra colar num apply_migration ou execute_sql.
 *
 * Regras (decisões travadas em 2026-09-23):
 *   - Nome com parênteses tem o conteúdo dos parênteses removido:
 *     "Andre (Deco)" → "Andre".
 *   - CPF só dígitos; se != 11, vira null (colaborador cadastrado com
 *     pendência pra completar depois).
 *   - Salário "R$ 15.000,00" → 15000.00.
 *   - Data DD/MM/YYYY → ISO.
 *   - Tipo: PJ/CLT/MEI/Estágio → enum direto; Híbrido → clt_recibo;
 *     Sócio → socio.
 *   - Empresa: lookup por nome_fantasia. Maria Isabel dos Santos é
 *     hardcoded pra CCH (dado errado no CSV).
 *   - Regional "Tudo" → usa_rateio_empresa=true, regional_id=null.
 *   - Paula Letícia B. Sereno é pulada (dado quase todo vazio).
 *   - Cria 1 linha em colaboradores_salarios com data_inicio = data_admissao.
 *   - Cria 1 linha em colaboradores_alocacoes com data_inicio = data_admissao.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TENANT_ID = "d2a02c10-9c7e-4157-8dd5-84bbf5a7044c";
const CREATED_BY = "ba2e2ba1-1ba0-4e3d-99de-5d9d89877381"; // Antonio Pedreira (admin)
const CSV_PATH = resolve(
  __dirname,
  "..",
  "docs",
  "modulos",
  "rh",
  "COLABORADORES-PRIMEIROINPUT.csv",
);

// Mapa empresa → id (obtido via MCP em 2026-09-23)
const EMPRESAS: Record<string, string> = {
  California: "304039bd-509d-4536-aa26-44e7091ee718",
  CCH: "1703fd52-a36c-4701-816c-a0bcc868351d",
  Hitlab: "a61067d9-b46b-40b0-8541-4850f13aa47c",
  Ventura: "3b0edb30-9cb0-4604-b563-33b42be51bc2",
};

// Mapa (empresa_id, nome regional) → regional_id
const REGIONAIS: Record<string, Record<string, string>> = {
  California: {
    NE: "54c627a6-e2d4-480b-9bd4-2f1acbf0ea91",
    NO: "57e9291e-9544-4bdf-a22f-a7b10cbfbcdd",
    RJ: "9648d4bb-e4c2-4283-b8fb-206974005399",
    SP: "29b8e2d0-3fe9-4380-86b0-ede8299c2c32",
    SS: "7767a4aa-6ca1-4bb7-8f45-f993db384bef",
  },
  CCH: {
    Agency: "be58f1de-d2ff-4cd2-aca6-434e696bfba1",
    Doca: "b8ab4a2a-50dc-40e0-a08a-2a48f8a09f61",
  },
  Hitlab: {
    Hitlab: "c074c4ca-00c2-407b-8cf3-991a17c9c297",
  },
  Ventura: {
    Ventura: "8c8b2342-073c-4e80-aee3-909d53a01426",
  },
};

// Precisa preencher Ventura + regional; leio via env do script quando rodar.
// Como estou hardcoding, vou passar via ID do banco na hora que gerar o SQL.
const VENTURA_ID_PLACEHOLDER = "__VENTURA_ID__";
const VENTURA_REGIONAL_ID_PLACEHOLDER = "__VENTURA_REGIONAL_ID__";

type Linha = {
  nome: string;
  cpf: string | null;
  empresa: string;
  regional: string;
  tipo: string;
  data_admissao: string; // ISO
  funcao: string;
  area: string;
  salario: string; // numeric string com 2 decimais
  data_nascimento: string | null; // ISO ou null
  usa_rateio: boolean;
  regional_id: string | null; // null se usa_rateio
  empresa_id: string;
};

function limparNome(nome: string): string {
  // Remove parênteses e conteúdo dentro; strip espaços
  return nome.replace(/\s*\([^)]*\)\s*/g, " ").trim();
}

function normalizarCPF(s: string): string | null {
  const digits = s.replace(/\D/g, "");
  return digits.length === 11 ? digits : null;
}

function normalizarData(s: string): string | null {
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function normalizarSalario(s: string): string {
  // "R$ 15.000,00" → "15000.00"
  const limpo = s.replace(/R\$/g, "").replace(/\./g, "").replace(/,/g, ".").trim();
  const n = Number(limpo);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Salário inválido: ${s}`);
  }
  return n.toFixed(2);
}

const TIPO_MAP: Record<string, string> = {
  PJ: "pj",
  MEI: "mei",
  CLT: "clt",
  Estágio: "estagio",
  Estagio: "estagio",
  Híbrido: "clt_recibo",
  Hibrido: "clt_recibo",
  Sócio: "socio",
  Socio: "socio",
};

function normalizarTipo(s: string): string {
  const chave = s.trim();
  const map = TIPO_MAP[chave];
  if (!map) throw new Error(`Tipo desconhecido: ${chave}`);
  return map;
}

function sqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlLiteral(v: string | null): string {
  if (v === null || v === "") return "null";
  return `'${sqlEscape(v)}'`;
}

// --- MAIN ---

const raw = readFileSync(CSV_PATH, "utf8").replace(/^﻿/, "");
const linhas = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = linhas.shift();
if (!header) throw new Error("CSV vazio");

const registros: Linha[] = [];
const erros: string[] = [];

for (let i = 0; i < linhas.length; i++) {
  const idxLinha = i + 2; // linha 1 é header no arquivo
  const raw = linhas[i];
  const cols = raw.split(";");
  if (cols.length < 12) {
    erros.push(`linha ${idxLinha}: só ${cols.length} colunas, esperado 12+`);
    continue;
  }
  const [
    _colaborador,
    _cpf,
    _status,
    _empresa,
    _regional,
    _tipo,
    _dataInicio,
    _dataFim,
    _funcao,
    _area,
    _salario,
    _dataNasc,
  ] = cols;

  const nome = limparNome(_colaborador);
  if (nome === "Paula Letícia B. Sereno") continue; // decisão user

  let empresa = _empresa.trim();
  let regional = _regional.trim();
  // Fix Maria Isabel — dado errado no CSV (California; regional=CCH Doca)
  if (nome === "Maria Isabel dos Santos") {
    empresa = "CCH";
    regional = "Doca";
  }

  if (!EMPRESAS[empresa]) {
    erros.push(`linha ${idxLinha} (${nome}): empresa desconhecida "${empresa}"`);
    continue;
  }

  let usa_rateio = false;
  let regional_id: string | null = null;
  if (regional === "Tudo") {
    usa_rateio = true;
  } else {
    const map = REGIONAIS[empresa];
    if (!map || !map[regional]) {
      erros.push(
        `linha ${idxLinha} (${nome}): regional "${regional}" não existe em ${empresa}`,
      );
      continue;
    }
    regional_id = map[regional];
  }

  let tipo: string;
  try {
    tipo = normalizarTipo(_tipo);
  } catch (e: any) {
    erros.push(`linha ${idxLinha} (${nome}): ${e.message}`);
    continue;
  }

  const data_admissao = normalizarData(_dataInicio);
  if (!data_admissao) {
    erros.push(`linha ${idxLinha} (${nome}): data de admissão inválida "${_dataInicio}"`);
    continue;
  }

  const data_nascimento = normalizarData(_dataNasc);

  let salario: string;
  try {
    salario = normalizarSalario(_salario);
  } catch (e: any) {
    erros.push(`linha ${idxLinha} (${nome}): ${e.message}`);
    continue;
  }

  const cpf = normalizarCPF(_cpf);

  registros.push({
    nome,
    cpf,
    empresa,
    regional,
    tipo,
    data_admissao,
    funcao: _funcao.trim(),
    area: _area.trim(),
    salario,
    data_nascimento,
    usa_rateio,
    regional_id,
    empresa_id: EMPRESAS[empresa],
  });
}

// --- Gera SQL ---

const linhasSql: string[] = [];
linhasSql.push("-- Import de colaboradores (2026-09-23)");
linhasSql.push("-- Gerado por scripts/importar-colaboradores.ts");
linhasSql.push(`-- ${registros.length} registros`);
linhasSql.push("");
linhasSql.push("do $$");
linhasSql.push("declare");
linhasSql.push("  v_colab_id uuid;");
linhasSql.push("begin");

for (const r of registros) {
  linhasSql.push(`-- ${r.nome}`);
  linhasSql.push(
    `insert into public.colaboradores (tenant_id, nome, tipo_contratacao, cpf_cnpj, funcao, data_admissao, data_nascimento, area, status, created_by) values ('${TENANT_ID}', ${sqlLiteral(r.nome)}, '${r.tipo}'::public.tipo_contratacao, ${sqlLiteral(r.cpf)}, ${sqlLiteral(r.funcao)}, '${r.data_admissao}'::date, ${r.data_nascimento ? `'${r.data_nascimento}'::date` : "null"}, ${sqlLiteral(r.area)}, 'ativo'::public.cadastro_status, '${CREATED_BY}') returning id into v_colab_id;`,
  );
  linhasSql.push(
    `insert into public.colaboradores_salarios (tenant_id, colaborador_id, valor, data_inicio, created_by) values ('${TENANT_ID}', v_colab_id, ${r.salario}, '${r.data_admissao}'::date, '${CREATED_BY}');`,
  );
  linhasSql.push(
    `insert into public.colaboradores_alocacoes (tenant_id, colaborador_id, empresa_id, regional_id, usa_rateio_empresa, data_inicio, created_by) values ('${TENANT_ID}', v_colab_id, '${r.empresa_id}', ${r.regional_id ? `'${r.regional_id}'` : "null"}, ${r.usa_rateio}, '${r.data_admissao}'::date, '${CREATED_BY}');`,
  );
  linhasSql.push("");
}

linhasSql.push("end $$;");

console.log(linhasSql.join("\n"));

if (erros.length > 0) {
  console.error("\n-- ERROS --");
  for (const e of erros) console.error(`-- ${e}`);
  process.exitCode = 2;
}

console.error(`\n-- Total: ${registros.length} registros, ${erros.length} erros`);
