const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'src/app/components');
const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.tsx'));

files.forEach(file => {
  const filePath = path.join(componentsDir, file);
  const content = fs.readFileSync(filePath, 'utf8');

  // Split by function declarations
  const functions = content.split(/(?=export\s+function|function\s+[A-Z])/);
  functions.forEach(fn => {
    const fnNameMatch = fn.match(/function\s+([A-Za-z0-9_]+)/);
    if (fnNameMatch) {
      const fnName = fnNameMatch[1];
      const usesT = /\bt\.\w+/.test(fn);
      const usesUseLang = /useLang\(\)/.test(fn);
      if (usesT && !usesUseLang) {
        console.log(`❌ Function "${fnName}" in ${file} uses "t." but missing "useLang()"!`);
      }
    }
  });
});
