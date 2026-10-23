/**
 * Test Suite: Client Requirement #6 — Complete French and Italian Translations
 *
 * Verifies:
 * 1. French and Italian menu translations for Quality, Locations, Inventory Counts, Incidents, Purchasing, Recalls.
 * 2. Italian picking-related keys and translations.
 * 3. Removal of hard-coded English application messages in Receiving and addition of keys in en, es, fr, it.
 * 4. Removal of hard-coded Spanish application messages in Inventory initial stock load and addition of keys in en, es, fr, it.
 * 5. Picking and Orders components using i18n keys instead of ternary fallbacks.
 * 6. Page titles localized for new workflows across all 4 locales.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const i18nPath = path.resolve(__dirname, '../../src/app/i18n.ts');
const i18nContent = fs.readFileSync(i18nPath, 'utf8');

// Parse the dict object from i18n.ts
const dictBlockMatch = i18nContent.match(/const dict = (\{[\s\S]*?\n\})\s*as const;/);
assert(dictBlockMatch, 'dict object must be matched in i18n.ts');
const dict = eval('(' + dictBlockMatch[1] + ')');

let passedTests = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log('--- Running Client Requirement #6 Tests ---\n');

test('All four locales (en, es, fr, it) are present in dict', () => {
  assert(dict.en, 'English dictionary missing');
  assert(dict.es, 'Spanish dictionary missing');
  assert(dict.fr, 'French dictionary missing');
  assert(dict.it, 'Italian dictionary missing');
});

test('French nav contains translations for Quality, Locations, Inventory Counts, Incidents, and Purchasing', () => {
  const frNav = dict.fr.nav;
  assert.strictEqual(typeof frNav.qc, 'string', 'fr.nav.qc must be a string');
  assert(frNav.qc.length > 0, 'fr.nav.qc must not be empty');
  assert.strictEqual(typeof frNav.locations, 'string', 'fr.nav.locations must be a string');
  assert(frNav.locations.length > 0, 'fr.nav.locations must not be empty');
  assert.strictEqual(typeof frNav.stockCounts, 'string', 'fr.nav.stockCounts must be a string');
  assert(frNav.stockCounts.length > 0, 'fr.nav.stockCounts must not be empty');
  assert.strictEqual(typeof frNav.incidents, 'string', 'fr.nav.incidents must be a string');
  assert(frNav.incidents.length > 0, 'fr.nav.incidents must not be empty');
  assert.strictEqual(typeof frNav.purchaseOrders, 'string', 'fr.nav.purchaseOrders must be a string');
  assert(frNav.purchaseOrders.length > 0, 'fr.nav.purchaseOrders must not be empty');
  assert.strictEqual(typeof frNav.putaway, 'string', 'fr.nav.putaway must be a string');
  assert.strictEqual(typeof frNav.recalls, 'string', 'fr.nav.recalls must be a string');
});

test('Italian nav contains translations for Quality, Locations, Inventory Counts, Incidents, and Purchasing', () => {
  const itNav = dict.it.nav;
  assert.strictEqual(typeof itNav.qc, 'string', 'it.nav.qc must be a string');
  assert(itNav.qc.length > 0, 'it.nav.qc must not be empty');
  assert.strictEqual(typeof itNav.locations, 'string', 'it.nav.locations must be a string');
  assert(itNav.locations.length > 0, 'it.nav.locations must not be empty');
  assert.strictEqual(typeof itNav.stockCounts, 'string', 'it.nav.stockCounts must be a string');
  assert(itNav.stockCounts.length > 0, 'it.nav.stockCounts must not be empty');
  assert.strictEqual(typeof itNav.incidents, 'string', 'it.nav.incidents must be a string');
  assert(itNav.incidents.length > 0, 'it.nav.incidents must not be empty');
  assert.strictEqual(typeof itNav.purchaseOrders, 'string', 'it.nav.purchaseOrders must be a string');
  assert(itNav.purchaseOrders.length > 0, 'it.nav.purchaseOrders must not be empty');
  assert.strictEqual(typeof itNav.putaway, 'string', 'it.nav.putaway must be a string');
  assert.strictEqual(typeof itNav.recalls, 'string', 'it.nav.recalls must be a string');
});

test('Italian picking contains picking-related keys (startPick, pickTasks, pickBatches, scan, quickScan, etc.)', () => {
  const itPick = dict.it.picking;
  const requiredKeys = ['startPick', 'pickTasks', 'pickBatches', 'scan', 'quickScan', 'quickScanPlaceholder', 'executeScan', 'createBatch', 'searchPlaceholder', 'ownerLabel', 'pendingTasks', 'completedPicks', 'taskId', 'ownerClient', 'orderRef', 'linesCount', 'executePick', 'deliveryNote', 'createNewPickTask'];
  requiredKeys.forEach(key => {
    assert.strictEqual(typeof itPick[key], 'string', `it.picking.${key} must be a string`);
    assert(itPick[key].length > 0, `it.picking.${key} must not be empty`);
  });
});

test('Receiving translation keys are complete across all four languages', () => {
  const recKeys = ['createInboundASN', 'editASN', 'rejectedBarcodeNotFound', 'rejectedProductNotBelong', 'updateASN', 'saveAndCreateASN'];
  ['en', 'es', 'fr', 'it'].forEach(lang => {
    recKeys.forEach(k => {
      assert(dict[lang].receiving[k], `dict.${lang}.receiving.${k} is missing`);
      assert(dict[lang].receiving[k].length > 0, `dict.${lang}.receiving.${k} is empty`);
    });
  });
});

test('Inventory initial stock load keys are complete across all four languages', () => {
  const invKeys = [
    'initialStockLoad', 'initialStockLoadTitle', 'initialStockLoadSub',
    'initialStockInstructions', 'csvTemplate', 'targetWarehouse',
    'noWarehousesConfigured', 'selectFileExcelCsv', 'requiredColumns',
    'fileLoaded', 'errorsDetected', 'validatingAndImporting',
    'validateAndLoadStock', 'selectCsvOrExcel', 'selectValidWarehouse',
    'initialStockSuccess', 'initialStockError'
  ];
  ['en', 'es', 'fr', 'it'].forEach(lang => {
    invKeys.forEach(k => {
      assert(dict[lang].inventory[k], `dict.${lang}.inventory.${k} is missing`);
      assert(dict[lang].inventory[k].length > 0, `dict.${lang}.inventory.${k} is empty`);
    });
  });
});

test('Status partially_picked is present in all four languages', () => {
  ['en', 'es', 'fr', 'it'].forEach(lang => {
    assert(dict[lang].status.partially_picked, `dict.${lang}.status.partially_picked is missing`);
  });
});

test('Page titles for all workflow pages are present across all four languages', () => {
  const pageKeys = ['qc', 'putaway', 'stock-counts', 'purchase-orders', 'incidents', 'recalls', 'compliance', 'client-portal'];
  ['en', 'es', 'fr', 'it'].forEach(lang => {
    pageKeys.forEach(k => {
      assert(dict[lang].pages[k], `dict.${lang}.pages.${k} is missing`);
      assert(dict[lang].pages[k].title, `dict.${lang}.pages.${k}.title is missing`);
      assert(dict[lang].pages[k].sub, `dict.${lang}.pages.${k}.sub is missing`);
    });
  });
});

test('Receiving.tsx does not use hardcoded English reject and create ASN literals', () => {
  const receivingPath = path.resolve(__dirname, '../../src/app/components/Receiving.tsx');
  const code = fs.readFileSync(receivingPath, 'utf8');

  // Must not have hardcoded toast.error with English reject message
  assert(!code.includes("toast.error(`REJECTED: Product not found / barcode '${term}' not in catalog.`)"),
    'Receiving.tsx must use i18n for product not found rejection message');

  // Must use tr.rejectedBarcodeNotFound
  assert(code.includes('tr?.rejectedBarcodeNotFound'),
    'Receiving.tsx must use tr?.rejectedBarcodeNotFound');

  // Must not hardcode "Create New Inbound ASN" as modal title without translation fallback
  assert(!code.includes('title={editTarget ? `Edit ASN (${editTarget.asnId || editTarget.asnNumber})` : "Create New Inbound ASN"}'),
    'Receiving.tsx must use tr?.createInboundASN for modal title');
});

test('Inventory.tsx does not use hardcoded Spanish strings for initial stock load', () => {
  const inventoryPath = path.resolve(__dirname, '../../src/app/components/Inventory.tsx');
  const code = fs.readFileSync(inventoryPath, 'utf8');

  assert(!code.includes('toast.error("Selecciona un archivo CSV o Excel");'),
    'Inventory.tsx must not hardcode Selecciona un archivo CSV o Excel');
  assert(!code.includes('toast.error("Selecciona o configura un almacén válido");'),
    'Inventory.tsx must not hardcode Selecciona o configura un almacén válido');
  assert(!code.includes('<SecondaryButton icon={Upload} onClick={() => setShowInitialStockModal(true)}>Carga Inicial</SecondaryButton>'),
    'Inventory.tsx must not hardcode Carga Inicial button label');
  assert(code.includes('ti?.initialStockLoad'),
    'Inventory.tsx must use ti?.initialStockLoad');
});

test('Picking.tsx uses translation keys instead of binary lang === "es" checks', () => {
  const pickingPath = path.resolve(__dirname, '../../src/app/components/Picking.tsx');
  const code = fs.readFileSync(pickingPath, 'utf8');

  assert(!code.includes('lang === "es" ? "Tareas de Picking" : "Pick Tasks"'),
    'Picking.tsx must use tp?.pickTasks instead of lang === "es"');
  assert(!code.includes('lang === "es" ? "Lotes de Picking" : "Pick Batches"'),
    'Picking.tsx must use tp?.pickBatches instead of lang === "es"');
  assert(!code.includes('lang === "es" ? "ID Tarea" : "Task ID"'),
    'Picking.tsx table headers must use translation keys');
});

test('Orders.tsx uses t.orders.b2bOrders instead of binary lang === "es" check', () => {
  const ordersPath = path.resolve(__dirname, '../../src/app/components/Orders.tsx');
  const code = fs.readFileSync(ordersPath, 'utf8');

  assert(!code.includes('lang === "es" ? "Pedidos B2B" : "B2B Orders"'),
    'Orders.tsx must use t.orders.b2bOrders');
});

console.log(`\nAll ${passedTests} Client Requirement #6 tests passed successfully!`);
