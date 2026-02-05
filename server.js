require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

// --- CONFIGURAÇÃO DO BANCO ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Inicializar App
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// --- MUDANÇA AQUI: AUMENTAMOS O LIMITE PARA 50MB (Para caber a foto) ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// ----------------------------------------------------------------------

// --- MIDDLEWARE DE LOG (ESPIÃO) ---
app.use((req, res, next) => {
    console.log(`📡 [${req.method}] ${req.url}`);
    next();
});

// --- ROTA DE TESTE DIRETA ---
app.get('/api/leitura/listar', async (req, res) => {
    console.log("🔥 ROTA DIRETA ACIONADA!"); 
    const { tenant_id } = req.query;

    if (!tenant_id) return res.status(400).json({ error: 'ID obrigatório' });

    try {
        const query = `
            SELECT l.id, l.valor_lido, to_char(l.data_leitura, 'DD/MM HH24:MI') as data_formatada,
                   u.identificacao as unidade, 
                   b.nome as bloco, m.tipo as tipo_medidor,
                   l.foto_url -- Trazendo a foto também
            FROM leituras l
            JOIN medidores m ON l.medidor_id = m.id
            JOIN unidades u ON m.unidade_id = u.id
            JOIN blocos b ON u.bloco_id = b.id
            WHERE u.tenant_id = $1
            ORDER BY l.data_leitura DESC LIMIT 50;
        `;
        const result = await pool.query(query, [tenant_id]);
        console.log(`✅ Achou ${result.rows.length} linhas.`);
        res.json(result.rows);
    } catch (e) {
        console.error("❌ Erro SQL:", e);
        res.status(500).json({ error: e.message });
    }
});

// Importar as outras Rotas
const authRoutes = require('./src/routes/authRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes'); 
const leituraRoutes = require('./src/routes/leituraRoutes');
const adminRoutes = require('./src/routes/adminRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/leitura', leituraRoutes); 
app.use('/api/admin', adminRoutes);

// Teste de Conexão
pool.connect((err, client, release) => {
    if (err) return console.error('❌ Erro Conexão:', err.stack);
    client.query('SELECT NOW()', (err, result) => {
        release();
        if(!err) console.log('✅ Banco OK!');
    });
});

app.listen(port, () => {
    console.log(`🚀 Servidor na porta ${port}`);
});