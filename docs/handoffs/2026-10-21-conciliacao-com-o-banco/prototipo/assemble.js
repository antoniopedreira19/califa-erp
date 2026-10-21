const fs=require('fs');
const css=fs.readFileSync('out/app.css','utf8');
const shell=fs.readFileSync('src/shell.css','utf8');
const js=fs.readFileSync('out/app.js','utf8').replace(/<\/script/g,'<\\/script');
const html=`<title>Conciliação com o Banco</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Fraunces:wght@600;700&display=swap">
<style>${css}</style>
<style>${shell}</style>
<div id="root"></div>
<script>${js}</script>
`;
fs.writeFileSync('conciliacao-banco.html',html);
console.log('bytes',html.length);
