"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  colaboradorDocumentoTipoLabel,
  type ColaboradorDocumento,
  type ColaboradorDocumentoTipo,
  type TipoContratacao,
} from "@/lib/types";
import { documentosObrigatorios } from "@/lib/perfil/documentos-obrigatorios";
import { urlAssinadaDoDocumento } from "@/lib/perfil/upload-documento-cliente";
import { removerDocumentoDoColaboradorRh } from "./actions-documentos";

interface Props {
  tipoContratacao: TipoContratacao;
  documentos: ColaboradorDocumento[];
}

const TIPOS_EXTRA: ColaboradorDocumentoTipo[] = ["foto", "outro"];

/**
 * Lista dos documentos anexados pelo colaborador (ou pelo RH), agrupados
 * por tipo. Mostra pendência quando algum tipo obrigatório não foi
 * enviado conforme o `tipo_contratacao` (régua em
 * `lib/perfil/documentos-obrigatorios`). RH pode abrir (URL assinada
 * válida por 60s) e remover.
 */
export function CardDocumentos({ tipoContratacao, documentos }: Props) {
  const router = useRouter();
  const [removendo, setRemovendo] = React.useState<string | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);

  const obrigs = documentosObrigatorios(tipoContratacao);

  // Monta a lista de blocos: obrigatórios primeiro (preenchidos ou não),
  // depois os extras (foto, outro) que tenham pelo menos 1 arquivo.
  const tiposNaOrdem: ColaboradorDocumentoTipo[] = [
    ...obrigs,
    ...TIPOS_EXTRA.filter((t) =>
      documentos.some((d) => d.tipo === t),
    ),
  ];

  async function abrir(path: string) {
    setErro(null);
    const url = await urlAssinadaDoDocumento(path);
    if (!url) {
      setErro("Não consegui gerar o link. Tenta de novo.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function remover(id: string) {
    if (!confirm("Remover este documento?")) return;
    setErro(null);
    setRemovendo(id);
    const r = await removerDocumentoDoColaboradorRh(id);
    setRemovendo(null);
    if (!r.ok) {
      setErro(r.message);
      return;
    }
    router.refresh();
  }

  const totaisAnexados = documentos.length;
  const faltando = obrigs.filter(
    (t) => !documentos.some((d) => d.tipo === t),
  );

  return (
    <div className="rounded-2xl border border-border bg-white p-5 shadow-soft">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-california-red/10 text-california-red">
            <FolderOpen className="h-3.5 w-3.5" />
          </div>
          <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-foreground">
            Documentos
          </h3>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {totaisAnexados} anexo{totaisAnexados === 1 ? "" : "s"}
          {faltando.length > 0 && (
            <span className="text-amber-700 font-medium">
              {" · "}
              {faltando.length} pendente{faltando.length === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </div>

      {erro && (
        <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{erro}</span>
        </div>
      )}

      {tiposNaOrdem.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">
          Nenhum documento anexado ainda.
        </p>
      ) : (
        <ul className="space-y-3">
          {tiposNaOrdem.map((tipo) => {
            const arquivos = documentos.filter((d) => d.tipo === tipo);
            const obrigatorio = obrigs.includes(tipo);
            const vazio = arquivos.length === 0;

            return (
              <li
                key={tipo}
                className="rounded-lg border border-border bg-background p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {colaboradorDocumentoTipoLabel(tipo)}
                    </p>
                    {obrigatorio &&
                      (vazio ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                          <AlertCircle className="h-3 w-3" />
                          Falta anexar
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-900">
                          <CheckCircle2 className="h-3 w-3" />
                          OK
                        </span>
                      ))}
                  </div>
                </div>

                {vazio ? (
                  <p className="text-[11px] text-muted-foreground">
                    Obrigatório pro tipo {tipoContratacao.toUpperCase()} —
                    aguardando colaborador anexar.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {arquivos.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center gap-2 text-xs bg-muted/30 rounded px-2 py-1.5"
                      >
                        <span
                          className="flex-1 truncate text-foreground"
                          title={a.arquivo_nome}
                        >
                          {a.arquivo_nome}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {new Date(a.uploaded_at).toLocaleDateString("pt-BR")}
                        </span>
                        <button
                          type="button"
                          onClick={() => abrir(a.arquivo_path)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label="Abrir"
                          title="Abrir"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => remover(a.id)}
                          disabled={removendo === a.id}
                          className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                          aria-label="Remover"
                          title="Remover"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
