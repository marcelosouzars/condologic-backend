const { Pool } = require('pg');
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// 1. GESTÃO DE CONDOMÍNIOS (TENANTS)
// ==========================================

// Cadastrar Novo Condomínio
exports.criarCondominio = async (req, res) => {
    const { 
        nome, cnpj, endereco, cidade, estado, tipo_estrutura, 
        nome_sindico, email_sindico, telefone_sindico,
        valor_m3_agua, valor_m3_gas, dia_corte 
    } = req.body;

    try {
        const query = `
            INSERT INTO tenants (
                nome, cnpj, endereco, cidade, estado, tipo_estrutura, 
                nome_sindico, email_sindico, telefone_sindico,
                valor_m3_agua, valor_m3_gas, dia_corte
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *;
        `;
        const values = [
            nome, cnpj, endereco, cidade, estado, tipo_estrutura, 
            nome_sindico, email_sindico, telefone_sindico,
            valor_m3_agua || 0, valor_m3_gas || 0, dia_corte || 1
        ];

        const result = await pool.query(query, values);
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erro ao criar condomínio:', error);
        return res.status(500).json({ error: 'Erro ao cadastrar condomínio.' });
    }
};

// Listar Condomínios
exports.listarCondominios = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tenants ORDER BY nome ASC');
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao listar.' });
    }
};

// Editar Condomínio
exports.editarCondominio = async (req, res) => {
    const { id } = req.params;
    const { 
        nome, endereco, nome_sindico, email_sindico, telefone_sindico,
        valor_m3_agua, valor_m3_gas, dia_corte 
    } = req.body;

    try {
        const query = `
            UPDATE tenants SET 
                nome = $1, endereco = $2, nome_sindico = $3, 
                email_sindico = $4, telefone_sindico = $5,
                valor_m3_agua = $6, valor_m3_gas = $7, dia_corte = $8
            WHERE id = $9 RETURNING *
        `;
        const values = [
            nome, endereco, nome_sindico, email_sindico, telefone_sindico,
            valor_m3_agua, valor_m3_gas, dia_corte, id
        ];
        const result = await pool.query(query, values);
        return res.json(result.rows[0]);
    } catch (error) {
        console.error('Erro editar:', error);
        return res.status(500).json({ error: 'Erro ao editar.' });
    }
};

// Excluir Condomínio
exports.excluirCondominio = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM tenants WHERE id = $1', [id]);
        return res.json({ message: 'Condomínio excluído.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao excluir (pode ter dados vinculados).' });
    }
};

// ==========================================
// 2. GESTÃO DE BLOCOS E UNIDADES
// ==========================================

// Cadastrar Blocos/Torres
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

// Listar Blocos
exports.listarBlocos = async (req, res) => {
    const { tenant_id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM blocos WHERE tenant_id = $1 ORDER BY nome ASC', [tenant_id]);
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao listar blocos.' });
    }
};

// Cadastrar Unidade (INDIVIDUAL)
exports.criarUnidade = async (req, res) => {
    // Agora recebe 'andar' também
    const { tenant_id, bloco_id, identificacao, andar, criar_medidores } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Insere com o campo ANDAR (Se vier vazio, põe 'Térreo')
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

// --- NOVA FUNÇÃO: GERAÇÃO EM LOTE (WIZARD) ---
exports.gerarUnidadesLote = async (req, res) => {
    const { tenant_id, bloco_id, andar, inicio, fim, criar_medidores } = req.body;
    
    // Validação básica: Início tem que ser menor que Fim
    if (!inicio || !fim || parseInt(inicio) > parseInt(fim)) {
        return res.status(400).json({ error: 'Intervalo inválido (Início deve ser menor que Fim).' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let criados = 0;
        const listaCriada = [];

        // Loop do Início ao Fim (Ex: 101, 102, ... 110)
        for (let i = parseInt(inicio); i <= parseInt(fim); i++) {
            const identificacao = i.toString();

            // 1. Verifica se já existe para não duplicar (Erro comum)
            const check = await client.query(
                'SELECT id FROM unidades WHERE bloco_id = $1 AND identificacao = $2',
                [bloco_id, identificacao]
            );

            if (check.rows.length === 0) {
                // 2. Cria a Unidade com o ANDAR
                // Se for Casa, o "andar" pode ser usado como "Rua" ou "Quadra"
                const unidadeRes = await client.query(
                    'INSERT INTO unidades (tenant_id, bloco_id, identificacao, andar) VALUES ($1, $2, $3, $4) RETURNING id',
                    [tenant_id, bloco_id, identificacao, andar]
                );
                const unidadeId = unidadeRes.rows[0].id;

                // 3. Cria os Medidores selecionados
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
            message: `Sucesso! ${criados} unidades geradas (Grupo/Andar: ${andar}).`, 
            detalhes: listaCriada 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro lote:', error);
        return res.status(500).json({ error: 'Erro ao gerar unidades em lote.' });
    } finally {
        client.release();
    }
};

// Listar Unidades (Traz o Andar/Grupo também)
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

// ==========================================
// 3. GESTÃO DE USUÁRIOS
// ==========================================

// Criar Usuário
exports.criarUsuario = async (req, res) => {
    const { tenant_id, nome, cpf, senha, tipo, nivel_acesso } = req.body;
    try {
        const cpfLimpo = cpf.replace(/\D/g, '');
        const query = `
            INSERT INTO users (tenant_id, nome, cpf, senha_hash, tipo, nivel_acesso)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, nome, cpf, tipo;
        `;
        const values = [tenant_id, nome, cpfLimpo, senha, tipo, nivel_acesso];
        const result = await pool.query(query, values);
        return res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === '23505') return res.status(400).json({ error: 'CPF já cadastrado.' });
        return res.status(500).json({ error: 'Erro ao cadastrar usuário.' });
    }
};

// Listar Usuários
exports.listarUsuarios = async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.nome, u.cpf, u.tipo, u.nivel_acesso, t.nome as condominio_nome, u.tenant_id
            FROM users u
            LEFT JOIN tenants t ON u.tenant_id = t.id
            ORDER BY u.nome ASC;
        `;
        const result = await pool.query(query);
        return res.json(result.rows);
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao listar usuários.' });
    }
};

// Editar Usuário
exports.editarUsuario = async (req, res) => {
    const { id } = req.params;
    const { nome, senha, tipo } = req.body;
    try {
        let query = '';
        let values = [];
        if (senha && senha.trim() !== '') {
            query = 'UPDATE users SET nome = $1, tipo = $2, senha_hash = $3 WHERE id = $4 RETURNING id, nome';
            values = [nome, tipo, senha, id];
        } else {
            query = 'UPDATE users SET nome = $1, tipo = $2 WHERE id = $3 RETURNING id, nome';
            values = [nome, tipo, id];
        }
        const result = await pool.query(query, values);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
        return res.json({ message: 'Atualizado', user: result.rows[0] });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao atualizar.' });
    }
};

// Excluir Usuário
exports.excluirUsuario = async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        return res.json({ message: 'Usuário removido.' });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao excluir.' });
    }
};