const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const projectRoot = path.join(__dirname, '..');
const dataDirectory = path.join(__dirname, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const production = process.env.NODE_ENV === 'production';
if (production && (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD || !process.env.DEMO_CLIENT_PASSWORD)) {
    throw new Error('Em produção, defina SESSION_SECRET, ADMIN_PASSWORD e DEMO_CLIENT_PASSWORD.');
}

const settings = {
    port: Number(process.env.PORT) || 3000,
    sessionSecret: process.env.SESSION_SECRET || 'hotelbook-local-session-secret-change-before-deploy',
    adminEmail: (process.env.ADMIN_EMAIL || 'admin@hotelbook.com').trim().toLowerCase(),
    adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
    clientEmail: (process.env.DEMO_CLIENT_EMAIL || 'cliente@hotelbook.com').trim().toLowerCase(),
    clientPassword: process.env.DEMO_CLIENT_PASSWORD || 'Estadia#2026!',
    databasePath: process.env.DATABASE_PATH || path.join(dataDirectory, 'hotelbook.sqlite')
};

const db = new Database(settings.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('cliente', 'administrador')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 4),
        price REAL NOT NULL CHECK (price > 0),
        status TEXT NOT NULL CHECK (status IN ('disponivel', 'ocupado', 'manutencao'))
    );
    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        hotel TEXT NOT NULL,
        location TEXT NOT NULL,
        check_in TEXT NOT NULL,
        check_out TEXT NOT NULL,
        nights INTEGER NOT NULL,
        guests INTEGER NOT NULL,
        category TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('confirmada', 'pendente')),
        image_url TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS reservations_by_account ON reservations(account_id);
`);

function seedAccount(name, email, password, role) {
    const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(email);
    if (existing) return existing.id;
    const passwordHash = bcrypt.hashSync(password, 10);
    return Number(db.prepare('INSERT INTO accounts (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, passwordHash, role).lastInsertRowid);
}

const adminId = seedAccount('Administrador', settings.adminEmail, settings.adminPassword, 'administrador');
const clientId = seedAccount('Cliente HotelBook', settings.clientEmail, settings.clientPassword, 'cliente');

if (db.prepare('SELECT COUNT(*) AS count FROM rooms').get().count === 0) {
    const addRoom = db.prepare('INSERT INTO rooms (name, category, capacity, price, status) VALUES (?, ?, ?, ?, ?)');
    const seedRooms = db.transaction(() => {
        addRoom.run('Quarto 101', 'Luxo', 2, 620, 'disponivel');
        addRoom.run('Quarto 204', 'Superior', 2, 480, 'ocupado');
        addRoom.run('Suíte Jardim', 'Suíte', 4, 890, 'disponivel');
        addRoom.run('Quarto 305', 'Standard', 1, 350, 'manutencao');
    });
    seedRooms();
}

if (db.prepare('SELECT COUNT(*) AS count FROM reservations').get().count === 0) {
    const addReservation = db.prepare(`INSERT INTO reservations
        (code, account_id, hotel, location, check_in, check_out, nights, guests, category, status, image_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const seedReservations = db.transaction(() => {
        addReservation.run('HB-20481', clientId, 'Hotel Vista Mar', 'Rio de Janeiro, RJ', '2026-12-12', '2026-12-15', 3, 2, 'Suíte Vista Mar', 'confirmada', 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=480&q=80');
        addReservation.run('HB-20736', clientId, 'Grand Hotel Serra', 'Campos do Jordão, SP', '2027-01-20', '2027-01-22', 2, 2, 'Quarto Superior', 'pendente', 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=480&q=80');
    });
    seedReservations();
}

class SQLiteSessionStore extends session.Store {
    constructor(database) {
        super();
        this.database = database;
        this.readSession = database.prepare('SELECT data, expires_at FROM sessions WHERE id = ?');
        this.writeSession = database.prepare(`INSERT INTO sessions (id, data, expires_at) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at`);
        this.deleteSession = database.prepare('DELETE FROM sessions WHERE id = ?');
        this.deleteExpired = database.prepare('DELETE FROM sessions WHERE expires_at <= ?');
    }

    get(id, callback) {
        try {
            const row = this.readSession.get(id);
            if (!row) return callback(null, null);
            if (row.expires_at <= Date.now()) {
                this.deleteSession.run(id);
                return callback(null, null);
            }
            callback(null, JSON.parse(row.data));
        } catch (error) {
            callback(error);
        }
    }

    set(id, data, callback = () => {}) {
        try {
            const expiry = data.cookie?.expires ? new Date(data.cookie.expires).getTime() : Date.now() + 86400000;
            this.writeSession.run(id, JSON.stringify(data), expiry);
            this.deleteExpired.run(Date.now());
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    touch(id, data, callback = () => {}) {
        this.set(id, data, callback);
    }

    destroy(id, callback = () => {}) {
        try {
            this.deleteSession.run(id);
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
}

const app = express();
app.disable('x-powered-by');
if (production) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(session({
    name: 'hotelbook.sid',
    secret: settings.sessionSecret,
    store: new SQLiteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 86400000 }
}));

function publicAccount(account) {
    return { id: account.id, name: account.name, email: account.email, role: account.role };
}

function requireAuth(req, res, next) {
    const accountId = req.session.accountId;
    if (!accountId) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
    const account = db.prepare('SELECT id, name, email, role FROM accounts WHERE id = ?').get(accountId);
    if (!account) {
        return req.session.destroy(() => res.status(401).json({ error: 'Sessão inválida. Entre novamente.' }));
    }
    req.account = account;
    next();
}

function requireAdmin(req, res, next) {
    if (req.account.role !== 'administrador') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    next();
}

function validateRoom(body) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const capacity = Number(body.capacity);
    const price = Number(body.price);
    const status = body.status;
    if (!name || name.length > 60) return 'Informe o nome do quarto (até 60 caracteres).';
    if (!category || category.length > 40) return 'Informe uma categoria válida.';
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 4) return 'A capacidade deve ser de 1 a 4 hóspedes.';
    if (!Number.isFinite(price) || price <= 0 || price > 1000000) return 'Informe uma diária válida.';
    if (!['disponivel', 'ocupado', 'manutencao'].includes(status)) return 'Estado de quarto inválido.';
    return { name, category, capacity, price, status };
}

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Muitas tentativas de acesso. Aguarde alguns minutos e tente novamente.' }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', async (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Informe um nome entre 2 e 80 caracteres.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres.' });

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = db.prepare('INSERT INTO accounts (name, email, password_hash, role) VALUES (?, ?, ?, ?)').run(name, email, passwordHash, 'cliente');
        const account = db.prepare('SELECT id, name, email, role FROM accounts WHERE id = ?').get(result.lastInsertRowid);
        req.session.regenerate((error) => {
            if (error) return res.status(500).json({ error: 'Não foi possível iniciar a sessão.' });
            req.session.accountId = account.id;
            req.session.save((saveError) => {
                if (saveError) return res.status(500).json({ error: 'Não foi possível salvar a sessão.' });
                res.status(201).json({ user: publicAccount(account) });
            });
        });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Este e-mail já possui cadastro.' });
        throw error;
    }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const requestedRole = req.body.role;
    const account = db.prepare('SELECT id, name, email, password_hash, role FROM accounts WHERE email = ?').get(email);
    const validPassword = account && await bcrypt.compare(password, account.password_hash);
    if (!validPassword || account.role !== requestedRole) return res.status(401).json({ error: 'E-mail, senha ou tipo de acesso inválido.' });

    req.session.regenerate((error) => {
        if (error) return res.status(500).json({ error: 'Não foi possível iniciar a sessão.' });
        req.session.accountId = account.id;
        req.session.save((saveError) => {
            if (saveError) return res.status(500).json({ error: 'Não foi possível salvar a sessão.' });
            res.json({ user: publicAccount(account) });
        });
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((error) => {
        if (error) return res.status(500).json({ error: 'Não foi possível encerrar a sessão.' });
        res.clearCookie('hotelbook.sid', { httpOnly: true, sameSite: 'lax', secure: production });
        res.status(204).end();
    });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: publicAccount(req.account) }));

app.patch('/api/me', requireAuth, (req, res) => {
    if (req.account.role !== 'cliente') return res.status(403).json({ error: 'Somente clientes podem editar este perfil.' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Informe um nome entre 2 e 80 caracteres.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    try {
        db.prepare('UPDATE accounts SET name = ?, email = ? WHERE id = ?').run(name, email, req.account.id);
        res.json({ user: { ...req.account, name, email } });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Este e-mail já está vinculado a outra conta.' });
        throw error;
    }
});

app.get('/api/reservations', requireAuth, (req, res) => {
    if (req.account.role !== 'cliente') return res.status(403).json({ error: 'Reservas disponíveis somente para contas de cliente.' });
    const reservations = db.prepare(`SELECT code, hotel, location, check_in AS checkIn, check_out AS checkOut,
        nights, guests, category, status, image_url AS imageUrl FROM reservations WHERE account_id = ? ORDER BY check_in`).all(req.account.id);
    res.json({ reservations });
});

app.get('/api/admin/rooms', requireAuth, requireAdmin, (req, res) => {
    res.json({ rooms: db.prepare('SELECT id, name, category, capacity, price, status FROM rooms ORDER BY id').all() });
});

app.post('/api/admin/rooms', requireAuth, requireAdmin, (req, res) => {
    const room = validateRoom(req.body);
    if (typeof room === 'string') return res.status(400).json({ error: room });
    const result = db.prepare('INSERT INTO rooms (name, category, capacity, price, status) VALUES (?, ?, ?, ?, ?)').run(room.name, room.category, room.capacity, room.price, room.status);
    res.status(201).json({ room: { id: Number(result.lastInsertRowid), ...room } });
});

app.patch('/api/admin/rooms/:id', requireAuth, requireAdmin, (req, res) => {
    const roomId = Number(req.params.id);
    if (!Number.isInteger(roomId) || roomId < 1) return res.status(400).json({ error: 'Identificador de quarto inválido.' });
    const room = validateRoom(req.body);
    if (typeof room === 'string') return res.status(400).json({ error: room });
    const result = db.prepare('UPDATE rooms SET name = ?, category = ?, capacity = ?, price = ?, status = ? WHERE id = ?').run(room.name, room.category, room.capacity, room.price, room.status, roomId);
    if (!result.changes) return res.status(404).json({ error: 'Quarto não encontrado.' });
    res.json({ room: { id: roomId, ...room } });
});

app.delete('/api/admin/rooms/:id', requireAuth, requireAdmin, (req, res) => {
    const roomId = Number(req.params.id);
    if (!Number.isInteger(roomId) || roomId < 1) return res.status(400).json({ error: 'Identificador de quarto inválido.' });
    const result = db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
    if (!result.changes) return res.status(404).json({ error: 'Quarto não encontrado.' });
    res.status(204).end();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Rota da API não encontrada.' }));

app.get('/', (req, res) => res.sendFile(path.join(projectRoot, 'index.html')));
for (const page of ['index.html', 'cadastro.html', 'perfil.html', 'admin.html']) {
    app.get(`/${page}`, (req, res) => res.sendFile(path.join(projectRoot, page)));
}
app.get('/styles/styles.css', (req, res) => res.sendFile(path.join(projectRoot, 'styles', 'styles.css')));
app.get('/scripts/app.js', (req, res) => res.sendFile(path.join(projectRoot, 'scripts', 'app.js')));

app.use((error, req, res, next) => {
    console.error(error);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: 'Erro interno do servidor.' });
});

const server = app.listen(settings.port, () => {
    console.log(`HotelBook disponível em http://localhost:${settings.port}`);
    if (!production && settings.adminPassword === 'admin123') console.warn('Modo local: troque as senhas padrão antes de publicar.');
});

function shutdown() {
    server.close(() => {
        db.close();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { app, db, server };