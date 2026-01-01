const TelegramBot = require('node-telegram-bot-api');
const { pool } = require('../api/database');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, '../config.json');
let config = {};

if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

class TelegramBotService {
    constructor() {
        this.bot = null;
        this.botToken = config.telegram?.bot_token || null;
        this.domain = config.domain || 'localhost';
        this.sslPort = config.ssl_port || 443;
        
        if (this.botToken) {
            this.bot = new TelegramBot(this.botToken, { polling: false });
            this.setupBot();
            this.setupWebhook();
        }
    }
    
    async setupBot() {
        if (!this.bot) return;
        
        // Handle /start command
        this.bot.onText(/\/start/, async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const userName = msg.from.first_name;
            
            try {
                // Check if user exists in database
                const [existingUser] = await pool.execute(
                    'SELECT * FROM users WHERE telegram_id = ?',
                    [userId.toString()]
                );
                
                if (existingUser.length === 0) {
                    // Create new user
                    await pool.execute(
                        'INSERT INTO users (telegram_id, name, auth_type) VALUES (?, ?, ?)',
                        [userId.toString(), userName, 'telegram']
                    );
                } else {
                    // Update user name if changed
                    await pool.execute(
                        'UPDATE users SET name = ? WHERE telegram_id = ?',
                        [userName, userId.toString()]
                    );
                }
                
                // Generate authentication token for the web platform
                const authToken = this.generateAuthToken();
                
                // Store the auth token in the database
                await pool.execute(
                    'INSERT INTO sessions (user_id, session_token, expires_at) VALUES ((SELECT id FROM users WHERE telegram_id = ?), ?, DATE_ADD(NOW(), INTERVAL 7 DAY))',
                    [userId.toString(), authToken]
                );
                
                // Send the auth token to the user
                const authUrl = this.getAuthUrl(authToken);
                
                await this.bot.sendMessage(
                    chatId,
                    `Welcome to the support platform, ${userName}!\n\nClick the link below to authenticate in the web platform:\n${authUrl}\n\nOr copy and paste this code: ${authToken}`
                );
            } catch (error) {
                console.error('Error handling /start command:', error);
                await this.bot.sendMessage(chatId, 'An error occurred. Please try again later.');
            }
        });
        
        // Handle all other messages
        this.bot.on('message', async (msg) => {
            const chatId = msg.chat.id;
            const userId = msg.from.id;
            const messageText = msg.text;
            
            // Only process messages that are not commands
            if (!messageText.startsWith('/')) {
                try {
                    // Check if user is registered
                    const [user] = await pool.execute(
                        'SELECT * FROM users WHERE telegram_id = ?',
                        [userId.toString()]
                    );
                    
                    if (user.length === 0) {
                        await this.bot.sendMessage(
                            chatId,
                            'Please use /start command first to register with our support platform.'
                        );
                        return;
                    }
                    
                    // Forward message to web platform or store for admin to see
                    await this.forwardMessageToWebPlatform(userId, messageText);
                    
                    await this.bot.sendMessage(
                        chatId,
                        'Your message has been received by our support team. We will respond shortly.'
                    );
                } catch (error) {
                    console.error('Error handling message:', error);
                    await this.bot.sendMessage(chatId, 'An error occurred. Please try again later.');
                }
            }
        });
    }
    
    async setupWebhook() {
        if (!this.bot) return;
        
        const webhookUrl = `https://${this.domain}:${this.sslPort}/api/telegram-webhook`;
        
        try {
            await this.bot.setWebhook(webhookUrl);
            console.log('Telegram webhook set successfully:', webhookUrl);
            
            // Store webhook URL in database
            await pool.execute(
                'INSERT INTO telegram_config (bot_token, webhook_url) VALUES (?, ?) ON DUPLICATE KEY UPDATE webhook_url = ?',
                [this.botToken, webhookUrl, webhookUrl]
            );
        } catch (error) {
            console.error('Error setting Telegram webhook:', error);
        }
    }
    
    generateAuthToken() {
        // Generate a random authentication token
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
    
    getAuthUrl(authToken) {
        return `https://${this.domain}:${this.sslPort}/User/auth?token=${authToken}`;
    }
    
    async forwardMessageToWebPlatform(userId, messageText) {
        // This would forward the message to the web platform
        // In a real implementation, this might involve:
        // 1. Creating a conversation if it doesn't exist
        // 2. Storing the message in the database
        // 3. Notifying the web platform via WebSocket or similar
        
        try {
            // Get user from database
            const [user] = await pool.execute(
                'SELECT id FROM users WHERE telegram_id = ?',
                [userId.toString()]
            );
            
            if (user.length === 0) {
                throw new Error('User not found');
            }
            
            const userIdDB = user[0].id;
            
            // Check if user has an active conversation
            let [conversation] = await pool.execute(
                'SELECT id, title FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
                [userIdDB]
            );
            
            let conversationId;
            if (conversation.length === 0) {
                // Create new conversation
                const [result] = await pool.execute(
                    'INSERT INTO conversations (user_id, title) VALUES (?, ?)',
                    [userIdDB, 'New Support Request']
                );
                conversationId = result.insertId;
            } else {
                conversationId = conversation[0].id;
            }
            
            // Insert the message
            await pool.execute(
                'INSERT INTO messages (conversation_id, sender_type, sender_id, message) VALUES (?, ?, ?, ?)',
                [conversationId, 'user', userIdDB, messageText]
            );
            
            // Update conversation timestamp
            await pool.execute(
                'UPDATE conversations SET updated_at = NOW() WHERE id = ?',
                [conversationId]
            );
            
            console.log(`Message from Telegram user ${userId} stored in conversation ${conversationId}`);
        } catch (error) {
            console.error('Error forwarding message to web platform:', error);
            throw error;
        }
    }
    
    async handleWebhook(req, res) {
        if (!this.bot) {
            res.status(500).send('Bot not initialized');
            return;
        }
        
        try {
            await this.bot.processUpdate(req.body);
            res.status(200).send('OK');
        } catch (error) {
            console.error('Error processing Telegram webhook:', error);
            res.status(500).send('Error');
        }
    }
    
    async sendMessageToUser(telegramId, message) {
        if (!this.bot) return false;
        
        try {
            await this.bot.sendMessage(telegramId, message);
            return true;
        } catch (error) {
            console.error('Error sending message to Telegram user:', error);
            return false;
        }
    }
}

module.exports = TelegramBotService;
