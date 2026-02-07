const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// --- ROTAS DE CONDOMÍNIO ---
router.post('/condominio', adminController.criarCondominio);
router.get('/condominios', adminController.listarCondominios);
router.put('/condominio/:id', adminController.editarCondominio);
router.delete('/condominio/:id', adminController.excluirCondominio);

// --- ROTAS DE BLOCO ---
router.post('/bloco', adminController.criarBloco);
router.get('/blocos/:tenant_id', adminController.listarBlocos);

// --- ROTAS DE UNIDADE ---
router.post('/unidade', adminController.criarUnidade);
router.post('/unidades/lote', adminController.gerarUnidadesLote);
router.get('/unidades/:bloco_id', adminController.listarUnidades);

// --- ROTAS DE USUÁRIO ---
router.post('/usuario', adminController.criarUsuario);
router.get('/usuarios', adminController.listarUsuarios);
router.put('/usuario/:id', adminController.editarUsuario);
router.delete('/usuario/:id', adminController.excluirUsuario);

// --- NOVAS ROTAS (BUSCA E VÍNCULO) ---
router.get('/usuarios/buscar', adminController.buscarUsuarios); // Busca por nome/cpf
router.get('/condominio/:id/equipe', adminController.listarEquipeCondominio); // Vê quem trabalha lá
router.post('/usuario/vincular', adminController.vincularUsuarioCondominio);
router.post('/usuario/desvincular', adminController.desvincularUsuarioCondominio);

module.exports = router;