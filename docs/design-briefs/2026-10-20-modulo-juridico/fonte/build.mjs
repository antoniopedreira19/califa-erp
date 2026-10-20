// Gera ../prototipo.html a partir de src/*.js (Preact + htm, sem JSX).
// Uso, da raiz do repositório (depois do npm install):
//   node docs/design-briefs/2026-10-20-modulo-juridico/fonte/build.mjs
// O Tailwind é o do próprio ERP, com a mesma paleta de tailwind.config.ts.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "../../../..");
const require = createRequire(join(RAIZ, "package.json"));
const tmp = mkdtempSync(join(tmpdir(), "juridico-"));
execFileSync(process.execPath, [require.resolve("tailwindcss/lib/cli.js"), "-c", join(AQUI, "tailwind.config.js"), "-i", join(AQUI, "input.css"), "-o", join(tmp, "tw.css"), "--minify"], { stdio: "inherit", cwd: RAIZ });

const css = readFileSync(join(tmp, "tw.css"), "utf8") + "\n" + readFileSync(join(AQUI, "extra.css"), "utf8");
const logo = readFileSync(join(RAIZ, "public/brand/logo-icon.png")).toString("base64");
let js = readdirSync(join(AQUI, "src")).filter((f) => f.endsWith(".js")).sort()
  .map((f) => `/* ${f} */\n` + readFileSync(join(AQUI, "src", f), "utf8")).join("\n")
  .replace("__LOGO__", logo);
if (js.includes("</script")) throw new Error("</script dentro do JS");

const FONTES = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Inter:wght@400;500;600;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap";
writeFileSync(join(AQUI, "../prototipo.html"), `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Módulo Jurídico</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTES}">
<style>
${css}
</style>
</head>
<body>
<div id="app"><p style="padding:32px;font:14px system-ui;color:#6b6b6b">Carregando o protótipo…</p></div>
<script src="https://unpkg.com/htm@3.1.1/preact/standalone.umd.js"></script>
<script>
${js}
</script>
</body>
</html>
`);
console.log("prototipo.html gerado");
