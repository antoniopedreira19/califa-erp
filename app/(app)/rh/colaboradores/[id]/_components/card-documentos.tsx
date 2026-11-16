import { FolderOpen, FileText, Fingerprint, Home, Contact } from "lucide-react";
import type { TipoContratacao } from "@/lib/types";

interface Props {
  tipoContratacao: TipoContratacao;
}

/** Placeholder — tabela colaboradores_documentos ainda não existe. A lista abaixo
 *  é só o inventário do que RH já pediu: contrato assinado, RG/CPF, comprovante
 *  de residência e, para PJ, contrato social. Assim que a tabela nascer (com
 *  upload via Storage no mesmo padrão dos contratos de freelancer), este
 *  componente vira a listagem real. */
const PJ_LIKE = ["pj", "mei", "clt_recibo"] as const;

export function CardDocumentos({ tipoContratacao }: Props) {
  const isPjLike = (PJ_LIKE as readonly string[]).includes(tipoContratacao);

  const documentos = [
    {
      icone: FileText,
      titulo: isPjLike ? "Contrato de prestação" : "Contrato CLT",
      descricao: isPjLike
        ? "Contrato PJ assinado digitalmente."
        : "Contrato de trabalho assinado.",
    },
    {
      icone: Fingerprint,
      titulo: isPjLike ? "CNPJ / Contrato social" : "RG e CPF",
      descricao: isPjLike
        ? "Cartão CNPJ e contrato social da PJ."
        : "Documentos de identificação.",
    },
    {
      icone: Home,
      titulo: "Comprovante de residência",
      descricao: "Emitido nos últimos 90 dias.",
    },
    {
      icone: Contact,
      titulo: "Contato de emergência",
      descricao: "Nome, grau de parentesco e telefone.",
    },
  ];

  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
          <FolderOpen className="h-3.5 w-3.5" />
        </div>
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
          Documentos
        </h3>
      </div>

      <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground mb-4">
        Upload de documentos ainda não está disponível. Abaixo ficam os
        documentos que serão organizados nesta seção.
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {documentos.map((d) => {
          const Icon = d.icone;
          return (
            <li
              key={d.titulo}
              className="flex items-start gap-3 rounded-lg border border-border bg-background px-3 py-3"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {d.titulo}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {d.descricao}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
