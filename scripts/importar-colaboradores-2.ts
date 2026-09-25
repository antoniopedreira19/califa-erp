/**
 * Importa a segunda leva de colaboradores da Kika (2026-09-25).
 *
 * Uso:
 *   npx tsx scripts/importar-colaboradores-2.ts
 *
 * Gera SQL em stdout com todos os INSERTs (colaborador + salario + alocação),
 * pronto pra colar num apply_migration ou execute_sql.
 *
 * Diferenças do primeiro import:
 *   - CSV com 12 colunas novas (inclui Nivel e RG, RG é ignorado por ora).
 *   - Preenche nivel_id via lookup por codigo (N3/N4/N5).
 *   - Pula CPF já existente no banco (WHERE NOT EXISTS na inserção).
 *   - Dessa vez todos os colaboradores têm CPF preenchido no CSV — se
 *     algum vier vazio ou inválido, o script erra (não silencia).
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
  "COLABORADORES-SEGUNDOINPUT.csv",
);

const EMPRESAS: Record<string, string> = {
  California: "304039bd-509d-4536-aa26-44e7091ee718",
  CCH: "1703fd52-a36c-4701-816c-a0bcc868351d",
  Hitlab: "a61067d9-b46b-40b0-8541-4850f13aa47c",
  Ventura: "3b0edb30-9cb0-4604-b563-33b42be51bc2",
};

const REGIONAIS: Record<string, Record<string, string>> = {
  California: {
    NE: "54c627a6-e2d4-480b-9bd4-2f1acbf0ea91",
    NO: "57e9291e-9544-4bdf-a22f-a7b10cbfbcdd",
    RJ: "9648d4bb-e4c2-4283-b8fb-206974005399",
    SP: "29b8e2d0-3fe9-4380-86b0-ede8299c2c32",
    SS: "7767a4aa-6ca1-4bb7-8f45-f993db384bef",
    AMBEV: "b3e7e6c8-5c2e-4a3c-83a9-2ab93abb1ab6",
    Ambev: "b3e7e6c8-5c2e-4a3c-83a9-2ab93abb1ab6",
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

const NIVEIS: Record<string, string> = {
  N3: "e2b331e1-6290-4a40-8fa6-3f8445d1599f",
  N4: "7f2fdfe1-05cd-4c76-8bc6-7cee5c7400c7",
  N5: "4c4e932a-a2a3-4b1d-9f85-2dcb98f8cedb",
};

type Linha = {
  nome: string;
  cpf: string;
  empresa: string;
  regional: string;
  tipo: string;
  data_admissao: string;
  funcao: string;
  nivel_id: string | null;
  area: string;
  salario: string;
  data_nascimento: string | null;
  regional_id: string;
  empresa_id: string;
};

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
  const limpo = s.replace(/R\$/g, "").replace(/\./g, "").replace(/,/g, ".").trim();
  const n = Number(limpo);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Salário inválido: ${s}`);
  return n.toFixed(2);
}

const TIPO_MAP: Record<string, string> = {
  PJ: "pj",
  CLT: "clt",
  Estágio: "estagio",
  Estagio: "estagio",
  Híbrido: "clt_recibo",
  Hibrido: "clt_recibo",
  Sócio: "socio",
  Socio: "socio",
};

function normalizarTipo(s: string): string {
  const map = TIPO_MAP[s.trim()];
  if (!map) throw new Error(`Tipo desconhecido: ${s}`);
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
const linhasCru = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
const header = linhasCru.shift();
if (!header) throw new Error("CSV vazio");

const registros: Linha[] = [];
const erros: string[] = [];

for (let i = 0; i < linhasCru.length; i++) {
  const idxLinha = i + 2;
  const cols = linhasCru[i].split(";");
  if (cols.length < 12) {
    erros.push(`linha ${idxLinha}: só ${cols.length} colunas, esperado 12`);
    continue;
  }
  const [
    _nome,
    _empresa,
    _regional,
    _tipo,
    _admissao,
    _funcao,
    _nivel,
    _area,
    _salario,
    _nascimento,
    _cpf,
    _rg, // ignorado
  ] = cols;

  const nome = _nome.trim();
  const empresa = _empresa.trim();
  const regional = _regional.trim();

  if (!EMPRESAS[empresa]) {
    erros.push(`linha ${idxLinha} (${nome}): empresa desconhecida "${empresa}"`);
    continue;
  }

  const mapReg = REGIONAIS[empresa];
  if (!mapReg || !mapReg[regional]) {
    erros.push(
      `linha ${idxLinha} (${nome}): regional "${regional}" não existe em ${empresa}`,
    );
    continue;
  }
  const regional_id = mapReg[regional];

  let tipo: string;
  try {
    tipo = normalizarTipo(_tipo);
  } catch (e: any) {
    erros.push(`linha ${idxLinha} (${nome}): ${e.message}`);
    continue;
  }

  const data_admissao = normalizarData(_admissao);
  if (!data_admissao) {
    erros.push(`linha ${idxLinha} (${nome}): data admissão inválida "${_admissao}"`);
    continue;
  }

  const data_nascimento = normalizarData(_nascimento);

  let salario: string;
  try {
    salario = normalizarSalario(_salario);
  } catch (e: any) {
    erros.push(`linha ${idxLinha} (${nome}): ${e.message}`);
    continue;
  }

  const cpf = normalizarCPF(_cpf);
  if (!cpf) {
    erros.push(`linha ${idxLinha} (${nome}): CPF inválido "${_cpf}"`);
    continue;
  }

  const nivelCodigo = _nivel.trim();
  let nivel_id: string | null = null;
  if (nivelCodigo.length > 0) {
    if (!NIVEIS[nivelCodigo]) {
      erros.push(`linha ${idxLinha} (${nome}): nível "${nivelCodigo}" não existe`);
      continue;
    }
    nivel_id = NIVEIS[nivelCodigo];
  }

  registros.push({
    nome,
    cpf,
    empresa,
    regional,
    tipo,
    data_admissao,
    funcao: _funcao.trim(),
    nivel_id,
    area: _area.trim(),
    salario,
    data_nascimento,
    regional_id,
    empresa_id: EMPRESAS[empresa],
  });
}

// --- Gera SQL ---
// Skip CPF duplicado usando bloco condicional dentro do do $$ ... $$.

const linhasSql: string[] = [];
linhasSql.push("-- Import segundo lote de colaboradores (2026-09-25)");
linhasSql.push("-- Gerado por scripts/importar-colaboradores-2.ts");
linhasSql.push(`-- ${registros.length} registros no CSV`);
linhasSql.push("");
linhasSql.push("do $$");
linhasSql.push("declare");
linhasSql.push("  v_colab_id uuid;");
linhasSql.push("  v_ja_existe boolean;");
linhasSql.push("begin");

for (const r of registros) {
  linhasSql.push(`-- ${r.nome} (CPF ${r.cpf})`);
  linhasSql.push(
    `select exists (select 1 from public.colaboradores where tenant_id='${TENANT_ID}' and cpf_cnpj='${r.cpf}') into v_ja_existe;`,
  );
  linhasSql.push(`if v_ja_existe then`);
  linhasSql.push(`  raise notice 'skip: % (CPF % já existe)', ${sqlLiteral(r.nome)}, '${r.cpf}';`);
  linhasSql.push(`else`);
  linhasSql.push(
    `  insert into public.colaboradores (tenant_id, nome, tipo_contratacao, cpf_cnpj, funcao, nivel_id, data_admissao, data_nascimento, area, status, created_by) values ('${TENANT_ID}', ${sqlLiteral(r.nome)}, '${r.tipo}'::public.tipo_contratacao, '${r.cpf}', ${sqlLiteral(r.funcao)}, ${r.nivel_id ? `'${r.nivel_id}'` : "null"}, '${r.data_admissao}'::date, ${r.data_nascimento ? `'${r.data_nascimento}'::date` : "null"}, ${sqlLiteral(r.area)}, 'ativo'::public.cadastro_status, '${CREATED_BY}') returning id into v_colab_id;`,
  );
  linhasSql.push(
    `  insert into public.colaboradores_salarios (tenant_id, colaborador_id, valor, data_inicio, created_by) values ('${TENANT_ID}', v_colab_id, ${r.salario}, '${r.data_admissao}'::date, '${CREATED_BY}');`,
  );
  linhasSql.push(
    `  insert into public.colaboradores_alocacoes (tenant_id, colaborador_id, empresa_id, regional_id, usa_rateio_empresa, data_inicio, created_by) values ('${TENANT_ID}', v_colab_id, '${r.empresa_id}', '${r.regional_id}', false, '${r.data_admissao}'::date, '${CREATED_BY}');`,
  );
  linhasSql.push(`end if;`);
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
