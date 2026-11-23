"use client";

/**
 * A aba Emitidas de Notas Fiscais (decisão 271): toda nota que as empresas
 * do grupo emitiram, de qualquer CNPJ emissor, com a origem (Job, BV, Save,
 * Avulso ou Histórico — o histórico da planilha, decisão 211), o CNAE, o job,
 * o retido pelo cliente e o recebimento. O olho abre o MESMO painel de
 * leitura da nota emitida do Contas a Receber (dados, parcelas e o PDF); a
 * nota do histórico não tem painel nem PDF no sistema. "Notas | Impostos"
 * troca as colunas pela visão Impostos.
 */
import * as React from "react";
import { AlertTriangle, CheckCheck, Eye, FileText, Hourglass, Receipt } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BarraDosFiltrosDeColuna,
  celulaData,
  celulaTexto,
  celulaValor,
  useFiltrosDeColuna,
  type ColunaFiltravel,
} from "@/components/ui/filtro-de-coluna";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TruncateTooltip } from "@/components/ui/truncate-tooltip";
import { NotaEmitidaDrawer } from "@/app/(app)/financeiro/contas-a-receber/nota-emitida-drawer";
import type { FiscalDoFaturar } from "@/lib/fiscal/faturar";
import { cn, formatCnpj, formatDocumento } from "@/lib/utils";
import { AlternarVisao, FECHO, IMPOSTOS_DAS_EMITIDAS, TabelaDosImpostos, impostosDaEmitida } from "./impostos";
import { NavegadorDePeriodo, janelaInicial, naJanela, type Janela } from "./navegacao";
import { ORIGENS, type CnpjDaLista, type DadosDasEmitidas, type NotaEmitida, type SituacaoDoRecebimento } from "./dados";
import { BotaoExportar, CelulaDoCnpj, ChipDaOrigem, Divisoria, FiltrosDasNotas, ROTULO_DA_ORIGEM, ResumoItem, Selo, StatusChip, dataBR, moeda, semAcento, MaisLinhas, useLimiteDeLinhas } from "./comum";

type Filtro = "emitidas" | "canceladas" | "todas";

const RECEBIMENTO: Record<SituacaoDoRecebimento, { rotulo: string; cor: "verde" | "azul" | "ambar" | "vermelho" | "cinza" }> = {
  recebida: { rotulo: "Recebida", cor: "verde" },
  parcial: { rotulo: "Parcial", cor: "azul" },
  a_receber: { rotulo: "A receber", cor: "ambar" },
  vencida: { rotulo: "Vencida", cor: "vermelho" },
  cancelada: { rotulo: "—", cor: "cinza" },
  sem_registro: { rotulo: "Sem registro", cor: "cinza" },
};

const ORDEM_DO_RECEBIMENTO: SituacaoDoRecebimento[] = ["vencida", "a_receber", "parcial", "recebida", "sem_registro", "cancelada"];
const CLASSE: Record<string, string> = { "sem job": "Sem job", "distribuição de lucro": "Distribuição de lucro" };

const COLUNAS: ColunaFiltravel<NotaEmitida>[] = [
  { chave: "nf", rotulo: "NF", tipo: "texto", celula: (n) => celulaTexto(n.numero_nf, Number(n.numero_nf.replace(/\D/g, "")) || 0) },
  { chave: "valor", rotulo: "Valor", tipo: "valor", faixa: true, alinhar: "right", celula: (n) => celulaValor(n.valor_total, moeda) },
  { chave: "emissao", rotulo: "Emissão", tipo: "data", celula: (n) => celulaData(n.data_emissao) },
  { chave: "emissor", rotulo: "CNPJ emissor", tipo: "texto", celula: (n) => celulaTexto(n.emissor?.nome ?? "Não registrado") },
  { chave: "tomador", rotulo: "Tomador", tipo: "texto", celula: (n) => celulaTexto(n.contraparte_nome) },
  { chave: "cnae", rotulo: "CNAE", tipo: "texto", celula: (n) => celulaTexto(n.cnae || "Sem CNAE") },
  {
    chave: "job",
    rotulo: "Job",
    tipo: "texto",
    celula: (n) =>
      n.jobs.length
        ? n.jobs.map((j) => ({ ...celulaTexto(j.nome), busca: `${j.nome} ${j.codigo ?? ""}` }))
        : celulaTexto(n.classe ? CLASSE[n.classe] ?? n.classe : ""),
  },
  {
    chave: "origem",
    rotulo: "Origem",
    tipo: "texto",
    celula: (n) => n.origens.map((o) => ({ valor: o, rotulo: ROTULO_DA_ORIGEM[o], ordem: ORIGENS.indexOf(o) })),
  },
  { chave: "retido", rotulo: "Retido", tipo: "valor", faixa: true, alinhar: "right", celula: (n) => celulaValor(n.retido, moeda) },
  {
    chave: "recebimento",
    rotulo: "Recebimento",
    tipo: "texto",
    celula: (n) => ({
      valor: n.recebimentoNaLista.situacao,
      rotulo: n.recebimentoNaLista.situacao === "cancelada" ? "Nota cancelada" : RECEBIMENTO[n.recebimentoNaLista.situacao].rotulo,
      ordem: ORDEM_DO_RECEBIMENTO.indexOf(n.recebimentoNaLista.situacao),
    }),
  },
];

export function AbaEmitidas({
  dados,
  cnpjs,
  fiscal,
  hoje,
}: {
  dados: DadosDasEmitidas;
  cnpjs: CnpjDaLista[];
  fiscal: FiscalDoFaturar;
  hoje: string;
}) {
  const [janela, setJanela] = React.useState<Janela>(() => janelaInicial(hoje));
  const [filtro, setFiltro] = React.useState<Filtro>("emitidas");
  const [busca, setBusca] = React.useState("");
  const [cnpjsMarcados, setCnpjsMarcados] = React.useState<string[]>([]);
  const [vendo, setVendo] = React.useState<NotaEmitida | null>(null);
  const [visao, setVisao] = React.useState<"notas" | "impostos">("notas");

  const q = semAcento(busca.trim());
  const doCnpjEBusca = React.useMemo(
    () =>
      dados.notas.filter(
        (n) =>
          naJanela(n.data_emissao, janela) &&
          (cnpjsMarcados.length === 0 || (n.emissor && cnpjsMarcados.includes(n.emissor.id))) &&
          (!q ||
            semAcento(
              `${n.numero_nf} ${n.contraparte_nome} ${n.tomador_documento ?? ""} ${n.jobs.map((j) => `${j.codigo ?? ""} ${j.nome}`).join(" ")} ${n.origens.map((o) => ROTULO_DA_ORIGEM[o]).join(" ")} ${n.descricao} ${n.emissor?.nome ?? ""} ${n.emissor?.cnpj ?? ""}`,
            ).includes(q)),
      ),
    [dados.notas, cnpjsMarcados, q, janela],
  );
  const contagem = {
    emitidas: doCnpjEBusca.filter((n) => n.status === "emitido").length,
    canceladas: doCnpjEBusca.filter((n) => n.status === "cancelado").length,
  };
  const doTopo = React.useMemo(
    () =>
      doCnpjEBusca.filter((n) =>
        filtro === "emitidas" ? n.status === "emitido" : filtro === "canceladas" ? n.status === "cancelado" : true,
      ),
    [doCnpjEBusca, filtro],
  );
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "notas-fiscais-emitidas", contexto: `${janela.gran}${janela.ref}` });
  const visiveis = colunas.visiveis;
  const corte = useLimiteDeLinhas(`${visao}|${visiveis.length}|${visiveis[0]?.faturamento_id ?? ""}|${visiveis[visiveis.length - 1]?.faturamento_id ?? ""}`);
  const impostos = React.useMemo(
    () => new Map(visiveis.map((n) => [n.faturamento_id, impostosDaEmitida(n, fiscal.cadastro)])),
    [visiveis, fiscal],
  );

  const valem = visiveis.filter((n) => n.status === "emitido");
  const total = valem.reduce((s, n) => s + n.valor_total, 0);
  const recebido = valem.reduce((s, n) => s + n.recebimentoNaLista.recebido, 0);
  const aReceber = valem.reduce((s, n) => s + n.recebimentoNaLista.aberto, 0);
  const vencido = valem.reduce((s, n) => s + n.recebimentoNaLista.vencido, 0);
  const canceladas = visiveis.filter((n) => n.status === "cancelado");
  const filtrado = colunas.ativo || filtro !== "todas" || cnpjsMarcados.length > 0 || !!q || janela.gran !== "tudo";

  async function exportar() {
    const { baixarNotasEmExcel } = await import("./exportar");
    await baixarNotasEmExcel("emitidas", visiveis, filtrado);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Situação</span>
          <StatusChip ativo={filtro === "emitidas"} onClick={() => setFiltro("emitidas")} label="Emitidas" count={contagem.emitidas} />
          <StatusChip ativo={filtro === "canceladas"} onClick={() => setFiltro("canceladas")} label="Canceladas" count={contagem.canceladas} />
          <StatusChip ativo={filtro === "todas"} onClick={() => setFiltro("todas")} label="Todas" />
        </div>
        <div className="flex items-center gap-2">
          <AlternarVisao visao={visao} onTrocar={setVisao} />
          <BotaoExportar total={visiveis.length} filtrado={filtrado} onExportar={exportar} />
        </div>
      </div>

      <FiltrosDasNotas
        busca={busca}
        onBusca={setBusca}
        placeholder="Número, tomador, CNPJ ou job..."
        cnpjs={cnpjs}
        rotuloCnpj="CNPJ emissor"
        cnpjsMarcados={cnpjsMarcados}
        onCnpjs={setCnpjsMarcados}
        navegador={<NavegadorDePeriodo janela={janela} onChange={setJanela} hoje={hoje} />}
      />

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <ResumoItem icone={<FileText className="h-3.5 w-3.5 text-california-red" />} label={valem.length === 1 ? "1 nota" : `${valem.length} notas`} valor={moeda(total)} />
        <Divisoria />
        <ResumoItem icone={<CheckCheck className="h-3.5 w-3.5 text-emerald-700" />} label="Recebido" valor={moeda(recebido)} />
        <Divisoria />
        <ResumoItem icone={<Hourglass className="h-3.5 w-3.5 text-muted-foreground" />} label="A receber" valor={moeda(aReceber)} />
        {vencido > 0 && (
          <>
            <Divisoria />
            <ResumoItem icone={<AlertTriangle className="h-3.5 w-3.5 text-california-red" />} label="Vencido" valor={moeda(vencido)} />
          </>
        )}
        {canceladas.length > 0 && (
          <>
            <Divisoria />
            <ResumoItem
              icone={<Receipt className="h-3.5 w-3.5 text-muted-foreground" />}
              label={canceladas.length === 1 ? "1 cancelada" : `${canceladas.length} canceladas`}
              valor={moeda(canceladas.reduce((s, n) => s + n.valor_total, 0))}
            />
          </>
        )}
      </div>

      {dados.erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Não foi possível ler as notas emitidas. Recarregue a página.</span>
        </div>
      )}

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna visiveis={visiveis.length} total={colunas.total} singular="nota" plural="notas" onLimpar={colunas.limpar} />
      )}

      {visao === "impostos" ? (
        <TabelaDosImpostos
          colunas={IMPOSTOS_DAS_EMITIDAS}
          limite={corte.limite}
          rotulos={FECHO.emitidas}
          rotuloNome="Tomador"
          linhas={visiveis.map((n) => ({
            id: n.faturamento_id,
            numero: n.numero_nf,
            valor: n.valor_total,
            emissao: n.data_emissao,
            nome: n.contraparte_nome,
            documento: n.tomador_documento
              ? n.tomador_documento.replace(/\D/g, "").length === 14
                ? formatCnpj(n.tomador_documento)
                : formatDocumento(n.tomador_documento)
              : null,
            cnae: n.cnae || null,
            cancelada: n.status === "cancelado",
            impostos: impostos.get(n.faturamento_id)!,
            onVer: n.historico ? null : () => setVendo(n),
          }))}
        />
      ) : (
        <div className="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <Table className="table-fixed">
            <colgroup>
              <col className="w-[96px]" />
              <col className="w-[132px]" />
              <col className="w-[112px]" />
              <col className="w-[196px]" />
              <col />
              <col className="w-[118px]" />
              <col />
              <col className="w-[150px]" />
              <col className="w-[120px]" />
              <col className="w-[160px]" />
              <col className="w-[64px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{colunas.titulo("nf")}</TableHead>
                <TableHead className="text-right">{colunas.titulo("valor")}</TableHead>
                <TableHead>{colunas.titulo("emissao")}</TableHead>
                <TableHead>{colunas.titulo("emissor")}</TableHead>
                <TableHead>{colunas.titulo("tomador")}</TableHead>
                <TableHead>{colunas.titulo("cnae")}</TableHead>
                <TableHead>{colunas.titulo("job")}</TableHead>
                <TableHead>{colunas.titulo("origem")}</TableHead>
                <TableHead className="text-right">{colunas.titulo("retido")}</TableHead>
                <TableHead>{colunas.titulo("recebimento")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                    {dados.notas.length === 0 ? "Nenhuma nota emitida." : "Nenhuma nota com esses filtros."}
                  </TableCell>
                </TableRow>
              )}
              {visiveis.slice(0, corte.limite).map((n) => (
                <LinhaEmitida key={n.faturamento_id} n={n} onVer={() => setVendo(n)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MaisLinhas mostrando={Math.min(corte.limite, visiveis.length)} total={visiveis.length} onMais={corte.mais} />

      {vendo && !vendo.historico && (
        <NotaEmitidaDrawer
          nota={vendo}
          onClose={() => setVendo(null)}
          empresas={dados.empresas}
          // O painel do Contas a Receber lê o mesmo formato por envio de job.
          infoPorJob={dados.infoPorJob as React.ComponentProps<typeof NotaEmitidaDrawer>["infoPorJob"]}
          fiscal={fiscal}
        />
      )}
    </div>
  );
}

function LinhaEmitida({ n, onVer }: { n: NotaEmitida; onVer: () => void }) {
  const cancelada = n.status === "cancelado";
  const r = n.recebimentoNaLista;
  const meta = RECEBIMENTO[r.situacao];
  return (
    <TableRow className={cancelada ? "text-muted-foreground" : undefined}>
      <TableCell>
        {n.historico ? (
          <span className={"font-mono text-[13px] font-bold " + (cancelada ? "text-muted-foreground line-through" : "text-foreground")}>{n.numero_nf}</span>
        ) : (
          <button
            type="button"
            onClick={onVer}
            className={
              "font-mono text-[13px] font-bold transition-colors hover:text-california-red " + (cancelada ? "text-muted-foreground line-through" : "text-foreground")
            }
          >
            {n.numero_nf}
          </button>
        )}
        {n.serie && <div className="font-mono text-[10.5px] text-muted-foreground">série {n.serie}</div>}
      </TableCell>
      <TableCell className={cn("text-right font-mono text-[13px] font-semibold tabular-nums", cancelada && "line-through")}>
        {moeda(n.valor_total)}
      </TableCell>
      <TableCell className="font-mono text-[12.5px]">{dataBR(n.data_emissao)}</TableCell>
      <TableCell>
        <CelulaDoCnpj c={n.emissor} />
      </TableCell>
      <TableCell>
        <TruncateTooltip text={n.contraparte_nome} className="text-[13px]" />
        <div className="font-mono text-[11px] text-muted-foreground">
          {n.tomador_documento ? (n.tomador_documento.replace(/\D/g, "").length === 14 ? formatCnpj(n.tomador_documento) : formatDocumento(n.tomador_documento)) : "—"}
        </div>
      </TableCell>
      <TableCell className="font-mono text-[11.5px] leading-tight">{n.cnae ? n.cnae : <span className="font-sans text-muted-foreground">—</span>}</TableCell>
      <TableCell>
        {n.jobs.length > 0 ? (
          <div className="min-w-0">
            <TruncateTooltip text={n.jobs[0].nome} className="text-[13px]" />
            <div className="flex items-baseline gap-1.5 font-mono text-[11px] text-muted-foreground">
              {n.jobs[0].codigo && <span>{n.jobs[0].codigo}</span>}
              {n.jobs.length > 1 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default font-sans font-semibold text-foreground/70">+{n.jobs.length - 1} {n.jobs.length === 2 ? "job" : "jobs"}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-sm">
                    {n.jobs.map((j) => (
                      <div key={j.id ?? j.nome}>
                        {j.codigo ? `${j.codigo} · ` : ""}
                        {j.nome}
                      </div>
                    ))}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        ) : (
          <span className="text-[12px] text-muted-foreground">{n.classe ? CLASSE[n.classe] ?? n.classe : "—"}</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {n.origens.map((o) => (
            <ChipDaOrigem key={o} origem={o} title={o === "historico" ? "Importada da planilha Fin. Conta Califórnia (histórico)." : undefined} />
          ))}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-[12.5px] tabular-nums">
        {n.retido > 0.004 ? moeda(n.retido) : <span className="font-sans text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        {cancelada ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">
                <Selo cor="cinza">Cancelada</Selo>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {n.cancelado_em ? `Cancelada em ${dataBR(n.cancelado_em)}` : "Cancelada"}
              {n.motivo_cancelamento ? ` · ${n.motivo_cancelamento}` : ""}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <Selo cor={meta.cor} title={r.situacao === "sem_registro" ? "A planilha não traz a data de recebimento desta nota." : undefined}>
              {meta.rotulo}
            </Selo>
            <span className="text-[11px] text-muted-foreground">
              {r.situacao === "recebida" && r.ultimo && `em ${dataBR(r.ultimo)}`}
              {r.situacao === "parcial" && `falta ${moeda(r.aberto)}`}
              {r.situacao === "a_receber" && r.proximo && `vence ${dataBR(r.proximo)}`}
              {r.situacao === "vencida" && r.proximo && `desde ${dataBR(r.proximo)}`}
            </span>
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        {n.historico ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onVer}
              aria-label={`Ver a NF ${n.numero_nf}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
            >
              <Eye className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Ver a nota</TooltipContent>
        </Tooltip>
        )}
      </TableCell>
    </TableRow>
  );
}
