const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const fetch = require('node-fetch');
const crypto = require('crypto');
const https = require('https');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);

// Функция поиска доступной для записи папки
function ensureWritableDir(dir) {
    const absoluteDir = path.resolve(dir);
    fs.mkdirSync(absoluteDir, {recursive: true});
    const probe = path.join(absoluteDir, `.write-test-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return absoluteDir;
}

function pickStorageRoot() {
    const candidates = [
        process.env.STORAGE_ROOT,
        process.env.DATA_DIR,
        path.join(__dirname, '.data'),
        path.join(os.tmpdir(), 'zubov')
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            return ensureWritableDir(candidate);
        } catch (err) {
            console.warn(`Путь не доступен для записи: ${candidate} (${err.message})`);
        }
    }

    throw new Error('Не найдена папка для записи');
}

const storageRoot = pickStorageRoot();
const dbPath = path.join(storageRoot, 'drz.db');
const sessionsDbPath = path.join(storageRoot, 'sessions.db');

console.log(`📁 Папка для данных: ${storageRoot}`);
console.log(`📁 БД: ${dbPath}`);
console.log(`📁 Сессии: ${sessionsDbPath}`);

// База данных
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Ошибка подключения к БД:', err);
        process.exit(1);
    } else {
        console.log('✅ Подключено к SQLite базе данных');
    }
});

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Сессии
app.use(session({
    store: new SQLiteStore({
        db: sessionsDbPath,
        table: 'sessions',
        concurrentDB: true
    }),
    secret: 'detskaya-stomatologiya-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24
    }
}));

// Middleware для авторизации
const requireAuth = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Необходима авторизация' });
    }
    next();
};

const requireAdmin = (req, res, next) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Необходима авторизация' });
    }

    db.get('SELECT role FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ message: 'Недостаточно прав' });
        }
        next();
    });
};

function runQuery(sql, params, res, successMessage) {
    db.run(sql, params, function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, id: this.lastID, changes: this.changes, message: successMessage });
    });
}

function safeAssetFileName(fileName, contentType) {
    const extFromType = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif'
    }[contentType] || '';
    const parsed = path.parse(fileName || '');
    const rawExt = (parsed.ext || extFromType || '.jpg').toLowerCase();
    const ext = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(rawExt) ? rawExt : '.jpg';
    const base = (parsed.name || 'gallery')
        .toLowerCase()
        .replace(/[^a-z0-9а-яё_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'gallery';
    return `${Date.now()}-${base}${ext}`;
}

// ========== GIGACHAT AI ==========
const agent = new https.Agent({ rejectUnauthorized: false });
const AUTHORIZATION_KEY = "MDE5ZDVlYTktMjRmNy03NDZlLWEzMjktZWI4ODg0ZWQwNGFiOmUyMTM4YWMzLTRkYzItNDEwYy1hOTAyLTk0MTI0NTBhZWY0Yg==";
const GIGACHAT_AUTH_URL = "https://ngw.devices.sberbank.ru:9443/api/v2/oauth";
const GIGACHAT_API_URL = "https://gigachat.devices.sberbank.ru/api/v1/chat/completions";

let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
    if (tokenCache.token && tokenCache.expiresAt > Date.now() / 1000) {
        return tokenCache.token;
    }

    try {
        const rquid = crypto.randomUUID();
        const response = await fetch(GIGACHAT_AUTH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'RqUID': rquid,
                'Authorization': `Basic ${AUTHORIZATION_KEY}`
            },
            body: 'scope=GIGACHAT_API_PERS',
            agent: agent
        });

        const data = await response.json();
        if (data.access_token) {
            tokenCache.token = data.access_token;
            tokenCache.expiresAt = (Date.now() / 1000) + (data.expires_in || 1800) - 60;
            console.log('✅ Токен GigaChat получен');
            return data.access_token;
        }
        return null;
    } catch (error) {
        console.error('❌ Ошибка получения токена:', error.message);
        return null;
    }
}

async function askGigaChat(userMessage) {
    const token = await getAccessToken();
    if (!token) return null;

    const systemPrompt = `Ты дружелюбный ИИ-ассистент детской стоматологии "Доктор Зубов".

КОНТАКТЫ:
- Телефон: +7 (3532) 78-88-88
- Адрес: г. Оренбург, ул. Сергея Лазо, 14

УСЛУГИ И ЦЕНЫ:
- Осмотр и консультация: 0 ₽
- Лечение кариеса молочного зуба: 3500 ₽
- Лечение кариеса постоянного зуба: 4500 ₽
- Герметизация фиссур: 2500 ₽
- Лечение под седацией (во сне): 8000 ₽
- Профессиональная чистка: 3000 ₽
- Удаление молочного зуба: 2500 ₽
- Удаление постоянного зуба: 4000 ₽

ВРАЧИ:
- Иванова Екатерина — детский стоматолог, стаж 12 лет
- Петров Алексей — детский ортодонт, стаж 8 лет
- Смирнова Ольга — детский хирург, стаж 15 лет

АКЦИИ:
- Скидка 37% на лечение 3-х зубов
- Первый визит — подарок ребёнку

ПРАВИЛА:
1. Отвечай коротко (2-4 предложения)
2. Если спрашивают цену — называй точную сумму
3. Если просят посчитать несколько услуг — сложи и назови итог
4. Всегда предлагай записаться по телефону
5. Используй эмодзи 🦷👋😊`;

    try {
        const requestId = crypto.randomUUID();
        const response = await fetch(GIGACHAT_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Request-Id': requestId
            },
            body: JSON.stringify({
                model: 'GigaChat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.7,
                max_tokens: 500
            }),
            agent: agent
        });

        const data = await response.json();
        if (response.status === 200 && data.choices && data.choices[0]) {
            return data.choices[0].message.content;
        }
        return null;
    } catch (error) {
        console.error('❌ Ошибка GigaChat:', error.message);
        return null;
    }
}

// ========== API МАРШРУТЫ ==========

app.get('/api/doctors', (req, res) => {
    db.all('SELECT * FROM doctors WHERE is_active = 1 ORDER BY id', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ doctors: rows });
    });
});

app.get('/api/doctors/:id', (req, res) => {
    db.get('SELECT * FROM doctors WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ message: 'Врач не найден' });
            return;
        }
        res.json(row);
    });
});

app.get('/api/services', (req, res) => {
    db.all('SELECT * FROM services ORDER BY id', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

app.get('/api/services/:id', (req, res) => {
    db.get('SELECT * FROM services WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ message: 'Услуга не найдена' });
            return;
        }
        res.json(row);
    });
});

app.get('/api/promotions', (req, res) => {
    db.all('SELECT * FROM promotions WHERE is_active = 1 ORDER BY id', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ promotions: rows });
    });
});

app.get('/api/gallery', (req, res) => {
    db.all('SELECT * FROM gallery ORDER BY sort_order', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ images: rows });
    });
});

app.get('/api/reviews', (req, res) => {
    const sql = `
        SELECT r.*, u.name as user_name, d.name as doctor_name 
        FROM reviews r 
        LEFT JOIN users u ON r.user_id = u.id 
        LEFT JOIN doctors d ON r.doctor_id = d.id 
        ORDER BY r.created_at DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ reviews: rows });
    });
});

app.post('/api/reviews', requireAuth, (req, res) => {
    const { doctor_id, rating, text } = req.body;
    const user_id = req.session.userId;
    const date = new Date().toISOString().split('T')[0];

    if (!rating || !text) {
        res.status(400).json({ message: 'Все поля обязательны' });
        return;
    }

    db.run(
        'INSERT INTO reviews (user_id, doctor_id, rating, text, date, verified) VALUES (?, ?, ?, ?, ?, 0)',
        [user_id, doctor_id || null, rating, text, date],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, message: 'Отзыв добавлен' });
        }
    );
});

app.get('/api/appointments/my', requireAuth, (req, res) => {
    const sql = `
        SELECT a.*, d.name as doctor_name, s.title as service_name 
        FROM appointments a 
        LEFT JOIN doctors d ON a.doctor_id = d.id 
        LEFT JOIN services s ON a.service_id = s.id 
        WHERE a.user_id = ? 
        ORDER BY a.appointment_date DESC
    `;
    db.all(sql, [req.session.userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ success: true, appointments: rows });
    });
});

app.post('/api/appointments', requireAuth, (req, res) => {
    const { doctor_id, service_id, child_name, child_age, appointment_date, appointment_time, comment } = req.body;
    const user_id = req.session.userId;

    if (!doctor_id || !service_id || !appointment_date || !appointment_time) {
        res.status(400).json({ message: 'Заполните все обязательные поля' });
        return;
    }

    db.run(
        'INSERT INTO appointments (user_id, doctor_id, service_id, child_name, child_age, appointment_date, appointment_time, comment, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [user_id, doctor_id, service_id, child_name || null, child_age || null, appointment_date, appointment_time, comment || null, 'pending'],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, message: 'Запись создана' });
        }
    );
});

app.put('/api/appointments/:id/cancel', requireAuth, (req, res) => {
    db.run(
        'UPDATE appointments SET status = ? WHERE id = ? AND user_id = ?',
        ['cancelled', req.params.id, req.session.userId],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            if (this.changes === 0) {
                res.status(404).json({ message: 'Запись не найдена' });
                return;
            }
            res.json({ message: 'Запись отменена' });
        }
    );
});

app.post('/api/auth/register', async (req, res) => {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password) {
        res.status(400).json({ message: 'Все поля обязательны' });
        return;
    }

    if (password.length < 6) {
        res.status(400).json({ message: 'Пароль должен быть не менее 6 символов' });
        return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (row) {
            res.status(400).json({ message: 'Пользователь с таким email уже существует' });
            return;
        }

        db.run(
            'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)',
            [name, email, phone, hashedPassword, 'user'],
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                db.run('INSERT INTO bonuses (user_id, amount, description) VALUES (?, ?, ?)',
                    [this.lastID, 500, 'Бонус за регистрацию'],
                    (err) => {
                        if (err) console.error('Ошибка добавления бонуса:', err);
                    }
                );

                res.json({ id: this.lastID, message: 'Регистрация успешна' });
            }
        );
    });
});

app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        res.status(400).json({ message: 'Введите email и пароль' });
        return;
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!user) {
            res.status(401).json({ message: 'Неверный email или пароль' });
            return;
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            res.status(401).json({ message: 'Неверный email или пароль' });
            return;
        }

        req.session.userId = user.id;
        req.session.userName = user.name;
        req.session.userRole = user.role;

        res.json({ message: 'Вход выполнен', user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            res.status(500).json({ message: 'Ошибка выхода' });
            return;
        }
        res.json({ message: 'Выход выполнен' });
    });
});

// Регистрация с возможностью сразу добавить ребенка
app.post('/api/auth/register-with-child', async (req, res) => {
    const { name, email, phone, password, child } = req.body;

    if (!name || !email || !phone || !password) {
        res.status(400).json({ message: 'Все поля обязательны' });
        return;
    }

    if (password.length < 6) {
        res.status(400).json({ message: 'Пароль должен быть не менее 6 символов' });
        return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.get('SELECT id FROM users WHERE email = ?', [email], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (row) {
            res.status(400).json({ message: 'Пользователь с таким email уже существует' });
            return;
        }

        db.run(
            'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)',
            [name, email, phone, hashedPassword, 'user'],
            function(err) {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                const userId = this.lastID;

                // Добавляем бонус за регистрацию
                db.run('INSERT INTO bonuses (user_id, amount, description) VALUES (?, ?, ?)',
                    [userId, 500, 'Бонус за регистрацию'],
                    (err) => { if (err) console.error('Ошибка добавления бонуса:', err); }
                );

                // Добавляем ребенка, если данные переданы
                if (child && child.name && child.birth_date) {
                    db.run(
                        'INSERT INTO children_profiles (user_id, name, birth_date, medical_card) VALUES (?, ?, ?, ?)',
                        [userId, child.name, child.birth_date, child.medical_card || null],
                        (err) => {
                            if (err) console.error('Ошибка добавления ребенка:', err);
                        }
                    );
                }

                res.json({ id: userId, message: 'Регистрация успешна' });
            }
        );
    });
});

// Удаление ребенка
app.delete('/api/children/:id', requireAuth, (req, res) => {
    const childId = req.params.id;
    const userId = req.session.userId;

    db.get('SELECT id FROM children_profiles WHERE id = ? AND user_id = ?', [childId, userId], (err, child) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!child) {
            res.status(404).json({ message: 'Ребенок не найден' });
            return;
        }

        db.run('DELETE FROM children_profiles WHERE id = ? AND user_id = ?', [childId, userId], function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Ребенок успешно удален' });
        });
    });
});

app.get('/api/auth/check', (req, res) => {
    res.json({ isAuthenticated: !!req.session.userId });
});

app.get('/api/auth/user', (req, res) => {
    if (!req.session.userId) {
        res.status(401).json({ message: 'Не авторизован' });
        return;
    }

    db.get('SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!user) {
            res.status(404).json({ message: 'Пользователь не найден' });
            return;
        }
        res.json({ success: true, user });
    });
});

app.put('/api/auth/user', requireAuth, async (req, res) => {
    const { name, email, phone, currentPassword, newPassword } = req.body;

    db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!user) {
            res.status(404).json({ message: 'Пользователь не найден' });
            return;
        }

        const validPassword = await bcrypt.compare(currentPassword, user.password);
        if (!validPassword) {
            res.status(401).json({ message: 'Неверный текущий пароль' });
            return;
        }

        let updateQuery = 'UPDATE users SET name = ?, email = ?, phone = ?';
        let params = [name, email, phone];

        if (newPassword && newPassword.length >= 6) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            updateQuery += ', password = ?';
            params.push(hashedPassword);
        }

        updateQuery += ' WHERE id = ?';
        params.push(req.session.userId);

        db.run(updateQuery, params, function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    res.status(400).json({ message: 'Email уже используется' });
                    return;
                }
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ message: 'Профиль обновлен' });
        });
    });
});

app.get('/api/children', requireAuth, (req, res) => {
    db.all('SELECT * FROM children_profiles WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ children: rows });
    });
});

app.post('/api/children', requireAuth, (req, res) => {
    const { name, birth_date, medical_card } = req.body;
    const user_id = req.session.userId;

    if (!name || !birth_date) {
        res.status(400).json({ message: 'Имя и дата рождения обязательны' });
        return;
    }

    db.run(
        'INSERT INTO children_profiles (user_id, name, birth_date, medical_card) VALUES (?, ?, ?, ?)',
        [user_id, name, birth_date, medical_card || null],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, message: 'Профиль ребенка добавлен' });
        }
    );
});

app.get('/api/bonuses', requireAuth, (req, res) => {
    db.all('SELECT * FROM bonuses WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        const total = rows.reduce((sum, bonus) => sum + bonus.amount, 0);
        res.json({ bonuses: rows, total });
    });
});

app.get('/api/slider-images', (req, res) => {
    db.all('SELECT * FROM gallery ORDER BY sort_order LIMIT 8', [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ images: rows });
    });
});

// ========== ADMIN API ==========
app.get('/api/admin/check', requireAdmin, (req, res) => {
    res.json({ success: true, isAdmin: true });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
    db.all('SELECT id, name, email, phone, role, created_at FROM users ORDER BY id', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ users: rows });
    });
});

app.put('/api/admin/users/:id/role', requireAdmin, (req, res) => {
    const role = req.body.role === 'admin' ? 'admin' : 'user';
    runQuery('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id], res, 'Роль пользователя обновлена');
});

app.get('/api/admin/appointments', requireAdmin, (req, res) => {
    const sql = `
        SELECT a.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
               d.name as doctor_name, s.title as service_name
        FROM appointments a
        LEFT JOIN users u ON a.user_id = u.id
        LEFT JOIN doctors d ON a.doctor_id = d.id
        LEFT JOIN services s ON a.service_id = s.id
        ORDER BY a.created_at DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ appointments: rows });
    });
});

app.put('/api/admin/appointments/:id/status', requireAdmin, (req, res) => {
    const allowed = ['pending', 'confirmed', 'completed', 'cancelled', 'rejected'];
    const status = allowed.includes(req.body.status) ? req.body.status : null;
    if (!status) return res.status(400).json({ message: 'Некорректный статус' });
    runQuery('UPDATE appointments SET status = ? WHERE id = ?', [status, req.params.id], res, 'Статус заявки обновлен');
});

app.get('/api/admin/services', requireAdmin, (req, res) => {
    db.all('SELECT * FROM services ORDER BY id', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ services: rows });
    });
});

app.post('/api/admin/services', requireAdmin, (req, res) => {
    const { title, description, icon, category, price, old_price, is_popular, for_kids } = req.body;
    if (!title || !description || !icon || !category || price === undefined) {
        return res.status(400).json({ message: 'Заполните обязательные поля услуги' });
    }
    runQuery(
        'INSERT INTO services (title, description, icon, category, price, old_price, is_popular, for_kids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [title, description, icon, category, Number(price), old_price ? Number(old_price) : null, is_popular ? 1 : 0, for_kids === false ? 0 : 1],
        res,
        'Услуга добавлена'
    );
});

app.put('/api/admin/services/:id', requireAdmin, (req, res) => {
    const { title, description, icon, category, price, old_price, is_popular, for_kids } = req.body;
    if (!title || !description || !icon || !category || price === undefined) {
        return res.status(400).json({ message: 'Заполните обязательные поля услуги' });
    }
    runQuery(
        'UPDATE services SET title = ?, description = ?, icon = ?, category = ?, price = ?, old_price = ?, is_popular = ?, for_kids = ? WHERE id = ?',
        [title, description, icon, category, Number(price), old_price ? Number(old_price) : null, is_popular ? 1 : 0, for_kids === false ? 0 : 1, req.params.id],
        res,
        'Услуга обновлена'
    );
});

app.delete('/api/admin/services/:id', requireAdmin, (req, res) => {
    runQuery('DELETE FROM services WHERE id = ?', [req.params.id], res, 'Услуга удалена');
});

app.get('/api/admin/doctors', requireAdmin, (req, res) => {
    db.all('SELECT * FROM doctors ORDER BY id', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ doctors: rows });
    });
});

app.post('/api/admin/doctors', requireAdmin, (req, res) => {
    const { name, position, experience, description, photo, specialization, is_active } = req.body;
    if (!name || !position || !experience) return res.status(400).json({ message: 'Заполните обязательные поля врача' });
    runQuery(
        'INSERT INTO doctors (name, position, experience, description, photo, specialization, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, position, experience, description || null, photo || null, specialization || null, is_active === false ? 0 : 1],
        res,
        'Врач добавлен'
    );
});

app.put('/api/admin/doctors/:id', requireAdmin, (req, res) => {
    const { name, position, experience, description, photo, specialization, is_active } = req.body;
    if (!name || !position || !experience) return res.status(400).json({ message: 'Заполните обязательные поля врача' });
    runQuery(
        'UPDATE doctors SET name = ?, position = ?, experience = ?, description = ?, photo = ?, specialization = ?, is_active = ? WHERE id = ?',
        [name, position, experience, description || null, photo || null, specialization || null, is_active === false ? 0 : 1, req.params.id],
        res,
        'Врач обновлен'
    );
});

app.delete('/api/admin/doctors/:id', requireAdmin, (req, res) => {
    runQuery('UPDATE doctors SET is_active = 0 WHERE id = ?', [req.params.id], res, 'Врач скрыт с сайта');
});

app.get('/api/admin/promotions', requireAdmin, (req, res) => {
    db.all('SELECT * FROM promotions ORDER BY id', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ promotions: rows });
    });
});

app.post('/api/admin/promotions', requireAdmin, (req, res) => {
    const { title, description, discount, old_price, new_price, badge, color, icon, end_date, is_active } = req.body;
    if (!title || !description || discount === undefined) return res.status(400).json({ message: 'Заполните обязательные поля акции' });
    runQuery(
        'INSERT INTO promotions (title, description, discount, old_price, new_price, badge, color, icon, end_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [title, description, Number(discount), old_price ? Number(old_price) : null, new_price !== '' && new_price !== undefined && new_price !== null ? Number(new_price) : null, badge || null, color || null, icon || null, end_date || null, is_active === false ? 0 : 1],
        res,
        'Акция добавлена'
    );
});

app.put('/api/admin/promotions/:id', requireAdmin, (req, res) => {
    const { title, description, discount, old_price, new_price, badge, color, icon, end_date, is_active } = req.body;
    if (!title || !description || discount === undefined) return res.status(400).json({ message: 'Заполните обязательные поля акции' });
    runQuery(
        'UPDATE promotions SET title = ?, description = ?, discount = ?, old_price = ?, new_price = ?, badge = ?, color = ?, icon = ?, end_date = ?, is_active = ? WHERE id = ?',
        [title, description, Number(discount), old_price ? Number(old_price) : null, new_price !== '' && new_price !== undefined && new_price !== null ? Number(new_price) : null, badge || null, color || null, icon || null, end_date || null, is_active === false ? 0 : 1, req.params.id],
        res,
        'Акция обновлена'
    );
});

app.delete('/api/admin/promotions/:id', requireAdmin, (req, res) => {
    runQuery('UPDATE promotions SET is_active = 0 WHERE id = ?', [req.params.id], res, 'Акция скрыта с сайта');
});

app.get('/api/admin/gallery', requireAdmin, (req, res) => {
    db.all('SELECT * FROM gallery ORDER BY sort_order', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ images: rows });
    });
});

app.post('/api/admin/gallery/upload', requireAdmin, express.raw({ type: 'image/*', limit: '10mb' }), (req, res) => {
    if (!req.body || !req.body.length) {
        return res.status(400).json({ message: 'Файл не получен' });
    }

    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.startsWith('image/')) {
        return res.status(400).json({ message: 'Можно загружать только изображения' });
    }

    const originalName = decodeURIComponent(req.headers['x-file-name'] || 'gallery.jpg');
    const fileName = safeAssetFileName(originalName, contentType);
    const targetDir = path.join(__dirname, 'public', 'assets', 'assets');
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, fileName), req.body);

    res.json({
        success: true,
        src: `assets/${fileName}`,
        publicPath: `/assets/assets/${fileName}`
    });
});

app.post('/api/admin/gallery', requireAdmin, (req, res) => {
    const { src, alt, category, sort_order } = req.body;
    if (!src || !alt) return res.status(400).json({ message: 'Укажите путь и описание изображения' });
    runQuery(
        'INSERT INTO gallery (src, alt, category, sort_order) VALUES (?, ?, ?, ?)',
        [src, alt, category || 'clinic', sort_order ? Number(sort_order) : 0],
        res,
        'Изображение добавлено'
    );
});

app.put('/api/admin/gallery/:id', requireAdmin, (req, res) => {
    const { src, alt, category, sort_order } = req.body;
    if (!src || !alt) return res.status(400).json({ message: 'Укажите путь и описание изображения' });
    runQuery(
        'UPDATE gallery SET src = ?, alt = ?, category = ?, sort_order = ? WHERE id = ?',
        [src, alt, category || 'clinic', sort_order ? Number(sort_order) : 0, req.params.id],
        res,
        'Изображение обновлено'
    );
});

app.delete('/api/admin/gallery/:id', requireAdmin, (req, res) => {
    runQuery('DELETE FROM gallery WHERE id = ?', [req.params.id], res, 'Изображение удалено');
});

app.post('/api/chat', async (req, res) => {
    console.log('📩 Получен запрос /api/chat');
    console.log('Сообщение:', req.body?.message);

    const { message } = req.body;

    if (!message) {
        return res.json({ reply: 'Напишите, пожалуйста, ваш вопрос' });
    }

    try {
        const gigaReply = await askGigaChat(message);

        if (gigaReply) {
            console.log('✅ Ответ от GigaChat');
            return res.json({ reply: gigaReply });
        }

        const lower = message.toLowerCase();
        let total = 0;
        let servicesList = [];

        if (lower.includes('герметизац')) {
            total += 2500;
            servicesList.push('Герметизация фиссур (2500 ₽)');
        }
        if (lower.includes('седац') || lower.includes('во сне')) {
            total += 8000;
            servicesList.push('Лечение под седацией (8000 ₽)');
        }
        if (lower.includes('кариес')) {
            total += 3500;
            servicesList.push('Лечение кариеса (3500 ₽)');
        }
        if (lower.includes('чистк')) {
            total += 3000;
            servicesList.push('Профессиональная чистка (3000 ₽)');
        }

        if (servicesList.length > 0) {
            let reply = `🦷 Рассчитываю стоимость:\n\n`;
            reply += servicesList.map(s => `• ${s}`).join('\n');
            reply += `\n\n💰 Итого: ${total.toLocaleString()} ₽\n\n📞 Записаться: +7 (3532) 78-88-88`;
            return res.json({ reply: reply });
        }

        if (lower.includes('привет') || lower.includes('здравствуй')) {
            return res.json({ reply: `👋 Здравствуйте! Я ИИ-ассистент "Доктор Зубов".\n\nЧто могу:\n💰 Посчитать стоимость лечения\n👨‍⚕️ Рассказать о врачах\n🔥 Подсказать акции\n\nНапример: "сколько стоит герметизация фиссур и лечение во сне"` });
        }

        if (lower.includes('акц') || lower.includes('скидк')) {
            return res.json({ reply: `🔥 Акции:\n• Скидка 37% на лечение 3-х зубов\n• Первый визит — подарок 🎁\n\n📞 +7 (3532) 78-88-88` });
        }

        if (lower.includes('врач') || lower.includes('доктор')) {
            return res.json({ reply: `👨‍⚕️ Наши врачи:\n• Иванова Екатерина — детский стоматолог, стаж 12 лет\n• Петров Алексей — ортодонт, стаж 8 лет\n• Смирнова Ольга — хирург, стаж 15 лет\n\n📞 Запись: +7 (3532) 78-88-88` });
        }

        if (lower.includes('адрес')) {
            return res.json({ reply: `📍 г. Оренбург, ул. Сергея Лазо, 14\n📞 +7 (3532) 78-88-88\n⏰ Пн-Пт 8-20, Сб 9-18, Вс 9-16` });
        }

        return res.json({ reply: `😊 Чтобы я мог помочь, уточните:\n\n• "сколько стоит герметизация фиссур"\n• "лечение под седацией цена"\n• "герметизация + седация вместе"\n• "какие акции"\n\nИли звоните: +7 (3532) 78-88-88` });

    } catch (error) {
        console.error('Ошибка:', error);
        res.json({ reply: '😔 Ошибка. Позвоните: +7 (3532) 78-88-88' });
    }
});

// ========== СТРАНИЦЫ ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'public', 'about.html')));
app.get('/services', (req, res) => res.sendFile(path.join(__dirname, 'public', 'services.html')));
app.get('/price', (req, res) => res.sendFile(path.join(__dirname, 'public', 'price.html')));
app.get('/doctors', (req, res) => res.sendFile(path.join(__dirname, 'public', 'doctors.html')));
app.get('/hot_sales', (req, res) => res.sendFile(path.join(__dirname, 'public', 'hot_sales.html')));
app.get('/appointment', (req, res) => res.sendFile(path.join(__dirname, 'public', 'appointment.html')));
app.get('/contacts', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contacts.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'public', 'register.html')));
app.get('/payment', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payment.html')));
app.get('/rules', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rules.html')));
app.get('/reviews', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reviews.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use((req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

app.listen(PORT, HOST, () => {
    console.log(`🚀 Сервер запущен на http://${HOST}:${PORT}`);
});