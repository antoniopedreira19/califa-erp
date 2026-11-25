// One-shot: popula localizacao, email_pessoal, possui_filhos e genero_identidade
// em colaboradores a partir da planilha "NOVAS INFORMAÇÕES.xlsx" do RH.
//
// Não committado. Rode uma vez depois da migration
// 20261125900001_colaboradores_localizacao.sql estar aplicada:
//
//   npx tsx scripts/_backfill_colaboradores_novas_infos.ts "C:\\Users\\anton\\OneDrive\\Desktop\\Califa\\NOVAS INFORMAÇÕES.xlsx"
//
// Só preenche campo que está NULL (não sobrescreve wizard do colaborador).
// Match por LOWER(TRIM(nome)).

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as nodepath from "path";

// Mini carregador de .env.local (evita dep nova pro one-shot).
const envPath = nodepath.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const path = process.argv[2];
if (!path) {
  console.error("Uso: npx tsx scripts/_backfill_colaboradores_novas_infos.ts <caminho-da-planilha>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar em .env.local");

const supabase = createClient(url, key, { auth: { persistSession: false } });

type GeneroId = "mulher_cis" | "homem_cis";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const sh = wb.getWorksheet("Planilha2");
  if (!sh) throw new Error("Aba Planilha2 não encontrada");

  type Linha = {
    nome: string;
    localizacao: string | null;
    genero_identidade: GeneroId | null;
    email_pessoal: string | null;
    possui_filhos: boolean | null;
  };
  const linhas: Linha[] = [];
  sh.eachRow((row, i) => {
    if (i === 1) return; // header
    const nome = String(row.getCell(1).value ?? "").trim();
    if (!nome) return;
    const g = String(row.getCell(2).value ?? "").trim();
    const loc = String(row.getCell(3).value ?? "").trim().toUpperCase();
    const email = String(row.getCell(4).value ?? "").trim();
    const filhosRaw = String(row.getCell(5).value ?? "").trim().toLowerCase();
    const tem_filho: boolean | null = filhosRaw.startsWith("sim")
      ? true
      : filhosRaw.startsWith("n")
      ? false
      : null;
    const genero: GeneroId | null = g === "M" ? "homem_cis" : g === "F" ? "mulher_cis" : null;
    const localizacao = ["SP", "NE", "NO", "RJ", "SC", "BH", "SSB"].includes(loc) ? loc : null;
    linhas.push({
      nome,
      localizacao,
      genero_identidade: genero,
      email_pessoal: email || null,
      possui_filhos: tem_filho,
    });
  });

  console.log(`Linhas lidas da planilha: ${linhas.length}`);

  // Busca colaboradores da California por tenant.
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, nome")
    .eq("nome", "Agência California")
    .maybeSingle();
  if (!tenant) throw new Error("Tenant Agência California não encontrado");

  const { data: colabs } = await supabase
    .from("colaboradores")
    .select("id, nome, localizacao, email_pessoal, possui_filhos, genero_identidade")
    .eq("tenant_id", tenant.id);
  if (!colabs) throw new Error("Falha ao ler colaboradores");

  const porNome = new Map<string, typeof colabs[number][]>();
  for (const c of colabs) {
    const k = c.nome.trim().toLowerCase();
    const arr = porNome.get(k) ?? [];
    arr.push(c);
    porNome.set(k, arr);
  }

  let aplicados = 0;
  let semMatch = 0;
  let dups = 0;
  const naoEncontrados: string[] = [];

  for (const l of linhas) {
    const k = l.nome.trim().toLowerCase();
    const matches = porNome.get(k);
    if (!matches || matches.length === 0) {
      semMatch++;
      naoEncontrados.push(l.nome);
      continue;
    }
    if (matches.length > 1) dups++;
    for (const c of matches) {
      const patch: Record<string, string | boolean | null> = {};
      if (c.localizacao == null && l.localizacao != null) patch.localizacao = l.localizacao;
      if (c.email_pessoal == null && l.email_pessoal != null) patch.email_pessoal = l.email_pessoal;
      if (c.possui_filhos == null && l.possui_filhos != null) patch.possui_filhos = l.possui_filhos;
      if (c.genero_identidade == null && l.genero_identidade != null) patch.genero_identidade = l.genero_identidade;
      if (Object.keys(patch).length === 0) continue;
      const { error } = await supabase.from("colaboradores").update(patch).eq("id", c.id);
      if (error) {
        console.error("erro ao atualizar", c.id, error.message);
        continue;
      }
      aplicados++;
    }
  }

  console.log(`Atualizações aplicadas: ${aplicados}`);
  console.log(`Sem match: ${semMatch}`);
  console.log(`Nomes duplicados no banco (aplicado nos dois): ${dups}`);
  if (naoEncontrados.length) {
    console.log(`\nNomes da planilha sem correspondente no banco (${naoEncontrados.length}):`);
    for (const n of naoEncontrados) console.log(" -", n);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
