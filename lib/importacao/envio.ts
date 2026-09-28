/**
 * O arquivo de planilha enviado direto para o Storage (decisão 110).
 *
 * O navegador sobe o arquivo para `<tenant>/envios/<uuid>-<nome>` no bucket
 * `orcamento-importacoes` (a policy de INSERT já libera a pasta do tenant
 * para `authenticated`), e as Server Actions recebem só o caminho. Daqui
 * saem as três operações do servidor sobre esse arquivo: baixar para ler,
 * arquivar junto do orçamento quando a importação grava, e descartar
 * quando ela é cancelada.
 *
 * O caminho vem do cliente, então toda operação confere que ele é da pasta
 * de envios do tenant da sessão — é o que impede ler ou mover arquivo de
 * outro tenant com o service role.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { LIMITE_PLANILHA_BYTES, LIMITE_PLANILHA_ROTULO } from "./limites";

export const BUCKET_IMPORTACOES = "orcamento-importacoes";

/** O que a tela manda às actions depois de subir o arquivo. */
export interface EnvioDaPlanilha {
  path: string;
  nome: string;
  tamanho: number;
}

function slugDoNome(nome: string): string {
  return nome.replace(/[^\w.\-]/g, "_");
}

export function novoCaminhoDeEnvio(tenantId: string, nome: string): string {
  return `${tenantId}/envios/${crypto.randomUUID()}-${slugDoNome(nome)}`;
}

/** Caminho da pasta de envios do tenant, sem subpasta nem "..". */
export function envioDoTenant(path: string, tenantId: string): boolean {
  const partes = path.split("/");
  return (
    partes.length === 3 &&
    partes[0] === tenantId &&
    partes[1] === "envios" &&
    partes[2] !== "" &&
    !path.includes("..")
  );
}

export async function baixarEnvio(
  envio: EnvioDaPlanilha,
  tenantId: string,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; message: string }> {
  if (!envioDoTenant(envio.path, tenantId)) {
    return { ok: false, message: "Arquivo enviado inválido. Envie de novo." };
  }
  const { data, error } = await createServiceClient()
    .storage.from(BUCKET_IMPORTACOES)
    .download(envio.path);
  if (error || !data) {
    console.error("[importacao.envio.baixar]", error?.message);
    return {
      ok: false,
      message: "O arquivo enviado não foi encontrado. Feche e envie de novo.",
    };
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  if (buffer.length > LIMITE_PLANILHA_BYTES) {
    return {
      ok: false,
      message: `O arquivo passa do limite de ${LIMITE_PLANILHA_ROTULO}. Apague as abas que não serão usadas e envie de novo.`,
    };
  }
  return { ok: true, buffer };
}

/**
 * Leva o arquivo da pasta de envios para a do orçamento, no caminho que a
 * importação sempre usou (`<tenant>/<orcamento>/<importacao>-<nome>`).
 * Devolve o caminho onde ele ficou — o de envio, se mover falhar: a versão
 * já está gravada e o original não pode se perder por causa disso.
 */
export async function arquivarEnvio(
  envio: EnvioDaPlanilha,
  tenantId: string,
  orcamentoId: string,
  importacaoId: string,
): Promise<string> {
  if (!envioDoTenant(envio.path, tenantId)) return "";
  const destino = `${tenantId}/${orcamentoId}/${importacaoId}-${slugDoNome(envio.nome)}`;
  const { error } = await createServiceClient()
    .storage.from(BUCKET_IMPORTACOES)
    .move(envio.path, destino);
  if (error) {
    console.error("[importacao.envio.arquivar]", error.message);
    return envio.path;
  }
  return destino;
}

/** Apaga o arquivo de uma importação que não gravou. Melhor esforço. */
export async function descartarEnvio(path: string, tenantId: string): Promise<void> {
  if (!envioDoTenant(path, tenantId)) return;
  const { error } = await createServiceClient()
    .storage.from(BUCKET_IMPORTACOES)
    .remove([path]);
  if (error) console.error("[importacao.envio.descartar]", error.message);
}

