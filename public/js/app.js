// Variable global para almacenar el usuario activo
let usuarioActual = JSON.parse(localStorage.getItem('goprint_user') || 'null');
let seccionActual = 'diseno';

document.addEventListener('DOMContentLoaded', () => {
  if (usuarioActual) {
    mostrarApp();
  } else {
    mostrarLogin();
  }
});

// Iniciar Sesión con la API
async function realizarLogin(e) {
  if (e) e.preventDefault();
  
  const usernameInput = document.getElementById('login-user').value.trim();
  const passwordInput = document.getElementById('login-pass').value.trim();
  const errorElement = document.getElementById('login-error');

  console.log("Intentando ingresar con:", usernameInput); // Para depurar en consola
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      usuarioActual = data;
      localStorage.setItem('goprint_user', JSON.stringify(data));
      if (errorElement) errorElement.style.display = 'none';
      mostrarApp();
    } else {
      if (errorElement) {
        errorElement.innerText = data.error || 'Credenciales incorrectas';
        errorElement.style.display = 'block';
      }
    }
  } catch (err) {
    console.error('Error durante el login:', err);
    if (errorElement) {
      errorElement.innerText = 'Error de conexión con el servidor';
      errorElement.style.display = 'block';
    }
  }
}

// Cerrar Sesión
function cerrarSesion() {
  localStorage.removeItem('goprint_user');
  usuarioActual = null;
  mostrarLogin();
}

// Alternar pantallas de Login y Aplicación Principales
function mostrarLogin() {
  const containerLogin = document.getElementById('login-screen');
  const containerApp = document.getElementById('app-container');
  if (containerLogin) containerLogin.style.display = 'flex';
  if (containerApp) containerApp.style.display = 'none';
}

function mostrarApp() {
  const containerLogin = document.getElementById('login-screen');
  const containerApp = document.getElementById('app-container');
  if (containerLogin) containerLogin.style.display = 'none';
  if (containerApp) containerApp.style.display = 'flex';

  // Mostrar el nombre de usuario y rol con los IDs correctos del HTML
  const lblUsername = document.getElementById('lbl-username');
  const lblRole = document.getElementById('lbl-role');
  if (lblUsername && usuarioActual) lblUsername.innerText = usuarioActual.username;
  if (lblRole && usuarioActual) lblRole.innerText = usuarioActual.role;

  const role = (usuarioActual?.role || '').toLowerCase();
  const btnFloatingManual = document.getElementById('btn-floating-manual');
  if (btnFloatingManual) {
    btnFloatingManual.style.display = (role === 'admin' || role === 'diseno') ? 'flex' : 'none';
  }

  // Cargar sección por defecto
  cargarSeccion('diseno');
}

// Navegación entre Secciones (Compatible con los IDs originales de producción)
function cargarSeccion(seccion) {
  seccionActual = seccion;
  window.seccionActual = seccion; // 👈 ¡ESTA LÍNEA FALTABA PARA QUE LOS MÓDULOS CLIENTE LEAN LA SECCIÓN ACTIVA!

  // Desmarcar menú y marcar el activo
  document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.getElementById(`btn-${seccion}`);
  if (activeEl) activeEl.classList.add('active');

  const titulos = {
    diseno: 'Área de Diseño 🎨',
    impresion: 'Área de Impresión 🖨️',
    entrega: 'Área de Entrega 📦',
    historial: 'Historial de Órdenes Entregadas 📚',
    precios: 'Lista de Precios Actuales 📋',
    caja: 'Gestión de Caja Diaria 💰',
    clientes: 'Gestión de Clientes 👥'
  };
  
  const tituloEl = document.getElementById('seccion-titulo');
  if (tituloEl) tituloEl.innerText = titulos[seccion] || '';

  const inputBuscar = document.getElementById('input-buscar');
  if (inputBuscar) inputBuscar.value = '';

  const containerOrdenes = document.getElementById('orders-container');
  const seccionPrecios = document.getElementById('seccion-precios');
  const seccionCaja = document.getElementById('seccion-caja');
  const seccionClientes = document.getElementById('seccion-clientes');
  const inputBuscarOT = document.getElementById('input-buscar');

  // Ocultar todas las vistas principales
  if (containerOrdenes) containerOrdenes.style.display = 'none';
  if (seccionPrecios) seccionPrecios.style.display = 'none';
  if (seccionCaja) seccionCaja.style.display = 'none';
  if (seccionClientes) seccionClientes.style.display = 'none';
  if (inputBuscarOT) inputBuscarOT.style.display = 'none';

  // Mostrar la sección seleccionada y disparar sus funciones específicas
  if (seccion === 'precios') {
    if (seccionPrecios) seccionPrecios.style.display = 'block';
    if (typeof cargarListaPrecios === 'function') cargarListaPrecios();
  } else if (seccion === 'caja') {
    if (seccionCaja) seccionCaja.style.display = 'block';
    if (typeof cargarCajaHoy === 'function') cargarCajaHoy();
  } else if (seccion === 'clientes') {
    if (seccionClientes) seccionClientes.style.display = 'block';
    if (typeof cargarClientes === 'function') cargarClientes();
  } else {
    if (inputBuscarOT) inputBuscarOT.style.display = 'block';
    if (containerOrdenes) containerOrdenes.style.display = 'grid';
    if (typeof cargarOrdenes === 'function') cargarOrdenes();
  }
}