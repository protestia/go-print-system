// ==========================================
// MÓDULO DE CLIENTES Y CUENTAS - CLIENTE (OPTIMIZADO)
// ==========================================

let paginaActualClientes = 1;
let terminoBusquedaClientes = '';

// Obtener y mostrar clientes con paginación y búsqueda global (Lógica de saldo corregida)
async function cargarClientes(pagina = 1, busqueda = '') {
  paginaActualClientes = pagina;
  terminoBusquedaClientes = busqueda;

  try {
    const res = await fetch(`/api/clientes?page=${pagina}&limit=10&search=${encodeURIComponent(busqueda)}`);
    if (!res.ok) throw new Error('Error en la respuesta del servidor');
    
    const data = await res.json();
    const gridClientes = document.getElementById('grid-clientes');
    if (!gridClientes) return;
    gridClientes.innerHTML = '';

    const listaClientes = data.clientes || [];

    if (listaClientes.length === 0) {
      gridClientes.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 20px; color: #888; background: white; border-radius: 8px;">No hay clientes registrados o que coincidan con la búsqueda.</div>';
      renderizarPaginacionClientes(1, 1);
      return;
    }
    
    listaClientes.forEach(c => {
      const saldoNum = parseFloat(c.saldo || 0);

      // 💡 LÓGICA DE SALDO Y COLORES CORREGIDA:
      // Deuda (saldoNum > 0) -> Rojo (#ef4444)
      // Crédito a favor (saldoNum < 0) -> Verde (#10b981)
      // Al día (saldoNum === 0) -> Gris (#6b7280)
      const colorSaldo = saldoNum > 0 ? '#ef4444' : (saldoNum < 0 ? '#10b981' : '#6b7280');

      // Formato visual claro para el saldo
      let textoSaldoMostrar = `$${saldoNum.toLocaleString('es-AR')}`;
      if (saldoNum < 0) {
        textoSaldoMostrar = `+$${Math.abs(saldoNum).toLocaleString('es-AR')} (A Favor)`;
      } else if (saldoNum > 0) {
        textoSaldoMostrar = `$${saldoNum.toLocaleString('es-AR')} (Deuda)`;
      } else {
        textoSaldoMostrar = `$0 (Al día)`;
      }

      const activeOrders = c.active_orders || 0;

      const card = document.createElement('div');
      card.style.cssText = 'background: white; padding: 20px; border-radius: 10px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: space-between; position: relative;';
      card.innerHTML = `
        <div>
          <!-- Botón de eliminar arriba a la derecha -->
          <button onclick="eliminarCliente(${c.id})" title="Eliminar cliente" style="position: absolute; top: 15px; right: 15px; background: none; border: none; cursor: pointer; font-size: 1.1rem;">🗑️</button>

          <h3 style="margin: 0 0 6px 0; color: #5b3693; padding-right: 25px;">${c.company || c.name || 'Sin Nombre'}</h3>
          <p style="margin: 0 0 12px 0; font-size: 0.95rem; color: #475569; font-weight: 500;">👤 ${c.name || '-'}</p>
          
          <p style="margin: 10px 0 4px 0; font-size: 0.95rem;"><strong>Saldo:</strong> <span style="font-weight: bold; color: ${colorSaldo};">${textoSaldoMostrar}</span></p>
          <p style="margin: 4px 0 10px 0; font-size: 0.9rem; color: #d97706; font-weight: bold;">🟡 ÓRDENES ACTIVAS: ${activeOrders}</p>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 15px; border-top: 1px solid #f1f5f9; padding-top: 12px;">
          <button onclick="verCuentaCliente(${c.id})" style="flex: 1; background: #5b3693; color: white; border: none; padding: 8px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">📜 Cuenta</button>
          <button onclick="verDatosCliente(${c.id})" style="flex: 1; background: #3b82f6; color: white; border: none; padding: 8px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.85rem;">✏️ Datos</button>
        </div>
      `;
      gridClientes.appendChild(card);
    });

    // Renderizar botones de paginación
    renderizarPaginacionClientes(data.currentPage, data.totalPages);

  } catch (err) {
    console.error('Error al cargar clientes:', err);
  }
}
// 🗑️ Función para eliminar un cliente
async function eliminarCliente(clientId) {
  if (!confirm('⚠️ ¿Estás seguro de que deseas eliminar este cliente? Esta acción no se puede deshacer.')) return;

  try {
    const res = await fetch(`/api/clientes/${clientId}`, {
      method: 'DELETE'
    });

    const data = await res.json();
    if (res.ok && data.success) {
      cargarClientes(paginaActualClientes, terminoBusquedaClientes);
    } else {
      alert('❌ ' + (data.error || 'No se pudo eliminar el cliente.'));
    }
  } catch (err) {
    console.error('Error al eliminar el cliente:', err);
    alert('❌ Error de conexión al intentar eliminar el cliente.');
  }
}

// Cambiar de página (Anterior / Siguiente)
function cambiarPaginaClientes(delta) {
  const nuevaPagina = paginaActualClientes + delta;
  if (nuevaPagina > 0) {
    cargarClientes(nuevaPagina, terminoBusquedaClientes);
  }
}

// Renderizar controles visuales de paginación debajo de la grilla
function renderizarPaginacionClientes(actual, total) {
  let paginacionDiv = document.getElementById('paginacion-clientes-container');
  if (!paginacionDiv) {
    paginacionDiv = document.createElement('div');
    paginacionDiv.id = 'paginacion-clientes-container';
    paginacionDiv.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 15px; margin: 20px 0; grid-column: 1 / -1;';
    const grid = document.getElementById('grid-clientes');
    if (grid && grid.parentNode) {
      grid.parentNode.insertBefore(paginacionDiv, grid.nextSibling);
    }
  }

  paginacionDiv.innerHTML = `
    <button onclick="cambiarPaginaClientes(-1)" ${actual <= 1 ? 'disabled style="opacity:0.5; cursor:not-allowed; padding:6px 12px; border-radius:6px; border:1px solid #ccc; background:#fff;"' : 'style="cursor:pointer; padding:6px 12px; border-radius:6px; border:1px solid #5b3693; background:#5b3693; color:#fff;"'}>◀ Anterior</button>
    <span style="font-weight: bold; font-size: 0.95rem;">Página ${actual} de ${total}</span>
    <button onclick="cambiarPaginaClientes(1)" ${actual >= total ? 'disabled style="opacity:0.5; cursor:not-allowed; padding:6px 12px; border-radius:6px; border:1px solid #ccc; background:#fff;"' : 'style="cursor:pointer; padding:6px 12px; border-radius:6px; border:1px solid #5b3693; background:#5b3693; color:#fff;"'}>Siguiente ▶</button>
  `;
}

// Filtrar clientes en vivo desde el buscador (Búsqueda global con retardo para optimizar)
function filtrarClientes() {
  const query = document.getElementById('buscar-cliente')?.value || '';
  clearTimeout(window.searchTimeoutClientes);
  window.searchTimeoutClientes = setTimeout(() => {
    cargarClientes(1, query); // Vuelve a la página 1 aplicando la búsqueda en todo el servidor
  }, 300);
}

// Abrir modal para crear nuevo cliente
function abrirModalNuevoCliente() {
  const form = document.querySelector('#modal-nuevo-cliente form');
  if (form) form.reset();
  const idHidden = document.getElementById('cliente-id');
  if (idHidden) idHidden.value = '';
  
  const titulo = document.getElementById('modal-cliente-titulo');
  if (titulo) titulo.innerText = '➕ Registrar Nuevo Cliente';

  const modal = document.getElementById('modal-nuevo-cliente');
  if (modal) modal.style.display = 'flex';
}

// Guardar o Actualizar Cliente
async function guardarCliente(e) {
  if (e) e.preventDefault();
  
  const id = document.getElementById('cliente-id')?.value;
  const company = document.getElementById('cliente-empresa')?.value;
  const name = document.getElementById('cliente-nombre')?.value;
  const phone = document.getElementById('cliente-telefono')?.value;
  const dni_cuit = document.getElementById('cliente-dni')?.value;
  const address = document.getElementById('cliente-direccion')?.value;
  const email = document.getElementById('cliente-email')?.value;
  const notes = document.getElementById('cliente-notas')?.value;

  const url = id ? `/api/clientes/${id}` : '/api/clientes';
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company, name, phone, dni_cuit, address, email, notes })
    });

    if (res.ok) {
      cerrarModalCliente('modal-nuevo-cliente');
      cargarClientes(paginaActualClientes, terminoBusquedaClientes);
    } else {
      alert('❌ No se pudo guardar el cliente.');
    }
  } catch (err) {
    console.error('Error al guardar cliente:', err);
  }
}

// Ver datos detallados del cliente
async function verDatosCliente(clientId) {
  try {
    const res = await fetch(`/api/clientes/${clientId}`);
    const cliente = await res.json();

    const body = document.getElementById('modal-datos-body');
    if (body) {
      body.innerHTML = `
        <p><strong>Empresa:</strong> ${cliente.company || '-'}</p>
        <p><strong>Contacto:</strong> ${cliente.name || '-'}</p>
        <p><strong>Celular:</strong> ${cliente.phone || '-'}</p>
        <p><strong>DNI / CUIT:</strong> ${cliente.dni_cuit || '-'}</p>
        <p><strong>Dirección:</strong> ${cliente.address || '-'}</p>
        <p><strong>Email:</strong> ${cliente.email || '-'}</p>
        <p><strong>Notas:</strong> ${cliente.notes || '-'}</p>
      `;
    }

    const btnEditar = document.getElementById('btn-editar-cliente-modal');
    if (btnEditar) {
      btnEditar.onclick = () => {
        cerrarModalCliente('modal-datos-cliente');
        abrirModalEditarCliente(cliente);
      };
    }

    const modal = document.getElementById('modal-datos-cliente');
    if (modal) modal.style.display = 'flex';
  } catch (err) {
    console.error('Error al obtener datos del cliente:', err);
  }
}

function abrirModalEditarCliente(c) {
  document.getElementById('cliente-id').value = c.id;
  document.getElementById('cliente-empresa').value = c.company || '';
  document.getElementById('cliente-nombre').value = c.name || '';
  document.getElementById('cliente-telefono').value = c.phone || '';
  document.getElementById('cliente-dni').value = c.dni_cuit || '';
  document.getElementById('cliente-direccion').value = c.address || '';
  document.getElementById('cliente-email').value = c.email || '';
  document.getElementById('cliente-notas').value = c.notes || '';

  document.getElementById('modal-cliente-titulo').innerText = '✏️ Editar Cliente';
  document.getElementById('modal-nuevo-cliente').style.display = 'flex';
}

// Ver resumen completo de la cuenta corriente de un cliente
async function verCuentaCliente(clientId) {
  try {
    const res = await fetch(`/api/clientes/${clientId}/cuenta`);
    if (!res.ok) throw new Error('No se pudo obtener la cuenta');
    
    const data = await res.json();

    const elemTitulo = document.getElementById('cuenta-cliente-titulo');
    if (elemTitulo) elemTitulo.innerText = `📜 Estado de Cuenta: ${data.cliente ? (data.cliente.company || data.cliente.name) : 'Cliente'}`;
    
    const elemHiddenId = document.getElementById('pago-cliente-id');
    if (elemHiddenId) elemHiddenId.value = clientId;

    const saldoNum = parseFloat(data.saldo_final || 0);
    const resumen = document.getElementById('cuenta-cliente-resumen');
    if (resumen) {
      let textoSaldo = `Deuda Pendiente: $${saldoNum.toLocaleString('es-AR')}`;
      let bgColor = '#fee2e2'; 
      let textColor = '#b91c1c';

      if (saldoNum === 0) {
        textoSaldo = `Cuenta al Día: $0`;
        bgColor = '#f1f5f9';
        textColor = '#475569';
      } else if (saldoNum < 0) {
        textoSaldo = `Saldo a Favor (Crédito): $${Math.abs(saldoNum).toLocaleString('es-AR')}`;
        bgColor = '#ecfdf5'; 
        textColor = '#047857';
      }

      resumen.innerText = textoSaldo;
      resumen.style.backgroundColor = bgColor;
      resumen.style.color = textColor;
    }

    const tbody = document.getElementById('tabla-cuenta-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!data.movimientos || data.movimientos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #888;">No hay movimientos en la cuenta.</td></tr>';
    } else {
      data.movimientos.forEach(m => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid #e2e8f0';
        
        let accionPagoHTML = '-';
        if (m.pagos > 0) {
          accionPagoHTML = `
            <span style="color: #10b981; font-weight: bold;">$${m.pagos.toLocaleString('es-AR')}</span>
            <button onclick="abrirModalEditarPago(${m.id}, ${m.pagos}, '${m.metodo}', '${m.notas || ''}')" title="Editar Pago" style="background:none; border:none; cursor:pointer; margin-left: 6px;">✏️</button>
          `;
        }

        let ordenHTML = m.num_orden || '-';
        if (m.tipo === 'orden' && m.ot_numero) {
          ordenHTML = `
            <button onclick="irAOrdenDesdeCuenta(${m.ot_numero}, '${m.status}')" style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; padding: 4px 8px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 0.85rem;" title="Ir a la orden en el panel">
              ${m.num_orden} ↗
            </button>
          `;
        }

        tr.innerHTML = `
          <td style="padding: 10px;">${m.fecha || '-'}</td>
          <td style="padding: 10px; font-weight: bold;">${ordenHTML}</td>
          <td style="padding: 10px; text-align: right; color: #ef4444; font-weight: bold;">${m.importe > 0 ? '$' + m.importe.toLocaleString('es-AR') : '-'}</td>
          <td style="padding: 10px; text-align: center; color: #6b7280;">${m.metodo || '-'}</td>
          <td style="padding: 10px; text-align: right;">${accionPagoHTML}</td>
          <td style="padding: 10px; text-align: right; font-weight: bold;">$${m.total_saldo ? m.total_saldo.toLocaleString('es-AR') : '0'}</td>
          <td style="padding: 10px; text-align: center;">
            <button onclick="eliminarMovimientoCuenta('${m.tipo}', ${m.id}, ${clientId})" title="Eliminar" style="background:none; border:none; cursor:pointer; color: #ef4444; font-weight: bold;">✕</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    const btnPago = document.getElementById('btn-agregar-pago-cliente');
    if (btnPago) {
      btnPago.onclick = () => {
        document.getElementById('pago-cliente-id').value = clientId;
        document.getElementById('pago-id-hidden').value = '';
        document.getElementById('pago-monto').value = '';
        document.getElementById('pago-notas').value = '';
        const btnEliminarPago = document.getElementById('btn-eliminar-pago');
        if (btnEliminarPago) btnEliminarPago.style.display = 'none';
        document.getElementById('modal-registrar-pago-directo').style.display = 'flex';
      };
    }

    const btnCargo = document.getElementById('btn-cargo-manual');
    if (btnCargo) {
      btnCargo.onclick = () => abrirModalCargoManual();
    }

    const btnDescargar = document.getElementById('btn-descargar-cuenta');
    if (btnDescargar) {
      btnDescargar.onclick = () => descargarEstadoCuentaPDF();
    }

    const modal = document.getElementById('modal-cuenta-cliente');
    if (modal) modal.style.display = 'flex';
  } catch (err) {
    console.error('Error al ver cuenta corriente:', err);
  }
}

function cerrarModalCliente(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

async function guardarPagoClienteDirecto(e) {
  if (e) e.preventDefault();
  
  const cliente_id = document.getElementById('pago-cliente-id')?.value;
  const pagoId = document.getElementById('pago-id-hidden')?.value;
  const monto = document.getElementById('pago-monto')?.value;
  const metodo_pago = document.getElementById('pago-metodo')?.value;
  const notas = document.getElementById('pago-notas')?.value;

  if (!cliente_id || !monto) {
    alert('⚠️ Complete el monto del pago.');
    return;
  }

  const url = pagoId ? `/api/clientes/pagos/${pagoId}` : '/api/clientes/pagos';
  const method = pagoId ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id, monto, metodo_pago, notas })
    });

    if (res.ok) {
      cerrarModalCliente('modal-registrar-pago-directo');
      verCuentaCliente(cliente_id);
      cargarClientes(paginaActualClientes, terminoBusquedaClientes);
    } else {
      alert('❌ No se pudo guardar el pago.');
    }
  } catch (err) {
    console.error('Error al guardar pago:', err);
  }
}

function abrirModalCargoManual() {
  const clienteId = document.getElementById('pago-cliente-id')?.value;
  if (!clienteId) return;
  
  const concepto = prompt('📝 Ingresa el concepto del cargo (ej: Saldo anterior, Diseño extra, etc.):');
  if (!concepto) return;
  
  const monto = prompt('💲 Ingresa el monto del cargo (en ARS):');
  if (!monto || isNaN(monto)) return;

  registrarCargoManual(clienteId, concepto, parseFloat(monto));
}

async function registrarCargoManual(cliente_id, concepto, monto) {
  try {
    const res = await fetch('/api/clientes/cargos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id, concepto, monto })
    });

    if (res.ok) {
      verCuentaCliente(cliente_id);
      cargarClientes(paginaActualClientes, terminoBusquedaClientes);
    } else {
      alert('❌ No se pudo registrar el cargo manual.');
    }
  } catch (err) {
    console.error('Error al registrar cargo:', err);
  }
}

function abrirModalEditarPago(pagoId, montoActual, metodoActual, notasActuales) {
  document.getElementById('pago-id-hidden').value = pagoId;
  document.getElementById('pago-monto').value = montoActual;
  document.getElementById('pago-metodo').value = metodoActual || 'EFECTIVO';
  document.getElementById('pago-notas').value = notasActuales || '';
  
  const btnEliminar = document.getElementById('btn-eliminar-pago');
  if (btnEliminar) btnEliminar.style.display = 'block';

  document.getElementById('modal-registrar-pago-directo').style.display = 'flex';
}

async function eliminarMovimientoCuenta(tipo, id, clienteId) {
  if (!confirm('¿Estás seguro de eliminar este registro de la cuenta?')) return;

  const endpoint = tipo === 'pago' ? `/api/clientes/pagos/${id}` : `/api/clientes/cargos/${id}`;

  try {
    const res = await fetch(endpoint, { method: 'DELETE' });
    if (res.ok) {
      verCuentaCliente(clienteId);
      cargarClientes(paginaActualClientes, terminoBusquedaClientes);
    } else {
      alert('❌ No se pudo eliminar el registro.');
    }
  } catch (err) {
    console.error('Error al eliminar movimiento:', err);
  }
}

function descargarEstadoCuentaPDF() {
  window.print();
}

// ✅ CÓDIGO CORREGIDO:
function irAOrdenDesdeCuenta(otNumero, status) {
  cerrarModalCliente('modal-cuenta-cliente');

  // Normalizar el estado para asegurar que caiga en la sección correcta
  const st = (status || '').toUpperCase();
  let seccionDestino = 'diseno';

  if (st === 'READY_TO_PRINT' || st === 'IMPRESION') {
    seccionDestino = 'impresion';
  } else if (st === 'READY_TO_DELIVER' || st === 'ENTREGA') {
    seccionDestino = 'entrega';
  } else if (st === 'DELIVERED' || st === 'ENTREGADO' || st === 'HISTORIAL') {
    seccionDestino = 'historial';
  }

  cargarSeccion(seccionDestino);
  
  setTimeout(() => {
    const inputBuscar = document.getElementById('input-buscar');
    if (inputBuscar) {
      // 1. Escribimos únicamente el número puro (ej: "55580")
      inputBuscar.value = otNumero;
      
      // 2. Disparamos la función de filtrado si existe
      if (typeof filtrarOrdenes === 'function') {
        filtrarOrdenes();
      } else if (typeof cargarOrdenes === 'function') {
        cargarOrdenes(1, otNumero);
      }
    }
  }, 300);
}
