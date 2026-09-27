import * as React from "react";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoriaModeloPlanilha } from "@/lib/types";
import { ORCADO, PLANEJADO } from "@/app/(app)/_planilha/blocos";

/**
 * "Como a planilha precisa estar" — o desenho do formato no passo do
 * arquivo (decisão 110, design 2A). Um trecho da planilha com as letras das
 * colunas do Excel: o que o ERP lê fica normal, o que é calculado fica em
 * cinza e o que ele ignora fica hachurado. Os marcadores numerados apontam
 * as quatro regras que mais dão erro, escritas embaixo.
 *
 * Um desenho por modelo (decisão 110, D8): nacional, internacional e
 * mensal; no serviço Interno a coluna de tipo aparece como ignorada.
 */

type Papel = "lido" | "calc" | "ign";

const HACHURA =
  "bg-[repeating-linear-gradient(135deg,#f3f3f3_0px,#f3f3f3_4px,#e7e7e7_4px,#e7e7e7_8px)]";
const CEL = "border-b border-r border-[#e2e2e2] px-2 py-2 whitespace-nowrap overflow-hidden";
const NUMERO_LINHA = "border-b border-r border-[#e2e2e2] bg-[#f3f3f3] text-center text-[10px] text-[#8a8a8a]";

function classeDoPapel(papel: Papel, alinhamento: "esq" | "dir" | "centro" = "dir"): string {
  const alinhar =
    alinhamento === "esq" ? "text-left" : alinhamento === "centro" ? "text-center" : "text-right tabular-nums";
  if (papel === "calc") return cn(CEL, alinhar, "italic text-[#a3a3a3]");
  if (papel === "ign") return cn(CEL, HACHURA);
  return cn(CEL, alinhar);
}

function Marca({ n }: { n: number }) {
  return (
    <span className="mr-1 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full bg-california-red align-middle text-[9px] font-bold text-white">
      {n}
    </span>
  );
}

/** Faixa de bloco (ORÇAMENTO, PLANEJADO), com a cor do bloco. */
const FAIXA_ORCADO = cn(ORCADO.faixa, "py-1 text-center text-[10px] font-bold uppercase tracking-wider");
const FAIXA_PLANEJADO = cn(PLANEJADO.faixa, "py-1 text-center text-[10px] font-bold uppercase tracking-wider");
const CAB_ORCADO = cn(CEL, ORCADO.cabecalhoMeio, "text-right");
const CAB_PLANEJADO = cn(CEL, PLANEJADO.cabecalhoMeio, "text-right");

function LinhaDeLetras({ letras }: { letras: string[] }) {
  return (
    <tr>
      <td className={cn(NUMERO_LINHA, "py-0.5 font-semibold")} />
      {letras.map((l) => (
        <td key={l} className={cn(NUMERO_LINHA, "py-0.5 font-semibold")}>
          {l}
        </td>
      ))}
    </tr>
  );
}

// ---------- nacional (e Interno) ----------

function PlanilhaNacional({ interno, mensal }: { interno: boolean; mensal: boolean }) {
  const pesos = [32, 220, 230, 84, 56, 60, 84, 56, 84, 56, 60, 84, 76, 150];
  const tipo: Papel = interno ? "ign" : "lido";
  const item = (lin: number, cat: string, nome: string, v: string[]) => (
    <tr key={lin}>
      <td className={NUMERO_LINHA}>{lin}</td>
      <td className={cn(classeDoPapel("lido", "esq"), "font-medium")}>{cat}</td>
      <td className={classeDoPapel("lido", "esq")}>{nome}</td>
      <td className={classeDoPapel("lido")}>{v[0]}</td>
      <td className={classeDoPapel("lido")}>{v[1]}</td>
      <td className={classeDoPapel("lido")}>{v[2]}</td>
      <td className={classeDoPapel("calc")}>{v[3]}</td>
      <td className={cn(classeDoPapel(tipo, "centro"), "font-semibold")}>{interno ? "" : "B"}</td>
      <td className={classeDoPapel("lido")}>{v[4]}</td>
      <td className={classeDoPapel("lido")}>{v[5]}</td>
      <td className={classeDoPapel("lido")}>{v[6]}</td>
      <td className={classeDoPapel("calc")}>{v[7]}</td>
      <td className={classeDoPapel("calc")}>{v[8]}</td>
      <td className={classeDoPapel("ign")} />
    </tr>
  );
  const cabecalho = (lin: number) => (
    <tr key={`cab-${lin}`} className="font-semibold">
      <td className={NUMERO_LINHA}>{lin}</td>
      <td className={classeDoPapel("lido", "esq")}>
        <Marca n={mensal ? 2 : 1} />
        CATEGORIA
      </td>
      <td className={classeDoPapel("lido", "esq")}>{!mensal && <Marca n={2} />}ITEM</td>
      <td className={CAB_ORCADO}>R$</td>
      <td className={CAB_ORCADO}>QT</td>
      <td className={CAB_ORCADO}>D/M</td>
      <td className={cn(CAB_ORCADO, "italic text-[#a3a3a3]")}>TT</td>
      <td className={cn(interno ? classeDoPapel("ign", "centro") : classeDoPapel("lido", "centro"))}>
        <Marca n={3} />
        {interno ? "" : "TIPO"}
      </td>
      <td className={CAB_PLANEJADO}>R$</td>
      <td className={CAB_PLANEJADO}>QT</td>
      <td className={CAB_PLANEJADO}>D/M</td>
      <td className={cn(CAB_PLANEJADO, "italic text-[#a3a3a3]")}>TT</td>
      <td className={cn(CAB_PLANEJADO, "italic text-[#a3a3a3]")}>RENTA</td>
      <td className={classeDoPapel("ign")} />
    </tr>
  );
  const faixas = (lin: number) => (
    <tr key={`faixa-${lin}`}>
      <td className={NUMERO_LINHA}>{lin}</td>
      <td className={CEL} />
      <td className={CEL} />
      <td colSpan={4} className={FAIXA_ORCADO}>
        Orçamento
      </td>
      <td className={CEL} />
      <td colSpan={5} className={FAIXA_PLANEJADO}>
        Planejado · opcional
      </td>
      <td className={cn(classeDoPapel("ign"), "text-center text-[9px] font-semibold uppercase text-[#8a8a8a]")}>
        Realizado
      </td>
    </tr>
  );
  const ignorada = (lin: number, rotulo: string, valor: string, marca?: number) => (
    <tr key={`ign-${lin}`}>
      <td className={NUMERO_LINHA}>{lin}</td>
      <td className={classeDoPapel("ign")} />
      <td className={classeDoPapel("ign")} />
      <td colSpan={3} className={cn(classeDoPapel("ign"), "text-center font-semibold text-[#8a8a8a]")}>
        {marca && <Marca n={marca} />}
        {rotulo}
      </td>
      <td className={cn(classeDoPapel("ign"), "text-right tabular-nums text-[#8a8a8a]")}>{valor}</td>
      <td colSpan={7} className={classeDoPapel("ign")} />
    </tr>
  );
  const tituloDoMes = (lin: number, mes: string) => (
    <tr key={`mes-${lin}`}>
      <td className={NUMERO_LINHA}>{lin}</td>
      <td colSpan={13} className={cn(CEL, "bg-[#fafafa] font-bold uppercase tracking-wide")}>
        <Marca n={1} />
        {mes}
      </td>
    </tr>
  );

  const linhas = mensal
    ? [
        faixas(1),
        tituloDoMes(2, "Outubro de 2026"),
        cabecalho(3),
        item(4, "EQUIPE", "Coordenador", ["12.000", "1", "1", "12.000", "10.000", "1", "1", "10.000", "2.000"]),
        item(5, "MÍDIA", "Gestão de tráfego", ["4.500", "1", "1", "4.500", "3.800", "1", "1", "3.800", "700"]),
        ignorada(6, "FATURAMENTO DE OUTUBRO", "18.953", 4),
        tituloDoMes(7, "Novembro de 2026"),
        cabecalho(8),
        item(9, "EQUIPE", "Coordenador", ["12.000", "1", "1", "12.000", "10.000", "1", "1", "10.000", "2.000"]),
      ]
    : [
        faixas(1),
        cabecalho(2),
        item(3, "EQUIPE INTERNA", "Produtor Master", ["8.000", "1", "1", "8.000", "6.000", "1", "1", "6.000", "2.000"]),
        item(4, "EQUIPE INTERNA", "Social Media", ["5.000", "1", "1", "5.000", "5.200", "1", "1", "5.200", "−200"]),
        item(5, "LOGÍSTICA", "Passagem aérea", ["390", "4", "2", "3.120", "350", "3", "2", "2.100", "1.020"]),
        item(6, "LOGÍSTICA", "Hospedagem", ["380", "4", "5", "7.600", "320", "3", "5", "4.800", "2.800"]),
        ignorada(7, "TOTAL", "23.720"),
        <tr key="honorarios">
          <td className={NUMERO_LINHA}>8</td>
          <td className={classeDoPapel("ign")} />
          <td className={classeDoPapel("ign")} />
          <td colSpan={2} className={cn(classeDoPapel("ign"), "text-center text-[11px] font-semibold text-[#8a8a8a]")}>
            HONORÁRIOS
          </td>
          <td className={cn(CEL, "bg-white text-right font-semibold ring-2 ring-inset ring-california-red")}>12%</td>
          <td className={classeDoPapel("ign")} />
          <td className={cn(CEL, "text-center")}>
            <Marca n={4} />
          </td>
          <td colSpan={6} className={classeDoPapel("ign")} />
        </tr>,
      ];

  return (
    <Grade pesos={pesos} letras={["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M–Q"]}>
      {linhas}
    </Grade>
  );
}

// ---------- internacional ----------

function PlanilhaInternacional() {
  const pesos = [32, 220, 260, 110, 110, 60, 60, 110, 100, 60, 60, 110, 60];
  const item = (lin: number, cat: string, nome: string, v: string[]) => (
    <tr key={lin}>
      <td className={NUMERO_LINHA}>{lin}</td>
      <td className={cn(classeDoPapel("lido", "esq"), "font-medium")}>{cat}</td>
      <td className={classeDoPapel("lido", "esq")}>{nome}</td>
      <td className={classeDoPapel("calc")}>{v[0]}</td>
      <td className={classeDoPapel("lido")}>{v[1]}</td>
      <td className={classeDoPapel("lido")}>{v[2]}</td>
      <td className={classeDoPapel("lido")}>{v[3]}</td>
      <td className={classeDoPapel("calc")}>{v[4]}</td>
      <td className={classeDoPapel("lido")}>{v[5]}</td>
      <td className={classeDoPapel("lido")}>{v[6]}</td>
      <td className={classeDoPapel("lido")}>{v[7]}</td>
      <td className={classeDoPapel("calc")}>{v[8]}</td>
      <td className={classeDoPapel("ign")} />
    </tr>
  );
  return (
    <Grade pesos={pesos} letras={["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L…"]}>
      <tr>
        <td className={NUMERO_LINHA}>1</td>
        <td className={CEL} />
        <td className={CEL} />
        <td colSpan={5} className={FAIXA_ORCADO}>
          Orçamento
        </td>
        <td colSpan={4} className={FAIXA_PLANEJADO}>
          Planejado · opcional
        </td>
        <td className={classeDoPapel("ign")} />
      </tr>
      <tr className="font-semibold">
        <td className={NUMERO_LINHA}>2</td>
        <td className={classeDoPapel("lido", "esq")}>
          <Marca n={1} />
          SHEET
        </td>
        <td className={classeDoPapel("lido", "esq")}>ITEM</td>
        <td className={cn(CAB_ORCADO, "italic text-[#a3a3a3]")}>TT USD</td>
        <td className={CAB_ORCADO}>
          <Marca n={2} />
          BRL
        </td>
        <td className={CAB_ORCADO}>QT</td>
        <td className={CAB_ORCADO}>D/M</td>
        <td className={cn(CAB_ORCADO, "italic text-[#a3a3a3]")}>
          <Marca n={3} />
          TT BRL
        </td>
        <td className={CAB_PLANEJADO}>R$</td>
        <td className={CAB_PLANEJADO}>QT</td>
        <td className={CAB_PLANEJADO}>D/M</td>
        <td className={cn(CAB_PLANEJADO, "italic text-[#a3a3a3]")}>TT</td>
        <td className={classeDoPapel("ign")} />
      </tr>
      {item(3, "EQUIPE", "Diretor", ["1.600", "8.000", "1", "1", "8.000", "7.000", "1", "1", "7.000"])}
      {item(4, "EQUIPE", "Produtor", ["1.000", "5.000", "1", "1", "5.000", "4.500", "1", "1", "4.500"])}
      {item(5, "LOGÍSTICA", "Passagens", ["840", "2.100", "2", "1", "4.200", "1.900", "2", "1", "3.800"])}
      <tr>
        <td className={NUMERO_LINHA}>6</td>
        <td className={classeDoPapel("ign")} />
        <td className={classeDoPapel("ign")} />
        <td colSpan={4} className={cn(classeDoPapel("ign"), "text-center font-semibold text-[#8a8a8a]")}>
          TOTAL · FEE · INT TAXES
        </td>
        <td className={cn(classeDoPapel("ign"), "text-center")}>
          <Marca n={4} />
        </td>
        <td colSpan={5} className={classeDoPapel("ign")} />
      </tr>
    </Grade>
  );
}

function Grade({
  pesos,
  letras,
  children,
}: {
  pesos: number[];
  letras: string[];
  children: React.ReactNode;
}) {
  const total = pesos.reduce((s, p) => s + p, 0);
  return (
    <div className="overflow-x-auto rounded-lg border border-[#d6d6d6] bg-white">
      <table className="w-full min-w-[900px] table-fixed text-[13px] leading-tight text-[#282828]">
        <colgroup>
          {pesos.map((p, i) => (
            <col key={i} style={{ width: `${((p / total) * 100).toFixed(3)}%` }} />
          ))}
        </colgroup>
        <tbody>
          <LinhaDeLetras letras={letras} />
          {children}
        </tbody>
      </table>
    </div>
  );
}

// ---------- regras ----------

function Regra({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Marca n={n} />
      <span>
        <b className="font-semibold text-foreground">{titulo}</b> {children}
      </span>
    </li>
  );
}

const VAZIOS =
  "R$ vazio entra como R$ 0,00; QT e D/M vazios entram como 1, e zero fica zero.";

function Regras({ modelo, interno }: { modelo: CategoriaModeloPlanilha; interno: boolean }) {
  const regras =
    modelo === "internacional" ? (
      <>
        <Regra n={1} titulo="SHEET vira o grupo.">
          Repita o nome em cada item, ou use uma linha de grupo.
        </Regra>
        <Regra n={3} titulo="TT USD e TT BRL são calculados">
          e não são lidos. Não há coluna de tipo: todo item entra como B · Bi-trib., e o tipo
          se ajusta na tela depois.
        </Regra>
        <Regra n={2} titulo="O unitário é a coluna D (BRL).">
          {VAZIOS}
        </Regra>
        <Regra n={4} titulo="O fechamento é ignorado:">
          TOTAL, FEE, INT TAXES e o câmbio do rodapé. Câmbio e parâmetros são os da versão.
        </Regra>
      </>
    ) : modelo === "mensal" ? (
      <>
        <Regra n={1} titulo="Um bloco por mês,">
          com o título do mês: “OUTUBRO DE 2026” na planilha exportada ou “OUTUBRO - …” na
          planilha interna. Os grupos do bloco entram naquele mês.
        </Regra>
        <Regra n={3} titulo={interno ? "A coluna G é ignorada:" : "A coluna G é o tipo de custo:"}>
          {interno
            ? "toda linha com valor entra como F · Interno, mesmo com o tipo em branco."
            : "A, AR, B, C, D, F ou FI. Linha com outro tipo fica de fora, com aviso."}
        </Regra>
        <Regra n={2} titulo="CATEGORIA vira o grupo dentro do mês.">
          {VAZIOS}
        </Regra>
        <Regra n={4} titulo="Os meses não mudam pela planilha:">
          mês que o orçamento não tem, ou mês do orçamento sem bloco, recusa a importação.
          Crie ou apague meses em “Editar meses”. O fechamento de cada mês é ignorado.
        </Regra>
      </>
    ) : (
      <>
        <Regra n={1} titulo="CATEGORIA vira o grupo.">
          Repita o nome em cada item; é ele que agrupa as linhas.
        </Regra>
        <Regra n={3} titulo={interno ? "A coluna G é ignorada:" : "A coluna G é o tipo de custo:"}>
          {interno
            ? "toda linha com valor entra como F · Interno, mesmo com o tipo em branco."
            : "A, AR, B, C, D, F ou FI. Linha com outro tipo fica de fora, com aviso."}
        </Regra>
        <Regra n={2} titulo="ITEM é o nome da linha">
          na versão. {VAZIOS}
        </Regra>
        <Regra n={4} titulo="HONORÁRIOS:">
          só o percentual da coluna E é lido, para conferir com o cadastro do cliente. Os
          demais totais e o bloco REALIZADO são ignorados.
        </Regra>
      </>
    );
  return (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-xl border border-border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground md:grid-cols-2">
      {regras}
    </ul>
  );
}

function Legenda() {
  const item = (amostra: React.ReactNode, texto: string) => (
    <span className="flex items-center gap-1.5">
      {amostra}
      <span>{texto}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
      {item(<span className="h-3.5 w-5 rounded-sm border border-[#d6d6d6] bg-white" />, "o ERP lê")}
      {item(
        <span className="flex h-3.5 w-5 items-center justify-center rounded-sm border border-[#d6d6d6] bg-white text-[9px] italic text-[#a3a3a3]">
          12
        </span>,
        "calculado, não é lido",
      )}
      {item(<span className={cn("h-3.5 w-5 rounded-sm border border-[#d6d6d6]", HACHURA)} />, "ignorado")}
    </div>
  );
}

export function FormatoDaPlanilha({
  modelo,
  interno,
  orcamentoId,
}: {
  modelo: CategoriaModeloPlanilha;
  interno: boolean;
  /** No mensal, o modelo baixado sai com os meses deste orçamento. */
  orcamentoId?: string;
}) {
  const nomeDoModelo =
    modelo === "internacional" ? "internacional" : modelo === "mensal" ? "mensal" : "nacional";
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-sm font-semibold text-foreground">Como a planilha precisa estar</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Um trecho da planilha {modelo === "mensal" ? "mensal " : ""}da agência, com as letras das
            colunas do Excel.
          </p>
        </div>
        <a
          href={`/api/orcamentos/modelo-de-planilha?modelo=${modelo}${
            modelo === "mensal" && orcamentoId ? `&orcamento=${orcamentoId}` : ""
          }`}
          download
          className="inline-flex flex-none items-center gap-2 rounded-lg border border-border bg-white px-3.5 py-2 text-[13px] font-semibold text-foreground transition-colors hover:bg-accent"
          title={`Planilha vazia no formato ${nomeDoModelo}, com as colunas no lugar`}
        >
          <Download className="h-4 w-4" />
          Baixar planilha modelo
        </a>
      </div>
      {modelo === "internacional" ? (
        <PlanilhaInternacional />
      ) : (
        <PlanilhaNacional interno={interno} mensal={modelo === "mensal"} />
      )}
      <Legenda />
      <Regras modelo={modelo} interno={interno} />
    </div>
  );
}
