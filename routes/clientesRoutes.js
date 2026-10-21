const express = require('express');
const router = express.Router();

module.exports = (pool) => {

  // GET: Obtener clientes con paginación o lista completa según se requiera
  router.get('/api/clientes', async (req, res) => {
    try {
      const search = (req.query.search || '').trim().toLowerCase();
      const traerTodos = req.query.all === 'true';
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      let searchCondition = '';
      let queryParams = [];

      if (search !== '') {
        searchCondition = `WHERE LOWER(c.name) LIKE $1 OR LOWER(c.company) LIKE $1 OR LOWER(c.phone) LIKE $1 OR LOWER(c.dni_cuit) LIKE $1`;
        queryParams.push(`%${search}%`);
      }

      // Contar total para la paginación
      const countQuery = `SELECT COUNT(*) FROM clients c ${searchCondition}`;
      const countRes = await pool.query(countQuery, search !== '' ? [`%${search}%`] : []);
      const totalClientes = parseInt(countRes.rows[0].count);

      // ✅ CÓDIGO CORREGIDO (Comparación estricta de igualdad):
let query = `
  SELECT c.*, 
    COALESCE(
      (SELECT SUM(cp.amount) FROM client_payments cp WHERE cp.client_id = c.id), 0
    ) - COALESCE(
      (SELECT SUM(wo.total_price) FROM work_orders wo WHERE wo.client_id = c.id OR LOWER(TRIM(wo.client_name)) = LOWER(TRIM(c.company)) OR LOWER(TRIM(wo.client_name)) = LOWER(TRIM(c.name))), 0
    ) - COALESCE(
      (SELECT SUM(ca.amount) FROM client_adjustments ca WHERE ca.client_id = c.id), 0
    ) AS saldo,
    COALESCE(
      (SELECT COUNT(*) FROM work_orders wo WHERE (wo.client_id = c.id OR LOWER(TRIM(wo.client_name)) = LOWER(TRIM(c.company)) OR LOWER(TRIM(wo.client_name)) = LOWER(TRIM(c.name))) AND wo.status != 'DELIVERED'), 0
    ) AS active_orders
  FROM clients c
  ${searchCondition}
  ORDER BY c.id DESC
`;

      if (!traerTodos) {
        queryParams.push(limit, offset);
        query += ` LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
      }

      const result = await pool.query(query, queryParams);

      res.json({
        clientes: result.rows,
        currentPage: page,
        totalPages: traerTodos ? 1 : (Math.ceil(totalClientes / limit) || 1),
        totalClientes
      });
    } catch (err) {
      console.error('Error al obtener clientes:', err);
      res.status(500).json({ error: 'Error al obtener clientes' });
    }
  });

  // POST: Crear nuevo cliente
  router.post('/api/clientes', async (req, res) => {
    const { company, name, phone, dni_cuit, address, email, notes } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO clients (company, name, phone, dni_cuit, address, email, notes, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
        [company, name, phone, dni_cuit, address, email, notes]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error al crear cliente:', err);
      res.status(500).json({ error: 'Error al crear cliente' });
    }
  });

  // GET: Obtener un cliente específico por ID
  router.get('/api/clientes/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error al obtener cliente:', err);
      res.status(500).json({ error: 'Error al obtener cliente' });
    }
  });

  // PUT: Editar cliente
  router.put('/api/clientes/:id', async (req, res) => {
    const { id } = req.params;
    const { company, name, phone, dni_cuit, address, email, notes } = req.body;
    try {
      const result = await pool.query(
        `UPDATE clients SET company = $1, name = $2, phone = $3, dni_cuit = $4, address = $5, email = $6, notes = $7 
         WHERE id = $8 RETURNING *`,
        [company, name, phone, dni_cuit, address, email, notes, id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error al actualizar cliente:', err);
      res.status(500).json({ error: 'Error al actualizar cliente' });
    }
  });

  // DELETE: Eliminar cliente
  router.delete('/api/clientes/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query('DELETE FROM clients WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error al eliminar cliente:', err);
      res.status(500).json({ error: 'Error al eliminar cliente' });
    }
  });

  // GET: Resumen de cuenta de cliente unificado
  router.get('/api/clientes/:id/cuenta', async (req, res) => {
    const { id } = req.params;
    try {
      const clienteRes = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
      if (clienteRes.rows.length === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
      const cliente = clienteRes.rows[0];

      const queryMovs = `
        SELECT 'orden' as tipo, id, created_at as fecha, CONCAT('OT #', id) as num_orden, id as ot_numero, total_price as importe, 0 as pagos, NULL as metodo, NULL as notas, status 
        FROM work_orders 
        WHERE client_id = $1 OR client_name ILIKE $2 OR client_name ILIKE $3
        UNION ALL
        SELECT 'cargo' as tipo, id, created_at as fecha, description as num_orden, NULL as ot_numero, amount as importe, 0 as pagos, NULL as metodo, NULL as notas, NULL as status 
        FROM client_adjustments 
        WHERE client_id = $1
        UNION ALL
        SELECT 'pago' as tipo, id, created_at as fecha, '-' as num_orden, NULL as ot_numero, 0 as importe, amount as pagos, payment_method as metodo, notes, NULL as status 
        FROM client_payments 
        WHERE client_id = $1
        ORDER BY fecha ASC
      `;
      const movsRes = await pool.query(queryMovs, [id, cliente.company || '', cliente.name || '']);

      let saldoAcumulado = 0;
      const movimientos = movsRes.rows.map(m => {
        const importe = parseFloat(m.importe || 0);
        const pago = parseFloat(m.pagos || 0);
        
        if (m.tipo === 'pago') {
          saldoAcumulado -= pago;
        } else {
          saldoAcumulado += importe;
        }
        
        return {
          id: m.id,
          tipo: m.tipo,
          fecha: new Date(m.fecha).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }),
          num_orden: m.num_orden,
          ot_numero: m.ot_numero,
          status: m.status,
          importe: importe,
          pagos: pago,
          metodo: m.metodo,
          notas: m.notas,
          total_saldo: saldoAcumulado
        };
      });

      res.json({
        cliente,
        movimientos,
        saldo_final: saldoAcumulado
      });
    } catch (err) {
      console.error('Error al obtener cuenta del cliente:', err);
      res.status(500).json({ error: 'Error al obtener cuenta' });
    }
  });

  // POST: Registrar pago y reflejarlo automáticamente en la caja diaria activa
  router.post('/api/clientes/pagos', async (req, res) => {
    const cliente_id = req.body.cliente_id || req.body.client_id;
    const { monto, metodo_pago, notas } = req.body;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pagoRes = await client.query(
        `INSERT INTO client_payments (client_id, amount, payment_method, notes, created_at) 
         VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
        [cliente_id, monto, metodo_pago, notas]
      );

      const fechaHoyRes = await client.query(
        `SELECT (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::date::text as today`
      );
      const today = fechaHoyRes.rows[0].today;

      let cajaRes = await client.query(
        `SELECT id FROM daily_cash WHERE cash_date::date = $1::date AND status = 'OPEN' ORDER BY id DESC LIMIT 1`,
        [today]
      );

      let dailyCashId;
      if (cajaRes.rows.length === 0) {
        const nuevaCaja = await client.query(
          `INSERT INTO daily_cash (cash_date, total_incomes, total_expenses, closing_balance, status) 
           VALUES ($1, 0, 0, 0, 'OPEN') RETURNING id`,
          [today]
        );
        dailyCashId = nuevaCaja.rows[0].id;
      } else {
        dailyCashId = cajaRes.rows[0].id;
      }

      const clienteRes = await client.query('SELECT company, name FROM clients WHERE id = $1', [cliente_id]);
      const clienteInfo = clienteRes.rows[0];
      const nombreCliente = clienteInfo ? (clienteInfo.company || clienteInfo.name) : 'Cliente';
      const descripcionMovimiento = `Pago de cuenta: ${nombreCliente} ${notas ? `- ${notas}` : ''}`;

      await client.query(
        `INSERT INTO cash_movements (daily_cash_id, type, amount, payment_method, description, created_at) 
         VALUES ($1, 'INCOME', $2, $3, $4, NOW())`,
        [dailyCashId, monto, metodo_pago || 'EFECTIVO', descripcionMovimiento]
      );

      await client.query(
        `UPDATE daily_cash SET total_incomes = total_incomes + $1 WHERE id = $2`,
        [monto, dailyCashId]
      );

      await client.query('COMMIT');
      res.json(pagoRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error al registrar pago y actualizar caja:', err);
      res.status(500).json({ error: 'Error al registrar pago' });
    } finally {
      client.release();
    }
  });

  // PUT: Editar pago y sincronizar caja
  router.put('/api/clientes/pagos/:id', async (req, res) => {
    const { id } = req.params;
    const { monto, metodo_pago, notas } = req.body;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pagoAnteriorRes = await client.query('SELECT * FROM client_payments WHERE id = $1', [id]);
      if (pagoAnteriorRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pago no encontrado' });
      }
      const pagoViejo = pagoAnteriorRes.rows[0];
      const diferencia = parseFloat(monto) - parseFloat(pagoViejo.amount);

      const result = await client.query(
        `UPDATE client_payments SET amount = $1, payment_method = $2, notes = $3 WHERE id = $4 RETURNING *`,
        [monto, metodo_pago, notas, id]
      );

      const fechaHoyRes = await client.query(
        `SELECT (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::date::text as today`
      );
      const today = fechaHoyRes.rows[0].today;

      let cajaRes = await client.query(
        `SELECT id FROM daily_cash WHERE cash_date::date = $1::date AND status = 'OPEN' ORDER BY id DESC LIMIT 1`,
        [today]
      );

      if (cajaRes.rows.length > 0) {
        const dailyCashId = cajaRes.rows[0].id;

        const clienteRes = await client.query('SELECT company, name FROM clients WHERE id = $1', [pagoViejo.client_id]);
        const clienteInfo = clienteRes.rows[0];
        const nombreCliente = clienteInfo ? (clienteInfo.company || clienteInfo.name) : 'Cliente';

        await client.query(
          `UPDATE cash_movements 
           SET amount = $1, payment_method = $2, description = $3 
           WHERE daily_cash_id = $4 AND type = 'INCOME' AND description ILIKE $5`,
          [monto, metodo_pago || 'EFECTIVO', `Pago de cuenta: ${nombreCliente} ${notas ? `- ${notas}` : ''}`, dailyCashId, `%Pago de cuenta: ${nombreCliente}%`]
        );

        await client.query(
          `UPDATE daily_cash SET total_incomes = total_incomes + $1 WHERE id = $2`,
          [diferencia, dailyCashId]
        );
      }

      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error al editar pago y sincronizar caja:', err);
      res.status(500).json({ error: 'Error al editar pago' });
    } finally {
      client.release();
    }
  });

  // DELETE: Eliminar pago
  router.delete('/api/clientes/pagos/:id', async (req, res) => {
    const { id } = req.params;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const pagoRes = await client.query('SELECT * FROM client_payments WHERE id = $1', [id]);
      if (pagoRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pago no encontrado' });
      }
      const pago = pagoRes.rows[0];

      await client.query('DELETE FROM client_payments WHERE id = $1', [id]);

      const fechaHoyRes = await client.query(
        `SELECT (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::date::text as today`
      );
      const today = fechaHoyRes.rows[0].today;

      let cajaRes = await client.query(
        `SELECT id FROM daily_cash WHERE cash_date::date = $1::date AND status = 'OPEN' ORDER BY id DESC LIMIT 1`,
        [today]
      );

      if (cajaRes.rows.length > 0) {
        const dailyCashId = cajaRes.rows[0].id;
        const clienteRes = await client.query('SELECT company, name FROM clients WHERE id = $1', [pago.client_id]);
        const clienteInfo = clienteRes.rows[0];
        const nombreCliente = clienteInfo ? (clienteInfo.company || clienteInfo.name) : 'Cliente';

        await client.query(
          `DELETE FROM cash_movements WHERE daily_cash_id = $1 AND type = 'INCOME' AND description ILIKE $2`,
          [dailyCashId, `%Pago de cuenta: ${nombreCliente}%`]
        );

        await client.query(
          `UPDATE daily_cash SET total_incomes = total_incomes - $1 WHERE id = $2`,
          [pago.amount, dailyCashId]
        );
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error al eliminar pago:', err);
      res.status(500).json({ error: 'Error al eliminar pago' });
    } finally {
      client.release();
    }
  });

  // POST: Registrar cargo manual
  router.post('/api/clientes/cargos', async (req, res) => {
    const { cliente_id, concepto, monto } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO client_adjustments (client_id, description, amount, created_at) 
         VALUES ($1, $2, $3, NOW()) RETURNING *`,
        [cliente_id, concepto, monto]
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error('Error al registrar cargo:', err);
      res.status(500).json({ error: 'Error al registrar cargo' });
    }
  });

  // DELETE: Eliminar cargo manual
  router.delete('/api/clientes/cargos/:id', async (req, res) => {
    const { id } = req.params;
    try {
      await pool.query('DELETE FROM client_adjustments WHERE id = $1', [id]);
      res.json({ success: true });
    } catch (err) {
      console.error('Error al eliminar cargo:', err);
      res.status(500).json({ error: 'Error al eliminar cargo' });
    }
  });

  return router;
};
