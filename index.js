const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./db');
const { escanearCorreosGmail } = require('./services/gmailAiService');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Servir estáticos desde public y la raíz
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// Servir carpetas de archivos adjuntos e imágenes
const ADJUNTOS_DIR = path.join(__dirname, 'adjuntos');
if (!fs.existsSync(ADJUNTOS_DIR)) {
  fs.mkdirSync(ADJUNTOS_DIR, { recursive: true });
}
app.use('/adjuntos', express.static(ADJUNTOS_DIR));

const IMAGENES_DIR = path.join(__dirname, 'Imagenes');
if (!fs.existsSync(IMAGENES_DIR)) {
  fs.mkdirSync(IMAGENES_DIR, { recursive: true });
}
app.use('/Imagenes', express.static(IMAGENES_DIR));

// Importar y usar los Routers pasando (pool)
const preciosRoutes = require('./routes/preciosRoutes')(pool);
app.use(preciosRoutes);

const cajaRoutes = require('./routes/cajaRoutes')(pool);
app.use('/api/caja', cajaRoutes);

const ordenesRoutes = require('./routes/ordenesRoutes')(pool);
app.use(ordenesRoutes);

const clientesRoutes = require('./routes/clientesRoutes')(pool);
app.use(clientesRoutes);

// Endpoint de Login API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0 || result.rows[0].password !== password) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    res.json({ success: true, username: result.rows[0].username, role: result.rows[0].role });
  } catch (err) {
    console.error('Error en /api/login:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ✅ Sintaxis compatible con path-to-regexp v8+
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicialización del servidor HTTP y escaneo de Gmail
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
  
  // Escaneo periódico de correos con la IA de Gemini
  setInterval(() => {
    escanearCorreosGmail(pool).catch(err => {
      console.error('Error en intervalo de escanearCorreosGmail:', err.message);
    });
  }, 15000);
});
