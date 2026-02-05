require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function corrigirBanco() {
    console.log("⏳ Conectando ao Banco de Dados...");
    const client = await pool.connect();

    try {
        console.log("🛠️  Recriando tabela de usuários...");

        // 1. Apaga a tabela antiga (se existir)
        await client.query('DROP TABLE IF EXISTS users CASCADE;');

        // 2. Cria a tabela nova com a estrutura CORRETA
        const createTableQuery = `
            CREATE TABLE users (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER REFERENCES tenants(id),
                nome VARCHAR(255) NOT NULL,
                cpf VARCHAR(14) UNIQUE NOT NULL,
                senha_hash VARCHAR(255) NOT NULL,
                tipo VARCHAR(50) NOT NULL, 
                nivel_acesso VARCHAR(50) NOT NULL, 
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        await client.query(createTableQuery);
        console.log("✅ Tabela 'users' recriada com sucesso!");

        // 3. Cria o seu Usuário Master novamente (para você não ficar trancado fora)
        // Substitua o CPF pelo seu se quiser
        const insertMaster = `
            INSERT INTO users (tenant_id, nome, cpf, senha_hash, tipo, nivel_acesso)
            VALUES (0, 'Marcelo Master', '00000000000', '123456', 'admin_geral', 'master');
        `;
        await client.query(insertMaster);
        console.log("👤 Usuário Master (CPF 00000000000 / Senha 123456) recriado.");

    } catch (err) {
        console.error("❌ Erro ao corrigir banco:", err);
    } finally {
        client.release();
        pool.end(); // Encerra a conexão
    }
}

corrigirBanco();