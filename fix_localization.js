import fs from 'fs';
import path from 'path';

const componentsDir = path.join(process.cwd(), 'src/app/components');

function fixFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let originalContent = content;

  // If the file doesn't have useLang or t, skip or add it. We assume most have const { t } = useLang();
  // We can add it if missing, but let's assume it's there. We'll use optional chaining t.common?.something just in case t is undefined, though t shouldn't be.

  // 1. Toasts
  content = content.replace(/toast\.success\(\s*["']([^"']+)["']\s*\)/g, 'toast.success(t.common?.operationSuccess || "$1")');
  content = content.replace(/toast\.error\(\s*["']([^"']+)["']\s*\)/g, 'toast.error(t.common?.error || "$1")');
  content = content.replace(/toast\.info\(\s*["']([^"']+)["']\s*\)/g, 'toast.info("$1")'); // Maybe no translation for info yet

  // 2. Buttons / common action words inside tags
  const tags = ['button', 'PrimaryButton', 'SecondaryButton', 'DangerButton'];
  const actions = {
    'Save': 'save',
    'Cancel': 'cancel',
    'Delete': 'delete',
    'Edit': 'edit',
    'Create': 'create',
    'Add': 'add',
    'Search': 'search',
    'Confirm': 'confirm',
    'Close': 'close',
    'Back': 'back'
  };

  for (const tag of tags) {
    for (const [word, key] of Object.entries(actions)) {
      // Regex to match >Word</tag> or > Word </tag>
      const regex = new RegExp(`>\\s*${word}\\s*<\\/${tag}>`, 'g');
      content = content.replace(regex, `>{t.common?.${key} || "${word}"}</${tag}>`);
    }
  }

  // 3. Placeholders
  content = content.replace(/placeholder=["']Search\.\.\.["']/g, 'placeholder={`${t.common?.search || "Search"}...`}');
  content = content.replace(/placeholder=["']Search\b([^"']*)["']/g, 'placeholder={`${t.common?.search || "Search"} $1`}');

  // 4. Common table headers
  const headers = {
    'Status': 'status',
    'Date': 'date',
    'Name': 'name',
    'Company': 'company',
    'Email': 'email',
    'Total': 'total',
    'Type': 'type',
    'Actions': 'actions'
  };
  for (const [word, key] of Object.entries(headers)) {
    const regex = new RegExp(`>\\s*${word}\\s*<\\/th>`, 'g');
    content = content.replace(regex, `>{t.common?.${key} || "${word}"}</th>`);
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Fixed: ${path.basename(filePath)}`);
  }
}

const files = fs.readdirSync(componentsDir);
files.forEach(file => {
  if (file.endsWith('.tsx') || file.endsWith('.ts')) {
    fixFile(path.join(componentsDir, file));
  }
});

console.log("Done");
