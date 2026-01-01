#!/bin/bash

# Support Platform Installation Script
# This script will install and configure the support platform

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}  Support Platform Installer    ${NC}"
echo -e "${GREEN}================================${NC}"

# Function to print colored output
print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   print_error "This script should not be run as root"
   exit 1
fi

# Check if nginx is installed
if ! command -v nginx &> /dev/null; then
    print_error "nginx is not installed. Please install nginx first."
    exit 1
else
    print_status "nginx is installed"
fi

# Check if certbot is installed for SSL
if ! command -v certbot &> /dev/null; then
    print_warning "certbot is not installed. SSL certificates will not be automatically configured."
    INSTALL_CERTBOT=true
else
    print_status "certbot is installed"
    INSTALL_CERTBOT=false
fi

# Get domain name from user
while true; do
    read -p "Enter your domain name (e.g., example.com): " DOMAIN
    if [[ $DOMAIN =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$ ]]; then
        break
    else
        print_error "Invalid domain format. Please enter a valid domain name."
    fi
done

# Get admin username
while true; do
    read -p "Enter admin username: " ADMIN_USER
    if [[ -n "$ADMIN_USER" ]]; then
        break
    else
        print_error "Username cannot be empty."
    fi
done

# Get admin password
while true; do
    read -s -p "Enter admin password: " ADMIN_PASS
    echo
    if [[ ${#ADMIN_PASS} -ge 8 ]]; then
        break
    else
        print_error "Password must be at least 8 characters long."
    fi
done

# Confirm password
while true; do
    read -s -p "Confirm admin password: " ADMIN_PASS_CONFIRM
    echo
    if [[ "$ADMIN_PASS" == "$ADMIN_PASS_CONFIRM" ]]; then
        break
    else
        print_error "Passwords do not match. Please try again."
    fi
done

# Get Telegram bot token
read -p "Enter your Telegram bot token (optional, press Enter to skip): " TELEGRAM_BOT_TOKEN

# Find available port for SSL (since 443 is occupied)
find_available_port() {
    for port in {8443..8453}; do
        if ! ss -tuln | grep -q ":$port "; then
            echo $port
            return
        fi
    done
    print_error "No available ports found for SSL. Please free up a port in the range 8443-8453."
    exit 1
}

# Check if port 443 is available
if ss -tuln | grep -q ":443 "; then
    print_warning "Port 443 is already in use."
    SSL_PORT=$(find_available_port)
    print_status "Using port $SSL_PORT for SSL"
    USE_CUSTOM_SSL_PORT=true
else
    SSL_PORT=443
    USE_CUSTOM_SSL_PORT=false
    print_status "Using port 443 for SSL"
fi

# Create necessary directories
print_status "Creating directories..."
sudo mkdir -p /var/www/support-platform/{api,client,uploads}
sudo chown -R $USER:$USER /var/www/support-platform

# Install certbot if needed
if [[ "$INSTALL_CERTBOT" == true ]]; then
    print_status "Installing certbot..."
    sudo apt update
    sudo apt install -y certbot python3-certbot-nginx
fi

# Create database configuration
print_status "Setting up database..."
DB_NAME="support_platform"
DB_USER="support_user"
DB_PASS=$(openssl rand -base64 32)

# Install MySQL if not present
if ! command -v mysql &> /dev/null; then
    print_status "Installing MySQL..."
    sudo apt update
    sudo apt install -y mysql-server
    sudo systemctl start mysql
    sudo systemctl enable mysql
fi

# Create database and user
mysql -u root -e "CREATE DATABASE IF NOT EXISTS $DB_NAME;"
mysql -u root -e "CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';"
mysql -u root -e "GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';"
mysql -u root -e "FLUSH PRIVILEGES;"

# Create configuration file
print_status "Creating configuration file..."
cat > /var/www/support-platform/config.json << EOF
{
    "domain": "$DOMAIN",
    "ssl_port": $SSL_PORT,
    "database": {
        "host": "localhost",
        "name": "$DB_NAME",
        "user": "$DB_USER",
        "password": "$DB_PASS"
    },
    "admin": {
        "username": "$ADMIN_USER",
        "password": "$ADMIN_PASS"
    },
    "telegram": {
        "bot_token": "$TELEGRAM_BOT_TOKEN"
    }
}
EOF

# Copy application files
print_status "Copying application files..."
cp -r ./* /var/www/support-platform/

# Set proper permissions
sudo chown -R www-data:www-data /var/www/support-platform
sudo chmod -R 755 /var/www/support-platform

# Create Nginx configuration
print_status "Creating Nginx configuration..."
sudo tee /etc/nginx/sites-available/support-platform > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN;
    
    # Redirect all HTTP to HTTPS
    return 301 https://\$server_name:$SSL_PORT\$request_uri;
}

server {
    listen $SSL_PORT ssl http2;
    server_name $DOMAIN;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    
    # Client max body size
    client_max_body_size 100M;
    
    # Main location - redirect to user interface
    location / {
        return 301 /User;
    }
    
    # User interface
    location /User {
        alias /var/www/support-platform/client/;
        try_files \$uri \$uri/ /index.html;
        
        # Security for user interface
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # Admin panel
    location /Support {
        alias /var/www/support-platform/admin/;
        try_files \$uri \$uri/ /index.html;
        
        # Security for admin interface
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }
    
    # API endpoint
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
    
    # Uploads
    location /uploads {
        alias /var/www/support-platform/uploads/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/support-platform /etc/nginx/sites-enabled/
sudo nginx -t

# Obtain SSL certificate if certbot is available
if [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
    print_status "Obtaining SSL certificate..."
    sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN
else
    print_warning "Skipping SSL certificate setup (Telegram bot token not provided)"
fi

# Restart Nginx
print_status "Restarting Nginx..."
sudo systemctl reload nginx

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    print_status "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Install PM2 for process management
print_status "Installing PM2..."
npm install -g pm2

# Start the application
print_status "Starting application..."
cd /var/www/support-platform/api
npm install
pm2 start server.js --name support-platform-api

# Save PM2 processes to start on boot
pm2 startup
pm2 save

print_status "Installation completed successfully!"
echo
echo -e "${GREEN}Access your support platform at:${NC}"
if [[ "$USE_CUSTOM_SSL_PORT" == true ]]; then
    echo -e "  User Interface: https://$DOMAIN:$SSL_PORT/User"
    echo -e "  Admin Panel: https://$DOMAIN:$SSL_PORT/Support"
else
    echo -e "  User Interface: https://$DOMAIN/User"
    echo -e "  Admin Panel: https://$DOMAIN/Support"
fi
echo
print_status "Admin credentials:"
echo -e "  Username: $ADMIN_USER"
echo -e "  Password: [hidden for security]"
echo
print_status "Database credentials (stored in config.json):"
echo -e "  Database: $DB_NAME"
echo -e "  User: $DB_USER"
echo -e "  Password: $DB_PASS"
echo
print_status "Telegram Bot Token: $TELEGRAM_BOT_TOKEN"