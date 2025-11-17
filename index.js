// Import paket
const express = require('express');
const path = require('path');
const crypto = require('crypto');
// Op digunakan untuk query yang lebih kompleks, tapi tidak kita pakai di sini
const { Sequelize, DataTypes, Op } = require('sequelize');

// Inisialisasi Express
const app = express();
const port = 3000;

// Middleware (agar bisa baca JSON dan sajikan file statis)
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 1. KONEKSI DATABASE ---
// (Menggunakan database 'apikey2' sesuai permintaan Anda)
const sequelize = new Sequelize(
    'apikey2',       // Nama database
    'root',          // Username
    'Kevinnadr123', // Password Anda
    {
        host: 'localhost',
        port: 3308, // Sesuaikan port jika perlu
        dialect: 'mysql'
    }
);

// --- 2. DEFINISI MODEL (TABEL) ---

// TABEL USER (first_name, last_name, email)
const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    first_name: { type: DataTypes.STRING, allowNull: false },
    last_name: { type: DataTypes.STRING },
    email: { type: DataTypes.STRING, allowNull: false, unique: true }
});

// TABEL ADMIN (email, password)
const Admin = sequelize.define('Admin', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING, allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false } 
});

// TABEL APIKEY (key, out_of_date)
const ApiKey = sequelize.define('ApiKey', {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    key: { type: DataTypes.STRING(255), allowNull: false, unique: true },
    expires_at: { // Ini implementasi 'out of date'
        type: DataTypes.DATE,
        allowNull: false
    }
});

// --- 3. DEFINISI RELASI ---
// User (1) ke ApiKey (Banyak)
// PENTING: onDelete: 'CASCADE' 
// Artinya: Jika User dihapus, semua ApiKey milik user tsb ikut terhapus.
User.hasMany(ApiKey, { 
    foreignKey: 'userId',
    onDelete: 'CASCADE' 
});
ApiKey.belongsTo(User, { 
    foreignKey: 'userId' 
});


// --- 4. RUTE (ENDPOINTS) ---

// === Rute untuk UI PUBLIK (index.html) ===

// Rute untuk menyajikan file index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rute untuk generate string key (untuk tombol 'Generate' di UI)
app.post('/generate-key', (req, res) => {
    try {
        const keyBytes = crypto.randomBytes(32);
        const token = keyBytes.toString('base64url');
        const stamp = Date.now().toString(36);
        const newKey = `sk-co-vi-${stamp}.${token}`;
        res.status(200).json({ apiKey: newKey });
    } catch (error) {
        res.status(500).json({ error: 'Gagal membuat string key' });
    }
});

// Rute untuk MENYIMPAN USER BARU (dari tombol 'Save' di index.html)
app.post('/users', async (req, res) => {
    const { firstName, lastName, email, apiKey } = req.body;

    if (!firstName || !email || !apiKey) {
        return res.status(400).json({ error: 'First name, email, dan API key wajib diisi' });
    }

    const t = await sequelize.transaction();
    try {
        // 1. Buat User
        const newUser = await User.create({
            first_name: firstName,
            last_name: lastName,
            email: email
        }, { transaction: t });

        // 2. Siapkan tanggal kedaluwarsa (1 tahun dari sekarang)
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        // 3. Buat ApiKey yang terhubung dengan user baru
        await ApiKey.create({
            key: apiKey,
            expires_at: expiryDate,
            userId: newUser.id // Ini adalah relasinya
        }, { transaction: t });

        // 4. Selesaikan transaksi
        await t.commit();
        res.status(201).json({ message: 'User dan API Key berhasil dibuat!' });

    } catch (error) {
        await t.rollback(); // Batalkan semua jika ada error
        if (error.name === 'SequelizeUniqueConstraintError') {
             return res.status(409).json({ error: 'Email atau API Key sudah terdaftar.' });
        }
        res.status(500).json({ error: 'Gagal menyimpan ke database' });
    }
});


// === Rute untuk ADMIN API (admin.html) ===

// Rute untuk Register Admin (dari admin.html)
app.post('/admin/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }

    try {
        // Di aplikasi nyata, 'password' HARUS di-hash dulu (misal: pakai bcrypt)
        const newAdmin = await Admin.create({ email, password });
        res.status(201).json({ message: 'Admin berhasil dibuat', id: newAdmin.id });
    } catch (error) {
         if (error.name === 'SequelizeUniqueConstraintError') {
             return res.status(409).json({ error: 'Email admin sudah terdaftar.' });
        }
        res.status(500).json({ error: 'Gagal mendaftar admin' });
    }
});

// Rute untuk Login Admin (dari admin.html)
app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email dan password wajib diisi' });
    }

    try {
        const admin = await Admin.findOne({ where: { email: email } });
        
        if (!admin || admin.password !== password) {
            return res.status(401).json({ error: 'Email atau password salah' });
        }
        
        res.status(200).json({ message: 'Login admin berhasil' });

    } catch (error) {
        res.status(500).json({ error: 'Error internal server' });
    }
});


// GET: LIST USER (untuk Admin) - Versi LENGKAP
// Ini adalah versi yang sudah DIPERBAIKI (sesuai error di gambar)
app.get('/admin/users', async (req, res) => {
    try {
        const users = await User.findAll({
            // 'include' adalah perintah untuk "menggabungkan" tabel
            include: {
                model: ApiKey, // Gabungkan dengan model ApiKey
                attributes: ['key', 'expires_at'] // Tampilkan atribut ini dari ApiKey
            }
        });
        res.status(200).json(users);
    } catch (error) {
        console.error('Gagal mengambil data user dengan key:', error);
        res.status(500).json({ error: 'Gagal mengambil data user' });
    }
});

// GET: LIST APIKEY (untuk Admin)
app.get('/admin/apikeys', async (req, res) => {
    try {
        const keys = await ApiKey.findAll({
            // 'include' untuk mengambil data User yang terkait (join tabel)
            include: {
                model: User,
                attributes: ['email'] // Hanya ambil email user
            },
            attributes: ['id', 'key', 'expires_at', 'createdAt']
        });

        // Format respons agar sesuai permintaan (key, out of date, status)
        const responseData = keys.map(apiKey => {
            const isInactive = new Date(apiKey.expires_at) < new Date();
            return {
                id: apiKey.id,
                key: apiKey.key,
                out_of_date: apiKey.expires_at, // Ini tanggal kedaluwarsa
                status: isInactive ? 'inactive' : 'active', // Status (inactive)
                user_email: apiKey.User ? apiKey.User.email : null,
                created_at: apiKey.createdAt
            };
        });

        res.status(200).json(responseData);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Gagal mengambil data API key' });
    }
});

// DELETE: HAPUS USER (dan semua ApiKey miliknya)
app.delete('/admin/users/:id', async (req, res) => {
    const userId = req.params.id;

    try {
        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({ error: 'User tidak ditemukan' });
        }

        // Hapus user dari database
        await user.destroy();
        // Karena kita sudah mengatur onDelete: 'CASCADE',
        // semua ApiKey yang terhubung akan otomatis terhapus.

        res.status(200).json({ message: `User (ID: ${userId}) dan semua API key miliknya telah dihapus.` });

    } catch (error) {
        console.error('Gagal menghapus user:', error);
        res.status(500).json({ error: 'Error internal server saat menghapus user' });
    }
});


// --- 5. START SERVER ---
async function startServer() {
    try {
        await sequelize.authenticate();
        console.log('✅ Koneksi ke database "apikey2" BERHASIL.');
        
        // Sinkronisasi model.
        // { alter: true } akan mencoba mencocokkan tabel dengan model
        // Ini penting untuk menerapkan 'onDelete: CASCADE'
        await sequelize.sync({ alter: true }); 
        console.log('✅ Semua model berhasil disinkronkan.');

        // Menjalankan server
        app.listen(port, () => {
            console.log(`Server berjalan di http://localhost:${port}`);
        });

    } catch (error) {
        console.error('❌ Gagal menyambung atau sinkronisasi database:', error);
    }
}

// Panggil fungsi untuk memulai server
startServer();