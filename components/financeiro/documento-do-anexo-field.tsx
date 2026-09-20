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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
      {/* Era `<select>` nativo por medo de popover aninhado fechar o
          drawer. O medo era de antes de 31/08/2026, quando o Popover
          passou a empilhar o próprio lock de rolagem dentro de diálogo —
          e o `<select>` nativo cobrou o preço em 18/09/2026: dentro de
          drawer o menu do sistema operacional não aplica a escolha
          (decisão 090). Conferido no drawer, com o campo em uso. */}
      <Select
        value={valor.tipo ?? SEM_TIPO}
        disabled={disabled}
        onValueChange={(v) =>
          onChange({
            ...valor,
            tipo: v === SEM_TIPO ? null : (v as DocumentoTipo),
          })
        }
      >
        <SelectTrigger
          aria-label={`Tipo do documento de ${descricaoArquivo}`}
          className="h-8 w-[104px] flex-none px-2 text-xs"
        >
          <SelectValue placeholder="Tipo…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SEM_TIPO}>Tipo…</SelectItem>
          {DOCUMENTO_TIPOS.map((t) => (
            <SelectItem key={t} value={t}>
              {documentoTipoLabel(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

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
