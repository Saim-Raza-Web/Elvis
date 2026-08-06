const fs = require('fs');
const path = require('path');

const i18nPath = path.join(__dirname, 'src/app/i18n.ts');
const content = fs.readFileSync(i18nPath, 'utf8');

// Parse dictionaries from i18n.ts (en, es, fr, it, de, ur)
const langs = ['en', 'es', 'fr', 'it', 'de', 'ur'];

console.log('Validating i18n dictionaries for all languages...\n');

// Import or require i18n using tsx or basic JS extraction
const matches = content.match(/export const translations\s*:\s*Record<string,\s*any>\s*=\s*({[\s\S]+});/);

if (!matches) {
  console.log('Could not parse translations object.');
  process.exit(1);
}

console.log('Parsed translations successfully!');
