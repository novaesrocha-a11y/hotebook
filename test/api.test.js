const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

const projectRoot = path.join(__dirname, '..');
let temporaryDirectory;
let serverProcess;
let origin;
let sessionCookie = '';

async function findAvailablePort() {
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const { port } = probe.address();
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
    return port;
}

async function waitForServer() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        try {
            const response = await fetch(`${origin}/api/health`);
            if (response.ok) return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }
    throw new Error('A API de teste não iniciou a tempo.');
}

async function api(pathname, { method = 'GET', body, authenticated = true } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (authenticated && sessionCookie) headers.Cookie = sessionCookie;
    const response = await fetch(`${origin}${pathname}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) sessionCookie = setCookie.split(';')[0];
    return response;
}

before(async () => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hotelbook-api-'));
    const port = await findAvailablePort();
    origin = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, ['server/server.js'], {
        cwd: projectRoot,
        env: {
            ...process.env,
            PORT: String(port),
            DATABASE_PATH: path.join(temporaryDirectory, 'test.sqlite'),
            SESSION_SECRET: 'test-only-session-secret',
            ADMIN_EMAIL: 'admin@test.hotelbook',
            ADMIN_PASSWORD: 'Admin-Test-123!',
            DEMO_CLIENT_EMAIL: 'cliente@test.hotelbook',
            DEMO_CLIENT_PASSWORD: 'Cliente-Test-123!'
        },
        stdio: 'ignore'
    });
    await waitForServer();
});

after(async () => {
    if (serverProcess && serverProcess.exitCode === null) {
        const exited = once(serverProcess, 'exit');
        serverProcess.kill();
        await exited;
    }
    if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('autentica perfis, protege rotas e persiste operações do inventário', async () => {
    assert.deepEqual(await (await api('/api/health', { authenticated: false })).json(), { status: 'ok' });
    assert.equal((await api('/api/admin/rooms', { authenticated: false })).status, 401);

    const registration = await api('/api/auth/register', {
        method: 'POST',
        authenticated: false,
        body: { name: 'Pessoa de Teste', email: 'pessoa@test.hotelbook', password: 'Cadastro-123!' }
    });
    assert.equal(registration.status, 201);
    assert.equal((await (await api('/api/me')).json()).user.email, 'pessoa@test.hotelbook');

    const duplicate = await api('/api/auth/register', {
        method: 'POST',
        authenticated: false,
        body: { name: 'Outra Pessoa', email: 'pessoa@test.hotelbook', password: 'Cadastro-123!' }
    });
    assert.equal(duplicate.status, 409);

    assert.equal((await api('/api/auth/logout', { method: 'POST' })).status, 204);
    sessionCookie = '';
    assert.equal((await api('/api/me', { authenticated: false })).status, 401);

    const clientLogin = await api('/api/auth/login', {
        method: 'POST',
        authenticated: false,
        body: { role: 'cliente', email: 'cliente@test.hotelbook', password: 'Cliente-Test-123!' }
    });
    assert.equal(clientLogin.status, 200);
    const reservations = await api('/api/reservations');
    assert.equal((await reservations.json()).reservations.length, 2);
    assert.equal((await api('/api/admin/rooms')).status, 403);

    await api('/api/auth/logout', { method: 'POST' });
    sessionCookie = '';
    const adminLogin = await api('/api/auth/login', {
        method: 'POST',
        authenticated: false,
        body: { role: 'administrador', email: 'admin@test.hotelbook', password: 'Admin-Test-123!' }
    });
    assert.equal(adminLogin.status, 200);
    const initialRooms = await api('/api/admin/rooms');
    assert.equal((await initialRooms.json()).rooms.length, 4);

    const created = await api('/api/admin/rooms', {
        method: 'POST',
        body: { name: 'Quarto de Teste', category: 'Standard', capacity: 2, price: 525, status: 'disponivel' }
    });
    assert.equal(created.status, 201);
    const createdRoom = (await created.json()).room;
    const updated = await api(`/api/admin/rooms/${createdRoom.id}`, {
        method: 'PATCH',
        body: { ...createdRoom, name: 'Quarto Atualizado' }
    });
    assert.equal((await updated.json()).room.name, 'Quarto Atualizado');
    assert.equal((await api(`/api/admin/rooms/${createdRoom.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await api(`/api/admin/rooms/${createdRoom.id}`, { method: 'DELETE' })).status, 404);
});