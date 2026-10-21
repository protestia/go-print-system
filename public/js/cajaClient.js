// ==========================================
// MÓDULO DE CAJA DIARIA - CLIENTE
// ==========================================

// Cargar la caja activa del día
// Cargar la caja activa del día
async function cargarCajaHoy() {
  try {
    // 🛡️ Agregamos un timestamp aleatorio (_t) y no-store para evitar el código 304 del navegador
    const res = await fetch(`/api/caja/hoy?_t=${new Date().getTime()}`, { cache: 'no-store' });
    const data = await res.json();
    const caja = data.dailyCash;

    if (!caja) return;

    // ✅ AHORA
const elemFecha = document.getElementById('caja-fecha-actual');
if (elemFecha && caja.cash_date) {
  const [a, m, d] = caja.cash_date.split('T')[0].split('-');
  elemFecha.innerText = `Caja Diaria: ${d}/${m}/${a}`;
}

    const elemIngresos = document.getElementById('caja-total-ingresos');
    if (elemIngresos) elemIngresos.innerText = `$${parseFloat(caja.total_incomes || 0).toLocaleString('es-AR')}`;

    const elemEgresos = document.getElementById('caja-total-egresos');
    if (elemEgresos) elemEgresos.innerText = `$${parseFloat(caja.total_expenses || 0).toLocaleString('es-AR')}`;
    
    const saldo = parseFloat(caja.total_incomes || 0) - parseFloat(caja.total_expenses || 0);
    const elemSaldo = document.getElementById('caja-saldo-neto');
    if (elemSaldo) elemSaldo.innerText = `$${saldo.toLocaleString('es-AR')}`;

    const inputHiddenId = document.getElementById('caja-id-hidden');
    if (inputHiddenId) inputHiddenId.value = caja.id;

    const btnCerrar = document.getElementById('btn-cerrar-caja');
    if (btnCerrar) {
      if (caja.status === 'CLOSED') {
        btnCerrar.innerText = '🔒 Caja Cerrada';
        btnCerrar.disabled = true;
        btnCerrar.style.backgroundColor = '#9ca3af';
      } else {
        btnCerrar.innerText = '🔒 Cerrar Caja del Día';
        btnCerrar.disabled = false;
        btnCerrar.style.backgroundColor = '#ef4444';
      }
    }

    const tbody = document.getElementById('tabla-caja-movimientos');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!data.movements || data.movements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: #888;">No hay movimientos registrados en el día.</td></tr>';
      return;
    }

    data.movements.forEach(m => {
      const hora = new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const esIngreso = m.type === 'INCOME' || m.type === 'INGRESO';
      
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #e2e8f0';
      tr.innerHTML = `
        <td style="padding: 12px 15px;">${hora}</td>
        <td style="padding: 12px 15px; font-weight: bold; color: ${esIngreso ? '#10b981' : '#ef4444'};">${esIngreso ? 'INGRESO' : 'EGRESO'}</td>
        <td style="padding: 12px 15px; font-weight: bold;">$${parseFloat(m.amount).toLocaleString('es-AR')}</td>
        <td style="padding: 12px 15px; color: #6b7280; font-weight: bold;">${m.payment_method || '-'}</td>
        <td style="padding: 12px 15px;">${m.description || '-'}</td>
        <td style="padding: 12px 15px; text-align: center;">
          <button onclick="editarMovimientoCaja(${m.id}, ${m.amount}, '${m.payment_method || 'EFECTIVO'}', '${(m.description || '').replace(/'/g, "\\'")}')" style="background: none; border: none; cursor: pointer; font-size: 1rem;" title="Editar">✏️</button>
          <button onclick="eliminarMovimientoCaja(${m.id})" style="background: none; border: none; cursor: pointer; color: #ef4444; font-size: 1.1rem; margin-left: 8px;" title="Eliminar">❌</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error al cargar la caja de hoy:', err);
  }
}

// Registrar movimiento manual (Ingreso / Egreso)
async function registrarMovimientoCaja(e) {
  if (e) e.preventDefault();
  
  let daily_cash_id = document.getElementById('caja-id-hidden')?.value;
  const type = document.getElementById('caja-tipo').value;
  const amount = document.getElementById('caja-monto').value;
  const payment_method = document.getElementById('caja-metodo').value;
  const description = document.getElementById('caja-descripcion').value;

  if (!amount) {
    alert('⚠️ Complete los campos requeridos para registrar el movimiento.');
    return;
  }

  try {
    const res = await fetch('/api/caja/movimiento', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_cash_id, type, amount, payment_method, description })
    });

    if (res.ok) {
      const form = document.getElementById('form-caja');
      if (form) form.reset();
      
      // Esperar un instante para que el backend procese el commit y luego recargar la caja
      setTimeout(async () => {
        await cargarCajaHoy();
      }, 150);
    } else {
      alert('❌ No se pudo registrar el movimiento.');
    }
  } catch (err) {
    console.error('Error al registrar movimiento:', err);
  }
}

// Modificar un movimiento de caja existente
async function editarMovimientoCaja(id, montoActual, metodoActual, descActual) {
  const nuevoMonto = prompt('Modificar Monto ($):', montoActual);
  if (nuevoMonto === null) return;

  const nuevoMetodo = prompt('Modificar Método de Pago (EFECTIVO / TRANSFERENCIA / etc.):', metodoActual);
  if (nuevoMetodo === null) return;

  const nuevaDesc = prompt('Modificar Detalle / Cliente:', descActual);
  if (nuevaDesc === null) return;

  try {
    const res = await fetch(`/api/caja/movimientos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: parseFloat(nuevoMonto), payment_method: nuevoMetodo, description: nuevaDesc })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      cargarCajaHoy();
    } else {
      alert('❌ No se pudo actualizar el movimiento.');
    }
  } catch (err) {
    console.error('Error al editar movimiento:', err);
  }
}

// Eliminar un movimiento de caja
async function eliminarMovimientoCaja(id) {
  if (!confirm('⚠️ ¿Estás seguro de eliminar este movimiento de la caja?')) return;

  try {
    const res = await fetch(`/api/caja/movimientos/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok && data.success) {
      cargarCajaHoy();
    } else {
      alert('❌ No se pudo eliminar el movimiento.');
    }
  } catch (err) {
    console.error('Error al eliminar movimiento:', err);
  }
}

// Cerrar caja diaria
async function cerrarCajaDiaria() {
  const daily_cash_id = document.getElementById('caja-id-hidden')?.value;
  if (!daily_cash_id) return;

  if (!confirm('⚠️ ¿Estás seguro de que deseas realizar el cierre definitivo de la caja de hoy?')) return;

  try {
    const res = await fetch('/api/caja/cerrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily_cash_id })
    });

    if (res.ok) {
      alert('✅ Caja cerrada exitosamente.');
      cargarCajaHoy();
    } else {
      alert('❌ Error al intentar cerrar la caja.');
    }
  } catch (err) {
    console.error('Error al cerrar caja:', err);
  }
}

// Cargar Resumen Mensual de Cajas Históricas
async function cargarResumenMensual() {
  const selectMes = document.getElementById('caja-mes');
  const inputAnio = document.getElementById('caja-anio');
  
  if (!selectMes || !inputAnio) return;

  // Omoĩ jasy ha ary ápe gogua oñepyrũrõ
  if (!selectMes.dataset.inicializado) {
    const hoy = new Date();
    selectMes.value = (hoy.getMonth() + 1).toString(); // getMonth() ome'ẽ 0-11
    inputAnio.value = hoy.getFullYear().toString();
    selectMes.dataset.inicializado = "true";
  }

  const mes = selectMes.value;
  const anio = inputAnio.value;

  try {
    const res = await fetch(`/api/caja/mensual/${anio}/${mes}`);
    const data = await res.json();

    const tbody = document.getElementById('tabla-caja-mensual');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #888;">No hay cierres de caja registrados para este mes.</td></tr>';
      return;
    }

    data.forEach(c => {
      // Ombohasa fecha texto ruvicha (YYYY-MM-DD) ani omoambue hora
      const fechaStr = c.cash_date ? c.cash_date.split('T')[0] : '';
      const [a, m, d] = fechaStr.split('-');
      const fecha = fechaStr ? `${d}/${m}/${a}` : '-';

      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #e2e8f0';
      tr.innerHTML = `
        <td style="padding: 10px;">${fecha}</td>
        <td style="padding: 10px; color: #10b981; font-weight: bold;">$${parseFloat(c.total_incomes || 0).toLocaleString('es-AR')}</td>
        <td style="padding: 10px; color: #ef4444; font-weight: bold;">$${parseFloat(c.total_expenses || 0).toLocaleString('es-AR')}</td>
        <td style="padding: 10px; font-weight: bold;">$${parseFloat(c.closing_balance || 0).toLocaleString('es-AR')}</td>
        <td style="padding: 10px;">${c.status === 'CLOSED' ? '🔴 Cerrada' : '🟢 Abierta'}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error al cargar resumen mensual:', err);
  }
}

// Consultar y desplegar detalle de una caja pasada en Modal
async function verDetalleCajaHistorica(cajaId) {
  try {
    const res = await fetch(`/api/caja/detalle/${cajaId}`);
    const data = await res.json();

const fechaStr = data.dailyCash.cash_date ? data.dailyCash.cash_date.split('T')[0] : '';
const [a, m, d] = fechaStr.split('-');
const fechaFormateada = fechaStr ? `${d}/${m}/${a}` : '-';
    document.getElementById('detalle-caja-titulo').innerText = `📜 Detalle de Caja del Día: ${fechaFormateada}`;
    
    document.getElementById('det-ingresos').innerText = `$${parseFloat(data.dailyCash.total_incomes || 0).toLocaleString('es-AR')}`;
    document.getElementById('det-egresos').innerText = `$${parseFloat(data.dailyCash.total_expenses || 0).toLocaleString('es-AR')}`;
    document.getElementById('det-saldo').innerText = `$${parseFloat(data.dailyCash.closing_balance || 0).toLocaleString('es-AR')}`;

    const tbody = document.getElementById('tabla-detalle-caja-body');
    tbody.innerHTML = '';

    if (!data.movements || data.movements.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 15px; color: #888;">No hubo movimientos registrados en este día.</td></tr>';
    } else {
      data.movements.forEach(m => {
        const hora = new Date(m.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        const esIngreso = m.type === 'INCOME' || m.type === 'INGRESO';
        
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #eee';
        tr.innerHTML = `
          <td style="padding: 8px;">${hora}</td>
          <td style="padding: 8px; font-weight: bold; color: ${esIngreso ? '#10b981' : '#ef4444'};">${esIngreso ? 'INGRESO' : 'EGRESO'}</td>
          <td style="padding: 8px; font-weight: bold;">$${parseFloat(m.amount).toLocaleString('es-AR')}</td>
          <td style="padding: 8px; color: #6b7280; font-weight: bold;">${m.payment_method || '-'}</td>
          <td style="padding: 8px;">${m.description || '-'}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    const modalDetalle = document.getElementById('modal-detalle-caja');
    if (modalDetalle) modalDetalle.style.display = 'flex';
  } catch (err) {
    console.error('Error al abrir detalle:', err);
    alert('❌ No se pudo cargar el detalle de esta caja.');
  }
}
