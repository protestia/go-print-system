const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { GoogleGenAI, Type } = require('@google/genai');
const { google } = require('googleapis');
const pool = require('./db');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

const preciosRoutes = require('./preciosRoutes');
app.use(preciosRoutes);

const cajaRoutes = require('./caja')(pool);
app.use('/api/caja', cajaRoutes);

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

// Inicialización automática de tablas y columnas nuevas
// Inicialización automática de tablas y columnas nuevas
async function inicializarBaseDeDatos() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin'
      );

      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        is_linear BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS print_types (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pricing_rules (
        id SERIAL PRIMARY KEY,
        material_id INT REFERENCES materials(id) ON DELETE CASCADE,
        print_type_id INT REFERENCES print_types(id) ON DELETE CASCADE,
        price_per_m2 NUMERIC(10,2) DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS work_orders (
        id SERIAL PRIMARY KEY,
        client_name VARCHAR(255),
        client_email VARCHAR(255),
        width_cm NUMERIC(10,2) DEFAULT 0,
        height_cm NUMERIC(10,2) DEFAULT 0,
        copies INT DEFAULT 1,
        total_price NUMERIC(10,2) DEFAULT 0,
        original_files TEXT,
        status VARCHAR(50) DEFAULT 'PENDING_DESIGN',
        email_id VARCHAR(255) UNIQUE,
        fecha_prometida VARCHAR(100),
        entregado_por VARCHAR(255),
        fecha_entrega VARCHAR(100),
        notes TEXT,
        is_urgent BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS work_order_items (
        id SERIAL PRIMARY KEY,
        work_order_id INT REFERENCES work_orders(id) ON DELETE CASCADE,
        file_name VARCHAR(255),
        material_id INT REFERENCES materials(id),
        print_type_id INT REFERENCES print_types(id),
        width_cm NUMERIC(10,2) DEFAULT 0,
        height_cm NUMERIC(10,2) DEFAULT 0,
        copies INT DEFAULT 1,
        area_m2 NUMERIC(10,2) DEFAULT 0,
        file_url TEXT,
        is_printed BOOLEAN DEFAULT FALSE,
        is_delivered_item BOOLEAN DEFAULT FALSE,
        unit_price_override NUMERIC(10,2) DEFAULT NULL
      );
    `);

    // Columnas adicionales de forma segura
    await pool.query(`
      ALTER TABLE work_order_items ADD COLUMN IF NOT EXISTS is_printed BOOLEAN DEFAULT FALSE;
      ALTER TABLE work_order_items ADD COLUMN IF NOT EXISTS is_delivered_item BOOLEAN DEFAULT FALSE;
      ALTER TABLE work_order_items ADD COLUMN IF NOT EXISTS unit_price_override NUMERIC(10,2) DEFAULT NULL;
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS fecha_prometida VARCHAR(100);
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS entregado_por VARCHAR(255);
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS fecha_entrega VARCHAR(100);
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS is_urgent BOOLEAN DEFAULT FALSE;
    `);

    const adminCheck = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (adminCheck.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['admin', 'elcoes22', 'admin']
      );
      console.log('👤 Usuario administrador verificado/creado.');
    }

    console.log('✅ Base de datos verificada y conectada correctamente.');
  } catch (err) {
    console.error('❌ Error inicializando la base de datos:', err);
  }
}

inicializarBaseDeDatos();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function getOAuthClient() {
  let credentials;
  let token;

  if (process.env.GOOGLE_CREDENTIALS && process.env.GOOGLE_TOKEN) {
    credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    token = JSON.parse(process.env.GOOGLE_TOKEN);
  } else {
    credentials = JSON.parse(fs.readFileSync('credentials.json'));
    token = JSON.parse(fs.readFileSync('token.json'));
  }

  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob');
  oAuth2Client.setCredentials(token);
  return oAuth2Client;
}

function getGmailClient() {
  const oAuth2Client = getOAuthClient();
  return google.gmail({ version: 'v1', auth: oAuth2Client });
}

function extraerUrlDrive(emailHtmlBody, emailBodyText) {
  if (emailHtmlBody) {
    const matchHref = emailHtmlBody.match(/href="(https:\/\/(?:drive|docs)\.google\.com\/[^"]+)"/i);
    if (matchHref) return matchHref[1];
    const matchGeneralHtml = emailHtmlBody.match(/(https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/[a-zA-Z0-9_-]+[^\s"']*)/i);
    if (matchGeneralHtml) return matchGeneralHtml[1];
  }
  if (emailBodyText) {
    const matchText = emailBodyText.match(/(https?:\/\/(?:drive|docs)\.google\.com\/file\/d\/[a-zA-Z0-9_-]+[^\s"']*)/i);
    if (matchText) return matchText[1];
  }
  return null;
}

async function descargarAdjuntosGmail(gmail, messageId, emailBody, emailHtmlBody) {
  let archivosGuardados = [];
  try {
    const mensajeCompleto = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const payload = mensajeCompleto.data.payload;
    let partesConAdjunto = [];

    function buscarPartes(parts) {
      if (!parts) return;
      for (const part of parts) {
        if (part.filename && part.filename.length > 0) {
          partesConAdjunto.push({ filename: part.filename, attachmentId: part.body && part.body.attachmentId, body: part.body });
        }
        if (part.parts && Array.isArray(part.parts)) buscarPartes(part.parts);
      }
    }

    if (payload.parts) buscarPartes(payload.parts);
    else if (payload.filename && payload.body) {
      partesConAdjunto.push({ filename: payload.filename, attachmentId: payload.body.attachmentId, body: payload.body });
    }

    for (const archivo of partesConAdjunto) {
      let fileData = null;
      if (archivo.attachmentId) {
        try {
          const attach = await gmail.users.messages.attachments.get({ userId: 'me', messageId: messageId, id: archivo.attachmentId });
          fileData = Buffer.from(attach.data.data, 'base64url');
        } catch (e) {}
      }

      if (fileData && fileData.length > 0) {
        const cleanedFilename = archivo.filename.replace(/[<>]/g, '').trim();
        const safeFilename = `${Date.now()}_${cleanedFilename.replace(/\s+/g, '_')}`;
        const filePath = path.join(ADJUNTOS_DIR, safeFilename);
        fs.writeFileSync(filePath, fileData);
        
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
        const publicUrl = `${baseUrl}/adjuntos/${encodeURIComponent(safeFilename)}`;
        archivosGuardados.push({ name: cleanedFilename, url: publicUrl });
      } else {
        const cleanedFilename = archivo.filename.replace(/[<>]/g, '').trim();
        let directDriveUrl = archivo.body && archivo.body.webViewLink ? archivo.body.webViewLink : null;
        if (!directDriveUrl) directDriveUrl = extraerUrlDrive(emailHtmlBody, emailBody);
        if (!directDriveUrl) directDriveUrl = `https://drive.google.com/drive/search?q=${encodeURIComponent(cleanedFilename)}`;
        archivosGuardados.push({ name: cleanedFilename, url: directDriveUrl });
      }
    }
  } catch (err) {
    console.error(`❌ Error adjuntos:`, err.message);
  }

  if (archivosGuardados.length === 0) {
    archivosGuardados.push({ name: 'Pedido_Correo.jpg', url: extraerUrlDrive(emailHtmlBody, emailBody) || '#' });
  }
  return archivosGuardados;
}

async function extraerDatosOrdenConIA(emailSubject, emailBody, attachmentNames, listaMaterialesValidos, listaPrintTypesValidos) {
  const prompt = `
    Eres el motor de procesamiento inteligente de una imprenta profesional. Analiza el correo e incluye los ítems.
    - Asunto: "${emailSubject}"
    - Cuerpo: "${emailBody}"
    - Adjuntos: ${JSON.stringify(attachmentNames)}
    - Materiales Válidos: ${JSON.stringify(listaMaterialesValidos)}
    - Tipos de Impresión Válidos: ${JSON.stringify(listaPrintTypesValidos)}
  `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          client_name: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                material_name: { type: Type.STRING },
                print_type: { type: Type.STRING },
                width_cm: { type: Type.NUMBER },
                height_cm: { type: Type.NUMBER },
                copies: { type: Type.INTEGER },
                file_name: { type: Type.STRING }
              },
              required: ["material_name", "print_type", "width_cm", "height_cm", "copies", "file_name"]
            }
          }
        },
        required: ["client_name", "items"]
      }
    }
  });
  return JSON.parse(response.text);
}

async function procesarTextoConIA(emailSender, emailBody, emailId, emailSubject, gmailInstance, emailHtmlBody) {
  let filesData = [];
  if (gmailInstance && emailId) filesData = await descargarAdjuntosGmail(gmailInstance, emailId, emailBody, emailHtmlBody);
  if (filesData.length === 0) filesData = [{ name: 'Pedido_Correo.jpg', url: '#' }];

  const resMat = await pool.query('SELECT name FROM materials');
  const resPt = await pool.query('SELECT name FROM print_types');
  const materialesValidos = resMat.rows.map(r => r.name);
  const printTypesValidos = resPt.rows.map(r => r.name);

  const datosExtraidos = await extraerDatosOrdenConIA(emailSubject, emailBody, filesData.map(f => f.name), materialesValidos, printTypesValidos);
  let clientName = datosExtraidos.client_name || emailSender.replace(/<.*>/, '').replace(/"/g, '').trim() || 'Cliente';
  const allUrls = filesData.map(f => f.url).join(',');

  const d = new Date();
  d.setDate(d.getDate() + 3);
  const fechaPrometidaStr = d.toLocaleDateString('es-AR');

  const otResult = await pool.query(`
    INSERT INTO work_orders (client_name, client_email, width_cm, height_cm, copies, total_price, original_files, status, email_id, fecha_prometida)
    VALUES ($1, $2, 0, 0, 0, 0, $3, 'PENDING_DESIGN', $4, $5)
    ON CONFLICT (email_id) DO NOTHING
    RETURNING *;
  `, [clientName, emailSender, allUrls || '#', emailId, fechaPrometidaStr]);

  if (otResult.rows.length === 0) return null;
  const newOT = otResult.rows[0];

  let grandTotalPrice = 0;
  let totalCopiesCount = 0;
  const itemsAI = datosExtraidos.items && datosExtraidos.items.length > 0 ? datosExtraidos.items : [{ material_name: "Vinilo Blanco", print_type: "UV LED", width_cm: 100, height_cm: 50, copies: 1, file_name: filesData[0].name }];

  for (let i = 0; i < itemsAI.length; i++) {
    const item = itemsAI[i];
    let width = parseFloat(item.width_cm || 100);
    let height = parseFloat(item.height_cm || 50);
    let copies = parseInt(item.copies || 1);
    let fileNameReal = item.file_name || filesData[i % filesData.length].name;
    let archivoEncontrado = filesData.find(f => f.name.toLowerCase() === (fileNameReal || '').toLowerCase());
    let fileUrlToSave = archivoEncontrado ? archivoEncontrado.url : (filesData.length > 0 ? filesData[0].url : '#');

    let materialBuscado = item.material_name;
    let tipoImpresionBuscado = item.print_type;

    let priceResult = await pool.query(`
      SELECT pr.price_per_m2, m.id AS material_id, m.is_linear, pt.id AS print_type_id
      FROM pricing_rules pr
      JOIN materials m ON pr.material_id = m.id
      JOIN print_types pt ON pr.print_type_id = pt.id
      WHERE LOWER(m.name) = LOWER($1) AND LOWER(pt.name) = LOWER($2);
    `, [materialBuscado, tipoImpresionBuscado]);

    let price_per_unit = 0, material_id = null, print_type_id = null, is_linear_db = false;

    if (priceResult.rows.length > 0) {
      price_per_unit = parseFloat(priceResult.rows[0].price_per_m2);
      material_id = priceResult.rows[0].material_id;
      print_type_id = priceResult.rows[0].print_type_id;
      is_linear_db = priceResult.rows[0].is_linear;
    } else {
      const fallbackResult = await pool.query(`
        SELECT pr.price_per_m2, m.id AS material_id, m.is_linear, pt.id AS print_type_id
        FROM pricing_rules pr
        JOIN materials m ON pr.material_id = m.id
        JOIN print_types pt ON pr.print_type_id = pt.id
        WHERE LOWER(m.name) = LOWER($1) LIMIT 1;
      `, [materialBuscado]);

      if (fallbackResult.rows.length > 0) {
        price_per_unit = parseFloat(fallbackResult.rows[0].price_per_m2);
        material_id = fallbackResult.rows[0].material_id;
        print_type_id = fallbackResult.rows[0].print_type_id;
        is_linear_db = fallbackResult.rows[0].is_linear;
      } else {
        const defaultMat = await pool.query(`SELECT id, is_linear FROM materials LIMIT 1;`);
        const defaultPt = await pool.query(`SELECT id FROM print_types LIMIT 1;`);
        material_id = defaultMat.rows[0]?.id || 1;
        print_type_id = defaultPt.rows[0]?.id || 1;
        is_linear_db = defaultMat.rows[0]?.is_linear || false;
      }
    }

   let esUnitario = materialBuscado.toLowerCase().includes('fly banner') || 
                 materialBuscado.toLowerCase().includes('portabanner') ||
                 materialBuscado.toLowerCase().includes('cartel c');
if (is_linear_db) width = 100;

    let itemTotalPrice = 0, itemAreaOrMeters = 0;
    if (esUnitario) {
      width = 0; height = 0; itemAreaOrMeters = copies; itemTotalPrice = copies * price_per_unit;
    } else if (is_linear_db) {
      itemAreaOrMeters = (height > 50 ? height / 100 : height) * copies;
      itemTotalPrice = itemAreaOrMeters * price_per_unit;
    } else {
      itemAreaOrMeters = ((width / 100) * (height / 100)) * copies;
      itemTotalPrice = itemAreaOrMeters * price_per_unit;
    }

    grandTotalPrice += itemTotalPrice;
    totalCopiesCount += copies;

    await pool.query(`
      INSERT INTO work_order_items (work_order_id, file_name, material_id, print_type_id, width_cm, height_cm, copies, area_m2, file_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `, [newOT.id, fileNameReal, material_id, print_type_id, width, height, copies, itemAreaOrMeters.toFixed(2), fileUrlToSave]);
  }

  const updateOT = await pool.query(`UPDATE work_orders SET total_price = $1, copies = $2 WHERE id = $3 RETURNING *;`, [grandTotalPrice.toFixed(2), totalCopiesCount, newOT.id]);
  return updateOT.rows[0];
}

async function escanearCorreosGmail() {
  try {
    const gmail = getGmailClient();
    const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });
    const messages = res.data.messages || [];
    if (messages.length === 0) return;

    for (const msg of messages) {
      try {
        await gmail.users.messages.batchModify({ userId: 'me', requestBody: { ids: [msg.id], removeLabelIds: ['UNREAD'] } });
      } catch (e) {}

      const checkEmail = await pool.query('SELECT id FROM work_orders WHERE email_id = $1', [msg.id]);
      if (checkEmail.rows.length > 0) continue;

      const email = await gmail.users.messages.get({ userId: 'me', id: msg.id, format: 'full' });
      const headers = email.data.payload.headers;
      const fromHeader = headers.find(h => h.name === 'From')?.value || 'cliente@gmail.com';
      const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '';

      let bodyText = email.data.snippet || '';
      let bodyHtml = '';
      function extraerTextoYHtml(parts) {
        if (!parts) return;
        for (const p of parts) {
          if (p.mimeType === 'text/plain' && p.body?.data) bodyText = Buffer.from(p.body.data, 'base64').toString('utf-8');
          if (p.mimeType === 'text/html' && p.body?.data) bodyHtml = Buffer.from(p.body.data, 'base64').toString('utf-8');
          if (p.parts) extraerTextoYHtml(p.parts);
        }
      }
      if (email.data.payload.parts) extraerTextoYHtml(email.data.payload.parts);

      await procesarTextoConIA(fromHeader, bodyText, msg.id, subjectHeader, gmail, bodyHtml);
    }
  } catch (err) {
    console.error('❌ Error Gmail:', err);
  }
}

// ==================== ENDPOINTS API ====================

app.get('/api/ordenes/:estado', async (req, res) => {
  const { estado } = req.params;
  let statusFilter = 'PENDING_DESIGN';
  if (estado === 'impresion') statusFilter = 'READY_TO_PRINT';
  if (estado === 'entrega') statusFilter = 'READY_TO_DELIVER';
  if (estado === 'historial') statusFilter = 'DELIVERED';

  try {
    const query = `
      SELECT 
        wo.id AS ot_numero, wo.client_name, wo.client_email, wo.copies, wo.is_urgent,
        COALESCE((
          SELECT SUM(
            CASE 
              WHEN m.name ILIKE '%fly banner%' 
                OR m.name ILIKE '%roll up%' 
                OR m.name ILIKE '%portabanner%' 
                OR m.name ILIKE '%sublimado%' 
                OR m.name ILIKE '%base cruz%' 
                OR m.name ILIKE '%cruz%' 
                OR m.name ILIKE '%contrapeso%' 
                OR m.name ILIKE '%cartel c%'
              THEN woi.copies * COALESCE(woi.unit_price_override, pr.price_per_m2, (SELECT price_per_m2 FROM pricing_rules WHERE material_id = woi.material_id LIMIT 1), 0)
              ELSE woi.area_m2 * COALESCE(woi.unit_price_override, pr.price_per_m2, (SELECT price_per_m2 FROM pricing_rules WHERE material_id = woi.material_id LIMIT 1), 0)
            END
          ) FROM work_order_items woi 
          LEFT JOIN materials m ON woi.material_id = m.id
          LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
          WHERE woi.work_order_id = wo.id
        ), 0) AS total_price,
        wo.status, wo.original_files, wo.created_at, wo.email_id,
        wo.fecha_prometida, wo.entregado_por, wo.fecha_entrega, wo.notes,
        COALESCE(
          json_agg(
            json_build_object(
              'id', woi.id,
              'file_name', woi.file_name,
              'material', m.name,
              'impresion', pt.name,
              'width_cm', woi.width_cm,
              'height_cm', woi.height_cm,
              'copies', woi.copies,
              'file_url', woi.file_url,
              'is_printed', woi.is_printed,
              'is_delivered_item', woi.is_delivered_item,
              'price_per_m2', COALESCE(woi.unit_price_override, pr.price_per_m2, (SELECT price_per_m2 FROM pricing_rules WHERE material_id = woi.material_id LIMIT 1), 0)
            )
          ) FILTER (WHERE woi.id IS NOT NULL), '[]'
        ) AS items
      FROM work_orders wo
      LEFT JOIN work_order_items woi ON wo.id = woi.work_order_id
      LEFT JOIN materials m ON woi.material_id = m.id
      LEFT JOIN print_types pt ON woi.print_type_id = pt.id
      LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
      WHERE UPPER(COALESCE(wo.status, 'PENDING_DESIGN')) = UPPER($1)
      GROUP BY wo.id, wo.client_name, wo.client_email, wo.copies, wo.total_price, wo.status, wo.original_files, wo.created_at, wo.email_id, wo.fecha_prometida, wo.entregado_por, wo.fecha_entrega, wo.notes, wo.is_urgent
      ORDER BY wo.created_at DESC;
    `;
    const result = await pool.query(query, [statusFilter]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en base de datos' });
  }
});

app.put('/api/ordenes/numero/:id', async (req, res) => {
  const { id } = req.params;
  const { nuevo_numero } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`UPDATE work_orders SET id = $1 WHERE id = $2 RETURNING *;`, [nuevo_numero, id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Orden no encontrada' });
    }
    await client.query('COMMIT');
    res.json({ message: 'Número actualizado con éxito', ot: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Endpoint para marcar / desmarcar urgencia
app.put('/api/ordenes/urgencia/:id', async (req, res) => {
  const { id } = req.params;
  const { is_urgent } = req.body;
  try {
    const result = await pool.query(
      `UPDATE work_orders SET is_urgent = $1 WHERE id = $2 RETURNING *;`,
      [is_urgent, id]
    );
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    console.error('Error al actualizar urgencia:', err);
    res.status(500).json({ error: 'Error al actualizar urgencia' });
  }
});

app.put('/api/ordenes/item-url/:id', async (req, res) => {
  const { id } = req.params;
  const { file_url } = req.body;
  try {
    await pool.query(`UPDATE work_order_items SET file_url = $1 WHERE id = $2;`, [file_url, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error al actualizar link:', err);
    res.status(500).json({ error: 'Error al actualizar el link del archivo' });
  }
});

app.put('/api/ordenes/item-nombre/:id', async (req, res) => {
  const { id } = req.params;
  const { file_name } = req.body;
  try {
    await pool.query(`UPDATE work_order_items SET file_name = $1 WHERE id = $2;`, [file_name, id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar nombre' });
  }
});

app.put('/api/ordenes/item/:id', async (req, res) => {
  const { id } = req.params;
  const { width_cm, height_cm, copies } = req.body;
  
  try {
    const itemRes = await pool.query(
      `SELECT woi.*, m.name AS material_name 
       FROM work_order_items woi 
       LEFT JOIN materials m ON woi.material_id = m.id 
       WHERE woi.id = $1;`, 
      [id]
    );

    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    
    const item = itemRes.rows[0];
    const matLower = (item.material_name || '').toLowerCase().trim();

    // Verificación de todos los productos por UNIDAD
    const esUnitario = matLower.includes('fly banner') || 
                       matLower.includes('roll up') || 
                       matLower.includes('portabanner') || 
                       matLower.includes('sublimado') ||
                       matLower.includes('base cruz') ||
                       matLower.includes('cruz') ||
                       matLower.includes('contrapeso') ||
                       matLower.includes('cartel c');

    const cantCopias = parseInt(copies || 1);
    const anchoNum = parseFloat(width_cm || 0);
    const altoNum = parseFloat(height_cm || 0);

    let area_m2 = esUnitario ? cantCopias : ((anchoNum / 100) * (altoNum / 100)) * cantCopias;

    await pool.query(
      `UPDATE work_order_items 
       SET width_cm = $1, height_cm = $2, copies = $3, area_m2 = $4 
       WHERE id = $5;`, 
      [esUnitario ? 0 : anchoNum, esUnitario ? 0 : altoNum, cantCopias, area_m2.toFixed(2), id]
    );

    const allItems = await pool.query(`
      SELECT woi.*, 
             COALESCE(woi.unit_price_override, pr.price_per_m2, 0) AS price_per_m2, 
             m.name AS material_name 
      FROM work_order_items woi
      LEFT JOIN materials m ON woi.material_id = m.id
      LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
      WHERE woi.work_order_id = $1;
    `, [item.work_order_id]);

    let grandTotal = 0;
    allItems.rows.forEach(it => {
      const pM2 = parseFloat(it.price_per_m2 || 0);
      const itMatLower = (it.material_name || '').toLowerCase().trim();

      const isU = itMatLower.includes('fly banner') || 
                  itMatLower.includes('roll up') || 
                  itMatLower.includes('portabanner') || 
                  itMatLower.includes('sublimado') ||
                  itMatLower.includes('base cruz') ||
                  itMatLower.includes('cruz') ||
                  itMatLower.includes('contrapeso') ||
                  itMatLower.includes('cartel c');

      grandTotal += isU ? (parseInt(it.copies || 1) * pM2) : (parseFloat(it.area_m2 || 0) * pM2);
    });

    await pool.query(`UPDATE work_orders SET total_price = $1 WHERE id = $2;`, [grandTotal.toFixed(2), item.work_order_id]);
    
    res.json({ message: 'Actualizado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/ordenes/item/printed/:id', async (req, res) => {
  const { id } = req.params;
  const { is_printed } = req.body;
  try {
    const result = await pool.query(`UPDATE work_order_items SET is_printed = $1 WHERE id = $2 RETURNING *;`, [is_printed, id]);
    res.json({ success: true, item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar' });
  }
});

app.put('/api/ordenes/item/delivered/:id', async (req, res) => {
  const { id } = req.params;
  const { is_delivered_item } = req.body;
  try {
    const result = await pool.query(`UPDATE work_order_items SET is_delivered_item = $1 WHERE id = $2 RETURNING *;`, [is_delivered_item, id]);
    res.json({ success: true, item: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar ítem' });
  }
});

// Guardar o resetear precio personalizado por ítem
app.put('/api/ordenes/item-precio/:id', async (req, res) => {
  const { id } = req.params;
  const { unit_price_override } = req.body;

  try {
    const overrideVal = (unit_price_override !== null && unit_price_override !== '' && !isNaN(unit_price_override)) 
      ? parseFloat(unit_price_override) 
      : null;

    await pool.query(`UPDATE work_order_items SET unit_price_override = $1 WHERE id = $2;`, [overrideVal, id]);

    const itemRes = await pool.query(`SELECT work_order_id FROM work_order_items WHERE id = $1;`, [id]);
    if (itemRes.rows.length > 0) {
      const work_order_id = itemRes.rows[0].work_order_id;
      
      const allItems = await pool.query(`
        SELECT woi.*, 
               COALESCE(woi.unit_price_override, pr.price_per_m2, 0) AS final_unit_price, 
               m.name AS material_name 
        FROM work_order_items woi
        LEFT JOIN materials m ON woi.material_id = m.id
        LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
        WHERE woi.work_order_id = $1;
      `, [work_order_id]);

      let grandTotal = 0;
      allItems.rows.forEach(it => {
        const pM2 = parseFloat(it.final_unit_price || 0);
        const matLower = (it.material_name || '').toLowerCase().trim();
        const copies = parseInt(it.copies || 1);

        // Verificação abrangente de todos os produtos por UNIDADE
        const isU = matLower.includes('fly banner') || 
                    matLower.includes('roll up') || 
                    matLower.includes('portabanner') || 
                    matLower.includes('sublimado') ||
                    matLower.includes('base cruz') ||
                    matLower.includes('cruz') ||
                    matLower.includes('contrapeso') ||
                    matLower.includes('cartel c');

        if (isU) {
          // Cobrança estritamente por unidade
          grandTotal += copies * pM2;
        } else {
          // Cobrança por m²
          const ancho = parseFloat(it.width_cm || 0) / 100;
          const alto = parseFloat(it.height_cm || 0) / 100;
          const area = (ancho * alto) || parseFloat(it.area_m2 || 0);
          
          grandTotal += area * pM2 * copies;
        }
      });

      await pool.query(`UPDATE work_orders SET total_price = $1 WHERE id = $2;`, [grandTotal.toFixed(2), work_order_id]);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error al actualizar precio unitario:', err);
    res.status(500).json({ error: 'Error al actualizar el precio en la base de datos' });
  }
});

app.put('/api/ordenes/entrega-info/:id', async (req, res) => {
  const { id } = req.params;
  const { fecha_prometida, entregado_por, fecha_entrega } = req.body;
  try {
    const result = await pool.query(`
      UPDATE work_orders 
      SET fecha_prometida = COALESCE($1, fecha_prometida),
          entregado_por = COALESCE($2, entregado_por),
          fecha_entrega = COALESCE($3, fecha_entrega)
      WHERE id = $4 RETURNING *;
    `, [fecha_prometida, entregado_por, fecha_entrega, id]);
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar info de entrega' });
  }
});

app.delete('/api/ordenes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM work_order_items WHERE work_order_id = $1;`, [id]);
    await pool.query(`DELETE FROM work_orders WHERE id = $1;`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

app.delete('/api/ordenes/item/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const itemRes = await pool.query(`SELECT work_order_id FROM work_order_items WHERE id = $1;`, [id]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    await pool.query(`DELETE FROM work_order_items WHERE id = $1;`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Error al eliminar' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0 || result.rows[0].password !== password) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    res.json({ success: true, username: result.rows[0].username, role: result.rows[0].role });
  } catch (err) {
    res.status(500).json({ error: 'Error en servidor' });
  }
});

app.post('/api/orders/manual', async (req, res) => {
  try {
    const { clientName, clientEmail, notes } = req.body;

    const d = new Date();
    d.setDate(d.getDate() + 3);
    const fechaPrometidaStr = d.toLocaleDateString('es-AR');

    const newOrder = await pool.query(`
      INSERT INTO work_orders (client_name, client_email, status, original_files, total_price, fecha_prometida, notes, created_at)
      VALUES ($1, $2, 'PENDING_DESIGN', '#', 0.00, $3, $4, NOW())
      RETURNING *
    `, [clientName || 'Cliente Mostrador', clientEmail || '', fechaPrometidaStr, notes || '']);

    res.json({ success: true, order: newOrder.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ordenes/:id/item', async (req, res) => {
  const { id } = req.params;
  const { file_name, material_id, print_type_id, width_cm, height_cm, copies, file_url } = req.body;
  try {
    const matRes = await pool.query(`SELECT name, is_linear FROM materials WHERE id = $1;`, [material_id]);
    const mat = matRes.rows[0];
    const esUnitario = mat.name.toLowerCase().includes('fly banner');
    let area_m2 = esUnitario ? copies : ((width_cm / 100) * (height_cm / 100)) * copies;

    await pool.query(`
      INSERT INTO work_order_items (work_order_id, file_name, material_id, print_type_id, width_cm, height_cm, copies, area_m2, file_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `, [id, file_name || 'Item.jpg', material_id, print_type_id, width_cm, height_cm, copies, area_m2.toFixed(2), file_url || '#']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/ordenes/estado/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = await pool.query(`UPDATE work_orders SET status = $1 WHERE id = $2 RETURNING *;`, [status, id]);
    res.json({ message: 'Estado actualizado', ot: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error' });
  }
});

app.get('/api/catalogos', async (req, res) => {
  const materials = await pool.query('SELECT id, name FROM materials ORDER BY name;');
  const printTypes = await pool.query('SELECT id, name FROM print_types ORDER BY name;');
  res.json({ materials: materials.rows, printTypes: printTypes.rows });
});

app.put('/api/ordenes/cliente/:id', async (req, res) => {
  const { id } = req.params;
  const { client_name } = req.body;
  await pool.query(`UPDATE work_orders SET client_name = $1 WHERE id = $2;`, [client_name, id]);
  res.json({ success: true });
});

// Comprobante de Orden de Trabajo (PDF/HTML)
app.get('/ot/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const otRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1;`, [id]);
    if (otRes.rows.length === 0) return res.status(404).send('Orden de trabajo no encontrada');

    const ot = otRes.rows[0];
    const fechaEmision = new Date(ot.created_at).toLocaleDateString('es-AR');

    let fechaEntregaMostrar = ot.fecha_prometida;
    if (!fechaEntregaMostrar) {
      const d = new Date(ot.created_at);
      d.setDate(d.getDate() + 3);
      fechaEntregaMostrar = d.toLocaleDateString('es-AR');
    }

    const itemsRes = await pool.query(`
      SELECT 
        woi.*, 
        COALESCE(m.name, 'Material General') AS material_name, 
        COALESCE(pt.name, 'Estándar') AS print_type_name,
        COALESCE(woi.unit_price_override, pr.price_per_m2, (SELECT price_per_m2 FROM pricing_rules WHERE material_id = woi.material_id LIMIT 1), 0) AS price_per_m2,
        (woi.unit_price_override IS NOT NULL) AS es_precio_manual
      FROM work_order_items woi
      LEFT JOIN materials m ON woi.material_id = m.id
      LEFT JOIN print_types pt ON woi.print_type_id = pt.id
      LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
      WHERE woi.work_order_id = $1;
    `, [id]);

    const items = itemsRes.rows;

    const grupos = {};
    items.forEach(item => {
      const key = `${item.material_name.toUpperCase()} ${item.print_type_name.toUpperCase()}`;
      if (!grupos[key]) {
        grupos[key] = {
          nombre: key,
          price_per_m2: parseFloat(item.price_per_m2 || 0),
          archivos: [],
          total_m2: 0,
          esUnitarioFijo: false
        };
      }

      const matLower = item.material_name.toLowerCase();
  const esUnitario = matLower.includes('fly banner') || 
                     matLower.includes('sublimado') || 
                     matLower.includes('base cruz') || 
                     matLower.includes('contrapeso') ||
                     matLower.includes('portabanner') ||
                     matLower.includes('cartel c');
                     
      
      grupos[key].esUnitarioFijo = esUnitario;

      let subM2 = 0;
      let anchoVisual = 0;
      let altoVisual = 0;

      const wDb = parseFloat(item.width_cm || 0);
      const hDb = parseFloat(item.height_cm || 0);

      if (esUnitario) {
        subM2 = item.copies;
        anchoVisual = 1;
        altoVisual = 1;
      } else {
        anchoVisual = wDb / 100;
        altoVisual = hDb / 100;
        subM2 = anchoVisual * altoVisual * item.copies;
      }

      grupos[key].archivos.push({
        nombre: item.file_name.replace(/[<>]/g, '').trim(),
        anchoM: esUnitario ? '-' : anchoVisual.toFixed(2),
        altoM: esUnitario ? '-' : altoVisual.toFixed(2),
        copies: item.copies,
        m2: esUnitario ? item.copies : subM2.toFixed(2)
      });
      grupos[key].total_m2 += esUnitario ? 0 : subM2;
    });

    const otFormateada = `OT ${String(ot.id).padStart(2, '0')}`;

    let filasHTML = '';
    let totalGeneral = 0;

    Object.values(grupos).forEach(grupo => {
      let subtotalGrupoPrice = 0;
      let totalUnidadesGrupo = 0;

      if (grupo.esUnitarioFijo) {
        grupo.archivos.forEach(f => totalUnidadesGrupo += f.copies);
        subtotalGrupoPrice = totalUnidadesGrupo * grupo.price_per_m2;
      } else {
        subtotalGrupoPrice = grupo.total_m2 * grupo.price_per_m2;
      }

      totalGeneral += subtotalGrupoPrice;

      filasHTML += `
        <tr style="font-weight: bold; background-color: #f8fafc;">
          <td colspan="4" style="text-align: left; font-size: 13px;">${grupo.nombre}</td>
          <td class="text-right">${grupo.esUnitarioFijo ? totalUnidadesGrupo : grupo.total_m2.toFixed(2)}</td>
          <td class="text-right">$${grupo.price_per_m2.toLocaleString('es-AR')}</td>
          <td class="text-right">$${subtotalGrupoPrice.toLocaleString('es-AR')}</td>
        </tr>
      `;

      grupo.archivos.forEach((file, index) => {
        filasHTML += `
          <tr>
            <td style="padding-left: 20px; font-size: 11px;">Archivo ${index + 1}: &nbsp;&nbsp; ${file.nombre}</td>
            <td class="text-center">${file.anchoM}</td>
            <td class="text-center">${file.altoM}</td>
            <td class="text-center">${file.copies}</td>
            <td class="text-center">${file.m2}</td>
            <td class="text-center">-</td>
            <td class="text-center">-</td>
          </tr>
        `;
      });
    });

    const html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Orden de Trabajo ${otFormateada}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 15px; color: #000; background-color: #fff; }
        .ot-container { width: 850px; margin: auto; border: 2px solid #000; padding: 8px; box-sizing: border-box; }
        table { width: 100%; border-collapse: collapse; }
        td, th { border: 1px solid #000; padding: 4px 6px; font-size: 11px; vertical-align: middle; }
        
        .header-top td { border: 1px solid #000; padding: 6px; }
        .title { font-size: 18px; font-weight: bold; text-align: center; letter-spacing: 1px; }
        
        .main-table th { background-color: #5b3693; color: white; font-weight: bold; text-align: center; font-size: 11px; padding: 6px; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .text-left { text-align: left; }
        
        .pago-table { width: 280px; border-collapse: collapse; float: right; margin-top: 5px; }
        .pago-table td { border: 1px solid #000; text-align: center; font-size: 10px; padding: 4px; }
        
        @media print {
          .no-print { display: none; }
          body { margin: 0; }
          .ot-container { border: none; width: 100%; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 15px; text-align: center;">
        <button onclick="window.print()" style="padding: 10px 20px; font-weight: bold; cursor: pointer; background: #5b3693; color: #fff; border: none; border-radius: 4px;">🖨️ Imprimir / Guardar PDF</button>
      </div>

      <div class="ot-container">
        <table class="header-top">
          <tr>
            <td width="30%" class="text-center" style="padding: 4px;">
              <img src="/Imagenes/logo2.png" alt="Go Print" style="max-height: 60px; width: auto; display: block; margin: auto;">
            </td>
            <td width="48%" class="title">ORDEN DE TRABAJO</td>
            <td width="22%" class="text-center" style="font-weight: bold; font-size: 10px;">
              Nº de ORDEN <br>
              <span style="font-size: 14px;">OT ${String(ot.id).padStart(4, '0')}</span>
            </td>
          </tr>
        </table>

        <table style="margin-top: 4px;">
          <tr>
            <td width="50%" style="font-weight: bold; font-size: 12px; background: #f0f0f0;">CLIENTE: ${ot.client_name.toUpperCase()}</td>
            <td width="25%" class="text-center" style="font-size: 11px;">${fechaEmision}</td>
            <td width="25%" class="text-center" style="font-size: 11px;">Fecha Entrega: ${fechaEntregaMostrar}</td>
          </tr>
        </table>

        <table class="main-table" style="margin-top: 4px;">
          <thead>
            <tr>
              <th width="42%">DETALLE</th>
              <th width="8%">ANCHO</th>
              <th width="8%">LARGO</th>
              <th width="7%">CANT.</th>
              <th width="10%">TOTAL M2</th>
              <th width="12%">PRECIO UNIT.</th>
              <th width="13%">PRECIO TOTAL</th>
            </tr>
          </thead>
          <tbody>
            ${filasHTML}
            ${Array(Math.max(0, 12 - items.length)).fill('<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td>-</td><td>-</td></tr>').join('')}
            
            <tr style="background-color: #f9f9f9;">
              <td colspan="6" class="text-right" style="font-weight: bold; font-size: 12px;">TOTAL ARS:</td>
              <td class="text-right" style="font-weight: bold; font-size: 13px;">$${totalGeneral.toLocaleString('es-AR')}</td>
            </tr>
          </tbody>
        </table>

        <table style="margin-top: 4px; border-collapse: collapse;">
          <tr>
            <td style="height: 55px; vertical-align: top; font-size: 10px; font-weight: bold; position: relative;">
              CONFORMIDAD
              <div style="position: absolute; bottom: 5px; left: 6px; font-size: 10px; font-weight: bold;">
                FIRMA Y ACLARACIÓN: _________________________________________
              </div>
            </td>
            <td width="300" style="vertical-align: top; padding: 0; border: none;">
              <table class="pago-table" style="margin: 0; width: 100%;">
                <tr style="background-color: #e2e8f0; font-weight: bold;">
                  <td colspan="3">PAGO</td>
                </tr>
                <tr>
                  <td width="33%">EFECTIVO</td>
                  <td width="33%">BANCO</td>
                  <td width="33%">CHEQUE</td>
                </tr>
                <tr style="height: 25px;">
                  <td></td><td></td><td></td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>
    </body>
    </html>
    `;

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al generar comprobante');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor activo en http://localhost:${PORT}`);
  setInterval(escanearCorreosGmail, 15000);
});
