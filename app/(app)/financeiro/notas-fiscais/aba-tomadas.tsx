"use client";

/**
 * A aba Tomadas de Notas Fiscais (decisão 271): o controle único das NFs
 * emitidas contra os nossos CNPJs — o cadastro de notas da decisão 152. Uma
 * linha por NF (a mesma nota em dois documentos é uma linha só), com os
 * documentos que ela cobre (PP, desembolso e prestação da verba), o CNAE, o
 * retido que a nota destaca, a situação e o pagamento. O olho abre o painel
 * da nota; "Notas | Impostos" troca as colunas pela visão Impostos.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, AlertTriangle, CheckCheck, CheckCircle2, Eye, FilePenLine, FileText, Hourglass, Lock, PencilLine, Unlink, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { cn, formatDocumento } from "@/lib/utils";
import {
  ORIGENS_DO_DOCUMENTO,
  ROTULO_DA_ORIGEM,
  type CnpjDaLista,
  type DadosDasTomadas,
  type NotaTomada,
  type OrigemDoDocumento,
  type SituacaoDaTomada,
  type SituacaoDoPagamento,
} from "./dados";
import { BotaoExportar, CelulaDoCnpj, Divisoria, FiltrosDasNotas, ResumoItem, Selo, StatusChip, dataBR, moeda, semAcento, MaisLinhas, useLimiteDeLinhas } from "./comum";
import { NotaTomadaDrawer } from "./nota-tomada-drawer";
import { NavegadorDePeriodo, janelaInicial, naJanela, type Janela } from "./navegacao";
import { AlternarVisao, FECHO, IMPOSTOS_DAS_TOMADAS, TabelaDosImpostos, impostosDaTomada } from "./impostos";
import { BotaoLerNotas } from "./leitura-das-notas";
import { dadosDoPdf, linhasDaDivergencia, pdfDeOutraNota } from "./divergencia";
import { alterarRegistroDasNotas } from "./actions";
import {
  ConfirmarEdicaoDialog,
  FaixaDaEdicao,
  RodapeDaEdicao,
  analisar,
  edicaoInicial,
  podeEditar,
  type Analise,
  type CampoDaEdicao,
  type EdicaoDaLinha,
  type Edicoes,
} from "./edicao-do-registro";

type Filtro = "todas" | SituacaoDaTomada | "divergentes";

export const SITUACAO_DA_TOMADA: Record<SituacaoDaTomada, { rotulo: string; cor: "verde" | "ambar" | "cinza"; dica: string }> = {
  registrada: { rotulo: "Registrada", cor: "verde", dica: "O financeiro conferiu e registrou a nota." },
  em_avaliacao: { rotulo: "Em avaliação", cor: "ambar", dica: "Informada no envio do documento. O financeiro confere na aprovação." },
  sem_pp: { rotulo: "Sem documento ativo", cor: "cinza", dica: "Os documentos desta nota foram rejeitados ou cancelados." },
};
export const PAGAMENTO: Record<SituacaoDoPagamento, { rotulo: string; cor: "verde" | "azul" | "ambar" | "cinza" }> = {
  paga: { rotulo: "Paga", cor: "verde" },
  parcial: { rotulo: "Parcial", cor: "azul" },
  a_pagar: { rotulo: "A pagar", cor: "ambar" },
  sem_pagamento: { rotulo: "—", cor: "cinza" },
};
const ORDEM_DA_SITUACAO: SituacaoDaTomada[] = ["em_avaliacao", "registrada", "sem_pp"];
const ORDEM_DO_PAGAMENTO: SituacaoDoPagamento[] = ["a_pagar", "parcial", "paga", "sem_pagamento"];

const COLUNAS: ColunaFiltravel<NotaTomada>[] = [
  { chave: "nf", rotulo: "NF", tipo: "texto", celula: (n) => celulaTexto(n.numero, Number(n.numero.replace(/\D/g, "")) || 0) },
  { chave: "valor", rotulo: "Valor", tipo: "valor", faixa: true, alinhar: "right", celula: (n) => celulaValor(n.valor, moeda) },
  { chave: "emissao", rotulo: "Emissão", tipo: "data", celula: (n) => celulaData(n.data_emissao) },
  { chave: "fornecedor", rotulo: "Emitente", tipo: "texto", celula: (n) => celulaTexto(n.fornecedor.nome) },
  // O CNAE da nota; sem a leitura, o do cadastro do emitente.
  { chave: "cnae", rotulo: "CNAE", tipo: "texto", celula: (n) => celulaTexto(n.leitura.cnae ?? n.leitura.cnaeDoCadastro ?? "Sem CNAE") },
  { chave: "tomador", rotulo: "CNPJ tomador", tipo: "texto", celula: (n) => celulaTexto(n.tomador?.nome ?? "Não informado") },
  {
    chave: "documentos",
    rotulo: "Origem · Documento",
    tipo: "texto",
    celula: (n) =>
      n.documentos.length ? n.documentos.map((d) => ({ ...celulaTexto(d.codigo), grupo: ROTULO_DA_ORIGEM[d.origem] })) : celulaTexto(""),
  },
  // As retenções que a NF destaca.
  { chave: "retido", rotulo: "Retido", tipo: "valor", faixa: true, alinhar: "right", celula: (n) => celulaValor(n.leitura.retido, moeda) },
  {
    chave: "situacao",
    rotulo: "Situação",
    tipo: "texto",
    celula: (n) => ({ valor: n.situacao, rotulo: SITUACAO_DA_TOMADA[n.situacao].rotulo, ordem: ORDEM_DA_SITUACAO.indexOf(n.situacao) }),
  },
  {
    chave: "pagamento",
    rotulo: "Pagamento",
    tipo: "texto",
    celula: (n) => ({
      valor: n.pagamento.situacao,
      rotulo: n.pagamento.situacao === "sem_pagamento" ? "Sem pagamento" : PAGAMENTO[n.pagamento.situacao].rotulo,
      ordem: ORDEM_DO_PAGAMENTO.indexOf(n.pagamento.situacao),
    }),
  },
];

export function AbaTomadas({ dados, cnpjs, hoje }: { dados: DadosDasTomadas; cnpjs: CnpjDaLista[]; hoje: string }) {
  const [janela, setJanela] = React.useState<Janela>(() => janelaInicial(hoje));
  const [filtro, setFiltro] = React.useState<Filtro>("todas");
  const [origem, setOrigem] = React.useState<OrigemDoDocumento | "todas">("todas");
  const [busca, setBusca] = React.useState("");
  const [cnpjsMarcados, setCnpjsMarcados] = React.useState<string[]>([]);
  const [vendoId, setVendoId] = React.useState<string | null>(null);
  const [visao, setVisao] = React.useState<"notas" | "impostos">("notas");
  // Ponto 6: o "Editar registro" na própria tabela.
  const router = useRouter();
  const [editando, setEditando] = React.useState(false);
  const [edicoes, setEdicoes] = React.useState<Edicoes>({});
  const [confirmando, setConfirmando] = React.useState(false);
  const [gravando, setGravando] = React.useState(false);
  const [erroAoConfirmar, setErroAoConfirmar] = React.useState<string | null>(null);
  const [gravado, setGravado] = React.useState<{ texto: string; avisos: string[] } | null>(null);
  const analises = React.useMemo(() => {
    const m = new Map<string, Analise>();
    for (const [id, e] of Object.entries(edicoes)) {
      const n = dados.notas.find((x) => x.id === id);
      if (n) m.set(id, analisar(n, e, dados.notas, cnpjs, hoje));
    }
    return m;
  }, [edicoes, dados.notas, cnpjs, hoje]);
  const alteradas = [...analises.entries()].filter(([, a]) => a.mudancas.length > 0);
  const comErro = alteradas.filter(([, a]) => a.erro).length;
  function mudar(n: NotaTomada, patch: Partial<EdicaoDaLinha>) {
    setEdicoes((x) => ({ ...x, [n.id]: { ...(x[n.id] ?? edicaoInicial(n)), ...patch } }));
  }
  function sairDaEdicao() {
    setEditando(false);
    setEdicoes({});
    setConfirmando(false);
    setErroAoConfirmar(null);
  }
  async function confirmar(motivo: string) {
    const itens = alteradas
      .filter(([, a]) => !a.erro)
      .map(([id]) => {
        const n = dados.notas.find((x) => x.id === id)!;
        const e = edicoes[id];
        return {
          nota_id: n.id,
          numero: e.numero.trim(),
          data_emissao: e.emissao,
          valor: e.valor ?? n.valor,
          tomador_estabelecimento_id: e.tomadorId ?? "",
          antes: { numero: n.numero, data_emissao: n.data_emissao, valor: n.valor, tomador_estabelecimento_id: n.tomador?.id ?? null },
        };
      });
    setGravando(true);
    setErroAoConfirmar(null);
    const r = await alterarRegistroDasNotas(itens, motivo);
    setGravando(false);
    if (!r.ok) {
      setErroAoConfirmar(r.message);
      return;
    }
    setGravado({
      texto:
        itens.length === 1
          ? `NF ${itens[0].numero} alterada. Os documentos dela acompanham.`
          : `${itens.length} notas alteradas. Os documentos de cada uma acompanham.`,
      avisos: r.avisos,
    });
    sairDaEdicao();
    router.refresh();
  }

  const q = semAcento(busca.trim());
  const doCnpj = (n: NotaTomada) => cnpjsMarcados.length === 0 || (n.tomador != null && cnpjsMarcados.includes(n.tomador.id));
  // A janela, o CNPJ e a busca: a base dos chips de situação e de origem.
  const naBase = React.useMemo(
    () =>
      dados.notas.filter(
        (n) =>
          naJanela(n.data_emissao, janela) &&
          doCnpj(n) &&
          (!q ||
            semAcento(
              `${n.numero} ${n.fornecedor.nome} ${n.fornecedor.razao_social ?? ""} ${n.fornecedor.documento ?? ""} ${n.documentos
                .map((d) => `${d.codigo} ${d.descricao} ${d.job?.codigo ?? ""} ${d.job?.nome ?? ""}`)
                .join(" ")} ${n.tomador?.nome ?? ""} ${n.tomador?.cnpj ?? ""}`,
            ).includes(q)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dados.notas, cnpjsMarcados, q, janela],
  );
  const daOrigem = React.useMemo(() => (origem === "todas" ? naBase : naBase.filter((n) => n.origens.includes(origem))), [naBase, origem]);
  const contar = (s: SituacaoDaTomada) => daOrigem.filter((n) => n.situacao === s).length;
  const passaNoFiltro = React.useCallback(
    (n: NotaTomada) => (filtro === "todas" ? true : filtro === "divergentes" ? n.leitura.divergencias.length > 0 : n.situacao === filtro),
    [filtro],
  );
  const nDivergentes = daOrigem.filter((n) => n.leitura.divergencias.length > 0).length;
  const doTopo = React.useMemo(() => daOrigem.filter(passaNoFiltro), [daOrigem, passaNoFiltro]);
  const colunas = useFiltrosDeColuna(doTopo, COLUNAS, { guardarEm: "notas-fiscais-tomadas", contexto: `${janela.gran}${janela.ref}` });
  const visiveis = colunas.visiveis;
  const corte = useLimiteDeLinhas(`${visao}|${visiveis.length}|${visiveis[0]?.id ?? ""}|${visiveis[visiveis.length - 1]?.id ?? ""}`);
  const vendo = vendoId ? dados.notas.find((n) => n.id === vendoId) ?? null : null;
  const impostos = React.useMemo(() => new Map(visiveis.map((n) => [n.id, impostosDaTomada(n)])), [visiveis]);

  const total = visiveis.reduce((s, n) => s + n.valor, 0);
  const emAvaliacao = visiveis.filter((n) => n.situacao === "em_avaliacao");
  const pago = visiveis.reduce((s, n) => s + n.pagamento.pago, 0);
  const aPagar = visiveis.reduce((s, n) => s + n.pagamento.aPagar, 0);
  const faltaLancar = visiveis.filter((n) => n.situacao !== "sem_pp").reduce((s, n) => s + Math.max(0, n.valor - n.nasDocumentos), 0);
  const nSemPP = contar("sem_pp");
  // A origem conta o que a situação mostra (sem o filtro de origem).
  const baseDaOrigem = naBase.filter(passaNoFiltro);
  const contarOrigem = (o: OrigemDoDocumento) => baseDaOrigem.filter((n) => n.origens.includes(o)).length;
  const origensPresentes = ORIGENS_DO_DOCUMENTO.filter((o) => contarOrigem(o) > 0 || origem === o);
  const filtrado = colunas.ativo || filtro !== "todas" || origem !== "todas" || cnpjsMarcados.length > 0 || !!q || janela.gran !== "tudo";
  // As notas da lista que ainda não passaram pela leitura ampliada (e têm documento com o arquivo).
  const naoLidas = visiveis.filter((n) => !n.leitura.lida && n.documentos.some((d) => d.anexo)).map((n) => n.id);

  async function exportar() {
    const { baixarNotasEmExcel } = await import("./exportar");
    await baixarNotasEmExcel("tomadas", visiveis, filtrado);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Situação</span>
          <StatusChip ativo={filtro === "todas"} onClick={() => setFiltro("todas")} label="Todas" count={daOrigem.length} />
          <StatusChip ativo={filtro === "registrada"} onClick={() => setFiltro("registrada")} label="Registradas" count={contar("registrada")} />
          <StatusChip ativo={filtro === "em_avaliacao"} onClick={() => setFiltro("em_avaliacao")} label="Em avaliação" count={contar("em_avaliacao")} />
          {(nSemPP > 0 || filtro === "sem_pp") && (
            <StatusChip ativo={filtro === "sem_pp"} onClick={() => setFiltro("sem_pp")} label="Sem documento ativo" count={nSemPP} />
          )}
          {(nDivergentes > 0 || filtro === "divergentes") && (
            <StatusChip ativo={filtro === "divergentes"} onClick={() => setFiltro("divergentes")} label="PDF diferente do registro" count={nDivergentes} />
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Ponto 6: a seção é só do financeiro e do administrador; o banco confere de novo. */}
          <button
            type="button"
            onClick={() => {
              setGravado(null);
              setVisao("notas");
              setEditando(true);
            }}
            disabled={editando}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-2 text-[13px] font-semibold transition-colors hover:border-california-red hover:text-california-red disabled:cursor-default disabled:border-amber-300 disabled:bg-[#fffbeb] disabled:text-[#92400e]"
          >
            <PencilLine className="h-4 w-4" />
            {editando ? "Editando o registro" : "Editar registro"}
          </button>
          {!editando && <AlternarVisao visao={visao} onTrocar={setVisao} />}
          <BotaoExportar total={visiveis.length} filtrado={filtrado} onExportar={exportar} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Origem</span>
        <StatusChip ativo={origem === "todas"} onClick={() => setOrigem("todas")} label="Todas" count={baseDaOrigem.length} />
        {origensPresentes.map((o) => (
          <StatusChip key={o} ativo={origem === o} onClick={() => setOrigem(o)} label={ROTULO_DA_ORIGEM[o]} count={contarOrigem(o)} />
        ))}
      </div>

      <FiltrosDasNotas
        busca={busca}
        onBusca={setBusca}
        placeholder="Número, emitente, CNPJ, documento ou job..."
        cnpjs={cnpjs}
        rotuloCnpj="CNPJ tomador"
        cnpjsMarcados={cnpjsMarcados}
        onCnpjs={setCnpjsMarcados}
        navegador={<NavegadorDePeriodo janela={janela} onChange={setJanela} hoje={hoje} />}
      />

      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3">
        <ResumoItem
          icone={<FileText className="h-3.5 w-3.5 text-california-red" />}
          label={visiveis.length === 1 ? "1 nota" : `${visiveis.length} notas`}
          valor={moeda(total)}
        />
        <Divisoria />
        <ResumoItem icone={<CheckCheck className="h-3.5 w-3.5 text-emerald-700" />} label="Pago" valor={moeda(pago)} />
        <Divisoria />
        <ResumoItem icone={<Hourglass className="h-3.5 w-3.5 text-muted-foreground" />} label="A pagar" valor={moeda(aPagar)} />
        {emAvaliacao.length > 0 && (
          <>
            <Divisoria />
            <ResumoItem
              icone={<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
              label={emAvaliacao.length === 1 ? "1 em avaliação" : `${emAvaliacao.length} em avaliação`}
              valor={moeda(emAvaliacao.reduce((s, n) => s + n.valor, 0))}
            />
          </>
        )}
        {faltaLancar > 0.004 && (
          <>
            <Divisoria />
            <ResumoItem icone={<Unlink className="h-3.5 w-3.5 text-muted-foreground" />} label="Falta lançar" valor={moeda(faltaLancar)} />
          </>
        )}
      </div>

      {dados.erro && (
        <div className="flex items-start gap-2 rounded-lg border border-california-red/40 bg-california-red/5 p-3 text-sm text-california-red">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Não foi possível ler as notas tomadas. Recarregue a página.</span>
        </div>
      )}

      {colunas.ativo && (
        <BarraDosFiltrosDeColuna visiveis={visiveis.length} total={colunas.total} singular="nota" plural="notas" onLimpar={colunas.limpar} />
      )}

      {editando && <FaixaDaEdicao />}

      {gravado && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[12.5px] text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1 space-y-0.5">
            <p className="font-semibold">{gravado.texto}</p>
            {gravado.avisos.map((t) => (
              <p key={t} className="text-[#92400e]">
                {t}
              </p>
            ))}
          </div>
          <button type="button" onClick={() => setGravado(null)} aria-label="Fechar" className="text-emerald-700 hover:text-emerald-900">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!editando && <BotaoLerNotas ids={naoLidas} />}

      {visao === "impostos" ? (
        <TabelaDosImpostos
          colunas={IMPOSTOS_DAS_TOMADAS}
          limite={corte.limite}
          rotulos={FECHO.tomadas}
          rotuloNome="Emitente"
          linhas={visiveis.map((n) => ({
            id: n.id,
            numero: n.numero,
            valor: n.valor,
            emissao: n.data_emissao,
            nome: n.fornecedor.nome,
            documento: n.fornecedor.documento ? formatDocumento(n.fornecedor.documento) : null,
            cnae: n.leitura.cnae ?? n.leitura.cnaeDoCadastro,
            cancelada: false,
            impostos: impostos.get(n.id)!,
            onVer: () => setVendoId(n.id),
          }))}
        />
      ) : (
        <div className="relative overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <Table className="table-fixed">
            <colgroup>
              <col className={editando ? "w-[116px]" : "w-[96px]"} />
              <col className="w-[140px]" />
              <col className={editando ? "w-[146px]" : "w-[112px]"} />
              <col />
              <col className="w-[104px]" />
              <col className="w-[200px]" />
              <col className="w-[230px]" />
              <col className="w-[116px]" />
              <col className="w-[130px]" />
              <col className="w-[140px]" />
              <col className="w-[56px]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{colunas.titulo("nf")}</TableHead>
                <TableHead className="text-right">{colunas.titulo("valor")}</TableHead>
                <TableHead>{colunas.titulo("emissao")}</TableHead>
                <TableHead>{colunas.titulo("fornecedor")}</TableHead>
                <TableHead>{colunas.titulo("cnae")}</TableHead>
                <TableHead>{colunas.titulo("tomador")}</TableHead>
                <TableHead>{colunas.titulo("documentos")}</TableHead>
                <TableHead className="text-right">{colunas.titulo("retido")}</TableHead>
                <TableHead>{colunas.titulo("situacao")}</TableHead>
                <TableHead>{colunas.titulo("pagamento")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-12 text-center text-muted-foreground">
                    {dados.notas.length === 0 ? "Nenhuma nota tomada." : "Nenhuma nota com esses filtros."}
                  </TableCell>
                </TableRow>
              )}
              {visiveis.slice(0, corte.limite).map((n) => (
                <LinhaTomada
                  key={n.id}
                  n={n}
                  onVer={() => setVendoId(n.id)}
                  edicao={
                    editando
                      ? {
                          editavel: podeEditar(n),
                          e: edicoes[n.id] ?? edicaoInicial(n),
                          a: analises.get(n.id) ?? null,
                          onMudar: (p) => mudar(n, p),
                          cnpjs: n.tomador && !cnpjs.some((c) => c.id === n.tomador!.id) ? [...cnpjs, n.tomador] : cnpjs,
                        }
                      : null
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <MaisLinhas mostrando={Math.min(corte.limite, visiveis.length)} total={visiveis.length} onMais={corte.mais} />

      {editando && (
        <RodapeDaEdicao alteradas={alteradas.length} comErro={comErro} onCancelar={sairDaEdicao} onSalvar={() => setConfirmando(true)} />
      )}

      {confirmando && (
        <ConfirmarEdicaoDialog
          itens={alteradas.filter(([, a]) => !a.erro).map(([id, a]) => ({ n: dados.notas.find((x) => x.id === id)!, a }))}
          erro={erroAoConfirmar}
          gravando={gravando}
          onVoltar={() => {
            setConfirmando(false);
            setErroAoConfirmar(null);
          }}
          onConfirmar={confirmar}
        />
      )}

      {vendo && <NotaTomadaDrawer nota={vendo} onClose={() => setVendoId(null)} />}
    </div>
  );
}

interface EdicaoNaLinha {
  editavel: boolean;
  e: EdicaoDaLinha;
  a: Analise | null;
  onMudar: (p: Partial<EdicaoDaLinha>) => void;
  cnpjs: CnpjDaLista[];
}

/** O valor de antes, riscado, embaixo da célula alterada. */
function Antes({ children }: { children: React.ReactNode }) {
  return <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground line-through">{children}</div>;
}

function LinhaTomada({ n, onVer, edicao }: { n: NotaTomada; onVer: () => void; edicao: EdicaoNaLinha | null }) {
  const sit = SITUACAO_DA_TOMADA[n.situacao];
  const pag = PAGAMENTO[n.pagamento.situacao];
  const falta = n.situacao !== "sem_pp" ? Math.round((n.valor - n.nasDocumentos) * 100) / 100 : 0;
  const valem = n.documentos.filter((d) => d.vale);
  const ed = edicao?.editavel ? edicao : null;
  const a = ed?.a ?? null;
  const pinta = (c: CampoDaEdicao) => (a?.campos.has(c) ? "bg-amber-50/80" : undefined);
  const ultima = n.alteracoes[0];
  const comAviso = Boolean(a && (a.mudancas.length > 0 || a.erro));
  return (
    <>
    <TableRow className={cn(edicao && !edicao.editavel && "opacity-55", comAviso && "border-b-0")}>
      <TableCell className={pinta("numero")}>
        {ed ? (
          <>
            <Input
              value={ed.e.numero}
              onChange={(ev) => ed.onMudar({ numero: ev.target.value })}
              aria-label={`Número da NF ${n.numero}`}
              className="h-8 px-2 font-mono text-[13px] font-bold"
            />
            {a?.campos.has("numero") && <Antes>{n.numero}</Antes>}
            {dadosDoPdf(n) && (
              <button
                type="button"
                onClick={() => {
                  const d = dadosDoPdf(n)!;
                  ed.onMudar({
                    ...(d.numero ? { numero: d.numero } : {}),
                    ...(d.emissao ? { emissao: d.emissao } : {}),
                    ...(d.valor !== undefined ? { valor: d.valor } : {}),
                  });
                }}
                title={linhasDaDivergencia(n).join("\n")}
                className="mt-1 whitespace-nowrap text-[10.5px] font-semibold text-amber-700 underline-offset-2 hover:underline"
              >
                Usar os dados do PDF
              </button>
            )}
          </>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            {edicao && !edicao.editavel && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  {n.situacao === "registrada"
                    ? "Registrada pelo financeiro. Para corrigir, reverta a aprovação do documento: a nota volta a Em avaliação."
                    : "Sem documento ativo: não se altera."}
                </TooltipContent>
              </Tooltip>
            )}
            <button
              type="button"
              onClick={onVer}
              className="truncate font-mono text-[13px] font-bold text-foreground transition-colors hover:text-california-red"
            >
              {n.numero}
            </button>
            {n.leitura.divergencias.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="PDF diferente do registro" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm">
                  <p className="font-semibold">{pdfDeOutraNota(n) ? "O PDF anexado não é desta nota" : "O PDF não bate com o registro"}</p>
                  {linhasDaDivergencia(n).map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                  <p className="mt-1 text-[11.5px] opacity-80">
                    {n.leitura.divergencias.includes("emitente")
                      ? "Emitente diferente: confira o documento com quem o enviou."
                      : "Corrija pelo “Editar registro” (botão “Usar os dados do PDF”)."}
                  </p>
                </TooltipContent>
              </Tooltip>
            )}
            {ultima && !edicao && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <FilePenLine className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-label="Registro alterado" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  Registro alterado em {new Date(ultima.em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                  {ultima.por ? ` por ${ultima.por}` : ""}: {ultima.motivo}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        )}
      </TableCell>
      <TableCell className={cn("text-right", pinta("valor"))}>
        {ed ? (
          <>
            <MoneyInput
              value={ed.e.valor}
              onValueChange={(v) => ed.onMudar({ valor: v })}
              aria-label={`Valor da NF ${n.numero}`}
              className="h-8 px-2 text-right font-mono text-[13px]"
            />
            {a?.campos.has("valor") && <Antes>{moeda(n.valor)}</Antes>}
          </>
        ) : (
          <div className="font-mono text-[13px] font-semibold tabular-nums">{moeda(n.valor)}</div>
        )}
        {!ed && falta > 0.004 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="cursor-default whitespace-nowrap text-[11px] font-semibold text-amber-700">falta lançar {moeda(falta)}</div>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              A NF vale {moeda(n.valor)}, mas {valem.map((d) => d.codigo).join(", ") || "os documentos"} só {valem.length > 1 ? "cobrem" : "cobre"}{" "}
              {moeda(n.nasDocumentos)} dela. Os outros {moeda(falta)} ainda não foram lançados em nenhuma PP, desembolso ou prestação: ou falta o
              documento do resto, ou a parte lançada está errada.
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell className={cn("font-mono text-[12.5px]", pinta("emissao"))}>
        {ed ? (
          <>
            <Input
              type="date"
              value={ed.e.emissao}
              onChange={(ev) => ed.onMudar({ emissao: ev.target.value })}
              aria-label={`Emissão da NF ${n.numero}`}
              className="h-8 px-1.5 font-mono text-[12px]"
            />
            {a?.campos.has("emissao") && <Antes>{dataBR(n.data_emissao)}</Antes>}
          </>
        ) : (
          dataBR(n.data_emissao)
        )}
      </TableCell>
      <TableCell>
        <TruncateTooltip text={n.fornecedor.nome} className="text-[13px]" />
        <div className="font-mono text-[11px] text-muted-foreground">{n.fornecedor.documento ? formatDocumento(n.fornecedor.documento) : "—"}</div>
      </TableCell>
      <TableCell className="font-mono text-[12px]">
        {n.leitura.cnae ? (
          n.leitura.cnae
        ) : n.leitura.cnaeDoCadastro ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default text-muted-foreground">{n.leitura.cnaeDoCadastro}*</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {n.leitura.lida
                ? "A nota não traz CNAE: este é o do cadastro do emitente."
                : "A nota ainda não foi lida: este é o CNAE do cadastro do emitente."}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="font-sans text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className={pinta("tomador")}>
        {ed ? (
          <>
            <Select value={ed.e.tomadorId ?? undefined} onValueChange={(v) => ed.onMudar({ tomadorId: v })}>
              <SelectTrigger className="h-8 px-2 text-[12px]" aria-label={`CNPJ tomador da NF ${n.numero}`}>
                <SelectValue placeholder="Escolha o CNPJ" />
              </SelectTrigger>
              <SelectContent>
                {ed.cnpjs.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-[12.5px]">
                    {c.nome} · {formatDocumento(c.cnpj)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {a?.campos.has("tomador") && <Antes>{n.tomador?.nome ?? "—"}</Antes>}
          </>
        ) : (
          <CelulaDoCnpj c={n.tomador} />
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-0.5">
          {n.documentos.slice(0, 3).map((d) => (
            <span
              key={d.origem + d.id}
              className={"flex min-w-0 items-baseline gap-1.5 text-[12px] " + (d.vale ? "" : "text-muted-foreground line-through")}
              title={`${ROTULO_DA_ORIGEM[d.origem]} · ${d.codigo}${d.job ? ` · ${d.job.codigo} ${d.job.nome}` : d.descricao ? ` · ${d.descricao}` : ""}`}
            >
              <OrigemSelo origem={d.origem} />
              <span className="truncate font-mono font-semibold">{d.codigo}</span>
              {d.job && <span className="truncate font-mono text-[11px] text-muted-foreground">{d.job.codigo}</span>}
            </span>
          ))}
          {n.documentos.length > 3 && <span className="text-[11px] text-muted-foreground">+{n.documentos.length - 3} documentos</span>}
          {n.documentos.length === 0 && <span className="text-[12px] text-muted-foreground">—</span>}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-[12.5px] tabular-nums">
        {n.leitura.retido > 0.004 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default">{moeda(n.leitura.retido)}</span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              {n.leitura.retencoes.map((r) => (
                <div key={r.imposto}>
                  {r.imposto}: {moeda(r.valor)}
                </div>
              ))}
              <div className="mt-1 font-semibold">Líquido: {moeda(n.leitura.liquido)}</div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span
            className="cursor-default font-sans text-muted-foreground"
            title={
              !n.leitura.lida ? "A NF ainda não foi lida pela IA." : pdfDeOutraNota(n) ? "O PDF anexado não é desta nota." : "A NF não destaca retenção."
            }
          >
            —
          </span>
        )}
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default">
              <Selo cor={sit.cor}>{sit.rotulo}</Selo>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {n.situacao === "registrada" && n.registrada_em
              ? `Registrada em ${dataBR(n.registrada_em)}${n.registrada_onde ? `, ${n.registrada_onde}` : ""}.`
              : sit.dica}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        {n.pagamento.situacao === "sem_pagamento" ? (
          <span className="text-[12px] text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col items-start gap-1">
            <Selo cor={pag.cor}>{pag.rotulo}</Selo>
            <span className="text-[11px] text-muted-foreground">
              {n.pagamento.situacao === "parcial" && `${moeda(n.pagamento.pago)} pago`}
              {n.pagamento.situacao === "a_pagar" && n.pagamento.proximo && `em ${dataBR(n.pagamento.proximo)}`}
            </span>
          </div>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onVer}
              aria-label={`Ver a NF ${n.numero}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-white text-muted-foreground transition-colors hover:border-california-red/40 hover:text-california-red"
            >
              <Eye className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">Ver a nota</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
    {a && comAviso && (
      <TableRow className="hover:bg-transparent">
        <TableCell colSpan={11} className={cn("pb-3 pt-0", a.erro ? "bg-california-red/[0.04]" : "bg-amber-50/40")}>
          <div className="flex flex-col gap-1 pl-1 text-[12px]">
            {a.erro ? (
              <span className="flex items-start gap-1.5 font-medium text-california-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {a.erro}
              </span>
            ) : (
              <>
                {a.avisos.map((t) => (
                  <span key={t} className="flex items-start gap-1.5 text-[#92400e]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t}
                  </span>
                ))}
                <span className="text-muted-foreground">
                  {a.acompanham.length === 0
                    ? "Nenhum documento ativo traz esta nota."
                    : a.acompanham.length === 1
                      ? `${a.acompanham[0]} acompanha a alteração.`
                      : `${a.acompanham.join(", ")} acompanham a alteração.`}
                </span>
              </>
            )}
          </div>
        </TableCell>
      </TableRow>
    )}
    </>
  );
}

const COR_DA_ORIGEM: Record<OrigemDoDocumento, string> = {
  pp: "border-slate-200 bg-slate-50 text-slate-600",
  desembolso: "border-sky-200 bg-sky-50 text-sky-700",
  prestacao: "border-amber-200 bg-amber-50 text-amber-800",
};
const SIGLA_DA_ORIGEM: Record<OrigemDoDocumento, string> = { pp: "PP", desembolso: "DES", prestacao: "VERBA" };

/** O selo curto da origem, na frente do código do documento (a PP dispensa). */
export function OrigemSelo({ origem }: { origem: OrigemDoDocumento }) {
  if (origem === "pp") return null;
  return (
    <span
      title={ROTULO_DA_ORIGEM[origem]}
      className={"shrink-0 rounded border px-1 text-[9.5px] font-bold uppercase leading-[15px] tracking-wide " + COR_DA_ORIGEM[origem]}
    >
      {SIGLA_DA_ORIGEM[origem]}
    </span>
  );
}
