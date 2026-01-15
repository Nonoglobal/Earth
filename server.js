// ATLAS LIBRARY SERVER - RENDER FREE VERSION
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3002;

// Directories im Projekt-Ordner (NICHT /var/data)
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

[DATA_DIR, UPLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const DB_FILES = {
    library: path.join(DATA_DIR, 'library.json'),
    categories: path.join(DATA_DIR, 'categories.json'),
    tags: path.join(DATA_DIR, 'tags.json')
};

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static('public'));

// File Upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const id = crypto.randomBytes(8).toString('hex');
        cb(null, `${id}_${file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`);
    }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Helper Functions
function loadDB(file) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) { console.error(e); }
    return null;
}

function saveDB(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) { return false; }
}

function initDatabase() {
    if (!loadDB(DB_FILES.library)) {
        saveDB(DB_FILES.library, { items: [], stats: { totalItems: 0, totalFiles: 0, totalLinks: 0, totalSize: 0 }, lastUpdated: new Date().toISOString() });
    }
    if (!loadDB(DB_FILES.categories)) {
        saveDB(DB_FILES.categories, { categories: [
            { id: 'conflicts', name: 'Konflikte', icon: '⚔️', color: '#ff3333' },
            { id: 'military', name: 'Militär', icon: '🎖️', color: '#ff6600' },
            { id: 'politics', name: 'Politik', icon: '🏛️', color: '#ffaa00' },
            { id: 'intelligence', name: 'Intelligence', icon: '🔍', color: '#00aaff' },
            { id: 'maps', name: 'Karten', icon: '🗺️', color: '#00ff00' },
            { id: 'reports', name: 'Berichte', icon: '📊', color: '#aa00ff' },
            { id: 'media', name: 'Medien', icon: '📰', color: '#ff00aa' },
            { id: 'other', name: 'Sonstiges', icon: '📁', color: '#666666' }
        ]});
    }
    if (!loadDB(DB_FILES.tags)) {
        saveDB(DB_FILES.tags, { tags: ['Ukraine', 'Russia', 'Israel', 'Gaza', 'Syria', 'Iran', 'NATO', 'Important'] });
    }
    console.log('✅ Database initialized');
}

function generateId() { return Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }

function getFileType(mime) {
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('word')) return 'word';
    if (mime.includes('excel') || mime.includes('spreadsheet')) return 'excel';
    if (mime.startsWith('image/')) return 'image';
    return 'file';
}

// API ROUTES
app.get('/api/library', (req, res) => {
    const { search, category, type } = req.query;
    const db = loadDB(DB_FILES.library) || { items: [], stats: {} };
    let items = [...db.items];
    if (search) items = items.filter(i => i.title?.toLowerCase().includes(search.toLowerCase()));
    if (category) items = items.filter(i => i.category === category);
    if (type) items = items.filter(i => i.type === type);
    items.sort((a, b) => new Date(b.created) - new Date(a.created));
    res.json({ items, total: items.length, stats: db.stats });
});

app.get('/api/library/:id', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const item = db?.items?.find(i => i.id === req.params.id);
    if (item) { item.views = (item.views || 0) + 1; saveDB(DB_FILES.library, db); res.json(item); }
    else res.status(404).json({ error: 'Not found' });
});

app.post('/api/library', (req, res) => {
    const db = loadDB(DB_FILES.library) || { items: [], stats: { totalItems: 0, totalFiles: 0, totalLinks: 0, totalSize: 0 } };
    const { title, description, type, url, content, category, tags, source } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const newItem = { id: generateId(), type: type || 'note', title, description: description || '', url, content, category: category || 'other', tags: tags || [], source, created: new Date().toISOString(), views: 0, starred: false };
    db.items.unshift(newItem);
    db.stats.totalItems++;
    if (type === 'link') db.stats.totalLinks++;
    saveDB(DB_FILES.library, db);
    res.json({ success: true, item: newItem });
});

app.post('/api/library/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const db = loadDB(DB_FILES.library) || { items: [], stats: { totalItems: 0, totalFiles: 0, totalLinks: 0, totalSize: 0 } };
    const { title, description, category, tags } = req.body;
    const newItem = {
        id: generateId(), type: 'file', fileType: getFileType(req.file.mimetype),
        title: title || req.file.originalname, description: description || '',
        category: category || 'other', tags: tags ? tags.split(',').map(t => t.trim()) : [],
        file: { originalName: req.file.originalname, filename: req.file.filename, path: `/uploads/${req.file.filename}`, mimetype: req.file.mimetype, size: req.file.size },
        created: new Date().toISOString(), views: 0, starred: false
    };
    db.items.unshift(newItem);
    db.stats.totalItems++;
    db.stats.totalFiles++;
    db.stats.totalSize += req.file.size;
    saveDB(DB_FILES.library, db);
    res.json({ success: true, item: newItem });
});

app.put('/api/library/:id', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const index = db?.items?.findIndex(i => i.id === req.params.id);
    if (index === -1 || index === undefined) return res.status(404).json({ error: 'Not found' });
    const { title, description, category, tags, content, starred } = req.body;
    if (title !== undefined) db.items[index].title = title;
    if (description !== undefined) db.items[index].description = description;
    if (category !== undefined) db.items[index].category = category;
    if (tags !== undefined) db.items[index].tags = tags;
    if (content !== undefined) db.items[index].content = content;
    if (starred !== undefined) db.items[index].starred = starred;
    db.items[index].updated = new Date().toISOString();
    saveDB(DB_FILES.library, db);
    res.json({ success: true, item: db.items[index] });
});

app.delete('/api/library/:id', (req, res) => {
    const db = loadDB(DB_FILES.library);
    const index = db?.items?.findIndex(i => i.id === req.params.id);
    if (index === -1 || index === undefined) return res.status(404).json({ error: 'Not found' });
    const item = db.items[index];
    if (item.file) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, item.file.filename)); } catch(e) {}
        db.stats.totalFiles--;
        db.stats.totalSize -= item.file.size || 0;
    }
    if (item.type === 'link') db.stats.totalLinks--;
    db.items.splice(index, 1);
    db.stats.totalItems--;
    saveDB(DB_FILES.library, db);
    res.json({ success: true });
});

app.get('/api/categories', (req, res) => {
    const db = loadDB(DB_FILES.categories);
    res.json(db?.categories || []);
});

app.get('/api/tags', (req, res) => {
    const db = loadDB(DB_FILES.tags);
    res.json(db?.tags || []);
});

app.get('/api/stats', (req, res) => {
    const db = loadDB(DB_FILES.library);
    res.json(db?.stats || {});
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', server: 'ATLAS Library', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// START
initDatabase();
app.listen(PORT, '0.0.0.0', () => {
    console.log(`ATLAS Library Server running on port ${PORT}`);
});
