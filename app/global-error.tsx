"use client";

/**
 * Global error boundary — última linha de defesa.
 *
 * O `app/error.tsx` só pega erros DENTRO do root layout. Se o próprio layout
 * (fontes, providers, metadata) explodir, o Next mostra tela branca. Este
 * arquivo pega esse caso: renderiza um `<html><body>` próprio porque o
 * layout não tá disponível.
 *
 * Mantém tudo inline (sem Tailwind) pra sobreviver mesmo se o CSS não
 * carregar.
 */

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          background: "#FAFAFA",
          color: "#282828",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "420px",
            width: "100%",
            background: "#fff",
            border: "1px solid #e5e5e5",
            borderRadius: "16px",
            padding: "32px",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: "0 0 12px", fontSize: "18px" }}>
            Algo quebrou ao carregar o sistema
          </h1>
          <p
            style={{
              margin: "0 0 20px",
              fontSize: "14px",
              color: "#6b6b6b",
            }}
          >
            Tente de novo. Se continuar, mande o código abaixo pro admin.
          </p>
          {error.digest && (
            <div
              style={{
                background: "#f3f3f3",
                borderRadius: "8px",
                padding: "8px 12px",
                fontFamily: "ui-monospace, monospace",
                fontSize: "12px",
                color: "#6b6b6b",
                marginBottom: "20px",
                wordBreak: "break-all",
              }}
            >
              {error.digest}
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              background: "#E74B56",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tentar de novo
          </button>
        </div>
      </body>
    </html>
  );
}
