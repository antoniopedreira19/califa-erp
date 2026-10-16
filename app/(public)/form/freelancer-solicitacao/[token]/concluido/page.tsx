import { CheckCircle2 } from "lucide-react";

export default function ConcluidoPage({
  searchParams,
}: {
  searchParams: { ja_existia?: string };
}) {
  const jaExistia = searchParams.ja_existia === "1";

  return (
    <div className="rounded-2xl border border-border bg-white p-10 text-center shadow-soft">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <CheckCircle2 className="h-7 w-7" />
      </div>
      <h2 className="text-2xl font-bold text-foreground">Pronto!</h2>
      <p className="mt-3 text-sm text-muted-foreground max-w-md mx-auto">
        {jaExistia ? (
          <>
            Encontramos um cadastro seu que já existia. Atualizamos os dados que
            você preencheu e criamos o novo contrato. O RH vai preparar a
            minuta pra assinatura.
          </>
        ) : (
          <>
            Seus dados foram enviados com sucesso e o contrato foi criado. O RH
            vai preparar a minuta pra assinatura e você vai receber em breve.
          </>
        )}
      </p>
      <p className="mt-6 text-xs text-muted-foreground">
        Pode fechar esta página. Qualquer dúvida, fale com quem te enviou o
        link.
      </p>
    </div>
  );
}
