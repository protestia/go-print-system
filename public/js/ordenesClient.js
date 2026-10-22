// ==========================================
// MÓDULO DE ÓRDENES Y TARJETAS - CLIENTE
// ==========================================

let paginaActualOrdenes = 1;
let terminoBusquedaOrdenes = '';

// Cargar órdenes con paginación y búsqueda global según la sección actual activa
async function cargarOrdenes(pagina = 1, busqueda = '') {
  paginaActualOrdenes = pagina;
  terminoBusquedaOrdenes = busqueda;

  const estadoMap = {
    diseno: 'PENDING_DESIGN',
    impresion: 'READY_TO_PRINT',
    entrega: 'READY_TO_DELIVER',
    historial: 'DELIVERED'
  };

  const estadoParam = estadoMap[window.seccionActual || 'diseno'] || 'PENDING_DESIGN';
  const contenedor = document.getElementById('orders-container');
  if (!contenedor) return;

  contenedor.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 30px; color: #64748b;">Cargando órdenes...</div>';

  try {
    const res = await fetch(`/api/ordenes/${estadoParam}?page=${pagina}&limit=10&search=${encodeURIComponent(busqueda)}`);
    const data = await res.json();

    contenedor.innerHTML = '';

    const listaOrdenes = Array.isArray(data) ? data : (data.ordenes || []);

    if (listaOrdenes.length === 0) {
      contenedor.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 40px; color: #94a3b8; background: white; border-radius: 8px; font-weight: bold;">No hay órdenes registradas en esta sección.</div>';
      renderizarPaginacionOrdenes(1, 1);
      return;
    }

    listaOrdenes.forEach(ot => {
      const card = crearTarjetaOrdenHTML(ot, window.seccionActual || 'diseno');
      contenedor.appendChild(card);
    });

    renderizarPaginacionOrdenes(data.currentPage || 1, data.totalPages || 1);

  } catch (err) {
    console.error(`Error al cargar órdenes de ${estadoParam}:`, err);
    contenedor.innerHTML = '<div style="grid-column: 1/-1; color: #ef4444; padding: 20px; text-align: center; background: white; border-radius: 8px;">Error al cargar los datos del servidor.</div>';
  }
}

// Cambiar de página (Anterior / Siguiente)
function cambiarPaginaOrdenes(delta) {
  const nuevaPagina = paginaActualOrdenes + delta;
  if (nuevaPagina > 0) {
    cargarOrdenes(nuevaPagina, terminoBusquedaOrdenes);
  }
}

// Renderizar controles visuales de paginación para las órdenes
function renderizarPaginacionOrdenes(actual, total) {
  let paginacionDiv = document.getElementById('paginacion-ordenes-container');
  if (!paginacionDiv) {
    paginacionDiv = document.createElement('div');
    paginacionDiv.id = 'paginacion-ordenes-container';
    paginacionDiv.style.cssText = 'display: flex; justify-content: center; align-items: center; gap: 15px; margin: 20px 0; grid-column: 1 / -1;';
    const contenedor = document.getElementById('orders-container');
    if (contenedor && contenedor.parentNode) {
      contenedor.parentNode.insertBefore(paginacionDiv, contenedor.nextSibling);
    }
  }

  paginacionDiv.innerHTML = `
    <button onclick="cambiarPaginaOrdenes(-1)" ${actual <= 1 ? 'disabled style="opacity:0.5; cursor:not-allowed; padding:6px 12px; border-radius:6px; border:1px solid #ccc; background:#fff;"' : 'style="cursor:pointer; padding:6px 12px; border-radius:6px; border:1px solid #5b3693; background:#5b3693; color:#fff;"'}>◀ Anterior</button>
    <span style="font-weight: bold; font-size: 0.95rem;">Página ${actual} de ${total}</span>
    <button onclick="cambiarPaginaOrdenes(1)" ${actual >= total ? 'disabled style="opacity:0.5; cursor:not-allowed; padding:6px 12px; border-radius:6px; border:1px solid #ccc; background:#fff;"' : 'style="cursor:pointer; padding:6px 12px; border-radius:6px; border:1px solid #5b3693; background:#5b3693; color:#fff;"'}>Siguiente ▶</button>
  `;
}

// Actualizar el buscador global para que consulte al servidor con paginación
function filtrarOrdenes() {
  const query = document.getElementById('input-buscar')?.value || '';
  clearTimeout(window.searchTimeoutOrdenes);
  window.searchTimeoutOrdenes = setTimeout(() => {
    cargarOrdenes(1, query);
  }, 300);
}

// Marcar o desmarcar un ítem como impreso SIN perder el scroll de la página
async function marcarItemImpreso(itemId, is_printed, event) {
  try {
    const res = await fetch(`/api/ordenes/item/printed/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_printed })
    });

    if (res.ok) {
      const card = event.target.closest('.ot-card');
      if (card) {
        const checkboxes = card.querySelectorAll('input[type="checkbox"]');
        const botonEntrega = card.querySelector('button[onclick*="READY_TO_DELIVER"]');
        
        if (botonEntrega) {
          const checkboxesItems = Array.from(checkboxes).filter(cb => cb.onchange && cb.onchange.toString().includes('marcarItemImpreso'));
          const todosListos = checkboxesItems.every(cb => cb.checked);

          if (todosListos) {
            botonEntrega.disabled = false;
            botonEntrega.style.background = 'linear-gradient(90deg, #00d2ff 0%, #0056b3 50%, #00d2ff 100%)';
            botonEntrega.style.cursor = 'pointer';
            botonEntrega.style.fontWeight = '700';
            botonEntrega.style.boxShadow = '0 2px 6px rgba(0, 210, 255, 0.3)';
            botonEntrega.style.textShadow = '0 1px 2px rgba(0,0,0,0.2)';
            botonEntrega.title = 'Pasar a entrega';
          } else {
            botonEntrega.disabled = true;
            botonEntrega.style.background = '#cbd5e1';
            botonEntrega.style.cursor = 'not-allowed';
            botonEntrega.style.fontWeight = 'normal';
            botonEntrega.style.boxShadow = 'none';
            botonEntrega.style.textShadow = 'none';
            botonEntrega.title = 'Debe marcar todos los ítems como impresos para continuar';
          }
        }
      }
    } else {
      alert('❌ No se pudo actualizar el estado de impresión del ítem.');
    }
  } catch (err) {
    console.error('Error al marcar ítem impreso:', err);
  }
}

/// Generar elemento DOM con una estética moderna, limpia y profesional
function crearTarjetaOrdenHTML(ot, columnaActual) {
  const div = document.createElement('div');
  div.className = `ot-card ${ot.is_urgent ? 'urgente' : ''} ${ot.is_priority ? 'prioridad' : ''} ${ot.is_pinned ? 'fijada' : ''}`;
  
  // ---------------------------------------------------------
  // VISTA COMPACTA PARA LA SECCIÓN DE HISTORIAL
  // ---------------------------------------------------------
  // ---------------------------------------------------------
  // VISTA COMPACTA PARA LA SECCIÓN DE HISTORIAL
  // ---------------------------------------------------------
  if (columnaActual === 'historial') {
    let borderColorLeft = '#10b981'; 
    if (ot.is_urgent) borderColorLeft = '#f97316';
    else if (ot.is_priority) borderColorLeft = '#16a34a';

    div.style.cssText = `background: #ffffff; border: 1px solid #e2e8f0; border-left: 5px solid ${borderColorLeft}; border-radius: 14px; padding: 18px 22px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.02), 0 2px 4px -1px rgba(0,0,0,0.02); display: flex; flex-direction: column; gap: 10px; position: relative; transition: all 0.2s ease;`;

    let materialesSet = new Set();
    let totalM2 = 0;
    let itemsHTML = '';
    if (ot.items && ot.items.length > 0) {
      ot.items.forEach(it => {
        if (it.material) materialesSet.add(`${it.material} (${it.impresion || 'Estándar'})`);
        totalM2 += parseFloat(it.area_m2 || 0);
        itemsHTML += `
          <div style="background: #f8fafc; border: 1px solid #f1f5f9; border-radius: 8px; padding: 10px 12px; margin-top: 6px; font-size: 0.85rem; color: #334155;">
            • <strong>${it.file_name || 'Archivo'}</strong> <span style="color: #64748b;">(${it.width_cm || 0}x${it.height_cm || 0} cm)</span> — ${it.material || ''} <span style="font-weight: 600; color: #5b3693;">[Cant: ${it.copies || 1}]</span>
          </div>
        `;
      });
    }

    const materialesStr = materialesSet.size > 0 ? Array.from(materialesSet).join(', ') : 'Sin materiales especificados';
    const resumenStr = `${ot.items ? ot.items.length : 0} diseño(s) / ${totalM2.toFixed(2)} m² total`;

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <button onclick="fijarOrden(${ot.ot_numero}, ${!ot.is_pinned})" title="Fijar orden" style="background: ${ot.is_pinned ? '#f3e8ff' : '#f1f5f9'}; border: 1px solid ${ot.is_pinned ? '#d8b4fe' : '#cbd5e1'}; border-radius: 8px; width: 32px; height: 32px; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">${ot.is_pinned ? '📌' : '📍'}</button>
          <span style="font-weight: 800; color: #5b3693; font-size: 1.3rem; letter-spacing: 0.5px; white-space: nowrap;">OT #${ot.ot_numero}</span>
        </div>
        <span style="background: #f3e8ff; color: #6b21a8; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; border: 1px solid #e9d5ff; white-space: nowrap;">${ot.status}</span>
      </div>

      <div style="margin-top: 4px;">
        ${itemsHTML}
      </div>

      <button class="btn-toggle-detalle" style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #475569; width: 100%; padding: 7px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.8rem; margin-top: 6px; transition: background 0.2s;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">▼ Ver Detalle</button>

      <div class="detalle-expandible" style="display: none; margin-top: 8px; padding-top: 10px; border-top: 1px dashed #cbd5e1; flex-direction: column; gap: 6px; font-size: 0.85rem; color: #334155;">
        <div><strong>Cliente:</strong> <span style="color: #5b3693; font-weight: 700;">${ot.client_name || 'N/D'}</span></div>
        <div><strong>Materiales:</strong> ${materialesStr}</div>
        <div><strong>Resumen:</strong> ${resumenStr}</div>
        <div><strong>Entregado por:</strong> ${ot.entregado_por || 'No especificado'}</div>
        <div><strong>Fecha de Entrega:</strong> ${ot.fecha_entrega || ot.fecha_prometida || 'N/D'}</div>
        ${ot.notes ? `<div><strong>Notas:</strong> ${ot.notes}</div>` : ''}
        <div style="font-weight: 800; color: #059669; margin-top: 4px; margin-bottom: 6px;">Total: $${parseFloat(ot.total_price || 0).toLocaleString('es-AR')} ARS</div>
        
        <!-- ✅ BOTÓN DE VER ORDEN (OT) AGREGADO -->
        <button onclick="window.open('/ot/${ot.ot_numero}', '_blank')" style="background: linear-gradient(90deg, #9353d3 0%, #472d75 50%, #9353d3 100%); color: white; border: none; padding: 9px 12px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.8rem; text-align: center; box-shadow: 0 2px 5px rgba(147, 83, 211, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2); width: 100%; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'" title="Ver / Descargar Orden de Trabajo">📄 Ver Orden (OT)</button>
      </div>
    `;

    const btnToggle = div.querySelector('.btn-toggle-detalle');
    const detalleDiv = div.querySelector('.detalle-expandible');
    if (btnToggle && detalleDiv) {
      btnToggle.onclick = () => {
        const isOpen = detalleDiv.style.display === 'flex';
        detalleDiv.style.display = isOpen ? 'none' : 'flex';
        btnToggle.innerText = isOpen ? '▼ Ver Detalle' : '▲ Ocultar Detalle';
        btnToggle.style.background = isOpen ? '#f1f5f9' : '#e2e8f0';
      };
    }

    return div;
  }

  // ---------------------------------------------------------
  // VISTA NORMAL DE TARJETA PARA DISEÑO, IMPRESIÓN Y ENTREGA
  // ---------------------------------------------------------
  let backgroundColor = '#ffffff'; 
  let borderColorLeft = '#5b3693'; 
  let cardShadow = '0 4px 6px -1px rgba(0,0,0,0.04), 0 2px 4px -1px rgba(0,0,0,0.02)';

  if (ot.is_urgent) {
    backgroundColor = '#ff8c00'; 
    borderColorLeft = '#ea580c'; 
    cardShadow = '0 4px 14px rgba(234, 88, 12, 0.15)';
  } else if (ot.is_priority) {
    backgroundColor = '#00ff4c'; 
    borderColorLeft = '#16a34a'; 
    cardShadow = '0 4px 14px rgba(22, 163, 74, 0.15)';
  }

  div.style.cssText = `background: ${backgroundColor}; border: 1px solid #e2e8f0; border-left: 6px solid ${borderColorLeft}; border-radius: 14px; padding: 22px; box-shadow: ${cardShadow}; display: flex; flex-direction: column; justify-content: space-between; position: relative; transition: all 0.25s ease;`;

  let materialesSet = new Set();
  let totalM2 = 0;
  let itemsHTML = '';
  let todosListos = true; 

  if (ot.items && ot.items.length > 0) {
    ot.items.forEach(it => {
      if (it.material) materialesSet.add(`${it.material} (${it.impresion || 'Estándar'})`);
      
      // CÁLCULO DE M2 EXACTO (SIN REDONDEO PREVIO)
      let m2Item = 0;
      if (it.width_cm && it.height_cm) {
        m2Item = ((parseFloat(it.width_cm) / 100) * (parseFloat(it.height_cm) / 100)) * parseInt(it.copies || 1);
      } else {
        m2Item = parseFloat(it.area_m2 || 0);
      }
      totalM2 += m2Item;

      if (columnaActual === 'impresion' && !it.is_printed) todosListos = false;
      if (columnaActual === 'entrega' && !it.is_delivered_item) todosListos = false;

      let accionesItemHTML = '';
      if (columnaActual === 'diseno') {
        accionesItemHTML = `
          <div style="display: flex; align-items: center; gap: 6px;">
            <button onclick="abrirModalEditarEnlace(${it.id})" title="Modificar Link / Enlace" style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">🔗</button>
            <button onclick="abrirModalEditarNombreItem(${it.id}, '${(it.file_name || '').replace(/'/g, "\\'")}')" title="Modificar Nombre del Ítem" style="background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 0.9rem;" onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">✏️</button>
            <button onclick="abrirModalPrecioManual(${it.id})" title="Modificar Precio Manual" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #16a34a; font-size: 0.9rem;" onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">$</button>
            <button onclick="abrirModalEditarItem(${it.id})" style="background: #ea580c; color: white; border: none; padding: 5px 10px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 0.78rem; transition: background 0.2s;" onmouseover="this.style.background='#c2410c'" onmouseout="this.style.background='#ea580c'">Editar</button>
            <button onclick="eliminarItemOrden(${it.id})" style="background: #ff0000; color: #f8f4f4; border: 1px solid #ff0101; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.85rem;" title="Eliminar Ítem">✕</button>
          </div>
        `;
      } else if (columnaActual === 'impresion') {
        accionesItemHTML = `
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: ${it.is_printed ? '#16a34a' : '#64748b'}; background: ${it.is_printed ? '#f0fdf4' : '#f8fafc'}; padding: 6px 10px; border-radius: 6px; border: 1px solid ${it.is_printed ? '#bbf7d0' : '#e2e8f0'};">
            <input type="checkbox" ${it.is_printed ? 'checked' : ''} onchange="marcarItemImpreso(${it.id}, this.checked, event)" style="accent-color: #16a34a; width: 16px; height: 16px; cursor: pointer;">
            ${it.is_printed ? 'Impreso ✓' : 'Pendiente'}
          </label>
        `;
      } else if (columnaActual === 'entrega') {
        accionesItemHTML = `
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: ${it.is_delivered_item ? '#16a34a' : '#64748b'}; background: ${it.is_delivered_item ? '#f0fdf4' : '#f8fafc'}; padding: 6px 10px; border-radius: 6px; border: 1px solid ${it.is_delivered_item ? '#bbf7d0' : '#e2e8f0'};">
            <input type="checkbox" ${it.is_delivered_item ? 'checked' : ''} onchange="marcarItemEntregado(${it.id}, this.checked, event)" style="accent-color: #16a34a; width: 16px; height: 16px; cursor: pointer;">
            ${it.is_delivered_item ? 'Entregado ✓' : 'Pendiente'}
          </label>
        `;
      }

      itemsHTML += `
        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-top: 8px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
          <div style="font-weight: 700; color: #1e293b; font-size: 0.92rem; word-break: break-all;">
            📥 ${it.file_name || 'Archivo'} <span style="color: #64748b; font-weight: normal; font-size: 0.82rem;">(${it.width_cm || 0}x${it.height_cm || 0} cm)</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px dashed #f1f5f9; padding-top: 8px;">
            <div style="color: #64748b; font-size: 0.8rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-weight: 600; color: #475569;">${it.material || 'Material'}</span> 
              <span>•</span>
              <span style="color: #5b3693; font-weight: 600;">${it.impresion || 'Tecnología'}</span>
              <span>•</span>
              <span>Cant: <strong>${it.copies || 1}</strong></span>
            </div>
            <div style="flex-shrink: 0;">${accionesItemHTML}</div>
          </div>
        </div>
      `;
    });
  } else {
    todosListos = false;
  }

  const materialesStr = materialesSet.size > 0 ? Array.from(materialesSet).join(', ') : 'Sin materiales especificados';
  const resumenStr = `${ot.items ? ot.items.length : 0} diseño(s) / ${totalM2.toFixed(2)} m² total`;

  div.innerHTML = `
    <div>
      <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <button onclick="fijarOrden(${ot.ot_numero}, ${!ot.is_pinned})" title="Fijar orden" style="background: ${ot.is_pinned ? '#f3e8ff' : '#f1f5f9'}; border: 1px solid ${ot.is_pinned ? '#d8b4fe' : '#cbd5e1'}; border-radius: 8px; width: 32px; height: 32px; cursor: pointer; font-size: 1rem; display: flex; align-items: center; justify-content: center; transition: all 0.2s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'">${ot.is_pinned ? '📌' : '📍'}</button>
            <span style="font-weight: 800; color: #5b3693; font-size: 1.3rem; letter-spacing: 0.5px; white-space: nowrap;">OT #${ot.ot_numero}</span>
          </div>
          <span style="background: #f3e8ff; color: #6b21a8; padding: 4px 12px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; border: 1px solid #e9d5ff; white-space: nowrap;">${ot.status}</span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <label style="font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; color: #c2410c; background: #ffedd5; padding: 6px; border-radius: 6px; border: 1px solid #fed7aa; text-align: center;">
            <input type="checkbox" ${ot.is_urgent ? 'checked' : ''} onchange="urgenciaOrden(${ot.ot_numero}, this.checked)" style="accent-color: #ea580c; cursor: pointer;"> 🔥 URGENTE
          </label>
          <label style="font-size: 0.75rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700; color: #15803d; background: #dcfce7; padding: 6px; border-radius: 6px; border: 1px solid #bbf7d0; text-align: center;">
            <input type="checkbox" ${ot.is_priority ? 'checked' : ''} onchange="prioridadOrden(${ot.ot_numero}, this.checked)" style="accent-color: #16a34a; cursor: pointer;"> ⭐ PRIORIDAD
          </label>
        </div>
      </div>

      <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
        <div style="font-size: 0.95rem; color: #0f172a; margin-bottom: 4px; text-transform: uppercase;">
          <strong>Cliente:</strong> <span style="color: #5b3693; font-weight: 800;">${ot.client_name || 'Cliente'}</span>
        </div>
        <div style="font-size: 0.85rem; color: #334155; margin-top: 4px;">
          <strong>Materiales:</strong> <span style="color: #475569;">${materialesStr}</span>
        </div>
        <div style="font-size: 0.85rem; color: #334155; margin-top: 2px;">
          <strong>Resumen:</strong> <span style="color: #475569;">${resumenStr}</span>
        </div>
        <div style="font-size: 1rem; color: #0f172a; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
          <span><strong>Total:</strong></span>
          <span style="color: #059669; font-weight: 800; font-size: 1.1rem;">$${parseFloat(ot.total_price || 0).toLocaleString('es-AR', {minimumFractionDigits: 2, maximumFractionDigits: 2})} ARS</span>
        </div>
      </div>
      
      ${ot.notes ? `
        <div style="background: #fef9c3; border: 1px solid #fef08a; padding: 10px 14px; border-radius: 8px; font-size: 0.85rem; margin-bottom: 12px; color: #713f12; display: flex; align-items: flex-start; gap: 8px;">
          <span style="font-size: 1rem;">📝</span> <div><strong>Notas:</strong> ${ot.notes}</div>
        </div>` : ''}

      ${columnaActual === 'entrega' ? `
        <div style="margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; background: #f8fafc; padding: 12px; border-radius: 10px; border: 1px solid #e2e8f0;">
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 3px;">Fecha Prometida:</label>
            <input type="text" value="${ot.fecha_prometida || ''}" onchange="actualizarInfoEntrega(${ot.ot_numero}, 'fecha_prometida', this.value)" style="width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85rem; box-sizing: border-box; background: white;">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 3px;">Entregado por:</label>
            <input type="text" value="${ot.entregado_por || ''}" placeholder="Nombre del responsable" onchange="actualizarInfoEntrega(${ot.ot_numero}, 'entregado_por', this.value)" style="width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85rem; box-sizing: border-box; background: white;">
          </div>
          <div>
            <label style="font-size: 0.75rem; font-weight: 700; color: #475569; display: block; margin-bottom: 3px;">Fecha de Entrega:</label>
            <input type="text" value="${ot.fecha_entrega || ''}" placeholder="Ej. 13/10/2026" onchange="actualizarInfoEntrega(${ot.ot_numero}, 'fecha_entrega', this.value)" style="width: 100%; padding: 7px 10px; border-radius: 6px; border: 1px solid #cbd5e1; font-size: 0.85rem; box-sizing: border-box; background: white;">
          </div>
        </div>
      ` : ''}

      <div>
        <div style="font-weight: 700; font-size: 0.85rem; color: #475569; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Ítems Adjuntos (${ot.items ? ot.items.length : 0}):</div>
        ${itemsHTML}
        
        ${columnaActual === 'diseno' ? `
          <button onclick="abrirModalAgregarItem(${ot.ot_numero})" style="background: linear-gradient(90deg, #00ff66 0%, #008033 50%, #00ff66 100%); color: white; border: none; width: 100%; padding: 9px; border-radius: 8px; font-weight: 700; cursor: pointer; margin-top: 10px; font-size: 0.85rem; box-shadow: 0 2px 6px rgba(0, 255, 102, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">+ Agregar Nuevo Ítem</button>
        ` : ''}
      </div>
    </div>

    <div style="margin-top: 18px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; border-top: 1px solid #e2e8f0; padding-top: 14px;">
      <button onclick="window.open('/ot/${ot.ot_numero}', '_blank')" style="background: linear-gradient(90deg, #9353d3 0%, #472d75 50%, #9353d3 100%); color: white; border: none; padding: 9px 12px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.8rem; text-align: center; box-shadow: 0 2px 5px rgba(147, 83, 211, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'" title="Ver / Descargar Orden de Trabajo">📄 Ver Orden (OT)</button>      
      <button onclick="abrirModalResponderGmail('${ot.client_email || ''}', ${ot.ot_numero})" style="background: linear-gradient(to right, #ea4335, #fbbc05, #34a853, #4285f4); color: white; border: none; padding: 9px 12px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.8rem; text-align: center; text-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: opacity 0.2s;" onmouseover="this.style.opacity='0.95'" onmouseout="this.style.opacity='1'" title="Responder Gmail Cliente">✉️ Enviar Gmail</button>
      
      ${columnaActual === 'diseno' ? `<button onclick="cambiarEstadoOT(${ot.ot_numero}, 'READY_TO_PRINT')" style="background: linear-gradient(90deg, #00d2ff 0%, #0056b3 50%, #00d2ff 100%); color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.85rem; text-align: center; grid-column: span 2; box-shadow: 0 2px 6px rgba(0, 210, 255, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">Pasar a Impresión ➔</button>` : ''}      
      
      ${columnaActual === 'impresion' ? `
        <button onclick="cambiarEstadoOT(${ot.ot_numero}, 'READY_TO_DELIVER')" 
          ${!todosListos ? 'disabled' : ''} 
          style="background: ${todosListos ? 'linear-gradient(90deg, #00d2ff 0\%, #0056b3 50\%, #00d2ff 100\%)' : '#cbd5e1'}; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: ${todosListos ? '700' : 'normal'}; cursor: ${todosListos ? 'pointer' : 'not-allowed'}; font-size: 0.85rem; text-align: center; grid-column: span 2; ${todosListos ? 'box-shadow: 0 2px 6px rgba(0, 210, 255, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2);' : ''}"
          title="${!todosListos ? 'Debe marcar todos los ítems como impresos para continuar' : 'Pasar a entrega'}">
          Listo para Entrega ➔
        </button>` : ''}
        
      ${columnaActual === 'entrega' ? `
        <button onclick="cambiarEstadoOT(${ot.ot_numero}, 'DELIVERED')" 
          ${!todosListos ? 'disabled' : ''} 
          style="background: ${todosListos ? 'linear-gradient(90deg, #00d2ff 0\%, #0056b3 50\%, #00d2ff 100\%)' : '#cbd5e1'}; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: ${todosListos ? '700' : 'normal'}; cursor: ${todosListos ? 'pointer' : 'not-allowed'}; font-size: 0.85rem; text-align: center; grid-column: span 2; ${todosListos ? 'box-shadow: 0 2px 6px rgba(0, 210, 255, 0.3); text-shadow: 0 1px 2px rgba(0,0,0,0.2);' : ''}"
          title="${!todosListos ? 'Debe marcar todos los ítems como entregados para enviar al historial' : 'Finalizar Entrega'}">
          Finalizar Entrega (Enviar a Historial) ✓
        </button>` : ''}

      <button onclick="eliminarOrdenCompleta(${ot.ot_numero})" style="background: linear-gradient(90deg, #ff1a1a 0%, #e60000 50%, #ff1a1a 100%); color: white; border: none; padding: 9px; border-radius: 8px; font-weight: 700; cursor: pointer; font-size: 0.78rem; text-align: center; grid-column: span 2; box-shadow: 0 2px 6px rgba(255, 26, 26, 0.4); text-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: opacity 0.2s;" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">🗑️ Eliminar Orden Completa</button>
    </div>
  `;

  return div;
}

// Actualizar información de entrega
async function actualizarInfoEntrega(otNumero, campo, valor) {
  try {
    const bodyData = {};
    bodyData[campo] = valor;

    const res = await fetch(`/api/ordenes/entrega-info/${otNumero}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyData)
    });

    if (!res.ok) {
      alert('❌ No se pudo actualizar la información de entrega.');
    }
  } catch (err) {
    console.error('Error al actualizar info de entrega:', err);
  }
}

// Marcar o desmarcar ítem como entregado SIN perder el scroll de la página
async function marcarItemEntregado(itemId, is_delivered_item, event) {
  try {
    const res = await fetch(`/api/ordenes/item/delivered/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_delivered_item })
    });

    if (res.ok) {
      const card = event.target.closest('.ot-card');
      if (card) {
        const checkboxes = card.querySelectorAll('input[type="checkbox"]');
        const botonFinalizar = card.querySelector('button[onclick*="DELIVERED"]');
        
        if (botonFinalizar) {
          const checkboxesItems = Array.from(checkboxes).filter(cb => cb.onchange && cb.onchange.toString().includes('marcarItemEntregado'));
          const todosListos = checkboxesItems.every(cb => cb.checked);

          if (todosListos) {
            botonFinalizar.disabled = false;
            botonFinalizar.style.background = 'linear-gradient(90deg, #00d2ff 0%, #0056b3 50%, #00d2ff 100%)';
            botonFinalizar.style.cursor = 'pointer';
            botonFinalizar.style.fontWeight = '700';
            botonFinalizar.style.boxShadow = '0 2px 6px rgba(0, 210, 255, 0.3)';
            botonFinalizar.style.textShadow = '0 1px 2px rgba(0,0,0,0.2)';
            botonFinalizar.title = 'Finalizar Entrega';
          } else {
            botonFinalizar.disabled = true;
            botonFinalizar.style.background = '#cbd5e1';
            botonFinalizar.style.cursor = 'not-allowed';
            botonFinalizar.style.fontWeight = 'normal';
            botonFinalizar.style.boxShadow = 'none';
            botonFinalizar.style.textShadow = 'none';
            botonFinalizar.title = 'Debe marcar todos los ítems como entregados para enviar al historial';
          }
        }
      }
    } else {
      alert('❌ No se pudo actualizar el estado de entrega del ítem.');
    }
  } catch (err) {
    console.error('Error al marcar ítem entregado:', err);
  }
}


async function abrirModalOrdenManual() {
  const modal = document.getElementById('modal-orden-manual');
  if (modal) modal.style.display = 'flex';

  try {
    const res = await fetch('/api/clientes?all=true'); 
    const data = await res.json();
    const clientes = Array.isArray(data) ? data : (data.clientes || []);

    const dataList = document.getElementById('manual-client-list'); 
    if (dataList) {
      dataList.innerHTML = ''; // Limpiar opciones anteriores
      
      clientes.forEach(c => {
        const nombreEmpresa = c.company || c.name || 'Cliente sin nombre';
        const contacto = (c.name && c.company && c.name !== c.company) ? ` (${c.name})` : '';
        const textoMostrar = `${nombreEmpresa}${contacto}`;
        
        const option = document.createElement('option');
        option.value = nombreEmpresa; // Lo que se selecciona y guarda
        dataList.appendChild(option);
      });
    }
  } catch (err) {
    console.error('Error al cargar clientes para el buscador:', err);
  }
}

function cerrarModalOrdenManual() {
  const modal = document.getElementById('modal-orden-manual');
  if (modal) modal.style.display = 'none';
}

async function guardarOrdenManual(e) {
  if (e) e.preventDefault();
  
  // CORREGIDO: Cambiamos 'manual-client-name' por 'manual-client-input'
  const clientName = document.getElementById('manual-client-input')?.value;
  const clientEmail = document.getElementById('manual-client-email')?.value;
  const notes = document.getElementById('manual-notes')?.value;

  try {
    const res = await fetch('/api/orders/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName, clientEmail, notes })
    });

    if (res.ok) {
      cerrarModalOrdenManual();
      cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    } else {
      alert('❌ Error al crear la orden manual.');
    }
  } catch (err) {
    console.error('Error al crear orden manual:', err);
  }
}

async function cambiarEstadoOT(id, status) {
  try {
    const res = await fetch(`/api/ordenes/estado/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    if (res.ok) cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
  } catch (err) { console.error('Error al cambiar estado:', err); }
}

async function fijarOrden(id, is_pinned) {
  try {
    await fetch(`/api/ordenes/fijar/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_pinned })
    });
    cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
  } catch (err) { console.error('Error al fijar orden:', err); }
}

async function prioridadOrden(id, is_priority) {
  try {
    await fetch(`/api/ordenes/prioridad/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_priority })
    });
    cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
  } catch (err) { console.error('Error al cambiar prioridad:', err); }
}

async function urgenciaOrden(id, is_urgent) {
  try {
    await fetch(`/api/ordenes/urgencia/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_urgent })
    });
    cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
  } catch (err) { console.error('Error al cambiar urgencia:', err); }
}

async function eliminarOrdenCompleta(id) {
  if (!confirm('⚠️ ¿Estás seguro de que deseas eliminar completamente esta Orden de Trabajo?')) return;
  try {
    const res = await fetch(`/api/ordenes/${id}`, { method: 'DELETE' });
    if (res.ok) cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    else alert('❌ No se pudo eliminar la orden.');
  } catch (err) { console.error('Error al eliminar orden:', err); }
}

async function eliminarItemOrden(itemId) {
  if (!confirm('⚠️ ¿Deseas eliminar este ítem de la orden?')) return;
  try {
    const res = await fetch(`/api/ordenes/item/${itemId}`, { method: 'DELETE' });
    if (res.ok) cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    else alert('❌ No se pudo eliminar el ítem.');
  } catch (err) { console.error('Error al eliminar ítem:', err); }
}

function cerrarModalItem() {
  const modal = document.getElementById('modal-agregar-item');
  if (modal) modal.style.display = 'none';
}

async function abrirModalAgregarItem(otNumero) {
  const modal = document.getElementById('modal-agregar-item');
  if (modal) modal.style.display = 'flex';

  window.otActualParaItem = otNumero;

  try {
    const res = await fetch('/api/catalogos');
    const data = await res.json();

    const datalist = document.getElementById('lista-materiales');
    if (datalist && data.materials) {
      datalist.innerHTML = '';
      data.materials.forEach(mat => {
        const option = document.createElement('option');
        option.value = mat.name;
        option.setAttribute('data-id', mat.id);
        datalist.appendChild(option);
      });
    }

    const selectPrint = document.getElementById('modal-print-type');
    if (selectPrint && data.printTypes) {
      selectPrint.innerHTML = '';
      data.printTypes.forEach(pt => {
        const option = document.createElement('option');
        option.value = pt.id;
        option.innerText = pt.name;
        selectPrint.appendChild(option);
      });
    }
  } catch (err) {
    console.error('Error al cargar catálogos para el modal:', err);
  }
}

async function guardarItemManual() {
  const otId = window.otActualParaItem;
  if (!otId) {
    alert('❌ Error: No se ha especificado la Orden de Trabajo.');
    return;
  }

  const materialInput = document.getElementById('modal-material-input');
  const printTypeSelect = document.getElementById('modal-print-type');
  const fileNameInput = document.getElementById('modal-filename');
  const widthInput = document.getElementById('modal-width');
  const heightInput = document.getElementById('modal-height');
  const copiesInput = document.getElementById('modal-copies');

  let materialId = null;
  const datalist = document.getElementById('lista-materiales');
  if (datalist && materialInput) {
    const options = datalist.querySelectorAll('option');
    for (let opt of options) {
      if (opt.value.trim().toLowerCase() === materialInput.value.trim().toLowerCase()) {
        materialId = opt.getAttribute('data-id');
        break;
      }
    }
  }

  const file_name = fileNameInput?.value || 'Diseno_Extra.cdr';
  const print_type_id = printTypeSelect?.value;
  const width_cm = parseFloat(widthInput?.value || 0);
  const height_cm = parseFloat(heightInput?.value || 0);
  const copies = parseInt(copiesInput?.value || 1);

  if (!materialInput.value) {
    alert('⚠️ Por favor selecciona o ingresa un material.');
    return;
  }

  try {
    const res = await fetch(`/api/ordenes/${otId}/item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name,
        material_id: materialId || 1,
        print_type_id,
        width_cm,
        height_cm,
        copies,
        file_url: '#'
      })
    });

    if (res.ok) {
      cerrarModalItem();
      cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    } else {
      const errData = await res.json();
      alert('❌ No se pudo guardar el ítem: ' + (errData.error || 'Error de servidor'));
    }
  } catch (err) {
    console.error('Error al guardar ítem manual:', err);
    alert('❌ Error de conexión al intentar guardar el ítem.');
  }
}

async function abrirModalEditarItem(itemId) {
  const nuevoAncho = prompt("📐 Ingrese el nuevo Ancho (cm):");
  if (nuevoAncho === null) return;

  const nuevoAlto = prompt("📏 Ingrese el nuevo Alto (cm):");
  if (nuevoAlto === null) return;

  const nuevasCopias = prompt("📦 Ingrese la Cantidad / Copias:");
  if (nuevasCopias === null) return;

  const width_cm = parseFloat(nuevoAncho);
  const height_cm = parseFloat(nuevoAlto);
  const copies = parseInt(nuevasCopias);

  if (isNaN(width_cm) || isNaN(height_cm) || isNaN(copies)) {
    alert("⚠️ Por favor ingrese valores numéricos válidos.");
    return;
  }

  try {
    const res = await fetch(`/api/ordenes/item/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width_cm, height_cm, copies })
    });

    if (res.ok) {
      cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    } else {
      alert('❌ No se pudo actualizar el ítem en la base de datos.');
    }
  } catch (err) {
    console.error('Error al actualizar ítem:', err);
    alert('❌ Error de conexión al actualizar el ítem.');
  }
}

async function guardarEdicionItem() {
  const itemId = window.itemActualParaEditar;
  if (!itemId) {
    alert('❌ Error: No se ha seleccionado ningún ítem para editar.');
    return;
  }

  const widthInput = document.getElementById('edit-modal-width') || document.getElementById('modal-width');
  const heightInput = document.getElementById('edit-modal-height') || document.getElementById('modal-height');
  const copiesInput = document.getElementById('edit-modal-copies') || document.getElementById('modal-copies');

  const width_cm = parseFloat(widthInput?.value || 0);
  const height_cm = parseFloat(heightInput?.value || 0);
  const copies = parseInt(copiesInput?.value || 1);

  try {
    const res = await fetch(`/api/ordenes/item/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width_cm, height_cm, copies })
    });

    if (res.ok) {
      const modal = document.getElementById('modal-editar-item');
      if (modal) modal.style.display = 'none';
      cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    } else {
      alert('❌ No se pudo actualizar el ítem.');
    }
  } catch (err) {
    console.error('Error al actualizar ítem:', err);
  }
}

function cerrarModalEditarItem() {
  const modal = document.getElementById('modal-editar-item');
  if (modal) modal.style.display = 'none';
}

async function abrirModalEditarEnlace(itemId) {
  const nuevoEnlace = prompt('🔗 Ingresa el nuevo link o URL del archivo/enlace:');
  if (nuevoEnlace === null) return;

  try {
    const res = await fetch(`/api/ordenes/item/enlace/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_url: nuevoEnlace })
    });

    if (res.ok) {
      cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    } else {
      alert('❌ No se pudo actualizar el enlace.');
    }
  } catch (err) {
    console.error('Error al actualizar enlace:', err);
  }
}

async function abrirModalEditarNombreItem(itemId, nombreActual) {
  const nuevoNombre = prompt('✏️ Modifica el nombre del archivo/ítem:', nombreActual);
  if (!nuevoNombre) return;

  try {
    const res = await fetch(`/api/ordenes/item/nombre/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_name: nuevoNombre })
    });

    if (res.ok) {
      cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    } else {
      alert('❌ No se pudo actualizar el nombre.');
    }
  } catch (err) {
    console.error('Error al actualizar nombre:', err);
  }
}

async function abrirModalPrecioManual(itemId) {
  const nuevoPrecio = prompt('💲 Ingresa el nuevo precio manual (en ARS) para este ítem:');
  if (nuevoPrecio === null || isNaN(nuevoPrecio)) return;

  try {
    const res = await fetch(`/api/ordenes/item/precio-manual/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit_price_override: parseFloat(nuevoPrecio) })
    });

    if (res.ok) {
      cargarOrdenes(paginaActualOrdenes, terminoBusquedaOrdenes);
    } else {
      alert('❌ No se pudo actualizar el precio manual.');
    }
  } catch (err) {
    console.error('Error al actualizar precio manual:', err);
  }
}
