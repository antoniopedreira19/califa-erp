import { History, User } from "lucide-react";
import type { FreelancerContratoHistorico } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";

interface HistoricoLinha extends FreelancerContratoHistorico {
  alterado_por_nome: string | null;
  contrato_nome_job: string | null;
}

interface Props {
  historico: HistoricoLinha[];
}

const CAMPO_LABEL: Record<string, string> = {
  nome_job: "Nome do job",
  cargo: "Cargo",
  tipo: "Tipo",
  valor: "Valor",
  data_inicio: "Data de início",
  data_termino: "Data de término",
  cidade: "Cidade",
  status_real: "Pessoa ativa",
  responsavel_id: "Responsável",
  job_id: "Job vinculado",
  arquivo_url: "PDF assinado",
  minuta_url: "Minuta DOCX",
  distrato_data_proposta: "Distrato — data proposta",
  distrato_arquivo_url: "Distrato — PDF assinado",
};

function formatarValor(campo: string, valor: string | null): string {
  if (valor === null || valor === "") return "—";
  if (campo === "valor") {
    const n = Number(valor);
    if (!isNaN(n)) return formatCurrency(n);
  }
  if (campo === "status_real") {
    return valor === "true" ? "Trabalhando" : "Inativo";
  }
  if (campo === "arquivo_url" || campo === "minuta_url" || campo === "distrato_arquivo_url") {
    return "Arquivo";
  }
  if (campo === "data_inicio" || campo === "data_termino" || campo === "distrato_data_proposta") {
    const [y, m, d] = valor.split("-");
    if (y && m && d) return `${d}/${m}/${y}`;
  }
  return valor;
}

export function HistoricoContratoTimeline({ historico }: Props) {
  if (historico.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-muted/30 p-10 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
          <History className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">
          Sem alterações registradas
        </p>
        <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
          Qualquer mudança nos dados dos contratos deste freelancer aparece
          aqui com quem alterou e quando.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-white shadow-soft overflow-hidden">
      <ul className="divide-y divide-border">
        {historico.map((h) => (
          <li key={h.id} className="px-5 py-3 flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-california-red/10 text-california-red">
              <User className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-foreground">
                <strong>{h.alterado_por_nome ?? "Alguém"}</strong> alterou{" "}
                <strong>{CAMPO_LABEL[h.campo] ?? h.campo}</strong>
                {h.contrato_nome_job && (
                  <> no contrato <strong>{h.contrato_nome_job}</strong></>
                )}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                <span className="line-through">
                  {formatarValor(h.campo, h.valor_anterior)}
                </span>{" "}
                → <strong>{formatarValor(h.campo, h.valor_novo)}</strong>
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {new Date(h.alterado_em).toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
