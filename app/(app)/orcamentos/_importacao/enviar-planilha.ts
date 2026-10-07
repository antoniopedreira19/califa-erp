import { createClient } from "@/lib/supabase/client";
import type { EnvioDaPlanilha } from "@/lib/importacao/envio";
import { recusaDoArquivo, TIPO_XLSM, TIPO_XLSX } from "@/lib/importacao/limites";
import { prepararEnvioPlanilha } from "./envio-actions";

/**
 * Sobe a planilha do navegador direto para o Storage (decisão 110) e
 * devolve o que as actions de importação recebem no lugar do arquivo.
 *
 * O arquivo não passa pelo corpo da Server Action: o Next corta em 1 MB e
 * a Vercel em 4,5 MB. O teto passa a ser o de `recusaDoArquivo`.
 */
export async function enviarPlanilha(
  file: File,
): Promise<{ ok: true; envio: EnvioDaPlanilha } | { ok: false; message: string }> {
  const recusa = recusaDoArquivo(file.name, file.size);
  if (recusa) return { ok: false, message: recusa };

  const reserva = await prepararEnvioPlanilha({ nome: file.name, tamanho: file.size });
  if (!reserva.ok) return reserva;

  // O tipo vai pela extensão, não pelo que o sistema operacional informa: o
  // bucket só aceita .xlsx e .xlsm (migration 20261007800002), e um .xlsx
  // sem tipo conhecido chegaria como "application/octet-stream". Com o
  // arquivo no corpo, o Storage lê o tipo do próprio arquivo, e não da
  // opção `contentType`.
  const tipo = file.name.toLowerCase().endsWith(".xlsm") ? TIPO_XLSM : TIPO_XLSX;
  const arquivo = new File([file], file.name, { type: tipo });

  const { error } = await createClient()
    .storage.from("orcamento-importacoes")
    .upload(reserva.path, arquivo, { contentType: tipo, upsert: false });
  if (error) {
    console.error("[importacao.enviar]", error.message);
    return {
      ok: false,
      message: "Não foi possível enviar o arquivo. Confira a conexão e tente de novo.",
    };
  }
  return { ok: true, envio: { path: reserva.path, nome: file.name, tamanho: file.size } };
}
