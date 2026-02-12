const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

exports.login = async (req, res) => {
    const { cpf, senha } = req.body;

    try {
        // 1. Busca o usuário pelo CPF
        const cpfLimpo = cpf.replace(/\D/g, '');
        const userRes = await pool.query('SELECT * FROM users WHERE replace(cpf, \'.\', \'\') = $1', [cpfLimpo]);

        if (userRes.rows.length === 0) {
            return res.status(401).json({ error: 'Usuário não encontrado' });
        }

        const user = userRes.rows[0];

        // 2. Verifica a Senha
        const senhaCorreta = await bcrypt.compare(senha, user.senha_hash);
        if (!senhaCorreta) {
            return res.status(401).json({ error: 'Senha incorreta' });
        }

        // 3. IDENTIFICA O TENANT (CONDOMÍNIO)
        // Lógica: Primeiro tenta pegar do cadastro do usuário (users.tenant_id).
        // Se for nulo, tenta pegar da tabela de vinculos (user_tenants).
        let tenantId = user.tenant_id;
        let tenantNome = "Condomínio";

        if (!tenantId) {
            // Tenta achar na tabela de vinculos
            const vinculos = await pool.query(
                `SELECT t.id, t.nome FROM tenants t 
                 JOIN user_tenants ut ON t.id = ut.tenant_id 
                 WHERE ut.user_id = $1 LIMIT 1`, 
                [user.id]
            );
            
            if (vinculos.rows.length > 0) {
                tenantId = vinculos.rows[0].id;
                tenantNome = vinculos.rows[0].nome;
            }
        } else {
            // Se já tem ID, busca só o nome
            const tRes = await pool.query('SELECT nome FROM tenants WHERE id = $1', [tenantId]);
            if (tRes.rows.length > 0) tenantNome = tRes.rows[0].nome;
        }

        // Se após tudo isso ainda for nulo, o usuário é um admin "Global" ou está com cadastro incompleto
        // Mas para o App não quebrar, mandamos 0 ou null tratado.
        
        console.log(`🔑 Login: ${user.nome} | Tenant ID: ${tenantId}`);

        // 4. Gera o Token
        const token = jwt.sign(
            { id: user.id, tipo: user.tipo, tenant_id: tenantId },
            process.env.JWT_SECRET || 'secreta123',
            { expiresIn: '30d' }
        );

        // 5. Retorna tudo que o App precisa
        return res.json({
            token,
            user: {
                id: user.id,
                nome: user.nome,
                email: user.email,
                tipo: user.tipo,
                tenant_id: tenantId, // O APP MOBILE PRECISA DISSO AQUI PREENCHIDO
                tenant_nome: tenantNome
            }
        });

    } catch (error) {
        console.error('Erro no login:', error);
        return res.status(500).json({ error: 'Erro interno no servidor' });
    }
};