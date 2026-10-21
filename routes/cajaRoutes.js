const express = require('express');
const router = express.Router();

module.exports = (pool) => {

  // GET: Obtener movimientos y estado de la caja de hoy
  router.get('/hoy', async (req, res) => {
    try {
      // 🔒 AUTO-CIERRE: Cerrar automáticamente cajas de días anteriores que quedaron abiertas
      await pool.query(
        `UPDATE daily_cash 
         SET status = 'CLOSED', closed_at = NOW() 
         WHERE status = 'OPEN' AND cash_date::date < (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::date`
      );

      // Fecha local explícita de Córdoba/Argentina (YYYY-MM-DD)
      const dateRes = await pool.query(
        `SELECT (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::date::text as today`
      );
      const today = dateRes.rows[0].today;
      
      // Búsqueda directa por tipo DATE en PostgreSQL
      let cashRes = await pool.query(
        'SELECT * FROM daily_cash WHERE cash_date::date = $1::date ORDER BY id DESC LIMIT 1', 
        [today]
      );

      if (cashRes.rows.length === 0) {
        cashRes = await pool.query(
          "INSERT INTO daily_cash (cash_date, total_incomes, total_expenses, closing_balance, status) VALUES ($1, 0, 0, 0, 'OPEN') RETURNING *",
          [today]
        );
      }
      let dailyCash = cashRes.rows[0];

      // Traer únicamente los movimientos asociados a esta caja
      const movementsRes = await pool.query(
        `SELECT * FROM cash_movements 
         WHERE daily_cash_id = $1 
         ORDER BY created_at DESC`,
        [dailyCash.id]
      );

      // Recalcular en vivo los totales de Ingresos y Egresos
      let calculatedIncomes = 0;
      let calculatedExpenses = 0;

      movementsRes.rows.forEach(m => {
        const amount = parseFloat(m.amount || 0);
        if (m.type === 'INCOME' || m.type === 'INGRESO') {
          calculatedIncomes += amount;
        } else if (m.type === 'EXPENSE' || m.type === 'EGRESO') {
          calculatedExpenses += amount;
        }
      });

      dailyCash.total_incomes = calculatedIncomes;
      dailyCash.total_expenses = calculatedExpenses;

      await pool.query(
        'UPDATE daily_cash SET total_incomes = $1, total_expenses = $2 WHERE id = $3',
        [calculatedIncomes, calculatedExpenses, dailyCash.id]
      );

      res.json({
        dailyCash,
        movements: movementsRes.rows
      });
    } catch (err) {
      console.error('Error al obtener caja del día:', err);
      res.status(500).json({ error: 'Error del servidor' });
    }
  });

  // GET: Obtener detalle de una caja especifica por ID
  router.get('/detalle/:id', async (req, res) => {
    try {
      const { id } = req.params;

      const cashRes = await pool.query('SELECT * FROM daily_cash WHERE id = $1', [id]);
      if (cashRes.rows.length === 0) {
        return res.status(404).json({ error: 'Caja no encontrada' });
      }
      const dailyCash = cashRes.rows[0];

      const movementsRes = await pool.query(
        `SELECT * FROM cash_movements 
         WHERE daily_cash_id = $1 
         ORDER BY created_at ASC`,
        [dailyCash.id]
      );

      res.json({
        dailyCash,
        movements: movementsRes.rows
      });
    } catch (err) {
      console.error('Error al obtener detalle de la caja:', err);
      res.status(500).json({ error: 'Error al obtener detalle de la caja' });
    }
  });

  /// POST: Cargar un movimiento manual (Ingreso o Egreso)
  router.post('/movimiento', async (req, res) => {
    try {
      let { daily_cash_id, type, amount, payment_method, description } = req.body;
      
      // 🛡️ Si no viene el ID de la caja, buscamos o creamos la caja del día actual automáticamente
      if (!daily_cash_id || daily_cash_id === 'undefined' || daily_cash_id === '') {
        const dateRes = await pool.query(
          `SELECT (NOW() AT TIME ZONE 'America/Argentina/Cordoba')::date::text as today`
        );
        const today = dateRes.rows[0].today;
        
        let cashRes = await pool.query(
          'SELECT id FROM daily_cash WHERE cash_date::date = $1::date ORDER BY id DESC LIMIT 1', 
          [today]
        );

        if (cashRes.rows.length === 0) {
          cashRes = await pool.query(
            "INSERT INTO daily_cash (cash_date, total_incomes, total_expenses, closing_balance, status) VALUES ($1, 0, 0, 0, 'OPEN') RETURNING id",
            [today]
          );
        }
        daily_cash_id = cashRes.rows[0].id;
      }

      const newMov = await pool.query(
        `INSERT INTO cash_movements (daily_cash_id, type, amount, payment_method, description, created_at) 
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
        [daily_cash_id, type, amount, payment_method, description]
      );

      if (type === 'INCOME' || type === 'INGRESO') {
        await pool.query('UPDATE daily_cash SET total_incomes = total_incomes + $1 WHERE id = $2', [amount, daily_cash_id]);
      } else {
        await pool.query('UPDATE daily_cash SET total_expenses = total_expenses + $1 WHERE id = $2', [amount, daily_cash_id]);
      }

      res.json(newMov.rows[0]);
    } catch (err) {
      console.error('Error al registrar movimiento:', err);
      res.status(500).json({ error: 'Error al registrar movimiento' });
    }
  });

  // PUT: Modificar un movimiento de caja (Nota: como el prefijo de la ruta en app.js suele ser /api/caja, aquí definimos /movimientos/:id)
  router.put('/movimientos/:id', async (req, res) => {
    const { id } = req.params;
    const { amount, payment_method, description } = req.body;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const movAntRes = await client.query('SELECT * FROM cash_movements WHERE id = $1', [id]);
      if (movAntRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Movimiento no encontrado' });
      }
      const movViejo = movAntRes.rows[0];
      const diferencia = parseFloat(amount) - parseFloat(movViejo.amount);

      await client.query(
        `UPDATE cash_movements SET amount = $1, payment_method = $2, description = $3 WHERE id = $4`,
        [amount, payment_method, description, id]
      );

      if (movViejo.type === 'INCOME' || movViejo.type === 'INGRESO') {
        await client.query(`UPDATE daily_cash SET total_incomes = total_incomes + $1 WHERE id = $2`, [diferencia, movViejo.daily_cash_id]);
      } else {
        await client.query(`UPDATE daily_cash SET total_expenses = total_expenses + $1 WHERE id = $2`, [diferencia, movViejo.daily_cash_id]);
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error al actualizar movimiento de caja:', err);
      res.status(500).json({ error: 'Error al actualizar movimiento' });
    } finally {
      client.release();
    }
  });

  // DELETE: Eliminar un movimiento de caja
  router.delete('/movimientos/:id', async (req, res) => {
    const { id } = req.params;
    
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const movRes = await client.query('SELECT * FROM cash_movements WHERE id = $1', [id]);
      if (movRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Movimiento no encontrado' });
      }
      const mov = movRes.rows[0];

      await client.query('DELETE FROM cash_movements WHERE id = $1', [id]);

      if (mov.type === 'INCOME' || mov.type === 'INGRESO') {
        await client.query(`UPDATE daily_cash SET total_incomes = total_incomes - $1 WHERE id = $2`, [mov.amount, mov.daily_cash_id]);
      } else {
        await client.query(`UPDATE daily_cash SET total_expenses = total_expenses - $1 WHERE id = $2`, [mov.amount, mov.daily_cash_id]);
      }

      await client.query('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Error al eliminar movimiento de caja:', err);
      res.status(500).json({ error: 'Error al eliminar movimiento' });
    } finally {
      client.release();
    }
  });

  // POST: Cerrar la caja del día (Con cálculo automático en vivo)
  router.post('/cerrar', async (req, res) => {
    try {
      const { daily_cash_id } = req.body;
      
      const sumRes = await pool.query(
        `SELECT 
          COALESCE(SUM(CASE WHEN type IN ('INCOME', 'INGRESO') THEN amount ELSE 0 END), 0) as incomes,
          COALESCE(SUM(CASE WHEN type IN ('EXPENSE', 'EGRESO') THEN amount ELSE 0 END), 0) as expenses
         FROM cash_movements 
         WHERE daily_cash_id = $1`,
        [daily_cash_id]
      );

      const incomes = parseFloat(sumRes.rows[0].incomes);
      const expenses = parseFloat(sumRes.rows[0].expenses);
      const balance = incomes - expenses;

      const updated = await pool.query(
        `UPDATE daily_cash 
         SET status = 'CLOSED', total_incomes = $1, total_expenses = $2, closing_balance = $3, closed_at = NOW() 
         WHERE id = $4 RETURNING *`,
        [incomes, expenses, balance, daily_cash_id]
      );

      if (updated.rows.length === 0) return res.status(404).json({ error: 'Caja no encontrada' });

      res.json(updated.rows[0]);
    } catch (err) {
      console.error('Error al cerrar caja:', err);
      res.status(500).json({ error: 'Error al cerrar caja' });
    }
  });

  // GET: Resumen Mensual
  router.get('/mensual/:anio/:mes', async (req, res) => {
    try {
      const { anio, mes } = req.params;
      const query = `
        SELECT 
          id, cash_date, total_incomes, total_expenses, closing_balance, status 
        FROM daily_cash 
        WHERE EXTRACT(YEAR FROM cash_date) = $1 AND EXTRACT(MONTH FROM cash_date) = $2
        ORDER BY cash_date ASC
      `;
      const result = await pool.query(query, [anio, mes]);
      res.json(result.rows);
    } catch (err) {
      console.error('Error al obtener resumen mensual:', err);
      res.status(500).json({ error: 'Error al obtener resumen mensual' });
    }
  });

  return router; // 👈 ¡OBLIGATORIO RETORNAR EL ROUTER!
};