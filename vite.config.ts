import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

import { peaksServerPlugin } from './scripts/peaks-server';
import { terrainServerPlugin } from './scripts/terrain-server';

export default defineConfig({
  // The terrain plugin publishes /terrain/ from data/tiles/ and
  // fixtures/tiles/cases/ during dev and preview — see scripts/terrain-server.ts
  // for what it serves, what it refuses to serve, and what a production
  // deployment has to do instead. The peaks plugin does the same for /peaks/
  // from fixtures/peaks/regions/ (Q8) — in production both are staged as
  // static files by `npm run package:deploy`.
  plugins: [react(), terrainServerPlugin(), peaksServerPlugin()],
  test: {
    // Unit + integration tests. Acceptance tests run from their own config
    // (vitest.acceptance.config.ts) so `npm run check` stays fast.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    // Vitest's 5 s default is a hang detector, not a performance budget, and on a
    // four-core container it fails honest work: the CV aligner's real-SRTM cases
    // in src/pipeline/cv-alignment.test.ts take 4.1-4.9 s each when 70 test files
    // share those cores, so any file added to the suite tips them over. 15 s
    // leaves that headroom and still catches a test that never returns. The
    // acceptance config already allows 30 s for the same reason.
    testTimeout: 15_000,
  },
});
