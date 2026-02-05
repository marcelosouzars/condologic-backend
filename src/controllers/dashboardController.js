const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.getDashboard = async (req, res) => {
    // --- MUDANÇA: Pegamos o tenant_id da URL ---
    const { tenant_id } = req.query; 

    // Se o app não mandar o ID, rejeitamos
    if (!tenant_id) {
        return res.status(400).json({ error: 'ID do condomínio não informado.' });
    }

    try {
        // Essa query busca as unidades e a ÚLTIMA leitura válida do mês
        // Filtrando pelo TENANT_ID recebido
        const query = `
            SELECT 
                u.id as unidade_id,
                u.identificacao,
                b.nome as bloco_nome,
                m.id as medidor_id,
                CASE 
                    WHEN l.id IS NOT NULL AND l.status_leitura = 'alerta_vazamento' THEN 'vermelho'
                    WHEN l.id IS NOT NULL THEN 'verde'
                    ELSE 'branco'
                END as status_cor,
                l.valor_lido,
                m.leitura_anterior,
                m.media_consumo
            FROM unidades u
            JOIN blocos b ON u.bloco_id = b.id
            JOIN medidores m ON m.unidade_id = u.id
            LEFT JOIN (
                SELECT DISTINCT ON (medidor_id) *
                FROM leituras
                WHERE data_leitura >= date_trunc('month', CURRENT_DATE)
                ORDER BY medidor_id, data_leitura DESC
            ) l ON l.medidor_id = m.id 
            WHERE u.tenant_id = $1
            ORDER BY u.identificacao ASC;
        `;

        const result = await pool.query(query, [tenant_id]);
        
        return res.json(result.rows);

    } catch (error) {
        console.error('Erro no Dashboard:', error);
        return res.status(500).json({ error: 'Erro ao buscar dados' });
    }
};