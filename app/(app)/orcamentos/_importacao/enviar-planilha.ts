import { createClient } from "@/lib/supabase/client";
import type { EnvioDaPlanilha } from "@/lib/importacao/envio";
import { recusaDoArquivo, TIPO_XLSX } from "@/lib/importacao/limites";
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

  const { error } = await createClient()
    .storage.from("orcamento-importacoes")
    .upload(reserva.path, file, { contentType: file.type || TIPO_XLSX, upsert: false });
  if (error) {
    console.error("[importacao.enviar]", error.message);
    return {
      ok: false,
      message: "Não foi possível enviar o arquivo. Confira a conexão e tente de novo.",
    };
  }
  return { ok: true, envio: { path: reserva.path, nome: file.name, tamanho: file.size } };
}
