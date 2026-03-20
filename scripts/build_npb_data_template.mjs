#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const outputPath = path.join(rootDir, 'npb-data.js');

const template = `window.npbData = {
  players: {
    // '秋山 翔吾': { npbId: '31135133' }
  },
  stats2025: {
    // '31135133': {
    //   batting: {
    //     games: 0,
    //     plateAppearances: 0,
    //     atBats: 0,
    //     hits: 0,
    //     homeRuns: 0,
    //     runsBattedIn: 0,
    //     average: 0,
    //     onBasePercentage: 0,
    //     sluggingPercentage: 0
    //   },
    //   pitching: {
    //     appearances: 0,
    //     wins: 0,
    //     losses: 0,
    //     saves: 0,
    //     holds: 0,
    //     holdPoints: 0,
    //     inningsPitched: 0,
    //     strikeouts: 0,
    //     era: 0
    //   },
    //   fieldingSummary: null
    // }
  }
};
`;

await fs.writeFile(outputPath, template, 'utf8');
console.log(`Wrote ${outputPath}`);
