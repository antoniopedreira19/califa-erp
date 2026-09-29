// Passo 6 — apaga os anexos soltos de PPs que não existem mais (decisão
// 126), com o OK do Tiago de 29/09/2026. Eram 20 no bucket `pedidos-compra`,
// sobras das PPs de teste apagadas até 21/09; um deles, uma NF de teste,
// citava o código antigo "0-0001/26".
//
//   npx tsx scripts/rastros-codigo-anterior/6-apagar-anexos-orfaos.ts            # só lista
//   npx tsx scripts/rastros-codigo-anterior/6-apagar-anexos-orfaos.ts --apagar   # apaga
//
// Um anexo só sai se as três coisas valem, lidas de novo logo antes:
//   - nenhuma tabela de anexos aponta para ele;
//   - a PP da pasta dele não existe;
//   - ele é de antes de 22/09/2026. A geração de PP sobe o anexo ANTES de
//     gravar a PP (o id é reservado); um anexo de PP sendo criada agora
//     pareceria solto pelas duas primeiras regras.
import { BUCKET_PPS, clienteDeServico, listarBucket } from "./comum";

const APAGAR = process.argv.includes("--apagar");
const CORTE = "2026-09-22T00:00:00Z";
const ESPERADOS = 20;

async function caminhosReferenciados(s: ReturnType<typeof clienteDeServico>): Promise<Set<string>> {
  const fontes: Array<[string, string]> = [
    ["pedidos_compra_anexos", "arquivo_path"],
    ["pp_verba_prestacoes_anexos", "arquivo_path"],
    ["contas_avulsas_anexos", "arquivo_path"],
    ["desembolsos_anexos", "arquivo_path"],
    ["jobs_envio_faturamento_anexos", "path"],
  ];
  const usados = new Set<string>();
  for (const [tabela, coluna] of fontes) {
    const { data, error } = await s.from(tabela).select(coluna).limit(100000);
    if (error) throw new Error(`ler ${tabela}: ${error.message}`);
    for (const r of (data ?? []) as unknown as Array<Record<string, string | null>>) {
      if (r[coluna]) usados.add(r[coluna] as string);
    }
  }
  return usados;
}

async function orfaos(s: ReturnType<typeof clienteDeServico>) {
  const [anexos, usados, pps] = await Promise.all([
    listarBucket(s, BUCKET_PPS).then((l) => l.filter((a) => a.path.includes("/anexos/"))),
    caminhosReferenciados(s),
    s.from("pedidos_compra").select("id").limit(100000),
  ]);
  if (pps.error) throw new Error(`ler PPs: ${pps.error.message}`);
  const ppsVivas = new Set(((pps.data ?? []) as Array<{ id: string }>).map((p) => p.id));
  return anexos.filter((a) => {
    const ppId = a.path.split("/")[2];
    // Sem data, fica: não dá para saber se é de uma PP sendo criada.
    return !usados.has(a.path) && !ppsVivas.has(ppId) && a.atualizado !== null && a.atualizado < CORTE;
  });
}

async function main() {
  const s = clienteDeServico();
  const lista = await orfaos(s);
  console.log(lista.map((a) => `${(a.atualizado ?? "").slice(0, 10)}  ${a.path.split("/").slice(-1)[0]}`).join("\n"));
  console.log(`\n${lista.length} anexos soltos (esperados ${ESPERADOS})`);
  if (!APAGAR) return;

  if (lista.length !== ESPERADOS) throw new Error("a lista não é a esperada — nada apagado");
  // De novo, logo antes: o que voltou a ser usado fica.
  const agora = new Set((await orfaos(s)).map((a) => a.path));
  const paths = lista.map((a) => a.path).filter((p) => agora.has(p));
  if (paths.length !== ESPERADOS) throw new Error("um anexo mudou entre a conferência e a remoção — nada apagado");

  const { data, error } = await s.storage.from(BUCKET_PPS).remove(paths);
  if (error) throw new Error(`apagar: ${error.message}`);
  const restantes = new Set((await listarBucket(s, BUCKET_PPS)).map((a) => a.path));
  console.log(
    JSON.stringify(
      {
        apagados: (data ?? []).length,
        ainda_no_storage: paths.filter((p) => restantes.has(p)),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error("FALHOU:", e.message);
  process.exit(1);
});
