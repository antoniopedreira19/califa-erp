"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { DialogEditarLinha } from "./dialog-editar-linha";

export interface LinhaRow {
  id: string;
  nome: string;
  empresa: string | null;
  tipo_contratacao: string;
  data_admissao: string;
  salario: number;
  avos: number;
  primeira_parcela: number;
  segunda_parcela: number;
  desconto_inss: number;
  desconto_irrf: number;
  total_liquido: number;
  editado_manualmente: boolean;
  salario_editado: number | null;
  avos_editado: number | null;
  obs: string | null;
}

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function tipoLabel(tipo: string): string {
  switch (tipo) {
    case "clt":
      return "CLT";
    case "clt_recibo":
      return "CLT Recibo";
    case "pj":
      return "PJ";
    case "mei":
      return "MEI";
    case "estagio":
      return "Estágio";
    case "socio":
      return "Sócio";
    default:
      return tipo;
  }
}

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

interface Props {
  linhas: LinhaRow[];
  podeEditar: boolean;
}

export function TabelaLinhas({ linhas, podeEditar }: Props) {
  const [linhaAberta, setLinhaAberta] = React.useState<LinhaRow | null>(null);

  if (linhas.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Nenhuma linha nesta folha.
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Colaborador</th>
              <th className="px-4 py-3 text-left font-medium">Empresa</th>
              <th className="px-4 py-3 text-left font-medium">Tipo</th>
              <th className="px-4 py-3 text-left font-medium">Admissão</th>
              <th className="px-4 py-3 text-right font-medium">Salário</th>
              <th className="px-4 py-3 text-center font-medium">Avos</th>
              <th className="px-4 py-3 text-right font-medium">1ª parc</th>
              <th className="px-4 py-3 text-right font-medium">2ª parc</th>
              <th className="px-4 py-3 text-right font-medium">INSS</th>
              <th className="px-4 py-3 text-right font-medium">IRRF</th>
              <th className="px-4 py-3 text-right font-medium">Líquido</th>
              <th className="px-4 py-3 text-center font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr
                key={l.id}
                onClick={() => podeEditar && setLinhaAberta(l)}
                className={`border-t border-border transition-colors ${podeEditar ? "cursor-pointer hover:bg-muted/40" : ""}`}
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-foreground">{l.nome}</div>
                  {l.obs && (
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {l.obs}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {l.empresa ?? "—"}
                </td>
                <td className="px-4 py-3">{tipoLabel(l.tipo_contratacao)}</td>
                <td className="px-4 py-3 text-muted-foreground tabular-nums">
                  {formatarData(l.data_admissao)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {brl.format(l.salario_editado ?? l.salario)}
                </td>
                <td className="px-4 py-3 text-center tabular-nums">
                  {l.avos}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {brl.format(l.primeira_parcela)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {brl.format(l.segunda_parcela)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {brl.format(l.desconto_inss)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {brl.format(l.desconto_irrf)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-california-red">
                  {brl.format(l.total_liquido)}
                </td>
                <td className="px-4 py-3 text-center">
                  {l.editado_manualmente && (
                    <span
                      title="Editado manualmente"
                      className="inline-flex items-center justify-center rounded-full bg-amber-100 p-1 text-amber-700"
                    >
                      <Pencil className="h-3 w-3" />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {linhaAberta && (
        <DialogEditarLinha
          linha={linhaAberta}
          onClose={() => setLinhaAberta(null)}
        />
      )}
    </>
  );
}
