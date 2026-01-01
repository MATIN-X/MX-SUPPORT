const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Load configuration
const configPath = path.join(__dirname, '../config.json');
let config = {};

if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} else {
    // Default configuration for development
    config = {
        database: {
            host: 'localhost',
            name: 'support_platform',
            user: 'support_user',
            password: 'default_password'
        }
    };
}

// Create database connection pool
const pool = mysql.createPool({
    host: config.database?.host || 'localhost',
    user: config.database?.user || 'support_user',
    password: config.database?.password || 'default_password',
    database: config.database?.name || 'support_platform',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test database connection
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('Database connected successfully');
        connection.release();
        return true;
    } catch (error) {
        console.error('Database connection failed:', error.message);
        return false;
    }
}

// Initialize database tables if they don't exist
async function initializeDatabase() {
    const connection = await pool.getConnection();
    
    try {
        // Create users table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                telegram_id VARCHAR(50) UNIQUE,
                username VARCHAR(100),
                email VARCHAR(100),
                name VARCHAR(100),
                auth_type ENUM('telegram', 'guest') NOT NULL DEFAULT 'guest',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        
        // Create conversations table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        // Create messages table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                conversation_id INT NOT NULL,
                sender_type ENUM('user', 'admin') NOT NULL,
                sender_id INT,
                message TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        `);
        
        // Create admin_users table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                email VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        
        // Create telegram_config table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS telegram_config (
                id INT AUTO_INCREMENT PRIMARY KEY,
                bot_token VARCHAR(255) NOT NULL,
                webhook_url VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        
        // Create sessions table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                session_token VARCHAR(255) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        
        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error.message);
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = {
    pool,
    testConnection,
    initializeDatabase
};
