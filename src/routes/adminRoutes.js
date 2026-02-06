const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

// ==========================================
// ROTAS DE ADMINISTRAÇÃO (SÍNDICO/SUPORTE)
// ==========================================

// --- CONDOMÍNIOS (Tenants) ---
router.post('/condominio', adminController.criarCondominio);       // Criar
router.get('/condominios', adminController.listarCondominios);     // Listar
router.put('/condominio/:id', adminController.editarCondominio);   // Editar
router.delete('/condominio/:id', adminController.excluirCondominio); // Excluir

// --- BLOCOS ---
router.post('/bloco', adminController.criarBloco);                 // Criar Bloco
router.get('/blocos/:tenant_id', adminController.listarBlocos);    // Listar Blocos

// --- UNIDADES (APARTAMENTOS/CASAS) ---
router.post('/unidade', adminController.criarUnidade);             // Criar 1 Unidade (Individual)
router.get('/unidades/:bloco_id', adminController.listarUnidades); // Listar Unidades do Bloco

// 🔥 ROTA NOVA (GERADOR EM LOTE) 🔥
// É esta linha aqui que faz o botão "Gerar Lote" funcionar
router.post('/unidades/lote', adminController.gerarUnidadesLote); 

// --- USUÁRIOS (Porteiros, Zeladores, Etc) ---
router.post('/usuario', adminController.criarUsuario);             // Criar Usuário
router.get('/usuarios', adminController.listarUsuarios);           // Listar Usuários
router.put('/usuario/:id', adminController.editarUsuario);         // Editar Usuário
router.delete('/usuario/:id', adminController.excluirUsuario);     // Excluir Usuário

module.exports = router;