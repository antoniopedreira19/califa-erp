/**
 * O arquivo de planilha enviado direto para o Storage (decisão 110).
 *
 * O navegador sobe o arquivo para `<tenant>/envios/<uuid>-<nome>` no bucket
 * `orcamento-importacoes` (a policy de INSERT já libera a pasta do tenant
 * para `authenticated`), e as Server Actions recebem só o caminho. Daqui
 * saem as operações do servidor sobre esse arquivo: baixar para ler e
 * descartar.
 *
 * O arquivo é só de passagem (decisão 129, 29/09/2026): sai do Storage
 * quando a importação grava — o conteúdo fica na versão — e quando ela é
 * cancelada. O que escapa (aba fechada no meio, falha no descarte) sai
 * pela limpeza de envios antigos.
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

/** Apaga o arquivo enviado: depois que a importação grava, ou quando ela
 *  não grava. Melhor esforço — o que falhar aqui sai pela limpeza. */
export async function descartarEnvio(path: string, tenantId: string): Promise<void> {
  if (!envioDoTenant(path, tenantId)) return;
  const { error } = await createServiceClient()
    .storage.from(BUCKET_IMPORTACOES)
    .remove([path]);
  if (error) console.error("[importacao.envio.descartar]", error.message);
}

/** Um envio só fica esquecido se a aba fechou no meio da importação, ou se
 *  o descarte falhou. Um dia é folga para qualquer importação em curso —
 *  inclusive a do editor do projeto, que guarda o arquivo até o "Salvar". */
const VALIDADE_DO_ENVIO_MS = 24 * 60 * 60 * 1000;

/**
 * Apaga os envios do tenant com mais de um dia. Roda a cada envio novo
 * (`prepararEnvioPlanilha`), então a pasta nunca acumula. Melhor esforço:
 * falhar aqui não impede a importação que está começando.
 */
export async function limparEnviosAntigos(tenantId: string): Promise<void> {
  try {
    const pasta = `${tenantId}/envios`;
    const service = createServiceClient();
    const { data, error } = await service.storage
      .from(BUCKET_IMPORTACOES)
      .list(pasta, { limit: 1000 });
    if (error || !data) {
      if (error) console.error("[importacao.envio.limpar.listar]", error.message);
      return;
    }
    const limite = Date.now() - VALIDADE_DO_ENVIO_MS;
    const antigos = data
      .filter((f) => {
        const quando = Date.parse(f.created_at ?? f.updated_at ?? "");
        return Number.isFinite(quando) && quando < limite;
      })
      .map((f) => `${pasta}/${f.name}`);
    if (antigos.length === 0) return;
    const { error: e } = await service.storage.from(BUCKET_IMPORTACOES).remove(antigos);
    if (e) console.error("[importacao.envio.limpar.apagar]", e.message);
  } catch (err) {
    console.error("[importacao.envio.limpar]", err);
  }
}

