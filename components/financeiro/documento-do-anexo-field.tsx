"use client";

/**
 * Que documento é este arquivo, e com que número.
 *
 * Os dois campos moram na LINHA DO ANEXO — uma PP pode ter NF, boleto e
 * contrato juntos, e no título só caberia um deles. É daqui que sai a
 * coluna Documento da Conciliação (28/08/2026).
 *
 * As quatro superfícies de anexo do financeiro usam este mesmo par: PP,
 * conta avulsa, desembolso e prestação de contas de verba. Sem um
 * componente só, o rótulo e a lista de tipos divergiriam entre elas —
 * foi o que aconteceu com as cores das planilhas.
 *
 * Compacto de propósito: ele aparece embaixo de cada arquivo já enviado,
 * numa lista que pode ter oito linhas. Um campo alto ali empurraria o
 * botão de gravar para fora da tela.
 */

import * as React from "react";
import {
  DOCUMENTO_TIPOS,
  documentoTipoLabel,
  type DocumentoDoAnexo,
  type DocumentoTipo,
} from "@/lib/types";

interface Props {
  valor: DocumentoDoAnexo;
  onChange: (valor: DocumentoDoAnexo) => void;
  /** Identifica os campos para o rótulo acessível — o nome do arquivo. */
  descricaoArquivo: string;
  disabled?: boolean;
}

const SEM_TIPO = "__sem_tipo__";

export function DocumentoDoAnexoField({
  valor,
  onChange,
  descricaoArquivo,
  disabled = false,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      {/* `select` nativo, e não o do Radix: esta linha vive DENTRO de um
          drawer que já é um portal, e um popover aninhado ali fecha o
          drawer inteiro no primeiro clique fora. */}
      <select
        value={valor.tipo ?? SEM_TIPO}
        disabled={disabled}
        aria-label={`Tipo do documento de ${descricaoArquivo}`}
        onChange={(e) =>
          onChange({
            ...valor,
            tipo:
              e.target.value === SEM_TIPO
                ? null
                : (e.target.value as DocumentoTipo),
          })
        }
        className="h-8 rounded-lg border border-border bg-white px-2 text-xs text-foreground outline-none focus:border-california-red disabled:opacity-50"
      >
        <option value={SEM_TIPO}>Tipo…</option>
        {DOCUMENTO_TIPOS.map((t) => (
          <option key={t} value={t}>
            {documentoTipoLabel(t)}
          </option>
        ))}
      </select>

      <input
        value={valor.numero ?? ""}
        disabled={disabled || valor.tipo === null}
        aria-label={`Número do documento de ${descricaoArquivo}`}
        placeholder={valor.tipo === null ? "Escolha o tipo" : "Número"}
        maxLength={60}
        onChange={(e) => onChange({ ...valor, numero: e.target.value })}
        className="h-8 w-32 rounded-lg border border-border bg-white px-2 font-mono text-xs text-foreground outline-none focus:border-california-red disabled:bg-muted/40 disabled:opacity-60"
      />
    </div>
  );
}
