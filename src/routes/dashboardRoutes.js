const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');

router.get('/unidades', dashboardController.getDashboard);

module.exports = router;