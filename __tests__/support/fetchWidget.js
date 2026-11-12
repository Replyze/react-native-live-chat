// The widget bundle for the *.widget.test.ts files: REPLYZE_WIDGET_JS when it
// names a built widget.js, otherwise the live widget from Replyze's CDN
// (REPLYZE_WIDGET_URL picks another one, e.g. a staging CDN).
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async function fetchWidget() {
  if (process.env.REPLYZE_WIDGET_JS && fs.existsSync(process.env.REPLYZE_WIDGET_JS)) return;

  const url = process.env.REPLYZE_WIDGET_URL || 'https://cdn.replyze.chat/widget.js';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the widget from ${url}: HTTP ${response.status}`);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'replyze-widget-')), 'widget.js');
  fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  process.env.REPLYZE_WIDGET_JS = file;
};
