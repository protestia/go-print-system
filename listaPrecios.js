let catalogodePrecios = [];

async function cargarListaPrecios() {
  const tbody = document.getElementById('tbody-lista-precios');
  if (!tbody) return;

  try {
    const res = await fetch('/api/lista-precios');
    catalogodePrecios = await res.json();
    renderizarTablaPrecios(catalogodePrecios);
  } catch (err) {
    console.error('Error cargando lista de precios:', err);
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 25px; color: #ef4444; font-weight: bold;">❌ Error al cargar la lista de precios.</td></tr>`;
  }
}

function renderizarTablaPrecios(materiales) {
  const tbody = document.getElementById('tbody-lista-precios');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (materiales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 30px; color: #64748b; font-weight: bold;">No se encontraron materiales con ese criterio.</td></tr>`;
    return;
  }

  materiales.forEach((mat, idx) => {
    const nombreMatLower = mat.nombre.toLowerCase();

    // Identificar productos unitarios por nombre (Fly Banners, Portabanners, Sublimados, Bases, etc.)
    const esUnitario = nombreMatLower.includes('fly banner') || 
                       nombreMatLower.includes('portabanner') || 
                       nombreMatLower.includes('sublimado') ||
                       nombreMatLower.includes('base cruz') ||
                       nombreMatLower.includes('contrapeso') ||
                       nombreMatLower.includes('roll up');

    // Badge inteligente según el tipo de producto
    let tipoCobro = '';
    if (esUnitario) {
      tipoCobro = `<span style="background-color: #fef3c7; color: #92400e; border: 1px solid #fde68a; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;">📦 Unidad</span>`;
    } else if (mat.is_linear) {
      tipoCobro = `<span style="background-color: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;">📏 Metro Lineal</span>`;
    } else {
      tipoCobro = `<span style="background-color: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 20px; font-weight: 700; font-size: 0.8rem; display: inline-flex; align-items: center; gap: 4px;">📐 Metro Cuadrado (m²)</span>`;
    }
    
    // Grilla estética de precios por tecnología
    let preciosHTML = '';
    if (mat.precios && mat.precios.length > 0) {
      preciosHTML = `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px;">`;
      mat.precios.forEach(p => {
        preciosHTML += `
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-left: 4px solid #5b3693; padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #475569; font-size: 0.82rem; font-weight: 600;">${p.tecnologia}</span>
            <span style="color: #5b3693; font-size: 0.95rem; font-weight: bold;">$${p.precio.toLocaleString('es-AR')}</span>
          </div>
        `;
      });
      preciosHTML += `</div>`;
    } else {
      preciosHTML = `<em style="color: #94a3b8; font-size: 0.85rem;">Sin precios configurados</em>`;
    }

    const bgRow = idx % 2 === 0 ? '#ffffff' : '#fcfaff';

    const tr = document.createElement('tr');
    tr.style.backgroundColor = bgRow;
    tr.style.borderBottom = '1px solid #e2e8f0';
    tr.style.transition = 'background-color 0.2s';
    
    tr.onmouseenter = () => tr.style.backgroundColor = '#f3e8ff';
    tr.onmouseleave = () => tr.style.backgroundColor = bgRow;

    tr.innerHTML = `
      <td style="padding: 16px; font-weight: 700; color: #1e293b; font-size: 0.95rem; vertical-align: middle; width: 25%;">
        ${mat.nombre}
      </td>
      <td style="padding: 16px; text-align: center; vertical-align: middle; width: 20%;">
        ${tipoCobro}
      </td>
      <td style="padding: 16px; vertical-align: middle;">
        ${preciosHTML}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Buscador dinámico en tiempo real
function filtrarMateriales() {
  const input = document.getElementById('input-buscar-precio');
  if (!input) return;
  
  const busqueda = input.value.toLowerCase().trim();
  const filtrados = catalogodePrecios.filter(mat => {
    const coincideNombre = mat.nombre.toLowerCase().includes(busqueda);
    const coincideTecnologia = mat.precios.some(p => p.tecnologia.toLowerCase().includes(busqueda));
    return coincideNombre || coincideTecnologia;
  });
  renderizarTablaPrecios(filtrados);
}