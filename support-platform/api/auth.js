const bcrypt = require('bcryptjs');
const { pool } = require('./database');
const jwt = require('jsonwebtoken');

// Secret for JWT tokens
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_here';

class AuthService {
    // Create a new user (for guest users)
    static async createUser(userData) {
        try {
            const { telegram_id, username, email, name, auth_type = 'guest' } = userData;
            
            const [result] = await pool.execute(
                'INSERT INTO users (telegram_id, username, email, name, auth_type) VALUES (?, ?, ?, ?, ?)',
                [telegram_id, username, email, name, auth_type]
            );
            
            return { id: result.insertId, ...userData };
        } catch (error) {
            console.error('Error creating user:', error);
            throw error;
        }
    }
    
    // Get user by ID
    static async getUserById(userId) {
        try {
            const [rows] = await pool.execute(
                'SELECT id, telegram_id, username, email, name, auth_type, created_at FROM users WHERE id = ?',
                [userId]
            );
            
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Error getting user by ID:', error);
            throw error;
        }
    }
    
    // Get user by Telegram ID
    static async getUserByTelegramId(telegramId) {
        try {
            const [rows] = await pool.execute(
                'SELECT id, telegram_id, username, email, name, auth_type, created_at FROM users WHERE telegram_id = ?',
                [telegramId]
            );
            
            return rows.length > 0 ? rows[0] : null;
        } catch (error) {
            console.error('Error getting user by Telegram ID:', error);
            throw error;
        }
    }
    
    // Authenticate user with Telegram token
    static async authenticateWithTelegramToken(token) {
        try {
            // Check if the token exists in sessions table and is not expired
            const [rows] = await pool.execute(
                'SELECT user_id FROM sessions WHERE session_token = ? AND expires_at > NOW()',
                [token]
            );
            
            if (rows.length === 0) {
                return null; // Invalid or expired token
            }
            
            const user = await this.getUserById(rows[0].user_id);
            if (!user) {
                return null; // User not found
            }
            
            // Create a JWT token for the session
            const jwtToken = jwt.sign(
                { userId: user.id, auth_type: user.auth_type },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            // Optionally delete the one-time use token
            await pool.execute(
                'DELETE FROM sessions WHERE session_token = ?',
                [token]
            );
            
            return { user, token: jwtToken };
        } catch (error) {
            console.error('Error authenticating with Telegram token:', error);
            throw error;
        }
    }
    
    // Create a guest user
    static async createGuestUser() {
        try {
            // Generate a temporary username
            const tempUsername = 'guest_' + Date.now();
            
            const [result] = await pool.execute(
                'INSERT INTO users (username, auth_type) VALUES (?, ?)',
                [tempUsername, 'guest']
            );
            
            const user = await this.getUserById(result.insertId);
            
            // Create a JWT token for the guest session
            const token = jwt.sign(
                { userId: user.id, auth_type: user.auth_type },
                JWT_SECRET,
                { expiresIn: '1d' } // Guest sessions expire after 1 day
            );
            
            return { user, token };
        } catch (error) {
            console.error('Error creating guest user:', error);
            throw error;
        }
    }
    
    // Authenticate admin user
    static async authenticateAdmin(username, password) {
        try {
            // Get admin user from database
            const [rows] = await pool.execute(
                'SELECT id, username, password_hash, email FROM admin_users WHERE username = ?',
                [username]
            );
            
            if (rows.length === 0) {
                return null; // User not found
            }
            
            const admin = rows[0];
            
            // Compare password with hashed password
            const isPasswordValid = await bcrypt.compare(password, admin.password_hash);
            
            if (!isPasswordValid) {
                return null; // Invalid password
            }
            
            // Create a JWT token for the admin session
            const token = jwt.sign(
                { userId: admin.id, username: admin.username, role: 'admin' },
                JWT_SECRET,
                { expiresIn: '7d' }
            );
            
            // Return admin info without password hash
            return {
                id: admin.id,
                username: admin.username,
                email: admin.email,
                token
            };
        } catch (error) {
            console.error('Error authenticating admin:', error);
            throw error;
        }
    }
    
    // Verify JWT token
    static async verifyToken(token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            return decoded;
        } catch (error) {
            console.error('Error verifying token:', error);
            return null;
        }
    }
    
    // Create a new admin user (for initial setup)
    static async createAdminUser(username, password, email) {
        try {
            // Hash the password
            const saltRounds = 10;
            const passwordHash = await bcrypt.hash(password, saltRounds);
            
            const [result] = await pool.execute(
                'INSERT INTO admin_users (username, password_hash, email) VALUES (?, ?, ?)',
                [username, passwordHash, email]
            );
            
            return { id: result.insertId, username, email };
        } catch (error) {
            console.error('Error creating admin user:', error);
            throw error;
        }
    }
}

module.exports = AuthService;
