const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cors = require('cors');
const { initializeDatabase, pool } = require('./database');
const AuthService = require('./auth');
const TelegramBotService = require('../bot/telegram-bot');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize Telegram bot if token is available
let telegramBotService = null;
try {
    telegramBotService = new TelegramBotService();
} catch (error) {
    console.warn('Telegram bot not initialized:', error.message);
}

// Initialize database
initializeDatabase().catch(console.error);

// API Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Telegram webhook endpoint
app.post('/api/telegram-webhook', async (req, res) => {
    if (telegramBotService) {
        await telegramBotService.handleWebhook(req, res);
    } else {
        res.status(500).send('Telegram bot not initialized');
    }
});

// Authentication routes
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        
        const result = await AuthService.authenticateAdmin(username, password);
        
        if (!result) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        res.json({ 
            success: true, 
            user: { id: result.id, username: result.username, email: result.email },
            token: result.token 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Telegram token authentication
app.post('/api/auth/telegram', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }
        
        const result = await AuthService.authenticateWithTelegramToken(token);
        
        if (!result) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        
        res.json({ 
            success: true, 
            user: result.user,
            token: result.token 
        });
    } catch (error) {
        console.error('Telegram auth error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Guest user creation
app.post('/api/auth/guest', async (req, res) => {
    try {
        const result = await AuthService.createGuestUser();
        
        res.json({ 
            success: true, 
            user: result.user,
            token: result.token 
        });
    } catch (error) {
        console.error('Guest creation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Verify token
app.post('/api/auth/verify', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }
        
        const decoded = await AuthService.verifyToken(token);
        
        if (!decoded) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        
        let user = null;
        if (decoded.role !== 'admin') {
            user = await AuthService.getUserById(decoded.userId);
        }
        
        res.json({ 
            success: true,
            user: user,
            decoded: decoded
        });
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// User routes (require authentication)
app.use('/api/users', async (req, res, next) => {
    // Check for JWT token in header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    const decoded = await AuthService.verifyToken(token);
    if (!decoded) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
    
    req.userId = decoded.userId;
    req.userRole = decoded.role || 'user';
    next();
});

// Get user conversations
app.get('/api/users/conversations', async (req, res) => {
    try {
        const [conversations] = await pool.execute(
            'SELECT c.id, c.title, c.created_at, c.updated_at, ' +
            '(SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count, ' +
            '(SELECT m.message FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC LIMIT 1) as last_message ' +
            'FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC',
            [req.userId]
        );
        
        res.json({ success: true, conversations });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get conversation messages
app.get('/api/users/conversations/:id/messages', async (req, res) => {
    try {
        const conversationId = req.params.id;
        
        // Verify that the conversation belongs to the user
        const [convCheck] = await pool.execute(
            'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, req.userId]
        );
        
        if (convCheck.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        const [messages] = await pool.execute(
            'SELECT m.id, m.sender_type, m.message, m.timestamp, ' +
            'u.name as sender_name ' +
            'FROM messages m ' +
            'LEFT JOIN users u ON (m.sender_type = "user" AND u.id = m.sender_id) ' +
            'WHERE m.conversation_id = ? ORDER BY m.timestamp ASC',
            [conversationId]
        );
        
        res.json({ success: true, messages });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send message
app.post('/api/users/messages', async (req, res) => {
    try {
        const { conversationId, message } = req.body;
        
        if (!conversationId || !message) {
            return res.status(400).json({ error: 'Conversation ID and message are required' });
        }
        
        // Verify that the conversation belongs to the user
        const [convCheck] = await pool.execute(
            'SELECT id FROM conversations WHERE id = ? AND user_id = ?',
            [conversationId, req.userId]
        );
        
        if (convCheck.length === 0) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        // Insert the message
        const [result] = await pool.execute(
            'INSERT INTO messages (conversation_id, sender_type, sender_id, message) VALUES (?, ?, ?, ?)',
            [conversationId, 'user', req.userId, message]
        );
        
        // Update conversation timestamp
        await pool.execute(
            'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
            [conversationId]
        );
        
        // Emit the new message to admin via Socket.IO
        io.to('admin').emit('newMessage', {
            id: result.insertId,
            conversationId,
            sender_type: 'user',
            sender_id: req.userId,
            message,
            timestamp: new Date()
        });
        
        res.json({ success: true, messageId: result.insertId });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new conversation
app.post('/api/users/conversations', async (req, res) => {
    try {
        const { title } = req.body;
        const conversationTitle = title || 'New Support Request';
        
        const [result] = await pool.execute(
            'INSERT INTO conversations (user_id, title) VALUES (?, ?)',
            [req.userId, conversationTitle]
        );
        
        res.json({ 
            success: true, 
            conversation: { 
                id: result.insertId, 
                title: conversationTitle,
                created_at: new Date() 
            } 
        });
    } catch (error) {
        console.error('Create conversation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin routes (require admin authentication)
app.use('/api/admin', async (req, res, next) => {
    // Check for JWT token in header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    const decoded = await AuthService.verifyToken(token);
    if (!decoded || decoded.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.userId = decoded.userId;
    req.username = decoded.username;
    req.userRole = 'admin';
    next();
});

// Get all users
app.get('/api/admin/users', async (req, res) => {
    try {
        const [users] = await pool.execute(
            'SELECT id, telegram_id, username, email, name, auth_type, created_at FROM users ORDER BY created_at DESC'
        );
        
        res.json({ success: true, users });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all conversations (for admin)
app.get('/api/admin/conversations', async (req, res) => {
    try {
        const [conversations] = await pool.execute(
            'SELECT c.id, c.title, c.created_at, c.updated_at, ' +
            'u.name as user_name, u.username as user_username, u.auth_type, ' +
            '(SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count, ' +
            '(SELECT m.message FROM messages m WHERE m.conversation_id = c.id ORDER BY m.timestamp DESC LIMIT 1) as last_message ' +
            'FROM conversations c ' +
            'JOIN users u ON c.user_id = u.id ' +
            'ORDER BY c.updated_at DESC'
        );
        
        res.json({ success: true, conversations });
    } catch (error) {
        console.error('Get admin conversations error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get conversation messages (for admin)
app.get('/api/admin/conversations/:id/messages', async (req, res) => {
    try {
        const conversationId = req.params.id;
        
        const [messages] = await pool.execute(
            'SELECT m.id, m.sender_type, m.sender_id, m.message, m.timestamp, ' +
            'COALESCE(u.name, "Admin") as sender_name ' +
            'FROM messages m ' +
            'LEFT JOIN users u ON (m.sender_type = "user" AND u.id = m.sender_id) ' +
            'WHERE m.conversation_id = ? ORDER BY m.timestamp ASC',
            [conversationId]
        );
        
        res.json({ success: true, messages });
    } catch (error) {
        console.error('Get admin messages error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin send message
app.post('/api/admin/messages', async (req, res) => {
    try {
        const { conversationId, message } = req.body;
        
        if (!conversationId || !message) {
            return res.status(400).json({ error: 'Conversation ID and message are required' });
        }
        
        // Check if conversation exists
        const [convCheck] = await pool.execute(
            'SELECT user_id FROM conversations WHERE id = ?',
            [conversationId]
        );
        
        if (convCheck.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        
        // Insert the message
        const [result] = await pool.execute(
            'INSERT INTO messages (conversation_id, sender_type, sender_id, message) VALUES (?, ?, ?, ?)',
            [conversationId, 'admin', req.userId, message]
        );
        
        // Update conversation timestamp
        await pool.execute(
            'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
            [conversationId]
        );
        
        // Get user info to potentially send to Telegram
        const userId = convCheck[0].user_id;
        const [userInfo] = await pool.execute(
            'SELECT telegram_id FROM users WHERE id = ?',
            [userId]
        );
        
        // Emit the new message to user via Socket.IO
        io.to('user_' + userId).emit('newMessage', {
            id: result.insertId,
            conversationId,
            sender_type: 'admin',
            sender_id: req.userId,
            message,
            timestamp: new Date()
        });
        
        // If user has a Telegram ID, send message via Telegram bot
        if (userInfo.length > 0 && userInfo[0].telegram_id && telegramBotService) {
            const sent = await telegramBotService.sendMessageToUser(
                userInfo[0].telegram_id,
                message
            );
            
            if (sent) {
                console.log('Message sent to Telegram user:', userInfo[0].telegram_id);
            }
        }
        
        res.json({ success: true, messageId: result.insertId });
    } catch (error) {
        console.error('Admin send message error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// For production, serve the client files
app.use(express.static(path.join(__dirname, '../client')));

// For any other route, serve the React app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
    // User joins their own room
    socket.on('joinUserRoom', (userId) => {
        socket.join('user_' + userId);
        console.log('User joined room:', 'user_' + userId);
    });
    
    // Admin joins admin room
    socket.on('joinAdminRoom', () => {
        socket.join('admin');
        console.log('Admin joined admin room');
    });
    
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = server;