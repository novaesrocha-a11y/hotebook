async function apiRequest(url, options = {}) {
    const requestOptions = { ...options, credentials: 'same-origin', headers: { ...options.headers } };
    if (requestOptions.body && typeof requestOptions.body !== 'string') {
        requestOptions.headers['Content-Type'] = 'application/json';
        requestOptions.body = JSON.stringify(requestOptions.body);
    }

    const response = await fetch(url, requestOptions);
    if (response.status === 204) return null;
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
    return payload;
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
    const message = document.getElementById('login-message');
    const accessMessage = new URLSearchParams(location.search).get('acesso');
    if (accessMessage) message.textContent = 'Entre com uma conta do tipo correspondente para acessar essa área.';

    loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(loginForm);
        const submitButton = loginForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        message.textContent = '';
        try {
            const result = await apiRequest('/api/auth/login', {
                method: 'POST',
                body: { role: formData.get('role'), email: formData.get('email'), password: formData.get('password') }
            });
            location.href = result.user.role === 'administrador' ? 'admin.html' : 'perfil.html';
        } catch (error) {
            message.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    });
}

const signupForm = document.getElementById('cadastro-form');
if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(signupForm);
        const message = document.getElementById('signup-message');
        const submitButton = signupForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        message.textContent = '';
        try {
            await apiRequest('/api/auth/register', {
                method: 'POST',
                body: { name: formData.get('name'), email: formData.get('email'), password: formData.get('password') }
            });
            location.href = 'perfil.html';
        } catch (error) {
            message.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    });
}

let clientAccount = null;

async function requireRole(role) {
    try {
        const result = await apiRequest('/api/me');
        if (result.user.role !== role) {
            location.replace(`index.html?acesso=${role}`);
            return null;
        }
        return result.user;
    } catch {
        location.replace(`index.html?acesso=${role}`);
        return null;
    }
}

if (document.getElementById('user-name')) initClient();

async function initClient() {
    clientAccount = await requireRole('cliente');
    if (!clientAccount) return;
    updateClientProfile(clientAccount);
    setupReservationFilters();
    setupProfileEditor();
    try {
        const result = await apiRequest('/api/reservations');
        renderReservations(result.reservations);
    } catch (error) {
        const emptyState = document.getElementById('reservation-empty');
        emptyState.hidden = false;
        emptyState.textContent = error.message;
    }
}

function setupReservationFilters() {
    document.querySelectorAll('[data-reservation-filter]').forEach((button) => {
        button.addEventListener('click', () => {
            const selectedFilter = button.dataset.reservationFilter;
            document.querySelectorAll('[data-reservation-filter]').forEach((filterButton) => {
                const isActive = filterButton === button;
                filterButton.classList.toggle('active', isActive);
                filterButton.setAttribute('aria-pressed', String(isActive));
            });
            document.querySelectorAll('[data-reservation-status]').forEach((reservation) => {
                reservation.hidden = selectedFilter !== 'todas' && reservation.dataset.reservationStatus !== selectedFilter;
            });
        });
    });
}

function renderReservations(reservations) {
    const container = document.getElementById('client-reservations');
    const emptyState = document.getElementById('reservation-empty');
    const counts = {
        todas: reservations.length,
        confirmada: reservations.filter((reservation) => reservation.status === 'confirmada').length,
        pendente: reservations.filter((reservation) => reservation.status === 'pendente').length
    };
    const destinationCount = new Set(reservations.map((reservation) => reservation.location)).size;
    document.getElementById('upcoming-count').textContent = counts.todas;
    document.getElementById('confirmed-count').textContent = counts.confirmada;
    document.getElementById('destination-count').textContent = `${destinationCount} ${destinationCount === 1 ? 'destino' : 'destinos'}`;
    document.querySelectorAll('[data-reservation-filter]').forEach((button) => {
        button.querySelector('span').textContent = counts[button.dataset.reservationFilter];
    });
    container.replaceChildren(...reservations.map(createReservationElement));
    emptyState.hidden = reservations.length > 0;
}

function createReservationElement(reservation) {
    const article = document.createElement('article');
    article.className = 'client-reservation';
    article.dataset.reservationStatus = reservation.status;
    const image = document.createElement('img');
    image.src = reservation.imageUrl;
    image.alt = `Imagem de ${reservation.hotel}`;
    image.loading = 'lazy';
    const main = document.createElement('div');
    main.className = 'stay-main';
    main.innerHTML = '<p class="stay-reference"></p><h3></h3><p class="stay-location"></p>';
    main.querySelector('.stay-reference').textContent = `RESERVA ${reservation.code}`;
    main.querySelector('h3').textContent = reservation.hotel;
    main.querySelector('.stay-location').textContent = `${reservation.location} · ${reservation.guests} ${reservation.guests === 1 ? 'hóspede' : 'hóspedes'}`;
    const dates = document.createElement('div');
    dates.className = 'stay-dates';
    dates.innerHTML = '<span>CHECK-IN</span><strong></strong><small></small>';
    dates.querySelector('strong').textContent = formatReservationDate(reservation.checkIn);
    dates.querySelector('small').textContent = `${formatReservationDate(reservation.checkOut)} · ${reservation.nights} ${reservation.nights === 1 ? 'noite' : 'noites'}`;
    const status = document.createElement('div');
    status.className = 'stay-status';
    const badge = document.createElement('span');
    badge.className = `badge ${reservation.status === 'confirmada' ? 'success' : 'warning'}`;
    badge.textContent = reservation.status === 'confirmada' ? 'Confirmada' : 'Aguardando confirmação';
    const category = document.createElement('span');
    category.className = 'stay-category';
    category.textContent = reservation.category;
    status.append(badge, category);
    article.append(image, main, dates, status);
    return article;
}

function formatReservationDate(date) {
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
        .format(new Date(`${date}T12:00:00`)).replace('.', '');
}

function setupProfileEditor() {
    const profileDialog = document.getElementById('profile-dialog');
    const closeProfileDialog = () => profileDialog.close();
    document.getElementById('close-profile-dialog').addEventListener('click', closeProfileDialog);
    document.getElementById('cancel-profile-dialog').addEventListener('click', closeProfileDialog);
    document.getElementById('profile-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const message = document.getElementById('profile-message');
        const submitButton = event.currentTarget.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        message.textContent = '';
        try {
            const result = await apiRequest('/api/me', {
                method: 'PATCH',
                body: { name: formData.get('name'), email: formData.get('email') }
            });
            clientAccount = result.user;
            updateClientProfile(clientAccount);
            profileDialog.close();
        } catch (error) {
            message.textContent = error.message;
        } finally {
            submitButton.disabled = false;
        }
    });
}

const roomTable = document.getElementById('room-table');
if (roomTable) initAdmin();

async function logout() {
    try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
    } finally {
        location.href = 'index.html';
    }
}

function editProfile() {
    if (!clientAccount) return;
    document.getElementById('profile-name-input').value = clientAccount.name;
    document.getElementById('profile-email-input').value = clientAccount.email;
    document.getElementById('profile-message').textContent = '';
    document.getElementById('profile-dialog').showModal();
}

function updateClientProfile(account) {
    document.getElementById('user-name').textContent = account.name;
    document.getElementById('user-email').textContent = account.email;
    document.getElementById('profile-name').textContent = account.name;
    document.getElementById('header-user-name').textContent = account.name.split(' ')[0];
    document.getElementById('user-initials').textContent = account.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

async function initAdmin() {
    const account = await requireRole('administrador');
    if (!account) return;
    const roomDialog = document.getElementById('room-dialog');
    const roomForm = document.getElementById('room-form');
    const roomSearch = document.getElementById('room-search');
    const roomFilter = document.getElementById('room-filter');
    const feedback = document.getElementById('admin-feedback');
    let rooms = [];

    document.getElementById('admin-date').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

    const renderRooms = () => {
        const searchTerm = roomSearch.value.trim().toLocaleLowerCase('pt-BR');
        const statusFilter = roomFilter.value;
        const visibleRooms = rooms.filter((room) => {
            const matchesSearch = `${room.name} ${room.category}`.toLocaleLowerCase('pt-BR').includes(searchTerm);
            return matchesSearch && (statusFilter === 'todos' || room.status === statusFilter);
        });

        roomTable.innerHTML = visibleRooms.map((room) => `<tr>
            <td><span class="room-name">${escapeHTML(room.name)}</span><span class="room-id">ID ${String(room.id).padStart(3, '0')}</span></td>
            <td>${escapeHTML(room.category)}</td>
            <td>${room.capacity} ${room.capacity === 1 ? 'hóspede' : 'hóspedes'}</td>
            <td class="price-cell">${formatCurrency(room.price)} <small>/ noite</small></td>
            <td><span class="room-status status-${room.status}"><span></span>${statusLabel(room.status)}</span></td>
            <td class="room-actions"><button type="button" class="table-action" data-action="edit" data-id="${room.id}" aria-label="Editar ${escapeHTML(room.name)}">Editar</button><button type="button" class="table-action delete-action" data-action="delete" data-id="${room.id}" aria-label="Remover ${escapeHTML(room.name)}">Remover</button></td>
        </tr>`).join('');
        document.getElementById('empty-rooms').hidden = visibleRooms.length > 0;
        document.getElementById('metric-total').textContent = rooms.length;
        document.getElementById('metric-available').textContent = rooms.filter((room) => room.status === 'disponivel').length;
        document.getElementById('metric-occupied').textContent = rooms.filter((room) => room.status === 'ocupado').length;
        document.getElementById('metric-maintenance').textContent = rooms.filter((room) => room.status === 'manutencao').length;
    };

    const reloadRooms = async () => {
        const result = await apiRequest('/api/admin/rooms');
        rooms = result.rooms;
        renderRooms();
    };
    const showError = (error) => {
        feedback.textContent = error.message;
        feedback.classList.add('error');
    };
    const closeDialog = () => roomDialog.close();
    const openDialog = (room) => {
        roomForm.reset();
        document.getElementById('room-id').value = room ? room.id : '';
        document.getElementById('room-name').value = room ? room.name : '';
        document.getElementById('room-category').value = room ? room.category : 'Standard';
        document.getElementById('room-capacity').value = room ? String(room.capacity) : '2';
        document.getElementById('room-price').value = room ? room.price : '';
        document.getElementById('room-status').value = room ? room.status : 'disponivel';
        document.getElementById('room-dialog-title').textContent = room ? 'Editar quarto' : 'Adicionar quarto';
        roomDialog.showModal();
        document.getElementById('room-name').focus();
    };

    document.getElementById('add-room-button').addEventListener('click', () => openDialog(null));
    document.getElementById('close-room-dialog').addEventListener('click', closeDialog);
    document.getElementById('cancel-room-dialog').addEventListener('click', closeDialog);
    roomSearch.addEventListener('input', renderRooms);
    roomFilter.addEventListener('change', renderRooms);
    roomTable.addEventListener('click', async (event) => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const room = rooms.find((item) => item.id === Number(button.dataset.id));
        if (!room) return;
        if (button.dataset.action === 'edit') openDialog(room);
        if (button.dataset.action === 'delete' && confirm(`Remover ${room.name} do inventário?`)) {
            try {
                await apiRequest(`/api/admin/rooms/${room.id}`, { method: 'DELETE' });
                feedback.classList.remove('error');
                feedback.textContent = `${room.name} foi removido.`;
                await reloadRooms();
            } catch (error) {
                showError(error);
            }
        }
    });
    roomForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const formData = new FormData(roomForm);
        const roomId = Number(formData.get('id'));
        const room = {
            name: String(formData.get('name')).trim(),
            category: String(formData.get('category')),
            capacity: Number(formData.get('capacity')),
            price: Number(formData.get('price')),
            status: String(formData.get('status'))
        };
        const submitButton = roomForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        try {
            const result = await apiRequest(roomId ? `/api/admin/rooms/${roomId}` : '/api/admin/rooms', {
                method: roomId ? 'PATCH' : 'POST',
                body: room
            });
            feedback.classList.remove('error');
            feedback.textContent = roomId ? `${result.room.name} foi atualizado.` : `${result.room.name} foi adicionado.`;
            closeDialog();
            await reloadRooms();
        } catch (error) {
            showError(error);
        } finally {
            submitButton.disabled = false;
        }
    });

    try {
        await reloadRooms();
    } catch (error) {
        showError(error);
    }
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

function statusLabel(status) {
    return { disponivel: 'Disponível', ocupado: 'Ocupado', manutencao: 'Manutenção' }[status] || status;
}