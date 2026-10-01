// The app's full source as one text, the way it was when everything lived in ledger.html.
//
// ledger.html loads its code from app/*.js (<script src="app/…">, in order). The server's
// analytics engine and the test suites pull functions out of the app's source by name; they
// read it through here, so they see exactly what ships — the page with every app/ script put
// back inline, in load order. Zero dependencies.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_RE = /<script src="(app\/[a-z0-9.-]+\.js)(?:\?[^"]*)?"><\/script>/g;

// the app/ scripts ledger.html loads, in order (paths relative to the HTML file)
function appScripts(html) {
  return [...String(html).matchAll(SRC_RE)].map(m => m[1]);
}

// the page with each app/ script inlined in place: '<script>' + its source + '</script>'
function readAppSource(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dir = path.dirname(htmlPath);
  return html.replace(SRC_RE, (_, rel) => '<script>' + fs.readFileSync(path.join(dir, rel), 'utf8') + '</script>');
}

module.exports = { readAppSource, appScripts };
