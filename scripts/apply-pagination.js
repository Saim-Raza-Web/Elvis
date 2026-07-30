import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(__dirname, '../server/routes');
const skipFiles = ['auth.js', 'reports.js', 'dashboard.js', 'settings.js', 'documents.js', 'admin.js'];
const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js') && !skipFiles.includes(f));

for (const file of files) {
  let content = fs.readFileSync(path.join(routesDir, file), 'utf8');
  let changed = false;

  if (!content.includes('paginateQuery')) {
    const replaced = content.replace(
      "import { protect } from '../middleware/auth.js';",
      "import { protect } from '../middleware/auth.js';\nimport { paginateQuery } from '../utils/pagination.js';"
    );
    if (replaced !== content) {
      content = replaced;
      changed = true;
    }
  }

  const before = content;
  content = content.replace(
    /const items = await (\w+)\.find\(\{ company: req\.user\.company \}\);\s*res\.json\(items\);/g,
    'const result = await paginateQuery($1, { company: req.user.company }, req);\n    res.json(result);'
  );
  if (content !== before) changed = true;

  if (changed) {
    fs.writeFileSync(path.join(routesDir, file), content);
    console.log('Updated:', file);
  } else {
    console.log('Skipped:', file);
  }
}
