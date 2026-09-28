"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Check, X, AlertCircle, Sparkles, Calendar, Wallet, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaskedInput } from "@/components/ui/masked-input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Contratacao, Empresa } from "@/lib/types";
import { tipoContratacaoLabel } from "@/lib/types";
import {
  aceitarProposta,
  recusarProposta,
  salvarDadosCandidato,
} from "./actions";

type ContratacaoRica = Contratacao & {
  empresa: Pick<Empresa, "id" | "nome_fantasia"> | null;
  regional: { id: string; nome: string } | null;
};

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

/**
 * Textura de "cortina listrada" da carta California, reproduzida em CSS.
 * Duas camadas empilhadas:
 *   1. repeating-linear-gradient com bandas verticais alternadas
 *      (transparente / escura sutil / clara sutil) — dá o efeito de
 *      cortina.
 *   2. linear-gradient vertical do vermelho mais vivo ao bordô — dá
 *      o gradient de "iluminação" da carta.
 *
 * Versão "cortina" (usada em card grande): bandas espaçadas (30px)
 * e opacidade baixa (0.10) pra não competir com o texto.
 */
const CORTINA_CARTA_CARD = `
  repeating-linear-gradient(
    to right,
    rgba(0,0,0,0)       0px,
    rgba(0,0,0,0)       26px,
    rgba(0,0,0,0.10)    26px,
    rgba(0,0,0,0.10)    30px,
    rgba(255,255,255,0.02) 30px,
    rgba(255,255,255,0.02) 40px
  ),
  linear-gradient(to bottom right, #C42B3B 0%, #A02330 60%, #6E1620 100%)
`;

export function PropostaView({
  contratacao: c,
  token,
}: {
  contratacao: ContratacaoRica;
  token: string;
}) {
  if (c.status === "proposta_enviada") {
    return <LandingCarta contratacao={c} token={token} />;
  }
  if (c.status === "aceite_recebido") {
    return <VisaoDados contratacao={c} token={token} />;
  }
  return null;
}

/* =========================================================================
 * LANDING CARTA — apresenta os 7 slides originais da California + card com
 * os dados personalizados do candidato + botões de aceitar/recusar
 * ========================================================================= */

function LandingCarta({
  contratacao: c,
  token,
}: {
  contratacao: ContratacaoRica;
  token: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [openRecusa, setOpenRecusa] = React.useState(false);
  const [motivoRecusa, setMotivoRecusa] = React.useState("");

  function aceitar() {
    setErro(null);
    startTransition(async () => {
      const r = await aceitarProposta(token);
      if (!r.ok) setErro(r.message);
      else router.refresh();
    });
  }

  function recusar() {
    setErro(null);
    const fd = new FormData();
    fd.set("motivo", motivoRecusa);
    startTransition(async () => {
      const r = await recusarProposta(token, fd);
      if (!r.ok) setErro(r.message);
      else router.refresh();
    });
  }

  const primeiroNome = c.nome.split(" ")[0];

  return (
    <div className="space-y-8">
      {/* Card personalizado no topo com os dados reais do candidato.
          Textura de cortina listrada assinatura da carta California. */}
      <section
        className="rounded-3xl p-8 md:p-10 text-white shadow-elevated"
        style={{ backgroundImage: CORTINA_CARTA_CARD }}
      >
        <div className="flex items-start gap-3">
          <Sparkles className="h-6 w-6 mt-1 shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest opacity-80">
              Sua proposta
            </p>
            <h1 className="mt-1 text-2xl md:text-3xl font-bold leading-tight">
              Olá, {primeiroNome}! Boas-vindas à Califa. 🐻
            </h1>
            <p className="mt-2 text-sm md:text-base opacity-90">
              Preparamos uma proposta exclusiva pra você. Confira os detalhes
              abaixo e, depois, dá um role pela nossa apresentação institucional.
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <DadoCard
            icon={<Briefcase className="h-5 w-5" />}
            label="Cargo"
            valor={c.cargo}
          />
          <DadoCard
            icon={<Wallet className="h-5 w-5" />}
            label="Remuneração"
            valor={brl.format(Number(c.salario_proposto))}
            complemento={`em regime ${tipoContratacaoLabel(c.tipo_contratacao)}`}
            destaque
          />
          <DadoCard
            icon={<Calendar className="h-5 w-5" />}
            label="Data de início"
            valor={formatarData(c.data_admissao)}
          />
        </div>
      </section>

      {/* Apresentação institucional. Páginas 1 e 3 são renderizadas
          em HTML pra usar dados reais do candidato (nome / cargo /
          data / salário) no lugar dos placeholders do PPT. */}
      <section className="space-y-6">
        <SlidePagina1 nome={c.nome} />
        <SlideImagem numero={2} />
        <SlidePagina3
          nome={c.nome}
          cargo={c.cargo}
          dataAdmissao={c.data_admissao}
          salario={c.salario_proposto}
          regime={tipoContratacaoLabel(c.tipo_contratacao)}
        />
        <SlideImagem numero={4} />
        <SlideImagem numero={5} />
        <SlideImagem numero={6} />
        <SlideImagem numero={7} />
      </section>

      {erro && (
        <div className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {/* CTA final — mesma assinatura visual do card do topo */}
      <section
        className="rounded-3xl p-8 md:p-12 text-white shadow-elevated"
        style={{ backgroundImage: CORTINA_CARTA_CARD }}
      >
        <div className="flex items-start gap-3">
          <Sparkles className="h-6 w-6 mt-1 shrink-0" />
          <div>
            <p className="text-xs font-bold uppercase tracking-widest opacity-80">
              É agora
            </p>
            <h2 className="mt-1 text-2xl md:text-3xl font-bold leading-tight">
              Bora fazer parte da Califa, {primeiroNome}?
            </h2>
            <p className="mt-2 text-sm md:text-base opacity-90">
              Se topar, é só clicar em aceitar. Você vai preencher alguns
              dados rapidinho e o RH prepara o seu contrato.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-center">
          <button
            type="button"
            onClick={aceitar}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white text-california-red px-8 py-4 text-base font-bold shadow-brand hover:bg-white/90 disabled:opacity-50 transition-all"
          >
            <Check className="h-5 w-5" />
            {pending ? "Enviando..." : "Aceitar proposta"}
          </button>
          <button
            type="button"
            onClick={() => setOpenRecusa(true)}
            disabled={pending}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/10 border border-white/30 px-8 py-4 text-base font-medium text-white hover:bg-white/20 disabled:opacity-50 transition-colors"
          >
            <X className="h-5 w-5" />
            Recusar proposta
          </button>
        </div>

        <div className="mt-8 pt-6 border-t border-white/20 text-xs opacity-80 text-center">
          <p className="font-medium">Time de Cultura & Talento</p>
          <p>Contato: rh@agenciacalifornia.com.br</p>
        </div>
      </section>

      {openRecusa && (
        <div className="rounded-2xl border border-border bg-white p-6 shadow-soft">
          <h2 className="font-semibold">Recusar a proposta</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Nos conte brevemente o motivo. Isso ajuda a equipe a entender.
          </p>
          <div className="mt-4 space-y-3">
            <Label htmlFor="motivo">Motivo</Label>
            <textarea
              id="motivo"
              value={motivoRecusa}
              onChange={(e) => setMotivoRecusa(e.target.value)}
              rows={4}
              maxLength={500}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-california-red/20"
              placeholder="Ex.: aceitei outra oportunidade"
            />
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setOpenRecusa(false)}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={recusar}
              disabled={pending || motivoRecusa.trim().length < 3}
              className="rounded-lg bg-california-red px-4 py-2 text-sm font-semibold text-white hover:bg-california-red-hover disabled:opacity-50 transition-colors"
            >
              Confirmar recusa
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Componentes de apoio da landing */

function DadoCard({
  icon,
  label,
  valor,
  complemento,
  destaque,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  complemento?: string;
  destaque?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl p-5 ${destaque ? "bg-white/20 ring-2 ring-white/30" : "bg-white/10"}`}
    >
      <div className="flex items-center gap-2 text-white/80">
        {icon}
        <span className="text-xs font-bold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p
        className={`mt-2 leading-tight font-bold ${destaque ? "text-3xl" : "text-xl"}`}
      >
        {valor}
      </p>
      {complemento && <p className="text-xs opacity-80 mt-1">{complemento}</p>}
    </div>
  );
}

/**
 * Página 1 (capa) da carta em HTML — substitui o Slide1.JPG pra
 * mostrar o NOME REAL do candidato no lugar do placeholder
 * "NOME E SOBRENOME" do PPT.
 *
 * Layout inspirado no slide original: coluna esquerda com bloco vermelho
 * sólido (logo + "CARTA PROPOSTA") no topo e textura de cortina com o
 * nome embaixo; coluna direita com a colagem de fotos dos escritórios.
 */
function SlidePagina1({ nome }: { nome: string }) {
  // Quebra o nome em duas linhas: primeiro nome + resto. Se só tiver
  // um nome, mostra ele sozinho na primeira linha.
  const partes = nome.trim().split(/\s+/);
  const primeiroNome = partes[0] ?? "";
  const sobrenome = partes.slice(1).join(" ");

  return (
    <div className="overflow-hidden rounded-3xl shadow-soft aspect-[16/9] grid grid-cols-[40%_1fr]">
      {/* Coluna esquerda — imagem "Slide1-topo" no topo, cortina em baixo */}
      <div className="grid grid-rows-[45%_55%]">
        {/* Topo: imagem inteira exportada do PPT (logo + CARTA PROPOSTA
            já embutidos). Se o arquivo não existir, cai num fundo
            sólido #D40D32 pra não quebrar layout. */}
        <div
          className="relative"
          style={{ background: "#D40D32" }}
        >
          <Image
            src="/proposta/carta/Slide1-topo.jpg"
            alt="Carta Proposta California"
            fill
            sizes="(max-width: 768px) 40vw, 500px"
            className="object-cover"
            priority
            unoptimized
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>

        {/* Base: textura de cortina densa + linha vertical + nome */}
        <div
          className="p-4 md:p-6 flex items-end"
          style={{
            backgroundImage: `
              repeating-linear-gradient(
                to right,
                rgba(0,0,0,0)       0px,
                rgba(0,0,0,0)       6px,
                rgba(0,0,0,0.22)    6px,
                rgba(0,0,0,0.22)    8px,
                rgba(255,255,255,0.05) 8px,
                rgba(255,255,255,0.05) 14px
              ),
              linear-gradient(to bottom, #A02330 0%, #6E1620 60%, #3D0C10 100%)
            `,
          }}
        >
          <div className="flex items-stretch gap-3 md:gap-4">
            <div className="w-px bg-white/70" />
            <div>
              <p className="text-white text-2xl md:text-4xl font-black uppercase leading-none tracking-wide">
                {primeiroNome}
              </p>
              {sobrenome && (
                <p className="mt-1 md:mt-2 text-white text-2xl md:text-4xl font-black uppercase leading-none tracking-wide">
                  {sobrenome}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Coluna direita — foto/colagem dos escritórios (Slide1-foto.jpg).
          Se o arquivo ainda não existir, cai num gradient neutro. */}
      <div className="relative bg-gradient-to-br from-neutral-300 to-neutral-500">
        <Image
          src="/proposta/carta/Slide1-foto.jpg"
          alt="Escritórios California"
          fill
          sizes="(max-width: 768px) 60vw, 600px"
          className="object-cover"
          priority
          unoptimized
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    </div>
  );
}

/**
 * Renderiza um dos slides institucionais da California como imagem 16:9.
 * Se o arquivo ainda não existir em /public/proposta/carta/SlideN.JPG,
 * cai num fundo cinza discreto (não quebra layout).
 */
function SlideImagem({ numero }: { numero: number }) {
  return (
    <div className="overflow-hidden rounded-3xl bg-neutral-100 shadow-soft">
      <div className="relative aspect-[16/9]">
        <Image
          src={`/proposta/carta/Slide${numero}.JPG`}
          alt={`Carta Proposta California — página ${numero}`}
          fill
          sizes="(max-width: 768px) 100vw, 900px"
          className="object-contain"
          priority={numero <= 2}
          unoptimized
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    </div>
  );
}

/**
 * Página 3 da carta em HTML — substitui o Slide3.JPG pra que os cards
 * de "Data de Início" e "Remuneração" mostrem os dados reais do
 * candidato em vez dos placeholders do PPT ("XX/XX/XXXX", "R$ 0.000,00").
 *
 * Layout inspirado no slide original: faixa vermelha à esquerda com
 * "CARTA PROPOSTA", corpo bege ao centro com boas-vindas + cards
 * vermelhos com os dados dinâmicos.
 */
function SlidePagina3({
  nome,
  cargo,
  dataAdmissao,
  salario,
  regime,
}: {
  nome: string;
  cargo: string;
  dataAdmissao: string;
  salario: string;
  regime: string;
}) {
  return (
    <div className="overflow-hidden rounded-3xl bg-[#F5F0E8] shadow-soft aspect-[16/9] grid grid-cols-[110px_1fr_38%] md:grid-cols-[140px_1fr_38%]">
      {/* Faixa vermelha à esquerda — textura de "cortina" reproduzida
          com duas camadas de gradient: base vermelha vertical + listras
          verticais semi-transparentes por cima (repeating-linear-gradient).
          Mesma técnica usada no PPT original: forma sólida + forma listrada.
          Largura ~10% do total, batendo com a proporção dos slides institucionais. */}
      <div
        className="relative p-4 md:p-5 text-white flex flex-col"
        style={{
          backgroundImage: `
            repeating-linear-gradient(
              to right,
              rgba(0,0,0,0) 0px,
              rgba(0,0,0,0) 6px,
              rgba(0,0,0,0.18) 6px,
              rgba(0,0,0,0.18) 8px,
              rgba(255,255,255,0.04) 8px,
              rgba(255,255,255,0.04) 12px
            ),
            linear-gradient(to bottom, #C42B3B 0%, #A02330 40%, #6E1620 100%)
          `,
        }}
      >
        <div>
          <p className="text-sm md:text-base font-black tracking-wider leading-none">
            CARTA
          </p>
          <p className="text-xs md:text-sm opacity-80 leading-tight mt-1">
            PROPOSTA
          </p>
        </div>
        <div className="mt-auto flex justify-start pb-1">
          <span className="text-xl md:text-2xl" role="img" aria-label="urso">
            🐻
          </span>
        </div>
      </div>

      {/* Corpo bege ao centro */}
      <div className="flex flex-col items-center justify-center px-6 py-4 md:px-10 text-center overflow-hidden">
        {/* Linha decorativa horizontal */}
        <div className="w-full max-w-md h-px bg-neutral-500/60 mb-3 md:mb-4" />

        <p className="text-sm md:text-lg font-bold text-neutral-900">
          Boas-vindas à Califa! 🐻
        </p>
        <p className="mt-2 md:mt-3 text-[10px] md:text-xs text-neutral-800 leading-relaxed max-w-sm">
          É com muita alegria que convidamos você para surfar na nossa onda,
          assumindo o cargo de <strong>({cargo}).</strong> Estamos animados
          para criar, trocar e construir coisas incríveis juntos!
        </p>
        <p className="mt-2 md:mt-3 text-[10px] md:text-xs text-neutral-800 max-w-sm">
          Abaixo, você encontra todos os detalhes da nossa proposta:
        </p>

        <div className="mt-3 md:mt-5 space-y-2 md:space-y-3 w-full max-w-[280px]">
          <div className="rounded-xl bg-gradient-to-br from-[#D9394A] via-[#B02532] to-[#7A1820] px-4 py-2 md:py-2.5 text-white shadow-brand">
            <p className="text-[11px] md:text-sm font-bold">
              Data de Início: {formatarData(dataAdmissao)}
            </p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-[#D9394A] via-[#B02532] to-[#7A1820] px-4 py-2.5 md:py-3 text-white shadow-brand">
            <p className="text-[11px] md:text-sm">
              Remuneração:{" "}
              <span className="font-bold">
                {brl.format(Number(salario))}
              </span>
            </p>
            <p className="text-[10px] md:text-xs opacity-90">
              em regime <strong>{regime}</strong>
            </p>
          </div>
        </div>
      </div>

      {/* Foto à direita — usa a imagem separada Slide3-foto.jpg se
          existir; se não, cai num gradient bege neutro (não quebra). */}
      <div className="relative bg-gradient-to-br from-neutral-300 to-neutral-500">
        <Image
          src="/proposta/carta/Slide3-foto.png"
          alt="Escritório California"
          fill
          sizes="(max-width: 768px) 40vw, 350px"
          className="object-cover"
          unoptimized
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    </div>
  );
}

/* =========================================================================
 * FORMULÁRIO DE DADOS (aceite_recebido) — igual à v1, sem mudanças
 * ========================================================================= */

function VisaoDados({
  contratacao: c,
  token,
}: {
  contratacao: ContratacaoRica;
  token: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [erro, setErro] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<
    Record<string, string[]>
  >({});

  const [cpf, setCpf] = React.useState("");
  const [cnpj, setCnpj] = React.useState("");
  const [telefone, setTelefone] = React.useState("");
  const [cep, setCep] = React.useState("");
  const [dataNascimento, setDataNascimento] = React.useState("");
  const [tipoConta, setTipoConta] = React.useState<string>("");
  const [pixTipo, setPixTipo] = React.useState<string>("");

  const ehPJ =
    c.tipo_contratacao === "pj" || c.tipo_contratacao === "clt_recibo";

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErro(null);
    setFieldErrors({});
    const fd = new FormData(e.currentTarget);
    fd.set("cpf", cpf);
    fd.set("cnpj", cnpj);
    fd.set("telefone", telefone);
    fd.set("cep", cep);
    fd.set("data_nascimento", dataNascimento);
    if (tipoConta) fd.set("tipo_conta", tipoConta);
    if (pixTipo) fd.set("pix_tipo", pixTipo);

    startTransition(async () => {
      const r = await salvarDadosCandidato(token, fd);
      if (!r.ok) {
        setErro(r.message);
        if (r.fieldErrors) setFieldErrors(r.fieldErrors);
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="rounded-2xl border border-border bg-white p-8 shadow-soft">
        <h1 className="text-2xl font-bold">Complete seus dados</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Precisamos das informações abaixo para preparar seu contrato. Todos
          os campos são obrigatórios
          {ehPJ ? " (dados da pessoa jurídica no final)" : ""}.
        </p>
      </div>

      {/* Bloco 1 — Documentos */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Documentos
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="cpf">CPF</Label>
            <MaskedInput id="cpf" mask="cpf" required onDigitsChange={setCpf} />
            {fieldErrors.cpf?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rg">RG</Label>
            <Input
              id="rg"
              name="rg"
              required
              maxLength={20}
              placeholder="Ex.: 12.345.678-9"
            />
            {fieldErrors.rg?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="data_nascimento">Data de nascimento</Label>
            <DatePicker
              name="data_nascimento_visual"
              id="data_nascimento"
              onDateChange={(d) =>
                setDataNascimento(d ? d.toISOString().slice(0, 10) : "")
              }
            />
            {fieldErrors.data_nascimento?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="telefone">Telefone (celular)</Label>
            <MaskedInput
              id="telefone"
              mask="telefone"
              required
              onDigitsChange={setTelefone}
            />
            {fieldErrors.telefone?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Bloco PJ */}
      {ehPJ && (
        <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
            Pessoa Jurídica
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cnpj">CNPJ</Label>
              <MaskedInput
                id="cnpj"
                mask="cnpj"
                required
                onDigitsChange={setCnpj}
              />
              {fieldErrors.cnpj?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>
            <div className="space-y-2">
              <Label htmlFor="razao_social">Razão Social</Label>
              <Input
                id="razao_social"
                name="razao_social"
                required
                maxLength={200}
                placeholder="Nome empresarial completo"
              />
              {fieldErrors.razao_social?.map((m, i) => (
                <p key={i} className="text-xs text-california-red">
                  {m}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bloco 2 — Endereço */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Endereço
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="cep">CEP</Label>
            <MaskedInput id="cep" mask="cep" required onDigitsChange={setCep} />
            {fieldErrors.cep?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="logradouro">Logradouro (rua/avenida)</Label>
            <Input
              id="logradouro"
              name="logradouro"
              required
              maxLength={200}
              placeholder="Ex.: Av. da França"
            />
            {fieldErrors.logradouro?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="numero">Número</Label>
            <Input
              id="numero"
              name="numero"
              required
              maxLength={20}
              placeholder="Ex.: 393"
            />
            {fieldErrors.numero?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="complemento">Complemento (opcional)</Label>
            <Input
              id="complemento"
              name="complemento"
              maxLength={100}
              placeholder="Ex.: Apto 302"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bairro">Bairro</Label>
            <Input id="bairro" name="bairro" required maxLength={100} />
            {fieldErrors.bairro?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="cidade">Cidade</Label>
            <Input id="cidade" name="cidade" required maxLength={100} />
            {fieldErrors.cidade?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="uf">UF</Label>
            <Input
              id="uf"
              name="uf"
              required
              maxLength={2}
              placeholder="Ex.: BA"
              className="uppercase"
            />
            {fieldErrors.uf?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Bloco 3 — Bancário */}
      <div className="rounded-2xl border border-border bg-white p-6 shadow-soft space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-california-red">
          Dados para pagamento
        </h2>
        <p className="text-xs text-muted-foreground">
          Preencha a conta bancária <strong>OU</strong> o PIX. Um dos dois é
          suficiente.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="banco_codigo">Código do banco</Label>
            <Input
              id="banco_codigo"
              name="banco_codigo"
              maxLength={3}
              placeholder="Ex.: 341"
            />
            {fieldErrors.banco_codigo?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="banco_nome">Nome do banco</Label>
            <Input
              id="banco_nome"
              name="banco_nome"
              maxLength={200}
              placeholder="Ex.: Itaú"
            />
          </div>
          <div className="grid grid-cols-[1fr_60px] gap-2">
            <div className="space-y-2">
              <Label htmlFor="agencia">Agência</Label>
              <Input id="agencia" name="agencia" maxLength={5} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agencia_dv">DV</Label>
              <Input id="agencia_dv" name="agencia_dv" maxLength={1} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_60px] gap-2">
            <div className="space-y-2">
              <Label htmlFor="conta">Conta</Label>
              <Input id="conta" name="conta" maxLength={12} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="conta_dv">DV</Label>
              <Input id="conta_dv" name="conta_dv" maxLength={1} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tipo_conta">Tipo de conta</Label>
            <Select value={tipoConta} onValueChange={setTipoConta}>
              <SelectTrigger id="tipo_conta">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="corrente">Conta Corrente</SelectItem>
                <SelectItem value="poupanca">Poupança</SelectItem>
                <SelectItem value="pagamento">Conta Pagamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pix_tipo">Tipo do PIX</Label>
            <Select value={pixTipo} onValueChange={setPixTipo}>
              <SelectTrigger id="pix_tipo">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cpf">CPF</SelectItem>
                <SelectItem value="cnpj">CNPJ</SelectItem>
                <SelectItem value="email">E-mail</SelectItem>
                <SelectItem value="telefone">Telefone</SelectItem>
                <SelectItem value="aleatoria">Chave aleatória</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="pix_chave">Chave PIX</Label>
            <Input
              id="pix_chave"
              name="pix_chave"
              maxLength={200}
              placeholder="Sua chave PIX"
            />
            {fieldErrors.banco_codigo?.map((m, i) => (
              <p key={i} className="text-xs text-california-red">
                {m}
              </p>
            ))}
          </div>
        </div>
      </div>

      {erro && (
        <div className="rounded-xl border border-california-red/20 bg-california-red/5 px-4 py-3 text-sm text-california-red">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{erro}</span>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-california-red px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-california-red-hover disabled:opacity-50 transition-colors"
      >
        {pending ? "Enviando..." : "Enviar meus dados"}
      </button>
    </form>
  );
}
