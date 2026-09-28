# Imagens da Carta Proposta

Este diretório recebe as fotos institucionais que aparecem em `/proposta/[token]`.

## Arquivos esperados

A landing procura os arquivos abaixo. Se algum não existir, o componente mostra um bloco de gradient California no lugar (funciona sem quebrar).

| Nome | O que é | Onde aparece |
|---|---|---|
| `01-capa.jpg` | Fotos dos escritórios (colagem, tipo hero da capa da carta) | Página 1 — hero da capa |
| `02-mapa-brasil.png` | Mapa do Brasil com pontos nas cidades (FOR, SSA, BH, RIO, SP) | Página 2 — seção "Estamos por todo o país" |
| `03-escritorio-janela.jpg` | Foto do escritório vista de fora com colaboradores | Página 3 — seção "Boas-vindas" |
| `04-planta-fundo.jpg` | Foto da planta/varanda que serve de fundo pros benefícios | Página 4 — seção "Benefícios" |
| `05-fachada.jpg` | Foto da fachada California (o portão de madeira com logo) | Página 5 — seção "Documentação" |
| `07-xero-fundo.jpg` | Foto do interior com quadros e skate na parede | Página 7 — seção final "Xêro!" |

## Dimensões recomendadas

- Formato: JPG (fotos) ou PNG (mapa).
- Largura mínima: 1600px pra ficar boa em telas retina.
- Tamanho: comprimir com [Squoosh](https://squoosh.app/) ou similar antes de subir. Cada foto deve ficar abaixo de 300 KB.

## Como testar

Depois de salvar as imagens aqui, recarregue `/proposta/[token]` em janela anônima. As fotos aparecem automaticamente. Se algum arquivo estiver ausente, o placeholder de gradient continua no lugar.
