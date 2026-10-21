import * as React from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCheck,
  ChevronDown,
  CircleSlash,
  FileUp,
  Info,
  Landmark,
  Link2,
  Lock,
  Unlock,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Undo2,
  Upload,
  Wand2,
} from "lucide-react";
import { CONTAS, DIA_OFX } from "./data";
import { Botao, Campo, centroTexto, Chip, cn, dataBR, Dialogo, moeda, Nota, OrigemPill, Pill } from "./ui";
import { aberto, correcaoDaBaixa, descricaoDoLancamento, r2 } from "./logica";
import { formaDoHistorico, retencaoQueExplica } from "./ofx";
import { BotaoDetalhes } from "./detalhes";
import { DetalhesContexto } from "./titulos";

/** O ⓘ ao lado do título sugerido: o mesmo pop-up da planilha (na
 *  variante C, que não cabe aqui, vale o pop-up A). */
function DetalhesDaSugestao({ t }) {
  const d = React.useContext(DetalhesContexto);
  return (
    <span className="shrink-0 scale-90">
      <BotaoDetalhes t={t} variante={d.variante === "c" ? "a" : d.variante} onVerDocumentos={d.onVerDocumentos} abrirAcao={d.abrirAcao} />
    </span>
  );
}

const CONF = {
  alta: ["Alta", "border-emerald-200 bg-emerald-50 text-emerald-700"],
  media: ["Conferir", "border-amber-200 bg-amber-50 text-amber-800"],
  baixa: ["Baixa", "border-red-200 bg-red-50 text-[#b3323c]"],
};

function ZonaDeArquivo({ onArquivo, onExemplo, compacta }) {
  const ref = React.useRef(null);
  const [arrastando, setArrastando] = React.useState(false);
  const ler = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => onArquivo(file.name, r.result);
    r.readAsText(file, "windows-1252");
  };
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setArrastando(true))}
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
          O arquivo que o internet banking do Santander, Itaú ou qualquer banco exporta. Ele é lido aqui na tela: nada é gravado até você conciliar.
          {!compacta && " A conta vem do próprio arquivo: ele só é aceito se for da California Santander, a conta aberta no topo."}
        </p>
      </div>
      <input ref={ref} type="file" accept=".ofx,.OFX,application/x-ofx" className="hidden" onChange={(e) => ler(e.target.files?.[0])} />
      <Botao variante="contorno" onClick={() => ref.current?.click()}>
        <Upload className="h-4 w-4" />
        Escolher arquivo
      </Botao>
      {onExemplo && (
        <Botao variante="contornoVermelho" onClick={onExemplo}>
          Usar o extrato de exemplo
        </Botao>
      )}
    </div>
  );
}

/** Os dígitos de agência + conta, para reconhecer a conta do arquivo. */
export function digitosDaConta(c) {
  return `${c.agencia}${c.numero}`.replace(/\D/g, "");
}

/** A conta que o arquivo diz ser (BANKID + ACCTID), se for uma cadastrada. */
export function contaDoArquivo(ofx) {
  const acct = (ofx.conta || "").replace(/\D/g, "");
  return CONTAS.find((c) => acct && (acct === digitosDaConta(c) || acct.endsWith(c.numero.replace(/\D/g, "")))) ?? null;
}

/**
 * O cabeçalho do extrato lido. A conta vem do próprio arquivo (o código do
 * banco e a conta, que no Santander é agência + conta) e não se troca: o
 * arquivo só é aceito quando é da conta aberta no topo.
 */
function CabecalhoDoArquivo({ imp }) {
  if (!imp) return null;
  const { ofx } = imp;
  const final4 = (s) => (s ? `••••${s.slice(-4)}` : "—");
  const conta = CONTAS.find((c) => c.id === "cs");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <span className="text-[11px] uppercase text-muted-foreground">Conta do extrato</span>
        <strong className="text-sm">
          {conta.nome} · {conta.banco} · {conta.agencia} / {conta.numero}
        </strong>
        {imp.simulada ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800">
            simulada no protótipo: no sistema, este arquivo seria recusado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <CheckCheck className="h-3.5 w-3.5" />
            reconhecida pelo arquivo (banco {ofx.bancoId}, conta {final4(ofx.conta)})
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-xs">
        <span className="font-semibold">{imp.arquivo}</span>
        <span>
          Banco <strong>{ofx.bancoId === "033" ? "033 · Santander" : ofx.banco}</strong>
        </span>
        <span>
          Conta <strong className="font-mono">{final4(ofx.conta)}</strong>
        </span>
        <span>
          Período <strong>{ofx.inicio === ofx.fim ? dataBR(ofx.inicio) : `${dataBR(ofx.inicio)} a ${dataBR(ofx.fim)}`}</strong>
        </span>
        <span>
          <strong>{ofx.movimentos.length}</strong> movimentos · <strong className="text-emerald-700">{imp.novos} novos</strong>
          {imp.repetidos > 0 && <span className="text-amber-700"> · {imp.repetidos} já importados</span>}
        </span>
        {ofx.saldoBanco !== null && (
          <span>
            Saldo informado pelo banco <strong className="font-mono">{moeda(ofx.saldoBanco)}</strong>
          </span>
        )}
      </div>
      {imp.deslocamento !== 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          <Info className="h-4 w-4 shrink-0" />O extrato é de {dataBR(ofx.fim)}. Os títulos fictícios do protótipo vencem em {dataBR(DIA_OFX)}: para a simulação, as datas deles foram
          levadas para a data do arquivo.
        </div>
      )}
      {imp.repetidos > 0 && imp.novos === 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Nada novo neste arquivo.</strong> Os {imp.repetidos} movimentos já tinham sido importados de {imp.anterior}. O Santander troca o código de cada
            movimento (FITID) a cada download, então o sistema reconhece o repetido pela data, pelo valor, pelo histórico e pela posição entre iguais.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * O arquivo que não é da conta aberta: o de outra conta cadastrada leva à
 * conciliação dela; o de conta nenhuma (ou de conta sem agência e número no
 * cadastro) é recusado. No protótipo, este segundo caso pode seguir como
 * simulação, para testar com os arquivos reais.
 */
export function ArquivoRecusado({ pendente, onSimular, onDescartar, onAbrirOutra }) {
  const { ofx, arquivo, contaReconhecida } = pendente;
  const final4 = (s) => (s ? `••••${s.slice(-4)}` : "—");
  const outra = contaReconhecida ? CONTAS.find((c) => c.id === contaReconhecida) : null;
  return (
    <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {outra ? `${arquivo} é da conta ${outra.nome}, não da California Santander.` : `${arquivo} não é de nenhuma conta cadastrada.`}
      </p>
      <p className="text-xs leading-relaxed">
        {outra
          ? `O extrato é conciliado na conta dele. Abra a conciliação da ${outra.nome} para importar este arquivo.`
          : `O arquivo diz banco ${ofx.bancoId || "—"}, conta ${final4(ofx.conta)}. Nenhuma conta cadastrada tem esse número, ou falta agência e número no cadastro dela. Confira em Cadastros do Financeiro › Contas bancárias e importe de novo.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {outra ? (
          <Botao variante="contorno" onClick={onAbrirOutra}>
            Abrir a conciliação da {outra.nome}
          </Botao>
        ) : (
          <Botao variante="contorno" onClick={onSimular} title="Só no protótipo: no sistema, este arquivo é recusado">
            Só no protótipo: seguir como California Santander
          </Botao>
        )}
        <Botao variante="fantasma" onClick={onDescartar}>
          Descartar o arquivo
        </Botao>
      </div>
    </div>
  );
}

/** O que o sistema tem para a linha do banco, em uma célula. */
function NoSistema({ r, acoes }) {
  if (r.estado === "ja_lancado")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{r.lancamento.descricao}</p>
        <p className="text-[11px] text-muted-foreground">
          Já no Extrato em {dataBR(r.lancamento.data)} · {centroTexto(r.lancamento.centro)?.tipo} · {r.lancamento.centro?.sub}
        </p>
      </div>
    );
  if (r.estado === "soma")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{r.lote.descricao}</p>
        <p className="text-[11px] text-muted-foreground">
          {r.lote.titulos.length} títulos de folha · 05 · Despesa com Pessoal · soma {moeda(r.lote.total)}
        </p>
      </div>
    );
  if (r.estado === "combinacao")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">
          {r.titulos.map((t) => t.ref).join(" + ")} · {r.titulos[0].contraparte}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {r.titulos.length} títulos · {r.titulos.map((t) => moeda(t.liquido)).join(" + ")} · {r.titulos.length > 1 && r.titulos.every((t) => t.vencimento === r.titulos[0].vencimento) ? `vencem ${dataBR(r.titulos[0].vencimento)}` : `vencem ${r.titulos.map((t) => dataBR(t.vencimento).slice(0, 5)).join(", ")}`}
        </p>
      </div>
    );
  if (r.estado === "regra")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">Tarifa bancária · {r.mov.historico.replace(/\s+\S*\d{6,}.*$/, "")}</p>
        <p className="text-[11px] text-muted-foreground">
          Lançamento novo · {r.regra.centro} · {r.regra.empresa}
        </p>
      </div>
    );
  if (r.estado === "par")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{r.mov.valor > 0 ? "Devolução do PIX" : "PIX que voltou"}{r.titulo ? ` · ${r.titulo.ref} · ${r.titulo.contraparte}` : ""}</p>
        <p className="text-[11px] text-muted-foreground">Saída e devolução no mesmo dia: as duas entram no extrato e o título continua a pagar.</p>
      </div>
    );
  if (r.estado === "divergencia")
    return (
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold">{r.lancamento.descricao}</p>
        <p className="truncate text-[11px] font-semibold text-california-red">
          Baixa de {moeda(Math.abs(r.lancamento.valor))} em {dataBR(r.lancamento.data)} · {moeda(Math.abs(r.diferencaBaixa))} {r.diferencaBaixa > 0 ? "a mais" : "a menos"} que o banco
        </p>
      </div>
    );
  if (r.titulo)
    return (
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <OrigemPill t={r.titulo} curta={r.titulo.origem === "pp"} />
          <span className="truncate">{descricaoDoLancamento(r.titulo)}</span>
          <DetalhesDaSugestao t={r.titulo} />
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {r.titulo.contraparte} · vence {dataBR(r.titulo.vencimento)}
          {r.titulo.centro ? ` · ${centroTexto(r.titulo.centro).tipo} · ${r.titulo.centro.sub}` : " · centro de custo na baixa"}
          {r.diferenca ? ` · título de ${moeda(r.titulo.liquido)}` : r.retencaoSugerida ? ` · nota de ${moeda(r.titulo.valor)}, com retenção` : ""}
        </p>
      </div>
    );
  return <p className="text-xs italic text-muted-foreground">{r.motivo}</p>;
}

// ===========================================================================
// Versão pedida: uma tabela do extrato do banco, com o que foi achado
// ===========================================================================

export function AbaBancoPedida({ imp, resultados, onArquivo, onExemplo, onReimportar, acoes, recusado }) {
  const [filtro, setFiltro] = React.useState("todos");
  if (recusado) return recusado;
  if (!imp) return <ZonaDeArquivo onArquivo={onArquivo} onExemplo={onExemplo} />;
  const grupo = (r) =>
    r.resolvido ? "conciliados" : r.estado === "ja_lancado" || r.estado === "divergencia" ? "lancados" : ["sugestao", "soma", "diferenca"].includes(r.estado) ? "encontrados" : "sem";
  const cont = (k) => (k === "todos" ? resultados.length : resultados.filter((r) => grupo(r) === k).length);
  const visiveis = filtro === "todos" ? resultados : resultados.filter((r) => grupo(r) === filtro);
  const encontrados = resultados.filter((r) => !r.resolvido && ["sugestao", "soma"].includes(r.estado) && !(r.titulo && !r.titulo.centro));
  return (
    <div className="space-y-4">
      <CabecalhoDoArquivo imp={imp} />
      <div className="flex flex-wrap items-center gap-2">
        {[
          ["todos", "Todos"],
          ["encontrados", "Encontrados"],
          ["lancados", "Já lançados"],
          ["sem", "Sem correspondência"],
          ["conciliados", "Conciliados"],
        ].map(([k, l]) => (
          <Chip key={k} ativo={filtro === k} onClick={() => setFiltro(k)} label={l} count={cont(k)} />
        ))}
        <div className="ml-auto flex gap-2">
          <Botao variante="contorno" onClick={onReimportar} title="Os dois arquivos que você mandou são o mesmo dia, baixado com 12 segundos de diferença">
            <RotateCcw className="h-4 w-4" />
            Importar o 2º arquivo
          </Botao>
          <Botao variante="verde" disabled={encontrados.length === 0} onClick={() => acoes.conciliarVarios(encontrados)}>
            <CheckCheck className="h-4 w-4" />
            Dar baixa nos {encontrados.length} encontrados
          </Botao>
        </div>
      </div>
      <TabelaDoBanco linhas={visiveis} acoes={acoes} pedida />
      <ZonaDeArquivo onArquivo={onArquivo} compacta />
    </div>
  );
}

/**
 * A tabela do extrato do banco, nas colunas da versão pedida: Data ·
 * Histórico do banco · Crédito · Débito · Situação · No sistema · Ação.
 * A versão alternativa usa a mesma, uma por seção, com o mesmo `colgroup`
 * — as colunas ficam na mesma vertical de uma seção para a outra.
 */
function TabelaDoBanco({ linhas, grupos = [], acoes, pedida, comMotivo, semBorda }) {
  return (
      <div className={cn("overflow-x-auto", semBorda ? "" : "rounded-xl border border-border")}>
        <table className="w-full min-w-[1250px] table-fixed text-sm">
          <colgroup>
            <col style={{ width: 96 }} />
            <col style={{ width: 300 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 172 }} />
            <col />
            <col style={{ width: 228 }} />
          </colgroup>
          <thead className="border-b border-border bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Data</th>
              <th className="px-3 py-2 text-left">Histórico do banco</th>
              <th className="px-3 py-2 text-right">Crédito</th>
              <th className="px-3 py-2 text-right">Débito</th>
              <th className="px-3 py-2 text-left">Situação</th>
              <th className="px-3 py-2 text-left">No sistema</th>
              <th className="px-3 py-2 text-left"><span className="ml-auto block w-[200px] pl-1">Ação</span></th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((g) => (
              <GrupoNaTabela key={`${g.chave}|${g.linhas.map((r) => r.digital).join(",")}`} g={g} acoes={acoes} />
            ))}
            {linhas.map((r) => (
              <tr key={r.digital} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(r.mov.data)}</td>
                <td className="px-3 py-2 font-mono text-[11px]">
                  <span className="block truncate" title={r.mov.historico}>
                    {r.mov.historico}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{r.mov.valor > 0 ? moeda(r.mov.valor) : ""}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{r.mov.valor < 0 ? moeda(-r.mov.valor) : ""}</td>
                <td className="px-3 py-2">
                  <Situacao r={r} />
                </td>
                <td className="px-3 py-2">
                  {r.resolvido ? <p className="truncate text-xs">{r.resolvido.texto}</p> : <NoSistema r={r} acoes={acoes} />}
                  {comMotivo && !r.resolvido && r.motivo && r.estado !== "sem_par" && (
                    <p className="truncate text-[10.5px] text-muted-foreground/80" title={r.motivo}>
                      {r.motivo}
                    </p>
                  )}
                </td>
                <td className="px-3 py-2">
                  <AcoesDaLinha r={r} acoes={acoes} pedida={pedida} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
  );
}

function Situacao({ r }) {
  if (r.resolvido)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
        <CheckCheck className="h-3.5 w-3.5" />
        {r.resolvido.estado === "ignorado" ? "Ignorado" : r.resolvido.sozinho ? "Conciliado sozinho" : "Conciliado"}
      </span>
    );
  const m = {
    sugestao: ["Título encontrado", "text-emerald-700"],
    soma: ["Remessa encontrada", "text-emerald-700"],
    combinacao: [r.confianca === "alta" ? "Soma encontrada" : "Vários títulos", r.confianca === "alta" ? "text-emerald-700" : "text-amber-700"],
    diferenca: ["Valor diferente", "text-amber-700"],
    ja_lancado: ["Já lançado", "text-sky-700"],
    divergencia: ["Baixa diverge", "text-california-red"],
    par: ["Saiu e voltou", "text-violet-700"],
    regra: ["Regra", "text-violet-700"],
    sem_par: ["Sem correspondência", "text-california-red"],
  }[r.estado];
  return <span className={cn("whitespace-nowrap text-xs font-semibold", m[1])}>{m[0]}</span>;
}

/**
 * A célula de ação tem sempre as mesmas três vagas — a ação principal, de
 * largura fixa, e dois ícones (procurar e ignorar) —, ocupadas ou não. Assim
 * os botões ficam numa coluna só, linha após linha, e os ícones também.
 */
function AcoesDaLinha({ r, acoes, pedida }) {
  const base = "inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[11px] font-semibold transition-colors";
  const verde = `${base} bg-emerald-600 text-white hover:bg-emerald-700`;
  const contorno = `${base} border border-border bg-white text-foreground hover:bg-muted`;
  const icone = "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";
  const procurar = (titulo) => (
    <button type="button" title={titulo} aria-label={titulo} onClick={() => acoes.procurar(r)} className={icone}>
      <Search className="h-3.5 w-3.5" />
    </button>
  );
  const ignorar = (
    <button
      type="button"
      title="Ignorar esta linha"
      aria-label="Ignorar esta linha"
      onClick={() => acoes.ignorar(r)}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-california-red hover:bg-california-red/10"
    >
      <CircleSlash className="h-3.5 w-3.5" />
    </button>
  );
  let principal = null;
  let segundo = null;
  let terceiro = null;
  if (r.resolvido) {
    // A linha resolvida diz o que é na Ação; o desfazer fica no ícone.
    principal = (
      <span className={cn(base, r.resolvido.estado === "ignorado" ? "text-muted-foreground" : "text-emerald-700")}>
        <CheckCheck className="h-3 w-3" />
        {r.resolvido.estado === "ignorado" ? "Ignorado" : "Conciliado"}
      </span>
    );
    segundo = (
      <button type="button" title="Desfazer" aria-label="Desfazer" onClick={() => acoes.desfazer(r)} className={icone}>
        <Undo2 className="h-3.5 w-3.5" />
      </button>
    );
  } else if (r.estado === "ja_lancado") {
    principal = (
      <button type="button" onClick={() => acoes.ligar(r)} className={verde}>
        <Link2 className="h-3 w-3" />
        Conciliar
      </button>
    );
  } else if (r.estado === "divergencia") {
    principal = (
      <button type="button" onClick={() => acoes.corrigirBaixa(r)} className={verde} title="Corrige a baixa para o valor do banco e concilia">
        <CheckCheck className="h-3 w-3" />
        Corrigir a baixa
      </button>
    );
    segundo = procurar("Era outro pagamento: procurar o título");
  } else if (r.estado === "sugestao" || r.estado === "diferenca") {
    principal =
      !pedida && r.confianca === "alta" && r.titulo.centro ? (
        // O título ainda não teve baixa: a ação dá a baixa com os dados do
        // banco e já concilia (o "Conciliar" de antes confundia).
        <button type="button" onClick={() => acoes.conciliar(r)} className={verde}>
          <CheckCheck className="h-3 w-3" />
          Baixar e conciliar
        </button>
      ) : (
        <button type="button" onClick={() => acoes.conferir(r)} className={pedida ? verde : contorno}>
          <CheckCheck className="h-3 w-3" />
          {pedida ? "Dar baixa" : "Conferir"}
        </button>
      );
    segundo = procurar("Escolher outro título");
  } else if (r.estado === "combinacao") {
    principal =
      r.confianca === "alta" && r.titulos.every((t) => t.centro) ? (
        <button type="button" onClick={() => acoes.conciliarCombinacao(r)} className={verde}>
          <CheckCheck className="h-3 w-3" />
          Baixar e conciliar os {r.titulos.length}
        </button>
      ) : (
        <button type="button" onClick={() => acoes.conferirCombinacao(r)} className={contorno}>
          <CheckCheck className="h-3 w-3" />
          Conferir os {r.titulos.length}
        </button>
      );
    segundo = procurar("Escolher outros títulos");
  } else if (r.estado === "soma") {
    principal = (
      <button type="button" onClick={() => acoes.conciliarLote(r)} className={verde}>
        <CheckCheck className="h-3 w-3" />
        Baixar os {r.lote.titulos.length}
      </button>
    );
  } else if (r.estado === "par") {
    principal =
      r.mov.valor > 0 ? (
        <button type="button" onClick={() => acoes.conciliarPar(r)} className={verde}>
          <ArrowLeftRight className="h-3 w-3" />
          Registrar as duas
        </button>
      ) : (
        <span className="block text-center text-[10.5px] leading-tight text-muted-foreground">com a devolução</span>
      );
  } else if (r.estado === "regra") {
    principal = (
      <button type="button" onClick={() => acoes.lancarRegra(r)} className={verde}>
        <Wand2 className="h-3 w-3" />
        Lançar
      </button>
    );
    terceiro = ignorar;
  } else {
    principal = (
      <button type="button" onClick={() => acoes.lancarAvulso(r)} className={pedida ? verde : contorno}>
        <Plus className="h-3 w-3" />
        Lançar avulso
      </button>
    );
    segundo = procurar("Procurar um título");
    terceiro = ignorar;
  }
  return (
    <span className="ml-auto grid w-[200px] grid-cols-[136px_28px_28px] items-center gap-1">
      <span>{principal}</span>
      <span>{segundo}</span>
      <span>{terceiro}</span>
    </span>
  );
}

// ===========================================================================
// Versão recomendada: banco × sistema, por grau de certeza
// ===========================================================================

export function AbaBancoRecomendada({ imp, resultados, onArquivo, onExemplo, onReimportar, acoes, saldoSistema, fechada, onFechar, onReabrir, recusado, colunas, naoApareceu = [], fechavelAte, diaEmAndamento, difNoFechamento, onImportarDoDia }) {
  const [abertas, setAbertas] = React.useState({ conciliados: false });
  if (recusado) return recusado;
  if (!imp) return <ZonaDeArquivo onArquivo={onArquivo} onExemplo={onExemplo} />;
  const pend = resultados.filter((r) => !r.resolvido);
  const resolvidos = resultados.filter((r) => r.resolvido);
  // Linhas iguais do banco (mesmo dia, mesmo valor) com títulos empatados
  // viram um grupo só: qual linha fica com qual título não muda o Extrato.
  const grupos = gruposDeIguais(pend);
  const nosGrupos = new Set(grupos.flatMap((g) => g.linhas.map((r) => r.digital)));
  const sec = {
    divergencia: pend.filter((r) => r.estado === "divergencia"),
    // A baixa feita à mão que bate com o banco aparece sempre, conciliada
    // sozinha ou não (Tiago, 21/10/2026).
    manual: resultados.filter((r) => (!r.resolvido && r.estado === "ja_lancado") || r.resolvido?.ligados),
    alta: pend.filter((r) => (r.estado === "sugestao" && r.confianca === "alta" && r.titulo.centro) || (r.estado === "combinacao" && r.confianca === "alta" && r.titulos.every((t) => t.centro))),
    conferir: pend.filter((r) => !nosGrupos.has(r.digital) && ((r.estado === "sugestao" && !(r.confianca === "alta" && r.titulo.centro)) || r.estado === "diferenca")),
    soma: pend.filter((r) => r.estado === "soma" || (r.estado === "combinacao" && !(r.confianca === "alta" && r.titulos.every((t) => t.centro)))),
    par: pend.filter((r) => r.estado === "par"),
    regra: pend.filter((r) => r.estado === "regra"),
    sem: pend.filter((r) => r.estado === "sem_par"),
    conciliados: resolvidos.filter((r) => !r.resolvido.ligados),
  };
  const manuaisPendentes = sec.manual.filter((r) => !r.resolvido);
  const saldoBanco = imp.ofx.saldoBanco;
  const dif = saldoBanco === null || saldoSistema === null ? null : Math.round((saldoBanco - saldoSistema) * 100) / 100;
  const pct = Math.round((resolvidos.length / resultados.length) * 100);
  // O que se resolveu sozinho na importação, por tipo.
  const sozinho = (k) => resolvidos.filter((r) => r.resolvido.sozinho === k).length;
  const sozinhos = resolvidos.filter((r) => r.resolvido.sozinho).length;
  const partes = [
    sozinho("manual") && `${sozinho("manual") === 1 ? "1 baixa feita à mão que bateu" : `${sozinho("manual")} baixas feitas à mão que bateram`} com o banco`,
    sozinho("titulo") && `${sozinho("titulo") === 1 ? "1 título baixado e conciliado" : `${sozinho("titulo")} títulos baixados e conciliados`} (valor exato, pago na data e pela forma previstas, ou o CNPJ do cliente no histórico; com linhas iguais, quando são tantas quanto os títulos desse valor)`,
    sozinho("remessa") && "a remessa da folha, que soma centavo a centavo",
    sozinho("regra") && `${sozinho("regra") === 1 ? "1 tarifa" : `${sozinho("regra")} tarifas`} pela regra do histórico`,
  ].filter(Boolean);
  // O fechamento vai até o último dia completo e confere o que é dele.
  const pendAte = fechavelAte ? pend.filter((r) => r.mov.data <= fechavelAte).length : pend.length;
  const podeFechar = !!fechavelAte && pendAte === 0 && naoApareceu.length === 0 && difNoFechamento === 0 && !fechada;
  const SECOES = [
    ["divergencia", "A baixa feita à mão não bate com o banco", "O sistema já tem a baixa, com outro valor. Corrija para o valor do banco; se a baixa era de outro pagamento, procure o título certo.", "red", null],
    ["manual", "Baixas feitas à mão que bateram com o banco", "A baixa já estava no sistema, e o banco mostra o mesmo valor até 3 dias depois. Conciliar só liga as duas linhas, com a data do banco: nenhuma baixa nova é criada. Na importação elas se conciliam sozinhas e ficam aqui, à vista.", "sky", manuaisPendentes.length > 1 && (
      <Botao variante="verde" onClick={() => acoes.conciliarVarios(manuaisPendentes)}>
        <Link2 className="h-4 w-4" />
        Conciliar as {manuaisPendentes.length}
      </Botao>
    )],
    ["alta", "Prontos: baixar e conciliar", "Títulos ainda sem baixa, com valor exato, forma de pagamento e data batendo, ou a soma única de títulos do mesmo fornecedor ou cliente. Um clique dá a baixa com os dados do banco e já concilia.", "emerald", sec.alta.length > 0 && (
      <Botao variante="verde" onClick={() => acoes.conciliarVarios(sec.alta)}>
        <CheckCheck className="h-4 w-4" />
        Baixar e conciliar os {sec.alta.length}
      </Botao>
    )],
    ["conferir", "Conferir antes", "Mais títulos que linhas com o mesmo valor, diferença de juros, retenção, ou centro de custo a escolher. Linhas iguais em número igual ao de títulos não chegam aqui: cada linha paga um, e se baixam sozinhas.", "amber", sec.conferir.filter((r) => r.titulo?.centro && r.estado === "sugestao").length > 1 && (
      <Botao variante="contorno" onClick={() => acoes.conciliarVarios(sec.conferir.filter((r) => r.titulo?.centro && r.estado === "sugestao"))}>
        Aceitar as {sec.conferir.filter((r) => r.titulo?.centro && r.estado === "sugestao").length} sugestões como estão
      </Botao>
    )],
    ["soma", "Uma linha do banco, vários títulos", "A remessa da folha sai do banco como um débito só e se concilia sozinha. Quando mais de uma soma de títulos do mesmo fornecedor ou cliente bate com a linha, escolha qual.", "emerald", null],
    ["par", "Saiu e voltou", "O banco devolveu o pagamento no mesmo dia. Baixar o título estaria errado: as duas linhas entram no extrato e ele continua a pagar.", "violet", null],
    ["regra", "Pelas regras do histórico", "Tarifas e outros débitos do próprio banco, que nunca têm título. A regra diz o centro de custo.", "violet", sec.regra.length > 0 && (
      <Botao variante="contorno" onClick={() => acoes.lancarVariasRegras(sec.regra)}>
        <Wand2 className="h-4 w-4" />
        Lançar as {sec.regra.length}
      </Botao>
    )],
    ["sem", "Sem correspondência", "Nada no sistema tem esse valor. Lance como avulso (a linha já vem preenchida) ou procure um título.", "red", null],
    ["conciliados", "Conciliados", "Ligados a um lançamento do Extrato. Dá para desfazer até fechar a conciliação.", "neutral", null],
  ];
  return (
    <div className="space-y-4">
      <CabecalhoDoArquivo imp={imp} />
      {sozinhos > 0 && (
        <Nota tom="verde" icone={CheckCheck}>
          <strong>{sozinhos === 1 ? "1 linha do banco se resolveu sozinha" : `${sozinhos} linhas do banco se resolveram sozinhas`}:</strong> {partes.join("; ")}. A baixa feita à mão fica na seção dela, logo abaixo; o resto está em Conciliados. Tudo com Desfazer.
        </Nota>
      )}
      {diaEmAndamento && (
        <Nota tom="ambar" icone={Info}>
          <strong>{dataBR(diaEmAndamento.dia)} ainda está em andamento:</strong> o arquivo foi gerado às {diaEmAndamento.hora} desse dia. As linhas de hoje podem ser conciliadas, mas o dia só entra no fechamento com um extrato gerado depois dele. A baixa feita à mão hoje que ainda não está no banco não é divergência.
        </Nota>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Cartao rotulo={`Saldo no banco · ${dataBR(imp.ofx.saldoEm ?? imp.ofx.fim)}`} valor={saldoBanco === null ? "—" : moeda(saldoBanco)} />
        <Cartao rotulo={`Saldo do sistema · fim de ${dataBR(imp.ofx.fim)}`} valor={saldoSistema === null ? "—" : moeda(saldoSistema)} />
        <Cartao
          rotulo="Diferença"
          valor={dif === null ? "—" : dif === 0 ? "Bate ✓" : moeda(dif)}
          cor={dif === 0 ? "text-emerald-700" : "text-california-red"}
          ajuda={dif === 0 ? "Banco e sistema contam a mesma história." : "Some quando cada linha do banco tiver o seu lançamento."}
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
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="contorno" onClick={onReimportar} title="Os dois arquivos que você mandou são o mesmo dia, baixado com 12 segundos de diferença">
          <RotateCcw className="h-4 w-4" />
          Importar o 2º arquivo
        </Botao>
        {onImportarDoDia && (
          <Botao variante="contorno" onClick={onImportarDoDia} title="Só no protótipo: um extrato de hoje, baixado no meio do dia">
            <FileUp className="h-4 w-4" />
            Importar o extrato de hoje (11:40)
          </Botao>
        )}
        <span className="text-xs text-muted-foreground">As seções somem quando ficam vazias.</span>
        <Botao
          className="ml-auto"
          variante={podeFechar ? "escuro" : "contorno"}
          disabled={!podeFechar}
          title={
            fechada
              ? undefined
              : `Fecha até ${fechavelAte ? dataBR(fechavelAte) : "—"}, o último dia completo dos extratos importados (o dia em que o arquivo foi gerado não conta). Disponível quando as linhas até lá estiverem conciliadas, nenhuma baixa estiver fora do banco e o saldo desse dia bater.`
          }
          onClick={onFechar}
        >
          <Lock className="h-4 w-4" />
          {fechada ? `Conciliação fechada até ${dataBR(fechada)}` : `Fechar a conciliação até ${fechavelAte ? dataBR(fechavelAte) : "—"}`}
        </Botao>
        {fechada && onReabrir && (
          <Botao variante="contornoVermelho" onClick={onReabrir}>
            <Unlock className="h-4 w-4" />
            Reabrir o período
          </Botao>
        )}
      </div>
      {SECOES.map(([k, titulo, ajuda, cor, botao]) => {
        const linhas = sec[k];
        const doGrupo = k === "conferir" ? grupos : [];
        const quantas = linhas.length + doGrupo.reduce((s, g) => s + g.linhas.length, 0);
        if (quantas === 0) return null;
        const aberta = abertas[k] !== false;
        return (
          <section key={k} className="overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-center gap-3 border-b border-border bg-[#f3f2ee] px-4 py-2.5">
              <button type="button" onClick={() => setAbertas((p) => ({ ...p, [k]: !aberta }))} className="inline-flex items-center gap-2 text-left">
                <ChevronDown className={cn("h-4 w-4 transition-transform", !aberta && "-rotate-90")} />
                <span className={cn("h-2 w-2 rounded-full", { emerald: "bg-emerald-500", amber: "bg-amber-500", violet: "bg-violet-500", red: "bg-california-red", sky: "bg-sky-500", neutral: "bg-gray-400" }[cor])} />
                <span className="text-sm font-semibold">{titulo}</span>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{quantas}</span>
              </button>
              <span className="min-w-[200px] flex-1 text-xs text-muted-foreground">{ajuda}</span>
              {botao}
            </header>
            {aberta && !colunas && doGrupo.length > 0 && <TabelaDoBanco linhas={[]} grupos={doGrupo} acoes={acoes} comMotivo semBorda />}
            {aberta &&
              (colunas ? (
                // Alternativa: as seções da recomendada, com as colunas da pedida.
                <TabelaDoBanco linhas={linhas} grupos={doGrupo} acoes={acoes} comMotivo semBorda />
              ) : (
                <div className="divide-y divide-border">
                  {linhas.map((r) => (
                    <LinhaBancoSistema key={r.digital} r={r} acoes={acoes} />
                  ))}
                </div>
              ))}
          </section>
        );
      })}
      {naoApareceu.length > 0 && <SemLinhaNoBanco lancs={naoApareceu} acoes={acoes} fim={imp.ofx.fim} />}
      <ZonaDeArquivo onArquivo={onArquivo} compacta />
    </div>
  );
}

/**
 * O lado do sistema: baixas feitas à mão, com data dentro do extrato
 * importado, que não têm linha no banco. Pagas em outra conta, com a data
 * errada ou não pagas: a conciliação não fecha até cada uma ser resolvida.
 * Mesmas colunas da tabela do banco, para alinhar com as seções de cima.
 */
function SemLinhaNoBanco({ lancs, acoes, fim }) {
  return (
    <section className="overflow-hidden rounded-xl border border-red-200 bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50/60 px-4 py-2.5">
        <span className="inline-flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-california-red" />
          <span className="text-sm font-semibold">Baixa no sistema, sem linha no banco</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold tabular-nums">{lancs.length}</span>
        </span>
        <span className="min-w-[200px] flex-1 text-xs text-muted-foreground">
          Baixas feitas à mão até {dataBR(fim)} que o banco não mostra: pagas em outra conta, com a data errada, ou não pagas. Corrija a baixa ou cancele-a; até lá, a conciliação não fecha.
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1250px] table-fixed text-sm">
          <colgroup>
            <col style={{ width: 96 }} />
            <col style={{ width: 300 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 120 }} />
            <col style={{ width: 172 }} />
            <col />
            <col style={{ width: 228 }} />
          </colgroup>
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
                <td className="px-3 py-2 text-[11px] text-muted-foreground">Baixa feita à mão no Extrato desta conta. O banco não tem débito de {moeda(Math.abs(l.valor))} entre as linhas importadas.</td>
                <td className="px-3 py-2">
                  <span className="ml-auto grid w-[200px] grid-cols-[136px_28px_28px] items-center gap-1">
                    <button
                      type="button"
                      onClick={() => acoes.cancelarBaixa(l)}
                      className="inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-california-red/40 bg-white px-2 text-[11px] font-semibold text-california-red hover:bg-california-red/5"
                    >
                      <Undo2 className="h-3 w-3" />
                      Cancelar a baixa
                    </button>
                    <button
                      type="button"
                      title="Corrigir a conta ou a data da baixa"
                      onClick={() => acoes.corrigirLancamento(l)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Search className="h-3.5 w-3.5" />
                    </button>
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

// ===========================================================================
// O fechamento da conciliação: a faixa no topo e o reabrir
// ===========================================================================

/**
 * A faixa do fechamento, no topo das três abas da conciliação. Duas regras
 * para comparar (barra do protótipo):
 *   "trava"    — o período fica travado: baixa, cancelamento, estorno e troca
 *                de centro de custo com data até o fechamento pedem reabrir;
 *   "registra" — só marca até onde a conta foi conferida com o banco; o que
 *                mudar depois aparece como alterado depois do fechamento.
 */
export function BannerDoFechamento({ fechamento, modo, onReabrir, onFecharDeNovo }) {
  if (!fechamento) return null;
  const historico = fechamento.historico ?? [];
  const linhaDoHistorico = historico.map((h) => (h.tipo === "fechou" ? `fechada até ${dataBR(h.ate).slice(0, 5)} em ${dataBR(h.em)}` : `reaberta em ${dataBR(h.em)}`)).join(" · ");
  if (!fechamento.ativo) {
    const ultima = [...historico].reverse().find((h) => h.tipo === "reabriu");
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <Unlock className="h-4 w-4 shrink-0" />
        <span className="min-w-[280px] flex-1">
          <strong>Período reaberto</strong> em {dataBR(ultima?.em)} por você: “{ultima?.motivo}”. Os lançamentos até {dataBR(fechamento.ate)} voltaram a poder mudar. Feche de novo quando terminar.
          <span className="mt-0.5 block text-amber-800/70">Histórico: {linhaDoHistorico}</span>
        </span>
        {onFecharDeNovo && (
          <Botao variante="escuro" onClick={onFecharDeNovo}>
            <Lock className="h-4 w-4" />
            Fechar de novo até {dataBR(fechamento.ate)}
          </Botao>
        )}
      </div>
    );
  }
  return (
    <div className={cn("flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-xs", modo === "trava" ? "border-slate-300 bg-slate-100 text-slate-800" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>
      {modo === "trava" ? <Lock className="h-4 w-4 shrink-0" /> : <CheckCheck className="h-4 w-4 shrink-0" />}
      <span className="min-w-[280px] flex-1">
        {modo === "trava" ? (
          <>
            <strong>Conciliação fechada até {dataBR(fechamento.ate)}</strong> · por você em {dataBR(fechamento.em)}. O caixa desta conta até essa data não muda (o Extrato e o DFC): baixa, cancelamento, estorno e troca de data ou de centro de custo pedem reabrir o período. O DRE, por competência, tem fechamento próprio.
          </>
        ) : (
          <>
            <strong>Conciliada até {dataBR(fechamento.ate)}</strong> · por você em {dataBR(fechamento.em)}. Só registro: os lançamentos continuam editáveis, e o que mudar com data até lá fica marcado como alterado depois do fechamento.
          </>
        )}
        {historico.length > 1 && <span className="mt-0.5 block opacity-70">Histórico: {linhaDoHistorico}</span>}
      </span>
      {modo === "trava" && onReabrir && (
        <Botao variante="contornoVermelho" onClick={onReabrir}>
          <Unlock className="h-4 w-4" />
          Reabrir o período
        </Botao>
      )}
    </div>
  );
}

export function ReabrirDialog({ fechamento, onFechar, onConfirmar }) {
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState(null);
  return (
    <Dialogo
      aberto
      onFechar={onFechar}
      titulo={`Reabrir a conciliação até ${dataBR(fechamento.ate)}`}
      icone={Unlock}
      largura={560}
      descricao="California Santander · Santander"
      rodape={
        <>
          {erro && <span className="mr-auto text-xs font-semibold text-california-red">{erro}</span>}
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao
            onClick={() => {
              if (motivo.trim().length < 10) return setErro("Explique o motivo (pelo menos 10 caracteres).");
              onConfirmar(motivo.trim());
            }}
          >
            Reabrir o período
          </Botao>
        </>
      }
    >
      <Nota tom="ambar">
        Os lançamentos desta conta até {dataBR(fechamento.ate)} voltam a aceitar baixa, cancelamento, estorno e troca de data ou de centro de custo. A conciliação precisa ser fechada de novo. A reabertura, com o motivo, fica registrada na auditoria.
      </Nota>
      <Campo label="Motivo" obrigatorio>
        <textarea
          id="reabrir-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="Ex.: a baixa do frete de 19/10 foi feita na conta errada"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
        />
      </Campo>
    </Dialogo>
  );
}

/**
 * As linhas iguais do banco (mesmo dia, mesmo valor) e os títulos com esse
 * valor. O banco não diz quem recebeu cada PIX, mas as linhas são idênticas:
 * qual fica com qual título não muda o Extrato. Vêm marcados os títulos que
 * o motor escolheu, um por linha; os outros com o mesmo valor ficam
 * desmarcados, para trocar.
 */
export function gruposDeIguais(pend) {
  const por = new Map();
  pend.forEach((r) => {
    if (r.estado !== "sugestao" || !r.empate) return;
    const k = `${r.mov.data}|${Math.round(r.mov.valor * 100)}`;
    por.set(k, [...(por.get(k) ?? []), r]);
  });
  const atribuidos = new Set(pend.map((r) => r.titulo?.id).filter(Boolean));
  return [...por.entries()].map(([chave, linhas]) => {
    const marcados = linhas.map((r) => r.titulo);
    const vistos = new Set(marcados.map((t) => t.id));
    const outros = [];
    linhas.forEach((r) =>
      r.candidatos.forEach(({ t }) => {
        if (vistos.has(t.id) || atribuidos.has(t.id)) return;
        vistos.add(t.id);
        outros.push(t);
      }),
    );
    const porData = (a, b) => a.vencimento.localeCompare(b.vencimento) || a.ref.localeCompare(b.ref);
    return { chave, linhas, titulos: [...[...marcados].sort(porData), ...outros.sort(porData)], marcados: marcados.map((t) => t.id) };
  });
}

/**
 * O grupo de linhas iguais dentro da tabela do banco: uma faixa com o que o
 * grupo é e o botão de todas, e cada linha do banco com as mesmas colunas
 * das outras (o valor à vista no Débito ou no Crédito) e o título escolhido
 * para ela, que se troca por outro do grupo.
 */
function GrupoNaTabela({ g, acoes }) {
  const linhas = [...g.linhas].sort((a, b) => a.mov.ordem - b.mov.ordem);
  const [escolha, setEscolha] = React.useState(() => Object.fromEntries(linhas.map((r) => [r.digital, r.titulo.id])));
  const porId = new Map(g.titulos.map((t) => [t.id, t]));
  const escolhidos = linhas.map((r) => porId.get(escolha[r.digital]));
  const sobram = g.titulos.filter((t) => !Object.values(escolha).includes(t.id));
  const semCentro = escolhidos.filter((t) => !t.centro);
  // Trocar por um título de outra linha troca os dois de lugar.
  const trocar = (digital, id) =>
    setEscolha((e) => {
      const outra = Object.keys(e).find((k) => k !== digital && e[k] === id);
      return outra ? { ...e, [digital]: id, [outra]: e[digital] } : { ...e, [digital]: id };
    });
  const n = linhas.length;
  const m = g.titulos.length;
  const valor = moeda(Math.abs(linhas[0].mov.valor));
  const aPagar = linhas[0].mov.valor < 0 ? "a pagar" : "a receber";
  const botao = "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-emerald-600 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50";
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
            {n > 1 && (
              <button
                type="button"
                disabled={semCentro.length > 0}
                title={semCentro.length ? `Sem centro de custo: ${semCentro.map((t) => t.ref).join(", ")}. Baixe pela linha.` : undefined}
                onClick={() => acoes.conciliarGrupo({ linhas }, escolhidos, {})}
                className={botao}
              >
                <CheckCheck className="h-3 w-3" />
                Baixar e conciliar as {n}
              </button>
            )}
          </div>
        </td>
      </tr>
      {linhas.map((r, i) => {
        const t = porId.get(escolha[r.digital]);
        const dias = Math.round((Date.parse(r.mov.data) - Date.parse(t.vencimento)) / 86400000);
        return (
          <tr key={r.digital} className="border-b border-border">
            <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{dataBR(r.mov.data)}</td>
            <td className="px-3 py-2 font-mono text-[11px]">
              <span className="block truncate" title={r.mov.historico}>
                {r.mov.historico}
              </span>
            </td>
            <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-emerald-700">{r.mov.valor > 0 ? moeda(r.mov.valor) : ""}</td>
            <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs text-california-red">{r.mov.valor < 0 ? moeda(-r.mov.valor) : ""}</td>
            <td className="px-3 py-2">
              <span className="whitespace-nowrap text-xs font-semibold text-amber-700">{n === 1 ? "Mesmo valor" : `Linha ${i + 1} de ${n}`}</span>
            </td>
            <td className="px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <OrigemPill t={t} curta={t.origem === "pp"} />
                    <span className="truncate">{descricaoDoLancamento(t)}</span>
                    <DetalhesDaSugestao t={t} />
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {t.contraparte} · vence {dataBR(t.vencimento)}
                    {dias !== 0 && <span className="text-amber-700"> (o banco pagou {Math.abs(dias)} {Math.abs(dias) === 1 ? "dia" : "dias"} {dias > 0 ? "depois" : "antes"})</span>}
                    {t.centro ? ` · ${centroTexto(t.centro).tipo} · ${t.centro.sub}` : " · centro de custo na baixa"}
                  </p>
                </div>
                <select
                  aria-label="Trocar o título desta linha"
                  value=""
                  onChange={(e) => e.target.value && trocar(r.digital, e.target.value)}
                  className="h-7 w-[92px] shrink-0 rounded-md border border-border bg-white px-1.5 text-[11px] font-semibold text-muted-foreground hover:border-california-red/50"
                >
                  <option value="">Trocar…</option>
                  {g.titulos
                    .filter((x) => x.id !== t.id)
                    .map((x) => {
                      const deOutra = Object.entries(escolha).some(([k, id]) => k !== r.digital && id === x.id);
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
                <span>
                  <button
                    type="button"
                    onClick={() => (t.centro ? acoes.conciliarGrupo({ linhas: [r] }, [t], {}) : acoes.conferirTitulo(r, t))}
                    className="inline-flex h-7 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-white px-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
                  >
                    <CheckCheck className="h-3 w-3" />
                    {t.centro ? "Baixar e conciliar" : "Conferir"}
                  </button>
                </span>
                <span>
                  <button type="button" title="Procurar outro título" aria-label="Procurar outro título" onClick={() => acoes.procurar(r)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Search className="h-3.5 w-3.5" />
                  </button>
                </span>
                <span />
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}

/** A baixa feita à mão que não bate com o banco: mostra o que muda, pede o
 *  motivo e só então corrige e concilia. A correção fica no histórico do
 *  lançamento (o ⓘ do Extrato) e na auditoria. */
export function CorrigirBaixaDialog({ r, titulo, onFechar, onConfirmar }) {
  const [motivo, setMotivo] = React.useState("");
  const [erro, setErro] = React.useState(null);
  const l = r.lancamento;
  const { antes, depois } = correcaoDaBaixa(l, r.mov, titulo);
  const linhas = [
    ["Data do pagamento", dataBR(antes.data), dataBR(depois.data), antes.data !== depois.data],
    ["Valor do título", moeda(antes.principal), moeda(depois.principal), antes.principal !== depois.principal],
    ["Juros e multa", moeda(antes.juros), moeda(depois.juros), antes.juros !== depois.juros],
    [l.valor < 0 ? "Total que saiu da conta" : "Total que entrou na conta", moeda(antes.total), moeda(depois.total), antes.total !== depois.total],
  ];
  const sugestoes = [
    depois.juros < antes.juros && "O banco não cobrou os juros lançados na baixa",
    depois.juros > antes.juros && "O banco cobrou juros e multa que não estavam na baixa",
    depois.principal !== antes.principal && "O valor foi digitado errado na baixa",
    antes.data !== depois.data && "A data da baixa não era a do pagamento",
  ].filter(Boolean);
  return (
    <Dialogo
      aberto
      onFechar={onFechar}
      titulo="Corrigir a baixa"
      icone={CheckCheck}
      largura={600}
      descricao={`${l.descricao}${l.fornecedor ? ` · ${l.fornecedor}` : ""}`}
      rodape={
        <>
          {erro && <span className="mr-auto text-xs font-semibold text-california-red">{erro}</span>}
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao
            variante="verde"
            onClick={() => {
              if (motivo.trim().length < 10) return setErro("Registre o motivo da correção (pelo menos 10 caracteres).");
              onConfirmar(motivo.trim());
            }}
          >
            <CheckCheck className="h-4 w-4" />
            Corrigir e conciliar
          </Botao>
        </>
      }
    >
      <p className="text-[12.5px] text-muted-foreground">
        No extrato do banco: <span className="font-mono">{dataBR(r.mov.data)} · {r.mov.historico.replace(/\s{2,}.*$/, "")} · {moeda(Math.abs(r.mov.valor))}</span>
      </p>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full table-fixed text-[12.5px]">
          <colgroup>
            <col />
            <col className="w-[150px]" />
            <col className="w-[170px]" />
          </colgroup>
          <thead className="bg-muted/60 text-[10.5px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold" />
              <th className="px-3 py-2 text-right font-semibold">Baixa registrada</th>
              <th className="px-3 py-2 text-right font-semibold">Fica (como no banco)</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(([rotulo, de, para, muda]) => (
              <tr key={rotulo} className="border-t border-border">
                <td className="px-3 py-2">{rotulo}</td>
                <td className={cn("px-3 py-2 text-right font-mono", muda && "text-muted-foreground line-through")}>{de}</td>
                <td className={cn("px-3 py-2 text-right", muda ? "font-mono font-bold text-foreground" : "text-[11.5px] text-muted-foreground")}>{muda ? para : "sem mudança"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {antes.juros !== depois.juros && (
        <p className="text-[11.5px] text-muted-foreground">
          {depois.juros < antes.juros
            ? `Saem ${moeda(r2s(antes.juros - depois.juros))} de 11 · Despesa com Juros.`
            : `Entram ${moeda(r2s(depois.juros - antes.juros))} em 11 · Despesa com Juros.`}
        </p>
      )}
      <Campo label="Motivo da correção" obrigatorio ajuda="Fica no histórico do lançamento (o ⓘ do Extrato) e na auditoria, com a data e quem corrigiu.">
        <textarea
          id="corrigir-motivo"
          value={motivo}
          onChange={(e) => {
            setMotivo(e.target.value);
            setErro(null);
          }}
          rows={2}
          placeholder="Ex.: o banco não cobrou os juros lançados na baixa"
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-california-red focus:outline-none"
        />
      </Campo>
      {sugestoes.length > 0 && (
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {sugestoes.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setMotivo(s);
                setErro(null);
              }}
              className="rounded-full border border-border bg-white px-2.5 py-1 text-[11.5px] text-muted-foreground hover:border-california-red hover:text-california-red"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <Nota tom="neutro">
        Ao confirmar, a baixa passa a ter o valor e a data do banco e fica conciliada. O lançamento continua o mesmo, não nasce outro. Dá para desfazer em Conciliados até fechar a conciliação; o desfazer também fica no histórico.
      </Nota>
    </Dialogo>
  );
}

const r2s = (n) => Math.round(n * 100) / 100;

function Cartao({ rotulo, valor, cor, ajuda }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{rotulo}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", cor)}>{valor}</p>
      {ajuda && <p className="text-[11px] text-muted-foreground">{ajuda}</p>}
    </div>
  );
}

function LinhaBancoSistema({ r, acoes }) {
  const conf = r.resolvido ? null : CONF[r.confianca];
  return (
    <div className="grid items-center gap-3 px-4 py-2.5 md:grid-cols-[minmax(0,330px)_96px_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <span className="font-mono text-xs text-muted-foreground">{dataBR(r.mov.data).slice(0, 5)}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[11px]" title={r.mov.historico}>
            {r.mov.historico}
          </span>
          <span className="text-[10px] text-muted-foreground">doc. {r.mov.documento || "—"}</span>
        </span>
        <span className={cn("whitespace-nowrap font-mono text-xs font-semibold", r.mov.valor > 0 ? "text-emerald-700" : "text-california-red")}>
          {r.mov.valor > 0 ? "+ " : "− "}
          {moeda(Math.abs(r.mov.valor))}
        </span>
      </div>
      <div className="flex justify-center">
        {r.resolvido ? (
          <CheckCheck className="h-4 w-4 text-emerald-600" />
        ) : (
          <span title={r.motivo} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase", conf ? conf[1] : "border-red-200 bg-red-50 text-[#b3323c]")}>
            {conf ? conf[0] : "Nada"}
          </span>
        )}
      </div>
      <div className="min-w-0">
        {r.resolvido ? <p className="truncate text-xs">{r.resolvido.texto}</p> : <NoSistema r={r} acoes={acoes} />}
        {!r.resolvido && r.motivo && r.estado !== "sem_par" && <p className="truncate text-[10.5px] text-muted-foreground/80">{r.motivo}</p>}
      </div>
      <div className="flex justify-end">
        <AcoesDaLinha r={r} acoes={acoes} />
      </div>
    </div>
  );
}

// ===========================================================================
// Procurar título para uma linha do banco
// ===========================================================================

/**
 * Escolher o título de uma linha do banco quando a sugestão não serve (ou
 * não há). A lista vem pela proximidade do valor, com a diferença à vista
 * (Tiago, 21/10/2026), e cada título diz o que a diferença vira. O valor da
 * baixa vem sempre do banco:
 *  - título maior: retenção na fonte, quando a diferença bate com as
 *    alíquotas de sempre e o título não tem retenção da aprovação; senão,
 *    baixa parcial;
 *  - título menor: juros e multa no boleto (até 3%) e na guia (até 25%),
 *    as regras da conciliação automática; senão, só somando com outros.
 */
export function ProcurarTitulo({ r, titulos, onEscolher, onFechar }) {
  const [busca, setBusca] = React.useState("");
  const [marcados, setMarcados] = React.useState([]);
  if (!r) return null;
  const alvo = Math.abs(r.mov.valor);
  const paga = r.mov.valor < 0;
  const formaBanco = formaDoHistorico(r.mov.historico);
  const base = titulos.filter((t) => !t.pagoEm && (paga ? !t.entra && t.lado !== "receber" : t.entra || t.lado === "receber"));
  const pertoDaData = (a, b) => Math.abs(Date.parse(a.vencimento) - Date.parse(r.mov.data)) - Math.abs(Date.parse(b.vencimento) - Date.parse(r.mov.data));
  const lista = base
    .filter((t) => !busca || `${t.titulo} ${t.contraparte} ${t.ref}`.toLowerCase().includes(busca.toLowerCase()))
    .sort((a, b) => Math.abs(aberto(a) - alvo) - Math.abs(aberto(b) - alvo) || pertoDaData(a, b))
    .slice(0, 15);
  // Os marcados continuam na lista mesmo quando a busca muda.
  const escolhidos = base.filter((t) => marcados.includes(t.id));
  const visiveis = [...escolhidos.filter((t) => !lista.includes(t)), ...lista];
  const soma = r2(escolhidos.reduce((s, t) => s + aberto(t), 0));
  const sozinho = (t) => {
    const d = r2(aberto(t) - alvo);
    if (d === 0) return { ok: true, tom: "text-emerald-700", texto: "valor exato" };
    if (d > 0) {
      const ret = retencaoQueExplica(t, alvo);
      if (ret) return { ok: true, tom: "text-amber-700", texto: `retenção na fonte: ${ret.nome}`, retencao: ret.retidos };
      return { ok: true, tom: "text-amber-700", texto: `baixa parcial · ficam ${moeda(d)} ${paga ? "a pagar" : "a receber"}` };
    }
    const aMais = -d;
    const juros =
      paga &&
      formaBanco === "boleto" &&
      ((t.lado === "imposto" && aMais <= aberto(t) * 0.25) || (t.forma === "boleto" && t.origem !== "fatura" && aMais <= aberto(t) * 0.03));
    if (juros) return { ok: true, tom: "text-amber-700", texto: "juros e multa" };
    return { ok: false, tom: "text-muted-foreground", texto: "sozinho não fecha: some com outro" };
  };
  const alternar = (id) => setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  let rodape;
  let pode = false;
  let retencao = null;
  if (escolhidos.length === 0) rodape = <span className="text-muted-foreground">Marque o título desta linha, ou mais de um que some {moeda(alvo)}.</span>;
  else if (escolhidos.length === 1) {
    const s = sozinho(escolhidos[0]);
    pode = s.ok;
    retencao = s.retencao ?? null;
    rodape = s.ok ? (
      <span className="text-muted-foreground">
        {escolhidos[0].ref}: {s.texto}.
      </span>
    ) : (
      <span className="font-semibold text-california-red">
        O banco {paga ? "pagou" : "recebeu"} {moeda(r2(alvo - aberto(escolhidos[0])))} a mais que {escolhidos[0].ref}, e a diferença não é juros de boleto ou de guia: não é este título, ou a linha {paga ? "paga" : "recebe"} mais de um. Marque os outros.
      </span>
    );
  } else {
    const d = r2(alvo - soma);
    pode = d === 0;
    rodape = pode ? (
      <span className="text-muted-foreground">A soma dos {escolhidos.length} bate com a linha do banco.</span>
    ) : (
      <span className="font-semibold text-amber-800">
        Soma {moeda(soma)} de {moeda(alvo)}: {d > 0 ? `faltam ${moeda(d)}` : `passa ${moeda(-d)}`}. Com mais de um título, a soma tem de bater centavo a centavo.
      </span>
    );
  }
  return (
    <div className="fixed inset-0 z-[1100] flex items-start justify-center bg-black/40 p-4 pt-[8vh]" onMouseDown={onFechar}>
      <div className="w-full max-w-[780px] rounded-2xl border border-border bg-white shadow-elevated" onMouseDown={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">Escolher o título desta linha</h2>
          <p className="font-mono text-xs text-muted-foreground">
            {dataBR(r.mov.data)} · {r.mov.historico.replace(/\s{2,}.*$/, "")} · {moeda(alvo)}
          </p>
        </div>
        <div className="space-y-3 px-6 py-4">
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título, fornecedor ou PP..."
            className="h-9 w-full rounded-lg border border-border px-3 text-sm focus:border-california-red focus:outline-none"
          />
          <p className="text-[11.5px] text-muted-foreground">O valor mais perto do da linha primeiro, com a diferença ao lado. Dá para marcar mais de um título, quando a linha paga vários.</p>
          {visiveis.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">Nenhum título em aberto com essa busca.</p>
          ) : (
            <div className="max-h-[46vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {visiveis.map((t) => {
                const marcado = marcados.includes(t.id);
                const s = sozinho(t);
                const d = r2(aberto(t) - alvo);
                return (
                  <button key={t.id} type="button" onClick={() => alternar(t.id)} className={cn("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50", marcado && "bg-california-red/[0.04]")}>
                    <span
                      role="checkbox"
                      aria-checked={marcado}
                      className={cn("inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border", marcado ? "border-california-red bg-california-red text-white" : "border-gray-300 bg-white")}
                    >
                      {marcado && <CheckCheck className="h-3 w-3" strokeWidth={3} />}
                    </span>
                    <OrigemPill t={t} curta={t.origem === "pp"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{descricaoDoLancamento(t)}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {t.contraparte} · vence {dataBR(t.vencimento)}
                      </span>
                    </span>
                    <span className="w-[104px] text-right font-mono text-xs">{moeda(aberto(t))}</span>
                    <span className="flex w-[190px] flex-col items-end gap-0.5">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-mono text-[11px] font-bold",
                          d === 0 ? "bg-emerald-100 text-emerald-800" : s.ok ? "bg-amber-100 text-amber-900" : "bg-gray-100 text-gray-700",
                        )}
                      >
                        {d === 0 ? "= linha" : `${d > 0 ? "+" : "−"} ${moeda(Math.abs(d))}`}
                      </span>
                      <span className={cn("text-right text-[10.5px] leading-tight", s.tom)}>{s.texto}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-6 py-3 text-[12px]">
          <span className="min-w-[260px] flex-1">{rodape}</span>
          <Botao variante="contorno" onClick={onFechar}>
            Cancelar
          </Botao>
          <Botao variante="verde" disabled={!pode} onClick={() => onEscolher(escolhidos, retencao)}>
            {escolhidos.length > 1 ? `Abrir a baixa dos ${escolhidos.length}` : "Abrir a baixa"}
          </Botao>
        </div>
      </div>
    </div>
  );
}
