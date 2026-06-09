// ИИ-ассистент Доктор Зубов
(function () {
    function addMessage(text, isUser) {
        const container = document.getElementById('chatMessages');
        if (!container) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user' : 'bot'}`;
        messageDiv.innerHTML = `
            <div class="message-avatar">${isUser ? '👤' : '🦷'}</div>
            <div class="message-bubble">
                <div class="message-text">${text.replace(/\n/g, '<br>')}</div>
                <div class="message-time">${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>
            </div>
        `;
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;
    }

    async function sendMessage() {
        const input = document.getElementById('chatInput');
        const message = input.value.trim();
        if (!message) return;

        addMessage(message, true);
        input.value = '';

        const container = document.getElementById('chatMessages');
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message bot';
        typingDiv.id = 'typingIndicator';
        typingDiv.innerHTML = `
            <div class="message-avatar">🦷</div>
            <div class="message-bubble">
                <div class="message-text">
                    <div class="chat-typing">печатает<span>.</span><span>.</span><span>.</span></div>
                </div>
            </div>
        `;
        container.appendChild(typingDiv);
        container.scrollTop = container.scrollHeight;

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({message: message})
            });

            const data = await response.json();
            const reply = data.reply || '😔 Ошибка. Позвоните: +7 (3532) 78-88-88';

            document.getElementById('typingIndicator')?.remove();
            addMessage(reply, false);
        } catch (error) {
            document.getElementById('typingIndicator')?.remove();
            addMessage('😔 Ошибка соединения. Позвоните: +7 (3532) 78-88-88', false);
        }
    }

    function createWidget() {
        const styles = `
            <style>
                .chat-widget-container {
                    position: fixed;
                    bottom: 24px;
                    right: 24px;
                    z-index: 10000;
                    font-family: 'Montserrat', sans-serif;
                }
                .chat-toggle-btn {
                    width: 56px;
                    height: 56px;
                    background: #3270ce;
                    border: none;
                    border-radius: 50%;
                    cursor: pointer;
                    display: flex !important;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    transition: all 0.3s;
                }
                .chat-toggle-btn i {
                    font-size: 26px;
                    color: white;
                }
                .chat-toggle-btn:hover {
                    transform: scale(1.05);
                    background: #2659b0;
                }
                .chat-window {
                    position: fixed;
                    bottom: 90px;
                    right: 24px;
                    width: 380px;
                    height: 550px;
                    background: white;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    display: none;
                    flex-direction: column;
                    overflow: hidden;
                    border: 1px solid #e9ecef;
                }
                .chat-header {
                    background: #3270ce;
                    padding: 16px 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    color: white;
                }
                .chat-header-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-weight: 600;
                    font-size: 15px;
                }
                .chat-header-info i {
                    font-size: 18px;
                }
                .chat-close {
                    background: none;
                    border: none;
                    color: white;
                    font-size: 20px;
                    cursor: pointer;
                    opacity: 0.8;
                }
                .chat-close:hover {
                    opacity: 1;
                }
                .chat-messages {
                    flex: 1;
                    overflow-y: auto;
                    padding: 16px;
                    background: #f8f9fa;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .message {
                    display: flex;
                    gap: 10px;
                    align-items: flex-start;
                }
                .message.user {
                    flex-direction: row-reverse;
                }
                .message-avatar {
                    width: 32px;
                    height: 32px;
                    background: #e9ecef;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 16px;
                    flex-shrink: 0;
                }
                .message.user .message-avatar {
                    background: #3270ce;
                    color: white;
                }
                .message-bubble {
                    max-width: 75%;
                }
                .message-text {
                    background: white;
                    padding: 10px 14px;
                    border-radius: 18px;
                    font-size: 13px;
                    line-height: 1.5;
                    color: #333;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.05);
                }
                .message.user .message-text {
                    background: #3270ce;
                    color: white;
                }
                .message-time {
                    font-size: 10px;
                    color: #999;
                    margin-top: 4px;
                    margin-left: 4px;
                }
                .chat-typing {
                    display: inline-flex;
                    gap: 2px;
                }
                .chat-typing span {
                    animation: typing 1.4s infinite;
                }
                .chat-typing span:nth-child(2) { animation-delay: 0.2s; }
                .chat-typing span:nth-child(3) { animation-delay: 0.4s; }
                @keyframes typing {
                    0%, 60%, 100% { opacity: 0.4; }
                    30% { opacity: 1; }
                }
                .chat-input-area {
                    padding: 12px 16px;
                    background: white;
                    border-top: 1px solid #e9ecef;
                    display: flex;
                    gap: 10px;
                }
                .chat-input {
                    flex: 1;
                    padding: 10px 14px;
                    border: 1px solid #dee2e6;
                    border-radius: 24px;
                    font-size: 13px;
                    font-family: 'Montserrat', sans-serif;
                    outline: none;
                }
                .chat-input:focus {
                    border-color: #3270ce;
                }
                .chat-send {
                    width: 38px;
                    height: 38px;
                    background: #3270ce;
                    border: none;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                }
                .chat-send i {
                    color: white;
                    font-size: 14px;
                }
                @media (max-width: 480px) {
                    .chat-window {
                        width: calc(100vw - 48px);
                        height: 500px;
                    }
                }
            </style>
        `;
        document.head.insertAdjacentHTML('beforeend', styles);

        if (!document.querySelector('link[href*="font-awesome"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
            document.head.appendChild(link);
        }

        const html = `
            <div class="chat-widget-container">
                <button class="chat-toggle-btn" id="chatToggleBtn">
                    <i class="fas fa-robot"></i>
                </button>
                <div class="chat-window" id="chatWindow">
                    <div class="chat-header">
                        <div class="chat-header-info">
                            <i class="fas fa-tooth"></i>
                            <span>Доктор Зубов AI</span>
                        </div>
                        <button class="chat-close" id="chatCloseBtn">✕</button>
                    </div>
                    <div class="chat-messages" id="chatMessages">
                        <div class="message bot">
                            <div class="message-avatar">🦷</div>
                            <div class="message-bubble">
                                <div class="message-text">👋 Здравствуйте! Я ИИ-ассистент "Доктор Зубов".<br><br>Могу посчитать стоимость лечения, рассказать о врачах, подсказать акции.<br><br>Например:<br>• "сколько стоит герметизация фиссур и лечение во сне"<br>• "какие сейчас акции"</div>
                                <div class="message-time">${new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        })}</div>
                            </div>
                        </div>
                    </div>
                    <div class="chat-input-area">
                        <input type="text" class="chat-input" id="chatInput" placeholder="Напишите сообщение..." autocomplete="off">
                        <button class="chat-send" id="chatSendBtn">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
    }

    function init() {
        createWidget();

        const toggleBtn = document.getElementById('chatToggleBtn');
        const closeBtn = document.getElementById('chatCloseBtn');
        const chatWindow = document.getElementById('chatWindow');
        const sendBtn = document.getElementById('chatSendBtn');
        const input = document.getElementById('chatInput');

        // ✅ Чат закрыт по умолчанию
        if (chatWindow) {
            chatWindow.style.display = 'none';
        }
        if (toggleBtn) {
            toggleBtn.style.display = 'flex';
        }

        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                chatWindow.style.display = 'flex';
                toggleBtn.style.display = 'none';
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                chatWindow.style.display = 'none';
                toggleBtn.style.display = 'flex';
            });
        }

        if (sendBtn) {
            sendBtn.addEventListener('click', sendMessage);
        }

        if (input) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') sendMessage();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();