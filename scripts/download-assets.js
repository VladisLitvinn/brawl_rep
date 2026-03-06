#!/usr/bin/env node
/**
 * Скачивает иконки бравлеров и ящиков в assets/
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const CDN = 'https://cdn.brawlify.com';
const UA = 'Mozilla/5.0 (compatible; BrawlSim/1.0)';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        reject(new Error(`${url} -> ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function download(url, dest) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const buf = await get(url);
  fs.writeFileSync(dest, buf);
  return buf.length;
}

async function main() {
  const root = path.join(__dirname, '..');
  const brawlersPath = path.join(root, 'brawlers.json');
  const brawlers = JSON.parse(fs.readFileSync(brawlersPath, 'utf8'));
  const brawlersDir = path.join(root, 'assets', 'brawlers');
  const boxesDir = path.join(root, 'assets', 'boxes', 'regular');

  let total = 0;

  console.log('Скачиваю бравлеров...');
  for (const b of brawlers) {
    const url = `${CDN}/brawlers/borderless/${b.id}.png`;
    const dest = path.join(brawlersDir, `${b.id}.png`);
    try {
      const size = await download(url, dest);
      total += size;
      process.stdout.write('.');
    } catch (e) {
      console.error(`\nОшибка ${b.name} (${b.id}): ${e.message}`);
    }
  }
  console.log(`\nБравлеры: ${brawlers.length} шт., ${(total / 1024).toFixed(1)} KB`);

  console.log('Скачиваю иконки ящиков...');
  for (const n of [1, 2]) {
    const url = `${CDN}/boxes/regular/${n}.png`;
    const dest = path.join(boxesDir, `${n}.png`);
    const size = await download(url, dest);
    total += size;
  }
  console.log(`Ящики: 2 шт.`);
  console.log(`\nИтого: ${(total / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
