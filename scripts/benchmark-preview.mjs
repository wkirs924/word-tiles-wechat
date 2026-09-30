// Node/VM workload counts, not a GPU or real-phone FPS benchmark.
import {writeFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {previewHarness} from '../tests/helpers/preview-harness.mjs';

function sample(sourcePath) {
  const h = previewHarness({sourcePath});
  h.finishImages();
  const before = h.measured();
  const start = performance.now();
  for (let frame = 0; frame < 120; frame++) {
    for (let event = 0; event < 8; event++) h.handlers.wheel({deltaY: 3, preventDefault() {}});
    h.flush();
  }
  const elapsed = performance.now() - start;
  const after = h.measured();
  for (let page = 0; page < 24; page++) {
    h.handlers.wheel({deltaY: -180, preventDefault() {}}); h.flush(); h.finishImages();
  }
  return {frames: after.frames - before.frames, rankCalls: after.rankCalls - before.rankCalls,
    vm_elapsed_ms: Number(elapsed.toFixed(2)),
    mock_decoded_image_bytes: h.stats()?.decodedImageBytes ?? [...new Set(h.images)].filter(i => i.width).reduce((sum, i) => sum + i.width * i.height * 4, 0)};
}
const baseline = process.argv[2];
const report = {method: '120 event batches, 8 scroll events per batch. Mock Canvas and 640x640 mock images; excludes actual GPU, image decode, network and device FPS.',
  before: baseline && existsSync(baseline) ? sample(resolve(baseline)) : null, after: sample()};
writeFileSync(resolve('docs/PERFORMANCE_BENCHMARK.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
