// ===== SUPABASE ТОХИРГОО =====
// SUPABASE_URL, SUPABASE_ANON_KEY, WORKER_URL, WORKER_SECRET, R2_PUBLIC_URL → config.js-с авна
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ===== ДОТООД ӨГӨГДЛИЙН ХАДГАЛАЛТ =====
let movies = [];
let users = [];
let requests = [];
let currentUser = JSON.parse(sessionStorage.getItem('nova_current_user')) || null;
let currentSelectedMovieId = null;
let tempSelectedAvatarUrl = '';
let currentActiveCategory = 'all';
let tempSelectedVideoFile = '';   // R2 public URL болно
let tempSelectedCoverFile = '';   // R2 public URL болно
let tempSelectedEpThumb = '';     // R2 public URL болно
let adminSelectedSeriesId = null;
let adminEditingMovieId = null;
let adminActiveTab = 'moviesTab';
let confirmCallback = null;

// ===== UTILITY: DEBOUNCE =====
function debounce(fn, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ===== UTILITY: XSS ХАМГААЛАЛТ =====
// innerHTML-д хэрэглэгчийн оруулсан утгыг шууд оруулахгүйн тулд
// тусгай тэмдэгтүүдийг HTML entity болгон хөрвүүлнэ
function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// javascript: болон data: URL-ийг блоклодог аюулгүй URL шалгагч
function safeUrl(url) {
    if (!url) return '#';
    const lower = url.trim().toLowerCase();
    if (lower.startsWith('javascript:') || lower.startsWith('data:')) return '#';
    return url;
}

// ===== APP ЭХЛҮҮЛЭХ =====
window.onload = async function () {
    showLoading('Платформ ачааллаж байна...');

    const bankNumEl  = document.getElementById('khanBankNum');
    const bankNameEl = document.getElementById('bankNameDisplay');
    if (bankNumEl)  bankNumEl.textContent  = BANK_ACCOUNT;
    if (bankNameEl) bankNameEl.textContent = `${BANK_NAME} (Хүлээн авагч: ${BANK_OWNER})`;

    let overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    overlay.id = 'sidebarOverlay';
    overlay.onclick = closeSidebar;
    document.body.appendChild(overlay);

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        const { data: profile } = await supabaseClient
            .from('profile')
            .select('*')
            .eq('id', session.user.id)
            .single();
        if (profile) {
            currentUser = profile;
            sessionStorage.setItem('nova_current_user', JSON.stringify(currentUser));
        }
    }

    supabaseClient.auth.onAuthStateChange((event, _session) => {
        if (event === 'PASSWORD_RECOVERY') {
            ['forgotStep1', 'forgotStep2'].forEach(id => {
                let el = document.getElementById(id);
                if (el) el.classList.add('hidden');
            });
            let step3 = document.getElementById('forgotStep3');
            if (step3) step3.classList.remove('hidden');
            openModal('forgotModal');
        }
    });

    await loadInitialDataFromSupabase();
    checkAuthUI();
    updateRequestBadge();
    showPage('homePage');
    hideLoading();

    // ── 2 Admin Realtime sync ──────────────────────────────────────
    // Admin байвал requests шинэчлэлтийг real-time сонсоно
    if (currentUser && currentUser.role === 'admin') {
        supabaseClient
            .channel('admin-requests-sync')
            .on('postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'requests' },
                (payload) => {
                    // Шинэ хүсэлт ирвэл — нөгөө admin нэмсэн
                    if (!requests.find(r => r.id === payload.new.id)) {
                        requests.push(payload.new);
                        updateRequestBadge();
                        showToast('📬 Шинэ хүсэлт ирлээ!');
                        if (adminActiveTab === 'requestsTab') renderAdminRequests();
                    }
                }
            )
            .on('postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'requests' },
                (payload) => {
                    // Нөгөө admin баталгаажуулвал → local-аас хасна
                    let idx = requests.findIndex(r => r.id === payload.new.id);
                    if (idx !== -1) requests[idx] = payload.new;
                    updateRequestBadge();
                    if (adminActiveTab === 'requestsTab') renderAdminRequests();
                }
            )
            .subscribe();
    }
};

// ===== CAROUSEL =====
let carouselIndex = 0;
let carouselAutoTimer = null;

function renderCarousel() {
    let track = document.getElementById('carouselTrack');
    let dotsEl = document.getElementById('carouselDots');
    if (!track || !dotsEl) return;

    let featured = movies.filter(m => m.isTrending || m.isNew).slice(0, 6);
    if (featured.length === 0) {
        document.getElementById('homeCarousel').style.display = 'none';
        return;
    }
    document.getElementById('homeCarousel').style.display = 'block';

    track.innerHTML = featured.map((m) => {
        let cover = safeUrl(m.cover || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800');
        let badge = m.price === 0
            ? `<span class="carousel-badge" style="background:#10b981;">Үнэгүй</span>`
            : `<span class="carousel-badge" style="background:var(--vip-color);color:#000;">${m.price.toLocaleString()} ₮</span>`;
        let shortDesc = (m.desc || '').substring(0, 100) + (m.desc && m.desc.length > 100 ? '...' : '');
        return `
            <div class="carousel-slide" onclick="showMovieProfile(${m.id})">
                <img src="${cover}" alt="${escapeHtml(m.title)}" class="carousel-img">
                <div class="carousel-overlay">
                    <div class="carousel-content">
                        ${badge}
                        <h2 class="carousel-title">${escapeHtml(m.title)}</h2>
                        <p class="carousel-desc">${escapeHtml(shortDesc)}</p>
                        <button class="btn-main" style="margin-top:10px;" onclick="event.stopPropagation();showMovieProfile(${m.id})">
                            <i class="fas fa-play"></i> Үзэх
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    dotsEl.innerHTML = featured.map((_, i) =>
        `<span class="carousel-dot ${i === 0 ? 'active' : ''}" onclick="carouselGoTo(${i})"></span>`
    ).join('');

    carouselIndex = 0;
    updateCarouselPosition();
    startCarouselAuto(featured.length);
}

function updateCarouselPosition() {
    let track = document.getElementById('carouselTrack');
    if (track) track.style.transform = `translateX(-${carouselIndex * 100}%)`;
    document.querySelectorAll('.carousel-dot').forEach((d, i) => {
        d.classList.toggle('active', i === carouselIndex);
    });
}

function carouselMove(dir) {
    let slides = document.querySelectorAll('.carousel-slide');
    if (!slides.length) return;
    carouselIndex = (carouselIndex + dir + slides.length) % slides.length;
    updateCarouselPosition();
}

function carouselGoTo(idx) {
    carouselIndex = idx;
    updateCarouselPosition();
}

function startCarouselAuto(len) {
    if (carouselAutoTimer) clearInterval(carouselAutoTimer);
    carouselAutoTimer = setInterval(() => {
        carouselIndex = (carouselIndex + 1) % len;
        updateCarouselPosition();
    }, 4500);
}

// ===== САНАЛ БОЛГОХ КИНО =====
function renderRecommendedMovies(currentId) {
    let container = document.getElementById('recommendedMoviesList');
    if (!container) return;
    let recs = movies.filter(m => m.id !== currentId).slice(0, 8);
    if (recs.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Санал болгох кино байхгүй.</p>';
        return;
    }
    container.innerHTML = recs.map(m => {
        let cover = safeUrl(m.cover || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=200');
        let price = m.price === 0
            ? '<span style="color:#10b981;font-size:11px;">Үнэгүй</span>'
            : `<span style="color:var(--vip-color);font-size:11px;">${m.price.toLocaleString()} ₮</span>`;
        return `
            <div class="rec-movie-item" onclick="showMovieProfile(${m.id})">
                <img src="${cover}" alt="${escapeHtml(m.title)}" class="rec-movie-thumb">
                <div class="rec-movie-info">
                    <div class="rec-movie-title">${escapeHtml(m.title)}</div>
                    <div>${price}</div>
                    <div style="font-size:10px;color:var(--text-muted);">${m.category === 'drama' ? 'Цуврал' : 'Вэбтун'}</div>
                </div>
            </div>
        `;
    }).join('');
}

// ===== МОДЕРАТОР ТАБ =====
function switchModTab(tabId) {
    document.querySelectorAll('#modPage .admin-tab-content').forEach(c => c.classList.add('hidden'));
    document.querySelectorAll('#modPage .admin-tabs-nav button').forEach(b => b.classList.remove('active'));
    let tab = document.getElementById(tabId);
    if (tab) tab.classList.remove('hidden');
    let btnMap = { modAddMovieTab: 'btn-mod-tab-add', modAddEpTab: 'btn-mod-tab-ep' };
    let btn = document.getElementById(btnMap[tabId]);
    if (btn) btn.classList.add('active');
    if (tabId === 'modAddEpTab') populateModEpMovieSelect();
}

function populateModEpMovieSelect() {
    let sel = document.getElementById('modEpMovieSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Кино сонгох --</option>' +
        movies.map(m => `<option value="${m.id}">${m.title} (${m.code})</option>`).join('');
}

async function submitModEpisodeRequest() {
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'moderator')) {
        return showToast('Зөвхөн модератор эсвэл админ хүсэлт гаргах боломжтой!', 'error');
    }
    let movieId = parseInt(document.getElementById('modEpMovieSelect').value);
    let epNum = parseInt(document.getElementById('modEpNumber').value);
    let epTitle = document.getElementById('modEpTitle').value.trim();
    let videoUrl = document.getElementById('modEpVideoUrl').value.trim();

    if (!movieId) return showToast('Кино сонгоно уу!', 'error');
    if (!epNum) return showToast('Ангийн дугаар оруулна уу!', 'error');
    if (!videoUrl) return showToast('Видео URL оруулна уу!', 'error');

    let m = movies.find(mv => mv.id === movieId);
    if (!m) return;

    let newRequest = {
        type: 'EPISODE_ADD',
        movieId, movieTitle: m.title, movieCode: m.code,
        epNum, epTitle: epTitle || `${epNum}-р анги`, videoUrl,
        senderName: currentUser.name, senderId: currentUser.id,
        status: 'pending', createdAt: new Date().toISOString()
    };

    // DB-д эхлээд insert хийж жинхэнэ ID авна — local Date.now() ID ашиглахгүй
    const { data: inserted, error } = await supabaseClient
        .from('requests').insert({ ...newRequest }).select().single();
    if (error) {
        console.error('Supabase request insert алдаа:', error);
        newRequest.id = Date.now(); // fallback
    } else if (inserted) {
        newRequest.id = inserted.id;
    }

    requests.push(newRequest);
    updateLocalState();
    updateRequestBadge();

    document.getElementById('modEpNumber').value = '';
    document.getElementById('modEpTitle').value = '';
    document.getElementById('modEpVideoUrl').value = '';
    showToast('Анги нэмэх хүсэлт амжилттай илгээгдлээ!');
}

// ЗАСАЛ 3: Байхгүй байсан функц нэмэгдлээ
async function submitModRequest() {
    if (!await verifyIsAdminOrMod()) return;

    let title    = document.getElementById('modReqTitle').value.trim();
    let code     = document.getElementById('modReqCode').value.trim().toUpperCase();
    let desc     = document.getElementById('modReqDesc').value.trim();
    let category = document.getElementById('modReqCategory').value;
    let movieStatus = document.getElementById('modReqStatus').value;
    let price    = parseInt(document.getElementById('modReqPrice').value) || 0;

    if (!title || !code) return showToast('Нэр болон код заавал шаардлагатай!', 'error');
    if (movies.some(m => m.code === code))
        return showToast('Энэ код аль хэдийн бүртгэлтэй байна!', 'error');

    let newRequest = {
        type: 'MOVIE_ADD',
        title, code, desc, category, movieStatus, price,
        senderName: currentUser.name, senderId: currentUser.id,
        status: 'pending', createdAt: new Date().toISOString()
    };

    // DB-д эхлээд insert хийж жинхэнэ ID авна — local Date.now() ID ашиглахгүй
    const { data: inserted, error } = await supabaseClient
        .from('requests').insert({ ...newRequest }).select().single();
    if (error) {
        console.error('Supabase request insert алдаа:', error);
        newRequest.id = Date.now(); // fallback
    } else if (inserted) {
        newRequest.id = inserted.id;
    }

    requests.push(newRequest);
    updateRequestBadge();

    ['modReqTitle','modReqCode','modReqDesc'].forEach(id => {
        let el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('modReqPrice').value = '0';
    showToast('✅ Кино нэмэх хүсэлт амжилттай илгээгдлээ!');
}

// ===== АЮУЛГҮЙ БАЙДАЛ: SERVER-SIDE ROLE ШАЛГАЛТ =====
// sessionStorage-ийн role-д найдахгүй — Supabase DB-аас шууд авна
async function verifyIsAdmin() {
    if (!currentUser) return false;
    const { data, error } = await supabaseClient
        .from('profile').select('role').eq('id', currentUser.id).single();
    if (error || data?.role !== 'admin') {
        showToast('⛔ Таны эрх хүрэлцэхгүй байна!', 'error');
        return false;
    }
    return true;
}

async function verifyIsAdminOrMod() {
    if (!currentUser) return false;
    const { data, error } = await supabaseClient
        .from('profile').select('role').eq('id', currentUser.id).single();
    if (error || !['admin', 'moderator'].includes(data?.role)) {
        showToast('⛔ Таны эрх хүрэлцэхгүй байна!', 'error');
        return false;
    }
    return true;
}

// ЗАСАЛ 5: saveData → updateLocalState гэж нэрлэж, хийдэг зүйлээ тодорхой болголоо
// Supabase-д юу ч бичдэггүй — зөвхөн local array болон sessionStorage шинэчилнэ
function updateLocalState() {
    if (currentUser) {
        let idx = users.findIndex(u => u.id === currentUser.id);
        if (idx !== -1) users[idx] = currentUser;
        sessionStorage.setItem('nova_current_user', JSON.stringify(currentUser));
    }
}

// ===== ХУУДАС ШИЛЖИЛТ =====
function showPage(pageId) {
    document.querySelectorAll('.page-section').forEach(p => p.classList.add('hidden'));
    let target = document.getElementById(pageId);
    if (target) target.classList.remove('hidden');

    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

    let navMap = {
        homePage: 'nav-home', allMoviesPage: 'nav-allMovies',
        vipPage: 'nav-vip', profilePage: 'nav-profile',
        adminPage: 'nav-admin', modPage: 'nav-modPanel'
    };
    let navEl = document.getElementById(navMap[pageId]);
    if (navEl) navEl.classList.add('active');

    if (pageId === 'allMoviesPage') renderAllMoviesPage();
    if (pageId === 'profilePage') renderUserProfile();
    if (pageId === 'adminPage') initAdminPanel();

    if (window.innerWidth <= 768) closeSidebar();
    window.scrollTo(0, 0);
}

function toggleSidebar() {
    let sidebar = document.getElementById('appSidebar');
    let overlay = document.getElementById('sidebarOverlay');
    sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

function closeSidebar() {
    let sidebar = document.getElementById('appSidebar');
    let overlay = document.getElementById('sidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
}

// ===== AUTH UI =====
function checkAuthUI() {
    const authBtn = document.getElementById('authBtnContainer');
    const userBox = document.getElementById('topUserAvatarBox');

    ['nav-profile', 'nav-admin', 'nav-modPanel'].forEach(id => {
        let el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    if (currentUser) {
        if (authBtn) authBtn.classList.add('hidden');
        if (userBox) userBox.classList.remove('hidden');
        document.getElementById('topUsername').innerText = currentUser.name;
        document.getElementById('topUserImg').src = currentUser.avatar || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';

        let navProfile = document.getElementById('nav-profile');
        if (navProfile) navProfile.classList.remove('hidden');

        if (currentUser.role === 'admin') {
            let navAdmin = document.getElementById('nav-admin');
            if (navAdmin) navAdmin.classList.remove('hidden');
        } else if (currentUser.role === 'moderator') {
            let navMod = document.getElementById('nav-modPanel');
            if (navMod) navMod.classList.remove('hidden');
        }
    } else {
        if (authBtn) authBtn.classList.remove('hidden');
        if (userBox) userBox.classList.add('hidden');
    }
}

// ===== МОДАЛ =====
function openModal(modalId) {
    let modal = document.getElementById(modalId);
    if (modal) { modal.style.display = 'flex'; modal.classList.remove('hidden'); }
}

function closeModal(modalId) {
    let modal = document.getElementById(modalId);
    if (modal) { modal.style.display = 'none'; modal.classList.add('hidden'); }
}

function switchForm(formId) {
    ['loginForm', 'registerForm'].forEach(f => {
        let el = document.getElementById(f);
        if (el) el.classList.add('hidden');
    });
    let target = document.getElementById(formId);
    if (target) target.classList.remove('hidden');
}

// ===== CUSTOM CONFIRM =====
function showConfirm(message, onConfirm, title = 'Итгэлтэй байна уу?', btnText = 'Тийм, устгах') {
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmMessage').innerText = message;
    document.getElementById('confirmYesBtn').innerText = btnText;
    confirmCallback = onConfirm;
    openModal('confirmModal');
}

function confirmYes() {
    closeModal('confirmModal');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
}

function closeConfirmModal() {
    closeModal('confirmModal');
    confirmCallback = null;
}

// ===== НЭВТРЭХ =====
async function loginLogic() {
    let email = document.getElementById('loginEmail').value.trim();
    let pass = document.getElementById('loginPass').value;
    if (!email || !pass) return showToast('Имэйл болон нууц үгээ оруулна уу!', 'error');

    showLoading('Нэвтэрч байна...');
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
    if (error) { hideLoading(); return showToast('Имэйл эсвэл нууц үг буруу байна!', 'error'); }

    const { data: profile, error: profileErr } = await supabaseClient
        .from('profile').select('*').eq('id', data.user.id).single();
    if (profileErr || !profile) { hideLoading(); return showToast('Профайл олдсонгүй!', 'error'); }

    currentUser = profile;
    sessionStorage.setItem('nova_current_user', JSON.stringify(currentUser));
    hideLoading();
    closeModal('loginModal');
    checkAuthUI();
    showPage('homePage');
    showToast(`Тавтай морил, ${currentUser.name}! 👋`);
}

// ===== БҮРТГҮҮЛЭХ =====
async function registerLogic() {
    let name  = document.getElementById('regName').value.trim();
    let phone = document.getElementById('regPhone').value.trim();
    let email = document.getElementById('regEmail').value.trim();
    let pass  = document.getElementById('regPass').value;

    if (!name || !phone || !email || !pass)
        return showToast('Бүх талбарыг бөглөнө үү!', 'error');
    if (pass.length < 6)
        return showToast('Нууц үг дор хаяж 6 тэмдэгт байх ёстой!', 'error');

    showLoading('Бүртгэж байна...');
    const { data, error } = await supabaseClient.auth.signUp({ email, password: pass });
    if (error) { hideLoading(); return showToast(error.message, 'error'); }

    let newUser = {
        id: data.user.id, name, phone, email, role: 'user',
        vipExpires: null, rentedMovies: [], history: [],
        avatar: 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png'
    };

    const { error: profileError } = await supabaseClient.from('profile').insert(newUser);
    if (profileError) {
        hideLoading();
        return showToast('Профайл хадгалахад алдаа гарлаа: ' + profileError.message, 'error');
    }

    users.push(newUser);
    currentUser = newUser;
    updateLocalState();
    hideLoading();
    closeModal('loginModal');
    checkAuthUI();
    showPage('homePage');
    showToast('Бүртгэл амжилттай үүслээ! 🎉');
}

// ===== ГАРАХ =====
async function logout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    sessionStorage.removeItem('nova_current_user');
    checkAuthUI();
    showPage('homePage');
}

// ===== LOADING =====
function showLoading(text = 'Ачааллаж байна...') {
    let el  = document.getElementById('loadingOverlay');
    let txt = document.getElementById('loadingText');
    if (el) el.classList.add('active');
    if (txt) txt.innerText = text;
}

function hideLoading() {
    let el = document.getElementById('loadingOverlay');
    if (el) el.classList.remove('active');
}

// ===== TOAST =====
function showToast(message, type = 'success') {
    let existing = document.getElementById('toastBox');
    if (existing) existing.remove();

    let toast = document.createElement('div');
    toast.id = 'toastBox';
    toast.style.cssText = `
        position:fixed;bottom:30px;right:20px;z-index:9999;
        background:${type === 'error' ? '#ef4444' : '#10b981'};
        color:white;padding:14px 20px;border-radius:10px;
        font-size:14px;font-weight:600;max-width:320px;
        box-shadow:0 4px 20px rgba(0,0,0,0.3);
        animation:slideIn 0.3s ease;
    `;
    // escapeHtml — message нь хэрэглэгчийн нэр зэрэг гадны өгөгдөл агуулж болно
    toast.innerHTML = `<i class="fas fa-${type === 'error' ? 'times-circle' : 'check-circle'}"></i> ${escapeHtml(message)}`;
    document.body.appendChild(toast);

    let style = document.createElement('style');
    style.textContent = '@keyframes slideIn{from{opacity:0;transform:translateX(100px);}to{opacity:1;transform:translateX(0);}}';
    document.head.appendChild(style);

    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3500);
}

// ===== КИНО КАРТ =====
function createMovieCard(m) {
    let badge = m.price > 0
        ? `<div class="badge-vip-card">${m.price.toLocaleString()} ₮</div>`
        : `<div class="badge-vip-card" style="background:#10b981;">Үнэгүй</div>`;
    let cover = safeUrl(m.cover || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400');
    let epCount = (m.episodes && m.episodes.length > 0)
        ? `<span style="font-size:11px;color:var(--text-muted);margin-left:5px;"><i class="fas fa-film" style="font-size:10px;"></i> ${m.episodes.length} анги</span>`
        : '';
    return `
        <div class="movie-card" onclick="showMovieProfile(${m.id})">
            ${badge}
            <img class="card-cover" src="${cover}" alt="${escapeHtml(m.title)}" loading="lazy">
            <div class="card-info">
                <div class="card-title">${escapeHtml(m.title)}</div>
                <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:4px;">
                    <span class="badge">${m.category === 'drama' ? 'Цуврал' : 'Вэбтун'}</span>
                    ${epCount}
                </div>
            </div>
        </div>
    `;
}

// Admin үйлдлийн дараа олон удаа дуудагддаг тул debounce ашиглана
const renderHomeMovies = debounce(function _renderHomeMovies() {
    let trendingGrid = document.getElementById('grid-trending');
    let newGrid      = document.getElementById('grid-new');

    if (trendingGrid) {
        let trending = [...movies].filter(m => m.isTrending)
            .sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10);
        trendingGrid.innerHTML = trending.length > 0
            ? trending.map(createMovieCard).join('')
            : '<p style="color:var(--text-muted);">Трэнд контент байхгүй байна.</p>';
    }
    if (newGrid) {
        let newest = [...movies].filter(m => m.isNew)
            .sort((a, b) => (b.id || 0) - (a.id || 0)).slice(0, 10);
        newGrid.innerHTML = newest.length > 0
            ? newest.map(createMovieCard).join('')
            : '<p style="color:var(--text-muted);">Шинэ контент байхгүй байна.</p>';
    }
    renderCarousel();
}, 200);

function renderAllMoviesPage() {
    let grid = document.getElementById('grid-all-movies');
    if (!grid) return;
    let filtered = currentActiveCategory === 'all'
        ? movies : movies.filter(m => m.category === currentActiveCategory);

    // hasMoreMovies flag-аар Load More товч харуулах эсэхийг шийдэнэ
    let loadMoreBtn = hasMoreMovies
        ? `<div style="grid-column:1/-1;text-align:center;margin-top:10px;">
               <button class="btn-main" onclick="loadMoreMovies()" style="padding:12px 30px;">
                   <i class="fas fa-plus"></i> Цаашид үзэх
               </button>
           </div>`
        : '';

    grid.innerHTML = filtered.length > 0
        ? filtered.map(createMovieCard).join('') + loadMoreBtn
        : '<p style="color:var(--text-muted);">Энэ ангилалд одоогоор контент байхгүй байна.</p>';
}

function filterCategory(cat, element) {
    currentActiveCategory = cat;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (element) element.classList.add('active');
    renderAllMoviesPage();
}

// Debounce + server-side хайлт: 400ms хүлээсний дараа Supabase .ilike() хайна
const searchMoviesHome = debounce(async function () {
    let val   = document.getElementById('mainMovieSearchInput').value.trim();
    let tGrid = document.getElementById('grid-trending');
    let nGrid = document.getElementById('grid-new');

    // Хоосон бол анхны байдалд буцаана
    if (!val) {
        renderHomeMovies();
        return;
    }

    // Server-side хайлт — ачааллагдаагүй кинонуудаас ч хайна
    const { data, error } = await supabaseClient
        .from('movies')
        .select('*')
        .ilike('title', `%${val}%`)
        .limit(50);

    if (error) {
        console.warn('Хайлтын алдаа:', error.message);
        return;
    }

    const empty = '<p style="color:var(--text-muted);">Үр дүн олдсонгүй.</p>';
    if (tGrid) {
        let t = (data || []).filter(m => m.isTrending).map(createMovieCard).join('');
        tGrid.innerHTML = t || empty;
    }
    if (nGrid) {
        let n = (data || []).filter(m => m.isNew).map(createMovieCard).join('');
        nGrid.innerHTML = n || empty;
    }
}, 400);

// ===== КИНО ДЭЛГЭРЭНГҮЙ =====
async function showMovieProfile(id) {
    let m = movies.find(mv => mv.id === id);
    if (!m) return;
    currentSelectedMovieId = id;

    // Ангиудыг lazy load — эхний жагсаалтад орохгүй байсан тул одоо татна
    if (!m.episodes) {
        showLoading('Кино мэдээлэл татаж байна...');
        const { data: fullMovie } = await supabaseClient
            .from('movies').select('episodes').eq('id', id).single();
        if (fullMovie) m.episodes = fullMovie.episodes || [];
        hideLoading();
    }

    // ЗАСАЛ 2: Atomic increment — race condition байхгүй
    supabaseClient.rpc('increment_views', { movie_id: id }).then(({ error }) => {
        if (error) {
            // RPC байхгүй бол fallback
            console.warn('increment_views RPC байхгүй, fallback ашиглаж байна:', error.message);
            supabaseClient.from('movies').update({ views: (m.views || 0) + 1 }).eq('id', id);
        }
    });
    m.views = (m.views || 0) + 1; // UI-д шууд харуулах

    if (currentUser) {
        if (!currentUser.history) currentUser.history = [];
        currentUser.history = currentUser.history.filter(hid => hid !== id);
        currentUser.history.unshift(id);
        if (currentUser.history.length > 8) currentUser.history = currentUser.history.slice(0, 8);
        // ЗАСАЛ 5: Үзсэн түүхийг Supabase-д хадгална — өөр төхөөрөмжид ч харагдана
        supabaseClient.from('profile')
            .update({ history: currentUser.history })
            .eq('id', currentUser.id)
            .then(({ error }) => { if (error) console.error('History update алдаа:', error); });
    }
    updateLocalState();

    document.getElementById('mProfType').innerText    = m.category === 'drama' ? 'ЦУВРАЛ КИНО' : 'ВЭБТУН / КОМИК';
    document.getElementById('mProfTitle').innerText   = m.title;
    document.getElementById('mProfDesc').innerText    = m.desc;
    document.getElementById('mProfStatus').innerText  = m.status;
    document.getElementById('mProfViews').innerText   = m.views.toLocaleString();
    document.getElementById('mProfPrice').innerText   = m.price === 0 ? 'Үнэгүй' : `${m.price.toLocaleString()} ₮`;

    let cover = m.cover || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500';
    document.getElementById('mProfCoverContainer').innerHTML = `<img src="${cover}" alt="cover">`;

    closeVideoPlayer();
    renderMovieActionButtons(m);
    showPage('movieProfilePage');
    renderRecommendedMovies(id);
}

function isVipActive(user) {
    if (!user || !user.vipExpires) return false;
    return Number(new Date(user.vipExpires)) > Date.now();
}

function renderMovieActionButtons(m) {
    let container = document.getElementById('movieActionButtonsContainer');
    let epBlock   = document.getElementById('episodesBlockContainer');
    container.innerHTML = '';

    if (m.price === 0) {
        container.innerHTML = `<span style="color:#10b981;font-weight:bold;"><i class="fas fa-unlock"></i> Үнэгүй үзэх боломжтой</span>`;
        if (epBlock) epBlock.classList.remove('hidden');
        renderEpisodesList(m.episodes);
        return;
    }
    if (!currentUser) {
        container.innerHTML = `<button class="btn-main" onclick="openModal('loginModal')"><i class="fas fa-sign-in-alt"></i> Нэвтэрч үзэх</button>`;
        if (epBlock) epBlock.classList.add('hidden');
        return;
    }
    let hasVip    = isVipActive(currentUser);
    let hasRented = currentUser.rentedMovies && currentUser.rentedMovies.includes(m.code);

    if (hasVip || hasRented) {
        container.innerHTML = `<span style="color:var(--vip-color);font-weight:bold;"><i class="fas fa-check-circle"></i> Үзэх эрх нээлттэй ${hasVip ? '(VIP)' : '(Түрээслэсэн)'}</span>`;
        if (epBlock) epBlock.classList.remove('hidden');
        renderEpisodesList(m.episodes);
    } else {
        // data-attribute ашиглан onclick-д шууд утга оруулахгүй (injection хамгаалалт)
        container.innerHTML = `
            <button class="btn-vip" onclick="showPage('vipPage')"><i class="fas fa-crown"></i> VIP авах</button>
            <button class="btn-main" id="rentBtn"
                data-code="${escapeHtml(m.code)}"
                data-price="${m.price}">
                <i class="fas fa-key"></i> Түрээслэх (${m.price.toLocaleString()} ₮)
            </button>
        `;
        document.getElementById('rentBtn').addEventListener('click', function() {
            rentMovieDirect(this.dataset.code, parseInt(this.dataset.price));
        });
        if (epBlock) epBlock.classList.add('hidden');
    }
}

function renderEpisodesList(episodes) {
    let grid = document.getElementById('mProfEpisodesGrid');
    if (!grid) return;
    if (!episodes || episodes.length === 0) {
        grid.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">Анги одоогоор оруулаагүй байна.</p>`;
        return;
    }
    let sorted = [...episodes].sort((a, b) => a.num - b.num);
    // ep.file болон ep.title-г onclick string-д шууд оруулахгүй —
    // data attribute ашиглан injection-оос хамгаалсан
    grid.innerHTML = sorted.map(ep => {
        let epLabel = ep.title || (ep.num + '-р анги');
        return `
            <button class="ep-btn" id="epBtn-${ep.num}"
                data-num="${ep.num}"
                data-file="${escapeHtml(ep.file || '')}"
                data-title="${escapeHtml(epLabel)}"
                onclick="playEpisodeFromBtn(this)">
                <i class="fas fa-play" style="font-size:10px;"></i><br>
                Анги ${ep.num}
                ${ep.title ? `<br><span style="font-size:10px;font-weight:400;color:var(--text-muted);">${escapeHtml(ep.title)}</span>` : ''}
            </button>
        `;
    }).join('');
}

// data attribute-аас утгыг аюулгүй унших wrapper
function playEpisodeFromBtn(btn) {
    playEpisode(
        parseInt(btn.dataset.num),
        btn.dataset.file,
        btn.dataset.title
    );
}

// ===== ВИДЕО ТОГЛУУЛАГЧ =====
// HLS instance глобалд хадгална — episode солихдоо destroy хийнэ
let hlsInstance = null;

function playEpisode(num, file, title) {
    let videoPlayerBox = document.getElementById('videoPlayerBox');
    let myVideo        = document.getElementById('myVideo');
    let nowPlaying     = document.getElementById('videoNowPlayingTitle');

    if (!file || file === 'undefined' || file === '') {
        showToast('Видео файл байхгүй байна.', 'error');
        return;
    }

    // Өмнөх HLS instance байвал цэвэрлэнэ
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (videoPlayerBox && myVideo) {
        videoPlayerBox.classList.remove('hidden');

        const isHLS = file.includes('.m3u8');

        if (isHLS) {
            // ── HLS файл (.m3u8) ──────────────────────────────────
            if (Hls.isSupported()) {
                hlsInstance = new Hls({
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                    startLevel: -1,              // автомат чанар сонгоно
                    abrEwmaDefaultEstimate: 500000,
                });
                hlsInstance.loadSource(file);
                hlsInstance.attachMedia(myVideo);
                hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
                    myVideo.play().catch(e => console.log('Autoplay:', e));
                });
                hlsInstance.on(Hls.Events.ERROR, (event, data) => {
                    if (data.fatal) {
                        showToast('Видео ачааллахад алдаа гарлаа.', 'error');
                        console.error('HLS алдаа:', data);
                    }
                });
            } else if (myVideo.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari — native HLS дэмждэг
                myVideo.src = file;
                myVideo.load();
                myVideo.play().catch(e => console.log('Safari autoplay:', e));
            } else {
                showToast('Таны броузер энэ форматыг дэмжихгүй байна.', 'error');
                return;
            }
        } else {
            // ── MP4 файл (хуучин, ажиллаж л байна) ───────────────
            myVideo.src = file;
            myVideo.load();
            myVideo.play().catch(e => console.log('Автоматаар тоглуулж чадсангүй:', e));
        }

        if (nowPlaying) {
            nowPlaying.innerHTML = `<i class="fas fa-play-circle"></i> Анги ${num}${title ? ' - ' + escapeHtml(title) : ''} тоглуулж байна...`;
        }

        document.querySelectorAll('.ep-btn').forEach(btn => btn.classList.remove('active-ep'));
        let activeBtn = document.getElementById(`epBtn-${num}`);
        if (activeBtn) activeBtn.classList.add('active-ep');

        setTimeout(() => videoPlayerBox.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
}

function closeVideoPlayer() {
    let videoPlayerBox = document.getElementById('videoPlayerBox');
    let myVideo        = document.getElementById('myVideo');

    // HLS instance цэвэрлэнэ
    if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
    }

    if (videoPlayerBox) videoPlayerBox.classList.add('hidden');
    if (myVideo) { myVideo.pause(); myVideo.src = ''; }
    document.querySelectorAll('.ep-btn').forEach(btn => btn.classList.remove('active-ep'));
}

function goBackToContent() {
    closeVideoPlayer();
    if (currentActiveCategory !== 'all') showPage('allMoviesPage');
    else showPage('homePage');
}

// ===== VIP =====
function getVipDays(code) {
    if (code === 'VIP-1M')   return 30;
    if (code === 'VIP-3M')   return 90;
    if (code === 'VIP-YEAR') return 365;
    if (code === 'VIP-LIFE') return 36500;
    return 30;
}

let activePaymentType = null;
let pendingCode  = '';
let pendingAmount = 0;

function buyVipPackageAction(name, price, code) {
    if (!currentUser) return openModal('loginModal');
    activePaymentType = 'VIP';
    pendingCode   = code;
    pendingAmount = price;
    document.getElementById('payAmount').innerText = `${price.toLocaleString()} ₮`;
    document.getElementById('payDetail').innerText = `${code}-${currentUser.phone}`;
    openModal('paymentModal');
}

function rentMovieDirect(movieCode, price) {
    if (!currentUser) return openModal('loginModal');
    activePaymentType = 'RENT';
    pendingCode   = movieCode;
    pendingAmount = price;
    document.getElementById('payAmount').innerText = `${price.toLocaleString()} ₮`;
    document.getElementById('payDetail').innerText = `${movieCode}-${currentUser.phone}`;
    openModal('paymentModal');
}

function copyText(elementId) {
    let el = document.getElementById(elementId);
    if (!el) return;
    navigator.clipboard.writeText(el.innerText.trim())
        .then(() => showToast('Амжилттай хуулагдлаа!'))
        .catch(() => showToast('Хуулж чадсангүй.', 'error'));
}

async function confirmPaymentSubmit() {
    let newRequest = {
        type: 'PAYMENT',
        paymentType: activePaymentType, code: pendingCode,
        amount: pendingAmount, userId: currentUser.id,
        userEmail: currentUser.email, userName: currentUser.name,
        userPhone: currentUser.phone,
        status: 'pending', createdAt: new Date().toISOString()
    };

    // ЗАСАЛ 3: Эхлээд Supabase-д insert хийж жинхэнэ ID авна — Date.now() fallback болгон л үлдэнэ
    const { data: inserted, error } = await supabaseClient
        .from('requests').insert({ ...newRequest }).select().single();
    if (error) {
        console.error('Supabase request insert алдаа:', error);
        newRequest.id = Date.now(); // fallback
    } else if (inserted) {
        newRequest.id = inserted.id;
    }

    requests.push(newRequest);
    updateLocalState();

    closeModal('paymentModal');
    updateRequestBadge();
    showToast('Төлбөрийн хүсэлт илгээгдлээ. Админ шалгаж эрхийг нээнэ.');
}

// ===== ПРОФАЙЛ =====
function renderUserProfile() {
    if (!currentUser) return;
    document.getElementById('profileNameField').innerText   = currentUser.name;
    document.getElementById('profileEmail').innerText      = currentUser.email;
    document.getElementById('profilePhoneField').innerText = currentUser.phone || 'Заагаагүй';
    document.getElementById('profileMainImg').src          = currentUser.avatar || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png';

    let roleText = '👤 Хэрэглэгч';
    if (currentUser.role === 'admin')     roleText = '⚙️ Админ';
    if (currentUser.role === 'moderator') roleText = '✒️ Модератор';
    document.getElementById('profileRoleBadge').innerText = roleText;

    if (isVipActive(currentUser)) {
        document.getElementById('profileVipStatus').innerText   = '👑 VIP Идэвхтэй';
        document.getElementById('profileVipTimeValue').innerText = new Date(currentUser.vipExpires).toLocaleDateString('mn-MN');
    } else {
        document.getElementById('profileVipStatus').innerText   = 'Ердийн хэрэглэгч';
        document.getElementById('profileVipTimeValue').innerText = 'Хугацаа дууссан эсвэл аваагүй';
    }

    let rentedGrid = document.getElementById('profileRentedGrid');
    let renteds    = movies.filter(m => currentUser.rentedMovies && currentUser.rentedMovies.includes(m.code));
    if (rentedGrid) rentedGrid.innerHTML = renteds.length > 0
        ? renteds.map(createMovieCard).join('')
        : '<p style="color:var(--text-muted);font-size:12px;padding:10px;">Түрээсэлсэн кино байхгүй.</p>';

    let historyGrid = document.getElementById('profileHistoryGrid');
    let historyList = (currentUser.history || []).map(hid => movies.find(m => m.id === hid)).filter(Boolean);
    if (historyGrid) historyGrid.innerHTML = historyList.length > 0
        ? historyList.map(createMovieCard).join('')
        : '<p style="color:var(--text-muted);font-size:12px;padding:10px;">Үзсэн түүх байхгүй.</p>';
}

function openProfileEditBox() {
    document.getElementById('editProfileName').value  = currentUser.name;
    document.getElementById('editProfilePhone').value = currentUser.phone || '';
    tempSelectedAvatarUrl = currentUser.avatar || '';
    let statusEl = document.getElementById('editAvatarStatus');
    if (statusEl) statusEl.innerText = 'Сонгоогүй байна.';
    openModal('profileEditModal');
}

function previewUserAvatarFile(event) {
    let file = event.target.files[0];
    if (file) {
        let reader = new FileReader();
        reader.onload = function (e) {
            tempSelectedAvatarUrl = e.target.result;
            let statusEl = document.getElementById('editAvatarStatus');
            if (statusEl) statusEl.innerText = `✅ Сонгогдлоо: ${file.name}`;
        };
        reader.readAsDataURL(file);
    }
}

async function saveUserProfileChanges() {
    let newName  = document.getElementById('editProfileName').value.trim();
    let newPhone = document.getElementById('editProfilePhone').value.trim();
    if (!newName || !newPhone) return showToast('Талбаруудыг бүрэн бөглөнө үү!', 'error');
    currentUser.name  = newName;
    currentUser.phone = newPhone;
    if (tempSelectedAvatarUrl) currentUser.avatar = tempSelectedAvatarUrl;
    updateLocalState();

    const { error } = await supabaseClient
        .from('profile')
        .update({ name: currentUser.name, phone: currentUser.phone, avatar: currentUser.avatar })
        .eq('id', currentUser.id);
    if (error) console.error('Supabase profile update алдаа:', error);

    closeModal('profileEditModal');
    checkAuthUI();
    renderUserProfile();
    showToast('Мэдээлэл амжилттай шинэчлэгдлээ!');
}

// ===== НУУЦ ҮГ ХАРУУЛАХ/НУУХ =====
function togglePasswordVisibility(inputId, iconId) {
    let input = document.getElementById(inputId);
    let icon  = document.getElementById(iconId);
    if (input && icon) {
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    }
}

// ===== НУУЦ ҮГ СЭРГЭЭХ =====
function openForgotModal() {
    closeModal('loginModal');
    ['forgotStep1', 'forgotStep2', 'forgotStep3'].forEach(id => {
        let el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    let step1 = document.getElementById('forgotStep1');
    if (step1) step1.classList.remove('hidden');
    document.getElementById('forgotEmail').value = '';
    document.getElementById('forgotPhone').value = '';
    openModal('forgotModal');
}

async function recoverPasswordLogic() {
    let email = document.getElementById('forgotEmail').value.trim();
    let phone = document.getElementById('forgotPhone').value.trim();
    if (!email || !phone) return showToast('Имэйл болон утасны дугаараа оруулна уу!', 'error');

    const { data: profile, error: profileErr } = await supabaseClient
        .from('profile').select('id').eq('email', email).eq('phone', phone).maybeSingle();
    if (profileErr || !profile) {
        showToast('Утасны дугаар эсвэл имэйл тохирохгүй байна!', 'error');
        return;
    }

    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.href.split('#')[0]
    });
    if (error) { showToast('Имэйл илгээхэд алдаа гарлаа: ' + error.message, 'error'); return; }

    document.getElementById('forgotStep1').classList.add('hidden');
    document.getElementById('forgotStep2').classList.remove('hidden');
    let otpEmailEl = document.getElementById('otpTargetEmail');
    if (otpEmailEl) otpEmailEl.textContent = email; // textContent — HTML injection хамгаалалт
    showToast('Нууц үг сэргээх линк таны имэйл рүү илгээгдлээ!');
}

async function resetPasswordLogic() {
    let newPass = document.getElementById('newPassInput').value;
    if (!newPass || newPass.length < 6) return showToast('Нууц үг дор хаяж 6 тэмдэгт байх ёстой!', 'error');

    const { error } = await supabaseClient.auth.updateUser({ password: newPass });
    if (error) { showToast('Нууц үг солиход алдаа гарлаа: ' + error.message, 'error'); return; }

    showToast('Нууц үг амжилттай солигдлоо! Шинэ нууц үгээрээ нэвтэрнэ үү.');
    closeModal('forgotModal');
    setTimeout(() => openModal('loginModal'), 500);
}

// ─────────────────────────────────────────────────────────────────
// ███████╗    R2 UPLOAD СИСТЕМ
// ─────────────────────────────────────────────────────────────────
const CHUNK_SIZE     = 100 * 1024 * 1024; // 100 MB — нэг part
const MAX_CONCURRENT = 3;                 // зэрэгцэн upload хийх part-ын тоо

/**
 * Worker-т POST хийх helper
 * АЮУЛГҮЙ БАЙДЛЫН ЗАСАЛ: WORKER_SECRET биш Supabase JWT ашиглах
 * Worker талд: request.headers.get('Authorization') → Bearer token шалгана
 */
async function workerPost(path, body) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) throw new Error('Нэвтрээгүй байна — upload хийхийн өмнө нэвтэрнэ үү');

    const res = await fetch(WORKER_URL + path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Worker алдаа: ' + res.status);
    }
    return res.json();
}

/**
 * XHR-ээр PUT upload хийх (progress дэмжинэ)
 */
function xhrPut(url, data, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = e => {
            if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr);
            } else {
                reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
            }
        };
        xhr.onerror   = () => reject(new Error('Network алдаа'));
        xhr.ontimeout = () => reject(new Error('Timeout'));
        xhr.open('PUT', url);
        xhr.send(data);
    });
}

/**
 * Нэг файл upload (< CHUNK_SIZE)
 */
async function uploadSingle(file, folder, onProgress) {
    const { url, publicUrl } = await workerPost('/upload/presign', {
        filename: file.name, contentType: file.type, folder
    });

    await xhrPut(url, file, (loaded, total) => {
        onProgress(Math.round(loaded / total * 100));
    });

    return publicUrl;
}

/**
 * Multipart upload (≥ CHUNK_SIZE, 10 GB+ дэмжинэ)
 */
async function uploadMultipart(file, folder, onProgress) {
    // 1. Multipart үүсгэх
    const { uploadId, key, publicUrl } = await workerPost('/upload/multipart/create', {
        filename: file.name, contentType: file.type, folder
    });

    const totalParts   = Math.ceil(file.size / CHUNK_SIZE);
    const parts        = new Array(totalParts);
    const partProgress = new Array(totalParts).fill(0); // Алдаа 1 засал: тус бүрийн uploaded bytes
    let uploadedBytes  = 0;

    // 2. Part-уудыг MAX_CONCURRENT зэрэгцээ upload хийх
    for (let batchStart = 0; batchStart < totalParts; batchStart += MAX_CONCURRENT) {
        const batchEnd = Math.min(batchStart + MAX_CONCURRENT, totalParts);
        const batchJobs = [];

        for (let i = batchStart; i < batchEnd; i++) {
            const partNumber = i + 1;
            const start      = i * CHUNK_SIZE;
            const end        = Math.min(start + CHUNK_SIZE, file.size);
            const chunk      = file.slice(start, end);
            const chunkSize  = chunk.size; // Алдаа 2 засал: closure-д зөв хэмжээ барих

            batchJobs.push((async () => {
                // Presigned URL авах
                const { url: partUrl } = await workerPost('/upload/multipart/part', {
                    key, uploadId, partNumber
                });

                // Retry 3 удаа
                let lastErr;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const xhr = await xhrPut(partUrl, chunk, (loaded) => {
                            // Алдаа 1 засал: parts[i] биш partProgress ашиглах
                            const prev      = partProgress[i];
                            uploadedBytes  += loaded - prev;
                            partProgress[i] = loaded;
                            onProgress(Math.min(99, Math.round(uploadedBytes / file.size * 100)));
                        });
                        const etag = xhr.getResponseHeader('ETag');
                        parts[i] = { partNumber, etag: etag || `"${partNumber}"` };
                        // Алдаа 2 засал: chunkSize ашиглан partProgress шинэчлэх
                        partProgress[i] = chunkSize;
                        uploadedBytes   = partProgress.reduce((s, b) => s + b, 0);
                        return;
                    } catch (err) {
                        lastErr = err;
                        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
                // 3 оролдлого бүтсэнгүй — abort хийх
                await workerPost('/upload/multipart/abort', { key, uploadId }).catch(() => {});
                throw lastErr;
            })());
        }
        await Promise.all(batchJobs);
    }

    // 3. Complete
    await workerPost('/upload/multipart/complete', {
        key, uploadId,
        parts: parts.map(p => ({ partNumber: p.partNumber, etag: p.etag }))
    });

    onProgress(100);
    return publicUrl;
}

/**
 * Гол upload функц — хэмжээгээр нь Single / Multipart шийднэ
 */
async function uploadFileToR2(file, folder, onProgress) {
    if (file.size < CHUNK_SIZE) {
        return uploadSingle(file, folder, onProgress);
    } else {
        return uploadMultipart(file, folder, onProgress);
    }
}

// ── Progress bar UI ────────────────────────────────────────────
function showUploadBar(anchorId, filename, sizeLabel) {
    let old = document.getElementById('r2UploadBar');
    if (old) old.remove();

    const bar = document.createElement('div');
    bar.id = 'r2UploadBar';
    bar.innerHTML = `
        <div style="margin-top:10px;background:#0f172a;border-radius:8px;padding:12px;border:1px solid #334155;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%;">
                    <i class="fas fa-cloud-upload-alt" style="color:#3b82f6;margin-right:4px;"></i>
                    ${filename.substring(0, 35)}${filename.length > 35 ? '...' : ''}
                </span>
                <span style="font-size:11px;color:#64748b;">${sizeLabel}</span>
            </div>
            <div style="background:#1e293b;border-radius:4px;height:8px;overflow:hidden;">
                <div id="r2UploadFill"
                    style="height:100%;background:linear-gradient(90deg,#3b82f6,#06b6d4);
                           width:0%;transition:width 0.4s ease;border-radius:4px;"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;">
                <span id="r2UploadPct" style="font-size:11px;color:#94a3b8;">0%</span>
                <span id="r2UploadStatus" style="font-size:11px;color:#64748b;">Эхлэж байна...</span>
            </div>
        </div>`;

    const anchor = document.getElementById(anchorId);
    if (anchor) anchor.appendChild(bar);
    else document.body.appendChild(bar);
}

function updateUploadBar(pct, statusText) {
    const fill   = document.getElementById('r2UploadFill');
    const pctEl  = document.getElementById('r2UploadPct');
    const status = document.getElementById('r2UploadStatus');
    if (fill)   fill.style.width = pct + '%';
    if (pctEl)  pctEl.innerText  = pct + '%';
    if (status) status.innerText = statusText || '';
}

function hideUploadBar(delay = 1500) {
    setTimeout(() => {
        const bar = document.getElementById('r2UploadBar');
        if (bar) bar.remove();
    }, delay);
}

function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

// ── Cover зураг сонгох (R2 upload) ────────────────────────────
async function handleCoverFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    showUploadBar('coverUploadArea', file.name, formatBytes(file.size));

    try {
        const url = await uploadFileToR2(file, 'covers', (pct) => {
            updateUploadBar(pct, pct < 100 ? 'Upload хийж байна...' : 'Дууслаа ✅');
        });
        tempSelectedCoverFile = url;

        const preview    = document.getElementById('coverPreviewImg');
        const previewBox = document.getElementById('coverPreviewBox');
        if (preview)    preview.src               = url;
        if (previewBox) previewBox.style.display  = 'block';
        const label = document.getElementById('coverPreviewLabel');
        if (label) label.innerHTML = '<i class="fas fa-check"></i> Cover R2-д upload дууслаа';

        hideUploadBar(1000);
        showToast('Cover зураг амжилттай upload хийгдлээ!');
    } catch (err) {
        hideUploadBar(0);
        showToast('Cover upload алдаа: ' + err.message, 'error');
        console.error(err);
    }
}

function toggleCoverUrlInput() {
    let urlInput = document.getElementById('admCoverUrl');
    if (urlInput) {
        urlInput.style.display = urlInput.style.display === 'none' ? 'block' : 'none';
        if (urlInput.style.display === 'block') {
            urlInput.focus();
            urlInput.oninput = function () {
                tempSelectedCoverFile = this.value;
                let preview    = document.getElementById('coverPreviewImg');
                let previewBox = document.getElementById('coverPreviewBox');
                if (preview && this.value) {
                    preview.src = this.value;
                    if (previewBox) previewBox.style.display = 'block';
                }
            };
        }
    }
}

// ── Видео файл сонгох (R2 multipart upload) ───────────────────
async function handleVideoFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusText = document.getElementById('admVideoStatusText');
    if (statusText) statusText.innerText = `⏳ Upload эхлэж байна: ${file.name}`;

    showUploadBar('admVideoUploadArea', file.name, formatBytes(file.size));

    try {
        const url = await uploadFileToR2(file, 'videos', (pct) => {
            updateUploadBar(pct,
                pct < 100
                    ? `Upload хийж байна... (${pct}%)`
                    : '✅ R2-д хадгалагдлаа'
            );
            if (statusText) statusText.innerText = `⏳ ${pct}% — ${file.name}`;
        });

        tempSelectedVideoFile = url;
        if (statusText) statusText.innerText = `✅ Upload дууслаа: ${file.name}`;

        hideUploadBar(1000);
        showToast('Видео амжилттай upload хийгдлээ!');
    } catch (err) {
        hideUploadBar(0);
        if (statusText) statusText.innerText = `❌ Upload алдаа: ${err.message}`;
        showToast('Видео upload алдаа: ' + err.message, 'error');
        console.error(err);
    }
}

function toggleVideoUrlInput() {
    let urlInput = document.getElementById('admVideoUrl');
    if (urlInput) {
        urlInput.style.display = urlInput.style.display === 'none' ? 'block' : 'none';
        if (urlInput.style.display === 'block') {
            urlInput.focus();
            urlInput.oninput = function () {
                tempSelectedVideoFile = this.value;
                let statusText = document.getElementById('admVideoStatusText');
                if (statusText) statusText.innerText = `✅ URL оруулсан: ${this.value.substring(0, 50)}`;
            };
        }
    }
}

// ── Episode thumbnail ──────────────────────────────────────────
async function handleEpThumbSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('admThumbStatusText');
    if (statusEl) statusEl.innerText = `⏳ Upload хийж байна...`;

    showUploadBar('admThumbUploadArea', file.name, formatBytes(file.size));

    try {
        const url = await uploadFileToR2(file, 'thumbs', (pct) => {
            updateUploadBar(pct, pct < 100 ? `${pct}%` : '✅ Дууслаа');
        });
        tempSelectedEpThumb = url;
        if (statusEl) statusEl.innerText = `✅ Thumbnail: ${file.name}`;
        hideUploadBar(1000);
        showToast('Thumbnail upload хийгдлээ!');
    } catch (err) {
        hideUploadBar(0);
        if (statusEl) statusEl.innerText = `❌ Алдаа: ${err.message}`;
        showToast('Thumbnail upload алдаа: ' + err.message, 'error');
        console.error(err);
    }
}

// ─────────────────────────────────────────────────────────────────
// ███████╗    ИМЭЙЛ ЯВУУЛАХ  (Cloudflare Worker → Resend)
// ─────────────────────────────────────────────────────────────────

/**
 * Нэг имэйл явуулах — Worker-д дамжуулна
 */
async function sendEmail(to, subject, html) {
    if (!WORKER_URL || WORKER_URL.includes('YOUR_NAME')) return;
    try {
        // АЮУЛГҮЙ БАЙДЛЫН ЗАСАЛ: JWT ашиглах
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;
        await fetch(WORKER_URL + '/email/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({ to, subject, html }),
        });
    } catch (err) {
        console.warn('Имэйл явуулж чадсангүй:', err);
    }
}

/** VIP идэвхжсэн мэдэгдэл */
function emailVipApproved(user, vipLabel, expiryDate) {
    sendEmail(
        user.email,
        '👑 GoyKino — VIP эрх идэвхжлээ!',
        `<div style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:32px;border-radius:12px;">
            <h2 style="color:#f59e0b;">👑 VIP эрх идэвхжлээ, ${user.name}!</h2>
            <p style="color:#94a3b8;line-height:1.6;margin-top:12px;">
                Таны <strong style="color:#fff;">${vipLabel}</strong> VIP эрх идэвхжлээ.<br>
                Дуусах хугацаа: <strong style="color:#f59e0b;">${expiryDate}</strong>
            </p>
            <a href="https://goykino.mn" style="display:inline-block;margin-top:20px;background:#f59e0b;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">
                Кино үзэх →
            </a>
            <p style="color:#475569;font-size:12px;margin-top:24px;">GoyKino · Монголын кино платформ</p>
        </div>`
    );
}

/** Түрээс нээгдсэн мэдэгдэл */
function emailRentApproved(user, movieTitle) {
    sendEmail(
        user.email,
        `🎬 GoyKino — "${movieTitle}" нээгдлээ!`,
        `<div style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:32px;border-radius:12px;">
            <h2 style="color:#3b82f6;">🎬 Кино нээгдлээ, ${user.name}!</h2>
            <p style="color:#94a3b8;line-height:1.6;margin-top:12px;">
                <strong style="color:#fff;">${movieTitle}</strong> киног одоо үзэх боломжтой боллоо.
            </p>
            <a href="https://goykino.mn" style="display:inline-block;margin-top:20px;background:#3b82f6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">
                Кино үзэх →
            </a>
            <p style="color:#475569;font-size:12px;margin-top:24px;">GoyKino · Монголын кино платформ</p>
        </div>`
    );
}

// ─────────────────────────────────────────────────────────────────
// ADMIN
// ─────────────────────────────────────────────────────────────────
function switchAdminTab(tabId) {
    adminActiveTab = tabId;
    document.querySelectorAll('.admin-tabs-nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.add('hidden'));

    let tabBtnMap = { moviesTab: 'btn-tab-movies', requestsTab: 'btn-tab-requests', usersTab: 'btn-tab-users' };
    let btn = document.getElementById(tabBtnMap[tabId]);
    if (btn) btn.classList.add('active');
    let tab = document.getElementById(tabId);
    if (tab) tab.classList.remove('hidden');
    initAdminPanel();
}

function initAdminPanel() {
    if (adminActiveTab === 'moviesTab')    renderAdminMovieList();
    else if (adminActiveTab === 'usersTab')    renderAdminUsersTable();
    else if (adminActiveTab === 'requestsTab') renderAdminRequests();
    updateRequestBadge();
}

async function adminAddEpisodeToMovie() {
    if (!await verifyIsAdmin()) return; // SERVER-SIDE ШАЛГАЛТ — өмнө дутуу байсан
    if (!adminSelectedSeriesId) return showToast('Эхлээд жагсаалтаас кино сонгоно уу!', 'error');
    let num    = parseInt(document.getElementById('admNewEpNumber').value);
    let epTitle = document.getElementById('admNewEpTitle')?.value.trim() || `${num}-р анги`;

    if (!num) return showToast('Ангийн дугаар заавал оруулна уу!', 'error');
    if (!tempSelectedVideoFile) return showToast('Видео файл эсвэл URL оруулна уу!', 'error');

    let m = movies.find(mv => mv.id === adminSelectedSeriesId);
    if (!m.episodes) m.episodes = [];
    if (m.episodes.some(e => e.num === num)) return showToast('Энэ ангийн дугаар аль хэдийн байна!', 'error');

    m.episodes.push({ num, title: epTitle, file: tempSelectedVideoFile, thumb: tempSelectedEpThumb });
    m.episodes.sort((a, b) => a.num - b.num);
    updateLocalState();

    const { error } = await supabaseClient
        .from('movies').update({ episodes: m.episodes }).eq('id', adminSelectedSeriesId);
    if (error) console.error('Supabase episodes update алдаа:', error);

    document.getElementById('admNewEpNumber').value = '';
    if (document.getElementById('admNewEpTitle')) document.getElementById('admNewEpTitle').value = '';
    document.getElementById('admVideoFileInput').value = '';
    document.getElementById('admVideoStatusText').innerText = 'Файл сонгоогүй байна.';
    if (document.getElementById('admEpThumbInput')) document.getElementById('admEpThumbInput').value = '';
    if (document.getElementById('admThumbStatusText')) document.getElementById('admThumbStatusText').innerText = 'Thumbnail сонгоогүй.';
    tempSelectedVideoFile = '';
    tempSelectedEpThumb   = '';

    renderAdminMovieList();
    renderHomeMovies();
    showToast(`${m.title} кинонд Анги ${num} нэмэгдлээ!`);
}

async function adminSaveMovie() {
    if (!await verifyIsAdmin()) return; // SERVER-SIDE ШАЛГАЛТ
    let title    = document.getElementById('admTitle').value.trim();
    let desc     = document.getElementById('admDesc').value.trim();
    let price    = parseInt(document.getElementById('admPrice').value) || 0;
    let code     = document.getElementById('admManualCode').value.trim();
    let category = document.getElementById('admCategory').value;
    let status   = document.getElementById('admStatus').value;
    let cover    = tempSelectedCoverFile || document.getElementById('admCoverUrl')?.value || '';

    if (!title || !code) return showToast('Нэр болон код заавал хэрэгтэй!', 'error');

    if (adminEditingMovieId) {
        let m = movies.find(mv => mv.id === adminEditingMovieId);
        if (m) {
            m.title = title; m.desc = desc; m.price = price;
            m.code  = code;  m.category = category; m.status = status;
            if (cover) m.cover = cover;

            const { error } = await supabaseClient.from('movies')
                .update({ title: m.title, desc: m.desc, price: m.price,
                          code: m.code, category: m.category, status: m.status, cover: m.cover })
                .eq('id', adminEditingMovieId);
            if (error) console.error('Supabase movie update алдаа:', error);

            showToast('Киноны мэдээлэл амжилттай шинэчлэгдлээ!');
        }
        adminEditingMovieId = null;
        let btn = document.getElementById('btnAdminMovieSubmit');
        if (btn) { btn.innerText = 'Шууд нийтлэх'; btn.style.background = '#10b981'; }
    } else {
        let newMovie = {
            title, desc, price, code, category, status,
            cover: cover || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400',
            views: 0, episodes: [], isTrending: false, isNew: true
        };

        const { data: inserted, error } = await supabaseClient
            .from('movies').insert(newMovie).select().single();

        if (!error && inserted) { newMovie.id = inserted.id; }
        else { newMovie.id = Date.now(); if (error) console.error('Supabase movie insert алдаа:', error); }

        movies.push(newMovie);
        showToast('Шинэ кино амжилттай нэмэгдлээ!');
    }

    updateLocalState();
    ['admTitle', 'admDesc', 'admManualCode'].forEach(id => {
        let el = document.getElementById(id); if (el) el.value = '';
    });
    document.getElementById('admPrice').value = '0';
    if (document.getElementById('admCoverUrl')) document.getElementById('admCoverUrl').value = '';
    let previewBox = document.getElementById('coverPreviewBox');
    if (previewBox) previewBox.style.display = 'none';
    tempSelectedCoverFile = '';

    renderAdminMovieList();
    renderHomeMovies();
}

function adminPrepareEditMovie(id) {
    let m = movies.find(mv => mv.id === id);
    if (!m) return;
    adminEditingMovieId = id;
    document.getElementById('admTitle').value       = m.title;
    document.getElementById('admDesc').value        = m.desc;
    document.getElementById('admPrice').value       = m.price;
    document.getElementById('admManualCode').value  = m.code;
    document.getElementById('admCategory').value    = m.category;
    document.getElementById('admStatus').value      = m.status;

    if (m.cover) {
        tempSelectedCoverFile = m.cover;
        let preview    = document.getElementById('coverPreviewImg');
        let previewBox = document.getElementById('coverPreviewBox');
        if (preview)    preview.src             = m.cover;
        if (previewBox) previewBox.style.display = 'block';
    }

    let btn = document.getElementById('btnAdminMovieSubmit');
    if (btn) { btn.innerText = 'Өөрчлөлтийг хадгалах'; btn.style.background = '#3b82f6'; }

    switchAdminTab('moviesTab');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast(`Засах горим: ${m.title}`);
}

function adminSelectMovieForEpisodes(id) {
    let m = movies.find(mv => mv.id === id);
    if (!m) return;
    adminSelectedSeriesId = id;
    let display = document.getElementById('admSelectedSeriesDisplay');
    if (display) display.innerHTML = `✅ Сонгогдсон: <strong>${m.title}</strong> (${m.code}) - ${m.episodes ? m.episodes.length : 0} анги`;
}

function renderAdminMovieList() {
    let container = document.getElementById('adminMovieList');
    if (!container) return;
    if (movies.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:10px;">Кино байхгүй байна.</p>';
        return;
    }
    container.innerHTML = movies.map(m => {
        let epList = (m.episodes && m.episodes.length > 0)
            ? `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed #334155;">
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:5px;">Ангиуд:</div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">
                    ${m.episodes.map(ep => `
                        <div style="display:flex;align-items:center;gap:3px;background:#1e3a8a;padding:3px 6px;border-radius:4px;">
                            <span style="font-size:11px;color:#93c5fd;">${ep.num}-р анги</span>
                            <button onclick="adminDeleteEpisode(${m.id},${ep.num})" title="Устгах"
                                style="background:#ef4444;color:#fff;border:none;width:16px;height:16px;border-radius:3px;cursor:pointer;font-size:10px;line-height:1;padding:0;">×</button>
                        </div>
                    `).join('')}
                </div>
              </div>`
            : '<div style="font-size:11px;color:var(--text-muted);margin-top:5px;">Анги байхгүй</div>';

        return `
        <div style="margin-bottom:8px;background:var(--bg-dark);padding:10px;border-radius:6px;border:1px solid var(--border-color);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;align-items:center;gap:10px;">
                    ${m.cover ? `<img src="${safeUrl(m.cover)}" style="width:40px;height:55px;object-fit:cover;border-radius:4px;">` : '<div style="width:40px;height:55px;background:#334155;border-radius:4px;"></div>'}
                    <div>
                        <strong style="font-size:13px;">${escapeHtml(m.title)}</strong>
                        <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(m.code)} · ${m.episodes ? m.episodes.length : 0} анги · ${m.price === 0 ? 'Үнэгүй' : m.price.toLocaleString() + ' ₮'}</div>
                    </div>
                </div>
                <div style="display:flex;gap:5px;flex-wrap:wrap;">
                    <button onclick="adminSelectMovieForEpisodes(${m.id})" style="background:#8b5cf6;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Анги+</button>
                    <button onclick="adminPrepareEditMovie(${m.id})" style="background:#f59e0b;color:#000;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:600;">Засах</button>
                    <button onclick="adminDeleteMovie(${m.id})" style="background:#ef4444;color:#fff;border:none;padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;">Устгах</button>
                </div>
            </div>
            ${epList}
        </div>`;
    }).join('');
}

async function adminDeleteMovie(id) {
    if (!await verifyIsAdmin()) return; // SERVER-SIDE ШАЛГАЛТ
    let m = movies.find(mv => mv.id === id);
    if (!m) return;
    showConfirm(
        `"${m.title}" киног устгахдаа итгэлтэй байна уу? Ангиуд ч хамт устагдана.`,
        async () => {
            movies = movies.filter(mv => mv.id !== id);
            if (adminSelectedSeriesId === id) {
                adminSelectedSeriesId = null;
                let display = document.getElementById('admSelectedSeriesDisplay');
                if (display) display.innerText = 'Кино сонгогдоогүй байна.';
            }
            updateLocalState();
            const { error } = await supabaseClient.from('movies').delete().eq('id', id);
            if (error) console.error('Supabase movie delete алдаа:', error);
            renderAdminMovieList();
            renderHomeMovies();
            showToast('Кино устгагдлаа.');
        },
        'Кино устгах', 'Тийм, устгах'
    );
}

// ===== ХЭРЭГЛЭГЧДИЙН ХҮСНЭГТ =====
const USERS_PER_PAGE = 20;
let usersCurrentPage = 0;
let usersTotalCount  = 0;

async function renderAdminUsersTable(page = 0) {
    let tbody = document.getElementById('adminUsersTableBody');
    if (!tbody) return;

    usersCurrentPage = page;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:20px;"><i class="fas fa-spinner fa-spin"></i> Ачааллаж байна...</td></tr>';

    const from = page * USERS_PER_PAGE;
    const to   = from + USERS_PER_PAGE - 1;

    const { data: usersData, count, error } = await supabaseClient
        .from('profile')
        .select('*', { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, to);

    if (error) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:20px;">Татахад алдаа гарлаа.</td></tr>';
        return;
    }

    users = usersData || [];
    usersTotalCount = count || 0;

    tbody.innerHTML = users.map((u, idx) => {
        // isVipActive ашиглан зөв шалгах
        let vipText = isVipActive(u)
            ? `<span style="color:#10b981;">Идэвхтэй (${new Date(u.vipExpires).toLocaleDateString('mn-MN')})</span>`
            : '<span style="color:var(--text-muted);">Ердийн</span>';

        let actionButtons = u.role !== 'admin' ? `
            <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;">
                ${u.role === 'moderator'
                    ? `<button onclick="changeUserRole(${JSON.stringify(u.email)},'user')" style="background:#d97706;color:#fff;padding:4px 8px;font-size:11px;border:none;border-radius:4px;cursor:pointer;">Mod цуцлах</button>`
                    : `<button onclick="changeUserRole(${JSON.stringify(u.email)},'moderator')" style="background:#3b82f6;color:#fff;padding:4px 8px;font-size:11px;border:none;border-radius:4px;cursor:pointer;">Mod болгох</button>`
                }
                <input type="number" id="vipDays-${idx}" placeholder="Хоног"
                    style="width:60px;padding:4px;font-size:11px;background:#0f172a;border:1px solid #334155;color:#fff;border-radius:4px;">
                <button onclick="adminGiveVipDays(${JSON.stringify(u.email)},${idx})" style="background:#10b981;color:#fff;padding:4px 8px;font-size:11px;border:none;border-radius:4px;cursor:pointer;">VIP өгөх</button>
                <button onclick="adminApprovePayment(${JSON.stringify(u.email)})" style="background:#8b5cf6;color:#fff;padding:4px 8px;font-size:11px;border:none;border-radius:4px;cursor:pointer;">Түрээс нээх</button>
            </div>
        ` : `<span style="color:var(--vip-color);font-weight:600;">Үндсэн Админ</span>`;

        return `
            <tr>
                <td><img src="${safeUrl(u.avatar || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png')}"
                    style="width:28px;height:28px;border-radius:50%;margin-right:8px;vertical-align:middle;">${escapeHtml(u.name)}</td>
                <td>${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.phone || '-')}</td>
                <td><span class="badge" style="background:#475569;color:#fff;">${escapeHtml((u.role || 'user').toUpperCase())}</span></td>
                <td>${vipText}</td>
                <td>${actionButtons}</td>
            </tr>`;
    }).join('');

    // Pagination товчнууд
    const totalPages = Math.ceil(usersTotalCount / USERS_PER_PAGE);
    if (totalPages > 1) {
        const paginationEl = document.getElementById('usersPagination') || (() => {
            const el = document.createElement('div');
            el.id = 'usersPagination';
            el.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center;margin-top:15px;';
            tbody.closest('.table-responsive')?.after(el);
            return el;
        })();

        paginationEl.innerHTML = `
            <button onclick="renderAdminUsersTable(${page - 1})"
                style="background:#334155;color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:13px;${page === 0 ? 'opacity:0.4;pointer-events:none;' : ''}"
            ><i class="fas fa-chevron-left"></i></button>
            <span style="font-size:13px;color:var(--text-muted);">
                ${page + 1} / ${totalPages} <span style="font-size:11px;">(Нийт ${usersTotalCount} хэрэглэгч)</span>
            </span>
            <button onclick="renderAdminUsersTable(${page + 1})"
                style="background:#334155;color:#fff;border:none;padding:7px 14px;border-radius:6px;cursor:pointer;font-size:13px;${page + 1 >= totalPages ? 'opacity:0.4;pointer-events:none;' : ''}"
            ><i class="fas fa-chevron-right"></i></button>`;
    }
}

async function adminGiveVipDays(userEmail, idx) {
    if (!await verifyIsAdmin()) return; // SERVER-SIDE ШАЛГАЛТ
    let dayInput = document.getElementById(`vipDays-${idx}`);
    let days = parseInt(dayInput.value);
    if (!days || days <= 0) return showToast('Зөв хоногийн тоо оруулна уу!', 'error');

    let u = users.find(us => us.email === userEmail);
    if (!u) return;

    let currentMs = u.vipExpires ? Number(new Date(u.vipExpires)) : 0;
    let base      = currentMs > Date.now() ? currentMs : Date.now();
    u.vipExpires  = base + days * 24 * 60 * 60 * 1000;
    updateLocalState();

    const { error } = await supabaseClient
        .from('profile').update({ vipExpires: u.vipExpires }).eq('email', userEmail);
    if (error) console.error('Supabase VIP update алдаа:', error);

    // Имэйл мэдэгдэл
    emailVipApproved(u, `${days} хоногийн VIP`, new Date(u.vipExpires).toLocaleDateString('mn-MN'));

    renderAdminUsersTable();
    dayInput.value = '';
    showToast(`${u.name} хэрэглэгчид ${days} хоногийн VIP нэмлээ!`);
}

async function adminApprovePayment(userEmail) {
    if (!await verifyIsAdmin()) return;

    // 1️⃣ DB-аас шинэ pending хүсэлтүүдийг татна (local state-д найдахгүй)
    const { data: freshReqs, error: fetchErr } = await supabaseClient
        .from('requests')
        .select('*')
        .eq('userEmail', userEmail)
        .eq('type', 'PAYMENT')
        .eq('status', 'pending');

    if (fetchErr || !freshReqs || freshReqs.length === 0)
        return showToast('Энэ хэрэглэгчид хүлээгдэж байгаа төлбөрийн хүсэлт байхгүй байна.', 'error');

    // 2️⃣ Хэрэглэгчийн шинэ өгөгдлийг DB-аас татна
    const { data: freshUser, error: userErr } = await supabaseClient
        .from('profile').select('*').eq('email', userEmail).single();
    if (userErr || !freshUser) return showToast('Хэрэглэгч олдсонгүй!', 'error');

    let approvedCount = 0;
    for (const r of freshReqs) {
        // 3️⃣ Тус бүрд lock хийнэ — 2 admin зэрэг дарвал зөвхөн нэг нь амжина
        const { error: lockErr } = await supabaseClient
            .from('requests').update({ status: 'approved' })
            .eq('id', r.id).eq('status', 'pending');
        if (lockErr) continue; // Аль хэдийн өөр admin батласан

        if (r.paymentType === 'VIP') {
            let days      = getVipDays(r.code);
            let currentMs = freshUser.vipExpires ? Number(new Date(freshUser.vipExpires)) : 0;
            let base      = currentMs > Date.now() ? currentMs : Date.now();
            freshUser.vipExpires = base + days * 24 * 60 * 60 * 1000;
            await supabaseClient.from('profile')
                .update({ vipExpires: freshUser.vipExpires }).eq('id', freshUser.id);
            emailVipApproved(freshUser, r.code, new Date(freshUser.vipExpires).toLocaleDateString('mn-MN'));
        } else if (r.paymentType === 'RENT') {
            let rentedMovies = freshUser.rentedMovies || [];
            if (!rentedMovies.includes(r.code)) {
                rentedMovies.push(r.code);
                freshUser.rentedMovies = rentedMovies;
                await supabaseClient.from('profile')
                    .update({ rentedMovies }).eq('id', freshUser.id);
                let movie = movies.find(m => m.code === r.code);
                if (movie) emailRentApproved(freshUser, movie.title);
            }
        }

        // Local state шинэчилнэ
        let localReq = requests.find(req => req.id === r.id);
        if (localReq) localReq.status = 'approved';
        approvedCount++;
    }

    // Local user шинэчилнэ
    let localUser = users.find(us => us.id === freshUser.id);
    if (localUser) {
        localUser.vipExpires   = freshUser.vipExpires;
        localUser.rentedMovies = freshUser.rentedMovies;
    }

    renderAdminUsersTable();
    updateRequestBadge();
    showToast(approvedCount > 0
        ? `${freshUser.name} хэрэглэгчийн ${approvedCount} хүсэлт баталгаажлаа!`
        : 'Хүсэлтүүд аль хэдийн баталгаажсан байна.');
}

async function changeUserRole(userEmail, newRole) {
    if (!await verifyIsAdmin()) return; // SERVER-SIDE ШАЛГАЛТ
    let u = users.find(us => us.email === userEmail);
    if (!u) return;
    u.role = newRole;
    updateLocalState();

    const { error } = await supabaseClient
        .from('profile').update({ role: newRole }).eq('email', userEmail);
    if (error) console.error('Supabase role update алдаа:', error);

    renderAdminUsersTable();
    checkAuthUI();
    showToast(`${u.name} → ${newRole === 'moderator' ? 'Модератор болголлоо ✅' : 'Энгийн хэрэглэгч болголлоо'}`);
}

// ===== ХҮСЭЛТҮҮД =====
function renderAdminRequests() {
    let container = document.getElementById('adminRequestsList');
    if (!container) return;

    let pendingReqs = requests.filter(r => r.status === 'pending');
    if (pendingReqs.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">Шинэ хүсэлт ирээгүй байна.</p>';
        return;
    }

    container.innerHTML = pendingReqs.map(r => {
        if (r.type === 'PAYMENT') {
            return `
                <div class="request-card" style="border-left:4px solid var(--vip-color);">
                    <div class="request-header">
                        <strong>💰 ТӨЛБӨРИЙН ХҮСЭЛТ</strong>
                        <span class="badge" style="background:#1e3a8a;color:#fff;">${escapeHtml(r.paymentType || 'PAYMENT')}</span>
                    </div>
                    <p>Хэрэглэгч: <strong>${escapeHtml(r.userName)}</strong> (Утас: ${escapeHtml(r.userPhone)})</p>
                    <p>Код: <strong>${escapeHtml(r.code)}</strong> · Дүн: <strong style="color:#10b981;">${r.amount?.toLocaleString()} ₮</strong></p>
                    <p style="font-size:11px;color:var(--text-muted);">${new Date(r.createdAt).toLocaleString('mn-MN')}</p>
                    <div style="display:flex;gap:10px;margin-top:10px;">
                        <button onclick="approveRequest(${r.id})" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:bold;">✅ Баталгаажуулах</button>
                        <button onclick="rejectRequest(${r.id})" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;">❌ Татгалзах</button>
                    </div>
                </div>`;
        } else if (r.type === 'MOVIE_ADD') {
            return `
                <div class="request-card" style="border-left:4px solid var(--primary);">
                    <div class="request-header">
                        <strong>🎬 КИНО НЭМЭХ ХҮСЭЛТ</strong>
                        <span class="badge">${r.category === 'drama' ? 'Цуврал' : 'Вэбтун'}</span>
                    </div>
                    <h4>${escapeHtml(r.title)} (${escapeHtml(r.code)})</h4>
                    <p style="color:var(--text-muted);font-size:13px;">${escapeHtml(r.desc)}</p>
                    <p>Үнэ: <strong>${r.price === 0 ? 'Үнэгүй' : r.price.toLocaleString() + ' ₮'}</strong> · Илгээсэн: <strong>${escapeHtml(r.senderName)}</strong></p>
                    <div style="display:flex;gap:10px;margin-top:10px;">
                        <button onclick="approveMovieRequest(${r.id})" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:bold;">✅ Нийтлэх</button>
                        <button onclick="rejectRequest(${r.id})" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;">❌ Татгалзах</button>
                    </div>
                </div>`;
        } else if (r.type === 'EPISODE_ADD') {
            let safeVideoUrl = safeUrl(r.videoUrl || '');
            let shortUrl = escapeHtml((r.videoUrl || '').substring(0, 50));
            return `
                <div class="request-card" style="border-left:4px solid #8b5cf6;">
                    <div class="request-header">
                        <strong>📺 АНГИ НЭМЭХ ХҮСЭЛТ</strong>
                        <span class="badge" style="background:#8b5cf6;color:#fff;">Анги ${r.epNum}</span>
                    </div>
                    <h4>${escapeHtml(r.movieTitle)} · <span style="color:var(--text-muted);font-size:13px;">${escapeHtml(r.epTitle)}</span></h4>
                    <p style="font-size:12px;color:var(--text-muted);">Видео: <a href="${safeVideoUrl}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${shortUrl}...</a></p>
                    <p style="font-size:12px;">Илгээсэн: <strong>${escapeHtml(r.senderName)}</strong> · ${new Date(r.createdAt).toLocaleString('mn-MN')}</p>
                    <div style="display:flex;gap:10px;margin-top:10px;">
                        <button onclick="approveEpisodeRequest(${r.id})" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-weight:bold;">✅ Нэмэх</button>
                        <button onclick="rejectRequest(${r.id})" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;">❌ Татгалзах</button>
                    </div>
                </div>`;
        }
        return '';
    }).join('');
}

// ── 2 Admin race condition хамгаалалт ─────────────────────────────
// Эхлээд Supabase-д status='approved' болгоно (эхний admin л амжина)
// Дараа нь хэрэглэгчийн эрхийг шинэчилнэ
// Хоёр дахь admin дарахад "аль хэдийн баталгаажсан" мэдэгдэл гарна
async function approveRequest(reqId) {
    if (!await verifyIsAdmin()) return;

    // 1️⃣ Supabase-аас ШИНЭ STATUS шалгана (local state дээр найдахгүй)
    const { data: freshReq, error: fetchErr } = await supabaseClient
        .from('requests').select('*').eq('id', reqId).single();
    if (fetchErr || !freshReq) return showToast('Хүсэлт олдсонгүй!', 'error');
    if (freshReq.status !== 'pending') {
        showToast('Энэ хүсэлтийг аль хэдийн баталгаажуулсан байна!', 'error');
        requests = requests.filter(r => r.id !== reqId);
        renderAdminRequests();
        updateRequestBadge();
        return;
    }

    // 2️⃣ ЭХЛЭЭД status солино — хоёр дахь admin дарж чадахгүй болно
    const { error: lockErr } = await supabaseClient
        .from('requests').update({ status: 'approved' }).eq('id', reqId).eq('status', 'pending');
    if (lockErr) return showToast('Баталгаажуулахад алдаа гарлаа!', 'error');

    // 3️⃣ Supabase-аас хэрэглэгчийн ШИНЭ өгөгдлийг авна (хуучин local биш)
    const { data: freshUser } = await supabaseClient
        .from('profile').select('*').eq('id', freshReq.userId).single();
    if (freshUser) {
        if (freshReq.paymentType === 'VIP') {
            let days      = getVipDays(freshReq.code);
            let currentMs = freshUser.vipExpires ? Number(new Date(freshUser.vipExpires)) : 0;
            let base      = currentMs > Date.now() ? currentMs : Date.now();
            let newExpiry = base + days * 24 * 60 * 60 * 1000;

            await supabaseClient.from('profile').update({ vipExpires: newExpiry }).eq('id', freshUser.id);
            emailVipApproved(freshUser, freshReq.code, new Date(newExpiry).toLocaleDateString('mn-MN'));

        } else if (freshReq.paymentType === 'RENT') {
            let rentedMovies = freshUser.rentedMovies || [];
            if (!rentedMovies.includes(freshReq.code)) {
                rentedMovies.push(freshReq.code);
                await supabaseClient.from('profile').update({ rentedMovies }).eq('id', freshUser.id);
                let movie = movies.find(m => m.code === freshReq.code);
                if (movie) emailRentApproved(freshUser, movie.title);
            }
        }
    }

    // 4️⃣ Local state шинэчилнэ
    let r = requests.find(req => req.id === reqId);
    if (r) r.status = 'approved';

    renderAdminRequests();
    updateRequestBadge();
    showToast('Хүсэлт баталгаажлаа!');
}

async function approveMovieRequest(reqId) {
    if (!await verifyIsAdmin()) return;

    // 1️⃣ Supabase-аас шинэ статус шалгана
    const { data: freshReq, error: fetchErr } = await supabaseClient
        .from('requests').select('*').eq('id', reqId).single();
    if (fetchErr || !freshReq) return showToast('Хүсэлт олдсонгүй!', 'error');
    if (freshReq.status !== 'pending') {
        showToast('Энэ хүсэлтийг аль хэдийн баталгаажуулсан байна!', 'error');
        requests = requests.filter(r => r.id !== reqId);
        renderAdminRequests(); updateRequestBadge();
        return;
    }

    // 2️⃣ Эхлээд lock хийнэ
    const { error: lockErr } = await supabaseClient
        .from('requests').update({ status: 'approved' }).eq('id', reqId).eq('status', 'pending');
    if (lockErr) return showToast('Баталгаажуулахад алдаа гарлаа!', 'error');

    // 3️⃣ Кино нэмнэ
    let newMovie = {
        title: freshReq.title, desc: freshReq.desc, price: freshReq.price,
        code: freshReq.code, category: freshReq.category,
        status: freshReq.movieStatus || 'Үргэлжилж байгаа',
        cover: freshReq.cover || 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400',
        views: 0, episodes: [], isTrending: false, isNew: true
    };

    const { data: inserted, error: movieErr } = await supabaseClient
        .from('movies').insert(newMovie).select().single();
    if (!movieErr && inserted) { newMovie.id = inserted.id; }
    else { newMovie.id = Date.now(); console.error('Movie insert алдаа:', movieErr); }

    movies.push(newMovie);
    let r = requests.find(req => req.id === reqId);
    if (r) r.status = 'approved';

    renderAdminRequests();
    renderHomeMovies();
    updateRequestBadge();
    showToast('Кино нийтлэгдлээ!');
}

async function approveEpisodeRequest(reqId) {
    if (!await verifyIsAdmin()) return;

    // 1️⃣ Supabase-аас шинэ статус шалгана
    const { data: freshReq, error: fetchErr } = await supabaseClient
        .from('requests').select('*').eq('id', reqId).single();
    if (fetchErr || !freshReq) return showToast('Хүсэлт олдсонгүй!', 'error');
    if (freshReq.status !== 'pending') {
        showToast('Энэ хүсэлтийг аль хэдийн баталгаажуулсан байна!', 'error');
        requests = requests.filter(r => r.id !== reqId);
        renderAdminRequests(); updateRequestBadge();
        return;
    }

    // 2️⃣ Эхлээд lock хийнэ
    const { error: lockErr } = await supabaseClient
        .from('requests').update({ status: 'approved' }).eq('id', reqId).eq('status', 'pending');
    if (lockErr) return showToast('Баталгаажуулахад алдаа гарлаа!', 'error');

    // 3️⃣ Supabase-аас кинонг шинэ байдлаар татна (бусад admin анги нэмсэн байж болно)
    const { data: freshMovie } = await supabaseClient
        .from('movies').select('*').eq('id', freshReq.movieId).single();
    if (!freshMovie) return showToast('Кино олдсонгүй!', 'error');

    let episodes = freshMovie.episodes || [];
    if (episodes.some(e => e.num === freshReq.epNum)) {
        showToast('Энэ ангийн дугаар аль хэдийн байна!', 'error');
        return;
    }

    episodes.push({ num: freshReq.epNum, title: freshReq.epTitle, file: freshReq.videoUrl, thumb: '' });
    episodes.sort((a, b) => a.num - b.num);

    await supabaseClient.from('movies').update({ episodes }).eq('id', freshReq.movieId);

    // Local state шинэчилнэ
    let m = movies.find(mv => mv.id === freshReq.movieId);
    if (m) { m.episodes = episodes; }
    let r = requests.find(req => req.id === reqId);
    if (r) r.status = 'approved';

    renderAdminRequests();
    renderHomeMovies();
    updateRequestBadge();
    showToast(`${freshMovie.title} кинонд Анги ${freshReq.epNum} нэмэгдлээ!`);
}

async function adminDeleteEpisode(movieId, epNum) {
    // ЗАСАЛ 6: verifyIsAdmin() confirm dialog харуулахаас ӨМНӨ шалгана
    // Өмнө нь: confirm → "Тийм" → шалгалт (хоцрогдсон)
    // Одоо:    шалгалт → confirm → "Тийм" → устгах (зөв дараалал)
    if (!await verifyIsAdmin()) return;
    showConfirm(
        `Анги ${epNum}-г устгахдаа итгэлтэй байна уу?`,
        async () => {
            let m = movies.find(mv => mv.id === movieId);
            if (!m) return;
            m.episodes = m.episodes.filter(e => e.num !== epNum);
            updateLocalState();

            const { error } = await supabaseClient
                .from('movies').update({ episodes: m.episodes }).eq('id', movieId);
            if (error) console.error('Supabase анги устгах алдаа:', error);

            renderAdminMovieList();
            renderHomeMovies();
            showToast('Анги устгагдлаа.');
        },
        'Анги устгах', 'Тийм, устгах'
    );
}

async function rejectRequest(reqId) {
    if (!await verifyIsAdmin()) return; // SERVER-SIDE ШАЛГАЛТ
    let r = requests.find(req => req.id === reqId);
    if (!r) return;
    r.status = 'rejected';
    updateLocalState();

    const { error } = await supabaseClient
        .from('requests').update({ status: 'rejected' }).eq('id', reqId);
    if (error) console.error('Supabase request reject алдаа:', error);

    renderAdminRequests();
    updateRequestBadge();
    showToast('Хүсэлт татгалзагдлаа.', 'error');
}

function updateRequestBadge() {
    let el = document.getElementById('reqBadgeCount');
    if (el) el.innerText = requests.filter(r => r.status === 'pending').length;
}

// ===== SUPABASE ӨГӨГДӨЛ АЧААЛЛАХ =====
async function loadInitialDataFromSupabase() {
    // ЗАСАЛ 1+3: Бүх хэрэглэгч татахгүй, кино 100-аар хязгаарлах (pagination)
    // episodes-ийг эхэнд татахгүй — кино нээхэд л татна (lazy load)
    const { data: moviesData, error: moviesErr } = await supabaseClient
        .from('movies')
        .select('id, title, desc, code, category, status, cover, price, views, isTrending, isNew')
        .order('id', { ascending: false })
        .limit(100);
    if (!moviesErr && Array.isArray(moviesData) && moviesData.length > 0) {
        movies = moviesData;
        hasMoreMovies = moviesData.length === 100; // 100-аас цөөн ирвэл дараагийн хуудас байхгүй
        moviesPage = 0;
    }

    // Зөвхөн нэвтэрсэн хэрэглэгчийн өөрийн мэдээллийг татах
    if (currentUser) {
        const { data: fresh, error: freshErr } = await supabaseClient
            .from('profile').select('*').eq('id', currentUser.id).single();
        if (!freshErr && fresh) {
            currentUser = fresh;
            sessionStorage.setItem('nova_current_user', JSON.stringify(currentUser));
        }
    }

    // Хүсэлтүүд: зөвхөн pending-ийг татна (бүх түүх биш)
    const { data: reqData, error: reqErr } = await supabaseClient
        .from('requests').select('*').eq('status', 'pending');
    if (!reqErr && Array.isArray(reqData)) requests = reqData;

    // ЗАСАЛ 4: renderAllMoviesPage() энд дуудахгүй — showPage('allMoviesPage') дуудахад л render хийнэ
    // Давхар render гарахаас сэргийлнэ
    renderHomeMovies();
    updateRequestBadge();
}

// ===== НЭМЭЛТ КИНО АЧААЛЛАХ (Load More) =====
let moviesPage = 0;
let hasMoreMovies = true; // Server-т цаашид кино байгаа эсэх

async function loadMoreMovies() {
    if (!hasMoreMovies) return;
    moviesPage++;
    const { data, error } = await supabaseClient
        .from('movies')
        .select('id, title, desc, code, category, status, cover, price, views, isTrending, isNew')
        .order('id', { ascending: false })
        .range(moviesPage * 100, moviesPage * 100 + 99);
    if (!error && Array.isArray(data)) {
        if (data.length > 0) movies = [...movies, ...data];
        // 100-аас цөөн ирвэл дараагийн хуудас байхгүй
        if (data.length < 100) hasMoreMovies = false;
        renderAllMoviesPage();
        renderHomeMovies();
    }
}