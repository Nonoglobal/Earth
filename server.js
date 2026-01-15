// =====================================================
// ATLAS LIBRARY SERVER - RENDER DEPLOYMENT VERSION
// =====================================================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
// Render verwendet die PORT Umgebungsvariable
const PORT = process.env.PORT || 3002;

// =====================================================
// DIRECTORY SETUP - Render hat persistenten Speicher unter /var/data
// Für Render Free: Daten werden bei Neustart gelöscht
// Für Render mit Disk: Nutze /var/data
// =====================================================
const DATA_DIR = process.env.RENDER ? '/var/data/library' : path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.RENDER ? '/var/data/uploads' : path.join(__dirname, 'uploads');

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created: ${dir}`);
    }
});

// =====================================================
// DATABASE FILES
// =====================================================
const DB_FILES = {
    library: path.join(DATA_DIR, 'library.json'),
    categories: path.join(DATA_DIR, 'categories.json'),
    tags: path.join(DATA_DIR, 'tags.json')
};

// =====================================================
// MIDDLEWARE
// =====================================================
app.use(cors({
    origin: '*', // Für Produktion einschränken
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static('public'));

// =====================================================
// FILE UPLOAD CONFIG
// =====================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueId = crypto.randomBytes(8).toString('hex');
        const ext = path.extname(file.originalname);
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${uniqueId}_${safeName}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'text/plain',
            'text/html',
            'text/markdown',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'video/mp4',
            'audio/mpeg',
            'application/json',
            'application/zip'
        ];
        
        if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('text/')) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed`), false);
        }
    }
});

// =====================================================
// HELPER FUNCTIONS
// =====================================================
function loadDB(file) {
    try {
        if (fs.existsSync(file)) {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        return null;
    } catch (e) {
        console.error(`Error loading ${file}:`, e);
        return null;
    }
}

function saveDB(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error(`Error saving ${file}:`, e);
        return false;
    }
}

function initDatabase() {
    // Library
    if (!loadDB(DB_FILES.library)) {
        saveDB(DB_FILES.library, {
            items: [],
            stats: { totalItems: 0, totalFiles: 0, totalLinks: 0, totalSize: 0 },
            lastUpdated: new Date().toISOString()
        });
    }

    // Categories
    if (!loadDB(DB_FILES.categories)) {
        saveDB(DB_FILES.categories, {
            categories: [
                { id: 'conflicts', name: 'Konflikte', icon: '⚔️', color: '#ff3333' },
                { id: 'military', name: 'Militär', icon: '🎖️', color: '#ff6600' },
                { id: 'politics', name: 'Politik', icon: '🏛️', color: '#ffaa00' },
                { id: 'intelligence', name: 'Intelligence', icon: '🔍', color: '#00aaff' },
                { id: 'maps', name: 'Karten', icon: '🗺️', color: '#00ff00' },
                { id: 'reports', name: 'Berichte', icon: '📊', color: '#aa00ff' },
                { id: 'media', name: 'Medien', icon: '📰', color: '#ff00aa' },
                { id: 'other', name: 'Sonstiges', icon: '📁', color: '#666666' }
            ]
        });
    }

    // Tags
    if (!loadDB(DB_FILES.tags)) {
        saveDB(DB_FILES.tags, {
            tags: ['Ukraine', 'Russia', 'Israel', 'Gaza', 'Syria', 'Iran', 'NATO', 'USA', 'China', 'Important', 'Verified']
        });
    }

    console.log('✅ Database initialized');
}

function generateId() {
    return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function getFileType(mimetype, filename) {
    if (mimetype.includes('pdf')) return 'pdf';
    if (mimetype.includes('word') || filename.endsWith('.doc') || filename.endsWith('.docx')) return 'word';
    if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return 'excel';
    if (mimetype.includes('powerpoint') || mimetype.includes('presentation')) return 'powerpoint';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.includes('text') || mimetype.includes('markdown')) return 'text';
    return 'file';
}

function extractTextPreview(filePath, mimetype) {
    if (mimetype.startsWith('text/') || mimetype.includes('json')) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return content.substring(0, 500);
        } catch (e) {
            return null;
        }
    }
    return null;
}

// =====================================================
// API ROUTES - LIBRARY
// =====================================================

// GET alle Items
app.get('/api/library', (req, res) => {
    const { search, category, tag, type, sort, limit, offset } = req.query;
    const db = loadDB(DB_FILES.library);
    
    if (!db) return res.status(500).json({ error: 'Database error' });

    let items = [...db.items];

    // Filter
    if (search) {
        const s = search.toLowerCase();
        items = items.filter(item => 
            item.title.toLowerCase().includes(s) ||
            item.description?.toLowerCase().includes(s) ||
            item.tags?.some(t => t.toLowerCase().includes(s)) ||
            item.content?.toLowerCase().includes(s)
        );
    }
    if (category) items = items.filter(item => item.category === category);
    if (tag) items = items.filter(item => item.tags?.includes(tag));
    if (type) items = items.filter(item => item.type === type);

    // Sort
    if (sort === 'oldest') {
        items.sort((a, b) => new Date(a.created) - new Date(b.created));
    } else if (sort === 'title') {
        items.sort((a, b) => a.title.localeCompare(b.title));
    } else {
        items.sort((a, b) => new Date(b.created) - new Date(a.created));
    }

    // Pagination
    const total = items.length;
    const start = parseInt(offset) || 0;
    const count = parseInt(limit) || 50;
    items = items.slice(start, start + count);

    res.json({ items, total, offset: start, limit: count, stats: db.stats });
});

// GET einzelnes Item
app.get('/api/library/:id', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const item = db?.items.find(i => i.id === req.params.id);
    
    if (item) {
        item.views = (item.views || 0) + 1;
        saveDB(DB_FILES.library, db);
        res.json(item);
    } else {
        res.status(404).json({ error: 'Item not found' });
    }
});

// POST neues Item (Link/Notiz)
app.post('/api/library', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const { title, description, type, url, content, category, tags, country, source } = req.body;

    if (!title) return res.status(400).json({ error: 'Title required' });

    const newItem = {
        id: generateId(),
        type: type || 'note',
        title,
        description: description || '',
        url: url || null,
        content: content || null,
        category: category || 'other',
        tags: tags || [],
        country: country || null,
        source: source || null,
        created: new Date().toISOString(),
        updated: null,
        views: 0,
        starred: false
    };

    db.items.unshift(newItem);
    db.stats.totalItems++;
    if (type === 'link') db.stats.totalLinks++;
    db.lastUpdated = new Date().toISOString();

    saveDB(DB_FILES.library, db);
    res.json({ success: true, item: newItem });
});

// POST Datei-Upload
app.post('/api/library/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const db = loadDB(DB_FILES.library);
    const { title, description, category, tags, country, source } = req.body;

    const fileType = getFileType(req.file.mimetype, req.file.originalname);
    const textPreview = extractTextPreview(req.file.path, req.file.mimetype);

    const newItem = {
        id: generateId(),
        type: 'file',
        fileType,
        title: title || req.file.originalname,
        description: description || '',
        category: category || 'other',
        tags: tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [],
        country: country || null,
        source: source || null,
        file: {
            originalName: req.file.originalname,
            filename: req.file.filename,
            path: `/uploads/${req.file.filename}`,
            mimetype: req.file.mimetype,
            size: req.file.size
        },
        textPreview,
        created: new Date().toISOString(),
        updated: null,
        views: 0,
        starred: false
    };

    db.items.unshift(newItem);
    db.stats.totalItems++;
    db.stats.totalFiles++;
    db.stats.totalSize += req.file.size;
    db.lastUpdated = new Date().toISOString();

    saveDB(DB_FILES.library, db);
    res.json({ success: true, item: newItem });
});

// PUT Item aktualisieren
app.put('/api/library/:id', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const index = db?.items.findIndex(i => i.id === req.params.id);
    
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    const { title, description, category, tags, country, source, content, starred } = req.body;

    if (title !== undefined) db.items[index].title = title;
    if (description !== undefined) db.items[index].description = description;
    if (category !== undefined) db.items[index].category = category;
    if (tags !== undefined) db.items[index].tags = tags;
    if (country !== undefined) db.items[index].country = country;
    if (source !== undefined) db.items[index].source = source;
    if (content !== undefined) db.items[index].content = content;
    if (starred !== undefined) db.items[index].starred = starred;

    db.items[index].updated = new Date().toISOString();
    db.lastUpdated = new Date().toISOString();

    saveDB(DB_FILES.library, db);
    res.json({ success: true, item: db.items[index] });
});

// DELETE Item
app.delete('/api/library/:id', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const index = db?.items.findIndex(i => i.id === req.params.id);
    
    if (index === -1) return res.status(404).json({ error: 'Item not found' });

    const item = db.items[index];

    // Datei löschen
    if (item.file) {
        const filePath = path.join(UPLOADS_DIR, item.file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        db.stats.totalFiles--;
        db.stats.totalSize -= item.file.size;
    }

    if (item.type === 'link') db.stats.totalLinks--;

    db.items.splice(index, 1);
    db.stats.totalItems--;
    db.lastUpdated = new Date().toISOString();

    saveDB(DB_FILES.library, db);
    res.json({ success: true });
});

// =====================================================
// API ROUTES - CATEGORIES & TAGS
// =====================================================
app.get('/api/categories', (req, res) => {
    const db = loadDB(DB_FILES.categories);
    res.json(db?.categories || []);
});

app.post('/api/categories', (req, res) => {
    const db = loadDB(DB_FILES.categories) || { categories: [] };
    const { name, icon, color } = req.body;

    const newCategory = {
        id: name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        name,
        icon: icon || '📁',
        color: color || '#666666'
    };

    db.categories.push(newCategory);
    saveDB(DB_FILES.categories, db);
    res.json({ success: true, category: newCategory });
});

app.get('/api/tags', (req, res) => {
    const db = loadDB(DB_FILES.tags);
    res.json(db?.tags || []);
});

app.post('/api/tags', (req, res) => {
    const db = loadDB(DB_FILES.tags) || { tags: [] };
    const { tag } = req.body;

    if (tag && !db.tags.includes(tag)) {
        db.tags.push(tag);
        saveDB(DB_FILES.tags, db);
    }
    res.json({ success: true, tags: db.tags });
});

// =====================================================
// API ROUTES - STATS & SEARCH
// =====================================================
app.get('/api/stats', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const categories = loadDB(DB_FILES.categories);
    
    const categoryStats = {};
    categories?.categories.forEach(cat => {
        categoryStats[cat.id] = db?.items.filter(i => i.category === cat.id).length || 0;
    });

    res.json({ ...db?.stats, categoryStats, lastUpdated: db?.lastUpdated });
});

app.get('/api/search', (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({ items: [], total: 0 });

    const db = loadDB(DB_FILES.library);
    const searchLower = q.toLowerCase();

    const items = db?.items.filter(item => {
        return (
            item.title.toLowerCase().includes(searchLower) ||
            item.description?.toLowerCase().includes(searchLower) ||
            item.tags?.some(t => t.toLowerCase().includes(searchLower)) ||
            item.content?.toLowerCase().includes(searchLower) ||
            item.textPreview?.toLowerCase().includes(searchLower)
        );
    }) || [];

    res.json({ items: items.slice(0, 50), total: items.length, query: q });
});

// =====================================================
// EXPORT/IMPORT
// =====================================================
app.get('/api/export', (req, res) => {
    res.json({
        exportDate: new Date().toISOString(),
        library: loadDB(DB_FILES.library),
        categories: loadDB(DB_FILES.categories),
        tags: loadDB(DB_FILES.tags)
    });
});

app.post('/api/import', (req, res) => {
    const { library, categories, tags } = req.body;
    try {
        if (library) saveDB(DB_FILES.library, library);
        if (categories) saveDB(DB_FILES.categories, categories);
        if (tags) saveDB(DB_FILES.tags, tags);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Import failed' });
    }
});

// =====================================================
// HEALTH CHECK (wichtig für Render)
// =====================================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        server: 'ATLAS Library',
        version: '1.0.0',
        environment: process.env.RENDER ? 'render' : 'local',
        timestamp: new Date().toISOString()
    });
});

// Root route - serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =====================================================
// START
// =====================================================
initDatabase();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║            ATLAS LIBRARY SERVER RUNNING                   ║
╠═══════════════════════════════════════════════════════════╣
║  Port:       ${PORT}                                           ║
║  Environment: ${process.env.RENDER ? 'Render' : 'Local'}                                    ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

module.exports = app;
