'use strict';
/* SGI Almoxarifado · Monitoramento de Aplicações
   Servidor próprio: login real, perfis (administradora x visualização), banco de dados e site estático. */
const express = require('express'), crypto = require('crypto'), fs = require('fs'), path = require('path'), bcrypt = require('bcryptjs');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('[aviso] Defina SESSION_SECRET. Sem ela, todos precisam entrar de novo a cada reinício do servidor.');
const SETUP = process.env.SETUP_CODE || '';
const ADMIN = { mat: String(process.env.ADMIN_MAT || '5761'), nome: String(process.env.ADMIN_NAME || 'BIANCA SANTOS').toUpperCase() };
const TITLE = process.env.SITE_TITLE || 'SGI Monitoramento de Aplicações · R&D';
const ANALYTICS = process.env.ANALYTICS_HTML || '';

/* ---------- armazenamento: Postgres (DATABASE_URL) ou arquivo JSON (DATA_DIR) ---------- */
function fileStore() {
  const dir = process.env.DATA_DIR || path.join(__dirname, 'data'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'data.json'); let m = {}; try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) {}
  let t = null; const flush = () => { clearTimeout(t); t = setTimeout(() => fs.writeFile(f + '.tmp', JSON.stringify(m), e => { if (!e) fs.rename(f + '.tmp', f, () => {}); }), 200); };
  return {
    async get(p) { return m[p] === undefined ? null : m[p]; },
    async set(p, v) { m[p] = v; flush(); },
    async del(p) { delete m[p]; flush(); },
    async list(prefix) { return Object.keys(m).filter(k => k.startsWith(prefix)).map(k => [k, m[k]]); }
  };
}
function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } });
  const ready = pool.query('create table if not exists docs(path text primary key, data jsonb not null, updated_at timestamptz default now())');
  return {
    async get(p) { await ready; const r = await pool.query('select data from docs where path=$1', [p]); return r.rows[0] ? r.rows[0].data : null; },
    async set(p, v) { await ready; await pool.query('insert into docs(path,data) values($1,$2) on conflict(path) do update set data=$2, updated_at=now()', [p, JSON.stringify(v)]); },
    async del(p) { await ready; await pool.query('delete from docs where path=$1', [p]); },
    async list(prefix) { await ready; const r = await pool.query('select path,data from docs where path like $1', [prefix.replace(/[\\%_]/g, '\\$&') + '%']); return r.rows.map(x => [x.path, x.data]); }
  };
}
const DB = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore();

/* ---------- utilidades de acesso ---------- */
const mk = v => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d ? (d.replace(/^0+/, '') || '0') : ''; };
const b64 = s => Buffer.from(s).toString('base64url');
const sign = o => { const b = b64(JSON.stringify(o)); return b + '.' + crypto.createHmac('sha256', SECRET).update(b).digest('base64url'); };
const verify = t => {
  if (!t || t.indexOf('.') < 0) return null; const [b, s] = t.split('.'); const e = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  if (s.length !== e.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const o = JSON.parse(Buffer.from(b, 'base64url').toString()); return o.exp > Date.now() ? o : null; } catch (e2) { return null; }
};
const cookie = (req, k) => { const c = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(k + '=')); return c ? decodeURIComponent(c.slice(k.length + 1)) : ''; };
const secure = req => req.secure || req.headers['x-forwarded-proto'] === 'https';
const setSess = (req, res, u, keep) => { const ms = keep ? 7 * 864e5 : 12 * 36e5; res.setHeader('Set-Cookie', `sgi=${encodeURIComponent(sign({ mat: u.mat, exp: Date.now() + ms }))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(ms / 1000)}${secure(req) ? '; Secure' : ''}`); };
const pub = u => ({ mat: u.mat, nome: u.nome, role: u.role });
const userDoc = async mat => DB.get('users/' + mat);

const fails = new Map();
const locked = k => { const f = fails.get(k); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; };
const fail = k => { const f = fails.get(k) || { n: 0, until: 0 }; f.n++; if (f.n >= 8) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(k, f); };
const ok = k => fails.delete(k);

const app = express(); app.set('trust proxy', 1); app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
app.use(async (req, res, next) => {
  req.user = null; const p = verify(cookie(req, 'sgi'));
  if (p) { try { const u = await userDoc(p.mat); if (u && u.status === 'ativo') req.user = u; } catch (e) {} }
  next();
});
const needAuth = (req, res, next) => req.user ? next() : res.status(401).json({ erro: 'Faça login para continuar.' });
const needAdmin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : res.status(403).json({ erro: 'Somente a administradora pode fazer isso.' });
const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ erro: 'Erro interno do servidor.' }); });
const pwOk = s => typeof s === 'string' && s.length >= 6 && s.length <= 100;
const nameOk = s => typeof s === 'string' && s.trim().length >= 5 && s.trim().length <= 80 && s.includes(' ');

/* ---------- autenticação ---------- */
app.get('/api/me', wrap(async (req, res) => {
  const admin = await userDoc(mk(ADMIN.mat));
  res.json({ user: req.user ? pub(req.user) : null, needsSetup: !admin });
}));
app.post('/api/setup', wrap(async (req, res) => {
  if (await userDoc(mk(ADMIN.mat))) return res.status(409).json({ erro: 'A administradora já foi cadastrada.' });
  if (!SETUP) return res.status(503).json({ erro: 'O servidor ainda não tem o SETUP_CODE configurado.' });
  const { code, senha } = req.body || {}; const key = 'setup|' + req.ip;
  if (locked(key)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  const a = Buffer.from(String(code || '')), b = Buffer.from(SETUP);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) { fail(key); return res.status(403).json({ erro: 'Código de ativação incorreto.' }); }
  if (!pwOk(senha)) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  const u = { mat: mk(ADMIN.mat), nome: ADMIN.nome, role: 'admin', status: 'ativo', hash: await bcrypt.hash(senha, 10), ts: new Date().toISOString() };
  await DB.set('users/' + u.mat, u); setSess(req, res, u, false); res.json({ user: pub(u) });
}));
app.post('/api/login', wrap(async (req, res) => {
  const { mat, senha, keep } = req.body || {}, m = mk(mat), key = 'login|' + req.ip + '|' + m;
  if (locked(key)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  const u = m ? await userDoc(m) : null; const hash = u ? u.hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
  const okp = await bcrypt.compare(String(senha || ''), hash);
  if (!u || !okp) { fail(key); return res.status(401).json({ erro: 'Matrícula ou senha incorretos.' }); }
  if (u.status !== 'ativo') return res.status(403).json({ erro: 'Seu cadastro ainda aguarda a aprovação da administradora.' });
  ok(key); setSess(req, res, u, !!keep); res.json({ user: pub(u) });
}));
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'sgi=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.post('/api/register', wrap(async (req, res) => {
  const { nome, mat, senha } = req.body || {}, m = mk(mat), key = 'reg|' + req.ip;
  if (locked(key)) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
  fail(key);
  if (!nameOk(nome)) return res.status(400).json({ erro: 'Informe o nome completo.' });
  if (!/^\d{1,12}$/.test(m)) return res.status(400).json({ erro: 'Informe a matrícula (somente números).' });
  if (!pwOk(senha)) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (m === mk(ADMIN.mat) || await userDoc(m)) return res.status(409).json({ erro: 'Esta matrícula já possui cadastro. Use "Entrar".' });
  await DB.set('users/' + m, { mat: m, nome: nome.replace(/\s+/g, ' ').trim().toUpperCase(), role: 'viewer', status: 'pendente', hash: await bcrypt.hash(senha, 10), ts: new Date().toISOString() });
  res.json({ ok: true });
}));

/* ---------- administração de acessos (somente administradora) ---------- */
const strip = u => ({ mat: u.mat, nome: u.nome, role: u.role, status: u.status, ts: u.ts });
app.get('/api/admin/users', needAdmin, wrap(async (req, res) => { const L = (await DB.list('users/')).map(x => strip(x[1])).sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1) || a.nome.localeCompare(b.nome)); res.json({ users: L.filter(x => x.status === 'ativo'), pending: L.filter(x => x.status === 'pendente') }); }));
app.post('/api/admin/users', needAdmin, wrap(async (req, res) => {
  const { mat, nome, senha } = req.body || {}, m = mk(mat);
  if (!/^\d{1,12}$/.test(m) || !nameOk(nome) && String(nome || '').trim().length < 3 || !pwOk(senha)) return res.status(400).json({ erro: 'Confira matrícula, nome e senha (mínimo de 6 caracteres).' });
  if (await userDoc(m)) return res.status(409).json({ erro: 'Essa matrícula já tem cadastro.' });
  await DB.set('users/' + m, { mat: m, nome: String(nome).replace(/\s+/g, ' ').trim().toUpperCase(), role: 'viewer', status: 'ativo', hash: await bcrypt.hash(senha, 10), ts: new Date().toISOString() }); res.json({ ok: true });
}));
app.post('/api/admin/users/:mat/reset', needAdmin, wrap(async (req, res) => { const u = await userDoc(mk(req.params.mat)); if (!u) return res.status(404).json({ erro: 'Pessoa não encontrada.' }); if (!pwOk((req.body || {}).senha)) return res.status(400).json({ erro: 'A senha precisa ter pelo menos 6 caracteres.' }); u.hash = await bcrypt.hash(req.body.senha, 10); await DB.set('users/' + u.mat, u); res.json({ ok: true }); }));
app.delete('/api/admin/users/:mat', needAdmin, wrap(async (req, res) => { const m = mk(req.params.mat); if (m === mk(ADMIN.mat)) return res.status(400).json({ erro: 'A administradora não pode ser removida.' }); await DB.del('users/' + m); res.json({ ok: true }); }));
app.post('/api/admin/approve', needAdmin, wrap(async (req, res) => { const u = await userDoc(mk((req.body || {}).mat)); if (!u || u.status !== 'pendente') return res.status(404).json({ erro: 'Solicitação não encontrada.' }); u.status = 'ativo'; u.role = 'viewer'; if ((req.body || {}).nome) u.nome = String(req.body.nome).toUpperCase().slice(0, 80); await DB.set('users/' + u.mat, u); res.json({ ok: true }); }));
app.post('/api/admin/reject', needAdmin, wrap(async (req, res) => { const u = await userDoc(mk((req.body || {}).mat)); if (u && u.status === 'pendente') await DB.del('users/' + u.mat); res.json({ ok: true }); }));

/* ---------- banco de dados do painel (compatível com o painel) ---------- */
const okPath = p => typeof p === 'string' && /^[A-Za-z0-9_\-\/.]{1,120}$/.test(p) && !p.includes('..') && !p.startsWith('/') && !p.endsWith('/');
const canRead = (u, p) => !!u && (p.startsWith('controle/') || (u.role === 'admin' && (p.startsWith('bk/') || p.startsWith('logs/'))));
const canWrite = (u, p) => !!u && ((u.role === 'admin' && (p.startsWith('controle/') || p.startsWith('bk/'))) || p === 'logs/' + u.mat);
app.get('/api/db/doc', needAuth, wrap(async (req, res) => { const p = req.query.path; if (!okPath(p)) return res.status(400).json({ erro: 'Caminho inválido.' }); if (!canRead(req.user, p)) return res.status(403).json({ erro: 'Sem permissão para ler.' }); const d = await DB.get('d/' + p); res.json(d === null ? { exists: false } : { exists: true, data: d }); }));
app.post('/api/db/doc', needAuth, wrap(async (req, res) => { const { path: p, data } = req.body || {}; if (!okPath(p) || data === undefined) return res.status(400).json({ erro: 'Dados inválidos.' }); if (!canWrite(req.user, p)) return res.status(403).json({ erro: 'Sem permissão para gravar.' }); await DB.set('d/' + p, data); res.json({ ok: true }); }));
app.delete('/api/db/doc', needAuth, wrap(async (req, res) => { const p = req.query.path; if (!okPath(p)) return res.status(400).json({ erro: 'Caminho inválido.' }); if (!canWrite(req.user, p)) return res.status(403).json({ erro: 'Sem permissão.' }); await DB.del('d/' + p); res.json({ ok: true }); }));
app.get('/api/db/col', needAuth, wrap(async (req, res) => {
  const p = req.query.path; if (!okPath(p)) return res.status(400).json({ erro: 'Caminho inválido.' });
  if (!canRead(req.user, p + '/x')) return res.status(403).json({ erro: 'Sem permissão para ler.' });
  const pre = 'd/' + p + '/', L = (await DB.list(pre)).filter(x => !x[0].slice(pre.length).includes('/')).map(x => ({ id: x[0].slice(pre.length), data: x[1] })); res.json({ docs: L });
}));

/* ---------- site ---------- */
const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace('{{TITLE}}', TITLE.replace(/&/g, '&amp;').replace(/</g, '&lt;')).replace('<!--ANALYTICS-->', ANALYTICS);
app.get(['/', '/index.html'], (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('html').send(INDEX); });
app.get('/manifest.webmanifest', (req, res) => res.json({ name: TITLE, short_name: 'SGI R&D', start_url: '/', display: 'standalone', background_color: '#111111', theme_color: '#111111', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }));
app.use(express.static(path.join(__dirname, 'public'), { index: false, maxAge: '7d' }));
app.get('/healthz', (req, res) => res.send('ok'));
app.use((req, res) => res.status(404).json({ erro: 'Não encontrado.' }));
app.listen(PORT, () => console.log('SGI Monitoramento no ar na porta ' + PORT));
