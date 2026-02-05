const express = require('express');
const router = express.Router();
const leituraController = require('../controllers/leituraController');

router.post('/salvar', leituraController.salvarLeitura);
router.get('/listar', leituraController.listarLeituras);

// --- ROTAS DE CORREÇÃO ---
router.put('/:id', leituraController.editarLeitura);   // Corrigir valor
router.delete('/:id', leituraController.excluirLeitura); // Excluir registro

module.exports = router;