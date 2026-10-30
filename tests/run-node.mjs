// Lancer : node tests/run-node.mjs
import { runAll } from './cases.js';

const results = await runAll();
let current = '';
for (const r of results) {
  if (r.module !== current) { current = r.module; console.log(`\n■ ${current}`); }
  console.log(`  ${r.ok ? '✅' : '❌'} ${r.name}${r.ok ? '' : `\n     → ${r.error}`}`);
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} tests réussis`);
process.exit(failed ? 1 : 0);
