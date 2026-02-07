const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// 1. GESTÃO DE CONDOMÍNIOS (TENANTS)
// ==========================================

// CADASTRAR CONDOMÍNIO (Agora sem obrigação de síndico imediato)
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

// LISTAR CONDOMÍNIOS (Com filtro de permissão)
exports.listarCondominios = async (req, res) => {
    const { usuario_id, nivel } = req.query;

    try {
        let query = 'SELECT * FROM tenants ORDER BY nome ASC';
        let values = [];

        // Se não for MASTER, traz apenas os vinculados ao usuário
        if (nivel !== 'master' && usuario_id) {
            query = `
                SELECT t.* FROM tenants t
                JOIN user_tenants ut ON t.id = ut.tenant_id
                WHERE ut.user_id = $1
                ORDER BY t.nome ASC
            `;
            values = [usuario_id];
        }

        const result = await pool.query(query, values);
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao listar.' });
    }
};

// EDITAR CONDOMÍNIO
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
        console.error('Erro editar:', error);
        return res.status(500).json({ error: 'Erro ao editar.' });
    }
};

// EXCLUIR CONDOMÍNIO
exports.excluirCondominio = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
        return res.json({ message: 'Condomínio excluído.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao excluir (verifique se há dados vinculados).' });
    }
};

// ==========================================
// 2. GESTÃO DE USUÁRIOS (SÍNDICOS, ZELADORES, ETC)
// ==========================================

// CRIAR USUÁRIO COMPLETO
exports.criarUsuario = async (req, res) => {
    // Recebe o cadastro completo
    const { 
        nome, cpf, rg, email, telefone, senha, tipo, nivel_acesso,
        endereco_logradouro, endereco_numero, endereco_complemento, 
        endereco_bairro, endereco_cep, endereco_cidade, endereco_estado,
        tenant_id_inicial // Opcional: Se já quiser vincular na criação
    } = req.body;

    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const cpfLimpo = cpf.replace(/\D/g, '');

        // 1. Insere na tabela USERS com todos os detalhes
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
        const newUserId = result.rows[0].id;

        // 2. Se foi passado um condomínio inicial, já faz o vínculo
        if (tenant_id_inicial) {
            await client.query(
                'INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [newUserId, tenant_id_inicial]
            );
        }

        await client.query('COMMIT');
        return res.status(201).json(result.rows[0]);

    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') return res.status(400).json({ error: 'CPF ou Email já cadastrados.' });
        console.error('Erro criar usuário:', error);
        return res.status(500).json({ error: 'Erro ao cadastrar usuário.' });
    } finally {
        client.release();
    }
};

// VINCULAR USUÁRIO A UM CONDOMÍNIO (Atribuição)
exports.vincularUsuarioCondominio = async (req, res) => {
    const { user_id, tenant_id } = req.body;
    try {
        await pool.query(
            'INSERT INTO user_tenants (user_id, tenant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [user_id, tenant_id]
        );
        res.json({ message: 'Vínculo realizado com sucesso.' });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao vincular.' });
    }
};

// DESVINCULAR USUÁRIO DE UM CONDOMÍNIO
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

// LISTAR USUÁRIOS
exports.listarUsuarios = async (req, res) => {
    try {
        // Traz usuários e uma string agregada com os nomes dos condomínios que eles atendem
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

// EDITAR USUÁRIO
exports.editarUsuario = async (req, res) => {
    const { id } = req.params;
    const { nome, email, telefone, tipo, senha } = req.body; // Adicione outros campos se quiser editar tudo
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


// ==========================================
// 3. GESTÃO DE BLOCOS E UNIDADES
// ==========================================
// (MANTENHA AS FUNÇÕES ABAIXO IGUAIS AO ARQUIVO ANTERIOR)

exports.criarBloco = async (req, res) => {
    const { tenant_id, nome } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO blocos (tenant_id, nome) VALUES ($1, $2) RETURNING *',
            [tenant_id, nome]
        );
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao criar bloco.' });
    }
};

exports.listarBlocos = async (req, res) => {
    const { tenant_id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM blocos WHERE tenant_id = $1 ORDER BY nome ASC', [tenant_id]);
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao listar blocos.' });
    }
};

exports.criarUnidade = async (req, res) => {
    const { tenant_id, bloco_id, identificacao, andar, criar_medidores } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const unidadeRes = await client.query(
            'INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id, identificacao',
            [tenant_id, bloco_id, identificacao, andar || 'Térreo']
        );
        const unidadeId = unidadeRes.rows[0].id;

        if (criar_medidores && criar_medidores.length > 0) {
            for (const tipo of criar_medidores) {
                await client.query(
                    'INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo) VALUES ($1, $2, $3, 0, 0)',
                    [tenant_id, unidadeId, tipo]
                );
            }
        }
        await client.query('COMMIT');
        return res.status(201).json({ message: `Unidade ${identificacao} criada!` });
    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Erro ao criar unidade.' });
    } finally {
        client.release();
    }
};

exports.gerarUnidadesLote = async (req, res) => {
    const { tenant_id, bloco_id, andar, inicio, fim, criar_medidores } = req.body;
    if (!inicio || !fim || parseInt(inicio) > parseInt(fim)) {
        return res.status(400).json({ error: 'Intervalo inválido.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let criados = 0;
        const listaCriada = [];

        for (let i = parseInt(inicio); i <= parseInt(fim); i++) {
            const identificacao = i.toString();
            const check = await client.query(
                'SELECT id FROM unidades WHERE bloco_id = $1 AND identificacao = $2',
                [bloco_id, identificacao]
            );
            if (check.rows.length === 0) {
                const unidadeRes = await client.query(
                    'INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id',
                    [tenant_id, bloco_id, identificacao, andar]
                );
                const unidadeId = unidadeRes.rows[0].id;

                if (criar_medidores && criar_medidores.length > 0) {
                    for (const tipo of criar_medidores) {
                        await client.query(
                            'INSERT INTO medidores (tenant_id, unidade_id, tipo, leitura_anterior, media_consumo) VALUES ($1, $2, $3, 0, 0)',
                            [tenant_id, unidadeId, tipo]
                        );
                    }
                }
                criados++;
                listaCriada.push(identificacao);
            }
        }
        await client.query('COMMIT');
        return res.status(201).json({ 
            message: `Sucesso! ${criados} unidades geradas.`, 
            detalhes: listaCriada 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        return res.status(500).json({ error: 'Erro ao gerar unidades em lote.' });
    } finally {
        client.release();
    }
};

exports.listarUnidades = async (req, res) => {
    const { bloco_id } = req.params;
    try {
        const query = `
            SELECT u.*, 
            (SELECT COUNT(*) FROM medidores m WHERE m.unidade_id = u.id) as total_medidores
            FROM unidades u 
            WHERE u.bloco_id = $1 
            ORDER BY u.identificacao ASC
        `;
        const result = await pool.query(query, [bloco_id]);
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao listar unidades.' });
    }
};