import fs from 'fs';
import path from 'path';

const componentsDir = path.join(process.cwd(), 'src/app/components');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let originalContent = content;

  // Match something like: placeholder={t.common?.1Z999AA1012345678 || "1Z999AA1012345678"}
  // and replace with: placeholder="1Z999AA1012345678"
  content = content.replace(/placeholder=\{t\.common\?\.[0-9][a-zA-Z0-9_]*\s*\|\|\s*(["'][^"']+["'])\}/g, 'placeholder=$1');
  
  // Same for label if any (though numbers in labels are rare)
  content = content.replace(/label=\{t\.common\?\.[0-9][a-zA-Z0-9_]*\s*\|\|\s*(["'][^"']+["'])\}/g, 'label=$1');

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed syntax errors in: ${path.basename(filePath)}`);
  }
}

const files = fs.readdirSync(componentsDir);
files.forEach(file => {
  if (file.endsWith('.tsx') || file.endsWith('.ts')) {
    fixFile(path.join(componentsDir, file));
  }
});
console.log("Done fixing syntax.");
