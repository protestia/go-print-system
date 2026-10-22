const express = require('express');
const router = express.Router();

module.exports = (pool) => {

 async function recalcularTotalOrden(client, workOrderId) {
  const allItems = await client.query(`
    SELECT 
      woi.*, 
      COALESCE(woi.unit_price_override, pr.price_per_m2, (SELECT price_per_m2 FROM pricing_rules WHERE material_id = woi.material_id LIMIT 1), 0) AS final_unit_price, 
      m.name AS material_name,
      COALESCE(m.is_linear, false) AS is_linear
    FROM work_order_items woi
    LEFT JOIN materials m ON woi.material_id = m.id
    LEFT JOIN pricing_rules pr ON (pr.material_id = woi.material_id AND pr.print_type_id = woi.print_type_id)
    WHERE woi.work_order_id = $1;
  `, [workOrderId]);

  let grandTotal = 0;

  allItems.rows.forEach(it => {
    const pM2 = parseFloat(it.final_unit_price || 0);
    const copies = parseInt(it.copies || 1);
    const ancho = parseFloat(it.width_cm || 0) / 100;
    const alto = parseFloat(it.height_cm || 0) / 100;
    const matName = (it.material_name || '').toLowerCase();

    // 1. Si tiene precio manual
    if (it.unit_price_override !== null && parseFloat(it.unit_price_override) > 0) {
      const pOverride = parseFloat(it.unit_price_override);
      if (it.is_linear) {
        const largo = Math.max(alto, ancho, 1.0);
        grandTotal += largo * copies * pOverride;
      } else if (ancho > 0 && alto > 0 && !matName.includes('costura') && !matName.includes('soldadura') && !matName.includes('fly banner') && !matName.includes('roll up')) {
        grandTotal += (ancho * alto) * copies * pOverride;
      } else {
        grandTotal += copies * pOverride;
      }
    } else {
      // 2. Tarifa normal por tipo
      if (it.is_linear) {
        const largo = Math.max(alto, ancho, 1.0);
        grandTotal += largo * copies * pM2;
      } else if (matName.includes('fly banner') || matName.includes('roll up') || matName.includes('portabanner') || matName.includes('costura') || matName.includes('soldadura')) {
        grandTotal += copies * pM2;
      } else {
        const area = Math.max(ancho * alto, 1.0);
        grandTotal += area * copies * pM2;
      }
    }
  });

  await client.query(`UPDATE work_orders SET total_price = $1 WHERE id = $2;`, [grandTotal.toFixed(2), workOrderId]);
}
  
 // GET: Obtener órdenes por estado con paginación real y cálculo dinámico de precio
router.get('/api/ordenes/:estado', async (req, res) => {
  const { estado } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim().toLowerCase();

  const estadoMap = {
    'diseno': 'PENDING_DESIGN',
    'pending_design': 'PENDING_DESIGN',
    'impresion': 'READY_TO_PRINT',
    'ready_to_print': 'READY_TO_PRINT',
    'entrega': 'READY_TO_DELIVER',
    'ready_to_deliver': 'READY_TO_DELIVER',
    'historial': 'DELIVERED',
    'delivered': 'DELIVERED'
  };

  const statusFilter = estadoMap[(estado || '').toLowerCase()] || 'PENDING_DESIGN';

  try {
    let searchCondition = "WHERE UPPER(COALESCE(wo.status, 'PENDING_DESIGN')) = UPPER($1)";
    let queryParams = [statusFilter];

    if (search !== '') {
      searchCondition += " AND (LOWER(wo.client_name) LIKE $2 OR CAST(wo.id AS TEXT) LIKE $2)";
      queryParams.push(`%${search}%`);
    }

    // 1. Contar el total de órdenes para calcular las páginas totales
    const countQuery = `SELECT COUNT(*) FROM work_orders wo ${searchCondition}`;
    const countRes = await pool.query(countQuery, search !== '' ? [statusFilter, `%${search}%`] : [statusFilter]);
    const totalOrdenes = parseInt(countRes.rows[0].count);

    // 2. Consulta principal con cálculo dinámico en vivo del total real por cada ítem
    let query = `
      SELECT 
        wo.id AS ot_numero, wo.client_name, wo.client_email, wo.copies, wo.is_urgent, 
        wo.is_pinned, wo.is_priority,
        
        -- ✅ CÁLCULO DINÁMICO REAL: Evalúa metros cuadrados o unidades si no hay medidas
        COALESCE(
          SUM(
            CASE 
              WHEN LOWER(m.name) LIKE '%fly banner%' OR LOWER(m.name) LIKE '%roll up%' OR LOWER(m.name) LIKE '%portabanner%' OR LOWER(m.name) LIKE '%base cruz%' OR LOWER(m.name) LIKE '%cruz%' OR LOWER(m.name) LIKE '%contrapeso%' OR LOWER(m.name) LIKE '%cartel c%' OR LOWER(m.name) LIKE '%polyfam%' 
              THEN woi.copies * COALESCE(woi.unit_price_override, pr.price_per_m2, (SELECT price_per_m2 FROM pricing_rules WHERE material_id = woi.material_id LIMIT 1), 0)
              
              ELSE 
                GREATEST(
                  (COALESCE(woi.width_cm, 0) / 100.0) * (COALESCE(woi.height_cm, 0) / 100.0), 
                  CASE WHEN COALESCE(woi.area_m2, 0) > 0 THEN woi.area_m2 / woi.copies ELSE 1.0 END
                ) * woi.copies * COALESCE(woi.unit_price_override, pr.price_per_m2, (SELECT price_per_m2 FROM pricing_rules WHERE material_id = woi.material_id LIMIT 1), 0)
            END
          ), 
          wo.total_price, 
          0
        ) AS total_price,

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
      ${searchCondition}
      GROUP BY wo.id, wo.client_name, wo.client_email, wo.copies, wo.total_price, wo.status, wo.original_files, wo.created_at, wo.email_id, wo.fecha_prometida, wo.entregado_por, wo.fecha_entrega, wo.notes, wo.is_urgent, wo.is_pinned, wo.is_priority
      ORDER BY wo.is_pinned DESC, wo.created_at DESC
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    queryParams.push(limit, offset);

    const result = await pool.query(query, queryParams);

    res.json({
      ordenes: result.rows,
      currentPage: page,
      totalPages: Math.ceil(totalOrdenes / limit) || 1,
      totalOrdenes
    });

  } catch (err) {
    console.error('❌ Error en base de datos al obtener órdenes:', err);
    res.status(500).json({ error: 'Error en base de datos' });
  }
});

  // POST: Orden manual (Validando que el cliente exista previamente)
  router.post('/api/orders/manual', async (req, res) => {
    try {
      const { clientName, clientEmail, notes } = req.body;

      if (!clientName) {
        return res.status(400).json({ success: false, error: 'Debe especificar un nombre de cliente.' });
      }

      // 1. Verificar si el cliente existe buscando por empresa o nombre (usando la tabla 'clients' o 'clientes' según corresponda)
      const clienteCheck = await pool.query(
        `SELECT id, company, name, email FROM clients WHERE LOWER(company) = LOWER($1) OR LOWER(name) = LOWER($1) LIMIT 1`,
        [clientName.trim()]
      );

      if (clienteCheck.rows.length === 0) {
        return res.status(400).json({ 
          success: false, 
          error: '❌ El cliente no está registrado en el sistema. Debe dar de alta al cliente antes de crear una orden.' 
        });
      }

      const clienteRegistrado = clienteCheck.rows[0];
      const nombreFinalCliente = clienteRegistrado.company || clienteRegistrado.name;

      const d = new Date();
      d.setDate(d.getDate() + 3);
      const fechaPrometidaStr = d.toLocaleDateString('es-AR');

      // 2. Crear la orden vinculando opcionalmente el client_id si tu tabla work_orders lo soporta
      const newOrder = await pool.query(`
        INSERT INTO work_orders (client_name, client_email, status, original_files, total_price, fecha_prometida, notes, created_at)
        VALUES ($1, $2, 'PENDING_DESIGN', '#', 0.00, $3, $4, NOW())
        RETURNING *
      `, [nombreFinalCliente, clienteRegistrado.email || clientEmail || '', fechaPrometidaStr, notes || '']);

      res.json({ success: true, order: newOrder.rows[0] });
    } catch (error) {
      console.error('Error al crear orden manual:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // PUT: Cambiar número de orden
  router.put('/api/ordenes/numero/:id', async (req, res) => {
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

  // PUT: Fijar / Desfijar Orden (PIN)
  router.put('/api/ordenes/fijar/:id', async (req, res) => {
    const { id } = req.params;
    const { is_pinned } = req.body;
    try {
      const result = await pool.query(`UPDATE work_orders SET is_pinned = $1 WHERE id = $2 RETURNING *;`, [is_pinned, id]);
      res.json({ success: true, order: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Error al fijar orden' });
    }
  });

  // PUT: Prioridad
  router.put('/api/ordenes/prioridad/:id', async (req, res) => {
    const { id } = req.params;
    const { is_priority } = req.body;
    try {
      const result = await pool.query(`UPDATE work_orders SET is_priority = $1 WHERE id = $2 RETURNING *;`, [is_priority, id]);
      res.json({ success: true, order: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar prioridad' });
    }
  });

  // PUT: Urgencia
  router.put('/api/ordenes/urgencia/:id', async (req, res) => {
    const { id } = req.params;
    const { is_urgent } = req.body;
    try {
      const result = await pool.query(`UPDATE work_orders SET is_urgent = $1 WHERE id = $2 RETURNING *;`, [is_urgent, id]);
      res.json({ success: true, order: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar urgencia' });
    }
  });

  // PUT: Cambiar estado de la orden
  router.put('/api/ordenes/estado/:id', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
      const result = await pool.query(`UPDATE work_orders SET status = $1 WHERE id = $2 RETURNING *;`, [status, id]);
      res.json({ message: 'Estado actualizado', ot: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar estado' });
    }
  });

  // PUT: Info de entrega
  router.put('/api/ordenes/entrega-info/:id', async (req, res) => {
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

  // PUT: Nombre del cliente en orden
  router.put('/api/ordenes/cliente/:id', async (req, res) => {
    const { id } = req.params;
    const { client_name } = req.body;
    try {
      await pool.query(`UPDATE work_orders SET client_name = $1 WHERE id = $2;`, [client_name, id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar cliente' });
    }
  });

  // DELETE: Eliminar orden
  router.delete('/api/ordenes/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query(`DELETE FROM work_order_items WHERE work_order_id = $1;`, [id]);
      await pool.query(`DELETE FROM work_orders WHERE id = $1;`, [id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Error al eliminar orden' });
    }
  });

  // --- ÍTEMS DE ÓRDENES ---

  // PUT: Modificar medidas/copias de un ítem
router.put('/api/ordenes/item/:id', async (req, res) => {
  const { id } = req.params;
  const { width_cm, height_cm, copies } = req.body;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const itemRes = await client.query(
      `SELECT woi.*, m.name AS material_name 
       FROM work_order_items woi 
       LEFT JOIN materials m ON woi.material_id = m.id 
       WHERE woi.id = $1;`, 
      [id]
    );

    if (itemRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No encontrado' });
    }
    
    const item = itemRes.rows[0];
    const matLower = (item.material_name || '').toLowerCase().trim();

    const esUnitario = matLower.includes('fly banner') || 
                       matLower.includes('roll up') || 
                       matLower.includes('portabanner') || 
                       matLower.includes('base cruz') || 
                       matLower.includes('cruz') || 
                       matLower.includes('contrapeso') || 
                       matLower.includes('cartel c') ||
                       matLower.includes('polyfam');

    const cantCopias = parseInt(copies || 1);
    const anchoNum = parseFloat(width_cm || 0);
    const altoNum = parseFloat(height_cm || 0);

    // ✅ CORRECCIÓN 1: Conservar m² con precisión decimal exacta (sin .toFixed previo)
    let area_m2 = esUnitario ? cantCopias : ((anchoNum / 100) * (altoNum / 100)) * cantCopias;

    await client.query(
      `UPDATE work_order_items 
       SET width_cm = $1, height_cm = $2, copies = $3, area_m2 = $4 
       WHERE id = $5;`, 
      [esUnitario ? 0 : anchoNum, esUnitario ? 0 : altoNum, cantCopias, area_m2, id]
    );

    // ✅ CORRECCIÓN 2: Recalcular la orden y sincronizar automáticamente con la cuenta corriente
    const nuevoTotal = await recalcularYSincronizarTotalOrden(client, item.work_order_id);

    await client.query('COMMIT');
    res.json({ message: 'Actualizado correctamente', nuevoTotal });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

  // PUT: Modificar medidas/copias de un ítem
  router.put('/api/ordenes/item/:id', async (req, res) => {
    const { id } = req.params;
    const { width_cm, height_cm, copies } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const itemRes = await client.query(
        `SELECT woi.*, m.name AS material_name 
         FROM work_order_items woi 
         LEFT JOIN materials m ON woi.material_id = m.id 
         WHERE woi.id = $1;`, 
        [id]
      );

      if (itemRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No encontrado' });
      }
      
      const item = itemRes.rows[0];
      const matLower = (item.material_name || '').toLowerCase().trim();

      const esUnitario = matLower.includes('fly banner') || 
                         matLower.includes('roll up') || 
                         matLower.includes('portabanner') || 
                         matLower.includes('base cruz') || 
                         matLower.includes('cruz') || 
                         matLower.includes('contrapeso') || 
                         matLower.includes('cartel c') ||
                         matLower.includes('polyfam');

      const cantCopias = parseInt(copies || 1);
      const anchoNum = parseFloat(width_cm || 0);
      const altoNum = parseFloat(height_cm || 0);

      let area_m2 = esUnitario ? cantCopias : ((anchoNum / 100) * (altoNum / 100)) * cantCopias;

      await client.query(
        `UPDATE work_order_items 
         SET width_cm = $1, height_cm = $2, copies = $3, area_m2 = $4 
         WHERE id = $5;`, 
        [esUnitario ? 0 : anchoNum, esUnitario ? 0 : altoNum, cantCopias, area_m2.toFixed(2), id]
      );

      await recalcularTotalOrden(client, item.work_order_id);

      await client.query('COMMIT');
      res.json({ message: 'Actualizado' });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // PUT: URL de archivo en ítem
  router.put('/api/ordenes/item-url/:id', async (req, res) => {
    const { id } = req.params;
    const { file_url } = req.body;
    try {
      await pool.query(`UPDATE work_order_items SET file_url = $1 WHERE id = $2;`, [file_url, id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar el link del archivo' });
    }
  });

  // PUT: Nombre de archivo en ítem
  router.put('/api/ordenes/item-nombre/:id', async (req, res) => {
    const { id } = req.params;
    const { file_name } = req.body;
    try {
      await pool.query(`UPDATE work_order_items SET file_name = $1 WHERE id = $2;`, [file_name, id]);
      res.json({ success: true });
    } catch (err) {
      console.error('❌ Error en DB al actualizar nombre de ítem:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT: Actualizar enlace del ítem
  router.put('/api/ordenes/item-enlace/:id', async (req, res) => {
    const { id } = req.params;
    const { file_url } = req.body;
    try {
      await pool.query('UPDATE work_order_items SET file_url = $1 WHERE id = $2', [file_url, id]);
      res.json({ success: true });
    } catch (err) {
      console.error('❌ Error en DB al actualizar enlace de ítem:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PUT: Marcar ítem como impreso
  router.put('/api/ordenes/item/printed/:id', async (req, res) => {
    const { id } = req.params;
    const { is_printed } = req.body;
    try {
      const result = await pool.query(`UPDATE work_order_items SET is_printed = $1 WHERE id = $2 RETURNING *;`, [is_printed, id]);
      res.json({ success: true, item: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar' });
    }
  });

  // PUT: Marcar ítem como entregado
  router.put('/api/ordenes/item/delivered/:id', async (req, res) => {
    const { id } = req.params;
    const { is_delivered_item } = req.body;
    try {
      const result = await pool.query(`UPDATE work_order_items SET is_delivered_item = $1 WHERE id = $2 RETURNING *;`, [is_delivered_item, id]);
      res.json({ success: true, item: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: 'Error al actualizar ítem' });
    }
  });

  // PUT: Sobrescribir precio de un ítem (Precio manual)
  router.put('/api/ordenes/item-precio/:id', async (req, res) => {
    const { id } = req.params;
    const { unit_price_override } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const overrideVal = (unit_price_override !== null && unit_price_override !== '' && !isNaN(unit_price_override)) 
        ? parseFloat(unit_price_override) 
        : null;

      await client.query(`UPDATE work_order_items SET unit_price_override = $1 WHERE id = $2;`, [overrideVal, id]);

      const itemRes = await client.query(`SELECT work_order_id FROM work_order_items WHERE id = $1;`, [id]);
      if (itemRes.rows.length > 0) {
        await recalcularTotalOrden(client, itemRes.rows[0].work_order_id);
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error al actualizar el precio en la base de datos' });
    } finally {
      client.release();
    }
  });

  // Alias para la ruta de precio manual por si el front usa otra variante de URL
  router.put('/api/ordenes/item/precio-manual/:id', async (req, res) => {
    const { id } = req.params;
    const { unit_price_override } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const overrideVal = (unit_price_override !== null && unit_price_override !== '' && !isNaN(unit_price_override)) 
        ? parseFloat(unit_price_override) 
        : null;

      await client.query('UPDATE work_order_items SET unit_price_override = $1 WHERE id = $2', [overrideVal, id]);

      const itemRes = await client.query(`SELECT work_order_id FROM work_order_items WHERE id = $1;`, [id]);
      if (itemRes.rows.length > 0) {
        await recalcularTotalOrden(client, itemRes.rows[0].work_order_id);
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: err.message });
    } finally {
      client.release();
    }
  });

  // DELETE: Eliminar ítem
  router.delete('/api/ordenes/item/:id', async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const itemRes = await client.query(`SELECT work_order_id FROM work_order_items WHERE id = $1;`, [id]);
      if (itemRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'No encontrado' });
      }
      const workOrderId = itemRes.rows[0].work_order_id;

      await client.query(`DELETE FROM work_order_items WHERE id = $1;`, [id]);
      await recalcularTotalOrden(client, workOrderId);

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Error al eliminar ítem' });
    } finally {
      client.release();
    }
  });

  // --- CATALOGO AUXILIAR DE MATERIALES/IMPRESIONES ---
  router.get('/api/catalogos', async (req, res) => {
    try {
      const materials = await pool.query('SELECT id, name FROM materials ORDER BY name;');
      const printTypes = await pool.query('SELECT id, name FROM print_types ORDER BY name;');
      res.json({ materials: materials.rows, printTypes: printTypes.rows });
    } catch (err) {
      res.status(500).json({ error: 'Error al obtener catálogos' });
    }
  });

  // --- COMPROBANTE OT (HTML / PDF PRINT) ---
  router.get('/ot/:id', async (req, res) => {
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
                           matLower.includes('base cruz') || 
                           matLower.includes('contrapeso') ||
                           matLower.includes('portabanner') ||
                           matLower.includes('roll up') ||
                           matLower.includes('cartel c') ||
                           matLower.includes('polyfam');
                         
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
          <button onclick="window.print()" style="padding: 10px 20px; font-weight: bold; cursor: pointer; background: #5b3693; color: #fff; border: none; border-radius: 4px;">🖨 Imprimir / Guardar PDF</button>
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
              <td width="50%" style="font-weight: bold; font-size: 12px; background: #f0f0f0;">CLIENTE: ${(ot.client_name || '').toUpperCase()}</td>
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

  return router; // 👈 OBLIGATORIO RETORNAR EL ROUTER
};
