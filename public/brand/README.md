# Brand assets

Arquivos de marca usados pelo app via `<Image src="/brand/..." />`.

## Arquivos esperados

| Arquivo | Uso | Especificação |
| --- | --- | --- |
| `logo.svg` | Logo horizontal completo (rodapés, e-mails, exports) | SVG vetorial |
| `logo-icon.svg` | Ícone quadrado (sidebar colapsada, avatar da marca no login) | SVG vetorial, área quadrada |
| `logo-icon.png` | Fallback raster do ícone (se algum consumidor não suportar SVG) | 256×256 mínimo, transparência |

## Regras

- **SVG preferido** para tudo — escala sem perda e pesa menos.
- Nunca commitar arquivos brutos do designer (`.psd`, `.ai`, `.fig`). Só o output final otimizado.
- Nomes sempre em kebab-case e em inglês.
- Se precisar de versão dark/light, sufixar: `logo-icon-dark.svg`, `logo-icon-light.svg`.

## Onde NÃO fica

Favicons (`favicon.ico`, `icon.png`, `apple-icon.png`) vão em [`app/`](../../app/), não aqui — o Next.js App Router usa convenção de arquivo para eles.
