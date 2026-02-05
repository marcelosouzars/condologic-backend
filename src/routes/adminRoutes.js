const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// --- CONDOMÍNIOS ---
router.post('/condominio', adminController.criarCondominio);
router.get('/condominios', adminController.listarCondominios);
router.put('/condominio/:id', adminController.editarCondominio); // NOVO
router.delete('/condominio/:id', adminController.excluirCondominio); // NOVO

// --- BLOCOS E UNIDADES ---
router.post('/bloco', adminController.criarBloco);
router.get('/blocos/:tenant_id', adminController.listarBlocos);
router.post('/unidade', adminController.criarUnidade);
router.get('/unidades/:bloco_id', adminController.listarUnidades);

// --- USUÁRIOS ---
router.post('/usuario', adminController.criarUsuario);
router.get('/usuarios', adminController.listarUsuarios);
router.put('/usuario/:id', adminController.editarUsuario);
router.delete('/usuario/:id', adminController.excluirUsuario);

module.exports = router;