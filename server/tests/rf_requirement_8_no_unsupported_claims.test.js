/**
 * rf_requirement_8_no_unsupported_claims.test.js
 *
 * Regression guard: ensures that unsubstantiated commercial claims do not
 * re-enter the public-facing i18n dictionary, HomePage, LoginPage, or Admin
 * component sources.
 */

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

function src(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

async function run() {
  console.log('\n=== ELVIS WMS — REQ #8 UNSUPPORTED CLAIMS REGRESSION TESTS ===\n');
  let passed = 0, failed = 0;
  function ok(m)        { console.log('  PASS:', m); passed++; }
  function fail(m, det) { console.log('  FAIL:', m, det || ''); failed++; }

  const i18n      = src('src/app/i18n.ts');
  const homePage  = src('src/app/components/HomePage.tsx');
  const loginPage = src('src/app/components/LoginPage.tsx');
  const admin     = src('src/app/components/Admin.tsx');
  const all       = i18n + homePage + loginPage + admin;

  // T1: No SOC 2 claim
  try { assert(!all.includes('SOC 2')); ok('T1: No SOC 2 certification claim'); }
  catch (e) { fail('T1: SOC 2 claim found', e.message); }

  // T2: No 99.xx% uptime
  try { assert(!/99\.\d+%/.test(all)); ok('T2: No specific uptime % claim (99.xx%)'); }
  catch (e) { fail('T2: 99.xx% uptime claim found', e.message); }

  // T3: No 2M+ orders
  try { assert(!all.includes('2M+')); ok('T3: No "2M+" order volume claim'); }
  catch (e) { fail('T3: 2M+ claim found', e.message); }

  // T4: No 500+ operators/clients
  try { assert(!all.includes('500+')); ok('T4: No "500+" operator count claim'); }
  catch (e) { fail('T4: 500+ claim found', e.message); }

  // T5: No <4ms latency
  try { assert(!all.includes('4ms') && !all.includes('< 4ms') && !all.includes('<4ms')); ok('T5: No "<4ms" API latency claim'); }
  catch (e) { fail('T5: <4ms latency claim found', e.message); }

  // T6: No #1 WMS
  try { assert(!all.includes('#1 WMS') && !all.includes('WMS #1') && !all.includes('N\u00b01')); ok('T6: No "#1 WMS" market ranking claim'); }
  catch (e) { fail('T6: #1 WMS claim found', e.message); }

  // T7: demoHint fields empty
  try {
    const hits = (i18n.match(/demoHint:\s*"([^"]*)"/g) || []).filter(m => !m.includes('""'));
    assert(hits.length === 0, 'Non-empty demoHint: ' + hits.join(', '));
    ok('T7: No demo credentials in i18n demoHint fields');
  } catch (e) { fail('T7: Demo credentials in demoHint', e.message); }

  // T8: No fabricated 94% picking metric
  try { assert(!homePage.includes('94%')); ok('T8: No fabricated 94% picking error metric'); }
  catch (e) { fail('T8: 94% picking metric found', e.message); }

  // T9: No hardcoded prototype email in Receiving
  try {
    const receiving = src('src/app/components/Receiving.tsx');
    assert(!receiving.includes('admin@demologistics.io'));
    ok('T9: No hardcoded prototype email in Receiving incident records');
  } catch (e) { fail('T9: Prototype email in Receiving', e.message); }

  // T10: No "Trusted by 500" trust-line
  try { assert(!all.includes('Trusted by 500')); ok('T10: No "Trusted by 500+" hero trust-line'); }
  catch (e) { fail('T10: Trusted by 500+ claim found', e.message); }

  // T11: No "50+ countries" claim
  try { assert(!/50\+.*[Cc]ountr|[Cc]ountr.*50\+/.test(all)); ok('T11: No "50+ countries" claim'); }
  catch (e) { fail('T11: 50+ countries claim found', e.message); }

  // T12: No "hundreds of companies" CTA
  try {
    const hasHundreds = all.includes('hundreds of companies') ||
                        all.includes('cientos de empresas') ||
                        all.includes("centaines d'entreprises") ||
                        all.includes('centinaia di aziende');
    assert(!hasHundreds);
    ok('T12: No "hundreds of companies" CTA claim');
  } catch (e) { fail('T12: Hundreds of companies claim found', e.message); }

  console.log(`\n--- RESULTS: ${passed}/${passed + failed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
  else { console.log('ALL TESTS PASSED\n'); process.exit(0); }
}

run().catch(err => { console.error('FATAL:', err.message || err); process.exit(1); });
