require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function corrigirBanco() {
    console.log("⏳ Conectando ao Banco...");
    const client = await pool.connect();

    try {
        console.log("🛠️  Verificando Tabela de Medidores...");
        // 1. Garante que a tabela medidores tenha a coluna 'tipo'
        await client.query(`
            ALTER TABLE medidores 
            ADD COLUMN IF NOT EXISTS tipo VARCHAR(50) DEFAULT 'agua_fria';
        `);

        console.log("🛠️  Recriando Tabela de Leituras (para garantir estrutura)...");
        // 2. Apaga e recria a tabela leituras para ficar compatível com o código novo
        // ATENÇÃO: Isso apaga as leituras de teste que você fez hoje, terá que fazer de novo.
        await client.query('DROP TABLE IF EXISTS leituras CASCADE;');

        const createLeituras = `
            CREATE TABLE leituras (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER, 
                medidor_id INTEGER REFERENCES medidores(id),
                valor_lido NUMERIC(10,2),
                data_leitura TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                foto_url TEXT, -- Preparado para a foto
                origem_dado VARCHAR(50), 
                status_leitura VARCHAR(50) 
            );
        `;
        await client.query(createLeituras);

        console.log("✅ Banco de dados corrigido e pronto!");

    } catch (err) {
        console.error("❌ Erro:", err);
    } finally {
        client.release();
        pool.end();
    }
}

corrigirBanco();