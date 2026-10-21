set -e
cd "$(dirname "$0")"
npx esbuild src/main.jsx --bundle --minify --define:process.env.NODE_ENV='"production"' --jsx=automatic --outfile=out/app.js --log-level=warning
npx tailwindcss -c tailwind.config.js -i src/globals.css -o out/app.css --minify 2>/dev/null
node assemble.js
