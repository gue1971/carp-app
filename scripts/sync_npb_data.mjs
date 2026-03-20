#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const PLAYERS_DATA_PATH = path.join(ROOT, 'players-data.js');
const OUTPUT_PATH = path.join(ROOT, 'npb-data.js');
const ACTIVE_LIST_URL = 'https://npb.jp/bis/players/active/rst_c.html';
const USER_AGENT = 'Mozilla/5.0 (compatible; CarpAppBot/1.0; +https://github.com/gue1971/carp-app)';

const BATTING_COLUMN_MAP = {
  '試合': 'games',
  '打席': 'plateAppearances',
  '打数': 'atBats',
  '得点': 'runs',
  '安打': 'hits',
  '二塁打': 'doubles',
  '三塁打': 'triples',
  '本塁打': 'homeRuns',
  '塁打': 'totalBases',
  '打点': 'runsBattedIn',
  '盗塁': 'stolenBases',
  '盗塁刺': 'caughtStealing',
  '犠打': 'sacrificeBunts',
  '犠飛': 'sacrificeFlies',
  '四球': 'walks',
  '死球': 'hitByPitch',
  '三振': 'strikeouts',
  '併殺打': 'doublePlays',
  '打率': 'average',
  '長打率': 'sluggingPercentage',
  '出塁率': 'onBasePercentage'
};

const PITCHING_COLUMN_MAP = {
  '登板': 'appearances',
  '勝利': 'wins',
  '敗北': 'losses',
  'セーブ': 'saves',
  'H': 'holds',
  'HP': 'holdPoints',
  '完投': 'completeGames',
  '完封勝': 'shutouts',
  '無四球': 'noBaseOnBalls',
  '勝率': 'winningPercentage',
  '打者': 'battersFaced',
  '投球回': 'inningsPitched',
  '安打': 'hitsAllowed',
  '本塁打': 'homeRunsAllowed',
  '四球': 'walks',
  '死球': 'hitBatters',
  '三振': 'strikeouts',
  '暴投': 'wildPitches',
  'ボーク': 'balks',
  '失点': 'runsAllowed',
  '自責点': 'earnedRuns',
  '防御率': 'era'
};

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[ 　]/g, '')
    .replace(/－/g, '-')
    .replace(/・/g, '')
    .trim();
}

function cleanText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#xff0f;/g, '／')
    .replace(/&#x2f;/g, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStatValue(value) {
  const text = cleanText(value);
  if (!text || text === '-' || text === '----') return null;
  if (/^\.\d+$/.test(text)) return Number(text);
  if (/^\d+\.\d+$/.test(text)) return Number(text);
  if (/^\d+$/.test(text)) return Number(text);
  return text;
}

async function loadLocalPlayers() {
  const source = await fs.readFile(PLAYERS_DATA_PATH, 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.playersData || [];
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'ja'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function extractActiveRosterLinks(html) {
  const links = new Map();
  const regex = /href="(\/bis\/players\/(\d+)\.html)"[^>]*>([\s\S]*?)<\/a>/g;
  let match;
  while ((match = regex.exec(html))) {
    const [, href, npbId, labelRaw] = match;
    const label = cleanText(labelRaw);
    if (!label) continue;
    links.set(npbId, {
      npbId,
      url: new URL(href, 'https://npb.jp').toString(),
      label
    });
  }
  return [...links.values()];
}

function matchPlayersToNpb(localPlayers, activeLinks) {
  const players = {};
  const normalizedLinks = activeLinks.map(link => ({
    ...link,
    normalizedLabel: normalizeName(link.label)
  }));

  for (const player of localPlayers) {
    const normalizedPlayerName = normalizeName(player.name);
    const match = normalizedLinks.find(link => link.normalizedLabel.includes(normalizedPlayerName));
    if (match) {
      players[player.name] = { npbId: match.npbId, url: match.url };
    }
  }

  return players;
}

function extractProfileField(html, label) {
  const regex = new RegExp(`${label}[\\s\\S]{0,200}?<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  const match = html.match(regex);
  return match ? cleanText(match[1]) : null;
}

function extractPageMetadata(html) {
  const birthLabel = extractProfileField(html, '生年月日');
  const birth = birthLabel
    ? birthLabel.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '')
    : null;
  return {
    registration: extractProfileField(html, 'ポジション'),
    throw_bat: extractProfileField(html, '投打'),
    heightWeight: extractProfileField(html, '身長／体重'),
    birth,
    history: extractProfileField(html, '経歴'),
    draft: extractProfileField(html, 'ドラフト')
  };
}

function parseHeightWeight(heightWeight) {
  const text = cleanText(heightWeight);
  const match = text.match(/(\d+)cm／(\d+)kg/);
  return {
    height: match ? Number(match[1]) : null,
    weight: match ? Number(match[2]) : null
  };
}

function extractTables(html) {
  const tables = [];
  let cursor = 0;

  while (cursor < html.length) {
    const start = html.indexOf('<table', cursor);
    if (start === -1) break;

    let depth = 1;
    let scan = start + 6;

    while (depth > 0 && scan < html.length) {
      const nextOpen = html.indexOf('<table', scan);
      const nextClose = html.indexOf('</table>', scan);
      if (nextClose === -1) {
        depth = 0;
        scan = html.length;
        break;
      }
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        scan = nextOpen + 6;
      } else {
        depth -= 1;
        scan = nextClose + 8;
      }
    }

    if (depth === 0) {
      tables.push(html.slice(start, scan));
      cursor = scan;
    } else {
      break;
    }
  }

  return tables;
}

function normalizeNestedTables(html) {
  return html.replace(/<table class="table_inning"[\s\S]*?<th>(.*?)<\/th>[\s\S]*?<td>(.*?)<\/td>[\s\S]*?<\/table>/gi, (_, whole, decimal) => {
    return `${cleanText(whole)}${cleanText(decimal)}`;
  });
}

function parseTableRows(tableHtml) {
  const normalizedTableHtml = normalizeNestedTables(tableHtml);
  return [...normalizedTableHtml.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(rowMatch => {
    const rowHtml = rowMatch[0];
    const cells = [...rowHtml.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(cellMatch => cleanText(cellMatch[1]));
    return cells.filter(Boolean);
  }).filter(row => row.length > 0);
}

function buildStatsRow(headers, row, map) {
  const year = row[0];
  if (!/^\d{4}$/.test(year)) return null;
  const stats = {};
  headers.forEach((header, index) => {
    const key = map[header];
    if (!key) return;
    stats[key] = parseStatValue(row[index]);
  });
  return { year, stats };
}

function parseStatsTables(html) {
  const statsByYear = {};
  for (const tableHtml of extractTables(html)) {
    const rows = parseTableRows(tableHtml);
    if (rows.length < 2) continue;
    const headers = rows[0];
    const isPitching = headers.includes('登板') && headers.includes('投球回');
    const isBatting = headers.includes('打席') && headers.includes('打率');
    if (!isPitching && !isBatting) continue;

    const map = isPitching ? PITCHING_COLUMN_MAP : BATTING_COLUMN_MAP;
    for (const row of rows.slice(1)) {
      const parsed = buildStatsRow(headers, row, map);
      if (!parsed) continue;
      statsByYear[parsed.year] ||= { batting: {}, pitching: {}, fieldingSummary: null };
      statsByYear[parsed.year][isPitching ? 'pitching' : 'batting'] = parsed.stats;
    }
  }
  return statsByYear;
}

function buildOutput(localPlayers, matchedPlayers, detailedData) {
  const players = {};
  const stats2025 = {};
  const statsByYear = {};

  for (const player of localPlayers) {
    const matched = matchedPlayers[player.name];
    if (!matched) continue;
    const detail = detailedData[matched.npbId];
    const profile = detail?.profile || {};
    const hw = parseHeightWeight(profile.heightWeight);

    players[player.name] = {
      npbId: matched.npbId,
      registration: profile.registration || undefined,
      throw_bat: profile.throw_bat || undefined,
      birth: profile.birth || undefined,
      history: profile.history || undefined,
      draft: profile.draft || undefined,
      ...(hw.height ? { height: hw.height } : {}),
      ...(hw.weight ? { weight: hw.weight } : {})
    };

    if (detail?.statsByYear?.['2025']) {
      stats2025[matched.npbId] = detail.statsByYear['2025'];
    }
    if (detail?.statsByYear && Object.keys(detail.statsByYear).length > 0) {
      statsByYear[matched.npbId] = detail.statsByYear;
    }
  }

  return { players, stats2025, statsByYear };
}

function serializeOutput(data) {
  return `window.npbData = ${JSON.stringify(data, null, 2)};\n`;
}

async function main() {
  const localPlayers = await loadLocalPlayers();
  const activeHtml = await fetchHtml(ACTIVE_LIST_URL);
  const activeLinks = extractActiveRosterLinks(activeHtml);
  const matchedPlayers = matchPlayersToNpb(localPlayers, activeLinks);

  const detailedData = {};
  for (const { npbId, url } of Object.values(matchedPlayers)) {
    const html = await fetchHtml(url);
    detailedData[npbId] = {
      profile: extractPageMetadata(html),
      statsByYear: parseStatsTables(html)
    };
  }

  const output = buildOutput(localPlayers, matchedPlayers, detailedData);
  await fs.writeFile(OUTPUT_PATH, serializeOutput(output), 'utf8');

  const matchedCount = Object.keys(output.players).length;
  console.log(`Matched ${matchedCount}/${localPlayers.length} players`);
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
