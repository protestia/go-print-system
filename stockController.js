// stockController.js
const db = require('./db'); // Ajusta la ruta a tu conexión db.js si está en la raíz

// Obtener la lista completa de stock
exports.obtenerStock = async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM stock_materiales ORDER BY nombre_material ASC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        console.error('Error al obtener el stock:', error);
        res.status(500).json({ success: false, error: 'Error al consultar la base de datos' });
    }
};

// Agregar un nuevo material o rollo
exports.agregarMaterial = async (req, res) => {
    const { nombre_material, ancho_metro, rollos_cantidad, m2_totales } = req.body;
    try {
        const query = `
            INSERT INTO stock_materiales (nombre_material, ancho_metro, rollos_cantidad, m2_totales) 
            VALUES ($1, $2, $3, $4)
        `;
        await db.query(query, [nombre_material, ancho_metro, rollos_cantidad, m2_totales]);
        res.json({ success: true, message: 'Material guardado correctamente' });
    } catch (error) {
        console.error('Error al agregar material:', error);
        res.status(500).json({ success: false, error: 'Error al guardar el material' });
    }
};

// Registrar Scrap / Desperdicio
exports.registrarScrap = async (req, res) => {
    const { id, m2_scrap } = req.body;
    try {
        const query = `
            UPDATE stock_materiales 
            SET m2_scrap_mes = m2_scrap_mes + $1, 
                m2_totales = GREATEST(0, m2_totales - $1) 
            WHERE id = $2
        `;
        await db.query(query, [m2_scrap, id]);
        res.json({ success: true, message: 'Scrap registrado correctamente' });
    } catch (error) {
        console.error('Error al registrar scrap:', error);
        res.status(500).json({ success: false, error: 'Error al actualizar scrap' });
    }
};