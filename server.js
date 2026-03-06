require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8888;

const pool = new Pool({
  host: process.env.PGHOST || process.env.POSTGRES_HOST || 'postgres',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || process.env.POSTGRES_USER || 'brawl',
  password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || 'brawl',
  database: process.env.PGDATABASE || process.env.POSTGRES_DB || 'brawl',
  max: Math.max(1, parseInt(process.env.PG_POOL_MAX, 10) || 5),
});

// Меньше раундов = меньше CPU (для слабого сервера можно BCRYPT_ROUNDS=8)
const BCRYPT_ROUNDS = Math.min(12, Math.max(8, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10));

const BRAWLERS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'brawlers.json'), 'utf8')
);
const RARITY_WEIGHTS = {
  regular: { Rare: 55.8, 'Super Rare': 25.2, Epic: 11.5, Mythic: 5.2, Legendary: 2.3 },
  big: { Rare: 47.6, 'Super Rare': 23.8, Epic: 14.3, Mythic: 9.5, Legendary: 4.8 },
};
const SKIP_DZ_CHANCE = { regular: 1, big: 3 };
const BOX_COST = { regular: 9, big: 18 };
const INITIAL_TOKENS = 100;

function normRarity(r) {
  return r === 'Ultra Legendary' ? 'Legendary' : r;
}
const byRarity = {};
BRAWLERS.forEach((b) => {
  const r = normRarity(b.rarity);
  if (!byRarity[r]) byRarity[r] = [];
  byRarity[r].push(b);
});

function pickBrawler(boxType) {
  const weights = RARITY_WEIGHTS[boxType];
  let r = Math.random() * 100;
  let chosenRarity = 'Rare';
  for (const [rarity, pct] of Object.entries(weights)) {
    r -= pct;
    if (r <= 0) {
      chosenRarity = rarity;
      break;
    }
  }
  const pool_b = byRarity[chosenRarity];
  if (!pool_b || !pool_b.length) return byRarity['Rare'][0];
  return pool_b[Math.floor(Math.random() * pool_b.length)];
}

function rollSkipDZ(boxType) {
  return Math.random() * 100 < SKIP_DZ_CHANCE[boxType];
}

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        tokens INT NOT NULL DEFAULT ${INITIAL_TOKENS},
        is_admin BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_brawlers (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        brawler_id INT NOT NULL,
        brawler_name VARCHAR(64) NOT NULL,
        rarity VARCHAR(32) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_brawlers_user_id ON user_brawlers(user_id);
    `);
    await client.query(`ALTER TABLE users ALTER COLUMN tokens SET DEFAULT ${INITIAL_TOKENS}`);
    await client.query(`UPDATE users SET tokens = ${INITIAL_TOKENS} WHERE tokens = 0 OR tokens IS NULL`);

    await seedUsers(client);
  } finally {
    client.release();
  }
}

const SEED_PASSWORD = '123456';
const SEED_USERS = [
  { username: 'Админ', is_admin: true, brawlersCount: 0 },
  { username: 'Иван', is_admin: false, brawlersCount: 2 },
  { username: 'Мария', is_admin: false, brawlersCount: 7 },
  { username: 'Алексей', is_admin: false, brawlersCount: 15 },
  { username: 'Дмитрий', is_admin: false, brawlersCount: 5 },
  { username: 'Елена', is_admin: false, brawlersCount: 22 },
  { username: 'Николай', is_admin: false, brawlersCount: 11 },
];

async function seedUsers(client) {
  const hash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
  for (const { username, is_admin, brawlersCount } of SEED_USERS) {
    const r = await client.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );
    if (r.rows.length) continue;
    const ins = await client.query(
      'INSERT INTO users (username, password_hash, tokens, is_admin) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hash, INITIAL_TOKENS, is_admin]
    );
    const userId = ins.rows[0].id;
    if (brawlersCount > 0) {
      for (let i = 0; i < brawlersCount; i++) {
        const b = pickBrawler('regular');
        const rarity = normRarity(b.rarity);
        await client.query(
          'INSERT INTO user_brawlers (user_id, brawler_id, brawler_name, rarity) VALUES ($1, $2, $3, $4)',
          [userId, b.id, b.name, rarity]
        );
      }
      const cost = brawlersCount * BOX_COST.regular;
      await client.query(
        'UPDATE users SET tokens = GREATEST(0, tokens - $1) WHERE id = $2',
        [cost, userId]
      );
    }
  }
}

// Body parser нужен до роутов, которые читают req.body (в т.ч. /api/english/validate)
app.use(express.json());

// English Exercise API (Learn words by chunks) — один сервер, отдельный роутер
const englishApi = require('./english_exercise/Learn_words_by_chunks/server/routes/api');
app.use('/api/english', englishApi);

app.use(cookieParser());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'brawl-boxes-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname)));
// English Exercise: статика из папки english (один index.html, без сборки)
app.use('/english', express.static(path.join(__dirname, 'english')));
app.get('/english', (_, res) => res.redirect(301, '/english/'));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }
  pool.query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId])
    .then((r) => {
      if (!r.rows.length || !r.rows[0].is_admin) {
        return res.status(403).json({ error: 'Доступ только для администратора' });
      }
      next();
    })
    .catch(next);
}

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 2 || password.length < 4) {
    return res.status(400).json({ error: 'Логин от 2 символов, пароль от 4' });
  }
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, tokens, is_admin) VALUES ($1, $2, $3, false) RETURNING id, username, tokens, is_admin',
      [username.trim(), hash, INITIAL_TOKENS]
    );
    const user = r.rows[0];
    req.session.userId = user.id;
    req.session.username = user.username;
    return res.json({ id: user.id, username: user.username, tokens: user.tokens, is_admin: user.is_admin });
  } catch (e) {
    if (e.code === '23505')
      return res.status(400).json({ error: 'Такой логин уже занят' });
    throw e;
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Укажите логин и пароль' });
  }
  const r = await pool.query(
    'SELECT id, username, tokens, password_hash, is_admin FROM users WHERE username = $1',
    [username.trim()]
  );
  if (!r.rows.length) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  const user = r.rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Неверный логин или пароль' });
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ id: user.id, username: user.username, tokens: user.tokens, is_admin: user.is_admin });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const r = await pool.query(
    'SELECT id, username, tokens, is_admin FROM users WHERE id = $1',
    [req.session.userId]
  );
  if (!r.rows.length) {
    req.session.destroy();
    return res.status(401).json({ error: 'Сессия недействительна' });
  }
  res.json(r.rows[0]);
});

app.post('/api/boxes/open', requireAuth, async (req, res) => {
  const { boxType } = req.body || {};
  if (boxType !== 'regular' && boxType !== 'big') {
    return res.status(400).json({ error: 'Укажите boxType: regular или big' });
  }
  const cost = BOX_COST[boxType];
  const client = await pool.connect();
  try {
    const userRow = await client.query(
      'SELECT tokens FROM users WHERE id = $1 FOR UPDATE',
      [req.session.userId]
    );
    if (!userRow.rows.length) return res.status(401).end();
    const tokens = userRow.rows[0].tokens;
    if (tokens < cost) {
      return res.status(400).json({
        error: 'Недостаточно жетонов',
        tokens,
        required: cost,
      });
    }
    const brawler = pickBrawler(boxType);
    const skipDz = rollSkipDZ(boxType);
    const rarity = normRarity(brawler.rarity);
    await client.query(
      'UPDATE users SET tokens = tokens - $1 WHERE id = $2',
      [cost, req.session.userId]
    );
    const hasBrawler = await client.query(
      'SELECT 1 FROM user_brawlers WHERE user_id = $1 AND brawler_id = $2 LIMIT 1',
      [req.session.userId, brawler.id]
    );
    if (hasBrawler.rows.length === 0) {
      await client.query(
        'INSERT INTO user_brawlers (user_id, brawler_id, brawler_name, rarity) VALUES ($1, $2, $3, $4)',
        [req.session.userId, brawler.id, brawler.name, rarity]
      );
    }
    const newTokens = tokens - cost;
    res.json({
      brawler: {
        id: brawler.id,
        name: brawler.name,
        rarity,
      },
      skipDz,
      tokens: newTokens,
    });
  } finally {
    client.release();
  }
});

app.get('/api/brawlers', requireAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT brawler_id, brawler_name, rarity, MIN(created_at) AS created_at
     FROM user_brawlers WHERE user_id = $1
     GROUP BY brawler_id, brawler_name, rarity
     ORDER BY created_at DESC`,
    [req.session.userId]
  );
  res.json(r.rows);
});

app.get('/api/leaderboard', async (req, res) => {
  const r = await pool.query(`
    SELECT u.id, u.username, COUNT(DISTINCT ub.brawler_id) AS brawlers_count
    FROM users u
    LEFT JOIN user_brawlers ub ON u.id = ub.user_id
    GROUP BY u.id, u.username
    ORDER BY brawlers_count DESC
    LIMIT 50
  `);
  res.json(r.rows);
});

// ——— Admin API (только для is_admin) ———
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const r = await pool.query(
    'SELECT id, username, tokens, is_admin, created_at FROM users ORDER BY id'
  );
  res.json(r.rows);
});

app.patch('/api/admin/users/:id/tokens', requireAuth, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { delta, tokens: setTokens } = req.body || {};
  if (userId <= 0 || !Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Некорректный id пользователя' });
  }
  if (setTokens !== undefined) {
    const val = parseInt(setTokens, 10);
    if (!Number.isInteger(val) || val < 0) {
      return res.status(400).json({ error: 'Жетоны должны быть неотрицательным числом' });
    }
    const r = await pool.query(
      'UPDATE users SET tokens = $1 WHERE id = $2 RETURNING id, username, tokens',
      [val, userId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
    return res.json(r.rows[0]);
  }
  if (delta === undefined || !Number.isInteger(delta)) {
    return res.status(400).json({ error: 'Укажите delta (число) или tokens (новое значение)' });
  }
  const r = await pool.query(
    'UPDATE users SET tokens = GREATEST(0, tokens + $1) WHERE id = $2 RETURNING id, username, tokens',
    [delta, userId]
  );
  if (!r.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json(r.rows[0]);
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || username.length < 2 || password.length < 4) {
    return res.status(400).json({ error: 'Логин от 2 символов, пароль от 4' });
  }
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, tokens, is_admin) VALUES ($1, $2, $3, false) RETURNING id, username, tokens, is_admin',
      [username.trim(), hash, INITIAL_TOKENS]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Такой логин уже занят' });
    throw e;
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (userId <= 0 || !Number.isInteger(userId)) {
    return res.status(400).json({ error: 'Некорректный id пользователя' });
  }
  if (userId === req.session.userId) {
    return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  }
  const r = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [userId]);
  if (!r.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
  res.json({ ok: true, deletedId: userId });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

async function start() {
  try {
    await initDb();
    console.log('DB ready');
  } catch (e) {
    console.error('DB init error', e);
    process.exit(1);
  }
  app.listen(PORT, '0.0.0.0', () => {
    console.log('Server on port', PORT);
  });
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});
