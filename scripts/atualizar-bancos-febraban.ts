/**
 * Regenera lib/dados/bancos-febraban.ts a partir da BrasilAPI.
 *
 * Uso: npm run atualizar:bancos
 *
 * Motivação: a lista fica hardcoded (fica próxima do código, zero
 * dependência em runtime), mas atualizar não pode ser trabalho manual.
 * Este script busca a lista canônica na BrasilAPI, filtra bancos com
 * código numérico + nome, formata código com 3 dígitos e sobrescreve
 * o arquivo `.ts` com um snapshot datado.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface BrasilApiBank {
  ispb: string;
  name: string | null;
  code: number | null;
  fullName: string | null;
}

async function main() {
  const res = await fetch("https://brasilapi.com.br/api/banks/v1");
  if (!res.ok) {
    throw new Error(`BrasilAPI retornou ${res.status}: ${res.statusText}`);
  }
  const bancos = (await res.json()) as BrasilApiBank[];

  const filtrados = bancos
    .filter((b): b is BrasilApiBank & { code: number; name: string } =>
      typeof b.code === "number" && b.code > 0 && !!b.name,
    )
    .map((b) => ({
      codigo: String(b.code).padStart(3, "0"),
      nome: (b.fullName ?? b.name).trim(),
    }))
    .sort((a, b) => a.codigo.localeCompare(b.codigo));

  const dataStr = new Date().toISOString().slice(0, 10);

  const conteudo = `// Snapshot FEBRABAN em ${dataStr} — regenerar via \`npm run atualizar:bancos\`.
// Fonte: https://brasilapi.com.br/api/banks/v1
// NÃO editar manualmente — mudanças serão sobrescritas.

export interface BancoFebraban {
  readonly codigo: string;
  readonly nome: string;
}

export const BANCOS_FEBRABAN: readonly BancoFebraban[] = [
${filtrados.map((b) => `  { codigo: ${JSON.stringify(b.codigo)}, nome: ${JSON.stringify(b.nome)} },`).join("\n")}
];

export function getBancoByCodigo(codigo: string): BancoFebraban | null {
  return BANCOS_FEBRABAN.find((b) => b.codigo === codigo) ?? null;
}
`;

  const destino = resolve(process.cwd(), "lib/dados/bancos-febraban.ts");
  writeFileSync(destino, conteudo, "utf8");
  console.log(`OK — ${filtrados.length} bancos gravados em ${destino}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
