import {
  Ban,
  CheckCircle2,
  FilePenLine,
  FileText,
  FolderOpen,
  Tags,
  XCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * Mapa único de nomes de ícone → componente Lucide, compartilhado pelo
 * chat de Comunicação e pelo chat de PPs. Centralizar aqui evita ter
 * duas versões desse mapa sincronizadas na mão.
 *
 * Nomes ficam em kebab-case pra bater com a união do tipo ItemChat.
 */
export const ICONE_COMPONENTE: Record<string, LucideIcon> = {
  "folder-open": FolderOpen,
  "file-pen-line": FilePenLine,
  tags: Tags,
  "file-text": FileText,
  "check-circle": CheckCircle2,
  "x-circle": XCircle,
  ban: Ban,
};

export const ICONE_CORES = {
  azul: "bg-blue-50 text-blue-700",
  verde: "bg-emerald-50 text-emerald-700",
  bege: "bg-[#f1f0ec] text-foreground",
  vermelho: "bg-red-50 text-red-700",
} as const;

export const PILL_CORES = {
  positivo: "border-emerald-200 bg-emerald-50 text-emerald-700",
  negativo: "border-red-200 bg-red-50 text-red-700",
  neutro: "border-border bg-muted text-foreground",
} as const;
