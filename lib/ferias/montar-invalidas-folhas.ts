/**
 * Função pura de validação das folhas de férias antes do envio ao financeiro.
 *
 * Extraída de `actions-pagamentos.ts` pra ser testável sem Supabase e sem
 * o "use server" do Next.js.
 */

export type FolhaParaValidar = {
  id: string;
  tipo: string;
  status: string;
  origem: string;
  anexo_url: string | null;
  lancamento_ferias_id: string | null;
  tipo_folha_ferias: "usufruto" | "abono" | null;
};

/**
 * Retorna lista de mensagens de erro para folhas inválidas.
 *
 * @param folhas         - Folhas selecionadas para envio.
 * @param nfsAnexadas    - Set de chaves "<lancamento_ferias_id>|<escopo_tipo>"
 *                         representando NFs já anexadas pelo colaborador PJ.
 *
 * Regras aplicadas (em ordem, com `continue` após cada bloqueio):
 *   1. `tipo !== 'ferias'`        → não é folha de férias
 *   2. `status !== 'rascunho'`    → status X, só rascunho pode ser enviada
 *   3. `origem === 'contabilidade'` + `!anexo_url`  → CLT sem recibo contábil anexado
 *   4. `origem === 'california'`  + NF ausente      → PJ sem NF anexada pelo colaborador
 */
export function montarInvalidasFolhas(
  folhas: FolhaParaValidar[],
  nfsAnexadas: Set<string>,
): string[] {
  const invalidas: string[] = [];

  for (const f of folhas) {
    if (f.tipo !== "ferias") {
      invalidas.push(`${f.id}: não é folha de férias`);
      continue;
    }
    if (f.status !== "rascunho") {
      invalidas.push(`${f.id}: status ${f.status}, só rascunho pode ser enviada`);
      continue;
    }
    if (f.origem === "contabilidade" && !f.anexo_url) {
      invalidas.push(`${f.id}: CLT sem recibo contábil anexado`);
      continue;
    }
    if (f.origem === "california") {
      // Monta a chave correta conforme tipo_folha_ferias
      const escopoTipo =
        f.tipo_folha_ferias === "abono" ? "ferias_abono" : "ferias_usufruto";
      const chave = `${f.lancamento_ferias_id}|${escopoTipo}`;
      if (!nfsAnexadas.has(chave)) {
        invalidas.push(`${f.id}: PJ sem NF anexada pelo colaborador`);
        continue;
      }
    }
  }

  return invalidas;
}
