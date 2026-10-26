/**
 * Aprova o de-para do histórico financeiro (decisão 211): leva as propostas
 * de uma versão da planilha para a pasta do de-para aprovado.
 *
 * O que a pasta já tem fica como está (pode ter sido editado à mão). O que é
 * novo entra pela regra que o Tiago aprovou em 25/10/2026: vale a proposta
 * igual, parecida, pela sigla, pela marca ou geral; o ambíguo e o sem par
 * ficam como texto (valor vazio).
 *
 * Uso:
 *   npx tsx scripts/historico-financeiro/aprovar-depara.ts <pasta-da-versao> <pasta-do-de-para>
 *
 * Depois, rode a padronização com a pasta do de-para como terceiro argumento.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { BOM, linhaCsv } from "../../lib/historico-financeiro/csv";
import { ARQUIVOS_DO_DE_PARA, lerTabelaCsv, valorAprovado, type DePara } from "../../lib/historico-financeiro/depara";

/** Como cada arquivo de proposta vira uma linha do de-para. */
const DA_PROPOSTA: Record<keyof DePara, (p: Record<string, string>) => Record<string, string>> = {
  plano: (p) => ({ grupo: p.grupo, cod: p.cod, subtipo_sistema: valorAprovado(p.subtipo_proposto, p.como) }),
  clientes: (p) => ({ cliente_na_planilha: p.cliente_na_planilha, cliente_sistema: valorAprovado(p.sigla_proposta, p.como) }),
  marcas: (p) => ({
    cliente_na_planilha: p.cliente_na_planilha,
    marca_na_planilha: p.marca_na_planilha,
    cliente_sistema: p.cliente_proposto,
    marca_sistema: valorAprovado(p.marca_proposta, p.como),
  }),
  servicos: (p) => ({ servico_na_planilha: p.servico_na_planilha, servico_sistema: valorAprovado(p.servico_proposto, p.como) }),
  regionais: (p) => ({ empresa: p.empresa, regional_na_planilha: p.regional_na_planilha, regional_sistema: valorAprovado(p.regional_proposta, p.como) }),
};

async function main() {
  const [versaoArg, deparaArg] = process.argv.slice(2);
  if (!versaoArg || !deparaArg) {
    console.error("Uso: npx tsx scripts/historico-financeiro/aprovar-depara.ts <pasta-da-versao> <pasta-do-de-para>");
    process.exit(1);
  }
  const versao = resolve(versaoArg);
  const pasta = resolve(deparaArg);
  await mkdir(pasta, { recursive: true });
  const hoje = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const origem = `proposta aceita em ${hoje} (versão ${basename(versao)})`;
  const resumo: Record<string, { mantidas: number; novas: number; novas_como_texto: number }> = {};

  for (const [nome, def] of Object.entries(ARQUIVOS_DO_DE_PARA) as [keyof DePara, (typeof ARQUIVOS_DO_DE_PARA)[keyof DePara]][]) {
    const propostas = await lerTabelaCsv(join(versao, "padronizado", "propostas", def.arquivo));
    if (!propostas) throw new Error(`Falta ${def.arquivo} nas propostas: rode a padronização antes.`);
    const existentes = (await lerTabelaCsv(join(pasta, def.arquivo))) ?? [];
    const jaTem = new Set(existentes.map(def.chave));
    const novas: Record<string, string>[] = propostas
      .map((p): Record<string, string> => ({ ...DA_PROPOSTA[nome](p), como: p.como, origem }))
      .filter((l) => !jaTem.has(def.chave(l)) && (jaTem.add(def.chave(l)), true));
    const linhas: Record<string, string>[] = [...existentes, ...novas];
    const colunas = [...new Set([...def.chaves, ...Object.keys(DA_PROPOSTA[nome](propostas[0] ?? {})), def.valor, "como", "origem"])];
    await writeFile(join(pasta, def.arquivo), BOM + [colunas, ...linhas.map((l) => colunas.map((c) => l[c] ?? ""))].map(linhaCsv).join(""));
    resumo[nome] = { mantidas: existentes.length, novas: novas.length, novas_como_texto: novas.filter((l) => !l[def.valor]).length };
  }

  const leiaMe = join(pasta, "LEIA-ME.md");
  const texto = await readFile(leiaMe, "utf8").catch(() => "");
  if (!texto)
    await writeFile(
      leiaMe,
      [
        "# De-para aprovado do histórico financeiro (decisão 211)",
        "",
        "Um CSV por assunto: o texto da planilha e o valor do sistema. Vazio = fica como texto no histórico.",
        "Para mudar uma decisão, edite o valor e troque a coluna origem por quem decidiu e quando.",
        "A aprovação só acrescenta textos novos: o que já está aqui não é sobrescrito.",
        "",
      ].join("\n"),
    );
  console.log(JSON.stringify({ pasta, origem, resumo }, null, 2));
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.stack : erro);
  process.exit(1);
});
