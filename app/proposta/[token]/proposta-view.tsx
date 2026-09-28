"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Check,
  X,
  AlertCircle,
  MapPin,
  Sparkles,
  Building,
  Users,
  Heart,
  Coffee,
  Calendar,
  Clock,
  GraduationCap,
} from "lucide-react";
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

function formatarHoje(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(2)}`;
}

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
 * LANDING CARTA — reproduz as 7 páginas da carta proposta California
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

  const nomeCargo = c.cargo;
  const tipoRegime = tipoContratacaoLabel(c.tipo_contratacao);

  return (
    <div className="space-y-8">
      {/* PÁGINA 1 — CAPA */}
      <section className="overflow-hidden rounded-3xl shadow-elevated">
        <div className="grid md:grid-cols-2">
          <div className="relative bg-gradient-to-br from-california-red via-california-red to-red-900 p-10 md:p-14 text-white">
            <div className="flex items-center gap-2 mb-8">
              <span className="rounded-full bg-white text-california-red font-bold text-sm w-8 h-8 inline-flex items-center justify-center">
                CA
              </span>
              <span className="font-bold text-sm tracking-wider">CALIFORNIA</span>
            </div>
            <h1 className="text-5xl md:text-6xl font-black leading-none">
              CARTA
              <br />
              <span className="font-light">PROPOSTA</span>
            </h1>
            <div className="mt-10 md:mt-20">
              <p className="text-sm opacity-70 mb-2">{formatarHoje()}</p>
              <p className="text-2xl md:text-3xl font-bold uppercase leading-tight">
                {c.nome}
              </p>
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-black/20 to-transparent" />
          </div>
          <div className="relative min-h-[300px] md:min-h-[500px] bg-gradient-to-br from-neutral-200 to-neutral-400">
            <Image
              src="/proposta/carta/01-capa.jpg"
              alt="Escritórios California"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
              // Se a imagem não existir, o next/image mostra um espaço vazio;
              // o gradient do container serve como fallback visual.
              priority
              unoptimized
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center text-white/40 text-sm font-medium pointer-events-none">
              {/* Placeholder text — invisível se a imagem carregar */}
            </div>
          </div>
        </div>
      </section>

      {/* PÁGINA 2 — ESTAMOS POR TODO O PAÍS */}
      <section className="rounded-3xl bg-[#F5F0E8] shadow-elevated overflow-hidden">
        <div className="p-8 md:p-14">
          <div className="grid md:grid-cols-[auto_1fr_auto] gap-8 items-center">
            <div className="hidden md:block">
              <h2
                className="text-6xl font-black text-california-red leading-none"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                ESTAMOS POR
                <br />
                <span className="text-neutral-900">TODO O PAÍS!</span>
              </h2>
            </div>
            <div className="md:hidden">
              <h2 className="text-4xl font-black leading-tight">
                <span className="text-california-red">ESTAMOS POR</span>
                <br />
                <span>TODO O PAÍS!</span>
              </h2>
            </div>

            <div className="space-y-6">
              <NumeroDestaque numero="8" label="Escritórios" />
              <NumeroDestaque numero="6" label="Regionais" />
              <NumeroDestaque numero="300" label="Californianos" />
              <NumeroDestaque numero="20" label="mil m² Estúdios" />

              <div className="mt-8 pt-6 border-t border-neutral-300">
                <h3 className="text-lg font-bold text-california-red">
                  Projac do Conteúdo & Criatividade!
                </h3>
                <p className="mt-3 text-sm text-neutral-700 leading-relaxed">
                  A <strong>presença</strong> nas{" "}
                  <strong>principais cidades</strong> do Brasil nos permite
                  viver o que o local fala, sente e cria. É dessa imersão que{" "}
                  <strong>transformamos tendências</strong> em{" "}
                  <strong>ideias</strong> e <strong>conteúdos</strong> que{" "}
                  <strong>pautam cultura</strong>, conectando{" "}
                  <strong>marcas</strong> a <strong>conversas reais</strong> que
                  nascem do território <strong>regional</strong>, ganham força
                  no <strong>digital</strong> e ditam comportamento no{" "}
                  <strong>mundo</strong>.
                </p>
              </div>
            </div>

            <div className="hidden md:flex flex-col gap-3 text-sm font-bold text-california-red">
              <RegionalPin nome="FOR" />
              <RegionalPin nome="SSA" />
              <RegionalPin nome="BH" />
              <RegionalPin nome="RIO" />
              <RegionalPin nome="SP" />
              <p className="text-xs font-normal text-neutral-500 mt-1">
                São Sebastião*
              </p>
            </div>
          </div>

          <div className="mt-8 md:hidden flex flex-wrap gap-3 text-sm font-bold text-california-red">
            <RegionalPin nome="FOR" />
            <RegionalPin nome="SSA" />
            <RegionalPin nome="BH" />
            <RegionalPin nome="RIO" />
            <RegionalPin nome="SP" />
            <span className="text-xs font-normal text-neutral-500 self-center">
              São Sebastião*
            </span>
          </div>
        </div>
      </section>

      {/* PÁGINA 3 — BOAS-VINDAS + DETALHES */}
      <section className="overflow-hidden rounded-3xl bg-[#F5F0E8] shadow-elevated">
        <div className="grid md:grid-cols-[80px_1fr_1fr]">
          <div className="hidden md:block bg-gradient-to-b from-california-red to-red-800 p-6 text-white">
            <p className="text-xs font-bold tracking-wider">CARTA</p>
            <p className="text-xs opacity-70">PROPOSTA</p>
          </div>
          <div className="p-10 md:p-14 text-center">
            <p className="text-lg font-bold">Boas-vindas à Califa! 🐻</p>
            <p className="mt-4 text-sm text-neutral-800 leading-relaxed max-w-md mx-auto">
              É com muita alegria que convidamos você para surfar na nossa
              onda, assumindo o cargo de{" "}
              <strong>({nomeCargo}).</strong> Estamos animados para criar,
              trocar e construir coisas incríveis juntos!
            </p>
            <p className="mt-6 text-sm text-neutral-800 max-w-md mx-auto">
              Abaixo, você encontra todos os detalhes da nossa proposta:
            </p>

            <div className="mt-8 space-y-4 max-w-sm mx-auto">
              <div className="rounded-2xl bg-gradient-to-r from-california-red to-red-800 p-5 text-white shadow-brand">
                <p className="text-lg font-bold">
                  Data de Início: {formatarData(c.data_admissao)}
                </p>
              </div>
              <div className="rounded-2xl bg-gradient-to-r from-california-red to-red-800 p-5 text-white shadow-brand">
                <p className="text-lg">
                  Remuneração:{" "}
                  <span className="font-bold">
                    {brl.format(Number(c.salario_proposto))}
                  </span>
                </p>
                <p className="text-sm opacity-90">
                  em regime <strong>{tipoRegime}</strong>
                </p>
              </div>
            </div>
          </div>
          <div className="relative min-h-[300px] bg-gradient-to-br from-neutral-300 to-neutral-500">
            <Image
              src="/proposta/carta/03-escritorio-janela.jpg"
              alt="Escritório California"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
              unoptimized
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        </div>
      </section>

      {/* PÁGINA 4 — BENEFÍCIOS */}
      <section className="rounded-3xl bg-[#F5F0E8] shadow-elevated overflow-hidden">
        <div className="relative min-h-[140px] bg-gradient-to-br from-emerald-900 to-emerald-700">
          <Image
            src="/proposta/carta/04-planta-fundo.jpg"
            alt=""
            fill
            className="object-cover opacity-90"
            unoptimized
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="border-2 border-white rounded-full px-8 py-3 text-white font-bold text-lg">
              Dá um check nos benefícios de ser um Urso Califa
            </div>
          </div>
        </div>
        <div className="p-8 md:p-12 grid md:grid-cols-3 gap-6">
          <BeneficioCard cor="sulamerica">
            <div className="mb-3">
              <span className="text-2xl font-bold text-blue-800">SulAmérica</span>
            </div>
            <p className="font-bold">Plano de saúde SulAmérica</p>
            <p className="text-sm text-neutral-700">(Sem Coparticipação)</p>
            <p className="text-sm text-neutral-700">Elegível para dependentes;</p>
            <div className="mt-4">
              <p className="font-bold">Plano odontológico SulAmérica</p>
              <p className="text-sm text-neutral-700">Elegível para dependentes;</p>
            </div>
          </BeneficioCard>

          <BeneficioCard cor="wellhub">
            <div className="mb-3">
              <span className="text-2xl font-bold text-pink-600">wellhub</span>
              <span className="ml-1">✿</span>
            </div>
            <p className="text-sm">
              <strong>Wellhub/Gympass</strong> - parceria;
            </p>
            <div className="mt-4 text-sm">
              <p>
                <strong>Convênio com as faculdades:</strong> Grupo Ânima
                Educação, Baiana Business School, FIAP, ESPM, Miami ad School e
                com a escola de idiomas Campus Live;
              </p>
            </div>
            <div className="mt-4 text-sm">
              <p>
                Convênio com a <strong>CENTRAL PSI</strong> para terapia
                presencial e online (Elegível para dependentes);
              </p>
            </div>
          </BeneficioCard>

          <BeneficioCard>
            <p className="text-sm">
              <strong>Eventos comemorativos e de aniversário</strong> conforme
              calendário festivos;
            </p>
            <p className="mt-3 text-sm">No Dress Code;</p>
            <p className="mt-3 text-sm">
              O pagamento do salário é mensal,{" "}
              <strong>todo dia 3 do mês subsequente.</strong>
            </p>
            <p className="mt-3 text-sm">
              A agência funciona das <strong>09:00h</strong> às{" "}
              <strong>19:00h</strong> (segunda a sexta), com{" "}
              <strong>2 horas de almoço</strong>.
            </p>
          </BeneficioCard>

          <BeneficioCard className="md:col-span-3 md:max-w-md">
            <p className="text-sm">Férias remuneradas;</p>
            <p className="mt-2 text-sm">Day-Off de aniversário;</p>
            <p className="mt-2 text-sm">Décimo terceiro salário;</p>
          </BeneficioCard>
        </div>
        <div className="px-8 pb-6 text-xs font-bold text-neutral-500">
          CARTA <span className="font-normal">PROPOSTA</span>
        </div>
      </section>

      {/* PÁGINA 5 — DOCUMENTAÇÃO */}
      <section className="overflow-hidden rounded-3xl bg-[#F5F0E8] shadow-elevated">
        <div className="grid md:grid-cols-[80px_1fr_1fr]">
          <div className="hidden md:block bg-gradient-to-b from-california-red to-red-800 p-6 text-white">
            <p className="text-xs font-bold tracking-wider">CARTA</p>
            <p className="text-xs opacity-70">PROPOSTA</p>
          </div>
          <div className="p-10 md:p-12">
            <h3 className="text-base font-bold">
              <strong>Documentação necessária</strong> para adesão aos{" "}
              <strong>Planos SulAmérica Saúde e Odonto</strong> (sem carência
              dentro dos 30 dias de contratação e para PJ não há carência a
              ser cumprida):
            </h3>

            <div className="mt-6">
              <p className="text-lg font-bold">
                PJ&rsquo;s{" "}
                <span className="inline-block w-16 h-px bg-neutral-400 align-middle" />
              </p>
              <ul className="mt-3 space-y-2 text-sm list-disc pl-5">
                <li>RG e CPF (ou CNH)</li>
                <li>
                  contrato de prestação de serviços + (MEI) cartão CNPJ ou
                  CCMEI ou Contrato social se for ME ou LTDA. (necessário 06
                  meses de abertura)
                </li>
                <li>Última nota fiscal emitida para a empresa.</li>
              </ul>
            </div>

            <div className="mt-6">
              <p className="text-lg font-bold">
                CLT&rsquo;s{" "}
                <span className="inline-block w-16 h-px bg-neutral-400 align-middle" />
              </p>
              <ul className="mt-3 space-y-2 text-sm list-disc pl-5">
                <li>RG e CPF (ou CNH)</li>
                <li>Contrato de trabalho</li>
              </ul>
            </div>
          </div>
          <div className="relative min-h-[300px] bg-gradient-to-br from-amber-800 to-amber-950">
            <Image
              src="/proposta/carta/05-fachada.jpg"
              alt="Fachada California"
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
              unoptimized
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        </div>
      </section>

      {/* PÁGINA 6 — PLANOS */}
      <section className="overflow-hidden rounded-3xl bg-[#F5F0E8] shadow-elevated">
        <div className="grid md:grid-cols-[80px_1fr]">
          <div className="hidden md:block bg-gradient-to-b from-california-red to-red-800 p-6 text-white">
            <p className="text-xs font-bold tracking-wider">CARTA</p>
            <p className="text-xs opacity-70">PROPOSTA</p>
          </div>
          <div className="p-8 md:p-12">
            <div className="mb-6">
              <span className="text-3xl font-bold text-blue-800">SulAmérica</span>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4 text-sm">
                <div>
                  <p className="font-bold">Plano Direto (sem coparticipação)</p>
                  <p className="text-neutral-700">
                    - (vide valor de acordo com a faixa etária na tabela) Valor
                    Califa 60% e Valor do Urso 40% (Sobre o valor total do
                    plano escolhido)
                  </p>
                </div>
                <div>
                  <p className="font-bold">Plano Especial (sem coparticipação)</p>
                  <p className="text-neutral-700">
                    - (vide valor de acordo com a faixa etária na tabela) Valor
                    Califa 60% e Valor do Urso 40% (Sobre o valor total do
                    plano escolhido)
                  </p>
                </div>
                <div>
                  <p>
                    <strong>Plano Odonto -</strong> Vinculado ao Saúde
                    SulAmérica (sem desconto) em folha.
                  </p>
                </div>
                <div>
                  <p>
                    <strong>Seguro de vida SulAmérica</strong> para
                    beneficiários do plano SulAmérica Saúde (sem custo).
                  </p>
                </div>
                <div>
                  <p>
                    <strong>Se quiser adicionar dependentes</strong>, basta
                    enviar RG e CPF + certidão de casamento ou união estável
                    pública (para cônjuge) ou Certidão de Nascimento (para
                    filhos). <strong>Eles pagarão o valor integral do plano escolhido pelo titular.</strong>
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <BeneficioCard cor="bradesco">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-lg font-bold text-red-700">bradesco</span>
                    <span className="text-xs text-red-600">dental</span>
                  </div>
                  <p className="text-sm">
                    <strong>Plano Bradesco</strong> Odonto UNNA -{" "}
                    <strong>R$ 13,00 com desconto em folha.</strong> (Estendido
                    para dependentes)
                  </p>
                </BeneficioCard>

                <BeneficioCard cor="wellhub">
                  <div className="mb-3">
                    <span className="text-lg font-bold text-pink-600">wellhub</span>
                    <span className="ml-1">✿</span>
                  </div>
                  <p className="text-sm">
                    Aproveite também para explorar opções de planos que
                    incentivam a prática de atividade física, saúde e bem
                    estar. Se cadastre no aplicativo da Wellhub (Gympass)
                    através do link de convite e escolher o plano ideal.
                  </p>
                  <p className="text-sm mt-3">
                    A forma de pagamento:{" "}
                    <strong>via cartão de crédito direto no APP.</strong>
                  </p>
                  <p className="text-sm mt-3">
                    Caso queira incluir dependentes, basta cadastrar os dados
                    deles no APP, e a forma de pagamento será via cartão de
                    crédito
                  </p>
                </BeneficioCard>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PÁGINA 7 — XÊRO + CTA */}
      <section className="relative overflow-hidden rounded-3xl shadow-elevated min-h-[400px] bg-gradient-to-br from-neutral-700 to-neutral-900">
        <Image
          src="/proposta/carta/07-xero-fundo.jpg"
          alt=""
          fill
          className="object-cover opacity-70"
          unoptimized
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/50 to-black/70" />
        <div className="relative p-10 md:p-16 min-h-[400px] flex flex-col justify-between">
          <div className="text-white text-center">
            <h2
              className="text-6xl md:text-8xl font-black tracking-tighter drop-shadow-lg"
              style={{ fontFamily: "Georgia, serif" }}
            >
              Xêro!
            </h2>
          </div>

          <div>
            {erro && (
              <div className="mb-6 rounded-xl bg-white/95 px-4 py-3 text-sm text-california-red flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{erro}</span>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-center">
              <button
                type="button"
                onClick={aceitar}
                disabled={pending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-california-red px-8 py-4 text-base font-bold text-white shadow-brand hover:bg-california-red-hover disabled:opacity-50 transition-all"
              >
                <Check className="h-5 w-5" />
                {pending ? "Enviando..." : "Aceitar proposta"}
              </button>
              <button
                type="button"
                onClick={() => setOpenRecusa(true)}
                disabled={pending}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-white/95 px-8 py-4 text-base font-medium text-neutral-800 hover:bg-white disabled:opacity-50 transition-colors"
              >
                <X className="h-5 w-5" />
                Recusar
              </button>
            </div>

            <div className="mt-8 text-white/80 text-center text-xs">
              <p className="font-medium">Time de Cultura & Talento</p>
              <p>Contato: rh@agenciacalifornia.com.br</p>
            </div>
          </div>
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

/* --- Componentes de apoio da landing --- */

function NumeroDestaque({
  numero,
  label,
}: {
  numero: string;
  label: string;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-5xl md:text-6xl font-black text-california-red leading-none">
        {numero}
      </span>
      <span className="text-lg font-medium text-neutral-800">{label}</span>
    </div>
  );
}

function RegionalPin({ nome }: { nome: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2 w-2 rounded-full bg-california-red" />
      <span>{nome}</span>
    </div>
  );
}

function BeneficioCard({
  children,
  cor,
  className,
}: {
  children: React.ReactNode;
  cor?: "sulamerica" | "wellhub" | "bradesco";
  className?: string;
}) {
  const border =
    cor === "sulamerica"
      ? "border-blue-300"
      : cor === "wellhub"
        ? "border-pink-300"
        : cor === "bradesco"
          ? "border-red-300"
          : "border-california-red/30";
  return (
    <div
      className={`rounded-2xl border-2 ${border} bg-white/60 p-5 ${className ?? ""}`}
    >
      {children}
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
