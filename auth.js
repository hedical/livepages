// Authentication module
const WEBHOOK_URL = 'https://databuildr.app.n8n.cloud/webhook/passwordROI';

// Storage key
const STORAGE_KEY = 'roi_password';

// URLs that will be populated after authentication
const dataURLs = {
    DESCRIPTIF_URL: '',
    AUTOCONTACT_URL: '',
    COMPARATEUR_URL: ''
};

// Authenticate with webhook
async function authenticateWithPassword(password) {
    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: password
        });
        
        if (!response.ok) {
            return null;
        }
        
        const result = await response.text();
        
        // Parse the response to extract URLs
        const descriptifMatch = result.match(/DESCRIPTIF_URL = '([^']+)'/);
        const autocontactMatch = result.match(/AUTOCONTACT_URL = '([^']+)'/);
        const comparateurMatch = result.match(/COMPARATEUR_URL = '([^']+)'/);
        
        if (descriptifMatch && autocontactMatch && comparateurMatch) {
            const urls = {
                DESCRIPTIF_URL: descriptifMatch[1],
                AUTOCONTACT_URL: autocontactMatch[1],
                COMPARATEUR_URL: comparateurMatch[1]
            };
            
            console.log('Authentication successful');
            return urls;
        }
        
        return null;
    } catch (error) {
        console.error('Authentication error:', error);
        return null;
    }
}

// Get stored password and authenticate
async function getAuthenticatedURLs() {
    const storedPassword = localStorage.getItem(STORAGE_KEY);
    
    if (storedPassword) {
        const urls = await authenticateWithPassword(storedPassword);
        if (urls) {
            return urls;
        } else {
            // Stored password is invalid, remove it
            localStorage.removeItem(STORAGE_KEY);
        }
    }
    
    return null;
}

// Store password
function storePassword(password) {
    localStorage.setItem(STORAGE_KEY, password);
}

// Clear stored password (logout)
function clearPassword() {
    localStorage.removeItem(STORAGE_KEY);
}

