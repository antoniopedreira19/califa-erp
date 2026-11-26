export type FolhaMin = {
  id: string;
  origem: "california" | "contabilidade";
  tipo_folha_ferias: "usufruto" | "abono" | null;
  status: string;
  anexo_url: string | null;
};

export type NfMin = {
  escopo_tipo: "ferias_usufruto" | "ferias_abono";
  escopo_id: string;
};

export type ResultadoEnviavel =
  | { ok: true }
  | { ok: false; falta: string[] };

function rotuloDoc(
  origem: FolhaMin["origem"],
  tipo: FolhaMin["tipo_folha_ferias"],
): string {
  if (origem === "california") {
    return tipo === "abono" ? "NF de abono" : "NF de férias";
  }
  return tipo === "abono"
    ? "Recibo de abono California"
    : "Recibo da contabilidade";
}

export function lancamentoEnviavel(
  lancamentoId: string,
  folhas: FolhaMin[],
  nfs: NfMin[],
): ResultadoEnviavel {
  if (folhas.length === 0) {
    return { ok: false, falta: ["Nenhuma folha gerada"] };
  }

  const falta: string[] = [];
  for (const f of folhas) {
    if (f.status !== "rascunho") continue;

    if (f.origem === "california") {
      const escopo =
        f.tipo_folha_ferias === "abono"
          ? "ferias_abono"
          : "ferias_usufruto";
      const temNf = nfs.some(
        (n) => n.escopo_tipo === escopo && n.escopo_id === lancamentoId,
      );
      if (!temNf) {
        falta.push(rotuloDoc(f.origem, f.tipo_folha_ferias));
      }
    } else {
      if (!f.anexo_url) {
        falta.push(rotuloDoc(f.origem, f.tipo_folha_ferias));
      }
    }
  }

  if (falta.length === 0) return { ok: true };
  return { ok: false, falta };
}
