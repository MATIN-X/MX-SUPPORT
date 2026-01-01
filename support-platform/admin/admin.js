// Support Platform - Admin Panel
class AdminApp {
    constructor() {
        this.token = null;
        this.userId = null;
        this.currentConversationId = null;
        this.currentUser = null;
        this.socket = null;
        this.currentView = 'conversations'; // conversations, users, settings
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeSocket();
        this.checkAuth();
    }
    
    initializeElements() {
        // Login elements
        this.loginContainer = document.getElementById('loginContainer');
        this.mainApp = document.getElementById('mainApp');
        this.adminUsername = document.getElementById('adminUsername');
        this.adminPassword = document.getElementById('adminPassword');
        this.adminLoginBtn = document.getElementById('adminLoginBtn');
        
        // Main app elements
        this.adminName = document.getElementById('adminName');
        this.conversationsContainer = document.getElementById('conversationsContainer');
        this.messagesContainer = document.getElementById('messagesContainer');
        this.chatTitle = document.getElementById('chatTitle');
        this.messageInput = document.getElementById('messageInput');
        this.sendMessageBtn = document.getElementById('sendMessageBtn');
        this.userBadge = document.getElementById('userBadge');
        
        // Tab elements
        this.conversationsTab = document.getElementById('conversationsTab');
        this.usersTab = document.getElementById('usersTab');
        this.settingsTab = document.getElementById('settingsTab');
        
        // Users view
        this.usersContainer = document.getElementById('usersContainer');
        this.usersList = document.getElementById('usersList');
    }
    
    setupEventListeners() {
        // Login functionality
        this.adminLoginBtn.addEventListener('click', () => this.handleAdminLogin());
        this.adminPassword.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleAdminLogin();
            }
        });
        
        // Tab navigation
        this.conversationsTab.addEventListener('click', () => this.switchView('conversations'));
        this.usersTab.addEventListener('click', () => this.switchView('users'));
        this.settingsTab.addEventListener('click', () => this.switchView('settings'));
        
        // Chat functionality
        this.sendMessageBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }
    
    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('Connected to server');
            if (this.token) {
                this.socket.emit('joinAdminRoom');
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
        const storedToken = localStorage.getItem('admin_token');
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
                
                if (result.success && result.decoded.role === 'admin') {
                    this.token = storedToken;
                    this.userId = result.decoded.userId;
                    this.currentUser = result.decoded;
                    this.setupAuthenticatedUI();
                    this.switchView('conversations');
                } else {
                    // Token is invalid, remove it
                    localStorage.removeItem('admin_token');
                }
            } catch (error) {
                console.error('Error verifying token:', error);
                localStorage.removeItem('admin_token');
            }
        }
    }
    
    async handleAdminLogin() {
        const username = this.adminUsername.value.trim();
        const password = this.adminPassword.value.trim();
        
        if (!username || !password) {
            alert('Please enter both username and password');
            return;
        }
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.token = result.token;
                this.userId = result.user.id;
                this.currentUser = result.user;
                
                // Store token in localStorage
                localStorage.setItem('admin_token', this.token);
                
                this.setupAuthenticatedUI();
                this.switchView('conversations');
            } else {
                alert('Invalid credentials. Please try again.');
            }
        } catch (error) {
            console.error('Error logging in:', error);
            alert('An error occurred. Please try again.');
        }
    }
    
    setupAuthenticatedUI() {
        this.loginContainer.classList.add('hidden');
        this.mainApp.classList.remove('hidden');
        
        // Update admin info
        this.adminName.textContent = this.currentUser.username || 'Admin';
        
        // Join socket admin room
        if (this.socket) {
            this.socket.emit('joinAdminRoom');
        }
    }
    
    switchView(view) {
        this.currentView = view;
        
        // Update active tab
        this.conversationsTab.classList.remove('active');
        this.usersTab.classList.remove('active');
        this.settingsTab.classList.remove('active');
        
        // Hide all containers
        this.conversationsContainer.parentElement.style.display = 'block';
        this.usersContainer.classList.add('hidden');
        
        if (view === 'conversations') {
            this.conversationsTab.classList.add('active');
            this.loadConversations();
        } else if (view === 'users') {
            this.usersTab.classList.add('active');
            this.conversationsContainer.parentElement.style.display = 'none';
            this.usersContainer.classList.remove('hidden');
            this.loadUsers();
        } else if (view === 'settings') {
            this.settingsTab.classList.add('active');
            alert('Settings functionality coming soon!');
        }
    }
    
    async loadConversations() {
        try {
            const response = await fetch('/api/admin/conversations', {
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
            this.conversationsContainer.innerHTML = '<p class="no-conversations">No conversations yet.</p>';
            return;
        }
        
        conversations.forEach(conv => {
            const convElement = document.createElement('div');
            convElement.className = 'conversation-item';
            if (conv.id == this.currentConversationId) {
                convElement.classList.add('active');
            }
            
            // Determine user badge based on auth_type
            let badge = '';
            if (conv.auth_type === 'telegram') {
                badge = '<span class="badge telegram">🤖</span>';
            } else {
                badge = '<span class="badge guest">👤</span>';
            }
            
            convElement.innerHTML = `
                <div class="conv-user-info">
                    <h3>${conv.user_name || conv.user_username || 'Unknown User'}</h3>
                    ${badge}
                </div>
                <div class="conv-title">${conv.title}</div>
                <div class="last-message">${conv.last_message ? this.truncateText(conv.last_message, 50) : 'No messages yet'}</div>
            `;
            
            convElement.addEventListener('click', () => {
                this.selectConversation(conv.id, conv.title, conv.user_name || conv.user_username, conv.auth_type);
            });
            
            this.conversationsContainer.appendChild(convElement);
        });
    }
    
    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substr(0, maxLength) + '...';
    }
    
    async selectConversation(conversationId, title, userName, authType) {
        this.currentConversationId = conversationId;
        this.chatTitle.textContent = title;
        
        // Show user badge with auth type
        let badgeText = '';
        if (authType === 'telegram') {
            badgeText = '🤖 Telegram User';
        } else {
            badgeText = '👤 Guest User';
        }
        this.userBadge.innerHTML = `<span class="badge ${authType}">${badgeText}</span>`;
        
        // Update active class
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
        });
        event.target.closest('.conversation-item').classList.add('active');
        
        await this.loadMessages(conversationId);
    }
    
    async loadMessages(conversationId) {
        try {
            const response = await fetch(`/api/admin/conversations/${conversationId}/messages`, {
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
            const response = await fetch('/api/admin/messages', {
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
    
    async loadUsers() {
        try {
            const response = await fetch('/api/admin/users', {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            const result = await response.json();
            
            if (result.success) {
                this.renderUsers(result.users);
            }
        } catch (error) {
            console.error('Error loading users:', error);
        }
    }
    
    renderUsers(users) {
        this.usersList.innerHTML = '';
        
        if (users.length === 0) {
            this.usersList.innerHTML = '<p class="no-users">No users found.</p>';
            return;
        }
        
        users.forEach(user => {
            const userElement = document.createElement('div');
            userElement.className = 'user-item';
            
            // Determine badge based on auth_type
            let badge = '';
            if (user.auth_type === 'telegram') {
                badge = '<span class="badge telegram">🤖</span>';
            } else {
                badge = '<span class="badge guest">👤</span>';
            }
            
            userElement.innerHTML = `
                <div class="user-info">
                    <div class="user-name">${user.name || user.username || 'Unknown User'}</div>
                    <div class="user-email">${user.email || 'No email'}</div>
                    <div class="user-id">ID: ${user.id}</div>
                </div>
                <div class="user-auth-type">
                    ${badge}
                    <span class="auth-type-text">${user.auth_type === 'telegram' ? 'Telegram' : 'Guest'}</span>
                </div>
            `;
            
            this.usersList.appendChild(userElement);
        });
    }
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new AdminApp();
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
