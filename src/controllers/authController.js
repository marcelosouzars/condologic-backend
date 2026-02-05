const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.login = async (req, res) => {
    // Agora esperamos CPF e SENHA
    const { cpf, senha } = req.body;

    try {
        // Limpeza básica: remove pontos e traços caso o frontend envie formatado
        // Ex: '123.456.789-00' vira '12345678900'
        const cpfLimpo = cpf.replace(/\D/g, '');

        // 1. Busca o usuário pelo CPF
        const result = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpfLimpo]);
        const user = result.rows[0];

        // 2. Se não achar usuário
        if (!user) {
            return res.status(401).json({ error: 'CPF não cadastrado' });
        }

        // 3. Verifica a senha
        if (user.senha_hash !== senha) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        // 4. Busca dados do Condomínio (Tenant)
        // Se o tenant_id for 0 (Master), criamos um objeto "fictício" para não quebrar o app
        let tenantNome = "Administração Global";
        if (user.tenant_id !== 0) {
            const tenantResult = await pool.query('SELECT * FROM tenants WHERE id = $1', [user.tenant_id]);
            if (tenantResult.rows.length > 0) {
                tenantNome = tenantResult.rows[0].nome;
            }
        }

        // 5. Retorna sucesso
        return res.json({
            message: 'Login realizado com sucesso',
            user: {
                id: user.id,
                nome: user.nome,
                cpf: user.cpf,
                role: user.tipo, // 'admin_geral', 'zelador'
                nivel: user.nivel_acesso, // 'master', 'operador'
                tenant: {
                    id: user.tenant_id,
                    nome: tenantNome
                }
            }
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
};