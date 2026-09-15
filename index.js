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

// Inicialización automática de tablas (sin sobrescribir tus datos reales ni meter precios falsos)
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
        file_url TEXT
      );
    `);

    // Crear usuario admin por defecto si no existe
    const adminCheck = await pool.query('SELECT * FROM users WHERE username = $1', ['admin']);
    if (adminCheck.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (username, password, role) VALUES ($1, $2, $3)',
        ['admin', 'admin123', 'admin']
      );
      console.log('👤 Usuario administrador creado por defecto (admin / admin123).');
    }

    console.log('✅ Base de datos verificada y conectada correctamente con catálogos SQL.');
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
    const mensajeCompleto = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const payload = mensajeCompleto.data.payload;
    let partesConAdjunto = [];

    function buscarPartes(parts) {
      if (!parts) return;
      for (const part of parts) {
        if (part.filename && part.filename.length > 0) {
          partesConAdjunto.push({
            filename: part.filename,
            attachmentId: part.body && part.body.attachmentId,
            body: part.body
          });
        }
        if (part.parts && Array.isArray(part.parts)) {
          buscarPartes(part.parts);
        }
      }
    }

    if (payload.parts) {
      buscarPartes(payload.parts);
    } else if (payload.filename && payload.body) {
      partesConAdjunto.push({
        filename: payload.filename,
        attachmentId: payload.body.attachmentId,
        body: payload.body
      });
    }

    for (const archivo of partesConAdjunto) {
      let fileData = null;
      if (archivo.attachmentId) {
        try {
          const attach = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: archivo.attachmentId,
          });
          fileData = Buffer.from(attach.data.data, 'base64url');
        } catch (e) {
          // No es binario directo
        }
      }

      if (fileData && fileData.length > 0) {
        const cleanedFilename = archivo.filename.replace(/[<>]/g, '').trim();
        const safeFilename = `${Date.now()}_${cleanedFilename.replace(/\s+/g, '_')}`;
        const filePath = path.join(ADJUNTOS_DIR, safeFilename);

        fs.writeFileSync(filePath, fileData);
        
        // CORRECCIÓN AQUÍ: Usamos RENDER_EXTERNAL_URL en la nube o localhost en local
        const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
        const publicUrl = `${baseUrl}/adjuntos/${encodeURIComponent(safeFilename)}`;
        
        archivosGuardados.push({ name: cleanedFilename, url: publicUrl });
      } else {
        const cleanedFilename = archivo.filename.replace(/[<>]/g, '').trim();
        let directDriveUrl = null;

        if (archivo.body && archivo.body.webViewLink) {
          directDriveUrl = archivo.body.webViewLink;
        }

        if (!directDriveUrl && emailHtmlBody) {
          const regexEscapes = cleanedFilename.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          const matchContexto = emailHtmlBody.match(new RegExp(`href="(https://(?:drive|docs)\\.google\\.com/[^"]+)"[^>]*>[^<]*${regexEscapes}`, 'i')) ||
                                emailHtmlBody.match(new RegExp(`${regexEscapes}[^<]*</a>.*?href="(https://(?:drive|docs)\\.google\\.com/[^"]+)"`, 's_i'));
          if (matchContexto) directDriveUrl = matchContexto[1];
        }

        if (!directDriveUrl) {
          directDriveUrl = extraerUrlDrive(emailHtmlBody, emailBody);
        }

        if (!directDriveUrl) {
          directDriveUrl = `https://drive.google.com/drive/search?q=${encodeURIComponent(cleanedFilename)}`;
        }

        archivosGuardados.push({ name: cleanedFilename, url: directDriveUrl });
      }
    }

    if (emailHtmlBody) {
      const allDriveLinks = emailHtmlBody.matchAll(/href="(https:\/\/(?:drive|docs)\.google\.com\/[^"]+)"/gi);
      for (const linkMatch of allDriveLinks) {
        const urlEncontrada = linkMatch[1];
        if (!archivosGuardados.some(f => f.url === urlEncontrada)) {
          archivosGuardados.push({ name: `Archivo_Drive_${archivosGuardados.length + 1}.jpg`, url: urlEncontrada });
        }
      }
    }

  } catch (err) {
    console.error(`❌ Error general obteniendo adjuntos del correo ${messageId}:`, err.message);
  }

  if (archivosGuardados.length === 0) {
    let fallbackUrl = extraerUrlDrive(emailHtmlBody, emailBody) || '#';
    archivosGuardados.push({ name: 'Pedido_Correo.jpg', url: fallbackUrl });
  }

  return archivosGuardados;
}

async function extraerDatosOrdenConIA(emailSubject, emailBody, attachmentNames, listaMaterialesValidos, listaPrintTypesValidos) {
  const prompt = `
    Eres el motor de procesamiento inteligente de una imprenta profesional. Tu trabajo es analizar la información completa de un correo electrónico y extraer los ítems solicitados.

    INFORMACIÓN DEL CORREO:
    - Asunto: "${emailSubject}"
    - Cuerpo del mensaje: "${emailBody}"
    - Nombres de archivos adjuntos / enlaces detectados: ${JSON.stringify(attachmentNames)}

    LISTA OFICIAL DE MATERIALES PERMITIDOS EN BASE DE DATOS:
    ${JSON.stringify(listaMaterialesValidos)}

    LISTA OFICIAL DE TIPOS DE IMPRESIÓN PERMITIDOS EN BASE DE DATOS:
    ${JSON.stringify(listaPrintTypesValidos)}

    INSTRUCCIONES CLAVE:
    1. Extrae el nombre del cliente. Si no se encuentra, usa "Cliente".
    2. Identifica cada ítem o archivo a imprimir. Si hay varios archivos, ítems o menciones en el texto/adjuntos, genera un objeto por cada uno en el array.
    3. Mapea el material al nombre exacto o más cercano de la "LISTA OFICIAL DE MATERIALES".
    4. MAPEO DE TIPO DE IMPRESIÓN (REGLA ECONÓMICA): Si el cliente NO especifica explícitamente un tipo de impresión, DEBES usar por defecto la opción más económica: "HD Eco-solvente" (o HD). Nunca asumas UV LED a menos que el cliente lo pida expresamente o sea un producto exclusivo de esa tecnología.
    5. Extrae las medidas exactas en CENTÍMETROS (width_cm, height_cm). Si vienen en metros, conviértelas multiplicando por 100. Si no hay medidas, usa por defecto ancho 100 y alto 50.
    6. Extrae la cantidad de copias (por defecto 1 si no se indica).
    7. Asocia cada ítem con su nombre de archivo correspondiente de la lista proporcionada.
    8. REGLA PARA FLY BANNERS / PORTABANNERS: Si el material es un "Fly Banner" o "Portabanner", el tipo de impresión por defecto DEBE ser "UV LED" y las medidas (width_cm y height_cm) deben ser 0 ya que se venden por unidad.
    9. REGLA PARA CALCOS Y PRE-CORTES: Si el mensaje menciona "pre corte", "calcos con corte" o "troquel", mapea a troquelado de medio corte estándar.
    10. REGLA PARA BANNERS / LONAS CON BOLSILLOS: Si el texto indica que el banner o lona incluye "bolsillos", DEBES generar DOS ítems separados en el array con exactamente las mismas medidas y copias (la lona correspondiente y la "Terminación Bolsillos").
    11. REGLA PARA ARCHIVOS DUPLICADOS EN DIFERENTES FORMATOS: Si el cliente adjunta el mismo diseño en varios formatos (ej. un .cdr y un .jpg con nombres similares), NO son trabajos distintos. AGRÚPALO EN UN SOLO OBJETO priorizando el archivo vectorial (.cdr).
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
  if (gmailInstance && emailId) {
    filesData = await descargarAdjuntosGmail(gmailInstance, emailId, emailBody, emailHtmlBody);
  }

  if (filesData.length === 0) {
    let fallbackUrl = extraerUrlDrive(emailHtmlBody, emailBody) || '#';
    filesData = [{ name: 'Pedido_Correo.jpg', url: fallbackUrl }];
  }

  const resMat = await pool.query('SELECT name FROM materials');
  const resPt = await pool.query('SELECT name FROM print_types');
  const materialesValidos = resMat.rows.map(r => r.name);
  const printTypesValidos = resPt.rows.map(r => r.name);

  const attachmentNames = filesData.map(f => f.name);
  const datosExtraidos = await extraerDatosOrdenConIA(
    emailSubject,
    emailBody,
    attachmentNames,
    materialesValidos,
    printTypesValidos
  );

  if (datosExtraidos.items) {
    datosExtraidos.items.forEach(it => {
      const matL = (it.material_name || '').toLowerCase();
      if (matL.includes('fly banner') || matL.includes('portabanner')) {
        it.copies = 1; 
        it.width_cm = 0;
        it.height_cm = 0;
      }
    });
  }

  let clientName = datosExtraidos.client_name || emailSender.replace(/<.*>/, '').replace(/"/g, '').trim() || 'Cliente';
  const allUrls = filesData.map(f => f.url).join(',');

  const insertOTQuery = `
    INSERT INTO work_orders (client_name, client_email, width_cm, height_cm, copies, total_price, original_files, status, email_id)
    VALUES ($1, $2, 0, 0, 0, 0, $3, 'PENDING_DESIGN', $4)
    ON CONFLICT (email_id) DO NOTHING
    RETURNING *;
  `;
  const otResult = await pool.query(insertOTQuery, [clientName, emailSender, allUrls || '#', emailId]);

  if (otResult.rows.length === 0) {
    console.log(`⏩ El correo ID ${emailId} ya fue insertado previamente.`);
    return null;
  }
  const newOT = otResult.rows[0];

  let grandTotalPrice = 0;
  let totalCopiesCount = 0;

  const itemsAI = datosExtraidos.items && datosExtraidos.items.length > 0 ? datosExtraidos.items : [{
    material_name: "Vinilo Blanco",
    print_type: "UV LED",
    width_cm: 100,
    height_cm: 50,
    copies: 1,
    file_name: filesData[0].name
  }];

  for (let i = 0; i < itemsAI.length; i++) {
    const item = itemsAI[i];
    let width = parseFloat(item.width_cm || 100);
    let height = parseFloat(item.height_cm || 50);
    let copies = parseInt(item.copies || 1);
    let fileNameReal = item.file_name || filesData[i % filesData.length].name;
    
    let archivoEncontrado = filesData.find(f => f.name.toLowerCase() === (fileNameReal || '').toLowerCase());
    let fileUrlToSave = '#';
    if (archivoEncontrado) {
      fileUrlToSave = archivoEncontrado.url;
    } else {
      fileUrlToSave = filesData.length > 0 ? filesData[0].url : `https://drive.google.com/drive/search?q=${encodeURIComponent(fileNameReal)}`;
    }

    let materialBuscado = item.material_name;
    let tipoImpresionBuscado = item.print_type;

    if (materialBuscado.toLowerCase().includes('lona') && width > 160 && height > 160) {
      tipoImpresionBuscado = "UVLED GIGA";
    }

    let price_per_unit = 0;
    let material_id = null;
    let print_type_id = null;
    let is_linear_db = false;

    const queryPrecioEstricto = `
      SELECT pr.price_per_m2, m.id AS material_id, m.is_linear, pt.id AS print_type_id
      FROM pricing_rules pr
      JOIN materials m ON pr.material_id = m.id
      JOIN print_types pt ON pr.print_type_id = pt.id
      WHERE LOWER(m.name) = LOWER($1) AND LOWER(pt.name) = LOWER($2);
    `;

    let priceResult = await pool.query(queryPrecioEstricto, [materialBuscado, tipoImpresionBuscado]);

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
        console.warn(`⚠️ No se encontró regla de precio exacta para material: "${materialBuscado}" con tipo: "${tipoImpresionBuscado}".`);
        const defaultMat = await pool.query(`SELECT id, is_linear FROM materials LIMIT 1;`);
        const defaultPt = await pool.query(`SELECT id FROM print_types LIMIT 1;`);
        material_id = defaultMat.rows[0]?.id || 1;
        print_type_id = defaultPt.rows[0]?.id || 1;
        is_linear_db = defaultMat.rows[0]?.is_linear || false;
        price_per_unit = 0; // Sin fallback falso de 11000
      }
    }

    const matLower = materialBuscado.toLowerCase();
    const esUnitario = matLower.includes('fly banner') || 
                       matLower.includes('sublimado') || 
                       matLower.includes('base cruz') || 
                       matLower.includes('contrapeso') ||
                       matLower.includes('portabanner');

    let esMaterialLineal = is_linear_db;
    if (esMaterialLineal) {
      width = 100;
    }

    let itemTotalPrice = 0;
    let itemAreaOrMeters = 0;

    if (esUnitario) {
      width = 0;
      height = 0;
      itemAreaOrMeters = copies; 
      itemTotalPrice = copies * price_per_unit;
    } else if (esMaterialLineal) {
      const metrosLineales = height > 50 ? (height / 100) : height; 
      itemAreaOrMeters = metrosLineales * copies;
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

  const updateOT = await pool.query(`
    UPDATE work_orders SET total_price = $1, copies = $2 WHERE id = $3 RETURNING *;
  `, [grandTotalPrice.toFixed(2), totalCopiesCount, newOT.id]);

  return updateOT.rows[0];
}

async function escanearCorreosGmail() {
  try {
    const gmail = getGmailClient();
    console.log("🔍 Consultando Gmail en busca de correos no leídos...");
    const res = await gmail.users.messages.list({ userId: 'me', q: 'is:unread' });

    const messages = res.data.messages || [];
    if (messages.length === 0) return;

    console.log(`\n📬 Se encontraron ${messages.length} correos nuevos sin leer.`);

    for (const msg of messages) {
      try {
        await gmail.users.messages.batchModify({
          userId: 'me',
          requestBody: { ids: [msg.id], removeLabelIds: ['UNREAD'] }
        });
      } catch (e) {
        console.warn(`⚠️ No se pudo quitar la etiqueta unread del mensaje ${msg.id}`);
      }

      const checkEmail = await pool.query('SELECT id FROM work_orders WHERE email_id = $1', [msg.id]);
      if (checkEmail.rows.length > 0) {
        console.log(`⏩ El correo ID ${msg.id} ya fue procesado anteriormente.`);
        continue;
      }

      console.log(`📥 Descargando contenido del mensaje ID: ${msg.id}...`);
      const email = await gmail.users.messages.get({ 
        userId: 'me', 
        id: msg.id,
        format: 'full' 
      });
      const headers = email.data.payload.headers;
      
      const fromHeader = headers.find(h => h.name === 'From')?.value || 'cliente@gmail.com';
      const subjectHeader = headers.find(h => h.name === 'Subject')?.value || '';
      console.log(`✉️ Asunto detectado: "${subjectHeader}" de: ${fromHeader}`);

      let bodyText = email.data.snippet || '';
      let bodyHtml = '';

      function extraerTextoYHtml(parts) {
        if (!parts) return;
        for (const p of parts) {
          if (p.mimeType === 'text/plain' && p.body && p.body.data) {
            bodyText = Buffer.from(p.body.data, 'base64').toString('utf-8');
          }
          if (p.mimeType === 'text/html' && p.body && p.body.data) {
            bodyHtml = Buffer.from(p.body.data, 'base64').toString('utf-8');
          }
          if (p.parts) extraerTextoYHtml(p.parts);
        }
      }
      if (email.data.payload.parts) {
        extraerTextoYHtml(email.data.payload.parts);
      } else if (email.data.payload.body && email.data.payload.body.data) {
        bodyHtml = Buffer.from(email.data.payload.body.data, 'base64').toString('utf-8');
      }

      console.log(`⚙️ Procesando contenido y llamando a la IA...`);
      
      try {
        const nuevaOT = await procesarTextoConIA(fromHeader, bodyText, msg.id, subjectHeader, gmail, bodyHtml);
        
        if (nuevaOT) {
          console.log(`✅ Orden de Trabajo #${nuevaOT.id} creada automáticamente.`);
        }
      } catch (err) {
        console.error(`❌ Error crítico al procesar el correo ${msg.id}:`, err);
      }
    }
  } catch (err) {
    console.error('❌ Error general al conectar con la API de Gmail:', err);
  }
}

app.get('/api/ordenes/:estado', async (req, res) => {
  const { estado } = req.params;
  
  let statusFilter = 'PENDING_DESIGN';
  if (estado === 'impresion') statusFilter = 'READY_TO_PRINT';
  if (estado === 'entrega') statusFilter = 'READY_TO_DELIVER';
  if (estado === 'historial') statusFilter = 'DELIVERED';

  try {
    const query = `
      SELECT 
        wo.id AS ot_numero, 
        wo.client_name, 
        wo.client_email,
        wo.copies, 
        wo.total_price,
        wo.status, 
        wo.original_files, 
        wo.created_at,
        wo.email_id,
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
              'file_url', woi.file_url
            )
          ) FILTER (WHERE woi.id IS NOT NULL), '[]'
        ) AS items
      FROM work_orders wo
      LEFT JOIN work_order_items woi ON wo.id = woi.work_order_id
      LEFT JOIN materials m ON woi.material_id = m.id
      LEFT JOIN print_types pt ON woi.print_type_id = pt.id
      WHERE UPPER(COALESCE(wo.status, 'PENDING_DESIGN')) = UPPER($1)
      GROUP BY wo.id
      ORDER BY wo.created_at DESC;
    `;
    const result = await pool.query(query, [statusFilter]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error al consultar base de datos:', err);
    res.status(500).json({ error: 'Error en base de datos' });
  }
});

app.put('/api/ordenes/item-nombre/:id', async (req, res) => {
  const { id } = req.params;
  const { file_name } = req.body;
  try {
    await pool.query(`UPDATE work_order_items SET file_name = $1 WHERE id = $2;`, [file_name, id]);
    res.json({ message: 'Nombre de archivo actualizado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el nombre del archivo' });
  }
});

app.put('/api/ordenes/item/:id', async (req, res) => {
  const { id } = req.params;
  const { width_cm, height_cm, copies } = req.body;

  try {
    const itemRes = await pool.query(`
      SELECT woi.*, m.name AS material_name 
      FROM work_order_items woi
      LEFT JOIN materials m ON woi.material_id = m.id
      WHERE woi.id = $1;
    `, [id]);
    
    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Ítem no encontrado' });

    const item = itemRes.rows[0];
    const matLower = (item.material_name || '').toLowerCase();
    const esUnitario = matLower.includes('fly banner') || 
                       matLower.includes('sublimado') || 
                       matLower.includes('base cruz') || 
                       matLower.includes('contrapeso') ||
                       matLower.includes('portabanner');

    let area_m2 = 0;
    if (esUnitario) {
      area_m2 = copies; 
    } else {
      area_m2 = ((width_cm / 100) * (height_cm / 100)) * copies;
    }

    await pool.query(`
      UPDATE work_order_items 
      SET width_cm = $1, height_cm = $2, copies = $3, area_m2 = $4
      WHERE id = $5;
    `, [esUnitario ? 0 : width_cm, esUnitario ? 0 : height_cm, copies, area_m2.toFixed(2), id]);

    const allItems = await pool.query(`
      SELECT woi.*, pr.price_per_m2, m.name AS material_name 
      FROM work_order_items woi
      LEFT JOIN materials m ON woi.material_id = m.id
      LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
      WHERE woi.work_order_id = $1;
    `, [item.work_order_id]);

    let grandTotal = 0;
    allItems.rows.forEach(it => {
      const pM2 = parseFloat(it.price_per_m2 || 0);
      const mName = (it.material_name || '').toLowerCase();
      const esItemUnitario = mName.includes('fly banner') || mName.includes('sublimado') || mName.includes('portabanner');
      
      if (esItemUnitario) {
        grandTotal += it.copies * pM2;
      } else {
        grandTotal += parseFloat(it.area_m2) * pM2;
      }
    });

    await pool.query(`UPDATE work_orders SET total_price = $1 WHERE id = $2;`, [grandTotal.toFixed(2), item.work_order_id]);

    res.json({ message: 'Medidas actualizadas y total recalculado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el ítem' });
  }
});

app.delete('/api/ordenes/item/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const itemRes = await pool.query(`SELECT work_order_id FROM work_order_items WHERE id = $1;`, [id]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Ítem no encontrado' });
    const workOrderId = itemRes.rows[0].work_order_id;

    await pool.query(`DELETE FROM work_order_items WHERE id = $1;`, [id]);

    const allItems = await pool.query(`
      SELECT woi.*, pr.price_per_m2, m.name AS material_name 
      FROM work_order_items woi
      LEFT JOIN materials m ON woi.material_id = m.id
      LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
      WHERE woi.work_order_id = $1;
    `, [workOrderId]);

    let grandTotal = 0;
    allItems.rows.forEach(it => {
      const pM2 = parseFloat(it.price_per_m2 || 0);
      const mName = (it.material_name || '').toLowerCase();
      const esItemUnitario = mName.includes('fly banner') || mName.includes('sublimado') || mName.includes('portabanner');
      
      if (esItemUnitario) {
        grandTotal += it.copies * pM2;
      } else {
        grandTotal += parseFloat(it.area_m2 || 0) * pM2;
      }
    });

    await pool.query(`UPDATE work_orders SET total_price = $1 WHERE id = $2;`, [grandTotal.toFixed(2), workOrderId]);

    res.json({ message: 'Ítem eliminado y total recalculado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar el ítem' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    const user = result.rows[0];
    if (user.password !== password) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    res.json({ 
      success: true, 
      username: user.username, 
      role: user.role 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error en el servidor al intentar iniciar sesión' });
  }
});

// Ruta para crear una orden manual desde 0
app.post('/api/orders/manual', async (req, res) => {
    try {
        // 1. Buscamos el número de orden más alto actual para calcular el siguiente
        const maxOrderQuery = await pool.query(`
            SELECT MAX(CAST(SUBSTRING(order_number FROM '[0-9]+') AS INTEGER)) as max_num 
            FROM orders
        `);
        const nextNum = (maxOrderQuery.rows[0].max_num || 0) + 1;
        const orderNumber = `OT #${nextNum}`;

        const { clientName, clientEmail, notes } = req.body;

        // 2. Insertamos la nueva orden en la base de datos
        const newOrderQuery = await pool.query(`
            INSERT INTO orders (order_number, client_name, client_email, status, notes, created_at)
            VALUES ($1, $2, $3, 'PENDING_DESIGN', $4, NOW())
            RETURNING *
        `, [orderNumber, clientName || 'Cliente Mostrador / WhatsApp', clientEmail || '', notes || 'Orden creada manualmente']);

        res.json({ success: true, order: newOrderQuery.rows[0] });
    } catch (error) {
        console.error("Error al crear orden manual:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/ordenes/:id/item', async (req, res) => {
  const { id } = req.params;
  const { file_name, material_id, print_type_id, width_cm, height_cm, copies, file_url } = req.body;

  try {
    const matRes = await pool.query(`SELECT name, is_linear FROM materials WHERE id = $1;`, [material_id]);
    if (matRes.rows.length === 0) return res.status(400).json({ error: 'Material inválido' });
    const mat = matRes.rows[0];

    const matLower = mat.name.toLowerCase();
    const esUnitario = matLower.includes('fly banner') || 
                       matLower.includes('sublimado') || 
                       matLower.includes('base cruz') || 
                       matLower.includes('contrapeso') ||
                       matLower.includes('portabanner');

    let width = parseFloat(width_cm || 0);
    let height = parseFloat(height_cm || 0);
    let cant = parseInt(copies || 1);
    let area_m2 = 0;

    if (esUnitario) {
      width = 0;
      height = 0;
      area_m2 = cant;
    } else if (mat.is_linear) {
      width = 100;
      const metrosLineales = height > 50 ? (height / 100) : height;
      area_m2 = metrosLineales * cant;
    } else {
      area_m2 = ((width / 100) * (height / 100)) * cant;
    }

    await pool.query(`
      INSERT INTO work_order_items (work_order_id, file_name, material_id, print_type_id, width_cm, height_cm, copies, area_m2, file_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);
    `, [id, file_name || 'Item_Manual.jpg', material_id, print_type_id, width, height, cant, area_m2.toFixed(2), file_url || '#']);

    const allItems = await pool.query(`
      SELECT woi.*, pr.price_per_m2, m.name AS material_name 
      FROM work_order_items woi
      LEFT JOIN materials m ON woi.material_id = m.id
      LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
      WHERE woi.work_order_id = $1;
    `, [id]);

    let grandTotal = 0;
    allItems.rows.forEach(it => {
      const pM2 = parseFloat(it.price_per_m2 || 0);
      const mName = (it.material_name || '').toLowerCase();
      const esItemUnitario = mName.includes('fly banner') || mName.includes('sublimado') || mName.includes('portabanner');
      
      if (esItemUnitario) {
        grandTotal += it.copies * pM2;
      } else {
        grandTotal += parseFloat(it.area_m2 || 0) * pM2;
      }
    });

    await pool.query(`UPDATE work_orders SET total_price = $1 WHERE id = $2;`, [grandTotal.toFixed(2), id]);

    res.json({ message: 'Ítem agregado exitosamente.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al agregar el ítem' });
  }
});

app.put('/api/ordenes/estado/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    const result = await pool.query(`UPDATE work_orders SET status = $1 WHERE id = $2 RETURNING *;`, [status, id]);
    res.json({ message: 'Estado actualizado', ot: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar estado' });
  }
});

app.get('/api/catalogos', async (req, res) => {
  try {
    const materials = await pool.query('SELECT id, name FROM materials ORDER BY name;');
    const printTypes = await pool.query('SELECT id, name FROM print_types ORDER BY name;');
    res.json({ materials: materials.rows, printTypes: printTypes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener catálogos' });
  }
});

app.put('/api/ordenes/cliente/:id', async (req, res) => {
  const { id } = req.params;
  const { client_name } = req.body;
  try {
    const result = await pool.query(`UPDATE work_orders SET client_name = $1 WHERE id = $2 RETURNING *;`, [client_name, id]);
    res.json({ message: 'Cliente actualizado', ot: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Error al actualizar cliente' });
  }
});

app.get('/ot/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const otRes = await pool.query(`SELECT * FROM work_orders WHERE id = $1;`, [id]);
    if (otRes.rows.length === 0) return res.status(404).send('Orden de trabajo no encontrada');

    const ot = otRes.rows[0];
    const itemsRes = await pool.query(`
      SELECT 
        woi.*, 
        COALESCE(m.name, 'Material General') AS material_name, 
        COALESCE(pt.name, 'Estándar') AS print_type_name,
        pr.price_per_m2
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
                         matLower.includes('portabanner');
      
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
    const fechaEmision = new Date(ot.created_at).toLocaleDateString('es-AR');

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
        .logo { font-size: 26px; font-weight: bold; color: #5b3693; text-align: center; font-style: italic; }
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
            <td width="25%" class="text-center" style="font-size: 11px;">Fecha Entrega: ${fechaEmision}</td>
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
  console.log(`\n🚀 Servidor de la gráfica activo in http://localhost:${PORT}`);
  console.log('🔄 Escáner automático de Gmail activado (revisando cada 15 segundos)...');
  setInterval(escanearCorreosGmail, 15000);
});
