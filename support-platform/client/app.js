// Support Platform - User Interface
class SupportApp {
    constructor() {
        this.token = null;
        this.userId = null;
        this.currentConversationId = null;
        this.currentUser = null;
        this.socket = null;
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeSocket();
        this.checkAuth();
    }
    
    initializeElements() {
        // Login elements
        this.loginContainer = document.getElementById('loginContainer');
        this.mainApp = document.getElementById('mainApp');
        this.telegramAuthBtn = document.getElementById('telegramAuthBtn');
        this.guestAuthBtn = document.getElementById('guestAuthBtn');
        this.telegramAuthContainer = document.getElementById('telegramAuthContainer');
        this.telegramCode = document.getElementById('telegramCode');
        this.verifyTelegramCode = document.getElementById('verifyTelegramCode');
        
        // Main app elements
        this.userName = document.getElementById('userName');
        this.userType = document.getElementById('userType');
        this.conversationsContainer = document.getElementById('conversationsContainer');
        this.messagesContainer = document.getElementById('messagesContainer');
        this.chatTitle = document.getElementById('chatTitle');
        this.messageInput = document.getElementById('messageInput');
        this.sendMessageBtn = document.getElementById('sendMessageBtn');
        this.newConversationBtn = document.getElementById('newConversationBtn');
    }
    
    setupEventListeners() {
        // Authentication buttons
        this.telegramAuthBtn.addEventListener('click', () => this.handleTelegramAuth());
        this.guestAuthBtn.addEventListener('click', () => this.handleGuestAuth());
        this.verifyTelegramCode.addEventListener('click', () => this.verifyTelegramCodeHandler());
        
        // Chat functionality
        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
        
        this.newConversationBtn.addEventListener('click', () => this.createConversation());
    }
    
    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            if (this.userId) {
                this.socket.emit('joinUserRoom', this.userId);
            }
        });
        
        this.socket.on('newMessage', (data) => {
            if (data.conversationId === this.currentConversationId) {
                this.addMessageToChat(data);
            }
            // Refresh conversations list to update last message
            this.loadConversations();
        });
    }
    
    async checkAuth() {
        // Check if we have a token in localStorage
        const storedToken = localStorage.getItem('token');
        if (storedToken) {
            try {
                const response = await fetch('/api/auth/verify', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ token: storedToken })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    this.token = storedToken;
                    this.userId = result.decoded.userId;
                    this.currentUser = result.user;
                    this.setupAuthenticatedUI();
                    this.loadConversations();
                } else {
                    // Token is invalid, remove it
                    localStorage.removeItem('token');
                }
            } catch (error) {
                console.error('Error verifying token:', error);
                localStorage.removeItem('token');
            }
        }
    }
    
    async handleTelegramAuth() {
        // Show the code input field
        this.telegramAuthContainer.classList.remove('hidden');
        
        // In a real implementation, this would redirect to Telegram or show a QR code
        // For now, we'll just prompt the user to enter the code they received
        alert('Please start a chat with our Telegram bot to receive an authentication code.');
    }
    
    async verifyTelegramCodeHandler() {
        const code = this.telegramCode.value.trim();
        if (!code) {
            alert('Please enter the authentication code');
            return;
        }
        
        try {
            const response = await fetch('/api/auth/telegram', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ token: code })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.token = result.token;
                this.userId = result.user.id;
                this.currentUser = result.user;
                
                // Store token in localStorage
                localStorage.setItem('token', this.token);
                
                this.setupAuthenticatedUI();
                this.loadConversations();
            } else {
                alert('Invalid authentication code. Please try again.');
            }
        } catch (error) {
            console.error('Error verifying Telegram code:', error);
            alert('An error occurred. Please try again.');
        }
    }
    
    async handleGuestAuth() {
        try {
            const response = await fetch('/api/auth/guest', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.token = result.token;
                this.userId = result.user.id;
                this.currentUser = result.user;
                
                // Store token in localStorage
                localStorage.setItem('token', this.token);
                
                this.setupAuthenticatedUI();
                this.loadConversations();
            } else {
                alert('Failed to create guest account. Please try again.');
            }
        } catch (error) {
            console.error('Error creating guest account:', error);
            alert('An error occurred. Please try again.');
        }
    }
    
    setupAuthenticatedUI() {
        this.loginContainer.classList.add('hidden');
        this.mainApp.classList.remove('hidden');
        
        // Update user info
        this.userName.textContent = this.currentUser.name || this.currentUser.username || 'User';
        this.userType.textContent = this.currentUser.auth_type || 'Guest';
        
        // Join socket room
        if (this.socket) {
            this.socket.emit('joinUserRoom', this.userId);
        }
    }
    
    async loadConversations() {
        try {
            const response = await fetch('/api/users/conversations', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.renderConversations(result.conversations);
            }
        } catch (error) {
            console.error('Error loading conversations:', error);
        }
    }
    
    renderConversations(conversations) {
        this.conversationsContainer.innerHTML = '';
        
        if (conversations.length === 0) {
            this.conversationsContainer.innerHTML = '<p class="no-conversations">No conversations yet. Start a new chat!</p>';
            return;
        }
        
        conversations.forEach(conv => {
            const convElement = document.createElement('div');
            convElement.className = 'conversation-item';
            if (conv.id == this.currentConversationId) {
                convElement.classList.add('active');
            }
            
            convElement.innerHTML = `
                <h3>${conv.title}</h3>
                <div class="last-message">${conv.last_message ? this.truncateText(conv.last_message, 50) : 'No messages yet'}</div>
            `;
            
            convElement.addEventListener('click', () => {
                this.selectConversation(conv.id, conv.title);
            });
            
            this.conversationsContainer.appendChild(convElement);
        });
    }
    
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substr(0, maxLength) + '...';
    }
    
    async selectConversation(conversationId, title) {
        this.currentConversationId = conversationId;
        this.chatTitle.textContent = title;
        
        // Update active class
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
        });
        event.target.closest('.conversation-item').classList.add('active');
        
        await this.loadMessages(conversationId);
    }
    
    async loadMessages(conversationId) {
        try {
            const response = await fetch(`/api/users/conversations/${conversationId}/messages`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.renderMessages(result.messages);
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        }
    }
    
    renderMessages(messages) {
        this.messagesContainer.innerHTML = '';
        
        messages.forEach(message => {
            this.addMessageToChat({
                id: message.id,
                sender_type: message.sender_type,
                message: message.message,
                timestamp: message.timestamp,
                sender_name: message.sender_name
            });
        });
        
        // Scroll to bottom
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    addMessageToChat(message) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.sender_type === 'user' ? 'user-message' : 'admin-message'}`;
        
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        messageElement.innerHTML = `
            ${message.message}
            <span class="message-time">${timestamp}</span>
        `;
        
        this.messagesContainer.appendChild(messageElement);
        
        // Scroll to bottom
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }
    
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || !this.currentConversationId) {
            return;
        }
        
        try {
            const response = await fetch('/api/users/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    conversationId: this.currentConversationId,
                    message: message
                })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Clear input
                this.messageInput.value = '';
                
                // The message will be added via socket event
            } else {
                alert('Failed to send message. Please try again.');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            alert('An error occurred. Please try again.');
        }
    }
    
    async createConversation() {
        const title = prompt('Enter a title for your new conversation:');
        if (!title) return;
        
        try {
            const response = await fetch('/api/users/conversations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ title })
            });
            
            const result = await response.json();
            
            if (result.success) {
                // Select the new conversation
                this.selectConversation(result.conversation.id, result.conversation.title);
            } else {
                alert('Failed to create conversation. Please try again.');
            }
        } catch (error) {
            console.error('Error creating conversation:', error);
            alert('An error occurred. Please try again.');
        }
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new SupportApp();
});// Register service worker for PWA functionality
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js")
            .then(registration => {
                console.log("SW registered: ", registration);
            })
            .catch(registrationError => {
                console.log("SW registration failed: ", registrationError);
            });
    });
}
