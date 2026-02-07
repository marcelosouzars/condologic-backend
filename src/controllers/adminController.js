const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// 1. GESTÃO DE CONDOMÍNIOS (TENANTS)
// ==========================================

exports.criarCondominio = async (req, res) => {
    const { 
        nome, cnpj, endereco, cidade, estado, tipo_estrutura, 
        valor_m3_agua, valor_m3_gas, dia_corte 
    } = req.body;

    try {
        const query = `
            INSERT INTO tenants (
                nome, cnpj, endereco, cidade, estado, tipo_estrutura, 
                valor_m3_agua, valor_m3_gas, dia_corte, status_conta
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ativo')
            RETURNING *;
        `;
        const values = [
            nome, cnpj, endereco, cidade, estado, tipo_estrutura, 
            valor_m3_agua || 0, valor_m3_gas || 0, dia_corte || 1
        ];

        const result = await pool.query(query, values);
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao criar condomínio:', error);
        return res.status(500).json({ error: 'Erro ao cadastrar condomínio.' });
    }
};

// LISTAR CONDOMÍNIOS (Trazendo o ID do síndico vinculado)
exports.listarCondominios = async (req, res) => {
    const { usuario_id, nivel } = req.query;

    try {
        let query = '';
        let values = [];

        // Query esperta: Já busca na tabela de ligação QUEM é o síndico deste prédio
        // para preenchermos o dropdown na tela de edição
        const subSelectSindico = `
            (SELECT ut.user_id 
             FROM user_tenants ut 
             JOIN users u ON ut.user_id = u.id 
             WHERE ut.tenant_id = t.id AND u.tipo = 'sindico' 
             LIMIT 1) as sindico_id
        `;

        if (nivel !== 'master' && usuario_id) {
            query = `
                SELECT t.*, ${subSelectSindico} 
                FROM tenants t
                JOIN user_tenants ut ON t.id = ut.tenant_id
                WHERE ut.user_id = $1
                ORDER BY t.nome ASC
            `;
            values = [usuario_id];
        } else {
            query = `SELECT t.*, ${subSelectSindico} FROM tenants t ORDER BY t.nome ASC`;
        }

        const result = await pool.query(query, values);
        return res.json(result.rows);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao listar.' });
    }
};

exports.editarCondominio = async (req, res) => {
    const { id } = req.params;
    const { 
        nome, endereco, valor_m3_agua, valor_m3_gas, dia_corte 
    } = req.body;

    try {
        const query = `
            UPDATE tenants SET 
                nome = $1, endereco = $2, 
                valor_m3_agua = $3, valor_m3_gas = $4, dia_corte = $5
            WHERE id = $6 RETURNING *
        `;
        const values = [nome, endereco, valor_m3_agua, valor_m3_gas, dia_corte, id];
        const result = await pool.query(query, values);
        return res.json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao editar.' });
    }
};

exports.excluirCondominio = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
        return res.json({ message: 'Condomínio excluído.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao excluir.' });
    }
};

// ==========================================
// 2. GESTÃO DE USUÁRIOS
// ==========================================

exports.criarUsuario = async (req, res) => {
    // Recebe cadastro completo
    const { 
        nome, cpf, rg, email, telefone, senha, tipo, nivel_acesso,
        endereco_logradouro, endereco_numero, endereco_complemento, 
        endereco_bairro, endereco_cep, endereco_cidade, endereco_estado
    } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const cpfLimpo = cpf.replace(/\D/g, '');

        const query = `
            INSERT INTO users (
                nome, cpf, rg, email, telefone, senha_hash, tipo, nivel_acesso,
                endereco_logradouro, endereco_numero, endereco_complemento, 
                endereco_bairro, endereco_cep, endereco_cidade, endereco_estado
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING id, nome, cpf, tipo;
        `;
        
        const values = [
            nome, cpfLimpo, rg, email, telefone, senha, tipo, nivel_acesso,
            endereco_logradouro, endereco_numero, endereco_complemento,
            endereco_bairro, endereco_cep, endereco_cidade, endereco_estado
        ];

        const result = await client.query(query, values);
        await client.query('COMMIT');
        return res.status(201).json(result.rows[0]);

    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(400).json({ error: 'CPF ou Email já cadastrados.' });
        return res.status(500).json({ error: 'Erro ao cadastrar usuário.' });
    } finally {
        client.release();
    }
};

// VINCULAR E DESVINCULAR
exports.vincularUsuarioCondominio = async (req, res) => {
    const { user_id, tenant_id } = req.body;
    try {
        // Vincula
        await pool.query(
            'INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [user_id, tenant_id]
        );
        // Atualiza os campos de texto no tenant apenas para cache visual (opcional)
        // Buscamos dados do user
        const userRes = await pool.query('SELECT nome, email, telefone FROM users WHERE id = $1', [user_id]);
        if(userRes.rows.length > 0) {
            const u = userRes.rows[0];
            await pool.query(
                'UPDATE tenants SET nome_sindico=$1, email_sindico=$2, telefone_sindico=$3 WHERE id=$4',
                [u.nome, u.email, u.telefone, tenant_id]
            );
        }

        res.json({ message: 'Vínculo realizado.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao vincular.' });
    }
};

exports.desvincularUsuarioCondominio = async (req, res) => {
    const { user_id, tenant_id } = req.body;
    try {
        await pool.query(
            'DELETE FROM user_tenants WHERE user_id = $1 AND tenant_id = $2',
            [user_id, tenant_id]
        );
        res.json({ message: 'Vínculo removido.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao desvincular.' });
    }
};

exports.listarUsuarios = async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.nome, u.cpf, u.email, u.telefone, u.tipo, u.nivel_acesso,
                   STRING_AGG(t.nome, ', ') as condominios_vinculados
            FROM users u
            LEFT JOIN user_tenants ut ON u.id = ut.user_id
            LEFT JOIN tenants t ON ut.tenant_id = t.id
            GROUP BY u.id
            ORDER BY u.nome ASC;
        `;
        const result = await pool.query(query);
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao listar usuários.' });
    }
};

exports.editarUsuario = async (req, res) => {
    const { id } = req.params;
    const { nome, email, telefone, tipo, senha } = req.body;
    try {
        let query = '';
        let values = [];
        if (senha && senha.trim() !== '') {
            query = `UPDATE users SET nome=$1, email=$2, telefone=$3, tipo=$4, senha_hash=$5 WHERE id=$6`;
            values = [nome, email, telefone, tipo, senha, id];
        } else {
            query = `UPDATE users SET nome=$1, email=$2, telefone=$3, tipo=$4 WHERE id=$5`;
            values = [nome, email, telefone, tipo, id];
        }
        await pool.query(query, values);
        return res.json({ message: 'Usuário atualizado.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao atualizar.' });
    }
};

exports.excluirUsuario = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        return res.json({ message: 'Usuário removido.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao excluir.' });
    }
};

// BLOCOS E UNIDADES (Mantém igual)
exports.criarBloco = async (req, res) => {
    const { tenant_id, nome } = req.body;
    try {
        const result = await pool.query('INSERT INTO blocos (tenant_id, nome) VALUES ($1, $2) RETURNING *', [tenant_id, nome]);
        return res.status(201).json(result.rows[0]);
    } catch (error) { return res.status(500).json({ error: 'Erro bloco' }); }
};
exports.listarBlocos = async (req, res) => {
    const { tenant_id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM blocos WHERE tenant_id = $1 ORDER BY nome ASC', [tenant_id]);
        return res.json(result.rows);
    } catch (error) { return res.status(500).json({ error: 'Erro listar blocos' }); }
};
exports.criarUnidade = async (req, res) => {
    const { tenant_id, bloco_id, identificacao, andar, criar_medidores } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const unidadeRes = await client.query('INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id', [tenant_id, bloco_id, identificacao, andar || 'Térreo']);
        const unidadeId = unidadeRes.rows[0].id;
        if (criar_medidores) {
            for (const tipo of criar_medidores) {
                await client.query('INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo) VALUES ($1, $2, $3, 0, 0)', [tenant_id, unidadeId, tipo]);
            }
        }
        await client.query('COMMIT'); return res.status(201).json({ message: 'Unidade criada' });
    } catch (error) { await client.query('ROLLBACK'); return res.status(500).json({ error: 'Erro unidade' }); } finally { client.release(); }
};
exports.gerarUnidadesLote = async (req, res) => {
    const { tenant_id, bloco_id, andar, inicio, fim, criar_medidores } = req.body;
    if (!inicio || !fim || parseInt(inicio) > parseInt(fim)) return res.status(400).json({ error: 'Intervalo inválido' });
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let criados = 0;
        for (let i = parseInt(inicio); i <= parseInt(fim); i++) {
            const identificacao = i.toString();
            const check = await client.query('SELECT id FROM unidades WHERE bloco_id = $1 AND identificacao = $2', [bloco_id, identificacao]);
            if (check.rows.length === 0) {
                const uRes = await client.query('INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id', [tenant_id, bloco_id, identificacao, andar]);
                const uId = uRes.rows[0].id;
                if (criar_medidores) {
                    for (const t of criar_medidores) await client.query('INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo) VALUES ($1, $2, $3, 0, 0)', [tenant_id, uId, t]);
                }
                criados++;
            }
        }
        await client.query('COMMIT'); return res.status(201).json({ message: `Gerados ${criados}` });
    } catch (error) { await client.query('ROLLBACK'); return res.status(500).json({ error: 'Erro lote' }); } finally { client.release(); }
};
exports.listarUnidades = async (req, res) => {
    const { bloco_id } = req.params;
    try {
        const result = await pool.query('SELECT u.*, (SELECT COUNT(*) FROM medidores m WHERE m.unidade_id = u.id) as total_medidores FROM unidades u WHERE u.bloco_id = $1 ORDER BY u.identificacao ASC', [bloco_id]);
        return res.json(result.rows);
    } catch (error) { return res.status(500).json({ error: 'Erro listar unidades' }); }
};