import { cn } from "@/lib/utils";
import {
  ROTULO_DA_SITUACAO,
  type FaturamentoDosJobs,
  type LinhaDoFaturamento,
  type SituacaoDoFaturamento,
  type VisaoDoFaturamento,
} from "@/lib/historico-financeiro/faturamento";
import { Valor } from "../_historico/filtros";

const ROTULO_DA_VISAO: Record<VisaoDoFaturamento, string> = { cliente: "Cliente", marca: "Marca", job: "Job" };

/** As colunas de valor, com a dica de cada uma (de onde vem na planilha). */
const COLUNAS: readonly { chave: "notas" | "faturado" | "recebido" | "aReceber"; rotulo: string; dica: string; largura: number }[] = [
  { chave: "notas", rotulo: "Notas", dica: "As notas emitidas do job nas abas de Faturamento; as canceladas ficam fora", largura: 88 },
  { chave: "faturado", rotulo: "Faturado", dica: "O valor das notas emitidas do job, em qualquer data", largura: 160 },
  { chave: "recebido", rotulo: "Recebido", dica: "O valor das notas com data de recebimento na planilha", largura: 160 },
  { chave: "aReceber", rotulo: "A receber", dica: "O valor das notas sem data de recebimento", largura: 160 },
];
const LARGURA_DA_SITUACAO = 128;

const COR_DA_SITUACAO: Record<SituacaoDoFaturamento, string> = {
  a_receber: "bg-california-red/10 text-california-red",
  parcial: "bg-amber-100 text-amber-800",
  recebido: "bg-emerald-100 text-emerald-800",
  sem_nota: "bg-muted text-muted-foreground",
};

function Celula({ linha, coluna, destaque }: { linha: LinhaDoFaturamento; coluna: (typeof COLUNAS)[number]; destaque: boolean }) {
  if (coluna.chave === "notas") {
    return linha.notas === 0 ? <span className="text-muted-foreground">—</span> : <>{linha.notas.toLocaleString("pt-BR")}</>;
  }
  const valor = linha[coluna.chave];
  if (coluna.chave === "aReceber" && destaque && valor > 0) {
    return (
      <span className="font-semibold text-california-red">
        <Valor valor={valor} />
      </span>
    );
  }
  return <Valor valor={valor} />;
}

function Situacao({ situacao }: { situacao: SituacaoDoFaturamento }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold", COR_DA_SITUACAO[situacao])}>
      {ROTULO_DA_SITUACAO[situacao]}
    </span>
  );
}

/**
 * O faturamento dos jobs do histórico por cliente, marca ou job: as notas, o
 * faturado, o recebido e o a receber, com o total em cima e, na visão por
 * job, a situação. Mesma grade fixa no cabeçalho e nas linhas.
 */
export function TabelaFaturamento({ resultado, visao }: { resultado: FaturamentoDosJobs; visao: VisaoDoFaturamento }) {
  const { linhas, total } = resultado;
  const comSituacao = visao === "job";
  const larguraDosValores = COLUNAS.reduce((s, c) => s + c.largura, 0) + (comSituacao ? LARGURA_DA_SITUACAO : 0);
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <table className="w-full table-fixed text-sm" style={{ minWidth: 320 + larguraDosValores }}>
        <colgroup>
          <col />
          {COLUNAS.map((c) => (
            <col key={c.chave} style={{ width: c.largura }} />
          ))}
          {comSituacao && <col style={{ width: LARGURA_DA_SITUACAO }} />}
        </colgroup>
        <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-4 py-3 text-left font-semibold">{ROTULO_DA_VISAO[visao]}</th>
            {COLUNAS.map((c) => (
              <th key={c.chave} className="px-3 py-3 text-right font-semibold" title={c.dica}>
                {c.rotulo}
              </th>
            ))}
            {comSituacao && (
              <th
                className="px-3 py-3 text-center font-semibold"
                title="Recebido: todas as notas com recebimento · Parcial: parte delas · A receber: nenhuma · Sem nota: o job não tem nota emitida"
              >
                Situação
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr className="bg-muted/30 font-semibold">
            <td className="px-4 py-2.5">
              Total <span className="font-normal text-muted-foreground">· {total.jobs} {total.jobs === 1 ? "job" : "jobs"}</span>
            </td>
            {COLUNAS.map((c) => (
              <td key={c.chave} className="px-3 py-2.5 text-right font-mono">
                <Celula linha={total} coluna={c} destaque={false} />
              </td>
            ))}
            {comSituacao && <td />}
          </tr>
          {linhas.map((l) => (
            <tr key={l.chave}>
              <td className="px-4 py-2.5">
                <p className="truncate" title={l.rotulo}>
                  {l.rotulo}
                  {visao !== "job" && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {l.jobs} {l.jobs === 1 ? "job" : "jobs"}
                    </span>
                  )}
                </p>
                {l.detalhe && (
                  <p className="truncate text-xs text-muted-foreground" title={l.detalhe}>
                    {l.detalhe}
                  </p>
                )}
              </td>
              {COLUNAS.map((c) => (
                <td key={c.chave} className="px-3 py-2.5 text-right font-mono">
                  <Celula linha={l} coluna={c} destaque />
                </td>
              ))}
              {comSituacao && <td className="px-3 py-2.5 text-center">{l.situacao && <Situacao situacao={l.situacao} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
