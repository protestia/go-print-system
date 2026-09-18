const express = require('express');
const router = express.Router();
const stockController = require('./stockController'); // Importa stockController desde la raíz

// Consultar stock
router.get('/', stockController.obtenerStock);

// Agregar nuevo material
router.post('/nuevo', stockController.agregarMaterial);

// Registrar desperdicio/scrap
router.post('/scrap', stockController.registrarScrap);

module.exports = router;