const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.login = async (req, res) => {
    // Agora esperamos CPF e SENHA
    const { cpf, senha } = req.body;

    try {
        const cpfLimpo = cpf.replace(/\D/g, '');

        // 1. Busca o usuário pelo CPF
        const result = await pool.query('SELECT * FROM users WHERE cpf = $1', [cpfLimpo]);
        const user = result.rows[0];

        // 2. Se não achar usuário
        if (!user) {
            return res.status(401).json({ error: 'CPF não cadastrado' });
        }

        // 3. Verifica a senha (COMPARAÇÃO SIMPLES - MODO DEV)
        if (user.senha_hash !== senha) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        // 4. Busca dados dos Condomínios permitidos para este usuário
        let meusCondominios = [];
        let nomeTenantPrincipal = "Nenhum";
        let idTenantPrincipal = 0;

        // Se for MASTER, traz TODOS
        if (user.nivel_acesso === 'master') {
            const allTenants = await pool.query('SELECT id, nome FROM tenants ORDER BY nome ASC');
            meusCondominios = allTenants.rows;
            nomeTenantPrincipal = "Acesso Master Global";
        } else {
            const ut = await pool.query(`
                SELECT t.id, t.nome 
                FROM tenants t
                JOIN user_tenants ut ON t.id = ut.tenant_id
                WHERE ut.user_id = $1
                ORDER BY t.nome ASC
            `, [user.id]);
            meusCondominios = ut.rows;
            
            if (meusCondominios.length > 0) {
                nomeTenantPrincipal = meusCondominios[0].nome;
                idTenantPrincipal = meusCondominios[0].id;
            }
        }

        // 5. Retorna sucesso
        return res.json({
            message: 'Login realizado com sucesso',
            user: {
                id: user.id,
                nome: user.nome,
                cpf: user.cpf,
                role: user.tipo, 
                nivel: user.nivel_acesso,
                tenant: {
                    id: idTenantPrincipal,
                    nome: nomeTenantPrincipal
                },
                tenants: meusCondominios 
            }
        });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
};