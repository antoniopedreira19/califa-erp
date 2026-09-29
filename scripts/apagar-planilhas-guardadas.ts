// Decisão 129 (29/09/2026): a planilha importada não fica guardada. Este
// script apaga do bucket `orcamento-importacoes` o que o código de antes
// guardou — tudo fora de `<tenant>/envios/`, que é a pasta de passagem das
// importações em curso e fica intocada. Roda depois do deploy do código
// novo, antes da migration 20260929700004 (que tira o caminho do histórico).
//
//   npx tsx scripts/apagar-planilhas-guardadas.ts            # só lista
//   npx tsx scripts/apagar-planilhas-guardadas.ts --apagar   # apaga
import { clienteDeServico, listarBucket } from "./rastros-codigo-anterior/comum";

const BUCKET = "orcamento-importacoes";
const APAGAR = process.argv.includes("--apagar");

async function main() {
  const s = clienteDeServico();
  const guardados = (await listarBucket(s, BUCKET)).filter((a) => !a.path.includes("/envios/"));
  console.log(guardados.map((a) => `${(a.atualizado ?? "").slice(0, 10)}  ${a.path}`).join("\n"));
  console.log(`\n${guardados.length} arquivo(s) guardado(s) fora de envios/`);
  if (!APAGAR || guardados.length === 0) return;

  const { error } = await s.storage.from(BUCKET).remove(guardados.map((a) => a.path));
  if (error) throw new Error(`apagar: ${error.message}`);
  const restantes = (await listarBucket(s, BUCKET)).filter((a) => !a.path.includes("/envios/"));
  console.log(JSON.stringify({ apagados: guardados.length, ainda_guardados: restantes.map((a) => a.path) }, null, 2));
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
