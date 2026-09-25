const express = require('express');
const router = express.Router();

// Exportamos una función que recibe el 'pool' de la base de datos
module.exports = (pool) => {

  // GET: Obtener movimientos y estado de la caja de hoy
  router.get('/hoy', async (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      let cashRes = await pool.query('SELECT * FROM daily_cash WHERE cash_date = $1', [today]);
      if (cashRes.rows.length === 0) {
        cashRes = await pool.query(
          'INSERT INTO daily_cash (cash_date) VALUES ($1) RETURNING *',
          [today]
        );
      }
      const dailyCash = cashRes.rows[0];

      const movementsRes = await pool.query(
        'SELECT * FROM cash_movements WHERE daily_cash_id = $1 ORDER BY created_at DESC',
        [dailyCash.id]
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

  // POST: Cargar un movimiento (Ingreso o Egreso)
  router.post('/movimiento', async (req, res) => {
    try {
      const { daily_cash_id, type, amount, payment_method, description } = req.body;
      
      const newMov = await pool.query(
        `INSERT INTO cash_movements (daily_cash_id, type, amount, payment_method, description) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [daily_cash_id, type, amount, payment_method, description]
      );

      if (type === 'INCOME') {
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

  // GET: Resumen Mensual
  router.get('/mensual/:anio/:mes', async (req, res) => {
    try {
      const { anio, mes } = req.params;
      const query = `
        SELECT 
          cash_date, total_incomes, total_expenses, closing_balance, status 
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