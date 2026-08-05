import fs from 'fs';
import path from 'path';

const componentsDir = path.join(process.cwd(), 'src/app/components');

function toCamelCase(str) {
  return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(word, index) {
    return index === 0 ? word.toLowerCase() : word.toUpperCase();
  }).replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
}

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let originalContent = content;

  // 1. label="Text" -> label={t.common?.camelCase || "Text"}
  // Match label="Something" or label="Something (Optional)" or label="Something *"
  content = content.replace(/label=["']([^"'{]+)["']/g, (match, p1) => {
    // If it's already translated or has expressions, ignore
    if (p1.includes('{')) return match;
    const cleanKey = toCamelCase(p1.replace(/[\*\(\)]/g, ''));
    return `label={t.common?.${cleanKey} || "${p1}"}`;
  });

  // 2. <option value="...">Text</option> -> <option value="..."> {t.common?.camelCase || "Text"} </option>
  content = content.replace(/<option([^>]*)>([^<\{]+)<\/option>/g, (match, p1, p2) => {
    const text = p2.trim();
    if (!text || text === '—') return match;
    // skip if it has dashes
    if (text.startsWith('—')) {
       const inner = text.replace(/—/g, '').trim();
       if (!inner) return match;
       const cleanKey = toCamelCase(inner.replace(/[\*\(\)]/g, ''));
       return `<option${p1}>— {t.common?.${cleanKey} || "${inner}"} —</option>`;
    }
    const cleanKey = toCamelCase(text.replace(/[\*\(\)]/g, ''));
    return `<option${p1}>{t.common?.${cleanKey} || "${text}"}</option>`;
  });

  // 3. title="Text" -> title={t.common?.camelCase || "Text"}
  content = content.replace(/title=["']([^"'{]+)["']/g, (match, p1) => {
    if (p1.includes('{')) return match;
    const cleanKey = toCamelCase(p1.replace(/[\*\(\)]/g, ''));
    return `title={t.common?.${cleanKey} || "${p1}"}`;
  });

  // 4. placeholder="Text"
  content = content.replace(/placeholder=["']([^"'{]+)["']/g, (match, p1) => {
    if (p1.includes('{')) return match;
    const cleanKey = toCamelCase(p1.replace(/[\*\(\)]/g, ''));
    return `placeholder={t.common?.${cleanKey} || "${p1}"}`;
  });

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed attributes in: ${path.basename(filePath)}`);
  }
}

const files = fs.readdirSync(componentsDir);
files.forEach(file => {
  if (file.endsWith('.tsx') || file.endsWith('.ts')) {
    fixFile(path.join(componentsDir, file));
  }
});
console.log("Done updating attributes.");
