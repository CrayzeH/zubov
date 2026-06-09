const express = require('express');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ТЕСТОВЫЙ ЭНДПОИНТ
app.post('/api/chat', (req, res) => {
    console.log('✅ /api/chat вызван!');
    console.log('Сообщение:', req.body.message);
    
    res.json({ 
        reply: `🦷 Получил ваш вопрос: "${req.body.message}". Это тестовый ответ!` 
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Сервер на http://localhost:${PORT}`);
    console.log(`📡 Эндпоинт /api/chat доступен`);
});