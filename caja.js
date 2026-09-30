const express = require('express');
const router = express.Router();

module.exports = (pool) => {

  // GET: Obtener movimientos y estado de la caja de hoy (Corregido con Zona Horaria)
  router.get('/hoy', async (req, res) => {
    try {
      // 🔒 AUTO-CIERRE: Cerrar automáticamente cajas de días anteriores que quedaron abiertas
      await pool.query(
        `UPDATE daily_cash 
         SET status = 'CLOSED', closed_at = NOW() 
         WHERE status = 'OPEN' AND cash_date::date < CURRENT_DATE`
      );

      // Fecha local (YYYY-MM-DD)
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const today = `${year}-${month}-${day}`;
      
      // Búsqueda directa por tipo DATE en PostgreSQL (evita fallos de LIKE en timestamps)
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

      // Traer movimientos asegurando el ID de caja O contemplando la fecha en la zona horaria de la DB
      const movementsRes = await pool.query(
        `SELECT * FROM cash_movements 
         WHERE daily_cash_id = $1 
            OR (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Argentina/Cordoba')::date = $2::date 
         ORDER BY created_at DESC`,
        [dailyCash.id, today]
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

  // GET: Obtener movimientos y totales de una caja especifica por ID (Histórica / Cerrada)
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
         WHERE daily_cash_id = $1 OR created_at::date = $2::date 
         ORDER BY created_at ASC`,
        [dailyCash.id, dailyCash.cash_date]
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

  // POST: Cargar un movimiento manual (Ingreso o Egreso)
  router.post('/movimiento', async (req, res) => {
    try {
      const { daily_cash_id, type, amount, payment_method, description } = req.body;
      
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

  // POST: Cerrar la caja del día
  router.post('/cerrar', async (req, res) => {
    try {
      const { daily_cash_id } = req.body;
      
      const cashRes = await pool.query('SELECT * FROM daily_cash WHERE id = $1', [daily_cash_id]);
      if (cashRes.rows.length === 0) return res.status(404).json({ error: 'Caja no encontrada' });
      
      const cash = cashRes.rows[0];
      const balance = parseFloat(cash.total_incomes) - parseFloat(cash.total_expenses);

      const updated = await pool.query(
        `UPDATE daily_cash 
         SET status = 'CLOSED', closing_balance = $1, closed_at = NOW() 
         WHERE id = $2 RETURNING *`,
        [balance, daily_cash_id]
      );

      res.json(updated.rows[0]);
    } catch (err) {
      console.error('Error al cerrar caja:', err);
      res.status(500).json({ error: 'Error al cerrar caja' });
    }
  });

  // GET: Resumen Mensual (Incluye 'id' para poder consultar el detalle)
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

  return router;
};
