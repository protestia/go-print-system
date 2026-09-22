const express = require('express');
const router = express.Router();
const pool = require('./db');

// Endpoint para obtener todos los materiales con sus tipos de impresión y precios
router.get('/api/lista-precios', async (req, res) => {
  try {
    const query = `
      SELECT 
        m.id AS material_id,
        m.name AS material,
        m.is_linear,
        pt.name AS tipo_impresion,
        pr.price_per_m2 AS precio
      FROM materials m
      LEFT JOIN pricing_rules pr ON m.id = pr.material_id
      LEFT JOIN print_types pt ON pr.print_type_id = pt.id
      ORDER BY m.name ASC, pt.name ASC;
    `;
    const result = await pool.query(query);

    // Agrupar los tipos de impresión y precios por cada material
    const listaAgrupada = {};
    result.rows.forEach(row => {
      if (!listaAgrupada[row.material_id]) {
        listaAgrupada[row.material_id] = {
          id: row.material_id,
          nombre: row.material,
          is_linear: row.is_linear,
          precios: []
        };
      }
      if (row.tipo_impresion) {
        listaAgrupada[row.material_id].precios.push({
          tecnologia: row.tipo_impresion,
          precio: parseFloat(row.precio || 0)
        });
      }
    });

    res.json(Object.values(listaAgrupada));
  } catch (err) {
    console.error('Error al obtener lista de precios:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;