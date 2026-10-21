"use client";

/**
 * A aba Banco da conciliação de uma conta (task 029, fase 3): o extrato
 * importado do banco, linha a linha, com o que o sistema tem para cada uma
 * — a versão Alternativa do protótipo aprovado
 * (docs/handoffs/2026-10-21-conciliacao-com-o-banco, `banco.jsx`,
 * `AbaBancoRecomendada` com as colunas de `TabelaDoBanco`).
 *
 * - Importar (decisão 198): o OFX é lido aqui (`lerOfx`) e sobe só com as
 *   linhas; a Server Action confere tudo de novo e grava sem repetir.
 * - O motor (decisão 199) roda aqui, sobre as linhas pendentes, os títulos
 *   em aberto da aba Títulos, as baixas da conta ainda sem linha, as
 *   remessas e as regras do histórico (`motor-da-conta.ts`).
 * - As seções seguem a ordem do protótipo; as tabelas usam o MESMO
 *   `colgroup`, com `table-fixed`, para as colunas ficarem na mesma
 *   vertical de uma seção para a outra.
 *
 * Entrega 3A: importar e ver. As ações de cada linha (baixar e conciliar,
 * corrigir a baixa, ignorar, desfazer) chegam com a entrega 3B — a célula
 * Ação fica com as vagas, vazias.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCheck, ChevronDown, FileUp, Info, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { decodificarOfx, lerOfx, rotuloDoBanco } from "@/lib/conciliacao/ofx";
import type { GrupoDeIguais, TituloDoMotor } from "@/lib/conciliacao/motor";
import { BotaoDetalhes } from "@/components/financeiro/detalhes-do-titulo/botao-detalhes";
import { dataBR, TOM_DA_ETIQUETA } from "@/components/financeiro/planilha-de-titulos/planilha";
import { CENTRO } from "../fiscal/impostos/dialogos";
import type { DadosDaAbaTitulos } from "./titulos-dados";
import type { DadosDaAbaBanco, LancamentoSemLinha, RegraDaConta } from "./banco-dados";
import { montarLinhas, prepararContexto, type Linha } from "./linhas-da-aba";
import {
  conciliarConta,
  secoesDoBanco,
  type MovimentoDaLinha,
  type ResultadoDaLinha,
  type SecoesDoBanco,
} from "./motor-da-conta";
import { importarExtrato, type ResultadoDaImportacao } from "./actions-conciliacao";

const moeda = formatBRL;
const r2 = (n: number) => Math.round(n * 100) / 100;
const final4 = (s: string | null | undefined) => (s ? `••••${s.replace(/\D/g, "").slice(-4)}` : "—");

/** O maior arquivo que se lê aqui: um mês de um extrato movimentado cabe
 *  com folga. */
const MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// O componente
// ---------------------------------------------------------------------------

export function AbaBanco({
  banco,
  dados,
  contaId,
}: {
  banco: DadosDaAbaBanco;
  /** A leitura da aba Títulos: os títulos em aberto que o motor procura. */
  dados: DadosDaAbaTitulos;
  contaId: string;
}) {
  const router = useRouter();
  const [abertas, setAbertas] = React.useState<Partial<Record<keyof SecoesDoBanco | "semLinha", boolean>>>({ conciliados: false });
  const [importando, setImportando] = React.useState(false);
  const [recusado, setRecusado] = React.useState<{ arquivo: string; r: Exclude<ResultadoDaImportacao, { ok: true }> } | null>(null);
  const [erro, setErro] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  // As linhas da planilha de títulos, montadas como a aba Títulos as monta.
  const linhasDaPlanilha = React.useMemo(() => {
    const ctx = prepararContexto({
      hoje: dados.hoje,
      empresas: dados.empresas,
      tipos: dados.tipos,
      subtipos: dados.subtipos,
      cartoes: dados.cartoes,
      contas: dados.contas,
      centroDoImposto: CENTRO,
      extras: dados.extras,
    });
    return montarLinhas(dados.aPagar, dados.aReceber, dados.impostos, ctx);
  }, [dados]);
  const linhaPorChave = React.useMemo(() => new Map(linhasDaPlanilha.map((l) => [l.chave, l])), [linhasDaPlanilha]);

  // Se o motor falhar com um dado que ele não espera, a aba mostra as linhas
  // do banco sem cruzar, com o aviso — e não uma tela em branco.
  const { conciliacao, falhaDoMotor } = React.useMemo(() => {
    try {
      return { conciliacao: conciliarConta(banco, linhasDaPlanilha, contaId, dados.documentoDaParte, dados.hoje), falhaDoMotor: false };
    } catch (e) {
      console.error("[conciliacao.motor]", e);
      return { conciliacao: conciliarConta(banco, [], contaId, {}, dados.hoje), falhaDoMotor: true };
    }
  }, [banco, linhasDaPlanilha, contaId, dados.documentoDaParte, dados.hoje]);
  const secoes = React.useMemo(() => secoesDoBanco(conciliacao.resultados), [conciliacao]);
  const regraPorId = React.useMemo(() => new Map(banco.regras.map((g) => [g.id, g])), [banco.regras]);

  async function importar(arquivo: File) {
    setErro(null);
    setRecusado(null);
    if (arquivo.size > MAX_BYTES) {
      setErro("O arquivo tem mais de 5 MB: exporte um período menor do internet banking.");
      return;
    }
    let ofx: ReturnType<typeof lerOfx>;
    try {
      ofx = lerOfx(decodificarOfx(await arquivo.arrayBuffer()));
    } catch {
      setErro("Não foi possível ler o arquivo: ele não parece um OFX.");
      return;
    }
    if (!ofx.movimentos.length) {
      setErro(ofx.bancoId || ofx.conta ? "O arquivo não tem movimentos." : "Não foi possível ler o arquivo: ele não parece um OFX.");
      return;
    }
    setImportando(true);
    try {
      const r = await importarExtrato(contaId, {
        nome: arquivo.name,
        bancoId: ofx.bancoId,
        conta: ofx.conta,
        inicio: ofx.inicio,
        fim: ofx.fim,
        geradoInstante: ofx.geradoInstante,
        saldoBanco: ofx.saldoBanco,
        saldoEm: ofx.saldoEm,
        movimentos: ofx.movimentos,
      });
      if (r.ok) {
        setToast(
          r.novos === 0
            ? `${arquivo.name}: nenhum movimento novo (os ${r.movimentos} já tinham sido importados).`
            : `${arquivo.name}: ${r.movimentos} ${r.movimentos === 1 ? "movimento" : "movimentos"} · ${r.novos} ${r.novos === 1 ? "novo" : "novos"}.`,
        );
        router.refresh();
      } else if (r.motivo === "erro") {
        setErro(r.message);
      } else {
        setRecusado({ arquivo: arquivo.name, r });
      }
    } catch {
      setErro("Não foi possível importar agora. Tente de novo.");
    } finally {
      setImportando(false);
    }
  }

  const ultima = banco.ultima;
  const zona = (compacta: boolean) => (
    <ZonaDeArquivo compacta={compacta} contaNome={banco.conta.nome} onArquivo={importar} importando={importando} />
  );

  const avisos = (
    <>
      {!banco.conta.temNumero && (
        <Nota tom="ambar" icone={AlertTriangle}>
          Para importar, a <strong>{banco.conta.nome}</strong> precisa de agência e número no cadastro: é por eles que o
          sistema reconhece o arquivo.{" "}
          <Link href="/financeiro/cadastros/contas-bancarias" prefetch={false} className="font-semibold underline">
            Cadastros do Financeiro › Contas bancárias
          </Link>
        </Nota>
      )}
      {erro && (
        <Nota tom="vermelho" icone={AlertTriangle}>
          {erro}
        </Nota>
      )}
      {falhaDoMotor && (
        <Nota tom="vermelho" icone={AlertTriangle}>
          Não foi possível cruzar o extrato com os títulos agora: as linhas aparecem sem o que o sistema tem para cada uma.
          Recarregue a página; se continuar, avise o suporte.
        </Nota>
      )}
      {recusado && <ArquivoRecusado arquivo={recusado.arquivo} r={recusado.r} onDescartar={() => setRecusado(null)} />}
    </>
  );

  const toastNaTela = toast && (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-50 flex max-w-[560px] items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-elevated"
    >
      <CheckCheck className="h-4 w-4 shrink-0 text-emerald-700" />
      <span className="text-sm font-semibold text-emerald-900">{toast}</span>
      <button type="button" onClick={() => setToast(null)} aria-label="Fechar aviso" className="text-emerald-700 hover:text-emerald-900">
        ×
      </button>
    </div>
  );

  if (!ultima) {
    return (
      <div className="space-y-4">
        {avisos}
        {zona(false)}
        {toastNaTela}
      </div>
    );
  }

  const resultados = conciliacao.resultados;
  const resolvidos = resultados.filter((r) => r.resolvido);
  const saldoBanco = ultima.saldoBanco;
  const saldoSistema = banco.saldoSistemaNoFim;
  const dif = saldoBanco === null || saldoSistema === null ? null : r2(saldoBanco - saldoSistema);
  const pct = resultados.length ? Math.round((resolvidos.length / resultados.length) * 100) : 0;
  const diaEmAndamento = ultima.fim && ultima.geradoDia === ultima.fim ? { dia: ultima.fim, hora: ultima.geradoHora } : null;

  const contexto: ContextoDasCelulas = { linhaPorChave, regraPorId, lancamentos: conciliacao.lancamentos };

  const SECOES: Array<[keyof SecoesDoBanco, string, string, Cor]> = [
    [
      "divergencia",
      "A baixa feita à mão não bate com o banco",
      "O sistema já tem a baixa, com outro valor. Corrija para o valor do banco; se a baixa era de outro pagamento, procure o título certo.",
      "red",
    ],
    [
      "manual",
      "Baixas feitas à mão que bateram com o banco",
      "A baixa já estava no sistema, e o banco mostra o mesmo valor até 3 dias depois. Conciliar só liga as duas linhas, com a data do banco: nenhuma baixa nova é criada.",
      "sky",
    ],
    [
      "alta",
      "Prontos: baixar e conciliar",
      "Títulos ainda sem baixa, com valor exato, forma de pagamento e data batendo, ou a soma única de títulos do mesmo fornecedor ou cliente. Um clique dá a baixa com os dados do banco e já concilia.",
      "emerald",
    ],
    [
      "conferir",
      "Conferir antes",
      "Mais títulos que linhas com o mesmo valor, diferença de juros, retenção, ou centro de custo a escolher. Linhas iguais em número igual ao de títulos não chegam aqui: cada linha paga um.",
      "amber",
    ],
    [
      "soma",
      "Uma linha do banco, vários títulos",
      "A remessa sai do banco como um débito só. Quando mais de uma soma de títulos do mesmo fornecedor ou cliente bate com a linha, escolha qual.",
      "emerald",
    ],
    [
      "par",
      "Saiu e voltou",
      "O banco devolveu o pagamento no mesmo dia. Baixar o título estaria errado: as duas linhas entram no extrato e ele continua a pagar.",
      "violet",
    ],
    [
      "regra",
      "Pelas regras do histórico",
      "Tarifas e outros débitos do próprio banco, que nunca têm título. A regra diz o centro de custo.",
      "violet",
    ],
    [
      "sem",
      "Sem correspondência",
      "Nada no sistema tem esse valor. Lance como avulso (a linha já vem preenchida) ou procure um título.",
      "red",
    ],
    ["conciliados", "Conciliados", "Ligados a um lançamento do Extrato. Dá para desfazer até fechar a conciliação.", "neutral"],
  ];

  return (
    <div className="space-y-4">
      {avisos}
      <CabecalhoDoArquivo banco={banco} />
      {diaEmAndamento && (
        <Nota tom="ambar" icone={Info}>
          <strong>{dataBR(diaEmAndamento.dia)} ainda está em andamento:</strong> o arquivo foi gerado às {diaEmAndamento.hora} desse
          dia. As linhas de hoje podem ser conciliadas, mas o dia só entra no fechamento com um extrato gerado depois dele. A
          baixa feita à mão hoje que ainda não está no banco não é divergência.
        </Nota>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Cartao rotulo={`Saldo no banco · ${dataBR(ultima.saldoEm ?? ultima.fim ?? "")}`} valor={saldoBanco === null ? "—" : moeda(saldoBanco)} />
        <Cartao rotulo={`Saldo do sistema · fim de ${ultima.fim ? dataBR(ultima.fim) : "—"}`} valor={saldoSistema === null ? "—" : moeda(saldoSistema)} />
        <Cartao
          rotulo="Diferença"
          valor={dif === null ? "—" : dif === 0 ? "Bate ✓" : moeda(dif)}
          cor={dif === 0 ? "text-emerald-700" : "text-california-red"}
          ajuda={dif === null ? "O arquivo não informou o saldo." : dif === 0 ? "Banco e sistema contam a mesma história." : "Some quando cada linha do banco tiver o seu lançamento."}
        />
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Conciliados</p>
          <p className="mt-1 font-mono text-lg font-semibold">
            {resolvidos.length} de {resultados.length}
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      <Nota tom="neutro" icone={Info}>
        Por enquanto a aba mostra o que o sistema encontrou para cada linha do banco. Baixar, conciliar e ignorar por aqui
        chegam na próxima atualização; até lá, a baixa continua pela aba Títulos.
      </Nota>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">As seções somem quando ficam vazias.</span>
      </div>
      {SECOES.map(([k, titulo, ajuda, cor]) => {
        const linhas = secoes[k] as ResultadoDaLinha[];
        const doGrupo = k === "conferir" ? secoes.grupos : [];
        const quantas = linhas.length + doGrupo.reduce((s, g) => s + g.linhas.length, 0);
        if (quantas === 0) return null;
        const aberta = abertas[k] !== false;
        return (
          <Secao
            key={k}
            titulo={titulo}
            ajuda={ajuda}
            cor={cor}
            quantas={quantas}
            aberta={aberta}
            onAlternar={() => setAbertas((p) => ({ ...p, [k]: !aberta }))}
          >
            <TabelaDoBanco linhas={linhas} grupos={doGrupo} contexto={contexto} />
          </Secao>
        );
      })}
      {conciliacao.naoApareceu.length > 0 && <SemLinhaNoBanco lancs={conciliacao.naoApareceu} />}
      {zona(true)}
      {toastNaTela}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

type Cor = "emerald" | "amber" | "violet" | "red" | "sky" | "neutral";

const COR_DO_PONTO: Record<Cor, string> = {
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  red: "bg-california-red",
  sky: "bg-sky-500",
  neutral: "bg-gray-400",
};

function Nota({
  children,
  tom = "neutro",
  icone: Icone,
}: {
  children: React.ReactNode;
  tom?: "neutro" | "ambar" | "verde" | "vermelho";
  icone?: React.ComponentType<{ className?: string }>;
}) {
  const t = {
    neutro: "border-dashed border-border bg-muted/30 text-muted-foreground",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    verde: "border-emerald-200 bg-emerald-50 text-emerald-900",
    vermelho: "border-red-200 bg-red-50 text-red-900",
  }[tom];
  return (
    <div className={cn("flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed", t)}>
      {Icone && <Icone className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Cartao({ rotulo, valor, cor, ajuda }: { rotulo: string; valor: string; cor?: string; ajuda?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", cor)}>{valor}</p>
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

function ZonaDeArquivo({
  compacta,
  contaNome,
  onArquivo,
  importando,
}: {
  compacta: boolean;
  contaNome: string;
  onArquivo: (f: File) => void;
  importando: boolean;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = React.useState(false);
  const ler = (f: File | undefined) => {
    if (f && !importando) onArquivo(f);
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setArrastando(true);
      }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => {
        e.preventDefault();
        setArrastando(false);
        ler(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed px-5 transition-colors",
        compacta ? "py-3" : "py-8",
        arrastando ? "border-california-red bg-california-red/5" : "border-border bg-card",
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-california-red/10 text-california-red">
        <FileUp className="h-5 w-5" />
      </span>
      <div className="min-w-[240px] flex-1">
        <p className="text-sm font-semibold">{compacta ? "Importar outro extrato" : "Arraste aqui o extrato do banco em OFX"}</p>
        <p className="text-xs text-muted-foreground">
          O arquivo que o internet banking do Santander, Itaú ou qualquer banco exporta. O sistema guarda só as linhas do
          extrato, sem repetir as que já vieram; nada muda nos títulos até você conciliar.
          {!compacta && ` A conta vem do próprio arquivo: ele só é aceito se for da ${contaNome}, a conta aberta no topo.`}
        </p>
      </div>
      <input
        ref={ref}
        type="file"
        accept=".ofx,.OFX,application/x-ofx"
        className="hidden"
        onChange={(e) => {
          ler(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={importando}
        onClick={() => ref.current?.click()}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50 disabled:cursor-wait disabled:opacity-60"
      >
        <Upload className="h-4 w-4" />
        {importando ? "Importando…" : "Escolher arquivo"}
      </button>
    </div>
  );
}

/** O arquivo que não é da conta aberta: o de outra conta cadastrada leva à
 *  conciliação dela; o de conta nenhuma é recusado. */
function ArquivoRecusado({
  arquivo,
  r,
  onDescartar,
}: {
  arquivo: string;
  r: Exclude<ResultadoDaImportacao, { ok: true }>;
  onDescartar: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {r.message}
      </p>
      <p className="text-xs leading-relaxed">
        {r.motivo === "outra_conta"
          ? `O extrato é conciliado na conta dele. Abra a conciliação da ${r.conta.nome} para importar ${arquivo}.`
          : "Nenhuma conta cadastrada tem esse número, ou falta agência e número no cadastro dela. Confira em Cadastros do Financeiro › Contas bancárias e importe de novo."}
      </p>
      <div className="flex flex-wrap gap-2">
        {r.motivo === "outra_conta" ? (
          <Link
            href={`/financeiro/conciliacao?conta=${r.conta.id}&aba=banco`}
            prefetch={false}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            Abrir a conciliação da {r.conta.nome}
          </Link>
        ) : (
          <Link
            href="/financeiro/cadastros/contas-bancarias"
            prefetch={false}
            className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-sm font-semibold text-foreground hover:bg-muted/50"
          >
            Abrir as contas bancárias
          </Link>
        )}
        <button
          type="button"
          onClick={onDescartar}
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          Descartar o arquivo
        </button>
      </div>
    </div>
  );
}

/**
 * O cabeçalho do extrato: a conta, reconhecida pelo próprio arquivo, e o
 * arquivo da última importação.
 */
function CabecalhoDoArquivo({ banco }: { banco: DadosDaAbaBanco }) {
  const ultima = banco.ultima;
  if (!ultima) return null;
  const repetidos = ultima.movimentos - ultima.novos;
  const c = banco.conta;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <span className="text-[11px] uppercase text-muted-foreground">Conta do extrato</span>
        <strong className="text-sm">
          {c.nome} · {c.banco}
          {c.agencia || c.numero ? ` · ${c.agencia ?? "—"} / ${c.numero ?? "—"}` : ""}
        </strong>
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCheck className="h-3.5 w-3.5" />
          reconhecida pelo arquivo (banco {ultima.bancoId || "—"}, conta {final4(ultima.conta)})
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <span className="font-semibold">{ultima.arquivo}</span>
        <span>
          Banco <strong>{rotuloDoBanco(ultima.bancoId ?? "")}</strong>
        </span>
        <span>
          Conta <strong className="font-mono">{final4(ultima.conta)}</strong>
        </span>
        <span>
          Período{" "}
          <strong>
            {ultima.inicio && ultima.fim
              ? ultima.inicio === ultima.fim
                ? dataBR(ultima.fim)
                : `${dataBR(ultima.inicio)} a ${dataBR(ultima.fim)}`
              : "—"}
          </strong>
        </span>
        <span>
          <strong>{ultima.movimentos}</strong> movimentos · <strong className="text-emerald-700">{ultima.novos} novos</strong>
          {repetidos > 0 && <span className="text-amber-700"> · {repetidos} já importados</span>}
        </span>
        {ultima.saldoBanco !== null && (
          <span>
            Saldo informado pelo banco <strong className="font-mono">{moeda(ultima.saldoBanco)}</strong>
          </span>
        )}
      </div>
      {repetidos > 0 && ultima.novos === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Nada novo neste arquivo.</strong> Os {repetidos} movimentos já tinham sido importados. O Santander troca o
            código de cada movimento (FITID) a cada download, então o sistema reconhece o repetido pela data, pelo valor, pelo
            histórico e pela posição entre iguais.
          </span>
        </div>
      )}
    </div>
  );
}

function Secao({
  titulo,
  ajuda,
  cor,
  quantas,
  aberta,
  onAlternar,
  children,
}: {
  titulo: string;
  ajuda: string;
  cor: Cor;
  quantas: number;
  aberta: boolean;
  onAlternar: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-[#f3f2ee] px-4 py-2.5">
        <button type="button" onClick={onAlternar} aria-expanded={aberta} className="inline-flex items-center gap-2 text-left">
          <ChevronDown className={cn("h-4 w-4 transition-transform", !aberta && "-rotate-90")} />
          <span className={cn("h-2 w-2 rounded-full", COR_DO_PONTO[cor])} />
          <span className="text-sm font-semibold">{titulo}</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{quantas}</span>
        </button>
        <span className="min-w-[200px] flex-1 text-xs text-muted-foreground">{ajuda}</span>
      </header>
      {aberta && children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// A tabela do banco
// ---------------------------------------------------------------------------

/** As colunas de todas as tabelas do banco — o MESMO `colgroup` em cada
 *  seção e no "sem linha no banco": Data · Histórico do banco · Crédito ·
 *  Débito · Situação · No sistema · Ação. */
function Colunas() {
  return (
    <colgroup>
      <col style={{ width: 96 }} />
      <col style={{ width: 300 }} />
      <col style={{ width: 120 }} />
      <col style={{ width: 120 }} />
      <col style={{ width: 172 }} />
      <col />
      <col style={{ width: 228 }} />
    </colgroup>
  );
}

interface ContextoDasCelulas {
  linhaPorChave: Map<string, Linha>;
  regraPorId: Map<string, RegraDaConta>;
  lancamentos: Map<string, LancamentoSemLinha>;
}

function TabelaDoBanco({
  linhas,
  grupos,
  contexto,
}: {
  linhas: ResultadoDaLinha[];
  grupos: GrupoDeIguais<MovimentoDaLinha>[];
  contexto: ContextoDasCelulas;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1250px] table-fixed text-sm">
        <Colunas />
        <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-left">Histórico do banco</th>
            <th className="px-3 py-2 text-right">Crédito</th>
            <th className="px-3 py-2 text-right">Débito</th>
            <th className="px-3 py-2 text-left">Situação</th>
            <th className="px-3 py-2 text-left">No sistema</th>
            <th className="px-3 py-2 text-left">
              <span className="ml-auto block w-[200px] pl-1">Ação</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <GrupoNaTabela key={`${g.chave}|${g.linhas.map((r) => r.mov.id).join(",")}`} g={g} contexto={contexto} />
          ))}
          {linhas.map((r) => (
            <tr key={r.mov.id} className="border-b border-border last:border-0">
              <CelulasDoBanco r={r} />
              <td className="px-3 py-2">
                <Situacao r={r} />
              </td>
              <td className="px-3 py-2">
                {r.resolvido ? <p className="truncate text-xs" title={r.resolvido.texto}>{r.resolvido.texto}</p> : <NoSistema r={r} contexto={contexto} />}
                {!r.resolvido && r.motivo && r.estado !== "sem_par" && (
                  <p className="truncate text-[10.5px] text-muted-foreground/80" title={r.motivo}>
                    {r.motivo}
                  </p>
                )}
              </td>
              <td className="px-3 py-2">
                <AcoesDaLinha r={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Data, histórico, crédito e débito: as colunas do banco. */
function CelulasDoBanco({ r }: { r: ResultadoDaLinha }) {
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(r.mov.data)}</td>
      <td className="px-3 py-2 font-mono text-[11px]">
        <span className="block truncate" title={r.mov.historico}>
          {r.mov.historico}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{r.mov.valor > 0 ? moeda(r.mov.valor) : ""}</td>
      <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{r.mov.valor < 0 ? moeda(-r.mov.valor) : ""}</td>
    </>
  );
}

function Situacao({ r }: { r: ResultadoDaLinha }) {
  if (r.resolvido)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
        <CheckCheck className="h-3.5 w-3.5" />
        {r.resolvido.estado === "ignorado" ? "Ignorado" : r.resolvido.sozinho ? "Conciliado sozinho" : "Conciliado"}
      </span>
    );
  const m: Record<ResultadoDaLinha["estado"], [string, string]> = {
    sugestao: ["Título encontrado", "text-emerald-700"],
    soma: ["Remessa encontrada", "text-emerald-700"],
    combinacao: [r.confianca === "alta" ? "Soma encontrada" : "Vários títulos", r.confianca === "alta" ? "text-emerald-700" : "text-amber-700"],
    diferenca: ["Valor diferente", "text-amber-700"],
    ja_lancado: ["Já lançado", "text-sky-700"],
    divergencia: ["Baixa diverge", "text-california-red"],
    par: ["Saiu e voltou", "text-violet-700"],
    regra: ["Regra", "text-violet-700"],
    sem_par: ["Sem correspondência", "text-california-red"],
  };
  const [texto, cor] = m[r.estado];
  return <span className={cn("whitespace-nowrap text-xs font-semibold", cor)}>{texto}</span>;
}

/** O centro de custo do título, como a planilha o diz por inteiro. */
function textoDoCentro(l: Linha | undefined): string {
  if (!l) return "";
  switch (l.centro.tipo) {
    case "plano":
      return ` · ${l.centro.completo}`;
    case "definir_na_baixa":
      return " · centro de custo na baixa";
    case "fora_do_dre":
      return " · fora do DRE";
    case "itens_da_fatura":
      return " · itens da fatura";
  }
}

/** A etiqueta, a descrição e o ⓘ do título — os mesmos da planilha. */
function TituloNaCelula({ t, l }: { t: TituloDoMotor; l: Linha | undefined }) {
  return (
    <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
      {l && (
        <span
          className={cn(
            "inline-block shrink-0 whitespace-nowrap rounded border px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide",
            TOM_DA_ETIQUETA[l.etiqueta.tom],
          )}
        >
          {l.etiqueta.texto}
        </span>
      )}
      <span className="truncate" title={l?.descricao ?? t.ref}>
        {l?.descricao ?? t.ref}
      </span>
      {l && (
        <span className="shrink-0 scale-90">
          <BotaoDetalhes
            chave={l.chave}
            titulo={l.descricao}
            recebimento={l.entra}
            job={l.job}
            vencimentoDiferente={l.vencimento && l.vencimento !== l.dataPrevista ? l.vencimento : null}
            retencoes={l.valor.retencoes}
            rateio={l.rateio}
            acoes={[]}
          />
        </span>
      )}
    </p>
  );
}

/** O que o sistema tem para a linha do banco, em uma célula. */
function NoSistema({ r, contexto }: { r: ResultadoDaLinha; contexto: ContextoDasCelulas }) {
  if (r.estado === "ja_lancado" && r.lancamento) {
    const l = contexto.lancamentos.get(r.lancamento.id);
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold" title={r.lancamento.descricao}>
          {r.lancamento.descricao}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          Já no Extrato em {dataBR(r.lancamento.data)}
          {l?.fornecedor ? ` · ${l.fornecedor}` : ""}
          {r.lancamento.juros ? ` · inclui ${moeda(r.lancamento.juros)} de juros` : ""}
        </p>
      </div>
    );
  }
  if (r.estado === "soma" && r.lote)
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{r.lote.descricao ?? r.lote.nome}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {r.lote.titulos.length} títulos · soma {moeda(r.lote.total)}
        </p>
      </div>
    );
  if (r.estado === "combinacao" && r.titulos?.length) {
    const ts = r.titulos;
    const mesmoDia = ts.every((t) => t.vencimento === ts[0].vencimento);
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">
          {ts.map((t) => t.ref).join(" + ")} · {ts[0].contraparte}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {ts.length} títulos · {ts.map((t) => moeda(t.liquido)).join(" + ")} ·{" "}
          {mesmoDia ? `vencem ${dataBR(ts[0].vencimento)}` : `vencem ${ts.map((t) => dataBR(t.vencimento).slice(0, 5)).join(", ")}`}
        </p>
      </div>
    );
  }
  if (r.estado === "regra" && r.regra) {
    const g = r.regra.id ? contexto.regraPorId.get(r.regra.id) : undefined;
    const nome = r.regra.centro.split(" · ").pop() ?? r.regra.centro;
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">
          {nome} · {r.mov.historico.replace(/\s+\S*\d{6,}.*$/, "")}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          Lançamento novo · {r.regra.centro}
          {g ? ` · ${g.empresa}` : ""}
        </p>
      </div>
    );
  }
  if (r.estado === "par")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">
          {r.mov.valor > 0 ? "Devolução do PIX" : "PIX que voltou"}
          {r.titulo ? ` · ${r.titulo.ref} · ${r.titulo.contraparte}` : ""}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">Saída e devolução no mesmo dia: as duas entram no extrato e o título continua a pagar.</p>
      </div>
    );
  if (r.estado === "divergencia" && r.lancamento)
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold" title={r.lancamento.descricao}>
          {r.lancamento.descricao}
        </p>
        <p className="truncate text-[11px] font-semibold text-california-red">
          Baixa de {moeda(Math.abs(r.lancamento.valor))} em {dataBR(r.lancamento.data)} · {moeda(Math.abs(r.diferencaBaixa ?? 0))}{" "}
          {(r.diferencaBaixa ?? 0) > 0 ? "a mais" : "a menos"} que o banco
        </p>
      </div>
    );
  if (r.titulo) {
    const l = contexto.linhaPorChave.get(r.titulo.id);
    return (
      <div className="min-w-0">
        <TituloNaCelula t={r.titulo} l={l} />
        <p className="truncate text-[11px] text-muted-foreground">
          {r.titulo.contraparte} · vence {dataBR(r.titulo.vencimento)}
          {textoDoCentro(l)}
          {r.diferenca ? ` · título de ${moeda(r.titulo.liquido)}` : r.retencaoSugerida ? ` · nota de ${moeda(r.titulo.valor)}, com retenção` : ""}
        </p>
      </div>
    );
  }
  return <p className="text-xs italic text-muted-foreground">{r.motivo}</p>;
}

/**
 * A célula de ação tem sempre as mesmas três vagas — a ação principal, de
 * largura fixa, e dois ícones (procurar e ignorar) —, ocupadas ou não. Assim
 * os botões ficam numa coluna só, linha após linha. Na entrega 3A elas
 * ficam vazias; as ações chegam na 3B.
 */
function AcoesDaLinha({ r }: { r: ResultadoDaLinha }) {
  return (
    <span className="ml-auto grid w-[200px] grid-cols-[136px_28px_28px] items-center gap-1">
      <span>
        {r.resolvido && (
          <span
            className={cn(
              "inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold",
              r.resolvido.estado === "ignorado" ? "text-muted-foreground" : "text-emerald-700",
            )}
          >
            <CheckCheck className="h-3 w-3" />
            {r.resolvido.estado === "ignorado" ? "Ignorado" : "Conciliado"}
          </span>
        )}
      </span>
      <span />
      <span />
    </span>
  );
}

/**
 * O grupo de linhas iguais dentro da tabela do banco: uma faixa com o que o
 * grupo é, e cada linha do banco com as mesmas colunas das outras e o título
 * escolhido para ela, que se troca por outro do grupo ("Trocar…": o
 * escolhido de outra linha troca de lugar).
 */
function GrupoNaTabela({ g, contexto }: { g: GrupoDeIguais<MovimentoDaLinha>; contexto: ContextoDasCelulas }) {
  const linhas = React.useMemo(() => [...g.linhas].sort((a, b) => a.mov.ordem - b.mov.ordem), [g.linhas]);
  const [escolha, setEscolha] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(linhas.map((r) => [r.mov.id, (r.titulo as TituloDoMotor).id])),
  );
  const porId = new Map(g.titulos.map((t) => [t.id, t]));
  const sobram = g.titulos.filter((t) => !Object.values(escolha).includes(t.id));
  const trocar = (linhaId: string, id: string) =>
    setEscolha((e) => {
      const outra = Object.keys(e).find((k) => k !== linhaId && e[k] === id);
      return outra ? { ...e, [linhaId]: id, [outra]: e[linhaId] } : { ...e, [linhaId]: id };
    });
  const n = linhas.length;
  const m = g.titulos.length;
  const valor = moeda(Math.abs(linhas[0].mov.valor));
  const aPagar = linhas[0].mov.valor < 0 ? "a pagar" : "a receber";
  return (
    <>
      <tr className="border-b border-amber-200 bg-amber-50/70">
        <td colSpan={7} className="px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[12px] font-semibold text-amber-900">
              {n === 1 ? `1 linha de ${valor} no banco` : `${n} linhas de ${valor} no banco, no mesmo dia`} · {m} títulos de {valor} {aPagar}
            </span>
            <span className="min-w-[280px] flex-1 text-[11.5px] text-amber-900/80">
              {sobram.length > 0 && (
                <>
                  Fica em aberto: <strong>{sobram.map((t) => `${t.ref} · ${t.contraparte}`).join("; ")}</strong>
                </>
              )}
            </span>
          </div>
        </td>
      </tr>
      {linhas.map((r, i) => {
        const t = porId.get(escolha[r.mov.id]) as TituloDoMotor;
        const l = contexto.linhaPorChave.get(t.id);
        const dias = Math.round((Date.parse(r.mov.data) - Date.parse(t.vencimento)) / 86400000);
        return (
          <tr key={r.mov.id} className="border-b border-border">
            <CelulasDoBanco r={r as ResultadoDaLinha} />
            <td className="px-3 py-2">
              <span className="whitespace-nowrap text-xs font-semibold text-amber-700">{n === 1 ? "Mesmo valor" : `Linha ${i + 1} de ${n}`}</span>
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <TituloNaCelula t={t} l={l} />
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t.contraparte} · vence {dataBR(t.vencimento)}
                    {dias !== 0 && (
                      <span className="text-amber-700">
                        {" "}
                        (o banco pagou {Math.abs(dias)} {Math.abs(dias) === 1 ? "dia" : "dias"} {dias > 0 ? "depois" : "antes"})
                      </span>
                    )}
                    {textoDoCentro(l)}
                  </p>
                </div>
                <select
                  aria-label="Trocar o título desta linha"
                  value=""
                  onChange={(e) => e.target.value && trocar(r.mov.id, e.target.value)}
                  className="h-7 w-[92px] shrink-0 rounded-md border border-border bg-white px-1.5 text-[11px] font-semibold text-muted-foreground hover:border-california-red/50"
                >
                  <option value="">Trocar…</option>
                  {g.titulos
                    .filter((x) => x.id !== t.id)
                    .map((x) => {
                      const deOutra = Object.entries(escolha).some(([k, id]) => k !== r.mov.id && id === x.id);
                      return (
                        <option key={x.id} value={x.id}>
                          {x.ref} · {x.contraparte} · vence {dataBR(x.vencimento).slice(0, 5)}
                          {deOutra ? " (troca com a outra linha)" : " (em aberto)"}
                        </option>
                      );
                    })}
                </select>
              </div>
            </td>
            <td className="px-3 py-2">
              <span className="ml-auto grid w-[200px] grid-cols-[136px_28px_28px] items-center gap-1">
                <span />
                <span />
                <span />
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

/**
 * O lado do sistema: as baixas, com data num dia completo do extrato
 * importado, que não têm linha no banco. Pagas em outra conta, com a data
 * errada ou não pagas: a conciliação não fecha até cada uma ser resolvida.
 * Mesmas colunas da tabela do banco, para alinhar com as seções de cima.
 */
function SemLinhaNoBanco({ lancs }: { lancs: LancamentoSemLinha[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-red-200 bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50/60 px-4 py-2.5">
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-california-red" />
          <span className="text-sm font-semibold">Baixa no sistema, sem linha no banco</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{lancs.length}</span>
        </span>
        <span className="min-w-[200px] flex-1 text-xs text-muted-foreground">
          Baixas feitas à mão, em dias que o extrato importado já cobre por inteiro, que o banco não mostra: pagas em outra
          conta, com a data errada, ou não pagas. Corrija a baixa ou cancele-a; até lá, a conciliação não fecha.
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1250px] table-fixed text-sm">
          <Colunas />
          <tbody>
            {lancs.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(l.data)}</td>
                <td className="px-3 py-2 text-xs">
                  <span className="block truncate font-semibold" title={l.descricao}>
                    {l.descricao}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">{l.fornecedor ?? "—"}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{l.valor > 0 ? moeda(l.valor) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{l.valor < 0 ? moeda(-l.valor) : ""}</td>
                <td className="px-3 py-2">
                  <span className="whitespace-nowrap text-xs font-semibold text-california-red">Não está no banco</span>
                </td>
                <td className="px-3 py-2 text-[11px] text-muted-foreground">
                  Lançamento no Extrato desta conta. O banco não tem {l.valor < 0 ? "débito" : "crédito"} de {moeda(Math.abs(l.valor))}{" "}
                  entre as linhas importadas.
                </td>
                <td className="px-3 py-2">
                  <span className="ml-auto grid w-[200px] grid-cols-[136px_28px_28px] items-center gap-1">
                    <span />
                    <span />
                    <span />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
